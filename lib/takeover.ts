import type { Sql } from "./db.ts";
import { maskSecrets } from "./secrets.ts";
import type { StaffUser } from "./staff.ts";

// A member of the team takes over a conversation from the console, replies in person, then hands it
// back to Alexis. The conversation's history stays one list in the model's format (user and assistant
// turns alternating), so Alexis can carry on afterwards with everything that was said:
// - a staff reply is an assistant text block carrying `staff` (the person's name);
// - two messages in a row from the same side join one turn instead of breaking the alternation;
// - before the history reaches the model, `forModel` turns staff blocks into plain, labelled text.

type Block = { type: string; text?: string; staff?: string; [k: string]: unknown };
type Message = { role: "user" | "assistant" | "system"; content: string | Block[] };

const blocks = (c: string | Block[]): Block[] => (typeof c === "string" ? [{ type: "text", text: c }] : c);

/**
 * Add one turn's content, joining it to the last turn when that turn is from the same side. A session
 * note (role "system") must be followed by Alexis's reply; if a turn stopped before she answered, the
 * trailing note is dropped before the next customer message (nothing comes after it, so nothing breaks).
 */
export function appendTurn(messages: Message[], role: "user" | "assistant", content: Block[]): Message[] {
  const out = [...messages];
  while (role === "user" && out.length && out[out.length - 1].role === "system") out.pop();
  const last = out[out.length - 1];
  if (last && last.role === role) out[out.length - 1] = { role, content: [...blocks(last.content), ...content] };
  else out.push({ role, content });
  return out;
}

/** The history as the model takes it: staff replies become labelled text, nothing extra on any block. */
export function forModel(messages: Message[]): Message[] {
  return messages.map((m) => ({
    role: m.role,
    content: typeof m.content === "string" ? m.content : m.content.map((b) => {
      if (!b.staff) return b;
      return { type: "text", text: `[Reply from ${b.staff}, a member of the support team, who took over the chat]\n${b.text ?? ""}` };
    }),
  }));
}

/** Whether a member of the team has replied in this conversation, for Alexis's session context. */
export const hadStaff = (messages: Message[]) => messages.some((m) => typeof m.content !== "string" && m.content.some((b) => b.staff));

async function log(sql: Sql, conversationId: string, staff: string, kind: "handoff" | "action", tool: string, summary: string) {
  await sql`insert into audit_log (conversation_id, tool_use_id, kind, tool, summary, staff)
    values (${conversationId}, ${`${tool}-${Date.now()}`}, ${kind}, ${tool}, ${summary}, ${staff})`;
}

const roleWord = (s: StaffUser) => (s.role === "supervisor" ? "supervisor" : "support agent");

export type TakeoverError = "not_found" | "taken_over_by_someone_else" | "not_taken_over" | "empty";

/**
 * Take a conversation over. Anything Alexis left waiting on the customer is closed first (the
 * identity form, the code form, a Yes/Cancel), so nothing can be confirmed while a person is in charge.
 */
export async function takeOver(sql: Sql, conversationId: string, staff: StaffUser): Promise<TakeoverError | null> {
  return sql.begin(async (tx) => {
    const [c] = await tx<{ messages: Message[]; taken_over_by: string | null; pending_identity_tool_id: string | null; pending_code: { tool_use_id: string } | null; pending_results: Block[]; pending_action: { label: string } | null }[]>`
      select messages, taken_over_by, pending_identity_tool_id, pending_code, pending_results, pending_action
      from conversations where id = ${conversationId} and mode = 'customer' for update`;
    if (!c) return "not_found";
    if (c.taken_over_by === staff.name) return null;
    if (c.taken_over_by) return "taken_over_by_someone_else";
    let messages = c.messages ?? [];
    const open = c.pending_identity_tool_id ?? c.pending_code?.tool_use_id ?? null;
    if (open) {
      const closed = { type: "tool_result", tool_use_id: open, content: JSON.stringify({ ok: false, reason: "A member of the support team took over the conversation before this was completed." }), is_error: true };
      messages = appendTurn(messages, "user", [...(c.pending_results ?? []), closed]);
    }
    await tx`update conversations set taken_over_by = ${staff.name}, taken_over_at = now(), messages = ${tx.json(messages as never)},
      pending_identity_tool_id = null, pending_code = null, pending_results = '[]', pending_action = null
      where id = ${conversationId}`;
    if (c.pending_action) await log(tx as unknown as Sql, conversationId, staff.name, "handoff", "takeover", `waiting confirmation cancelled · ${c.pending_action.label}`);
    await log(tx as unknown as Sql, conversationId, staff.name, "handoff", "takeover", `${staff.name} (${roleWord(staff)}) took over the conversation · Alexis paused`);
    return null;
  });
}

/** Hand the conversation back to Alexis. She answers the customer's next message. */
export async function handBack(sql: Sql, conversationId: string, staff: StaffUser): Promise<TakeoverError | null> {
  const [c] = await sql<{ taken_over_by: string | null }[]>`select taken_over_by from conversations where id = ${conversationId} and mode = 'customer'`;
  if (!c) return "not_found";
  if (!c.taken_over_by) return "not_taken_over";
  if (c.taken_over_by !== staff.name) return "taken_over_by_someone_else";
  await sql`update conversations set taken_over_by = null, taken_over_at = null where id = ${conversationId}`;
  await log(sql, conversationId, staff.name, "handoff", "handback", `${staff.name} handed the conversation back to Alexis`);
  return null;
}

/** A reply typed by the person who took the conversation over. */
export async function staffReply(sql: Sql, conversationId: string, staff: StaffUser, text: string): Promise<TakeoverError | null> {
  const clean = maskSecrets(text.trim().slice(0, 4000)).text;
  if (!clean) return "empty";
  return sql.begin(async (tx) => {
    const [c] = await tx<{ messages: Message[]; taken_over_by: string | null }[]>`
      select messages, taken_over_by from conversations where id = ${conversationId} and mode = 'customer' for update`;
    if (!c) return "not_found";
    if (!c.taken_over_by) return "not_taken_over";
    if (c.taken_over_by !== staff.name) return "taken_over_by_someone_else";
    const messages = appendTurn(c.messages ?? [], "assistant", [{ type: "text", text: clean, staff: staff.name }]);
    await tx`update conversations set messages = ${tx.json(messages as never)}, last_activity = now() where id = ${conversationId}`;
    await log(tx as unknown as Sql, conversationId, staff.name, "action", "staff_reply", `${staff.name} replied to the customer`);
    return null;
  });
}

/** What the customer's app needs while it's open: who is handling the chat, the team's replies, and decisions. */
export async function customerView(sql: Sql, conversationId: string) {
  const [c] = await sql<{ messages: Message[]; taken_over_by: string | null }[]>`
    select messages, taken_over_by from conversations where id = ${conversationId} and mode = 'customer'`;
  if (!c) return { takenOverBy: null, staff: [], updates: [] };
  const staff: { key: string; name: string; text: string }[] = [];
  (c.messages ?? []).forEach((m, i) => {
    if (typeof m.content === "string" || m.role === "system") return;
    m.content.forEach((b, j) => { if (b.staff && b.text) staff.push({ key: `${i}-${j}`, name: b.staff, text: b.text }); });
  });
  // The team's decisions on this conversation's cases (approve, decline, resolve), as the Staff queue words them.
  const rows = await sql<{ id: number; result: { message?: string } | null }[]>`
    select id, result from audit_log where conversation_id = ${conversationId} and approver is not null order by id`;
  const updates = rows.filter((r) => r.result?.message).map((r) => ({ id: r.id, message: r.result!.message! }));
  return { takenOverBy: c.taken_over_by, staff, updates };
}
