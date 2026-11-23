import { randomUUID } from "node:crypto";
import type { Sql } from "./db.ts";
import { bank } from "./bank/index.ts";
import type { BankConnector } from "./bank/contract.ts";
import { Rules, marketOf } from "./rules.ts";
import { money, statusLabel } from "./format.ts";
import { parseClock } from "./time.ts";
import { TZ_OFFSET_HOURS } from "./config.ts";
import { windowRule } from "./tools/payments.ts";
import { emitEvent } from "./api/webhooks.ts";

// Proactive failure messages (Tomi, Nov 23: "build #2"). When the bank reports that a customer's payment failed
// (Events API: card.declined, transfer.returned, payment.failed_debited), Alexis tells the customer at once, with
// the reason and the fix, before they have to ask. The message goes to the phone on file and opens a conversation
// in the customer's app; replying continues it with Alexis, who still runs the identity check, any code the rules
// need and the Yes/Cancel before changing anything.
// Each institution sets it up on the Rules screen ("Proactive messages"): on or off, which failures, quiet hours,
// a daily cap per customer and the wording. Fixed: never on a review hold, never for suspected fraud or a
// reported "not mine", never twice for the same failure.

export const FAILURE_TYPES = ["card.declined", "transfer.returned", "payment.failed_debited"] as const;
export type FailureType = (typeof FAILURE_TYPES)[number];

const RULE_FOR: Record<FailureType, string> = {
  "card.declined": "proactive_card_declined", "transfer.returned": "proactive_transfer_returned", "payment.failed_debited": "proactive_failed_debited",
};

/** Why a card payment was declined, and the fix to offer. A reason not listed here isn't messaged. */
export const DECLINE_REASONS: Record<string, { reason: string; fix: string }> = {
  online_payments_off: { reason: "online payments are switched off on this card", fix: "Reply here and I can help you switch them on." },
  international_payments_off: { reason: "payments abroad are switched off on this card", fix: "Reply here and I can help you switch them on." },
  contactless_off: { reason: "contactless payments are switched off on this card", fix: "Reply here and I can help you switch them on." },
  daily_limit: { reason: "it would have gone over the card's daily limit", fix: "Reply here if you'd like to change the limit." },
  card_frozen: { reason: "the card is frozen", fix: "Reply here if you'd like to unfreeze it." },
  insufficient_funds: { reason: "there wasn't enough money in the account", fix: "Top up and try again, or reply here if something looks wrong." },
};

export type NotifyResult =
  | { sent: true; conversationId: string; text: string; heldUntil?: string }
  | { sent: false; why: "switched_off" | "review_hold" | "fraud" | "not_messaged" | "daily_cap" | "duplicate" | "not_found" | "no_phone" };

const fill = (tpl: string, v: Record<string, string>) => tpl.replace(/\{(\w+)\}/g, (_, k) => v[k] ?? "").replace(/\s+/g, " ").trim();

/** Local minutes past midnight, in the bank's time zone. */
const localMinutes = (d: Date) => (((d.getUTCHours() + TZ_OFFSET_HOURS) % 24) + 24) % 24 * 60 + d.getUTCMinutes();

/** Inside quiet hours: when the message may go out instead (the end of quiet hours). */
export function quietUntil(now: Date, rules: Rules): Date | null {
  const start = parseClock(rules.get("proactive_quiet_start")?.value ?? "", -1);
  const end = parseClock(rules.get("proactive_quiet_end")?.value ?? "", -1);
  if (start < 0 || end < 0 || start === end) return null;
  const m = localMinutes(now);
  const inside = start < end ? m >= start && m < end : m >= start || m < end;
  if (!inside) return null;
  const wait = (end - m + 24 * 60) % (24 * 60);
  return new Date(now.getTime() + wait * 60_000);
}

async function reviewHeld(b: BankConnector, holder: string) {
  return (await b.listRestrictions(holder, {})).some((r) => r.type === "review_hold") || (await b.listMerchantHolds(holder)).some((h) => h.type === "review_hold");
}

/** Work out the message for one failure from the bank's own records, or why there is none. */
type Why = Extract<NotifyResult, { sent: false }>["why"];

async function compose(sql: Sql, b: BankConnector, type: FailureType, holder: string, d: Record<string, unknown>, rules: Rules): Promise<{ ref: string; text: string } | { why: Why }> {
  const tpl = (id: string, fallback: string) => rules.get(id)?.value?.trim() || fallback;
  if (type === "card.declined") {
    const code = String(d.reason ?? "");
    if (code === "suspected_fraud") return { why: "fraud" };
    const r = DECLINE_REASONS[code];
    if (!r) return { why: "not_messaged" };
    const [tx] = await b.searchCardTransactions(holder, { id: String(d.transaction_id ?? "") });
    if (!tx) return { why: "not_found" };
    // A customer who has reported payments that weren't theirs gets nothing automatic.
    const [fraud] = await sql`select 1 from disputes where holder_id = ${holder} and reason = 'not_mine' and status in ('open','investigating')`;
    if (fraud) return { why: "fraud" };
    return {
      ref: tx.id,
      text: fill(tpl("proactive_text_card_declined", "Your {amount} payment to {merchant} on your card ending {card} was declined because {reason}. {fix} If this wasn't you, reply \"not me\" and we'll freeze the card."), {
        amount: money(tx.amount, tx.currency), merchant: tx.merchant_name ?? tx.descriptor, card: tx.card_last4 ?? "on file", reason: r.reason, fix: r.fix,
      }),
    };
  }
  if (type === "transfer.returned") {
    const [t] = await b.searchTransfers(holder, { reference: String(d.reference ?? "") });
    if (!t) return { why: "not_found" };
    if (t.review_hold) return { why: "review_hold" };
    if (t.status !== "failed" && t.status !== "reversed") return { why: "not_messaged" };
    return {
      ref: t.id,
      text: fill(tpl("proactive_text_transfer_returned", "Your {amount} payout {reference} to {recipient} didn't go through: {reason}. The money is back in your account. Reply here and I can help you send it again with the right details."), {
        amount: money(t.amount, t.currency), reference: t.id, recipient: t.recipient_name, reason: (t.failure_reason ?? statusLabel(t.status)).replace(/\.$/, "").replace(/^./, (c) => c.toLowerCase()),
      }),
    };
  }
  const { payment: p } = await b.getPayment(holder, String(d.payment_id ?? ""));
  if (!p) return { why: "not_found" };
  if (p.outcome !== "failed_debited") return { why: "not_messaged" };
  const win = rules.num(windowRule(p), 72);
  return {
    ref: p.id,
    text: fill(tpl("proactive_text_failed_debited", "Your {amount} {channel} payment at {merchant} didn't go through, but your account was debited. The money should come back within {window}; reply here if it hasn't and I'll chase it."), {
      amount: money(p.amount, p.currency), channel: p.channel, merchant: p.merchant_name, window: `${win} hours`,
    }),
  };
}

/** A failure reported by the bank: message the customer if the institution's rules allow it. */
export async function notifyFailure(sql: Sql, type: FailureType, data: Record<string, unknown>, now = new Date()): Promise<NotifyResult> {
  const b = bank(sql);
  const userId = String(data.user_id ?? "");
  const user = userId ? await b.getUser(userId) : null;
  if (!user || (data.holder_id && data.holder_id !== user.holder_id)) return { sent: false, why: "not_found" };
  const rules = await Rules.load(sql, marketOf(user.country));
  if (!rules.on("proactive_enabled") || !rules.on(RULE_FOR[type])) return { sent: false, why: "switched_off" };
  if (await reviewHeld(b, user.holder_id)) return { sent: false, why: "review_hold" };
  const out = await compose(sql, b, type, user.holder_id, data, rules);
  if ("why" in out) return { sent: false, why: out.why };
  const [dup] = await sql`select 1 from conversations where proactive->>'type' = ${type} and proactive->>'ref' = ${out.ref}`;
  if (dup) return { sent: false, why: "duplicate" };
  const cap = rules.num("proactive_daily_cap", 2);
  const [{ n }] = await sql<{ n: number }[]>`
    select count(*)::int as n from conversations where origin = 'alexis' and typing_user_id = ${user.id} and created_at > ${new Date(now.getTime() - 86_400_000)}`;
  if (n >= cap) return { sent: false, why: "daily_cap" };
  const contact = await b.getContact(user.id);
  if (!contact?.phone) return { sent: false, why: "no_phone" };

  const held = quietUntil(now, rules);
  const id = randomUUID();
  const text = `Hi ${user.first_name}, this is Alexis, the AI assistant at your bank. ${out.text}`;
  await sql`insert into conversations (id, typing_user_id, channel, origin, proactive)
    values (${id}, ${user.id}, 'app', 'alexis', ${sql.json({ type, ref: out.ref, text, send_at: (held ?? now).toISOString(), delivered: !held } as never)})`;
  await sql`insert into audit_log (conversation_id, tool_use_id, kind, tool, summary)
    values (${id}, ${`proactive-${id}`}, 'action', 'proactive_message', ${`proactive_message · ${type} · ${out.ref} · ${held ? `held for quiet hours until ${held.toISOString().slice(11, 16)} UTC` : "sent"}`})`;
  if (!held) await deliver(sql, id, user.holder_id, user.id, contact.phone, text, type, out.ref, now);
  return held ? { sent: true, conversationId: id, text, heldUntil: held.toISOString() } : { sent: true, conversationId: id, text };
}

async function deliver(sql: Sql, conversationId: string, holder: string, userId: string, phone: string, text: string, type: string, ref: string, now: Date) {
  const sentTo = `•••• ${phone.replace(/\D/g, "").slice(-4)}`;
  await sql`insert into outbox (holder_id, user_id, channel, sent_to, body, sent_at, conversation_id) values (${holder}, ${userId}, 'App notification and text message', ${sentTo}, ${text}, ${now}, ${conversationId})`;
  await sql`update conversations set proactive = proactive || ${sql.json({ delivered: true } as never)}, last_activity = ${now} where id = ${conversationId}`;
  await emitEvent(sql, "customer.notified", { holder_id: holder, user_id: userId, conversation_id: conversationId, kind: type, reference: ref, text, sent_to: sentTo });
}

/** Messages held for quiet hours go out once quiet hours end (run whenever the customer app or the queue checks). */
export async function deliverDue(sql: Sql, now = new Date()) {
  const due = await sql<{ id: string; typing_user_id: string; proactive: { type: string; ref: string; text: string } }[]>`
    select id, typing_user_id, proactive from conversations
    where origin = 'alexis' and (proactive->>'delivered')::boolean is not true and (proactive->>'send_at')::timestamptz <= ${now}`;
  for (const c of due) {
    const u = await bank(sql).getUser(c.typing_user_id);
    const contact = u ? await bank(sql).getContact(u.id) : null;
    if (!u || !contact?.phone) continue;
    await deliver(sql, c.id, u.holder_id, u.id, contact.phone, c.proactive.text, c.proactive.type, c.proactive.ref, now);
  }
}

/** The customer's notifications: messages Alexis started for them, newest first. */
export async function notificationsFor(sql: Sql, userId: string, now = new Date()) {
  await deliverDue(sql, now);
  return sql<{ id: string; text: string; type: string; at: string; replied: boolean }[]>`
    select id, proactive->>'text' as text, proactive->>'type' as type, proactive->>'send_at' as at, jsonb_array_length(messages) > 0 as replied
    from conversations where origin = 'alexis' and typing_user_id = ${userId} and (proactive->>'delivered')::boolean
      and created_at > ${new Date(now.getTime() - 7 * 86_400_000)}
    order by created_at desc limit 10`;
}

/** The customer app's tester panel: the bank reporting a failed payment for a sample customer (invented records). */
export const DEMO_FAILURES: { id: string; user: string; type: FailureType; data: Record<string, unknown>; label: string }[] = [
  { id: "grace-online", user: "grace", type: "card.declined", data: { transaction_id: "TX-90035", reason: "online_payments_off" }, label: "Online payment declined: online payments are off" },
  { id: "emeka-limit", user: "emeka", type: "card.declined", data: { transaction_id: "TX-90022", reason: "daily_limit" }, label: "Card payment declined: daily limit reached" },
  { id: "chioma-pos", user: "chioma", type: "payment.failed_debited", data: { payment_id: "PAY-61001" }, label: "POS payment failed but the account was debited" },
  { id: "maya-returned", user: "maya", type: "transfer.returned", data: { reference: "PO-77310" }, label: "Payout returned: the recipient's account is closed" },
];
