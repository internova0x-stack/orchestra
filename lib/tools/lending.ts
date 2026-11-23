import { z } from "zod";
import { watch } from "../updates.ts";
import { audit, confirmFirst, refuse, ruleRead, type Tier, type ToolCtx, type ToolResult } from "../toolkit.ts";
import type { Rules } from "../rules.ts";
import { money } from "../format.ts";
import { addBusinessDays, dateTime, dayMonthYear, longDate } from "../time.ts";
import { bank } from "../bank/index.ts";
import type { Loan, MerchantPayout } from "../bank/contract.ts";

// Use case 7: loans. Use case 8: merchant payouts and holds.

type LoanRow = Loan;

const loanInput = z.object({ loan_id: z.string().optional().describe("The loan's id, if the customer has more than one") });

async function findLoan(ctx: ToolCtx, id?: string): Promise<LoanRow | null> {
  const rows = await bank(ctx.sql).listLoans(ctx.user!.business_id, { id: id?.trim().toUpperCase() });
  return rows[0] ?? null;
}

export const getLoan = {
  name: "get_loan",
  tier: 1 as Tier,
  description: "The verified customer's loan: balance, next due date, amount due, any arrears and its status.",
  schema: loanInput,
  async run(input: z.infer<typeof loanInput>, ctx: ToolCtx, _rules: Rules): Promise<ToolResult> {
    const l = await findLoan(ctx, input.loan_id);
    if (!l) {
      await audit(ctx, { kind: "lookup", tool: "get_loan", summary: "get_loan · no loan", input });
      return { ok: true, data: { found: false, note: "No loan on this account." } };
    }
    const data = {
      loan: l.id, product: l.product, balance: money(l.balance, l.currency), next_payment: money(l.monthly_payment, l.currency),
      due: longDate(new Date(l.next_due_at)), arrears: money(l.arrears, l.currency), status: l.status === "current" ? "Up to date" : l.status === "in_arrears" ? "In arrears" : "In default",
    };
    await audit(ctx, { kind: "lookup", tool: "get_loan", summary: `get_loan · ${l.id} · ${data.balance} · due ${dayMonthYear(new Date(l.next_due_at))}`, input, result: data });
    return { ok: true, data };
  },
};

export const payoffQuote = {
  name: "payoff_quote",
  tier: 1 as Tier,
  description: "How much it would take to pay the loan off today: the balance plus interest to today, and the date the quote is valid until. A figure, not advice on whether to pay it off.",
  schema: loanInput,
  async run(input: z.infer<typeof loanInput>, ctx: ToolCtx, rules: Rules): Promise<ToolResult> {
    const l = await findLoan(ctx, input.loan_id);
    if (!l) return refuse(ctx, "payoff_quote", input, "No loan on this account.", "no loan");
    const validDays = rules.num("payoff_valid_days", 7);
    await ruleRead(ctx, rules, "payoff_valid_days");
    // Interest since the last payment date (one month before the next due date), simple daily accrual.
    const last = new Date(new Date(l.next_due_at).getTime() - 30 * 86_400_000);
    const days = Math.max(0, Math.round((ctx.now.getTime() - last.getTime()) / 86_400_000));
    const interest = Math.round(Number(l.balance) * (Number(l.annual_rate) / 100 / 365) * days * 100) / 100;
    const total = Math.round((Number(l.balance) + interest + Number(l.arrears)) * 100) / 100;
    const data = { loan: l.id, payoff_amount: money(total, l.currency), made_up_of: { balance: money(l.balance, l.currency), interest_to_today: money(interest, l.currency), arrears: money(l.arrears, l.currency) }, valid_until: longDate(new Date(ctx.now.getTime() + validDays * 86_400_000)) };
    await audit(ctx, { kind: "lookup", tool: "payoff_quote", summary: `payoff_quote · ${l.id} · ${data.payoff_amount}`, input, result: data });
    return { ok: true, data };
  },
};

const deferInput = loanInput.extend({ months: z.number().int().min(1).max(3).optional().describe("How many monthly payments to defer (default 1)") });

export const requestDeferral = {
  name: "request_deferral",
  tier: 3 as Tier,
  identity: "stronger" as const,
  description:
    "Log a request to defer a loan payment, for a customer who can't pay this month. Explain the option and its cost first; it needs the stronger check and the customer's yes. A request is not an approval: the lending team decides and you must say so. Then hand off (any loan deferral beyond logging the request needs a person). Hardship beyond one missed payment, a loan in default, or questions about new credit or whether to borrow: hand off without advice.",
  schema: deferInput,
  async run(input: z.infer<typeof deferInput>, ctx: ToolCtx, rules: Rules): Promise<ToolResult> {
    const T = "request_deferral";
    const user = ctx.user!;
    const l = await findLoan(ctx, input.loan_id);
    if (!l) return refuse(ctx, T, input, "No loan on this account.", "no loan");
    if (l.status === "default") return refuse(ctx, T, input, "This loan is in default, so a deferral can't be requested here. Hand off to the specialist team without judgment.", "loan in default");
    const [open] = await ctx.sql<{ reference: string; decision_by: Date }[]>`select reference, decision_by from deferral_requests where loan_id = ${l.id} and status = 'requested'`;
    if (open) {
      await audit(ctx, { kind: "refusal", tool: T, summary: `${T} · refused: already requested ${open.reference}`, input, refusal_reason: "Duplicate deferral" });
      return { ok: false, reference: open.reference, reason: `A deferral request is already with the lending team (${open.reference}), decision by ${longDate(new Date(open.decision_by))}. Give that reference; don't log another.` };
    }
    const months = input.months ?? 1;
    const waiting = await confirmFirst(
      ctx, T, l.id, `deferral request on ${l.id}`,
      `Ask the lending team to defer ${months === 1 ? "this month's" : `${months} months'`} ${money(l.monthly_payment, l.currency)} payment on your ${l.product.toLowerCase()}?`,
      `${rules.get("loan_deferral")?.value ?? "Interest keeps running; the team decides."}`,
    );
    if (waiting) return waiting;
    const decisionBy = addBusinessDays(ctx.now, rules.num("deferral_decision_days", 3), rules.hours());
    await ruleRead(ctx, rules, "deferral_decision_days");
    const [{ seq }] = await ctx.sql<{ seq: string }[]>`select nextval('deferral_seq')::text as seq`;
    const reference = `DEF-${seq}`;
    await ctx.sql`insert into deferral_requests (reference, loan_id, holder_id, conversation_id, months, decision_by)
      values (${reference}, ${l.id}, ${user.business_id}, ${ctx.conv.id}, ${months}, ${decisionBy})`;
    await audit(ctx, { kind: "action", tool: T, summary: `${T} · ${l.id} · ${reference} logged for the lending team`, input, result: { reference } });
    await watch(ctx.sql, { conversationId: ctx.conv.id, holderId: user.business_id, userId: user.id, kind: "deferral", reference, label: `request to defer a payment on your ${l.product.toLowerCase()}`, status: "requested", expectedBy: decisionBy });
    return { ok: true, reference, data: { reference, decision_by: longDate(decisionBy), note: "Say it's a request, not an approval; the team decides by that date. Then hand off (trigger loan_hardship) so the specialist team has the case." } };
  },
};

// ---------------------------------------------------------------- use case 8

type PayoutRow = MerchantPayout;

const payoutInput = z.object({ payout_id: z.string().optional().describe("The payout's id, e.g. PY-21007; leave out for the latest") });

export const getPayoutStatus = {
  name: "get_payout_status",
  tier: 1 as Tier,
  description:
    "For a merchant (a business account that takes card payments): a payout's amount, scheduled date, status, the cause of any delay from the record, and its breakdown into sales, fees, refunds and dispute reserves so the totals reconcile. A payout on a review hold shows \"On hold\" only: follow the review-hold rule.",
  schema: payoutInput,
  async run(input: z.infer<typeof payoutInput>, ctx: ToolCtx, rules: Rules): Promise<ToolResult> {
    const rows: PayoutRow[] = (await bank(ctx.sql).listMerchantPayouts(ctx.user!.business_id, { id: input.payout_id?.trim().toUpperCase() })).slice(0, 3);
    if (!rows.length) {
      await audit(ctx, { kind: "lookup", tool: "get_payout_status", summary: "get_payout_status · none", input });
      return { ok: true, data: { found: false, note: "No merchant payouts on this account." } };
    }
    const items = rows.map((p) =>
      p.review_hold
        ? { payout: p.id, amount: money(p.amount, p.currency), scheduled: dayMonthYear(new Date(p.scheduled_for)), status: "On hold", review_hold: true, note: "review hold: no reason is available to you; follow the review-hold rule and hand off." }
        : {
            payout: p.id, amount: money(p.amount, p.currency), scheduled: dayMonthYear(new Date(p.scheduled_for)),
            status: { scheduled: "Scheduled", paid: "Paid", delayed: "Delayed", rejected: "Rejected by the merchant's bank", on_hold: "On hold" }[p.status],
            ...(p.delay_reason ? { cause: p.delay_reason, what_next: p.status === "rejected" ? rules.get("payout_rejected")?.value : undefined } : {}),
            ...(p.paid_at ? { paid: dateTime(new Date(p.paid_at)) } : {}),
            breakdown: { sales: money(p.sales, p.currency), fees: `−${money(p.fees, p.currency)}`, refunds: `−${money(p.refunds, p.currency)}`, dispute_reserves: `−${money(p.disputes, p.currency)}`, payout: money(p.amount, p.currency) },
            reconciles: Math.abs(Number(p.sales) - Number(p.fees) - Number(p.refunds) - Number(p.disputes) - Number(p.amount)) < 0.01,
          },
    );
    const first = items[0] as { payout: string; status: string };
    await audit(ctx, { kind: "lookup", tool: "get_payout_status", summary: `get_payout_status · ${first.payout} · ${String(first.status).toLowerCase()}`, input, result: items });
    return { ok: true, data: { payouts: items } };
  },
};

export const listHolds = {
  name: "list_holds",
  tier: 1 as Tier,
  description: "Holds on a merchant's funds, each with its amount and the stated reason. A risk or compliance review appears as \"review hold\" with no reason: follow the review-hold rule.",
  schema: z.object({}),
  async run(_input: Record<string, never>, ctx: ToolCtx, _rules: Rules): Promise<ToolResult> {
    // The bank never sends the internal reason.
    const rows = await bank(ctx.sql).listMerchantHolds(ctx.user!.business_id);
    const holds = rows.map((h) => (h.type === "review_hold" ? { hold: h.id, amount: money(h.amount, h.currency), type: "review hold", ...(h.payout_id ? { payout: h.payout_id } : {}) } : { hold: h.id, amount: money(h.amount, h.currency), reason: h.customer_reason, ...(h.payout_id ? { payout: h.payout_id } : {}) }));
    await audit(ctx, { kind: "lookup", tool: "list_holds", summary: `list_holds · ${holds.some((h) => "type" in h) ? "review hold" : `${holds.length} hold${holds.length === 1 ? "" : "s"}`}`, result: holds });
    return { ok: true, data: holds.length ? { holds } : { holds: [], note: "No holds." } };
  },
};
