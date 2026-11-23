import { z } from "zod";
import { audit, refuse, type Tier, type ToolCtx, type ToolResult } from "../toolkit.ts";
import type { Rules } from "../rules.ts";
import { maskAccount, money } from "../format.ts";
import { dateTime, longDate } from "../time.ts";
import { watch } from "../updates.ts";
import { emitEvent } from "../api/webhooks.ts";
import { bank } from "../bank/index.ts";

// Use case 18: back-office claim and evidence drafting. Alexis gathers the facts from the records
// and the case history into a draft for another bank, a processor or a card scheme, marks anything
// missing or uncertain, and puts it in the staff queue. A person reviews, edits and sends it; there
// is no tool that contacts an outside party.

export interface ClaimDraft {
  to: string;
  subject: string;
  facts: [string, string][];
  timeline: { stage: string; status: string; time: string; reported_by: string }[];
  evidence: string[];
  missing: string[];
  request: string;
}

const input = z.object({
  kind: z.enum(["recall", "chargeback", "settlement_query"]).describe("recall: ask the receiving bank to return a payout (REC- or PO- reference); chargeback: a card dispute to the card scheme (DSP- reference); settlement_query: a payment stuck with the processor (PAY- reference)"),
  reference: z.string().describe("The recall, payout, dispute or payment reference"),
});

/** The facts the case history already holds: each lookup and action in this conversation. */
async function caseHistory(ctx: ToolCtx): Promise<string[]> {
  const rows = await ctx.sql<{ summary: string; created_at: Date }[]>`
    select summary, created_at from audit_log where conversation_id = ${ctx.conv.id} and kind in ('lookup','action','handoff')
    order by id limit 20`;
  return rows.map((r) => `${dateTime(new Date(r.created_at))}: ${r.summary}`);
}

export const draftClaimPack = {
  name: "draft_claim_pack",
  tier: 1 as Tier,
  description:
    "When a case needs action from another bank, a processor or a card scheme (a recall, a chargeback, a settlement query), draft the claim pack from the records: payment references, amounts, dates, each stage of the timeline and who reported it, and the evidence. Anything missing or uncertain is marked, never guessed. The draft goes to the staff queue for a person to review, edit and send; you never send it. Then tell the customer the team will pursue it and they'll be updated.",
  schema: input,
  async run(i: z.infer<typeof input>, ctx: ToolCtx, rules: Rules): Promise<ToolResult> {
    const T = "draft_claim_pack";
    const user = ctx.user!;
    const ref = i.reference.trim().toUpperCase();
    const missing: string[] = [];
    let draft: ClaimDraft | null = null;
    let deadline: Date | null = null;
    let subject = ref;

    if (i.kind === "recall") {
      // The recall is Orchestra's record; the payout comes from the bank.
      const [byRecall] = await ctx.sql<{ transfer_id: string }[]>`select transfer_id from recalls where reference = ${ref} and business_id = ${user.business_id}`;
      const [transfer] = await bank(ctx.sql).searchTransfers(user.business_id, { reference: byRecall?.transfer_id ?? ref });
      const [recall] = transfer ? await ctx.sql<{ reference: string; status: string }[]>`select reference, status from recalls where transfer_id = ${transfer.id}` : [];
      const t = transfer ? { ...transfer, recall: recall?.reference ?? null, recall_status: recall?.status ?? null } : null;
      if (!t) return refuse(ctx, T, i, "No payout or recall with that reference on this account.", "not found");
      subject = t.recall ?? t.id;
      if (!t.recall) missing.push("No recall has been requested on this payout yet; request one first or note why not.");
      if (t.recall_status === "awaiting_approval") missing.push("The recall is still waiting for a supervisor's approval; don't send before it's approved.");
      if (!t.recipient_bank) missing.push("The receiving bank's name isn't in the records.");
      missing.push("The receiving bank's recall contact or reference format isn't in the records; staff to add it.");
      draft = {
        to: `${t.recipient_bank ?? "Receiving bank (unknown)"}, recalls team`,
        subject: `Recall request: ${money(t.amount, t.currency)} ${t.route} payout ${t.id} sent in error`,
        facts: [["Payout", t.id], ["Amount", money(t.amount, t.currency)], ["Sent", dateTime(new Date(t.sent_at))], ["Route", t.route], ["Beneficiary", `${t.recipient_name}, account ${maskAccount(t.recipient_account)}`], ["Beneficiary bank", t.recipient_bank ?? "unknown"], ["Our recall reference", t.recall ?? "not yet requested"], ["Status with us", t.status]],
        timeline: [],
        evidence: await caseHistory(ctx),
        missing,
        request: "Please return the funds to the remitting account, or confirm the beneficiary's consent is being sought. We understand recovery depends on the beneficiary and isn't guaranteed.",
      };
    } else if (i.kind === "chargeback") {
      // The dispute is Orchestra's record; the transaction comes from the bank.
      const [dispute] = await ctx.sql<{ reference: string; transaction_id: string; amount: string; currency: string; reason: string }[]>`
        select reference, transaction_id, amount, currency, reason from disputes where reference = ${ref} and holder_id = ${user.business_id}`;
      const [tx] = dispute ? await bank(ctx.sql).searchCardTransactions(user.business_id, { id: dispute.transaction_id }) : [];
      const d = dispute && tx ? { ...dispute, descriptor: tx.descriptor, merchant_name: tx.merchant_name, location: tx.location, at: tx.at, card_last4: tx.card_last4 } : null;
      if (!d) return refuse(ctx, T, i, "No dispute with that reference on this account. Open the dispute first.", "not found");
      subject = d.reference;
      const window = rules.num("dispute_window", 120);
      deadline = new Date(new Date(d.at).getTime() + window * 86_400_000);
      missing.push("The merchant's response (if any) isn't in the records.");
      if (d.reason === "not_received") missing.push("Proof of the expected delivery date isn't in the records; ask the customer for it.");
      draft = {
        to: "Card scheme disputes (via the acquirer)",
        subject: `Chargeback: ${money(d.amount, d.currency)} at ${d.merchant_name ?? d.descriptor}, reason ${d.reason.replace(/_/g, " ")}`,
        facts: [["Dispute", d.reference], ["Transaction", d.transaction_id], ["Statement name", d.descriptor], ["Merchant", d.merchant_name ?? "unknown"], ["Location", d.location ?? "unknown"], ["Amount", money(d.amount, d.currency)], ["Date", dateTime(new Date(d.at))], ["Card", d.card_last4 ? `•••• ${d.card_last4}` : "unknown"], ["Reason", d.reason.replace(/_/g, " ")], ["Filing deadline", longDate(deadline)]],
        timeline: [],
        evidence: await caseHistory(ctx),
        missing,
        request: "Please raise a chargeback for the amount above on the stated reason.",
      };
    } else {
      const { payment: p } = await bank(ctx.sql).getPayment(user.business_id, ref);
      if (!p) return refuse(ctx, T, i, "No payment with that reference on this account.", "not found");
      subject = p.id;
      const events = await bank(ctx.sql).getPaymentEvents(user.business_id, p.id);
      const stages = new Map<string, Set<string>>();
      for (const e of events) stages.set(e.stage, (stages.get(e.stage) ?? new Set()).add(e.status));
      if ([...stages.values()].some((st) => st.size > 1)) missing.push("UNCERTAIN: parties report conflicting statuses for the same stage. Don't send until staff resolve it.");
      if (!events.length) missing.push("No timeline is recorded for this payment.");
      draft = {
        to: `${p.processor ?? "Processor (unknown)"}, settlement queries`,
        subject: `Settlement query: ${money(p.amount, p.currency)} card payment ${p.id} at ${p.merchant_name}`,
        facts: [["Payment", p.id], ["Merchant", p.merchant_name], ["Amount", money(p.amount, p.currency)], ["Date", dateTime(new Date(p.at))], ["Card", p.card_last4 ? `•••• ${p.card_last4}` : "unknown"]],
        timeline: events.map((e) => ({ stage: e.stage, status: e.status === "ok" ? "Done" : "Failed", time: dateTime(new Date(e.at)), reported_by: e.reported_by })),
        evidence: await caseHistory(ctx),
        missing,
        request: "Please confirm the settlement status of this payment and when the funds will reach the merchant.",
      };
    }

    const [existing] = await ctx.sql<{ reference: string }[]>`select reference from claim_drafts where subject = ${subject} and kind = ${i.kind}`;
    if (existing) {
      await audit(ctx, { kind: "refusal", tool: T, summary: `${T} · refused: already drafted ${existing.reference}`, input: i, refusal_reason: "Duplicate claim draft" });
      return { ok: false, reference: existing.reference, reason: `A claim draft for this already exists (${existing.reference}) in the staff queue.` };
    }
    const [{ seq }] = await ctx.sql<{ seq: string }[]>`select nextval('claim_seq')::text as seq`;
    const reference = `CLM-${seq}`;
    const [{ n }] = await ctx.sql<{ n: string }[]>`select nextval('escalation_seq')::text as n`;
    const escalation = `ESC-${n}`;
    const urgent = deadline != null && deadline.getTime() - ctx.now.getTime() < 7 * 86_400_000;
    await ctx.sql`insert into claim_drafts (reference, kind, subject, holder_id, conversation_id, escalation_reference, to_party, draft, deadline)
      values (${reference}, ${i.kind}, ${subject}, ${user.business_id}, ${ctx.conv.id}, ${escalation}, ${draft!.to}, ${ctx.sql.json(draft as never)}, ${deadline})`;
    // The draft reaches staff as a case in the queue, with the draft attached.
    const summary = {
      reference: escalation, urgency: urgent ? "high" : "normal",
      customer: { business: user.business_name, user: user.full_name, role: user.role === "payment_rights" ? (user.personal ? "Personal account" : "Payment rights") : "View-only", identity: "Verified" },
      request: `${i.kind.replace(/_/g, " ")} on ${subject}`, checked: draft!.facts.map(([k, v]) => `${k}: ${v}`).join("; "),
      did: `Drafted claim pack ${reference}; not sent.`, why: "Claim pack ready for review", needed: "Review, edit and send the claim pack; Alexis can't contact other parties.",
      told: "The team will pursue it with the other party and the customer will be updated.", flags: draft!.missing.length ? ["Draft has missing or uncertain items"] : ["None"],
    };
    await ctx.sql`insert into escalations (reference, conversation_id, business_id, user_id, urgency, trigger, summary, respond_by, action)
      values (${escalation}, ${ctx.conv.id}, ${user.business_id}, ${user.id}, ${summary.urgency}, 'claim_draft', ${ctx.sql.json(summary)}, ${deadline}, ${ctx.sql.json({ type: "claim", reference } as never)})`;
    await emitEvent(ctx.sql, "case.created", { reference: escalation, conversation_id: ctx.conv.id, urgency: summary.urgency, trigger: "claim_draft", respond_by: deadline?.toISOString() ?? null, customer: { user_id: user.id, holder_id: user.business_id }, summary, action: { type: "claim", reference } });
    await watch(ctx.sql, { conversationId: ctx.conv.id, holderId: user.business_id, userId: user.id, kind: "case", reference: escalation, label: `claim with ${draft!.to.split(",")[0]}`, status: "open", expectedBy: deadline });
    await audit(ctx, { kind: "action", tool: T, summary: `${T} · ${subject} · ${reference} in the staff queue (${escalation})`, input: i, result: { reference, missing: draft!.missing } });
    return {
      ok: true,
      reference: escalation,
      data: { claim_draft: reference, case: escalation, to: draft!.to, missing_or_uncertain: draft!.missing, ...(deadline ? { filing_deadline: longDate(deadline), deadline_close: urgent } : {}), note: "Tell the customer the team will review and send it to the other party, give the case reference, and that they'll be updated. Don't promise the outcome." },
    };
  },
};
