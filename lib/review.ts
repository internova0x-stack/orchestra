import Anthropic from "@anthropic-ai/sdk";
import type { Sql } from "./db.ts";
import { MODEL } from "./config.ts";
import { emitEvent } from "./api/webhooks.ts";
import { transcriptOf } from "./cases.ts";
import type { StaffUser } from "./staff.ts";
import { LANGUAGES } from "./session.ts";

// Operations (Nov 23): the team reviews finished conversations (good, or needs work with a note), and can
// read a conversation held in another language in English.

export async function saveReview(sql: Sql, conversationId: string, staff: StaffUser, rating: "good" | "needs_work", note: string | null) {
  const [c] = await sql<{ id: string }[]>`select id from conversations where id = ${conversationId} and mode = 'customer'`;
  if (!c) return "not_found" as const;
  const clean = note?.trim().slice(0, 1000) || null;
  await sql`insert into conversation_reviews (conversation_id, rating, note, reviewed_by, reviewed_at)
    values (${conversationId}, ${rating}, ${clean}, ${staff.name}, now())
    on conflict (conversation_id) do update set rating = excluded.rating, note = excluded.note, reviewed_by = excluded.reviewed_by, reviewed_at = excluded.reviewed_at`;
  await sql`insert into audit_log (conversation_id, tool_use_id, kind, tool, summary, staff)
    values (${conversationId}, ${`review-${Date.now()}`}, 'approval', 'review', ${`conversation reviewed · ${rating === "good" ? "good" : "needs work"}${clean ? ` · ${clean.slice(0, 120)}` : ""}`}, ${staff.name})`;
  await emitEvent(sql, "conversation.reviewed", { conversation_id: conversationId, rating, note: clean, by: staff.name });
  return null;
}

/** The conversation in English for the team, one line per message; nothing is stored or sent to the customer. */
export async function translateConversation(sql: Sql, conversationId: string): Promise<{ who: string; text: string }[] | "not_found"> {
  const [c] = await sql<{ messages: never; language: string }[]>`select messages, language from conversations where id = ${conversationId} and mode = 'customer'`;
  if (!c) return "not_found";
  const lines = transcriptOf(c.messages);
  if (!lines.length) return [];
  const client = new Anthropic({ maxRetries: 4 });
  const res = await client.messages.create({
    model: MODEL,
    max_tokens: 8000,
    system: `Translate a support conversation${LANGUAGES[c.language] ? ` (mostly ${LANGUAGES[c.language]})` : ""} into plain English for the bank's support team. Keep references, amounts, dates and names exactly as written. Return only the translation, one message per block, each starting with the speaker's label and a colon, blocks separated by a blank line.`,
    messages: [{ role: "user", content: lines.map((l) => `${l.who}: ${l.text}`).join("\n\n") }],
  });
  const text = res.content.map((b) => (b.type === "text" ? b.text : "")).join("");
  return text.split(/\n\s*\n/).map((b) => {
    const m = b.match(/^([^:\n]{1,60}):\s*([\s\S]*)$/);
    return m ? { who: m[1].trim(), text: m[2].trim() } : { who: "", text: b.trim() };
  }).filter((b) => b.text);
}
