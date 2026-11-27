import { z } from "zod";
import { audit, confirmFirst, refuse, ruleRead, type Tier, type ToolCtx, type ToolResult } from "../toolkit.ts";
import type { Rules } from "../rules.ts";
import { money } from "../format.ts";
import { dateTime } from "../time.ts";
import { bank } from "../bank/index.ts";
import type { CheckoutPayment } from "../bank/contract.ts";

// A payment company's checkouts (Tomi, Nov 25: "start with 1, 2, 3"). Someone who paid a merchant by Pay with
// Transfer, a dedicated virtual account or a card usually holds no account, so they're checked by the payment
// itself: the amount, the date, and at least one more detail that matches the record (the checkout email, or the
// last 4 digits of the card or the sending account). Every comparison is made here, in code: the AI only passes on
// what the payer said. A match ties the conversation to that one payment (conversations.payer_payment_id); nothing
// else is ever shown to them. No payment network (Faster Payments, SEPA, ACH, Interac, Aani, NIBSS…) is ever called
// from here: the bank or payment company runs the status check on its own network (Nov 27: any market, any network).

const T_CHECK = "check_payment_evidence";
const lower = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();
const digits4 = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").slice(-4);
const CHANNEL: Record<CheckoutPayment["channel"], string> = { pay_with_transfer: "Bank transfer to the account shown at checkout", virtual_account: "Dedicated virtual account", card: "Card" };

/** How many payer checks in this conversation found no match (the refusals this tool wrote). */
async function failedChecks(ctx: ToolCtx): Promise<number> {
  const [r] = await ctx.sql<{ n: number }[]>`
    select count(*)::int as n from audit_log where conversation_id = ${ctx.conv.id} and tool = ${T_CHECK} and kind = 'refusal' and summary like ${`${T_CHECK} · refused: no match%`}`;
  return r.n;
}

/** Whether the payer's details match a payment: each detail given must match, and enough of them must be given. */
export function evidenceMatches(p: CheckoutPayment, e: { email?: string; card_last4?: string; account_last4?: string }, needed: number): boolean {
  const checks: boolean[] = [];
  if (e.email) checks.push(lower(e.email) === lower(p.payer.email));
  if (e.card_last4) checks.push(digits4(e.card_last4) === digits4(p.payer.card_last4) && digits4(e.card_last4) !== "");
  if (e.account_last4) checks.push(digits4(e.account_last4) === digits4(p.payer.account_last4) && digits4(e.account_last4) !== "");
  return checks.length >= needed && checks.every(Boolean);
}

/** What happened to the payment and what comes next, worked out from the record and the rules. */
function explain(p: CheckoutPayment, rules: Rules): { status: string; next: string } {
  const a = (id: string) => rules.get(id)?.value ?? "";
  const cur = p.currency;
  const exp = p.amount_expected ? money(p.amount_expected, cur) : null;
  const got = p.amount_received ? money(p.amount_received, cur) : null;
  const refund = p.refund;
  const refundLine = refund
    ? `A refund of ${money(refund.amount, cur)} is ${refund.status} (${refund.id}${refund.arn ? `, ARN ${refund.arn}` : ""}), started ${dateTime(new Date(refund.started_at))}. ${p.channel === "card" ? a("card_refund_time") : a("transfer_refund_time")}.`
    : null;
  switch (p.status) {
    case "successful":
      if (refund) return { status: "Successful, then refunded", next: refundLine! };
      if (p.channel === "virtual_account") return { status: `Received ${got} into the virtual account ending ${p.virtual_account_last4}`, next: p.merchant_notification?.status === "delivered" ? `The merchant was told on ${dateTime(new Date(p.merchant_notification.last_at!))}, so crediting the wallet is now with the merchant (${p.merchant_name}). ${a("merchant_not_delivering")}.` : "The merchant hasn't been told yet: re-send the notification (resend_merchant_notification)." };
      return {
        status: `Successful: ${got} received ${dateTime(new Date(p.received_at!))}`,
        next: p.merchant_notification && p.merchant_notification.status !== "delivered"
          ? `The merchant's system didn't get the "paid" notification (${p.merchant_notification.attempts} attempt${p.merchant_notification.attempts === 1 ? "" : "s"}): re-send it (resend_merchant_notification), then tell the payer the merchant now has it.`
          : `The merchant was told. ${a("merchant_not_delivering")}.`,
      };
    case "received_late":
      return { status: `Arrived after the checkout expired: ${got} received ${dateTime(new Date(p.received_at!))}`, next: refundLine ?? (rules.on("late_transfer_auto_refund") ? `${a("late_transfer")}. No refund shows yet; if it's past ${rules.num("late_transfer_refund_hours", 24)} hours, refund it (refund_checkout_payment).` : `${a("late_transfer")}. Offer to refund it (refund_checkout_payment).`) };
    case "received_short":
      return { status: `Short: ${got} received against ${exp}`, next: refundLine ?? `${a("short_transfer")}. Offer the refund of ${got} (refund_checkout_payment).` };
    case "received_over":
      return { status: `Over-paid: ${got} received against ${exp}`, next: refundLine ?? `${a("over_transfer")}. Offer to refund the excess, ${money(Number(p.amount_received) - Number(p.amount_expected), cur)} (refund_checkout_payment).` };
    case "awaiting":
      return { status: `Nothing received yet for this checkout (${exp})`, next: "Ask for the transfer's reference from their bank's receipt or app (a payment reference, end-to-end ID, trace number, Interac reference, UETR or session ID, whatever their bank shows) and check it (check_transfer_status)." };
    case "failed_debited":
      return { status: `Failed at checkout, but the card was debited ${got}`, next: refundLine ?? `${a("card_failed_debited")}. If it's past that, hand off (trigger checkout_payment_problem).` };
    case "duplicate":
      return { status: `A second charge of ${got} for the same order`, next: refundLine ?? "Offer to refund this duplicate charge (refund_checkout_payment)." };
    case "unmatched":
      return { status: `Received ${got} but not matched to the checkout`, next: "Hand off to the team to match it (trigger transfer_unmatched)." };
  }
}

export function checkoutView(p: CheckoutPayment, rules: Rules) {
  if (p.review_hold) {
    return { payment: p.id, merchant: p.merchant_name, status: "review hold", next: "Say only that the payment is with a specialist team for review. Give no reason, and hand off (trigger review_hold)." };
  }
  const e = explain(p, rules);
  return {
    payment: p.id,
    reference: p.reference,
    merchant: p.merchant_name,
    method: CHANNEL[p.channel],
    ...(p.amount_expected ? { checkout_amount: money(p.amount_expected, p.currency) } : {}),
    paid: dateTime(new Date(p.created_at)),
    status: e.status,
    ...(p.network ? { network: p.network } : {}),
    ...(p.network_reference ? { network_reference: p.network_reference } : {}),
    next: e.next,
  };
}

/** The payment this payer was matched to (or, for a verified account holder, any payment they ask about by id). */
async function scoped(ctx: ToolCtx, id?: string): Promise<CheckoutPayment | null> {
  const want = (ctx.conv.payer_payment_id ?? id ?? "").trim().toUpperCase();
  if (!want) return null;
  if (ctx.conv.payer_payment_id && id && id.trim().toUpperCase() !== ctx.conv.payer_payment_id) return null;
  return bank(ctx.sql).getCheckoutPayment(want);
}

// ---------------------------------------------------------------- check_payment_evidence

export const checkPaymentEvidence = {
  name: T_CHECK,
  tier: 0 as Tier,
  description:
    "The identity check for someone who paid a merchant (by bank transfer to the account number shown at checkout, by a dedicated virtual account, or by card) and has no account of their own: use it instead of verify_identity for them. Pass what they tell you: the amount, the date, and the email they used at checkout or the last 4 digits of the card or the sending account (more details are fine). Every detail is compared with the payment company's record in code; a match shows that one payment, its status and what to do next, and from then on only that payment can be discussed. Never say which detail didn't match. After the limit of failed checks, hand off (trigger payer_not_matched).",
  schema: z.object({
    amount: z.number().positive().describe("What they paid (or what the checkout asked for)"),
    on: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe("The day they paid, YYYY-MM-DD"),
    merchant: z.string().optional().describe("Part of the merchant's name, if they gave it"),
    email: z.string().optional().describe("The email they used at checkout"),
    card_last4: z.string().optional(),
    account_last4: z.string().optional().describe("The last 4 digits of the account they sent from"),
    currency: z.enum(["USD", "GBP", "EUR", "CAD", "AED", "NGN"]).optional(),
  }),
  async run(input: { amount: number; on: string; merchant?: string; email?: string; card_last4?: string; account_last4?: string; currency?: string }, ctx: ToolCtx, rules: Rules): Promise<ToolResult> {
    const shown = { amount: input.amount, on: input.on, merchant: input.merchant, given: [input.email && "email", input.card_last4 && "card last 4", input.account_last4 && "account last 4"].filter(Boolean) };
    const limit = rules.num("payer_check_attempts", 3);
    if ((await failedChecks(ctx)) >= limit) {
      return refuse(ctx, T_CHECK, shown, "The payer check has ended for this conversation after the limit of failed attempts. Share nothing about any payment and hand off (trigger payer_not_matched).", "check ended");
    }
    const needed = Math.max(1, rules.num("payer_evidence_needed", 1));
    await ruleRead(ctx, rules, "payer_evidence_needed");
    const given = [input.email, input.card_last4, input.account_last4].filter((x) => x && x.trim()).length;
    if (given < needed) {
      return refuse(ctx, T_CHECK, shown, `Ask for ${needed === 1 ? "one more detail" : `${needed} more details`}: the email they used at checkout, or the last 4 digits of the card or of the account they sent from.`, "more detail needed");
    }
    const found = await bank(ctx.sql).findCheckoutPayments({ amount: input.amount, on: input.on, currency: input.currency, merchant: input.merchant });
    const hits = found.filter((p) => evidenceMatches(p, input, needed));
    if (hits.length !== 1) {
      const left = limit - (await failedChecks(ctx)) - 1;
      const res = await refuse(ctx, T_CHECK, shown,
        hits.length === 0
          ? `No payment matches these details. Don't say which detail was wrong. Ask them to check the amount, the date and the detail they gave${left > 0 ? ` (${left} attempt${left === 1 ? "" : "s"} left)` : ""}, or hand off.`
          : "More than one payment matches. Ask for one more detail (another of: the checkout email, the card's or the sending account's last 4).",
        hits.length === 0 ? "no match" : "several matches");
      return res;
    }
    const p = hits[0];
    await ctx.sql`update conversations set payer_payment_id = ${p.id}, last_activity = now() where id = ${ctx.conv.id}`;
    ctx.conv.payer_payment_id = p.id;
    const view = checkoutView(p, rules);
    await audit(ctx, { kind: "identity", tool: T_CHECK, summary: `${T_CHECK} · payer matched to ${p.id} (${p.merchant_name}) by amount, date and ${shown.given.join(", ")}`, input: shown, result: view });
    return { ok: true, data: { matched: true, ...view } };
  },
};

// ---------------------------------------------------------------- get_checkout_payment

export const getCheckoutPayment = {
  name: "get_checkout_payment",
  tier: 1 as Tier,
  identity: "payer" as const,
  description: "The payment the payer was matched to, read again (its latest status, refund and the merchant notification). Only that payment.",
  schema: z.object({}),
  async run(input: Record<string, never>, ctx: ToolCtx, rules: Rules): Promise<ToolResult> {
    const p = await scoped(ctx);
    if (!p) return refuse(ctx, "get_checkout_payment", input, "No payment is tied to this conversation. Run check_payment_evidence first.", "no payment");
    const view = checkoutView(p, rules);
    await audit(ctx, { kind: "lookup", tool: "get_checkout_payment", summary: `get_checkout_payment · ${p.id} · ${view.status}`, input, result: view });
    return { ok: true, data: view };
  },
};

// ---------------------------------------------------------------- check_transfer_status

const NETWORK_STATUS: Record<string, (network: string) => string> = {
  successful: (n) => `Completed on ${n}`,
  pending: () => "Still pending at the sender's bank",
  failed: () => "Failed",
  reversed: () => "Not completed; returned to the sender's account",
  not_found: () => "No transfer with this reference on the payment network",
};

export const checkTransferStatus = {
  name: "check_transfer_status",
  tier: 1 as Tier,
  identity: "payer" as const,
  description:
    "The status of the payer's bank transfer on its payment network (Faster Payments, SEPA, ACH, Fedwire, RTP, FedNow, Interac, Aani, NIBSS, SWIFT…), by the reference on their bank's receipt or app, for the payment they were matched to (a bank transfer at checkout or a virtual account top-up). The reference is whatever their bank shows: a payment reference, end-to-end ID, trace number, Interac reference number, UETR or NIBSS session ID. The bank or payment company runs the check on its own network; Orchestra never calls a payment network. Use it when nothing has arrived for their checkout.",
  schema: z.object({ reference: z.string().trim().min(6).max(64).regex(/^[A-Za-z0-9._\/-]+$/).describe("The transfer's reference from their bank's receipt or app, as shown") }),
  async run(input: { reference: string }, ctx: ToolCtx, rules: Rules): Promise<ToolResult> {
    const T = "check_transfer_status";
    const p = await scoped(ctx);
    if (!p) return refuse(ctx, T, input, "No payment is tied to this conversation. Run check_payment_evidence first.", "no payment");
    if (p.channel === "card") return refuse(ctx, T, input, "This is a card payment; there's no transfer to check.", "card payment");
    if (p.review_hold) return refuse(ctx, T, input, "Review hold: say only that the payment is with a specialist team for review, and hand off (trigger review_hold).", "review hold");
    const s = await bank(ctx.sql).getTransferStatus(input.reference);
    const network = s.network ?? "the payment network";
    const next =
      s.status === "pending" ? rules.get("transfer_pending")?.value ?? ""
      : s.status === "reversed" || s.status === "failed" ? "The money didn't reach the merchant; if their account still shows the debit, they should ask their bank, quoting this reference."
      : s.status === "successful" ? (p.status === "awaiting" ? `${network} shows it completed, but nothing reached this checkout: it may have gone to a different account. Hand off (trigger transfer_unmatched) with the reference.` : "It completed and the payment shows received.")
      : "Ask them to check the reference on their receipt; if it's right, hand off (trigger transfer_unmatched).";
    if (s.status === "pending") await ruleRead(ctx, rules, "transfer_pending");
    const view = { reference: s.reference, ...(s.network ? { network: s.network } : {}), status: (NETWORK_STATUS[s.status] ?? (() => s.status))(network), ...(s.at ? { at: dateTime(new Date(s.at)) } : {}), ...(s.detail ? { detail: s.detail } : {}), next };
    await audit(ctx, { kind: "lookup", tool: T, summary: `${T} · ${p.id} · ${s.network ?? "unknown network"} …${s.reference.slice(-6)} · ${s.status}`, input, result: view });
    return { ok: true, data: view };
  },
};

// ---------------------------------------------------------------- resend_merchant_notification

export const resendMerchantNotification = {
  name: "resend_merchant_notification",
  tier: 1 as Tier,
  identity: "payer" as const,
  description:
    "Send the merchant's system the \"paid\" notification again, for the matched payment when it arrived but the merchant didn't get the notification. Limited per payment; no money moves.",
  schema: z.object({}),
  async run(input: Record<string, never>, ctx: ToolCtx, rules: Rules): Promise<ToolResult> {
    const T = "resend_merchant_notification";
    const p = await scoped(ctx);
    if (!p) return refuse(ctx, T, input, "No payment is tied to this conversation. Run check_payment_evidence first.", "no payment");
    if (p.review_hold) return refuse(ctx, T, input, "Review hold: say only that the payment is with a specialist team for review, and hand off (trigger review_hold).", "review hold");
    if (!["successful", "received_over"].includes(p.status)) return refuse(ctx, T, input, "Only a payment that went through can be re-notified.", `status ${p.status}`);
    const max = rules.num("notification_resends_max", 2);
    await ruleRead(ctx, rules, "notification_resends_max");
    const [{ n }] = await ctx.sql<{ n: number }[]>`
      select count(*)::int as n from audit_log where tool = ${T} and kind = 'action' and input->>'payment' = ${p.id}`;
    if (n >= max) return refuse(ctx, T, input, `It has been re-sent ${n} time${n === 1 ? "" : "s"} already. Hand off (trigger merchant_not_delivering) so the team contacts the merchant.`, "re-send limit");
    const reference = `NTF-${p.id.replace(/^CK-/, "")}-${n + 1}`;
    const r = await bank(ctx.sql).resendMerchantNotification(p.id, { reference, requested_by: "Alexis" }, `ntf-${p.id}-${n + 1}`);
    if (!r.accepted) return refuse(ctx, T, input, "The payment company didn't accept the re-send. Hand off (trigger merchant_not_delivering).", `refused: ${r.status}`);
    await audit(ctx, { kind: "action", tool: T, summary: `${T} · ${p.id} · ${p.merchant_name} notified again (${r.status})`, input: { payment: p.id }, result: { reference, status: r.status } });
    return { ok: true, reference, data: { reference, status: r.status === "delivered" ? "The merchant's system confirmed it received the notification" : r.status, note: "Tell the payer the merchant now has the payment confirmation; if they still don't deliver, the team can contact the merchant." } };
  },
};

// ---------------------------------------------------------------- refund_checkout_payment

const CAP: Record<string, string> = {
  USD: "checkout_refund_cap_usd", GBP: "checkout_refund_cap_gbp", EUR: "checkout_refund_cap_eur", CAD: "checkout_refund_cap_cad", AED: "checkout_refund_cap_aed", NGN: "checkout_refund_cap_ngn",
};

export const refundCheckoutPayment = {
  name: "refund_checkout_payment",
  tier: 2 as Tier,
  identity: "payer" as const,
  description:
    "Refund the payer for the matched payment when the rules allow it: a transfer that arrived after the checkout expired, a short transfer (all of it), an over-payment (the excess only), or a duplicate card charge. Never for a normal successful payment (that's between the payer and the merchant). Needs the payer's yes; above the cap, hand off. Once per payment.",
  schema: z.object({}),
  async run(input: Record<string, never>, ctx: ToolCtx, rules: Rules): Promise<ToolResult> {
    const T = "refund_checkout_payment";
    const p = await scoped(ctx);
    if (!p) return refuse(ctx, T, input, "No payment is tied to this conversation. Run check_payment_evidence first.", "no payment");
    if (p.review_hold) return refuse(ctx, T, input, "Review hold: say only that the payment is with a specialist team for review, and hand off (trigger review_hold).", "review hold");
    if (p.refund && p.refund.status !== "failed") {
      await audit(ctx, { kind: "refusal", tool: T, summary: `${T} · refused: already refunding ${p.refund.id}`, input, refusal_reason: "Duplicate refund" });
      return { ok: false, reference: p.refund.id, reason: `A refund is already ${p.refund.status} (${p.refund.id}${p.refund.arn ? `, ARN ${p.refund.arn}` : ""}). Give them that, with the usual timeline.` };
    }
    const amount =
      p.status === "received_over" ? Number(p.amount_received) - Number(p.amount_expected)
      : ["received_late", "received_short", "duplicate"].includes(p.status) ? Number(p.amount_received)
      : null;
    if (amount == null || !(amount > 0)) {
      return refuse(ctx, T, input, p.status === "successful" ? `This payment went through normally, so it isn't refunded here. ${rules.get("merchant_not_delivering")?.value ?? ""}. If they want their money back from the merchant, hand off (trigger merchant_not_delivering).` : "This payment can't be refunded here.", `status ${p.status}`);
    }
    const capId = CAP[p.currency];
    const cap = rules.num(capId, 0);
    await ruleRead(ctx, rules, capId);
    const shown = money(amount, p.currency);
    if (amount > cap && !ctx.staffAction) return refuse(ctx, T, input, `${shown} is above the ${money(cap, p.currency).replace(/\.00$/, "")} refund cap; hand off (trigger checkout_refund_over_cap).`, `above cap ${money(cap, p.currency).replace(/\.00$/, "")}`);
    const to = p.channel === "card" ? `the card ending ${p.payer.card_last4}` : `the account ending ${p.payer.account_last4}`;
    const waiting = await confirmFirst(ctx, T, p.id, `refund of ${shown} for ${p.id}`, `Refund ${shown} to ${to}?`,
      p.channel === "card" ? rules.get("card_refund_time")?.value ?? "" : rules.get("transfer_refund_time")?.value ?? "");
    if (waiting) return waiting;
    const reference = `CRF-${p.id.replace(/^CK-/, "")}`;
    const r = await bank(ctx.sql).refundCheckoutPayment(p.id, { reference, requested_by: "Alexis", amount: amount.toFixed(2) }, `refund-${p.id}`);
    if (!r.accepted) return refuse(ctx, T, input, "The payment company didn't accept the refund. Hand off (trigger checkout_payment_problem).", `refused: ${r.status}`);
    await audit(ctx, { kind: "action", tool: T, summary: `${T} · ${p.id} · ${shown} to ${to}${r.arn ? ` · ARN ${r.arn}` : ""}`, input: { payment: p.id }, result: { reference, refund: r.bank_reference, arn: r.arn ?? null } });
    return { ok: true, reference: r.bank_reference ?? reference, data: { refund: r.bank_reference, amount: shown, to, ...(r.arn ? { arn: r.arn } : {}), timeline: p.channel === "card" ? rules.get("card_refund_time")?.value : rules.get("transfer_refund_time")?.value } };
  },
};
