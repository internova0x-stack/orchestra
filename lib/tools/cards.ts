import { z } from "zod";
import { audit, confirmFirst, refuse, ruleRead, type Tier, type ToolCtx, type ToolResult } from "../toolkit.ts";
import type { Rules } from "../rules.ts";
import { money, statusLabel } from "../format.ts";
import { dateTime } from "../time.ts";

// Use case 1: card issues. Look up a card, freeze it (tier 2), order a replacement (tier 3).

interface CardRow { id: string; last4: string; status: string; currency: string; daily_limit: string | null; delivery_address: string | null }

const FEE_RULE: Record<string, string> = { USD: "replacement_fee_usd", GBP: "replacement_fee_gbp", NGN: "replacement_fee_ngn" };

/** The address on file, shortened so the full address isn't repeated in chat. */
const maskAddress = (a: string | null) => {
  if (!a) return "no address on file";
  const parts = a.split(",").map((x) => x.trim());
  return parts.length > 1 ? `•••, ${parts.slice(-2).join(", ")}` : "•••";
};

async function findCard(ctx: ToolCtx, last4?: string): Promise<CardRow | null> {
  const rows = await ctx.sql<CardRow[]>`
    select id, last4, status, currency, daily_limit, delivery_address from cards
    where holder_id = ${ctx.user!.business_id} and status <> 'replaced'
      ${last4 ? ctx.sql`and last4 = ${last4}` : ctx.sql``}
    order by created_at desc`;
  return rows[0] ?? null;
}

const cardInput = z.object({ last4: z.string().regex(/^\d{4}$/).optional().describe("The card's last 4 digits, if the customer has more than one card") });

export const getCard = {
  name: "get_card",
  tier: 1 as Tier,
  description:
    "The verified customer's card: last 4 digits, status (Active, Frozen), daily spending limit, and recent declines with the reason recorded for each. Use it for lost or stolen cards, declined payments, replacements and PIN or activation questions. Never ask for or accept the full card number, PIN or CVV.",
  schema: cardInput,
  async run(input: z.infer<typeof cardInput>, ctx: ToolCtx, _rules: Rules): Promise<ToolResult> {
    const card = await findCard(ctx, input.last4);
    if (!card) {
      await audit(ctx, { kind: "lookup", tool: "get_card", summary: "get_card · no card found", input });
      return { ok: true, data: { found: false, note: "No card on this account matches. Ask which card, by its last 4 digits." } };
    }
    const declines = await ctx.sql<{ descriptor: string; merchant_name: string | null; amount: string; currency: string; decline_reason: string | null; at: Date }[]>`
      select descriptor, merchant_name, amount, currency, decline_reason, at from transactions
      where card_id = ${card.id} and status = 'declined' and at > ${new Date(ctx.now.getTime() - 14 * 86_400_000)}
      order by at desc limit 5`;
    const data = {
      card: `•••• ${card.last4}`,
      status: statusLabel(card.status),
      daily_limit: card.daily_limit ? money(card.daily_limit, card.currency) : null,
      recent_declines: declines.map((d) => ({ when: dateTime(new Date(d.at)), merchant: d.merchant_name ?? d.descriptor, amount: money(d.amount, d.currency), reason: d.decline_reason })),
    };
    await audit(ctx, { kind: "lookup", tool: "get_card", summary: `get_card · •••• ${card.last4} · ${card.status}${declines.length ? ` · ${declines.length} decline${declines.length === 1 ? "" : "s"}` : ""}`, input, result: data });
    return { ok: true, data };
  },
};

export const freezeCard = {
  name: "freeze_card",
  tier: 2 as Tier,
  description:
    "Freeze the verified customer's card so no new payments go through, for a lost or stolen card or suspected fraud. Easy to undo in the app. Asks the customer to confirm first. Afterwards ask whether any recent transactions aren't theirs.",
  schema: cardInput,
  async run(input: z.infer<typeof cardInput>, ctx: ToolCtx, _rules: Rules): Promise<ToolResult> {
    const T = "freeze_card";
    const card = await findCard(ctx, input.last4);
    if (!card) return refuse(ctx, T, input, "No card on this account matches. Ask which card, by its last 4 digits.", "card not found");
    if (card.status === "frozen") {
      await audit(ctx, { kind: "action", tool: T, summary: `${T} · •••• ${card.last4} · already frozen`, input });
      return { ok: true, reference: `FRZ-${card.last4}`, data: { already_frozen: true, card: `•••• ${card.last4}` } };
    }
    const waiting = await confirmFirst(ctx, T, card.id, `freeze card •••• ${card.last4}`, `Freeze the card ending ${card.last4}?`, "No new payments will go through on it until it's unfrozen in the app. Payments already made aren't affected.");
    if (waiting) return waiting;
    await ctx.sql`update cards set status = 'frozen' where id = ${card.id}`;
    await audit(ctx, { kind: "action", tool: T, summary: `${T} · •••• ${card.last4} · frozen`, input });
    return { ok: true, reference: `FRZ-${card.last4}`, data: { frozen: true, card: `•••• ${card.last4}`, note: "Ask whether any recent transactions aren't theirs; if so, look at them (use case 2)." } };
  },
};

const replacementInput = cardInput.extend({ reason: z.enum(["lost", "stolen", "damaged", "expired"]).describe("Why a new card is needed") });

export const orderReplacement = {
  name: "order_replacement",
  tier: 3 as Tier,
  identity: "stronger" as const,
  description:
    "Order a replacement card to the address already on file; the old card stops working. Needs the stronger check and the customer's yes. State any fee and the delivery address on file (shortened) before confirming. If the address on file is wrong or disputed, don't order: hand off.",
  schema: replacementInput,
  async run(input: z.infer<typeof replacementInput>, ctx: ToolCtx, rules: Rules): Promise<ToolResult> {
    const T = "order_replacement";
    const user = ctx.user!;
    const card = await findCard(ctx, input.last4);
    if (!card) return refuse(ctx, T, input, "No card on this account matches. Ask which card, by its last 4 digits.", "card not found");
    if (!card.delivery_address) return refuse(ctx, T, input, "There's no address on file to send a card to. Hand off.", "no address on file");
    const existing = await ctx.sql<{ reference: string }[]>`select reference from card_replacements where card_id = ${card.id}`;
    if (existing[0]) {
      await audit(ctx, { kind: "refusal", tool: T, summary: `${T} · refused: already ordered ${existing[0].reference}`, input, refusal_reason: "Duplicate replacement" });
      return { ok: false, reference: existing[0].reference, reason: `A replacement for this card is already on its way (${existing[0].reference}). Give that reference; don't order another.` };
    }
    const limit = rules.num("replacement_limit", 2);
    const [{ n }] = await ctx.sql<{ n: number }[]>`
      select count(*)::int as n from card_replacements where holder_id = ${user.business_id} and created_at > ${new Date(ctx.now.getTime() - 365 * 86_400_000)}`;
    if (n >= limit) return refuse(ctx, T, input, `${limit} replacement cards have been ordered in the last 12 months, so another needs a person to review it. Say so without accusing them; hand off.`, "replacement limit reached");
    const feeId = FEE_RULE[card.currency];
    const fee = rules.num(feeId, 0);
    await ruleRead(ctx, rules, feeId);
    const feeText = money(fee, card.currency);
    const waiting = await confirmFirst(
      ctx, T, card.id, `replacement for card •••• ${card.last4}`,
      `Order a replacement for the card ending ${card.last4}, to the address on file (${maskAddress(card.delivery_address)})?`,
      `The old card stops working straight away. ${fee > 0 ? `There's a ${feeText} fee.` : "There's no fee."} ${rules.get("card_delivery")?.value ?? ""}`.trim(),
    );
    if (waiting) return waiting;
    const [{ seq }] = await ctx.sql<{ seq: string }[]>`select nextval('replacement_seq')::text as seq`;
    const reference = `CRD-${seq}`;
    await ctx.sql`insert into card_replacements (reference, card_id, holder_id, conversation_id, fee, currency)
      values (${reference}, ${card.id}, ${user.business_id}, ${ctx.conv.id}, ${fee}, ${card.currency})`;
    await ctx.sql`update cards set status = 'replaced' where id = ${card.id}`;
    await audit(ctx, { kind: "action", tool: T, summary: `${T} · •••• ${card.last4} · ${reference} ordered`, input, result: { reference, fee: feeText } });
    return { ok: true, reference, data: { reference, fee: feeText, sent_to: maskAddress(card.delivery_address), delivery: rules.get("card_delivery")?.value, note: "The old card no longer works. Explain activation and setting a PIN in the app when it arrives." } };
  },
};
