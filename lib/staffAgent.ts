import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import { appendTurn } from "./takeover.ts";
import type { Sql } from "./db.ts";
import { ROLE_NAME } from "./auth.ts";
import { recordUsage } from "./usage.ts";
import { EFFORT, MAX_STEPS, MAX_TOKENS, MODEL } from "./config.ts";
import { staffUser } from "./staff.ts";
import { loadConversation, verifiedUser, type Conversation } from "./session.ts";
import { dateTime, longDate } from "./time.ts";
import { runTool, toolDefinitions, type StreamEvent, type ToolResult } from "./tools.ts";

// Use case 19: staff mode. The same Alexis, used by a signed-in staff member on one case: it
// investigates with the lookup tools, summarises, drafts replies and case notes. No actions on the
// account; everything is logged under the staff member's name.

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ContentBlockParam = Anthropic.Beta.BetaContentBlockParam;
type ToolResultParam = Anthropic.Beta.BetaToolResultBlockParam;

let prompt: string | null = null;
const staffPrompt = () => (prompt ??= fs.readFileSync(path.join(process.cwd(), "prompts", "staff-mode.md"), "utf8").trim());

export async function runStaffTurn(
  sql: Sql,
  input: { sessionId: string; caseRef: string; staffId: string; message: string },
  emit: (e: StreamEvent) => void,
) {
  const staff = await staffUser(sql, input.staffId);
  const [kase] = await sql<{ reference: string; user_id: string | null; business_id: string | null }[]>`
    select reference, user_id, business_id from escalations where reference = ${input.caseRef}`;
  if (!staff || !kase) {
    emit({ type: "error", message: !staff ? "Sign in as a staff member first." : "That case doesn't exist." });
    emit({ type: "done" });
    return;
  }
  const now = new Date();
  let conv: Conversation | null = await loadConversation(sql, input.sessionId);
  if (!conv) {
    // The staff member works on the case's customer, whose identity was verified in the original chat.
    const rows = await sql<Conversation[]>`
      insert into conversations (id, mode, staff_id, case_reference, verified_user_id, verified_at, last_activity)
      values (${input.sessionId}, 'staff', ${staff.id}, ${kase.reference}, ${kase.user_id}, ${kase.user_id ? now : null}, ${now}) returning *`;
    conv = rows[0];
  }
  if ((conv as unknown as { mode: string }).mode !== "staff" || (conv as unknown as { case_reference: string }).case_reference !== kase.reference) {
    emit({ type: "error", message: "This staff session belongs to another case." });
    emit({ type: "done" });
    return;
  }
  await sql`update conversations set last_activity = ${now} where id = ${conv.id}`;
  const user = await verifiedUser(sql, { ...conv, last_activity: now }, now);
  const label = `${staff.name} (${ROLE_NAME[staff.role]})`;
  const context = [
    `Staff session: ${label}. Case ${kase.reference}. It is ${longDate(now)}, ${dateTime(now).split(", ")[1]} Lagos time.`,
    user ? `The case's customer: ${user.full_name}, ${user.business_name}${user.personal ? "" : `, ${user.role === "payment_rights" ? "payment rights" : "view-only"}`}.` : "The case's customer was never verified, so their account records can't be looked up; work from the case materials.",
  ].join("\n");

  // The session facts go after the history as a system message (kept), never into the top-level system
  // prompt: an edited prefix invalidates Claude's earlier thinking and the request is refused.
  const messages = [
    ...(appendTurn(conv.messages as never, "user", [{ type: "text", text: input.message.slice(0, 4000) }]) as unknown as MessageParam[]),
    { role: "system", content: context } as unknown as MessageParam,
  ];
  const client = new Anthropic({ maxRetries: 4 });
  let saved = [...messages];
  let wroteText = false;
  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const stream = client.beta.messages.stream({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        betas: ["server-side-fallback-2026-07-01", "thinking-binding-controls-2026-08-01"],
        thinking: { type: "adaptive", block_binding: { prefix_mismatch_behavior: "drop_block" } } as never,
        fallbacks: "default",
        output_config: { effort: EFFORT },
        system: [
          { type: "text", text: staffPrompt(), cache_control: { type: "ephemeral" } },
        ],
        tools: toolDefinitions("staff"),
        messages,
      });
      let broke = false;
      for await (const ev of stream) {
        if (ev.type === "content_block_start" && ev.content_block.type === "tool_use") emit({ type: "tool_start", id: ev.content_block.id, name: ev.content_block.name });
        else if (ev.type === "content_block_delta" && ev.delta.type === "text_delta" && ev.delta.text) {
          if (wroteText && !broke) { emit({ type: "break" }); broke = true; }
          emit({ type: "text", delta: ev.delta.text });
        }
      }
      const msg = await stream.finalMessage();
      await recordUsage(sql, { purpose: "staff_mode", model: msg.model, usage: msg.usage });
      if (msg.content.some((b) => b.type === "text" && b.text.trim())) wroteText = true;
      if (msg.stop_reason === "refusal") break;
      const uses = msg.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      if (msg.stop_reason === "max_tokens" && uses.length) throw new Error("Tool input was cut off");
      messages.push({ role: "assistant", content: msg.content as ContentBlockParam[] });
      if (msg.stop_reason !== "tool_use" || !uses.length) { saved = [...messages]; break; }
      const results: ToolResultParam[] = [];
      for (const u of uses) {
        let out: ToolResult;
        try {
          const r = await runTool(u.name, u.input, { sql, conv, user, now: new Date(), toolUseId: u.id, emit, staff: label }, "staff");
          out = typeof r === "object" ? r : { ok: false, reason: "Not available in staff mode." };
        } catch (err) {
          console.error("staff tool failed", err);
          out = { ok: false, reason: "SYSTEM_ERROR: this tool failed. Say so." };
        }
        emit({ type: "tool_end", id: u.id, name: u.name, ok: out.ok });
        results.push({ type: "tool_result", tool_use_id: u.id, content: JSON.stringify(out), is_error: !out.ok });
      }
      messages.push({ role: "user", content: results });
      saved = [...messages];
    }
  } catch (err) {
    console.error("staff turn failed", err);
    emit({ type: "error", message: err instanceof Anthropic.AuthenticationError ? "The AI service rejected the API key." : "Something went wrong. Try again." });
  } finally {
    await sql`update conversations set messages = ${sql.json(saved as never)}, last_activity = ${new Date()} where id = ${conv.id}`;
    emit({ type: "done" });
  }
}
