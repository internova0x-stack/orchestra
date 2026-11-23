import { z } from "zod";
import type Anthropic from "@anthropic-ai/sdk";
import { Rules, settlementRuleId } from "./rules.ts";
import { maskAccount, money, statusLabel } from "./format.ts";
import {
  addBusinessDays,
  addBusinessHours,
  businessDaysBetween,
  dateTime,
  dayMonthYear,
  fromLocal,
  inBusinessHours,
  local,
  longDate,
  type BusinessHours,
} from "./time.ts";
import { sendOneTimeCode, sendResetLink, unlockAccount } from "./tools/access.ts";
import { watch } from "./updates.ts";
import { watchCase } from "./tools/watching.ts";
import { draftClaimPack } from "./tools/claims.ts";
import { freezeCard, getCard, orderReplacement } from "./tools/cards.ts";
import { listTransactions, openDispute } from "./tools/transactions.ts";
import { findPayments, getReversalStatus, requestReversal } from "./tools/payments.ts";
import { getAccountLimits, waiveFee } from "./tools/fees.ts";
import { getPaymentById, getPaymentTimeline } from "./tools/tracing.ts";
import { getLoan, getPayoutStatus, listHolds, payoffQuote, requestDeferral } from "./tools/lending.ts";
import {
  AWAITING_CODE,
  AWAITING_IDENTITY,
  audit,
  confirmFirst,
  needsIdentity,
  refuse,
  ruleRead,
  type PayoutCard,
  type ProofDoc,
  type StreamEvent,
  type Tier,
  type ToolCtx,
  type ToolDef,
  type ToolResult,
} from "./toolkit.ts";

export { AWAITING_CODE, AWAITING_IDENTITY, audit, type PayoutCard, type ProofDoc, type StreamEvent, type Tier, type ToolCtx, type ToolResult };

// The registry and the demo's tools. Every tool runs its checks in code before acting
// (docs/DEMO-SPEC.md, "Every tool's checks"): 1 switched on, 2 identity level, 3 the record belongs
// to the verified customer, 4 review hold, 5 cap, 6 per-customer limit, 7 not already done, 8 the
// customer confirmed. A failed check refuses with a plain-language reason; every call is audited.

// ---------------------------------------------------------------- verify_identity

const verifyIdentity: ToolDef<z.ZodObject<{}>> = {
  name: "verify_identity",
  tier: 0,
  description:
    "Confirm who you are speaking with before sharing anything about an account. Shows the customer a short secure form (full name, date of birth and the business's registration number); the answers go straight to the bank's check and never to you. Returns whether they are verified, their first name, business and role (view_only or payment_rights). Call it again later to see the current result.",
  schema: z.object({}),
  async run(_input, ctx, rules) {
    if (ctx.user) {
      return {
        ok: true,
        data: { verified: true, first_name: ctx.user.first_name, business: ctx.user.business_name, role: ctx.user.role },
      };
    }
    const limit = rules.num("identity_attempts", 2);
    if (ctx.conv.failed_attempts >= limit) {
      return refuse(
        ctx,
        "verify_identity",
        {},
        "The identity check has ended for this conversation after two failed attempts. Do not say which answer was wrong and share nothing about the account. Offer the other route: sign in to the dashboard and contact support from there.",
        "identity check ended",
      );
    }
    ctx.emit({ type: "identity_form" });
    return AWAITING_IDENTITY;
  },
};

// ---------------------------------------------------------------- search_knowledge_base

const searchKnowledgeBase = {
  name: "search_knowledge_base",
  tier: 0 as Tier,
  description:
    "Look up the platform's approved answers: normal settlement times by route, what each status means, verification requirements, fees, proof of payment, incoming payments. Use it for any general fact you state. Sourced answers are the platform's published normal expectations, never guarantees; sample answers are prototype values.",
  schema: z.object({ query: z.string().min(1).describe("What to look up, in a few words, e.g. 'SWIFT settlement time'") }),
  async run(input: { query: string }, ctx: ToolCtx, rules: Rules): Promise<ToolResult> {
    const words = input.query.toLowerCase().split(/[^a-z0-9£$₦%]+/).filter((w) => w.length > 2);
    const scored = rules
      .answers()
      .map((r) => {
        const hay = `${r.category} ${r.name} ${r.value}`.toLowerCase();
        const score = words.reduce((s, w) => s + (hay.includes(w) ? (r.name.toLowerCase().includes(w) ? 2 : 1) : 0), 0);
        return { r, score };
      })
      .filter((x) => x.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, 6)
      .map(({ r }) => ({
        topic: `${r.category}: ${r.name}`,
        answer: r.value,
        kind: r.origin === "sourced" ? "Published normal expectation; never a guarantee" : "Prototype sample value",
      }));
    await audit(ctx, {
      kind: "lookup",
      tool: "search_knowledge_base",
      summary: `search_knowledge_base · "${input.query}" · ${scored.length} answer${scored.length === 1 ? "" : "s"}`,
      input,
      result: scored,
    });
    if (!scored.length) return { ok: true, data: { answers: [], note: "Nothing approved on this. Do not guess; say so and offer a handoff." } };
    return { ok: true, data: { answers: scored } };
  },
};

// ---------------------------------------------------------------- escalate_to_human

const TRIGGERS = {
  scam_in_progress: { urgency: "urgent", label: "Scam in progress, or someone else is directing the customer" },
  review_hold: { urgency: "high", label: "Payment or account on a review hold" },
  recall_over_cap: { urgency: "high", label: "Recall above the cap" },
  payout_past_window: { urgency: "high", label: "Payout past its normal window" },
  unallocated_payment_matched: { urgency: "normal", label: "Unallocated incoming payment matched" },
  incoming_not_found_proof_supplied: { urgency: "normal", label: "Incoming payment not found, payer's proof supplied" },
  stamped_document_requested: { urgency: "normal", label: "Bank-stamped document or SWIFT copy requested" },
  verification_past_window: { urgency: "normal", label: "Verification past its review window" },
  fee_or_rate_disputed: { urgency: "normal", label: "Fee or rate disputed as wrongly applied" },
  records_missing_or_contradictory: { urgency: "normal", label: "Records missing or contradictory" },
  identity_failed_twice: { urgency: "normal", label: "Identity check failed twice" },
  formal_complaint: { urgency: "normal", label: "Formal complaint" },
  customer_asked_for_human: { urgency: "normal", label: "Customer asked for a human" },
  out_of_scope: { urgency: "normal", label: "Request outside what Alexis covers" },
  reversal_past_window: { urgency: "high", label: "Failed payment not reversed within its window" },
  reversal_not_arrived: { urgency: "high", label: "A requested reversal hasn't arrived" },
  dispute_over_cap: { urgency: "normal", label: "Dispute above the cap, past the window or over the limit" },
  card_problem: { urgency: "normal", label: "Card problem Alexis can't fix (address, use after loss, freeze failed)" },
  account_takeover_suspected: { urgency: "urgent", label: "Several fraudulent transactions: possible account takeover" },
  contact_change_requested: { urgency: "normal", label: "Customer wants contact details changed" },
  loan_hardship: { urgency: "normal", label: "Loan payment difficulty or deferral request" },
  merchant_payout_problem: { urgency: "high", label: "Merchant payout rejected, unreconciled or held" },
  claim_draft: { urgency: "normal", label: "Claim pack ready for review" },
} as const;

type Trigger = keyof typeof TRIGGERS;
const RANK = { normal: 0, high: 1, urgent: 2 } as const;

/** When the first human response is due, worked out from the response-target rules and business hours. */
export function respondBy(urgency: "urgent" | "high" | "normal", now: Date, rules: Rules): { at: Date; text: string; outsideHours: boolean } {
  const h: BusinessHours = rules.hours();
  const outsideHours = !inBusinessHours(now, h);
  let at: Date;
  if (urgency === "urgent") {
    at = new Date(now.getTime() + rules.num("response_urgent", 1) * 3_600_000);
  } else if (urgency === "high") {
    at = addBusinessHours(now, rules.num("response_high", 4), h);
  } else {
    // One business day: by the same time on the next working day (from the next opening if outside hours).
    const startAt = outsideHours ? addBusinessHours(now, 0, h) : now;
    at = addBusinessDays(startAt, rules.num("response_normal", 1), h);
  }
  const today = local(now);
  const when = local(at);
  const sameDay = today.y === when.y && today.m === when.m && today.d === when.d;
  const tomorrow = local(fromLocal(today.y, today.m, today.d + 1, 12 * 60));
  const isTomorrow = tomorrow.y === when.y && tomorrow.m === when.m && tomorrow.d === when.d;
  const clock = dateTime(at).split(", ")[1];
  const text = sameDay ? `today by ${clock}` : isTomorrow ? `tomorrow by ${clock}` : `by ${clock} on ${longDate(at)}`;
  return { at, text, outsideHours };
}

const escalateSchema = z.object({
  trigger: z.enum(Object.keys(TRIGGERS) as [Trigger, ...Trigger[]]).describe("Why you are handing off"),
  urgency: z.enum(["urgent", "high", "normal"]).describe("Urgent: possible fraud or scam in progress. High: money stuck, a hold, or an approval needed. Normal: everything else."),
  request: z.string().describe("What the customer asked for, in one sentence"),
  checked: z.string().describe("Each lookup and what it showed, with payment references, amounts and dates"),
  did: z.string().describe("Any action taken, or 'None'"),
  needed: z.string().describe("The specific decision or action staff must take"),
  told: z.string().describe("The expectation you set with the customer, so staff do not contradict it"),
  flags: z.array(z.string()).optional().describe("Anything sensitive: review hold, suspected scam, complaint, distressed customer"),
});

const escalateToHuman = {
  name: "escalate_to_human",
  tier: 0 as Tier,
  description:
    "Hand the case to the support team with a summary a colleague can act on without re-asking the customer. Use it when: the person asks for a human; a payment is past its normal window; a review hold applies; an action is over the cap; an unallocated incoming payment has been matched; records are missing or contradictory; identity fails twice; or the person makes a complaint. Returns the case reference (ESC-, or CMP- for a formal complaint) and when the team will respond. Never put a review hold's reason or anything secret the customer typed into the summary.",
  schema: escalateSchema,
  async run(input: z.infer<typeof escalateSchema>, ctx: ToolCtx, rules: Rules): Promise<ToolResult> {
    const { sql } = ctx;
    // One open case per issue: the same trigger in the same conversation returns the existing case.
    const existing = await sql<{ reference: string; urgency: string; respond_by: Date }[]>`
      select reference, urgency, respond_by from escalations
      where conversation_id = ${ctx.conv.id} and trigger = ${input.trigger} and status = 'open' limit 1`;
    if (existing[0]) {
      const e = existing[0];
      await audit(ctx, { kind: "handoff", tool: "escalate_to_human", summary: `escalate_to_human · ${e.reference} · already open`, input });
      return {
        ok: true,
        reference: e.reference,
        data: { already_open: true, reference: e.reference, urgency: e.urgency, note: "This case is already with the team; give the customer the same reference and do not open another." },
      };
    }
    const base = TRIGGERS[input.trigger].urgency;
    const urgency = RANK[input.urgency] >= RANK[base] ? input.urgency : base;
    const complaint = input.trigger === "formal_complaint";
    const [{ n }] = complaint
      ? await sql<{ n: string }[]>`select nextval('complaint_seq')::text as n`
      : await sql<{ n: string }[]>`select nextval('escalation_seq')::text as n`;
    const reference = complaint ? `CMP-${n.padStart(4, "0")}` : `ESC-${n}`;
    const due = respondBy(urgency, ctx.now, rules);
    await ruleRead(ctx, rules, `response_${urgency}`);

    const summary = {
      reference,
      urgency,
      customer: ctx.user
        ? { business: ctx.user.business_name, user: ctx.user.full_name, role: ctx.user.role === "payment_rights" ? "Payment rights" : "View-only", identity: "Verified" }
        : { identity: "Not verified" },
      request: input.request,
      checked: input.checked,
      did: input.did,
      why: TRIGGERS[input.trigger].label,
      needed: input.needed,
      told: input.told,
      flags: input.flags?.length ? input.flags : ["None"],
    };
    // An over-cap recall prepared in this conversation becomes the case's action for a supervisor.
    let action: { type: "recall"; reference: string; payout: string; amount: string } | null = null;
    if (input.trigger === "recall_over_cap") {
      const r = await sql<{ reference: string; transfer_id: string; amount: string; currency: string }[]>`
        select reference, transfer_id, amount, currency from recalls
        where conversation_id = ${ctx.conv.id} and status = 'awaiting_approval' and escalation_reference is null
        order by created_at desc limit 1`;
      if (r[0]) {
        action = { type: "recall", reference: r[0].reference, payout: r[0].transfer_id, amount: money(r[0].amount, r[0].currency) };
        await sql`update recalls set escalation_reference = ${reference} where reference = ${r[0].reference}`;
      }
    }
    await sql`insert into escalations (reference, conversation_id, business_id, user_id, urgency, trigger, summary, respond_by, action)
      values (${reference}, ${ctx.conv.id}, ${ctx.user?.business_id ?? null}, ${ctx.user?.id ?? null}, ${urgency},
              ${input.trigger}, ${sql.json(summary)}, ${due.at}, ${action ? sql.json(action) : null})`;
    await audit(ctx, { kind: "handoff", tool: "escalate_to_human", summary: `escalate_to_human · ${reference} · ${urgency}`, input, result: summary });
    if (ctx.user) {
      await watch(sql, { conversationId: ctx.conv.id, holderId: ctx.user.business_id, userId: ctx.user.id, kind: "case", reference, label: `case with our team (${TRIGGERS[input.trigger].label.toLowerCase()})`, status: "open", expectedBy: due.at });
    }
    ctx.emit({ type: "handoff", reference, urgency, respond: due.text });
    return {
      ok: true,
      reference,
      data: {
        reference,
        urgency,
        team_responds: due.text,
        outside_business_hours: due.outsideHours,
        note: "Tell the customer you have passed it to the team and why in general terms, that they will not need to repeat themselves, when to expect a response (a target, not a promise), and the reference.",
      },
    };
  },
};

// ---------------------------------------------------------------- get_transfer_status

const transferSchema = z.object({
  reference: z.string().optional().describe("The payout reference, e.g. PO-88190, if the customer has it"),
  recipient: z.string().optional().describe("The recipient's name, or part of it"),
  amount: z.number().optional().describe("The amount sent, as a number"),
  sent_on: z.string().optional().describe("Roughly when it was sent, as YYYY-MM-DD"),
});

interface TransferRow {
  id: string;
  business_id: string;
  recipient_name: string;
  recipient_account: string;
  recipient_bank: string | null;
  recipient_country: string | null;
  amount: string;
  currency: string;
  route: string;
  description: string | null;
  status: string;
  stage: string | null;
  failure_reason: string | null;
  sent_at: Date;
  completed_at: Date | null;
  history: { stage: string; at: string }[];
  review_hold: boolean;
}

/** When a payout on this route is normally expected, from the settlement rule's wording. */
function expectedBy(sent: Date, settlement: string, h: BusinessHours): Date {
  const s = settlement.toLowerCase();
  const range = s.match(/(\d+)\s*to\s*(\d+)\s*business days?/);
  if (range) return addBusinessDays(sent, Number(range[2]), h);
  const single = s.match(/(\d+)\s*business days?/);
  if (single) return addBusinessDays(sent, Number(single[1]), h);
  if (s.includes("next day")) return addBusinessDays(sent, 1, h);
  return sent; // instant, near-instant, same day
}

const PROCESSING_STAGES = ["Compliance check", "Sent to the payment route", "With an intermediary bank"];

function cardFor(t: TransferRow): PayoutCard {
  const held = t.review_hold;
  const steps = t.route === "SWIFT" ? ["Created", ...PROCESSING_STAGES, "Delivered"] : ["Created", PROCESSING_STAGES[0], PROCESSING_STAGES[1], "Delivered"];
  const reached = new Set(t.history.map((x) => x.stage));
  let stages: PayoutCard["stages"];
  if (held) {
    stages = [{ label: "Created", state: "done" }, { label: "On hold", state: "current" }, { label: "Delivered", state: "todo" }];
  } else if (t.status === "failed" || t.status === "reversed") {
    stages = steps.slice(0, -1).filter((s) => reached.has(s)).map((s) => ({ label: s, state: "done" as const }));
    stages.push({ label: t.status === "failed" ? "Returned" : "Reversed", state: "failed" });
  } else {
    stages = steps.map((s) => {
      if (t.status === "successful") return { label: s, state: "done" as const };
      if (s === (t.stage ?? "")) return { label: s, state: "current" as const };
      return { label: s, state: reached.has(s) ? ("done" as const) : ("todo" as const) };
    });
  }
  return {
    reference: t.id,
    amount: money(t.amount, t.currency),
    counterparty: t.recipient_name,
    route: t.route,
    status: held ? "On hold" : statusLabel(t.status),
    date: `Sent ${dayMonthYear(new Date(t.sent_at))}`,
    stages,
  };
}

const getTransferStatus = {
  name: "get_transfer_status",
  tier: 1 as Tier,
  description:
    "Find a payout sent from the verified user's business account and return its status (Pending, Processing, Successful, Failed, Reversed, or On hold), its stage, timestamps, route, the route's normal settlement window, whether it is now later than that window, and any failure reason. Search by reference, or by recipient, amount and date. Returns up to three matches; if several match, ask which one.",
  schema: transferSchema,
  async run(input: z.infer<typeof transferSchema>, ctx: ToolCtx, rules: Rules): Promise<ToolResult> {
    const user = ctx.user!;
    const { sql } = ctx;
    const ref = input.reference?.trim().toUpperCase();
    // Check 3: the record must belong to the verified user's business. A reference from another
    // business is reported as not found, so nothing about it leaks.
    let rows: TransferRow[] = await sql<TransferRow[]>`
      select t.*, exists (select 1 from restrictions r where r.transfer_id = t.id and r.kind = 'review_hold') as review_hold
      from transfers t
      where t.business_id = ${user.business_id}
        ${ref ? sql`and upper(t.id) = ${ref}` : sql``}
        ${input.recipient ? sql`and t.recipient_name ilike ${"%" + input.recipient + "%"}` : sql``}
        ${input.amount != null ? sql`and t.amount = ${input.amount}` : sql``}
      order by t.sent_at desc limit 20`;
    if (input.sent_on && rows.length > 1) {
      const target = new Date(`${input.sent_on}T12:00:00Z`).getTime();
      rows = rows.filter((r) => Math.abs(new Date(r.sent_at).getTime() - target) < 4 * 86_400_000);
    }
    rows = rows.slice(0, 3);
    if (!rows.length) {
      await audit(ctx, { kind: "lookup", tool: "get_transfer_status", summary: `get_transfer_status · ${ref ?? input.recipient ?? "search"} · not found`, input });
      return { ok: true, data: { found: 0, note: "No payout on this account matches. Ask for another detail (reference, amount, date or recipient) or say it cannot be found and offer a handoff." } };
    }

    const h = rules.hours();
    const results = [];
    for (const t of rows) {
      const sent = new Date(t.sent_at);
      if (t.review_hold) {
        // Check 4: a payout on a review hold shows "On hold" and nothing else: no stage, no reason.
        results.push({
          reference: t.id,
          recipient: t.recipient_name,
          amount: money(t.amount, t.currency),
          route: t.route,
          status: "On hold",
          sent: dateTime(sent),
          review_hold: true,
          note: "review hold. You have not been given a reason; do not suggest one. Check get_account_restrictions, then follow the review-hold instructions.",
        });
        continue;
      }
      const settleId = settlementRuleId(t.route);
      const settlement = rules.get(settleId)?.value ?? "";
      const lateId = t.route === "SWIFT" ? "late_swift" : "late_other";
      const lateAfter = rules.num(lateId, t.route === "SWIFT" ? 3 : 1);
      const inFlight = t.status === "pending" || t.status === "processing";
      if (inFlight) {
        await ruleRead(ctx, rules, settleId, `${t.route} normal window`);
        await ruleRead(ctx, rules, lateId, `${t.route} late after`);
      }
      const elapsed = businessDaysBetween(sent, ctx.now, h);
      const due = expectedBy(sent, settlement, h);
      results.push({
        reference: t.id,
        recipient: t.recipient_name,
        recipient_account: maskAccount(t.recipient_account),
        recipient_bank: t.recipient_bank,
        amount: money(t.amount, t.currency),
        route: t.route,
        description: t.description,
        status: statusLabel(t.status),
        stage: inFlight ? t.stage : null,
        sent: dateTime(sent),
        ...(t.completed_at ? { [t.status === "successful" ? "delivered" : t.status === "failed" ? "failed_on" : "reversed_on"]: dateTime(new Date(t.completed_at)) } : {}),
        failure_reason: t.failure_reason,
        timeline: t.history.map((x) => ({ stage: x.stage, at: dateTime(new Date(x.at)) })),
        ...(inFlight
          ? {
              normal_window: settlement,
              expected_by: longDate(due),
              business_days_since_sent: Math.round(elapsed * 10) / 10,
              late: elapsed > lateAfter,
              late_rule: `counts as late after ${lateAfter} business day${lateAfter === 1 ? "" : "s"}`,
            }
          : {}),
      });
    }
    const cards = rows.map(cardFor);
    ctx.emit({ type: "card", cards });
    const one = results.length === 1 ? (results[0] as { reference: string; status: string; late?: boolean }) : null;
    await audit(ctx, {
      kind: "lookup",
      tool: "get_transfer_status",
      summary: one
        ? `get_transfer_status · ${one.reference} · found: ${one.status.toLowerCase()}${one.late ? " (late)" : ""}`
        : `get_transfer_status · ${results.length} matches`,
      input,
      result: results,
    });
    return { ok: true, data: { found: results.length, payouts: results, shown_to_customer: "The payment card(s) are shown under your reply; do not repeat every detail in text." } };
  },
};


// ---------------------------------------------------------------- generate_proof_of_payment

const proofSchema = z.object({
  reference: z.string().describe("The payout reference, e.g. PO-88021. Look the payout up with get_transfer_status first."),
});

const generateProofOfPayment = {
  name: "generate_proof_of_payment",
  tier: 2 as Tier,
  description:
    "Create a payment confirmation the customer can forward, for one completed (Successful) payout sent from their business account. It shows the amount, currency, date, recipient, masked account number, reference and route, and the customer can download it as a PDF. Only for a Successful payout: for a payout still pending or processing, offer a status note instead (initiated on its date, current stage); for a failed or reversed payout, no confirmation. The customer's own request for proof is their confirmation; you don't need to ask again. Returns the same confirmation if one already exists.",
  schema: proofSchema,
  async run(input: z.infer<typeof proofSchema>, ctx: ToolCtx, rules: Rules): Promise<ToolResult> {
    const user = ctx.user!;
    const { sql } = ctx;
    const ref = input.reference.trim().toUpperCase();
    // Check 1: switched on.
    if (!rules.on("action_generate_proof_of_payment")) {
      return refuse(ctx, "generate_proof_of_payment", input, "Proof of payment is switched off for this institution. Explain and offer a handoff.", "switched off");
    }
    // Check 3: the payout belongs to the verified user's business.
    const rows = await sql<TransferRow[]>`
      select t.*, exists (select 1 from restrictions r where r.transfer_id = t.id and r.kind = 'review_hold') as review_hold
      from transfers t where upper(t.id) = ${ref} and t.business_id = ${user.business_id}`;
    const t = rows[0];
    if (!t) return refuse(ctx, "generate_proof_of_payment", input, "No payout with that reference on this account.", "payout not found");
    // Check 4: nothing on a review hold.
    if (t.review_hold) {
      return refuse(ctx, "generate_proof_of_payment", input, "review hold. No confirmation can be issued. Follow the review-hold instructions.", "review hold");
    }
    // Only a Successful payout gets a confirmation.
    if (t.status !== "successful") {
      const status = statusLabel(t.status);
      const reason =
        t.status === "failed" || t.status === "reversed"
          ? `This payout is ${status}, so no confirmation is issued.`
          : `This payout is ${status} (${t.stage ?? "in progress"}), not completed, so no confirmation of payment can be issued yet. Offer a status note instead: initiated on ${dayMonthYear(new Date(t.sent_at))}, current stage ${t.stage ?? status}.`;
      return refuse(ctx, "generate_proof_of_payment", input, reason, `payout ${status.toLowerCase()}`);
    }
    // Check 7: one confirmation per payout; a second request returns the first.
    const existing = await sql<{ reference: string; details: ProofDoc }[]>`select reference, details from proofs where transfer_id = ${t.id}`;
    if (existing[0]) {
      ctx.emit({ type: "proof", proof: existing[0].details });
      await audit(ctx, { kind: "action", tool: "generate_proof_of_payment", summary: `generate_proof_of_payment · ${t.id} · already issued ${existing[0].reference}`, input });
      return { ok: true, reference: existing[0].reference, data: { already_issued: true, confirmation: existing[0].details, note: "The confirmation card is shown under your reply." } };
    }
    const [{ n }] = await sql<{ n: string }[]>`select nextval('proof_seq')::text as n`;
    const reference = `PP-${n}`;
    const delivered = new Date(t.completed_at ?? t.sent_at);
    const proof: ProofDoc = {
      reference,
      payout: t.id,
      amount: money(t.amount, t.currency),
      currency: t.currency,
      date: dayMonthYear(delivered),
      recipient: t.recipient_name,
      account: maskAccount(t.recipient_account),
      route: t.route,
      issued: dateTime(ctx.now),
    };
    await sql`insert into proofs (reference, transfer_id, conversation_id, business_id, details)
      values (${reference}, ${t.id}, ${ctx.conv.id}, ${user.business_id}, ${sql.json(proof as never)})`;
    await audit(ctx, { kind: "action", tool: "generate_proof_of_payment", summary: `generate_proof_of_payment · ${t.id} · created`, input, result: proof });
    ctx.emit({ type: "proof", proof });
    return { ok: true, reference, data: { confirmation: proof, note: "The confirmation card, with a PDF download, is shown under your reply; don't repeat every field." } };
  },
};

// ---------------------------------------------------------------- find_incoming_payment

const incomingSchema = z.object({
  amount: z.number().optional().describe("The amount the payer says they sent, as a number"),
  currency: z.enum(["USD", "GBP", "NGN"]).optional(),
  payer: z.string().optional().describe("The payer's name, or part of it"),
  reference: z.string().optional().describe("The payment reference the payer used"),
  sent_on: z.string().optional().describe("When the payer says they sent it, as YYYY-MM-DD"),
});

interface IncomingRow {
  id: string;
  business_id: string | null;
  payer_name: string;
  payer_bank: string | null;
  amount: string;
  currency: string;
  reference: string | null;
  status: "credited" | "unallocated";
  received_at: Date;
  credited_at: Date | null;
}

const findIncomingPayment = {
  name: "find_incoming_payment",
  tier: 1 as Tier,
  description:
    "Search for a payment someone sent to the verified user's business: payments already credited to the account, and unallocated payments that arrived with a wrong or missing reference and are waiting to be matched. Ask the customer for the amount, currency, date sent, payer's name and the reference used, then search. A credited match gives the date it was credited. An unallocated match must be confirmed with the customer and then handed to staff to credit (escalate_to_human, trigger unallocated_payment_matched); you cannot credit funds yourself. No match: say nothing has been received and ask for the payer's proof of payment (amount, date, sending bank, reference) so the team can trace it.",
  schema: incomingSchema,
  async run(input: z.infer<typeof incomingSchema>, ctx: ToolCtx, _rules: Rules): Promise<ToolResult> {
    const user = ctx.user!;
    const { sql } = ctx;
    if (input.amount == null && !input.payer && !input.reference) {
      return refuse(ctx, "find_incoming_payment", input, "Need at least the amount, the payer's name or the reference to search. Ask the customer.", "not enough detail");
    }
    const rows = await sql<IncomingRow[]>`
      select id, business_id, payer_name, payer_bank, amount, currency, reference, status, received_at, credited_at
      from incoming_payments
      where (business_id = ${user.business_id} or status = 'unallocated')
        ${input.amount != null ? sql`and amount = ${input.amount}` : sql``}
        ${input.currency ? sql`and currency = ${input.currency}` : sql``}
      order by received_at desc limit 50`;
    const norm = (x: string) => x.toLowerCase().replace(/[^a-z0-9]/g, "");
    const target = input.sent_on ? new Date(`${input.sent_on}T12:00:00Z`).getTime() : null;
    const matches = rows.filter((r) => {
      const payerOk = !input.payer || norm(r.payer_name).includes(norm(input.payer)) || norm(input.payer).includes(norm(r.payer_name));
      const refOk = !input.reference || norm(r.reference ?? "").includes(norm(input.reference)) || norm(input.reference).includes(norm(r.reference ?? ""));
      const dateOk = target == null || Math.abs(new Date(r.received_at).getTime() - target) < 4 * 86_400_000;
      if (r.status === "credited") return payerOk && refOk && dateOk;
      // Someone else's unallocated money stays private: it only matches on the exact amount
      // plus the payer or the date, never on a loose search.
      return input.amount != null && (payerOk || refOk) && dateOk && (Boolean(input.payer) || target != null);
    }).slice(0, 3);

    if (!matches.length) {
      await audit(ctx, { kind: "lookup", tool: "find_incoming_payment", summary: "find_incoming_payment · no match", input, result: { found: 0 } });
      return { ok: true, data: { found: 0, note: "Nothing matching has been received. Say so plainly and ask for the payer's proof of payment (amount, date, sending bank, reference) so the team can trace it from the sending bank's side." } };
    }
    const results = matches.map((r) =>
      r.status === "credited"
        ? { id: r.id, status: "Credited", payer: r.payer_name, amount: money(r.amount, r.currency), received: dateTime(new Date(r.received_at)), credited: dateTime(new Date(r.credited_at ?? r.received_at)), reference_used: r.reference, credited_to: `${user.business_name}, ${r.currency} account` }
        : { id: r.id, status: "Unallocated", payer: r.payer_name, amount: money(r.amount, r.currency), received: dateTime(new Date(r.received_at)), reference_used: r.reference, sending_bank: r.payer_bank, note: "Arrived with a reference that doesn't match an account, so it is waiting to be matched. Confirm with the customer that this is their payment; then hand it to staff to credit. Do not say it has been credited." },
    );
    ctx.emit({
      type: "card",
      cards: matches.map((r) => ({
        reference: r.id,
        amount: money(r.amount, r.currency),
        counterparty: `From ${r.payer_name}`,
        route: r.reference ? `Ref ${r.reference}` : "No reference",
        status: r.status === "credited" ? "Credited" : "Unallocated",
        date: `Received ${dayMonthYear(new Date(r.received_at))}`,
        stages: [],
      })),
    });
    const one = results.length === 1 ? results[0] : null;
    await audit(ctx, {
      kind: "lookup",
      tool: "find_incoming_payment",
      summary: one ? `find_incoming_payment · ${one.amount} from ${one.payer} · ${one.status.toLowerCase()}` : `find_incoming_payment · ${results.length} matches`,
      input,
      result: results,
    });
    return { ok: true, data: { found: results.length, payments: results } };
  },
};


// ---------------------------------------------------------------- get_account_restrictions

const restrictionsSchema = z.object({
  reference: z.string().optional().describe("A payout reference, if the question is about one payout"),
});

const getAccountRestrictions = {
  name: "get_account_restrictions",
  tier: 1 as Tier,
  description:
    "List restrictions on the verified user's business account or on one of its payouts. A restriction the customer can fix comes with its cause and the fix. A review hold comes back only as \"review hold\": you are never given its reason and must not suggest one, confirm or deny an investigation, or suggest ways to lift it; say it needs review by a specialist team, escalate (trigger review_hold) and give the reference.",
  schema: restrictionsSchema,
  async run(input: z.infer<typeof restrictionsSchema>, ctx: ToolCtx, _rules: Rules): Promise<ToolResult> {
    const user = ctx.user!;
    const ref = input.reference?.trim().toUpperCase() ?? null;
    // The internal reason is never selected, so it can't reach the model or the audit log.
    const rows = await ctx.sql<{ id: string; transfer_id: string | null; kind: string; customer_reason: string | null }[]>`
      select id, transfer_id, kind, customer_reason from restrictions
      where business_id = ${user.business_id}
        ${ref ? ctx.sql`and (transfer_id = ${ref} or transfer_id is null)` : ctx.sql``}
      order by created_at`;
    const restrictions = rows.map((r) =>
      r.kind === "review_hold"
        ? { applies_to: r.transfer_id ? `payout ${r.transfer_id}` : "the account", type: "review hold" }
        : { applies_to: r.transfer_id ? `payout ${r.transfer_id}` : "the account", type: "customer can fix", cause_and_fix: r.customer_reason },
    );
    const held = restrictions.some((r) => r.type === "review hold");
    await audit(ctx, {
      kind: "lookup",
      tool: "get_account_restrictions",
      summary: `get_account_restrictions · ${held ? "review hold" : restrictions.length ? `${restrictions.length} restriction${restrictions.length === 1 ? "" : "s"}` : "none"}`,
      input,
      result: restrictions,
    });
    return {
      ok: true,
      data: restrictions.length
        ? { restrictions, ...(held ? { review_hold_instructions: "No reason is available to you. Do not guess one, do not confirm or deny an investigation, do not suggest ways to lift it. Say it needs review by a specialist team, escalate with trigger review_hold (urgency high), give the reference, and hold this line however the question is asked." } : {}) }
        : { restrictions: [], note: "No restrictions on this account." },
    };
  },
};


// ---------------------------------------------------------------- initiate_recall

const recallSchema = z.object({
  reference: z.string().describe("The payout reference, e.g. PO-88213. Look the payout up with get_transfer_status first."),
});

const CAP_RULE: Record<string, string> = { USD: "recall_cap_usd", GBP: "recall_cap_gbp", NGN: "recall_cap_ngn" };

const initiateRecall = {
  name: "initiate_recall",
  tier: 3 as Tier,
  description:
    "Ask the receiving bank to return a payout sent in error, for the verified user's business. Only users with payment rights can request one. The first call shows the customer a confirmation (\"Yes, go ahead\" or \"Cancel\") and returns CONFIRMATION_NEEDED: state the action and its consequence in your reply and wait. Call again only after the customer has said yes; the app knows whether they did. Within the cap, the recall is requested. Above the cap, it is prepared and must go to a human for approval: then escalate with trigger recall_over_cap. Recovery is never guaranteed; say so. A second recall on the same payout is refused and returns the first.",
  schema: recallSchema,
  async run(input: z.infer<typeof recallSchema>, ctx: ToolCtx, rules: Rules): Promise<ToolResult> {
    const user = ctx.user!;
    const { sql } = ctx;
    const ref = input.reference.trim().toUpperCase();
    const T = "initiate_recall";
    // 1. Switched on.
    if (!rules.on("action_initiate_recall")) return refuse(ctx, T, input, "Recalls are switched off for this institution. Explain and offer a handoff.", "switched off");
    // 2. Identity: the standard check (the one-time code is backlog, owner Nov 23), and the role.
    if (user.role !== "payment_rights") {
      return refuse(ctx, T, input, "This user's role is view-only, so they cannot request a recall. Tell them a team member with payment rights can ask, or their admin can change their role. You may still give information about the payout.", "view-only role");
    }
    // 3. The payout belongs to the verified user's business.
    const rows = await sql<TransferRow[]>`
      select t.*, exists (select 1 from restrictions r where r.transfer_id = t.id and r.kind = 'review_hold') as review_hold
      from transfers t where upper(t.id) = ${ref} and t.business_id = ${user.business_id}`;
    const t = rows[0];
    if (!t) return refuse(ctx, T, input, "No payout with that reference on this account.", "payout not found");
    // 4. Never on a review hold.
    if (t.review_hold) return refuse(ctx, T, input, "review hold. No action can be taken; follow the review-hold instructions.", "review hold");
    if (t.status === "failed" || t.status === "reversed") {
      return refuse(ctx, T, input, `This payout is ${statusLabel(t.status)}, so there is nothing to recall.`, `payout ${t.status}`);
    }
    // 7. Not already done: a second recall on the same payout returns the first.
    const existing = await sql<{ reference: string; status: string }[]>`select reference, status from recalls where transfer_id = ${t.id}`;
    if (existing[0]) {
      await audit(ctx, { kind: "refusal", tool: T, summary: `${T} · refused: already requested ${existing[0].reference}`, input, refusal_reason: "Duplicate recall" });
      return { ok: false, reference: existing[0].reference, reason: `A recall for this payout already exists (${existing[0].reference}, ${existing[0].status.replace("_", " ")}). Give the customer that reference; a second recall can't be made.` };
    }
    // 6. Per-customer limit.
    const limit = rules.num("recall_limit", 3);
    const [{ n }] = await sql<{ n: number }[]>`
      select count(*)::int as n from recalls where business_id = ${user.business_id} and created_at > ${new Date(ctx.now.getTime() - 30 * 86_400_000)}`;
    if (n >= limit) {
      return refuse(ctx, T, input, `This business has reached ${limit} recalls in 30 days, so a new one needs a person to review it. Don't accuse the customer of anything; say it needs staff review and escalate.`, "recall limit reached");
    }
    // 5. The cap, read from the rules on this call.
    const capId = CAP_RULE[t.currency];
    const cap = rules.num(capId, Infinity);
    await ruleRead(ctx, rules, capId, `Recall cap (${t.currency})`);
    const overCap = Number(t.amount) > cap;
    const amount = money(t.amount, t.currency);
    const capText = money(cap, t.currency).replace(/\.00$/, "");

    // 8. The customer's yes, for this exact payout. Only the customer's message or button sets it.
    const waiting = await confirmFirst(
      ctx,
      T,
      t.id,
      `recall on ${t.id}`,
      `Recall the ${amount} payout to ${t.recipient_name} (${t.id})?`,
      overCap
        ? `It's above the ${capText} limit I can act on, so I'll prepare it and send it to our payments team for approval. Recovery isn't guaranteed.`
        : "I'll ask the receiving bank to return it. Recovery depends on the receiving bank and isn't guaranteed.",
    );
    if (waiting) return waiting;

    const [{ seq }] = await sql<{ seq: string }[]>`select nextval('recall_seq')::text as seq`;
    const reference = `REC-${seq}`;
    if (overCap) {
      await sql`insert into recalls (reference, transfer_id, business_id, conversation_id, user_id, amount, currency, status)
        values (${reference}, ${t.id}, ${user.business_id}, ${ctx.conv.id}, ${user.id}, ${t.amount}, ${t.currency}, 'awaiting_approval')`;
      await audit(ctx, { kind: "refusal", tool: T, summary: `${T} · refused: above cap ${capText}`, input, result: { prepared: reference }, refusal_reason: `Above the ${capText} recall cap` });
      await watch(sql, { conversationId: ctx.conv.id, holderId: user.business_id, userId: user.id, kind: "recall", reference, label: `recall of the ${amount} payout to ${t.recipient_name}`, status: "awaiting_approval" });
      return {
        ok: false,
        reference,
        reason: `The recall is above the ${capText} cap, so you cannot submit it. It has been prepared as ${reference} and needs a supervisor's approval. Now escalate with trigger recall_over_cap (urgency high), then tell the customer it needs approval from the payments team, that it's prepared with the details, when to expect a response, the reference, and that recovery isn't guaranteed once funds are credited.`,
      };
    }
    await sql`insert into recalls (reference, transfer_id, business_id, conversation_id, user_id, amount, currency, status)
      values (${reference}, ${t.id}, ${user.business_id}, ${ctx.conv.id}, ${user.id}, ${t.amount}, ${t.currency}, 'requested')`;
    await audit(ctx, { kind: "action", tool: T, summary: `${T} · ${t.id} · recall ${reference} requested`, input, result: { reference, amount } });
    await watch(sql, { conversationId: ctx.conv.id, holderId: user.business_id, userId: user.id, kind: "recall", reference, label: `recall of the ${amount} payout to ${t.recipient_name}`, status: "requested" });
    return {
      ok: true,
      reference,
      data: { reference, payout: t.id, amount, status: "Recall requested from the receiving bank", note: "Tell the customer it's requested, the reference, and that recovery depends on the receiving bank and isn't guaranteed. Don't predict the outcome or a date." },
    };
  },
};


// ---------------------------------------------------------------- get_kyc_status

const getKycStatus = {
  name: "get_kyc_status",
  tier: 1 as Tier,
  description:
    "The verified user's business verification: its status (Incomplete, Pending, Approved, Failed or Blocked), what is missing or why it failed, when it was submitted and how long the review has taken against the normal review time. Explain what to submit and how (through the dashboard); never accept documents or ID numbers in chat and never approve verification. Blocked follows the review-hold rule: no reason, hand off.",
  schema: z.object({}),
  async run(_input: Record<string, never>, ctx: ToolCtx, rules: Rules): Promise<ToolResult> {
    const user = ctx.user!;
    const [b] = await ctx.sql<{ verification_status: string; verification_reason: string | null; verification_missing: string | null; verification_submitted_at: Date | null }[]>`
      select verification_status, verification_reason, verification_missing, verification_submitted_at from businesses where id = ${user.business_id}`;
    const status = statusLabel(b.verification_status);
    let data: Record<string, unknown>;
    if (b.verification_status === "blocked") {
      // Blocked follows the no-tipping-off rule: nothing about why.
      data = { status, note: "The account cannot transact. You have no reason and must not suggest one. Say it needs review by a specialist team, escalate (trigger review_hold) and give the reference." };
    } else {
      const reviewDays = rules.num("kyc_review_days", 2);
      await ruleRead(ctx, rules, "kyc_review_days");
      const submitted = b.verification_submitted_at ? new Date(b.verification_submitted_at) : null;
      const elapsed = submitted ? businessDaysBetween(submitted, ctx.now, rules.hours()) : null;
      data = {
        status,
        business: user.business_name,
        ...(b.verification_reason ? { reason: b.verification_reason } : {}),
        ...(b.verification_missing ? { missing: b.verification_missing, how_to_submit: rules.get("kyc_how_to_submit")?.value } : {}),
        ...(submitted ? { submitted: dayMonthYear(submitted), business_days_so_far: Math.round((elapsed ?? 0) * 10) / 10 } : {}),
        ...(b.verification_status === "pending" ? { normal_review_time: `${reviewDays} business days`, past_window: (elapsed ?? 0) > reviewDays } : {}),
        ...(b.verification_status === "failed" ? { note: "A new application cannot simply be recreated." } : {}),
      };
    }
    await audit(ctx, { kind: "lookup", tool: "get_kyc_status", summary: `get_kyc_status · ${b.verification_status}`, result: data });
    return { ok: true, data };
  },
};

// ---------------------------------------------------------------- get_balance

const getBalance = {
  name: "get_balance",
  tier: 1 as Tier,
  description: "The verified user's business balances, one per currency held.",
  schema: z.object({}),
  async run(_input: Record<string, never>, ctx: ToolCtx, _rules: Rules): Promise<ToolResult> {
    const user = ctx.user!;
    const rows = await ctx.sql<{ currency: string; amount: string }[]>`
      select currency, amount from balances where business_id = ${user.business_id} order by currency`;
    const balances = rows.map((r) => ({ currency: r.currency, balance: money(r.amount, r.currency) }));
    await audit(ctx, { kind: "lookup", tool: "get_balance", summary: `get_balance · ${balances.map((b) => b.balance).join(", ") || "none"}`, result: balances });
    return { ok: true, data: { as_of: dateTime(ctx.now), balances } };
  },
};

// ---------------------------------------------------------------- get_fees

const feesSchema = z.object({
  kind: z.enum(["fee", "conversion", "both"]).optional().describe("Fees charged, currency conversions, or both (default)"),
  payout: z.string().optional().describe("A payout reference, to see the fee charged on it"),
  on: z.string().optional().describe("A date to look around, as YYYY-MM-DD"),
});

const getFees = {
  name: "get_fees",
  tier: 1 as Tier,
  description:
    "Fees charged to the verified user's business, each with what triggered it and the date, and currency conversions with the rate applied, the time, and the amounts in both currencies and the conversion fee. Show the figures; never predict rates or advise when to convert. If the customer says a fee or rate was wrongly applied, escalate (trigger fee_or_rate_disputed).",
  schema: feesSchema,
  async run(input: z.infer<typeof feesSchema>, ctx: ToolCtx, _rules: Rules): Promise<ToolResult> {
    const user = ctx.user!;
    const { sql } = ctx;
    const kind = input.kind ?? "both";
    const since = new Date(ctx.now.getTime() - 30 * 86_400_000);
    const rows = await sql<{ id: string; kind: string; description: string; trigger: string | null; transfer_id: string | null; currency: string; amount: string; from_currency: string | null; from_amount: string | null; to_currency: string | null; to_amount: string | null; rate: string | null; charged_at: Date; waivable: boolean; waived: string | null }[]>`
      select f.*, (select reference from waivers w where w.fee_id = f.id) as waived
      from fees f where business_id = ${user.business_id} and charged_at > ${since}
        ${kind !== "both" ? sql`and kind = ${kind}` : sql``}
        ${input.payout ? sql`and transfer_id = ${input.payout.trim().toUpperCase()}` : sql``}
      order by charged_at desc limit 40`;
    let list: typeof rows[number][] = [...rows];
    if (input.on) {
      const target = new Date(`${input.on}T12:00:00Z`).getTime();
      list = rows.filter((r) => Math.abs(new Date(r.charged_at).getTime() - target) < 2 * 86_400_000);
    }
    list = list.slice(0, 8);
    const items = list.map((r) =>
      r.kind === "conversion"
        ? {
            type: "Conversion",
            id: r.id,
            time: dateTime(new Date(r.charged_at)),
            converted: money(r.from_amount!, r.from_currency!),
            fee: money(r.amount, r.currency),
            rate: `1 ${r.from_currency} = ${Number(r.rate).toFixed(4)} ${r.to_currency}`,
            received: money(r.to_amount!, r.to_currency!),
            rule: "Rate shown at the time of conversion, with a 0.5% conversion fee (sample)",
          }
        : { type: "Fee", id: r.id, date: dateTime(new Date(r.charged_at)), fee: money(r.amount, r.currency), what: r.description, triggered_by: r.trigger, waivable: r.waivable, ...(r.waived ? { waived: r.waived } : {}) },
    );
    const conv = items.filter((i) => i.type === "Conversion").length;
    await audit(ctx, { kind: "lookup", tool: "get_fees", summary: `get_fees · ${conv ? `${conv} conversion${conv === 1 ? "" : "s"}, ` : ""}${items.length - conv} fee${items.length - conv === 1 ? "" : "s"}`, input, result: items });
    return { ok: true, data: items.length ? { items } : { items: [], note: "No fees or conversions match in the last 30 days." } };
  },
};

// ---------------------------------------------------------------- registry

// eslint-disable-next-line @typescript-eslint/no-explicit-any
const TOOLS: ToolDef<any>[] = [verifyIdentity, searchKnowledgeBase, escalateToHuman, getTransferStatus, generateProofOfPayment, findIncomingPayment, getAccountRestrictions, initiateRecall, getKycStatus, getBalance, getFees,
  sendOneTimeCode, sendResetLink, unlockAccount,
  getCard, freezeCard, orderReplacement, listTransactions, openDispute,
  findPayments, getReversalStatus, requestReversal, waiveFee, getAccountLimits,
  getPaymentById, getPaymentTimeline, getLoan, payoffQuote, requestDeferral, getPayoutStatus, listHolds,
  watchCase, draftClaimPack];

/** Tool definitions for the model. Order is fixed so the prompt cache holds. */
export function toolDefinitions(): Anthropic.Beta.BetaToolUnion[] {
  return TOOLS.map((t) => ({
    name: t.name,
    description: t.description,
    input_schema: z.toJSONSchema(t.schema) as Anthropic.Beta.BetaTool.InputSchema,
    eager_input_streaming: true,
  }));
}

/** Run one tool call: validate the input, run the identity check, then the tool's own checks. */
export async function runTool(name: string, rawInput: unknown, ctx: ToolCtx): Promise<ToolResult | typeof AWAITING_IDENTITY | typeof AWAITING_CODE> {
  const tool = TOOLS.find((t) => t.name === name);
  if (!tool) {
    await audit(ctx, { kind: "error", tool: name, summary: `${name} · no such tool` });
    return { ok: false, reason: `There is no tool called ${name}. You cannot do this; explain and offer a handoff.` };
  }
  // With eager input streaming the server doesn't validate inputs, so validate here.
  const parsed = tool.schema.safeParse(rawInput ?? {});
  if (!parsed.success) {
    await audit(ctx, { kind: "error", tool: name, summary: `${name} · invalid input`, input: rawInput });
    return { ok: false, reason: `INVALID_INPUT: ${parsed.error.message}` };
  }
  const rules = await Rules.load(ctx.sql); // fresh every call: a Rules screen edit applies at once
  // Check 1: an action with a switch on the Rules screen is refused while it's off.
  const sw = rules.get(`action_${name}`);
  if (sw && !rules.on(`action_${name}`)) {
    return refuse(ctx, name, parsed.data, `${sw.name.replace(/ switched on$/, "")} is switched off for this institution. Explain and offer a handoff.`, "switched off");
  }
  const idProblem = needsIdentity(tool.tier, ctx, tool.identity);
  if (idProblem) return refuse(ctx, name, parsed.data, idProblem, "identity not verified");
  return tool.run(parsed.data, ctx, rules);
}
