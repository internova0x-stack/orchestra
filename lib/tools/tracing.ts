import { z } from "zod";
import { audit, refuse, type Tier, type ToolCtx, type ToolResult } from "../toolkit.ts";
import type { Rules } from "../rules.ts";
import { dateTime } from "../time.ts";
import { disputesOn, paymentView, type PaymentRow } from "./payments.ts";
import { bank } from "../bank/index.ts";

// Use case 9: transaction ID to payment match. Use case 11: where a payment broke and who owns the fix.

const STAGES = ["authorization", "capture", "settlement", "payout"] as const;
const LABEL: Record<string, string> = { authorization: "Authorisation", capture: "Capture", settlement: "Settlement", payout: "Payout to the merchant" };

/** The PRD's fault table: the first stage that failed or never happened names the responsible party. */
const FAULT: Record<string, { party: string; tell: string }> = {
  authorization: { party: "Card issuer", tell: "The payment was refused before any money moved; give the decline reason." },
  capture: { party: "Merchant's integration", tell: "The hold will drop off; the merchant never collected the payment and must retry." },
  settlement: { party: "Processor or acquirer", tell: "The money left the account and is with the processor; the bank raises it with them." },
  payout: { party: "Platform or bank hold", tell: "The money reached the merchant's provider; the merchant should check for a payout hold." },
};

const idInput = z.object({ transaction_id: z.string().describe("The transaction or payment ID the customer gave, e.g. PAY-62003") });

/** The payment if it's on this customer's account; `elsewhere` if the bank says the id is another holder's (nothing more). */
async function own(ctx: ToolCtx, id: string): Promise<{ payment: PaymentRow | null; elsewhere: boolean }> {
  return bank(ctx.sql).getPayment(ctx.user!.business_id, id.trim().toUpperCase());
}

export const getPaymentById = {
  name: "get_payment_by_id",
  tier: 1 as Tier,
  description:
    "Find the exact payment from a transaction or payment ID the customer gives (often from a screenshot or receipt): merchant, processor, channel, amount, outcome and any dispute. Only payments on the verified customer's own account. Without an ID, use find_payments. Confirm the match with the customer before tracing it.",
  schema: idInput,
  async run(input: z.infer<typeof idInput>, ctx: ToolCtx, _rules: Rules): Promise<ToolResult> {
    const { payment, elsewhere } = await own(ctx, input.transaction_id);
    if (!payment) {
      if (elsewhere) {
        // It exists, but not on this account: share nothing about it and hand it to a person.
        await audit(ctx, { kind: "refusal", tool: "get_payment_by_id", summary: "get_payment_by_id · refused: not on this account", input, refusal_reason: "ID belongs to another customer" });
        return { ok: false, reason: "That ID is not on this customer's account. Say you can't find it on their account and share nothing else about it; don't say or hint that it belongs to someone else. Escalate (records_missing_or_contradictory) so staff can look into it." };
      }
      await audit(ctx, { kind: "lookup", tool: "get_payment_by_id", summary: "get_payment_by_id · not found", input });
      return { ok: true, data: { found: false, note: "No payment with that ID. Ask them to check it, or search by amount, date and card's last 4 digits (find_payments)." } };
    }
    const data = { ...paymentView(payment), processor: payment.processor, disputes: await disputesOn(ctx, payment) };
    await audit(ctx, { kind: "lookup", tool: "get_payment_by_id", summary: `get_payment_by_id · ${payment.id} · ${data.amount} at ${payment.merchant_name}`, input, result: data });
    return { ok: true, data };
  },
};

export const getPaymentTimeline = {
  name: "get_payment_timeline",
  tier: 1 as Tier,
  description:
    "Each stage of a confirmed payment (authorisation, capture, settlement, payout) with its status, time and the party that reported it, the first stage that failed or never happened, and the responsible party from the bank's fault table, with the evidence. If stages conflict or are out of order, it says so: then you can't tell, so don't guess; escalate.",
  schema: idInput,
  async run(input: z.infer<typeof idInput>, ctx: ToolCtx, _rules: Rules): Promise<ToolResult> {
    const { payment, elsewhere } = await own(ctx, input.transaction_id);
    if (!payment) return refuse(ctx, "get_payment_timeline", input, elsewhere ? "That payment isn't on this customer's account. Share nothing about it; escalate." : "No payment with that ID on this account.", "payment not found");
    const events = await bank(ctx.sql).getPaymentEvents(payment.holder_id, payment.id);
    const timeline = events.map((e) => ({ stage: LABEL[e.stage], status: e.status === "ok" ? "Done" : "Failed", time: dateTime(new Date(e.at)), reported_by: e.reported_by, ...(e.detail ? { detail: e.detail } : {}) }));

    // Conflicts: two parties reporting different statuses for one stage, or a later stage before an earlier one.
    const byStage = new Map<string, Set<string>>();
    for (const e of events) byStage.set(e.stage, (byStage.get(e.stage) ?? new Set()).add(e.status));
    const conflicting = [...byStage.entries()].filter(([, st]) => st.size > 1).map(([stage]) => LABEL[stage]);
    let outOfOrder = false;
    for (let i = 1; i < events.length; i++) {
      if (STAGES.indexOf(events[i].stage as (typeof STAGES)[number]) < STAGES.indexOf(events[i - 1].stage as (typeof STAGES)[number])) outOfOrder = true;
    }
    let data: Record<string, unknown>;
    if (conflicting.length || outOfOrder) {
      data = { payment: payment.id, timeline, diagnosis: "Can't tell", why: conflicting.length ? `Different parties report different statuses for: ${conflicting.join(", ")}` : "The stages are out of order", note: "Say you can't tell from the records and don't guess. Escalate (records_missing_or_contradictory) with the timeline." };
    } else {
      const first = STAGES.find((s) => {
        const st = byStage.get(s);
        return !st || st.has("failed");
      });
      const lastOk = [...events].reverse().find((e) => e.status === "ok");
      data = first
        ? {
            payment: payment.id,
            timeline,
            broke_at: LABEL[first],
            how: byStage.get(first)?.has("failed") ? "failed" : "never happened",
            responsible: FAULT[first].party,
            evidence: lastOk ? `Last successful stage: ${LABEL[lastOk.stage]} at ${dateTime(new Date(lastOk.at))}, reported by ${lastOk.reported_by}. ${LABEL[first]} ${byStage.get(first)?.has("failed") ? "failed" : "is missing"}.` : `${LABEL[first]} failed.`,
            what_to_tell: FAULT[first].tell,
          }
        : { payment: payment.id, timeline, diagnosis: "Completed", evidence: "Every stage succeeded, including the payout to the merchant.", what_to_tell: "The money reached the merchant; they should check their own records." };
    }
    await audit(ctx, {
      kind: "lookup",
      tool: "get_payment_timeline",
      summary: `get_payment_timeline · ${payment.id} · ${data.diagnosis === "Can't tell" ? "conflicting timeline" : data.broke_at ? `broke at ${String(data.broke_at).toLowerCase()} · ${String(data.responsible).toLowerCase()}` : "completed"}`,
      input,
      result: data,
    });
    return { ok: true, data };
  },
};
