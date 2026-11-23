import type { Sql } from "../db.ts";
import { handBack, staffReply, takeOver } from "../takeover.ts";
import type { StaffUser } from "../staff.ts";

// CRM team replies (Tomi, Nov 23): an agent working in the bank's CRM or helpdesk answers the customer there,
// and the reply reaches the customer through Orchestra on their channel, exactly like a reply typed in the
// console: the conversation is taken over in that person's name (Alexis pauses), the reply is masked for
// secrets, logged and sent as a message.created webhook. Handing back returns the conversation to Alexis.

/** The CRM agent as a member of the team: identified by name, logged with the API key that sent it. */
const crmStaff = (name: string): StaffUser => ({ id: `crm:${name.toLowerCase().replace(/[^a-z0-9]+/g, "-")}`, name, role: "support_agent" });

export type TeamReplyError = "bad_request" | "not_found" | "taken_over_by_someone_else" | "empty";

export async function teamReply(sql: Sql, conversationId: string, body: { name?: unknown; text?: unknown; hand_back?: unknown }, keyName: string): Promise<{ ok: true; handled_by: string | null } | { error: TeamReplyError; message: string }> {
  const name = typeof body.name === "string" ? body.name.replace(/[^\p{L}\p{N} .'-]/gu, "").trim().slice(0, 60) : "";
  const text = typeof body.text === "string" ? body.text : "";
  const handBackAfter = body.hand_back === true;
  if (!name) return { error: "bad_request", message: "Send the team member's name." };
  if (!text.trim() && !handBackAfter) return { error: "empty", message: "Send text, or hand_back: true." };
  const staff = crmStaff(name);
  if (text.trim()) {
    const took = await takeOver(sql, conversationId, staff);
    if (took === "not_found") return { error: "not_found", message: "No such conversation." };
    if (took === "taken_over_by_someone_else") return { error: "taken_over_by_someone_else", message: "Another member of the team is handling this conversation." };
    const err = await staffReply(sql, conversationId, staff, text);
    if (err === "empty") return { error: "empty", message: "The reply was empty." };
    if (err) return { error: "taken_over_by_someone_else", message: "Another member of the team is handling this conversation." };
    await sql`insert into audit_log (conversation_id, tool_use_id, kind, tool, summary, staff)
      values (${conversationId}, ${`crm-${Date.now()}`}, 'action', 'team_reply_api', ${`reply from ${name} arrived from ${keyName} (Orchestra API)`}, ${name})`;
  }
  if (handBackAfter) {
    const err = await handBack(sql, conversationId, staff);
    if (err === "not_found") return { error: "not_found", message: "No such conversation." };
    if (err === "taken_over_by_someone_else") return { error: "taken_over_by_someone_else", message: "Another member of the team is handling this conversation." };
  }
  const [c] = await sql<{ taken_over_by: string | null }[]>`select taken_over_by from conversations where id = ${conversationId}`;
  return { ok: true, handled_by: c?.taken_over_by ?? null };
}
