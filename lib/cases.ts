import type { Sql } from "./db.ts";
import { SESSION_IDLE_MINUTES } from "./config.ts";

// The Cases screen: every customer conversation, not only the ones handed to a person. Category,
// status and urgency are worked out from what is already recorded (the audit log, the handoffs and
// the conversation's own state), so nothing new is stored and nothing can drift out of step.

export type CaseStatus = "In progress" | "Taken over" | "Waiting for the team" | "Waiting on customer" | "Resolved by Alexis" | "Handed off" | "Needs approval" | "Resolved by staff";
export const STATUSES: CaseStatus[] = ["In progress", "Taken over", "Waiting for the team", "Waiting on customer", "Resolved by Alexis", "Handed off", "Needs approval", "Resolved by staff"];
const OPEN: CaseStatus[] = ["In progress", "Taken over", "Waiting for the team", "Waiting on customer", "Handed off", "Needs approval"];

/** Each tool's area of the business, for the case's category. Tools used in every kind of case are left out. */
const CATEGORY_BY_TOOL: Record<string, string> = {
  get_transfer_status: "Payouts", initiate_recall: "Payouts", generate_proof_of_payment: "Payouts",
  find_incoming_payment: "Incoming payments",
  get_kyc_status: "Verification",
  get_balance: "Balances",
  get_fees: "Fees and limits", waive_fee: "Fees and limits", get_account_limits: "Fees and limits",
  send_one_time_code: "Account access", send_reset_link: "Account access", unlock_account: "Account access",
  get_card: "Cards", freeze_card: "Cards", order_replacement: "Cards",
  list_transactions: "Transactions and disputes", open_dispute: "Transactions and disputes",
  find_payments: "Failed payments and reversals", get_reversal_status: "Failed payments and reversals", request_reversal: "Failed payments and reversals",
  get_payment_by_id: "Payment tracing", get_payment_timeline: "Payment tracing",
  get_loan: "Loans", payoff_quote: "Loans", request_deferral: "Loans",
  get_payout_status: "Merchant payouts", list_holds: "Merchant payouts",
  get_bill_payment_status: "Airtime and bills", refund_bill_payment: "Airtime and bills",
  get_ussd_session: "USSD and agent banking",
};

/** Handoff triggers that say more about the case than the tools do. */
const CATEGORY_BY_TRIGGER: Record<string, string> = {
  formal_complaint: "Complaint",
  scam_in_progress: "Fraud and scams",
  account_takeover_suspected: "Fraud and scams",
};

/** When Alexis handed off without looking anything up, the handoff's reason names the area. */
const AREA_BY_TRIGGER: Record<string, string> = {
  payout_past_window: "Payouts", recall_over_cap: "Payouts", wrong_recipient: "Payouts",
  unallocated_payment_matched: "Incoming payments", incoming_not_found_proof_supplied: "Incoming payments",
  verification_past_window: "Verification", stamped_document_requested: "Verification",
  fee_or_rate_disputed: "Fees and limits",
  reversal_past_window: "Failed payments and reversals", reversal_not_arrived: "Failed payments and reversals",
  dispute_over_cap: "Transactions and disputes", card_problem: "Cards", contact_change_requested: "Account access",
  loan_hardship: "Loans", merchant_payout_problem: "Merchant payouts",
  bill_payment_problem: "Airtime and bills", agent_cash_problem: "USSD and agent banking",
};

export const GENERAL = "General question";

/** Every category a conversation can have, for the Inbox's filter and the dashboard. */
export const ALL_CATEGORIES: string[] = [...new Set([...Object.values(CATEGORY_BY_TOOL), ...Object.values(AREA_BY_TRIGGER), ...Object.values(CATEGORY_BY_TRIGGER), GENERAL])].sort();

/**
 * Before any lookup (the identity check comes first), the customer's own words say what it's about.
 * Checked in order, so "card payment failed" is a failed payment, not a card question.
 */
const CATEGORY_BY_WORDS: [RegExp, string][] = [
  [/\b(complain|complaint|unacceptable|disgusted|ombudsman)\b/i, "Complaint"],
  [/\b(scam|fraud|hacked|stolen|didn'?t (make|authori[sz]e)|not me)\b/i, "Fraud and scams"],
  [/\b(airtime|data bundle|electricity|token|dstv|gotv|bill payment|meter)\b/i, "Airtime and bills"],
  [/\b(ussd|\*\d{3}|agent|pos agent)\b/i, "USSD and agent banking"],
  [/\b(loan|repayment|instal?ment|defer)\b/i, "Loans"],
  [/\b(settlement|merchant payout|my payouts? from (card )?sales)\b/i, "Merchant payouts"],
  [/\b(proof of payment|payment confirmation|receipt)\b/i, "Payouts"],
  [/\b(failed|declined|debited|deducted|taken from my account|reversal|refund)\b/i, "Failed payments and reversals"],
  [/\b(dispute|charged twice|double charge|don'?t recogni[sz]e|unknown charge)\b/i, "Transactions and disputes"],
  [/\b(card|pin|atm)\b/i, "Cards"],
  [/\b(password|log ?in|locked|reset|can'?t sign in|access)\b/i, "Account access"],
  [/\b(verification|verify my (account|business)|kyc|documents?|open an account)\b/i, "Verification"],
  [/\b(fee|charge|rate|fx|exchange|limit)\b/i, "Fees and limits"],
  [/\b(balance|how much (money|do i have))\b/i, "Balances"],
  [/\b(hasn'?t arrived|not received|paid us|incoming|customer (says|paid))\b/i, "Incoming payments"],
  [/\b(payout|transfer|sent|payment to|wire|swift|recall|wrong (account|supplier|recipient))\b/i, "Payouts"],
];

/**
 * The case's category: a complaint or fraud handoff first, then the first area Alexis looked into, then
 * the handoff's reason, then what the customer wrote.
 */
export function categoryOf(tools: string[], triggers: string[], words?: string | null): string {
  for (const t of triggers) if (CATEGORY_BY_TRIGGER[t]) return CATEGORY_BY_TRIGGER[t];
  for (const t of tools) if (CATEGORY_BY_TOOL[t]) return CATEGORY_BY_TOOL[t];
  for (const t of triggers) if (AREA_BY_TRIGGER[t]) return AREA_BY_TRIGGER[t];
  if (words) for (const [re, c] of CATEGORY_BY_WORDS) if (re.test(words)) return c;
  return GENERAL;
}

export interface Handoff { reference: string; urgency: string; status: string; action: { type?: string } | null; created_at: Date }

/** Where the case stands. A person handling it now wins; then a handoff; then anything waiting on the customer; then idle means done. */
export function statusOf(c: { handoffs: Handoff[]; waiting: boolean; lastActivity: Date; takenOverBy?: string | null; awaitingTeam?: string | null }, now: Date): CaseStatus {
  if (c.takenOverBy) return "Taken over";
  if (c.awaitingTeam) return "Waiting for the team";
  const latest = [...c.handoffs].sort((a, b) => +new Date(b.created_at) - +new Date(a.created_at))[0];
  if (latest) {
    if (latest.status !== "open") return "Resolved by staff";
    return latest.action?.type === "recall" ? "Needs approval" : "Handed off";
  }
  if (c.waiting) return "Waiting on customer";
  return now.getTime() - new Date(c.lastActivity).getTime() > SESSION_IDLE_MINUTES * 60_000 ? "Resolved by Alexis" : "In progress";
}

const RANK: Record<string, number> = { urgent: 3, high: 2, normal: 1 };

/** The highest urgency among the case's handoffs; a case never handed off has none. */
export function urgencyOf(handoffs: Handoff[]): string | null {
  let best: string | null = null;
  for (const h of handoffs) if (!best || (RANK[h.urgency] ?? 0) > (RANK[best] ?? 0)) best = h.urgency;
  return best;
}

type Block = { type: string; text?: string; staff?: string };
type Message = { role: string; content: string | Block[] };

/**
 * The chat as people saw it: text only (tool calls and results left out), secrets already masked.
 * `staff` names the member of the team who wrote a reply after taking the conversation over.
 */
export function transcriptOf(messages: Message[] | null): { who: string; text: string; staff?: string }[] {
  const out: { who: string; text: string; staff?: string }[] = [];
  for (const m of messages ?? []) {
    if ((m.role as string) === "system") continue; // session notes for Alexis, never shown as chat
    if (typeof m.content === "string") {
      if (m.content.trim()) out.push({ who: m.role === "assistant" ? "Alexis" : "Customer", text: m.content });
      continue;
    }
    // One entry per speaker in a row: Alexis's text, then a person's reply, are shown apart.
    let cur: { who: string; text: string; staff?: string } | null = null;
    for (const b of m.content) {
      const piece = b.type === "text" && b.text?.trim() ? b.text : b.type === "image" ? "[Screenshot attached]" : "";
      if (!piece) continue;
      const who = m.role === "user" ? "Customer" : b.staff ? b.staff : "Alexis";
      if (cur && cur.who === who) cur.text += `\n${piece}`;
      else {
        cur = { who, text: piece, ...(b.staff ? { staff: b.staff } : {}) };
        out.push(cur);
      }
    }
  }
  return out;
}

export interface CaseRow {
  id: string; customer: string | null; business: string | null; verified: boolean;
  category: string; status: CaseStatus; urgency: string | null; references: string[]; takenOverBy: string | null;
  channel: "app" | "whatsapp" | "email"; subject: string | null;
  language: string; awaitingTeam: string | null; review: { rating: "good" | "needs_work"; note: string | null; by: string } | null;
  started: string; lastActivity: string; messages: number; firstMessage: string | null;
}

interface ConvRow {
  id: string; created_at: Date; last_activity: Date; messages: Message[];
  pending_action: { confirmed?: boolean } | null; pending_identity_tool_id: string | null; pending_code: unknown; taken_over_by: string | null;
  channel: "app" | "whatsapp" | "email"; email_subject: string | null;
  language: string; awaiting_team: string | null; review_rating: "good" | "needs_work" | null; review_note: string | null; reviewed_by: string | null;
  verified: boolean; customer: string | null; business: string | null; tools: string[] | null;
}

/** Every customer conversation, newest activity first. */
export async function listCases(sql: Sql, now = new Date()): Promise<CaseRow[]> {
  const convs = await sql<ConvRow[]>`
    select c.id, c.created_at, c.last_activity, c.messages, c.pending_action, c.pending_identity_tool_id, c.pending_code, c.taken_over_by, c.channel, c.email_subject, c.language, c.awaiting_team,
      rv.rating as review_rating, rv.note as review_note, rv.reviewed_by,
      c.verified_user_id is not null as verified,
      coalesce(v.full_name, t.full_name) as customer, coalesce(vb.name, tb.name) as business,
      (select array_agg(a.tool order by a.id) from audit_log a where a.conversation_id = c.id and a.tool is not null) as tools
    from conversations c
      left join business_users v on v.id = c.verified_user_id left join businesses vb on vb.id = v.business_id
      left join business_users t on t.id = c.typing_user_id left join businesses tb on tb.id = t.business_id
      left join conversation_reviews rv on rv.conversation_id = c.id
    where c.mode = 'customer' and jsonb_array_length(c.messages) > 0
    order by c.last_activity desc
    limit 300`;
  const handoffs = await sql<(Handoff & { conversation_id: string; trigger: string })[]>`
    select reference, conversation_id, urgency, status, action, trigger, created_at from escalations
    where conversation_id is not null`;
  const byConv = new Map<string, (Handoff & { trigger: string })[]>();
  for (const h of handoffs) byConv.set(h.conversation_id, [...(byConv.get(h.conversation_id) ?? []), h]);

  return convs.map((c) => {
    const hs = byConv.get(c.id) ?? [];
    const transcript = transcriptOf(c.messages);
    const waiting = Boolean((c.pending_action && !c.pending_action.confirmed) || c.pending_identity_tool_id || c.pending_code);
    return {
      id: c.id,
      customer: c.customer,
      business: c.business,
      verified: c.verified,
      category: categoryOf(c.tools ?? [], hs.map((h) => h.trigger), [c.email_subject, ...transcript.filter((m) => m.who === "Customer").map((m) => m.text)].filter(Boolean).join("\n")),
      status: statusOf({ handoffs: hs, waiting, lastActivity: c.last_activity, takenOverBy: c.taken_over_by, awaitingTeam: c.awaiting_team }, now),
      language: c.language ?? "en",
      awaitingTeam: c.awaiting_team,
      review: c.review_rating ? { rating: c.review_rating, note: c.review_note, by: c.reviewed_by! } : null,
      takenOverBy: c.taken_over_by,
      channel: c.channel ?? "app",
      subject: c.email_subject,
      urgency: urgencyOf(hs),
      references: hs.map((h) => h.reference),
      started: new Date(c.created_at).toISOString(),
      lastActivity: new Date(c.last_activity).toISOString(),
      messages: transcript.length,
      firstMessage: transcript.find((m) => m.who === "Customer")?.text.slice(0, 140) ?? null,
    };
  });
}

/** The numbers at the top of the Cases screen, counted from the same rows as the list. */
export function caseCounts(rows: CaseRow[]) {
  const n = (s: CaseStatus[]) => rows.filter((r) => s.includes(r.status)).length;
  const byAlexis = n(["Resolved by Alexis"]);
  const handedOff = rows.filter((r) => r.references.length > 0).length;
  return {
    total: rows.length,
    open: n(OPEN),
    resolvedByAlexis: byAlexis,
    handedOff,
    urgentOpen: rows.filter((r) => r.urgency === "urgent" && OPEN.includes(r.status)).length,
    // Of the cases that have finished or gone to a person, the share Alexis resolved alone.
    withoutPerson: byAlexis + handedOff > 0 ? Math.round((byAlexis / (byAlexis + handedOff)) * 100) : null,
  };
}
