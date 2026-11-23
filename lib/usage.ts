import type { Sql } from "./db.ts";

// AI usage (Nov 23, for billing): every model call records its tokens, so the Billing page can show what the AI
// cost per conversation and per month. Recording never fails the call it measures.

export interface Usage {
  input_tokens?: number | null;
  output_tokens?: number | null;
  cache_read_input_tokens?: number | null;
  cache_creation_input_tokens?: number | null;
}

export async function recordUsage(sql: Sql, row: { conversationId?: string | null; purpose: string; model: string; usage?: Usage | null }) {
  const u = row.usage;
  if (!u) return;
  try {
    await sql`insert into ai_usage (conversation_id, purpose, model, input_tokens, output_tokens, cache_read_tokens, cache_write_tokens)
      values (${row.conversationId ?? null}, ${row.purpose}, ${row.model}, ${u.input_tokens ?? 0}, ${u.output_tokens ?? 0},
              ${u.cache_read_input_tokens ?? 0}, ${u.cache_creation_input_tokens ?? 0})`;
  } catch (err) {
    console.error("usage not recorded", err);
  }
}
