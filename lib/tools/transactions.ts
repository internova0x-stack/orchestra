import { z } from "zod";
import { watch } from "../updates.ts";
import { audit, confirmFirst, refuse, ruleRead, type Tier, type ToolCtx, type ToolResult } from "../toolkit.ts";
import type { Rules } from "../rules.ts";
import { money, statusLabel } from "../format.ts";
import { dateTime } from "../time.ts";

// Use case 2: "What is this charge?", duplicates, unrecognised payments, and opening a dispute.

interface TxRow {
  id: string; card_id: string | null; descriptor: string; merchant_name: string | null; location: string | null;
  channel: string; amount: string; currency: string; status: string; decline_reason: string | null; at: Date;
}

const listInput = z.object({
  merchant: z.string().optional().describe("Part of the merchant's name as it appears on the statement"),
  amount: z.number().optional(),
  days: z.number().int().min(1).max(120).optional().describe("How far back to look, in days (default 30)"),
});

export const listTransactions = {
  name: "list_transactions",
  tier: 1 as Tier,
  description:
    "Recent card, POS, ATM and online transactions on the verified customer's account: the statement name, the merchant's full name, location and channel, amount, and whether it is Pending (a hold) or Settled. Flags a possible duplicate (same merchant and amount within a day). If several match, show them and ask which.",
  schema: listInput,
  async run(input: z.infer<typeof listInput>, ctx: ToolCtx, _rules: Rules): Promise<ToolResult> {
    const days = input.days ?? 30;
    const rows = await ctx.sql<TxRow[]>`
      select id, card_id, descriptor, merchant_name, location, channel, amount, currency, status, decline_reason, at
      from transactions where holder_id = ${ctx.user!.business_id} and at > ${new Date(ctx.now.getTime() - days * 86_400_000)}
        ${input.merchant ? ctx.sql`and (descriptor ilike ${"%" + input.merchant + "%"} or merchant_name ilike ${"%" + input.merchant + "%"})` : ctx.sql``}
        ${input.amount != null ? ctx.sql`and amount = ${input.amount}` : ctx.sql``}
      order by at desc limit 12`;
    const items = rows.map((r) => {
      const twin = rows.find((o) => o.id !== r.id && o.descriptor === r.descriptor && o.amount === r.amount && Math.abs(new Date(o.at).getTime() - new Date(r.at).getTime()) < 86_400_000 && o.status !== "declined");
      return {
        id: r.id,
        when: dateTime(new Date(r.at)),
        statement_name: r.descriptor,
        merchant: r.merchant_name,
        location: r.location,
        channel: r.channel,
        amount: money(r.amount, r.currency),
        status: statusLabel(r.status),
        ...(r.decline_reason ? { decline_reason: r.decline_reason } : {}),
        ...(twin && r.status !== "declined" ? { possible_duplicate_of: twin.id, note: twin.status === "pending" || r.status === "pending" ? "One of the pair is a pending hold, which drops off if the merchant doesn't collect it." : "Both are settled." } : {}),
      };
    });
    await audit(ctx, { kind: "lookup", tool: "list_transactions", summary: `list_transactions · ${items.length} found${input.merchant ? ` for "${input.merchant}"` : ""}`, input, result: items });
    return { ok: true, data: { transactions: items } };
  },
};

const disputeInput = z.object({
  transaction_id: z.string().describe("The transaction's id from list_transactions, e.g. TX-90021"),
  reason: z.enum(["not_mine", "duplicate", "not_received", "wrong_amount", "other"]).describe("Why the customer disputes it"),
});

const CAP: Record<string, string> = { USD: "dispute_cap_usd", GBP: "dispute_cap_gbp", NGN: "dispute_cap_ngn" };

export const openDispute = {
  name: "open_dispute",
  tier: 2 as Tier,
  description:
    "Open a dispute on one settled transaction the customer doesn't recognise, was charged twice for, or didn't receive. Asks the customer to confirm first. A pending hold can't be disputed (it drops off by itself). Above the cap, past the filing window or over the customer's limit: escalate instead. You never decide the outcome or say who is liable. If several fraudulent transactions suggest account takeover, freeze the card and hand off urgently.",
  schema: disputeInput,
  async run(input: z.infer<typeof disputeInput>, ctx: ToolCtx, rules: Rules): Promise<ToolResult> {
    const T = "open_dispute";
    const user = ctx.user!;
    const id = input.transaction_id.trim().toUpperCase();
    const [tx] = await ctx.sql<TxRow[]>`
      select id, card_id, descriptor, merchant_name, location, channel, amount, currency, status, decline_reason, at
      from transactions where id = ${id} and holder_id = ${user.business_id}`;
    if (!tx) return refuse(ctx, T, input, "No transaction with that id on this account.", "transaction not found");
    if (tx.status === "pending") return refuse(ctx, T, input, "This is a pending hold, not a settled charge, so it can't be disputed. Explain that it drops off if the merchant doesn't collect it (see the Cards rules).", "pending hold");
    if (tx.status !== "settled") return refuse(ctx, T, input, `This transaction is ${tx.status}, so there's nothing to dispute.`, `transaction ${tx.status}`);
    const existing = await ctx.sql<{ reference: string }[]>`select reference from disputes where transaction_id = ${id}`;
    if (existing[0]) {
      await audit(ctx, { kind: "refusal", tool: T, summary: `${T} · refused: already open ${existing[0].reference}`, input, refusal_reason: "Duplicate dispute" });
      return { ok: false, reference: existing[0].reference, reason: `A dispute is already open on this transaction (${existing[0].reference}). Give that reference; a second can't be opened.` };
    }
    const window = rules.num("dispute_window", 120);
    if (ctx.now.getTime() - new Date(tx.at).getTime() > window * 86_400_000) {
      return refuse(ctx, T, input, `This transaction is older than the ${window}-day filing window. Escalate for staff to review.`, "outside the filing window");
    }
    const limit = rules.num("dispute_limit", 3);
    const [{ n }] = await ctx.sql<{ n: number }[]>`
      select count(*)::int as n from disputes where holder_id = ${user.business_id} and created_at > ${new Date(ctx.now.getTime() - 90 * 86_400_000)}`;
    if (n >= limit) return refuse(ctx, T, input, `${limit} disputes have been opened in the last 90 days, so another needs a person to review it. Say so without accusing them; escalate.`, "dispute limit reached");
    const capId = CAP[tx.currency];
    const cap = rules.num(capId, Infinity);
    await ruleRead(ctx, rules, capId, `Dispute cap (${tx.currency})`);
    const amount = money(tx.amount, tx.currency);
    if (Number(tx.amount) > cap) {
      return refuse(ctx, T, input, `${amount} is above the ${money(cap, tx.currency).replace(/\.00$/, "")} dispute cap, so a person must open it. Escalate with the transaction details.`, `above cap ${money(cap, tx.currency).replace(/\.00$/, "")}`);
    }
    const waiting = await confirmFirst(
      ctx, T, id, `dispute on ${id}`,
      `Open a dispute on the ${amount} payment to ${tx.merchant_name ?? tx.descriptor} on ${dateTime(new Date(tx.at)).split(",")[0]}?`,
      `${rules.get("dispute_process")?.value ?? "The bank investigates with the merchant."}`,
    );
    if (waiting) return waiting;
    const [{ seq }] = await ctx.sql<{ seq: string }[]>`select nextval('dispute_seq')::text as seq`;
    const reference = `DSP-${seq}`;
    await ctx.sql`insert into disputes (reference, transaction_id, holder_id, conversation_id, amount, currency, reason)
      values (${reference}, ${id}, ${user.business_id}, ${ctx.conv.id}, ${tx.amount}, ${tx.currency}, ${input.reason})`;
    await audit(ctx, { kind: "action", tool: T, summary: `${T} · ${id} · ${reference} opened`, input, result: { reference, amount } });
    await watch(ctx.sql, { conversationId: ctx.conv.id, holderId: user.business_id, userId: user.id, kind: "dispute", reference, label: `dispute on the ${amount} payment to ${tx.merchant_name ?? tx.descriptor}`, status: "open", expectedBy: new Date(ctx.now.getTime() + 14 * 86_400_000) });
    return { ok: true, reference, data: { reference, transaction: id, amount, process: rules.get("dispute_process")?.value, note: "Give the reference and the expected timeline; don't predict the outcome or say who is liable." } };
  },
};
