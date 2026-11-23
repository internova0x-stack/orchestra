import type { Sql } from "./db.ts";

// The Staff queue (Escalation Playbook, "The staff queue in the demo"): one staff view acting as
// supervisor, no login. Approving a prepared recall submits it and records who approved it.

export const APPROVER = "Supervisor";

export type Decision = "approve" | "decline" | "resolve" | "claim_sent";

interface CaseRow {
  reference: string;
  conversation_id: string | null;
  status: string;
  action: { type: "recall" | "claim"; reference: string; payout?: string; amount?: string } | null;
}

export async function decide(sql: Sql, reference: string, decision: Decision, note: string | null) {
  return sql.begin(async (tx) => {
    const rows = await tx<CaseRow[]>`select reference, conversation_id, status, action from escalations where reference = ${reference} for update`;
    const c = rows[0];
    if (!c) return { ok: false as const, error: "not_found" };
    if (c.status !== "open") return { ok: false as const, error: "already_decided" };
    const now = new Date();
    const cleanNote = note?.trim().slice(0, 500) || null;

    if (decision === "resolve") {
      await tx`update escalations set status = 'resolved', resolution = ${cleanNote}, decided_at = ${now} where reference = ${reference}`;
      const message = `The team marked ${reference} resolved${cleanNote ? `: ${cleanNote}` : "."}`;
      await tx`insert into audit_log (conversation_id, kind, tool, summary, result, approver)
        values (${c.conversation_id}, 'approval', 'staff', ${`resolved by ${APPROVER} · ${reference}`}, ${tx.json({ message })}, ${APPROVER})`;
      return { ok: true as const, status: "resolved" };
    }

    if (decision === "claim_sent") {
      if (c.action?.type !== "claim") return { ok: false as const, error: "no_claim" };
      const sent = await tx`update claim_drafts set status = 'sent', sent_by = ${APPROVER}, sent_at = ${now} where reference = ${c.action.reference} and status = 'draft' returning reference, to_party`;
      if (!sent.length) return { ok: false as const, error: "already_decided" };
      await tx`update escalations set status = 'resolved', resolution = ${cleanNote ?? "Claim sent"}, decided_at = ${now} where reference = ${reference}`;
      const message = `The team sent claim ${c.action.reference} to ${String(sent[0].to_party).split(",")[0]}. We'll update you when they reply.`;
      await tx`insert into audit_log (conversation_id, kind, tool, summary, result, approver)
        values (${c.conversation_id}, 'approval', 'staff', ${`claim ${c.action.reference} sent by ${APPROVER}`}, ${tx.json({ message })}, ${APPROVER})`;
      return { ok: true as const, status: "resolved" };
    }

    if (!c.action || c.action.type !== "recall") return { ok: false as const, error: "nothing_to_approve" };
    const recall = c.action;
    const approved = decision === "approve";
    const updated = await tx`update recalls set status = ${approved ? "approved" : "declined"}, decided_by = ${APPROVER}, decided_at = ${now}
      where reference = ${recall.reference} and status = 'awaiting_approval' returning reference`;
    if (!updated.length) return { ok: false as const, error: "already_decided" };
    await tx`update escalations set status = ${approved ? "approved" : "declined"}, resolution = ${cleanNote}, decided_at = ${now} where reference = ${reference}`;
    const message = approved
      ? `The payments team approved the recall ${recall.reference} on ${recall.payout} (${recall.amount}). It has been sent to the receiving bank. Recovery isn't guaranteed.`
      : `The payments team declined the recall ${recall.reference} on ${recall.payout}. They'll be in touch to explain.`;
    await tx`insert into audit_log (conversation_id, kind, tool, summary, result, approver)
      values (${c.conversation_id}, ${approved ? "approval" : "refusal"}, 'staff',
              ${`${approved ? "approved" : "declined"} by ${APPROVER} · recall on ${recall.payout}`}, ${tx.json({ message, recall: recall.reference })}, ${APPROVER})`;
    return { ok: true as const, status: approved ? "approved" : "declined" };
  });
}
