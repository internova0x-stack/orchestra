import { z } from "zod";
import { audit, confirmFirst, needsIdentity, refuse, ruleRead, type Tier, type ToolCtx, type ToolResult } from "../toolkit.ts";
import type { Rules } from "../rules.ts";
import { money, statusLabel } from "../format.ts";
import { dateTime } from "../time.ts";
import { bank } from "../bank/index.ts";
import type { Card, CardSettings } from "../bank/contract.ts";

// Use case 1: card issues. Look up a card, freeze it (tier 2), order a replacement (tier 3).

const FEE_RULE: Record<string, string> = { USD: "replacement_fee_usd", GBP: "replacement_fee_gbp", NGN: "replacement_fee_ngn" };

/** The address on file, shortened so the full address isn't repeated in chat. */
const maskAddress = (a: string | null) => {
  if (!a) return "no address on file";
  const parts = a.split(",").map((x) => x.trim());
  return parts.length > 1 ? `•••, ${parts.slice(-2).join(", ")}` : "•••";
};

async function findCard(ctx: ToolCtx, last4?: string): Promise<Card | null> {
  const cards = await bank(ctx.sql).listCards(ctx.user!.business_id, { last4 });
  return cards.find((c) => c.status !== "replaced") ?? null;
}

const onOff = (v: boolean) => (v ? "On" : "Off");
const SETTING_WORDS: Record<string, string> = { online_payments: "online payments", international_payments: "international payments", contactless: "contactless payments" };
const LIMIT_MAX: Record<string, string> = { USD: "card_limit_max_usd", GBP: "card_limit_max_gbp", NGN: "card_limit_max_ngn" };

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
    const declines = (await bank(ctx.sql).searchCardTransactions(ctx.user!.business_id, { card: card.id, status: "declined", since: new Date(ctx.now.getTime() - 14 * 86_400_000).toISOString() })).slice(0, 5);
    const data = {
      card: `•••• ${card.last4}`,
      status: card.status === "frozen" ? (card.frozen_by === "bank" ? "Frozen by the bank" : "Frozen (by the customer)") : statusLabel(card.status),
      settings: { online_payments: onOff(card.online_payments), international_payments: onOff(card.international_payments), contactless: onOff(card.contactless) },
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
    const done = await bank(ctx.sql).freezeCard(ctx.user!.business_id, card.id, { reference: `FRZ-${card.last4}`, requested_by: "Alexis" }, `freeze-${ctx.conv.id}-${card.id}`);
    if (!done.accepted) return refuse(ctx, T, input, "The bank didn't accept the freeze. Hand off urgently so a person freezes the card.", `bank refused: ${done.status}`);
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
    const ordered = await bank(ctx.sql).replaceCard(user.business_id, card.id, { reference, requested_by: "Alexis", reason: input.reason }, `replace-${card.id}`);
    if (!ordered.accepted) return refuse(ctx, T, input, "The bank didn't accept the replacement order. Hand off so a person orders it.", `bank refused: ${ordered.status}`);
    await ctx.sql`insert into card_replacements (reference, card_id, holder_id, conversation_id, fee, currency)
      values (${reference}, ${card.id}, ${user.business_id}, ${ctx.conv.id}, ${fee}, ${card.currency})`;
    await audit(ctx, { kind: "action", tool: T, summary: `${T} · •••• ${card.last4} · ${reference} ordered`, input, result: { reference, fee: feeText } });
    return { ok: true, reference, data: { reference, fee: feeText, sent_to: maskAddress(card.delivery_address), delivery: rules.get("card_delivery")?.value, note: "The old card no longer works. Explain activation and setting a PIN in the app when it arrives." } };
  },
};

// ---------------------------------------------------------------- card controls (Nov 23)
// Unfreezing and changing settings. Every institution configures them on the Rules screen: the switches
// action_unfreeze_card and action_change_card_settings, which steps need the one-time code, whether an open
// "not mine" dispute blocks unfreezing, whether Alexis may change the daily limit and the highest she may set.
// Making a card safer (switching a setting off, lowering the limit) never needs the code. A freeze the bank
// placed is never lifted or worked around here.

async function openFraudDispute(ctx: ToolCtx, card: Card): Promise<string | null> {
  const disputes = await ctx.sql<{ reference: string; transaction_id: string }[]>`
    select reference, transaction_id from disputes where holder_id = ${ctx.user!.business_id} and reason = 'not_mine' and status in ('open','investigating')`;
  if (!disputes.length) return null;
  const txs = await bank(ctx.sql).searchCardTransactions(ctx.user!.business_id, { card: card.id });
  const ids = new Set(txs.map((t) => t.id));
  return disputes.find((d) => ids.has(d.transaction_id))?.reference ?? null;
}

export const unfreezeCard = {
  name: "unfreeze_card",
  tier: 2 as Tier,
  description:
    "Unfreeze the verified customer's card that they froze themselves (in the app or with you), so payments go through again. Asks the customer to confirm first. Depending on the institution's rules it may need the stronger check, and it's refused while a 'not mine' dispute is open on the card. A freeze placed by the bank can't be lifted here: hand off (card_problem) without saying why the bank froze it. If the card was lost or stolen, suggest a replacement instead.",
  schema: cardInput,
  async run(input: z.infer<typeof cardInput>, ctx: ToolCtx, rules: Rules): Promise<ToolResult> {
    const T = "unfreeze_card";
    await ruleRead(ctx, rules, "card_unfreeze_stronger");
    if (rules.on("card_unfreeze_stronger")) {
      const problem = needsIdentity(2, ctx, "stronger");
      if (problem) return refuse(ctx, T, input, problem, "stronger check needed");
    }
    const card = await findCard(ctx, input.last4);
    if (!card) return refuse(ctx, T, input, "No card on this account matches. Ask which card, by its last 4 digits.", "card not found");
    if (card.status === "active") {
      await audit(ctx, { kind: "action", tool: T, summary: `${T} · •••• ${card.last4} · not frozen`, input });
      return { ok: true, data: { already_active: true, card: `•••• ${card.last4}`, note: "The card isn't frozen. If payments still fail, look at its settings and recent declines (get_card)." } };
    }
    if (card.frozen_by === "bank") {
      return refuse(ctx, T, input, "The bank froze this card, so you can't unfreeze it and mustn't guess why. Say it needs the team to look at it and hand off (trigger card_problem).", "frozen by the bank");
    }
    if (rules.on("card_unfreeze_block_dispute")) {
      await ruleRead(ctx, rules, "card_unfreeze_block_dispute");
      const dispute = await openFraudDispute(ctx, card);
      if (dispute) return refuse(ctx, T, input, `The customer reported payments on this card that weren't theirs (${dispute}), so it stays frozen. Offer a replacement card instead, or hand off (card_problem) if they need this card back.`, "open 'not mine' dispute");
    }
    const waiting = await confirmFirst(ctx, T, card.id, `unfreeze card •••• ${card.last4}`, `Unfreeze the card ending ${card.last4}?`, "Payments will go through on it again straight away. You can freeze it again any time in the app.");
    if (waiting) return waiting;
    const [{ seq }] = await ctx.sql<{ seq: string }[]>`select nextval('card_change_seq')::text as seq`;
    const reference = `CHG-${seq}`;
    const done = await bank(ctx.sql).unfreezeCard(ctx.user!.business_id, card.id, { reference, requested_by: "Alexis" }, `unfreeze-${ctx.conv.id}-${card.id}`);
    if (!done.accepted) return refuse(ctx, T, input, done.status === "frozen_by_bank" ? "The bank froze this card, so it can't be unfrozen here. Hand off (card_problem)." : "The bank didn't accept the unfreeze. Hand off (card_problem).", `bank refused: ${done.status}`);
    await audit(ctx, { kind: "action", tool: T, summary: `${T} · •••• ${card.last4} · ${reference} unfrozen`, input, result: { reference } });
    return { ok: true, reference, data: { reference, unfrozen: true, card: `•••• ${card.last4}`, note: "Tell them it works again now and they can freeze it any time in the app." } };
  },
};

const settingsInput = cardInput.extend({
  online_payments: z.boolean().optional().describe("Switch online (web and in-app) payments on or off"),
  international_payments: z.boolean().optional().describe("Switch payments abroad and in foreign currencies on or off"),
  contactless: z.boolean().optional().describe("Switch contactless payments on or off"),
  daily_limit: z.number().positive().optional().describe("The new daily spending limit, in the card's currency"),
});

export const changeCardSettings = {
  name: "change_card_settings",
  tier: 2 as Tier,
  description:
    "Change the verified customer's card settings: online, international or contactless payments on or off, or the daily spending limit. Use it when a decline was caused by a setting or the limit and the customer wants it changed. Only change what they asked for. Asks the customer to confirm first. Depending on the institution's rules, switching a setting on or raising the limit needs the stronger check; switching off or lowering never does. A limit above the highest Alexis may set, or limit changes switched off: hand off. Not on a card the bank froze.",
  schema: settingsInput,
  async run(input: z.infer<typeof settingsInput>, ctx: ToolCtx, rules: Rules): Promise<ToolResult> {
    const T = "change_card_settings";
    const card = await findCard(ctx, input.last4);
    if (!card) return refuse(ctx, T, input, "No card on this account matches. Ask which card, by its last 4 digits.", "card not found");
    if (card.frozen_by === "bank") return refuse(ctx, T, input, "The bank froze this card, so its settings can't be changed here. Hand off (card_problem) without guessing why.", "frozen by the bank");

    // Only what actually changes; making the card safer never needs the code.
    const settings: CardSettings = {};
    const changes: string[] = [];
    let loosens = false;
    for (const k of ["online_payments", "international_payments", "contactless"] as const) {
      const want = input[k];
      if (want === undefined || want === card[k]) continue;
      settings[k] = want;
      changes.push(`${SETTING_WORDS[k]} ${want ? "on" : "off"}`);
      if (want) loosens = true;
    }
    let raises = false;
    if (input.daily_limit !== undefined && Number(card.daily_limit ?? 0) !== input.daily_limit) {
      await ruleRead(ctx, rules, "card_limit_change");
      if (!rules.on("card_limit_change")) return refuse(ctx, T, input, "Changing a card's daily limit isn't something you can do here for this institution. Say the customer can change it in the app if it allows, or hand off (card_problem).", "limit changes switched off");
      const maxId = LIMIT_MAX[card.currency];
      const max = rules.num(maxId, 0);
      await ruleRead(ctx, rules, maxId, `Highest daily card limit (${card.currency})`);
      const maxText = money(max, card.currency).replace(/\.00$/, "");
      if (input.daily_limit > max) return refuse(ctx, T, input, `${money(input.daily_limit, card.currency).replace(/\.00$/, "")} is above the ${maxText} you can set. Offer up to ${maxText}, or hand off (card_problem) for a higher limit.`, `above ${maxText}`);
      raises = input.daily_limit > Number(card.daily_limit ?? 0);
      settings.daily_limit = String(input.daily_limit);
      changes.push(`daily limit ${money(input.daily_limit, card.currency).replace(/\.00$/, "")}`);
    }
    if (!changes.length) {
      await audit(ctx, { kind: "action", tool: T, summary: `${T} · •••• ${card.last4} · nothing to change`, input });
      return { ok: true, data: { nothing_changed: true, card: `•••• ${card.last4}`, note: "The card already has those settings. If payments still fail, look at its recent declines (get_card)." } };
    }
    const needCode = (loosens && rules.on("card_settings_stronger")) || (raises && rules.on("card_limit_raise_stronger"));
    if (loosens) await ruleRead(ctx, rules, "card_settings_stronger");
    if (raises) await ruleRead(ctx, rules, "card_limit_raise_stronger");
    if (needCode) {
      const problem = needsIdentity(2, ctx, "stronger");
      if (problem) return refuse(ctx, T, input, problem, "stronger check needed");
    }
    const what = changes.join(", ");
    const waiting = await confirmFirst(ctx, T, `${card.id}:${what}`, `card •••• ${card.last4}: ${what}`, `Change the card ending ${card.last4}: ${what}?`, "It applies straight away. You can change it back any time in the app.");
    if (waiting) return waiting;
    const [{ seq }] = await ctx.sql<{ seq: string }[]>`select nextval('card_change_seq')::text as seq`;
    const reference = `CHG-${seq}`;
    const done = await bank(ctx.sql).updateCardSettings(ctx.user!.business_id, card.id, settings, { reference, requested_by: "Alexis" }, `settings-${ctx.conv.id}-${card.id}-${what}`);
    if (!done.accepted) return refuse(ctx, T, input, "The bank didn't accept the change. Hand off (card_problem).", `bank refused: ${done.status}`);
    await audit(ctx, { kind: "action", tool: T, summary: `${T} · •••• ${card.last4} · ${what} · ${reference}`, input, result: { reference, changed: what } });
    return { ok: true, reference, data: { reference, card: `•••• ${card.last4}`, changed: what, note: "Tell them it applies now and suggest they try the payment again." } };
  },
};
