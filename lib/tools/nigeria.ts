import { z } from "zod";
import { audit, confirmFirst, refuse, ruleRead, type Tier, type ToolCtx, type ToolResult } from "../toolkit.ts";
import type { Rules } from "../rules.ts";
import { money } from "../format.ts";
import { dateTime } from "../time.ts";

// Use case 14: airtime, data and bill payments. Use case 16: USSD sessions and agent banking.

interface BillRow { id: string; biller: string; kind: string; customer_ref: string; amount: string; currency: string; status: string; token: string | null; provider_ref: string | null; at: Date; refund_reference: string | null }

const STATUS: Record<string, string> = { delivered: "Delivered", pending: "Pending at the provider", failed_at_provider: "Failed at the provider", refunded: "Refunded" };

/** The phone or meter number, shortened. */
const maskRef = (r: string) => `•••• ${r.replace(/\s/g, "").slice(-4)}`;

const findInput = z.object({
  amount: z.number().optional(),
  kind: z.enum(["airtime", "data", "electricity", "tv", "water"]).optional(),
  number: z.string().optional().describe("The last digits of the phone, meter or account number paid for"),
});

export const getBillPaymentStatus = {
  name: "get_bill_payment_status",
  tier: 1 as Tier,
  description:
    "Airtime, data and bill payments on the verified customer's account: the biller, the number paid for (shortened), the amount, and the provider's delivery status: delivered (with the token or reference), pending, failed at the provider, or refunded.",
  schema: findInput,
  async run(input: z.infer<typeof findInput>, ctx: ToolCtx, rules: Rules): Promise<ToolResult> {
    const found = await ctx.sql<BillRow[]>`
      select * from bill_payments where holder_id = ${ctx.user!.business_id}
        ${input.amount != null ? ctx.sql`and amount = ${input.amount}` : ctx.sql``}
        ${input.kind ? ctx.sql`and kind = ${input.kind}` : ctx.sql``}
      order by at desc limit 10`;
    const rows: BillRow[] = input.number ? found.filter((r) => r.customer_ref.replace(/\D/g, "").endsWith(input.number!.replace(/\D/g, ""))) : [...found];
    const items = rows.slice(0, 5).map((b) => ({
      id: b.id, biller: b.biller, paid_for: maskRef(b.customer_ref), amount: money(b.amount, b.currency), when: dateTime(new Date(b.at)),
      status: STATUS[b.status] ?? b.status,
      ...(b.token ? { token: b.token } : {}), ...(b.provider_ref ? { provider_reference: b.provider_ref } : {}),
      ...(b.refund_reference ? { refund: b.refund_reference } : {}),
      ...(b.status === "pending" ? { note: rules.get("bills_pending")?.value } : {}),
      ...(b.status === "failed_at_provider" ? { note: rules.get("bills_failed")?.value } : {}),
    }));
    await audit(ctx, { kind: "lookup", tool: "get_bill_payment_status", summary: `get_bill_payment_status · ${items.length === 1 ? `${items[0].id} · ${String(items[0].status).toLowerCase()}` : `${items.length} found`}`, input, result: items });
    return { ok: true, data: items.length ? { payments: items } : { payments: [], note: "No matching bill or airtime payment." } };
  },
};

const CAP: Record<string, string> = { NGN: "bill_refund_cap_ngn", USD: "bill_refund_cap_usd", GBP: "bill_refund_cap_gbp" };

export const refundBillPayment = {
  name: "refund_bill_payment",
  tier: 3 as Tier,
  identity: "stronger" as const,
  description:
    "Refund an airtime, data or bill payment that failed at the provider. Needs the stronger check and the customer's yes. Not for a delivered purchase (if the provider shows delivered but the customer has nothing, or they entered the wrong number, hand off). Above the cap: hand off. Once per payment.",
  schema: z.object({ payment_id: z.string().describe("The bill payment's id, e.g. BP-30101") }),
  async run(input: { payment_id: string }, ctx: ToolCtx, rules: Rules): Promise<ToolResult> {
    const T = "refund_bill_payment";
    const user = ctx.user!;
    const [b] = await ctx.sql<BillRow[]>`select * from bill_payments where id = ${input.payment_id.trim().toUpperCase()} and holder_id = ${user.business_id}`;
    if (!b) return refuse(ctx, T, input, "No bill or airtime payment with that id on this account.", "payment not found");
    if (b.refund_reference) {
      await audit(ctx, { kind: "refusal", tool: T, summary: `${T} · refused: already refunded ${b.refund_reference}`, input, refusal_reason: "Duplicate refund" });
      return { ok: false, reference: b.refund_reference, reason: `This payment was already refunded (${b.refund_reference}).` };
    }
    if (b.status === "delivered") return refuse(ctx, T, input, "The provider shows this as delivered, so it can't be refunded here. If the customer has nothing, or entered the wrong number, hand off (trigger bill_payment_problem).", "delivered");
    if (b.status === "pending") return refuse(ctx, T, input, `It's still pending at the provider. ${rules.get("bills_pending")?.value ?? ""}`, "still pending");
    const capId = CAP[b.currency];
    const cap = rules.num(capId, 0);
    await ruleRead(ctx, rules, capId);
    const amount = money(b.amount, b.currency);
    if (Number(b.amount) > cap) return refuse(ctx, T, input, `${amount} is above the ${money(cap, b.currency).replace(/\.00$/, "")} refund cap; hand off.`, `above cap ${money(cap, b.currency).replace(/\.00$/, "")}`);
    const waiting = await confirmFirst(ctx, T, b.id, `refund of ${b.id}`, `Refund the ${amount} paid for ${b.biller} to ${maskRef(b.customer_ref)}?`, "The provider shows it failed, so the money comes back to your account.");
    if (waiting) return waiting;
    const [{ seq }] = await ctx.sql<{ seq: string }[]>`select nextval('bill_refund_seq')::text as seq`;
    const reference = `BRF-${seq}`;
    await ctx.sql`update bill_payments set status = 'refunded', refund_reference = ${reference} where id = ${b.id}`;
    await audit(ctx, { kind: "action", tool: T, summary: `${T} · ${b.id} · ${amount} refunded`, input, result: { reference } });
    return { ok: true, reference, data: { reference, refunded: amount, note: "Say it's been refunded to their account, with the reference." } };
  },
};

export const getUssdSession = {
  name: "get_ussd_session",
  tier: 1 as Tier,
  description:
    "A USSD session or an agent-banking transaction on the verified customer's account: the code or the agent (name, ID, location), what was attempted, the amount and the outcome. A USSD debit without value continues in the matching flow (a transfer or a failed payment); any cash problem at an agent location goes to the team, who contact the agent.",
  schema: z.object({ amount: z.number().optional(), kind: z.enum(["ussd", "agent"]).optional() }),
  async run(input: { amount?: number; kind?: "ussd" | "agent" }, ctx: ToolCtx, _rules: Rules): Promise<ToolResult> {
    const rows = await ctx.sql<{ id: string; kind: string; code: string | null; agent_name: string | null; agent_id: string | null; location: string | null; action: string; amount: string; currency: string; outcome: string; at: Date }[]>`
      select * from ussd_sessions where holder_id = ${ctx.user!.business_id}
        ${input.amount != null ? ctx.sql`and amount = ${input.amount}` : ctx.sql``}
        ${input.kind ? ctx.sql`and kind = ${input.kind}` : ctx.sql``}
      order by at desc limit 5`;
    const items = rows.map((u) => ({
      id: u.id, type: u.kind === "ussd" ? "USSD session" : "Agent transaction", when: dateTime(new Date(u.at)),
      ...(u.code ? { code: u.code } : {}), ...(u.agent_name ? { agent: `${u.agent_name} (${u.agent_id}), ${u.location}` } : {}),
      attempted: u.action, amount: money(u.amount, u.currency), outcome: u.outcome,
      next: u.kind === "agent" ? "Cash at an agent: capture the agent's ID, the amount and the time (above) and hand off (trigger agent_cash_problem); a person contacts the agent." : "A USSD debit without value: treat it as the matching transfer or failed payment, and hand off if there's no record of a reversal.",
    }));
    await audit(ctx, { kind: "lookup", tool: "get_ussd_session", summary: `get_ussd_session · ${items.length === 1 ? `${items[0].id} · ${items[0].type.toLowerCase()}` : `${items.length} found`}`, input, result: items });
    return { ok: true, data: items.length ? { sessions: items } : { sessions: [], note: "No matching USSD session or agent transaction." } };
  },
};
