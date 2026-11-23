import type { Sql } from "./db.ts";
import { bank } from "./bank/index.ts";

// The Staff queue (Escalation Playbook, "The staff queue in the demo"): one staff view acting as
// supervisor, no login. Approving a prepared recall submits it and records who approved it.

export const APPROVER = "Supervisor";

export interface StaffUser { id: string; name: string; role: "support_agent" | "supervisor" }

export async function staffUser(sql: Sql, id: string | null | undefined): Promise<StaffUser | null> {
  if (!id) return null;
  const [s] = await sql<StaffUser[]>`select id, name, role from staff_users where id = ${id}`;
  return s ?? null;
}

export type Decision = "approve" | "decline" | "resolve" | "claim_sent";

interface CaseRow {
  reference: string;
  conversation_id: string | null;
  status: string;
  action: { type: "recall" | "claim"; reference: string; payout?: string; amount?: string } | null;
}

export async function decide(sql: Sql, reference: string, decision: Decision, note: string | null, staff?: StaffUser | null) {
  // Only a supervisor approves or declines a prepared action (Escalation Playbook, staff mode).
  if ((decision === "approve" || decision === "decline") && staff && staff.role !== "supervisor") {
    return { ok: false as const, error: "supervisor_only" };
  }
  const who = staff ? `${staff.name} (${staff.role === "supervisor" ? "Supervisor" : "Support agent"})` : APPROVER;
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
        values (${c.conversation_id}, 'approval', 'staff', ${`resolved by ${who} · ${reference}`}, ${tx.json({ message })}, ${who})`;
      return { ok: true as const, status: "resolved" };
    }

    if (decision === "claim_sent") {
      if (c.action?.type !== "claim") return { ok: false as const, error: "no_claim" };
      const sent = await tx`update claim_drafts set status = 'sent', sent_by = ${who}, sent_at = ${now} where reference = ${c.action.reference} and status = 'draft' returning reference, to_party`;
      if (!sent.length) return { ok: false as const, error: "already_decided" };
      await tx`update escalations set status = 'resolved', resolution = ${cleanNote ?? "Claim sent"}, decided_at = ${now} where reference = ${reference}`;
      const message = `The team sent claim ${c.action.reference} to ${String(sent[0].to_party).split(",")[0]}. We'll update you when they reply.`;
      await tx`insert into audit_log (conversation_id, kind, tool, summary, result, approver)
        values (${c.conversation_id}, 'approval', 'staff', ${`claim ${c.action.reference} sent by ${who}`}, ${tx.json({ message })}, ${who})`;
      return { ok: true as const, status: "resolved" };
    }

    if (!c.action || c.action.type !== "recall") return { ok: false as const, error: "nothing_to_approve" };
    const recall = c.action;
    const approved = decision === "approve";
    if (approved) {
      // An approved recall is submitted to the bank through the Bank Connector API.
      const [r] = await tx<{ business_id: string; transfer_id: string; amount: string; currency: string; user_id: string | null; status: string }[]>`
        select business_id, transfer_id, amount, currency, user_id, status from recalls where reference = ${recall.reference}`;
      if (!r || r.status !== "awaiting_approval") return { ok: false as const, error: "already_decided" };
      try {
        const sent = await bank(tx as unknown as Sql).requestRecall(r.business_id, { transfer_id: r.transfer_id, amount: String(r.amount), currency: r.currency, reference: recall.reference, requested_by: r.user_id ?? "customer", approved_by: who }, recall.reference);
        if (!sent.accepted) return { ok: false as const, error: "bank_refused" };
      } catch {
        return { ok: false as const, error: "bank_unavailable" };
      }
    }
    const updated = await tx`update recalls set status = ${approved ? "approved" : "declined"}, decided_by = ${staff ? who : APPROVER}, decided_at = ${now}
      where reference = ${recall.reference} and status = 'awaiting_approval' returning reference`;
    if (!updated.length) return { ok: false as const, error: "already_decided" };
    await tx`update escalations set status = ${approved ? "approved" : "declined"}, resolution = ${cleanNote}, decided_at = ${now} where reference = ${reference}`;
    const message = approved
      ? `The payments team approved the recall ${recall.reference} on ${recall.payout} (${recall.amount}). It has been sent to the receiving bank. Recovery isn't guaranteed.`
      : `The payments team declined the recall ${recall.reference} on ${recall.payout}. They'll be in touch to explain.`;
    await tx`insert into audit_log (conversation_id, kind, tool, summary, result, approver)
      values (${c.conversation_id}, ${approved ? "approval" : "refusal"}, 'staff',
              ${`${approved ? "approved" : "declined"} by ${APPROVER} · recall on ${recall.payout}`}, ${tx.json({ message, recall: recall.reference })}, ${who})`;
    return { ok: true as const, status: approved ? "approved" : "declined" };
  });
}
