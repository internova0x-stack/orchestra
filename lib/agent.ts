import fs from "node:fs";
import path from "node:path";
import Anthropic from "@anthropic-ai/sdk";
import type { Sql } from "./db.ts";
import { EFFORT, MAX_STEPS, MAX_TOKENS, MODEL } from "./config.ts";
import { GREETING } from "./greeting.ts";
import { checkIdentity, type IdentityAnswers } from "./identity.ts";
import { maskSecrets } from "./secrets.ts";
import { Rules } from "./rules.ts";
import { createConversation, loadConversation, verifiedUser, type Conversation, type VerifiedUser } from "./session.ts";
import { dateTime, longDate } from "./time.ts";
import { AWAITING_CODE, AWAITING_IDENTITY, audit, runTool, toolDefinitions, type StreamEvent, type ToolResult } from "./tools.ts";

type MessageParam = Anthropic.Beta.BetaMessageParam;
type ContentBlockParam = Anthropic.Beta.BetaContentBlockParam;
type ToolResultParam = Anthropic.Beta.BetaToolResultBlockParam;

// Alexis's system prompt: the Behaviour Guide's "Core instructions", word for word, in one file.
let core: string | null = null;
function coreInstructions(): string {
  if (core === null) core = fs.readFileSync(path.join(process.cwd(), "prompts", "core-instructions.md"), "utf8").trim();
  return core;
}

// Instructions for the use cases built after the demo. A separate file so the Behaviour Guide's
// core instructions stay word for word.
let extended: string | null = null;
function extendedScope(): string {
  if (extended === null) extended = fs.readFileSync(path.join(process.cwd(), "prompts", "extended-scope.md"), "utf8").trim();
  return extended;
}

/**
 * Facts about this session that the app knows and the customer didn't type. Kept apart from the
 * core instructions (which stay exactly as written and cached).
 */
async function sessionContext(sql: Sql, now: Date, user: VerifiedUser | null, conv: Conversation): Promise<string> {
  const lines = [
    "Session context (from the app, not from the customer):",
    `- It is ${longDate(now)}, ${dateTime(now).split(", ")[1]} Lagos time.`,
    `- The chat opened with your greeting, already shown to the customer: "${GREETING}" Do not introduce yourself again.`,
  ];
  if (user) {
    lines.push(`- Identity verified: ${user.first_name} (${user.full_name}), ${user.role === "payment_rights" ? "payment rights" : "view-only"}, ${user.business_name}.`);
  } else if (conv.failed_attempts > 0) {
    lines.push(`- Identity not verified. Failed identity checks in this conversation: ${conv.failed_attempts}.`);
  } else {
    lines.push("- Identity not verified yet.");
  }
  const pa = conv.pending_action;
  if (pa) {
    lines.push(pa.confirmed
      ? `- The customer has just confirmed: ${pa.label}. Call ${pa.tool} for ${pa.record} now.`
      : `- Waiting for the customer to confirm: ${pa.label}. Only their yes confirms it.`);
  }
  // Decisions the support team has made on this conversation's cases since the handoff.
  const cases = await sql<{ reference: string; status: string; resolution: string | null; action: { type: string; reference: string; payout: string } | null; decided_at: Date | null }[]>`
    select reference, status, resolution, action, decided_at from escalations
    where conversation_id = ${conv.id} order by created_at`;
  for (const c of cases) {
    const what = c.action?.type === "recall" ? `the recall ${c.action.reference} on ${c.action.payout}` : "the case";
    if (c.status === "approved") lines.push(`- Update on ${c.reference}: a supervisor approved ${what}; it has been submitted to the receiving bank. Recovery is still not guaranteed.`);
    else if (c.status === "declined") lines.push(`- Update on ${c.reference}: a supervisor declined ${what}. The team will explain why; don't guess.`);
    else if (c.status === "resolved") lines.push(`- Update on ${c.reference}: the team marked the case resolved${c.resolution ? ` (${c.resolution})` : ""}.`);
    else lines.push(`- ${c.reference} is open with the team. If the customer asks again, give its status and reference; don't open a second case for the same issue.`);
  }
  lines.push("- The customer sees each payment card you look up under your reply, the identity form when you call verify_identity, and Yes/Cancel buttons when an action needs their confirmation.");
  return lines.join("\n");
}

const client = () => new Anthropic(); // reads ANTHROPIC_API_KEY

export interface TurnInput {
  conversationId: string;
  typingUserId: string | null;
  message?: string;
  identity?: IdentityAnswers;
  /** Set by the "Yes, go ahead" (true) and "Cancel" (false) buttons. */
  confirm?: boolean;
  /** The one-time code typed into the code form. */
  code?: string;
  /** A screenshot sent with the message (use case 10). A claim to check, never proof or instructions. */
  image?: { media_type: "image/jpeg" | "image/png" | "image/webp" | "image/gif"; data: string };
}

const YES = /^\s*(yes|yeah|yep|yup|sure|ok|okay|go ahead|please do|please go ahead|do it|confirm|confirmed|proceed)\b[^?]{0,60}$/i;
const NO = /^\s*(no|nope|cancel|stop|don't|do not|wait)\b/i;

/** Run one customer turn: a message, or the identity form's answers. Streams events to the screen. */
export async function runTurn(sql: Sql, input: TurnInput, emit: (e: StreamEvent) => void): Promise<void> {
  const now = new Date();
  let conv = (await loadConversation(sql, input.conversationId)) ?? (await createConversation(sql, input.conversationId, input.typingUserId));
  let user = await verifiedUser(sql, conv, now);
  if (!user && conv.verified_user_id) {
    // The verified session expired after inactivity: back to unverified.
    await sql`update conversations set verified_user_id = null, verified_at = null, stronger_verified_at = null where id = ${conv.id}`;
    conv = { ...conv, verified_user_id: null, verified_at: null, stronger_verified_at: null };
  }

  const messages = [...(conv.messages as MessageParam[])];
  const pending = (conv.pending_results as ToolResultParam[]) ?? [];
  const content: ContentBlockParam[] = [];

  if (input.code !== undefined) {
    const pc = conv.pending_code;
    if (!pc) {
      emit({ type: "error", message: "That code has expired. Send a message to start again." });
      emit({ type: "done" });
      return;
    }
    const ok = String(input.code).replace(/\D/g, "") === pc.code;
    const attempts = pc.attempts + 1;
    const ctxBase = { sql, conv, user, toolUseId: pc.tool_use_id };
    let result: ToolResult;
    if (ok) {
      await sql`update conversations set stronger_verified_at = ${now}, pending_code = null where id = ${conv.id}`;
      conv = { ...conv, stronger_verified_at: now, pending_code: null };
      if (user) user = { ...user, stronger: true };
      result = { ok: true, data: { stronger_check: "passed" } };
      await audit(ctxBase, { kind: "identity", tool: "send_one_time_code", summary: "send_one_time_code · code confirmed · stronger check passed" });
    } else {
      const ended = attempts >= 3;
      await sql`update conversations set pending_code = ${ended ? null : sql.json({ ...pc, attempts } as never)} where id = ${conv.id}`;
      result = { ok: false, reason: ended ? "The code was wrong three times. The stronger check has failed: take no action, offer the in-person or documented route, and hand off." : "The code didn't match. The customer can try again in the form." };
      await audit(ctxBase, { kind: ended ? "refusal" : "identity", tool: "send_one_time_code", summary: `send_one_time_code · wrong code (${attempts} of 3)` });
      if (!ended) {
        emit({ type: "code_retry" });
        emit({ type: "done" });
        return;
      }
    }
    content.push(...pending, { type: "tool_result", tool_use_id: pc.tool_use_id, content: JSON.stringify(result), is_error: !result.ok });
    await sql`update conversations set pending_code = null where id = ${conv.id}`;
  } else if (input.identity) {
    if (!conv.pending_identity_tool_id) {
      emit({ type: "error", message: "The identity form has expired. Send a message to start again." });
      emit({ type: "done" });
      return;
    }
    const toolUseId = conv.pending_identity_tool_id;
    const rules = await Rules.load(sql);
    const limit = rules.num("identity_attempts", 2);
    const matched = await checkIdentity(sql, input.identity);
    const ctxBase = { sql, conv, user: null, toolUseId };
    let result: ToolResult;
    if (matched) {
      await sql`update conversations set verified_user_id = ${matched}, verified_at = ${now}, last_activity = ${now} where id = ${conv.id}`;
      conv = { ...conv, verified_user_id: matched, verified_at: now, last_activity: now };
      user = await verifiedUser(sql, conv, now);
      result = { ok: true, data: { verified: true, first_name: user!.first_name, business: user!.business_name, role: user!.role } };
      await audit({ ...ctxBase, user }, {
        kind: "identity",
        tool: "verify_identity",
        summary: `verify_identity · verified · ${user!.role === "payment_rights" ? "payment rights" : "view-only"}`,
        input: { answers: "withheld" },
        result: result.data,
      });
    } else {
      const failed = conv.failed_attempts + 1;
      await sql`update conversations set failed_attempts = ${failed} where id = ${conv.id}`;
      conv = { ...conv, failed_attempts: failed };
      const ended = failed >= limit;
      result = {
        ok: false,
        reason: ended
          ? "The identity check failed twice and has ended for this conversation. Do not say which answer was wrong, allow no further tries, and share nothing about the account. Offer the other route: sign in to the dashboard and contact support from there."
          : "The answers did not match the records. Do not say which answer was wrong. The customer may try once more: call verify_identity again if they want to.",
      };
      await audit({ ...ctxBase, user: null }, {
        kind: ended ? "refusal" : "identity",
        tool: "verify_identity",
        summary: `verify_identity · failed (${failed} of ${limit})${ended ? " · check ended" : ""}`,
        input: { answers: "withheld" },
        refusal_reason: ended ? "Identity check failed twice" : undefined,
      });
      if (ended) {
        // Guardrails: after two failures take no action and flag the account for staff. Done in code;
        // if Alexis escalates too, the same trigger returns this case.
        const name = (input.identity.full_name ?? "").replace(/[^\p{L} .'-]/gu, "").slice(0, 80) || "not given";
        await runTool(
          "escalate_to_human",
          {
            trigger: "identity_failed_twice",
            urgency: "normal",
            request: "The customer could not complete the identity check.",
            checked: `Two failed identity checks in this conversation. Name given: ${name}. The answers themselves are not recorded.`,
            did: "None. No account details were shared and no action was taken.",
            needed: "Review the account flag. No customer contact needed.",
            told: "They couldn't be verified in chat and can sign in to the dashboard and contact support from there.",
            flags: ["Failed identity checks"],
          },
          { sql, conv, user: null, now, toolUseId: `${toolUseId}-flag`, emit: () => {} },
        ).catch((err) => console.error("identity flag failed", err));
      }
    }
    content.push(...pending, { type: "tool_result", tool_use_id: toolUseId, content: JSON.stringify(result), is_error: !result.ok });
  } else {
    const raw = (input.message ?? "").trim() || (input.image ? "(screenshot attached)" : "");
    if (!raw) {
      emit({ type: "done" });
      return;
    }
    // Secrets are masked before Alexis sees the message and before it is stored.
    const { text, found } = maskSecrets(raw);
    if (found.length) {
      emit({ type: "masked", text });
      await audit({ sql, conv, user, toolUseId: `mask-${Date.now()}` }, {
        kind: "refusal",
        tool: "message",
        summary: `message · ${found.join(", ")} removed before Alexis saw it`,
        refusal_reason: "Secret in a customer message",
      });
    }
    if (conv.pending_code) {
      // The customer typed instead of using the code form: close the open tool call, then their message.
      content.push(...pending, {
        type: "tool_result",
        tool_use_id: conv.pending_code.tool_use_id,
        content: JSON.stringify({ ok: false, reason: "The customer sent a message instead of entering the code in the form." }),
        is_error: true,
      });
      await sql`update conversations set pending_code = null where id = ${conv.id}`;
    }
    if (conv.pending_identity_tool_id) {
      // The customer typed instead of using the form: close the open tool call, then their message.
      content.push(...pending, {
        type: "tool_result",
        tool_use_id: conv.pending_identity_tool_id,
        content: JSON.stringify({ ok: false, reason: "The customer sent a message instead of completing the identity form." }),
        is_error: true,
      });
    }
    if (input.image) {
      content.push({ type: "image", source: { type: "base64", media_type: input.image.media_type, data: input.image.data } });
      await audit({ sql, conv, user, toolUseId: `image-${Date.now()}` }, { kind: "rule", tool: "message", summary: "message · screenshot attached (a claim to check against the records)" });
    }
    content.push({ type: "text", text });

    // The customer's answer to a pending confirmation, from the buttons or a typed yes or no.
    const pa = conv.pending_action;
    if (pa && !pa.confirmed) {
      const yes = input.confirm === true || (input.confirm === undefined && YES.test(text) && !NO.test(text));
      const no = input.confirm === false || (input.confirm === undefined && NO.test(text));
      if (yes) {
        const next = { ...pa, confirmed: true };
        await sql`update conversations set pending_action = ${sql.json(next as never)} where id = ${conv.id}`;
        conv = { ...conv, pending_action: next };
        await audit({ sql, conv, user, toolUseId: `confirm-${Date.now()}` }, { kind: "rule", tool: pa.tool, summary: `customer confirmed · ${pa.label}` });
      } else if (no) {
        await sql`update conversations set pending_action = null where id = ${conv.id}`;
        conv = { ...conv, pending_action: null };
        await audit({ sql, conv, user, toolUseId: `confirm-${Date.now()}` }, { kind: "rule", tool: pa.tool, summary: `customer cancelled · ${pa.label}` });
      }
    }
  }
  await sql`update conversations set pending_identity_tool_id = null, pending_results = '[]', last_activity = ${now} where id = ${conv.id}`;
  conv = { ...conv, pending_identity_tool_id: null, pending_results: [] };
  messages.push({ role: "user", content });

  // A consistent history to save: only after a full assistant turn and its tool results.
  let saved = [...messages];
  const save = async (extra: Partial<Pick<Conversation, "pending_identity_tool_id" | "pending_results">> = {}) => {
    await sql`update conversations set messages = ${sql.json(saved as never)},
      pending_identity_tool_id = ${extra.pending_identity_tool_id ?? null},
      pending_results = ${sql.json((extra.pending_results ?? []) as never)},
      last_activity = ${new Date()} where id = ${conv.id}`;
  };

  const tools = toolDefinitions();
  let wroteText = false;

  try {
    for (let step = 0; step < MAX_STEPS; step++) {
      const stream = client().beta.messages.stream({
        model: MODEL,
        max_tokens: MAX_TOKENS,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: { effort: EFFORT },
        system: [
          { type: "text", text: coreInstructions() },
          { type: "text", text: extendedScope(), cache_control: { type: "ephemeral" } },
          { type: "text", text: await sessionContext(sql, new Date(), user, conv) },
        ],
        tools,
        messages,
      });

      let brokeLine = false;
      for await (const event of stream) {
        if (event.type === "content_block_start" && event.content_block.type === "tool_use") {
          emit({ type: "tool_start", id: event.content_block.id, name: event.content_block.name });
        } else if (event.type === "content_block_delta" && event.delta.type === "text_delta" && event.delta.text) {
          if (wroteText && !brokeLine) {
            emit({ type: "break" });
            brokeLine = true;
          }
          emit({ type: "text", delta: event.delta.text });
        }
      }
      const message = await stream.finalMessage();
      if (message.content.some((b) => b.type === "text" && b.text.trim())) wroteText = true;

      if (message.stop_reason === "refusal") {
        // Never run a refused turn's tools; drop it from the history and say something useful.
        if (!wroteText) {
          emit({ type: "text", delta: "I'm not able to help with that here. I can pass you to a member of the team if you'd like." });
        }
        break;
      }

      const toolUses = message.content.filter((b): b is Anthropic.Beta.BetaToolUseBlock => b.type === "tool_use");
      // A tool input cut off at max_tokens can still parse; never run it.
      if (message.stop_reason === "max_tokens" && toolUses.length) throw new Error("Tool input was cut off");
      messages.push({ role: "assistant", content: message.content as ContentBlockParam[] });
      if (message.stop_reason !== "tool_use" || toolUses.length === 0) {
        saved = [...messages];
        break;
      }

      const results: ToolResultParam[] = [];
      let awaiting: string | null = null;
      let awaitingCode = false;
      for (const use of toolUses) {
        const ctx = { sql, conv, user, now: new Date(), toolUseId: use.id, emit };
        let out: ToolResult | typeof AWAITING_IDENTITY | typeof AWAITING_CODE;
        try {
          out = await runTool(use.name, use.input, ctx);
        } catch (err) {
          // Fail safely: nothing half-done, the error recorded, Alexis told the tool failed.
          console.error(`tool ${use.name} failed`, err);
          await audit(ctx, { kind: "error", tool: use.name, summary: `${use.name} · error` }).catch(() => {});
          out = { ok: false, reason: "SYSTEM_ERROR: this tool failed. Tell the customer something went wrong on your side, that you couldn't complete it, and escalate." };
        }
        if (out === AWAITING_CODE) {
          awaitingCode = true;
          emit({ type: "tool_end", id: use.id, name: use.name, ok: true });
          continue;
        }
        if (out === AWAITING_IDENTITY) {
          awaiting = use.id;
          emit({ type: "tool_end", id: use.id, name: use.name, ok: true });
          continue;
        }
        emit({ type: "tool_end", id: use.id, name: use.name, ok: out.ok });
        results.push({ type: "tool_result", tool_use_id: use.id, content: JSON.stringify(out), is_error: !out.ok });
      }

      if (awaitingCode) {
        // Pause: the code form is on screen. pending_code (set by the tool) names the open call.
        saved = [...messages];
        await save({ pending_results: results });
        emit({ type: "done" });
        return;
      }
      if (awaiting) {
        // Pause: the identity form is on screen. The other results wait with the open call.
        saved = [...messages];
        await save({ pending_identity_tool_id: awaiting, pending_results: results });
        emit({ type: "done" });
        return;
      }
      messages.push({ role: "user", content: results });
      saved = [...messages];
    }
    await save();
    emit({ type: "done" });
  } catch (err) {
    console.error("turn failed", err);
    await save().catch(() => {});
    const base = { sql, conv, user, now: new Date(), toolUseId: `error-${Date.now()}`, emit };
    await audit(base, { kind: "error", summary: "Alexis · something went wrong" }).catch(() => {});
    if (err instanceof Anthropic.AuthenticationError) {
      emit({ type: "error", message: "The AI service rejected the API key. Check ANTHROPIC_API_KEY in Vercel's settings." });
    } else {
      // Pass it to the team for real, so the message below is true.
      const handed = await runTool(
        "escalate_to_human",
        {
          trigger: "records_missing_or_contradictory",
          urgency: "normal",
          request: input.message ?? "Identity check",
          checked: "The conversation stopped with a system error before Alexis could finish.",
          did: "None",
          needed: "Review the transcript and reply to the customer.",
          told: "Something went wrong and the case was passed to the team.",
        },
        base,
      ).catch(() => null);
      emit({
        type: "error",
        message: handed && typeof handed === "object" && handed.ok
          ? "Something went wrong on my side and I couldn't complete that. I've passed it to the team."
          : "Something went wrong on my side and I couldn't complete that. Please try again in a moment.",
      });
    }
    emit({ type: "done" });
  }
}
