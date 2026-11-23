import { z } from "zod";
import { watch } from "../updates.ts";
import { audit, confirmFirst, refuse, ruleRead, type Tier, type ToolCtx, type ToolResult } from "../toolkit.ts";
import type { Rules } from "../rules.ts";
import { money } from "../format.ts";
import { dateTime } from "../time.ts";

// Use case 12: debited but no value. A POS, ATM or web payment failed at the merchant or terminal
// while the account was debited. Find it, check its reversal, request one if it's past the window.

export interface PaymentRow {
  id: string; holder_id: string; channel: string; merchant_name: string; location: string | null; terminal_bank: string | null;
  processor: string | null; card_last4: string | null; amount: string; currency: string; outcome: string; failure_detail: string | null; at: Date;
}

const OUTCOME: Record<string, string> = { successful: "Successful", failed_debited: "Failed at the merchant or terminal, but the account was debited", declined: "Declined, nothing debited" };

/** Which reversal window applies: own-bank ATM, another bank's ATM, or POS and web. */
export function windowRule(p: Pick<PaymentRow, "channel" | "terminal_bank">): string {
  if (p.channel === "ATM") return p.terminal_bank ? "reversal_window_atm_other" : "reversal_window_atm_own";
  return "reversal_window_pos_web";
}

export function paymentView(p: PaymentRow) {
  return {
    id: p.id,
    when: dateTime(new Date(p.at)),
    channel: p.channel,
    merchant: p.merchant_name,
    location: p.location,
    ...(p.terminal_bank ? { terminal_bank: p.terminal_bank } : {}),
    ...(p.card_last4 ? { card: `•••• ${p.card_last4}` } : {}),
    amount: money(p.amount, p.currency),
    outcome: OUTCOME[p.outcome] ?? p.outcome,
    ...(p.failure_detail ? { detail: p.failure_detail } : {}),
  };
}

const findInput = z.object({
  amount: z.number().optional(),
  channel: z.enum(["card", "POS", "ATM", "web"]).optional(),
  card_last4: z.string().regex(/^\d{4}$/).optional(),
  on: z.string().optional().describe("Roughly when, as YYYY-MM-DD"),
  merchant: z.string().optional().describe("Part of the merchant's or ATM's name"),
});

export const findPayments = {
  name: "find_payments",
  tier: 1 as Tier,
  description:
    "Find card, POS, ATM and web payments on the verified customer's account by amount, date, channel, merchant and card's last 4 digits. Shows each payment's outcome, including a payment that failed at the merchant or terminal while the account was debited. If several match, list them and ask which; if none, widen the date once, then say nothing was found.",
  schema: findInput,
  async run(input: z.infer<typeof findInput>, ctx: ToolCtx, _rules: Rules): Promise<ToolResult> {
    const { sql } = ctx;
    let rows: PaymentRow[] = await sql<PaymentRow[]>`
      select * from payments where holder_id = ${ctx.user!.business_id}
        ${input.amount != null ? sql`and amount = ${input.amount}` : sql``}
        ${input.channel ? sql`and channel = ${input.channel}` : sql``}
        ${input.card_last4 ? sql`and card_last4 = ${input.card_last4}` : sql``}
        ${input.merchant ? sql`and merchant_name ilike ${"%" + input.merchant + "%"}` : sql``}
      order by at desc limit 20`;
    if (input.on) {
      const target = new Date(`${input.on}T12:00:00Z`).getTime();
      rows = rows.filter((r) => Math.abs(new Date(r.at).getTime() - target) < 3 * 86_400_000);
    }
    const items = rows.slice(0, 5).map(paymentView);
    await audit(ctx, { kind: "lookup", tool: "find_payments", summary: `find_payments · ${items.length === 1 ? `${items[0].id} · ${items[0].amount}` : `${items.length} found`}`, input, result: items });
    return { ok: true, data: items.length ? { payments: items } : { payments: [], note: "Nothing matches. Widen the date once; then say nothing was found and ask for more detail." } };
  },
};

const reversalInput = z.object({ payment_id: z.string().describe("The payment's id from find_payments, e.g. PAY-61001") });

async function loadOwn(ctx: ToolCtx, id: string): Promise<PaymentRow | null> {
  const [p] = await ctx.sql<PaymentRow[]>`select * from payments where id = ${id.trim().toUpperCase()} and holder_id = ${ctx.user!.business_id}`;
  return p ?? null;
}

export const getReversalStatus = {
  name: "get_reversal_status",
  tier: 1 as Tier,
  description:
    "For a payment that failed while the account was debited: whether it has been reversed (with the date), a reversal is in progress, or there is none yet, and how that compares with the reversal window the bank works to for that channel (a target, not a guarantee).",
  schema: reversalInput,
  async run(input: z.infer<typeof reversalInput>, ctx: ToolCtx, rules: Rules): Promise<ToolResult> {
    const p = await loadOwn(ctx, input.payment_id);
    if (!p) return refuse(ctx, "get_reversal_status", input, "No payment with that id on this account.", "payment not found");
    const [r] = await ctx.sql<{ reference: string; status: string; requested_at: Date; completed_at: Date | null; automatic: boolean }[]>`
      select reference, status, requested_at, completed_at, automatic from reversals where payment_id = ${p.id}`;
    const win = windowRule(p);
    const hours = rules.num(win, 72);
    await ruleRead(ctx, rules, win);
    const ageH = (ctx.now.getTime() - new Date(p.at).getTime()) / 3_600_000;
    const data = {
      payment: paymentView(p),
      reversal: r
        ? { reference: r.reference, status: r.status === "completed" ? "Reversed" : r.status === "awaiting_approval" ? "Awaiting approval" : "In progress", ...(r.completed_at ? { reversed_on: dateTime(new Date(r.completed_at)) } : { requested: dateTime(new Date(r.requested_at)) }) }
        : { status: "No reversal yet" },
      window: `${hours} hours`,
      hours_since_payment: Math.round(ageH),
      past_window: !r && ageH > hours,
    };
    await audit(ctx, { kind: "lookup", tool: "get_reversal_status", summary: `get_reversal_status · ${p.id} · ${r ? (r.status === "completed" ? "reversed" : r.status.replace("_", " ")) : `none${data.past_window ? " · past window" : ""}`}`, input, result: data });
    return { ok: true, data };
  },
};

const CAP: Record<string, string> = { USD: "reversal_cap_usd", GBP: "reversal_cap_gbp", NGN: "reversal_cap_ngn" };

export const requestReversal = {
  name: "request_reversal",
  tier: 3 as Tier,
  identity: "stronger" as const,
  description:
    "Request a reversal for a payment that failed at the merchant or terminal while the account was debited, when no automatic reversal has arrived and the window has passed. Needs the stronger check and the customer's yes. A payment that actually succeeded can't be reversed this way. Above the cap, or with a dispute already open on it: escalate instead. Past the window, the breach is logged for staff.",
  schema: reversalInput,
  async run(input: z.infer<typeof reversalInput>, ctx: ToolCtx, rules: Rules): Promise<ToolResult> {
    const T = "request_reversal";
    const user = ctx.user!;
    const p = await loadOwn(ctx, input.payment_id);
    if (!p) return refuse(ctx, T, input, "No payment with that id on this account.", "payment not found");
    if (p.outcome !== "failed_debited") {
      return refuse(ctx, T, input, p.outcome === "successful" ? "The records show this payment succeeded, so there's nothing to reverse. Say so with the evidence; if the merchant denies receiving it, offer to trace it." : "Nothing was debited for this payment.", `payment ${p.outcome === "successful" ? "succeeded" : "not debited"}`);
    }
    const [existing] = await ctx.sql<{ reference: string; status: string }[]>`select reference, status from reversals where payment_id = ${p.id}`;
    if (existing) {
      await audit(ctx, { kind: "refusal", tool: T, summary: `${T} · refused: already ${existing.status === "completed" ? "reversed" : "requested"} ${existing.reference}`, input, refusal_reason: "Duplicate reversal" });
      return { ok: false, reference: existing.reference, reason: existing.status === "completed" ? `This payment has already been reversed (${existing.reference}). Show that entry.` : `A reversal is already under way (${existing.reference}). If it hasn't arrived, escalate; don't request another.` };
    }
    const [dispute] = await ctx.sql<{ reference: string }[]>`
      select d.reference from disputes d join transactions t on t.id = d.transaction_id
      where t.holder_id = ${user.business_id} and t.amount = ${p.amount} and abs(extract(epoch from (t.at - ${p.at}))) < 3600`;
    if (dispute) return refuse(ctx, T, input, `A dispute is already open on this payment (${dispute.reference}). Escalate rather than request a reversal.`, "dispute already open");
    const limit = rules.num("recall_limit", 3);
    const [{ n }] = await ctx.sql<{ n: number }[]>`
      select ((select count(*) from reversals where holder_id = ${user.business_id} and not automatic and requested_at > ${new Date(ctx.now.getTime() - 30 * 86_400_000)})
            + (select count(*) from recalls where business_id = ${user.business_id} and created_at > ${new Date(ctx.now.getTime() - 30 * 86_400_000)}))::int as n`;
    if (n >= limit) return refuse(ctx, T, input, `${limit} recalls or reversal requests in 30 days; another needs a person to review it. Say so without accusing them; escalate.`, "reversal limit reached");
    const capId = CAP[p.currency];
    const cap = rules.num(capId, Infinity);
    await ruleRead(ctx, rules, capId, `Reversal cap (${p.currency})`);
    const amount = money(p.amount, p.currency);
    const capText = money(cap, p.currency).replace(/\.00$/, "");
    if (Number(p.amount) > cap) return refuse(ctx, T, input, `${amount} is above the ${capText} reversal cap, so a person must request it. Escalate with the payment details.`, `above cap ${capText}`);
    const win = windowRule(p);
    const hours = rules.num(win, 72);
    const pastWindow = (ctx.now.getTime() - new Date(p.at).getTime()) / 3_600_000 > hours;
    const waiting = await confirmFirst(
      ctx, T, p.id, `reversal on ${p.id}`,
      `Request a reversal of the ${amount} debited for the failed ${p.channel} payment at ${p.merchant_name}?`,
      "The money should come back to your account; the bank works to the reversal window, but I can't promise the exact date.",
    );
    if (waiting) return waiting;
    const [{ seq }] = await ctx.sql<{ seq: string }[]>`select nextval('reversal_seq')::text as seq`;
    const reference = `REV-${seq}`;
    await ctx.sql`insert into reversals (reference, payment_id, holder_id, conversation_id, amount, currency, status, breach, requested_at)
      values (${reference}, ${p.id}, ${user.business_id}, ${ctx.conv.id}, ${p.amount}, ${p.currency}, 'requested', ${pastWindow}, ${ctx.now})`;
    await audit(ctx, { kind: "action", tool: T, summary: `${T} · ${p.id} · ${reference} requested${pastWindow ? " · breach logged" : ""}`, input, result: { reference, amount, breach: pastWindow } });
    await watch(ctx.sql, { conversationId: ctx.conv.id, holderId: user.business_id, userId: user.id, kind: "reversal", reference, label: `reversal of ${amount} for the failed payment at ${p.merchant_name}`, status: "requested", expectedBy: new Date(ctx.now.getTime() + hours * 3_600_000) });
    return {
      ok: true,
      reference,
      data: {
        reference,
        amount,
        window: `${hours} hours`,
        ...(pastWindow ? { breach_logged: true, note: "The reversal window had passed, so the breach is logged for staff. Escalate with trigger reversal_past_window so the team chases it." } : {}),
        say: "Give the reference and say the bank works to the reversal window; don't promise a date.",
      },
    };
  },
};
