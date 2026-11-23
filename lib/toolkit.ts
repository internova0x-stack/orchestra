import { z } from "zod";
import type { Sql } from "./db.ts";
import type { Conversation, PendingAction, VerifiedUser } from "./session.ts";
import type { Rules } from "./rules.ts";
import { money } from "./format.ts";

// Shared pieces every tool uses: the result shape, the audit log, refusals, rule reads and the
// checks in DEMO-SPEC's order. Each tool file imports these; lib/tools.ts holds the registry.

export type Tier = 0 | 1 | 2 | 3;

export interface ToolResult {
  ok: boolean;
  data?: unknown;
  reason?: string;
  reference?: string;
}

/** Events the chat screen shows while a turn runs. */
export type StreamEvent =
  | { type: "text"; delta: string }
  | { type: "break" }
  | { type: "tool_start"; id: string; name: string }
  | { type: "tool_end"; id: string; name: string; ok: boolean }
  | { type: "card"; cards: PayoutCard[] }
  | { type: "identity_form" }
  | { type: "handoff"; reference: string; urgency: string; respond: string }
  | { type: "proof"; proof: ProofDoc }
  | { type: "masked"; text: string }
  | { type: "confirm"; action: string; consequence: string }
  | { type: "code_form"; sentTo: string; code: string }
  | { type: "code_retry" }
  | { type: "error"; message: string }
  | { type: "done" };

export interface PayoutCard {
  reference: string;
  amount: string;
  counterparty: string;
  route: string;
  status: string;
  date: string;
  stages: { label: string; state: "done" | "current" | "failed" | "todo" }[];
}

/** A payment confirmation: the fields the Knowledge Base lists ("Proof of payment: what it shows"). */
export interface ProofDoc {
  reference: string;
  payout: string;
  amount: string;
  currency: string;
  date: string;
  recipient: string;
  account: string;
  route: string;
  issued: string;
}

export interface ToolCtx {
  sql: Sql;
  conv: Conversation;
  user: VerifiedUser | null;
  now: Date;
  toolUseId: string;
  emit: (e: StreamEvent) => void;
}

/** Sentinel: verify_identity needs the form; the turn pauses until the customer submits it. */
export const AWAITING_IDENTITY = Symbol("awaiting identity");

/** Sentinel: send_one_time_code sent a code; the turn pauses until the customer types it into the form. */
export const AWAITING_CODE = Symbol("awaiting code");

export interface ToolDef<S extends z.ZodTypeAny> {
  name: string;
  tier: Tier;
  description: string;
  schema: S;
  /** "stronger" tools also need the one-time code (Guardrails: tier 3 and account access). */
  identity?: "standard" | "stronger";
  run: (input: z.infer<S>, ctx: ToolCtx, rules: Rules) => Promise<ToolResult | typeof AWAITING_IDENTITY | typeof AWAITING_CODE>;
}

// ---------------------------------------------------------------- audit

export async function audit(
  ctx: Pick<ToolCtx, "sql" | "conv" | "user" | "toolUseId">,
  row: {
    kind: "identity" | "lookup" | "action" | "refusal" | "handoff" | "rule" | "approval" | "error";
    tool?: string;
    summary: string;
    input?: unknown;
    result?: unknown;
    refusal_reason?: string;
  },
) {
  const { sql } = ctx;
  await sql`insert into audit_log (conversation_id, user_id, tool_use_id, kind, tool, summary, input, result, refusal_reason)
    values (${ctx.conv.id}, ${ctx.user?.id ?? null}, ${ctx.toolUseId}, ${row.kind}, ${row.tool ?? null}, ${row.summary},
            ${row.input === undefined ? null : sql.json(row.input as never)},
            ${row.result === undefined ? null : sql.json(row.result as never)}, ${row.refusal_reason ?? null})`;
}

/** Record that a rule was read, so the activity panel shows it. */
export async function ruleRead(ctx: ToolCtx, rules: Rules, id: string, label?: string) {
  const r = rules.get(id);
  if (!r) return;
  const sym = { $: "USD", "£": "GBP", "₦": "NGN" }[r.unit ?? ""];
  const unit = r.unit && r.value.trim() === "1" ? r.unit.replace(/(day|hour)s\b/, "$1") : r.unit;
  const value = sym ? money(Number(r.value), sym).replace(/\.00$/, "") : unit ? `${r.value} ${unit}` : r.value;
  await audit(ctx, { kind: "rule", summary: `rule · ${label ?? r.name} · ${value}` });
}

/** Refuse with a plain-language reason for Alexis and a short label for the activity panel. */
export async function refuse(ctx: ToolCtx, tool: string, input: unknown, reason: string, short: string): Promise<ToolResult> {
  await audit(ctx, { kind: "refusal", tool, summary: `${tool} · refused: ${short}`, input, refusal_reason: reason });
  return { ok: false, reason };
}

/** Check 2: identity level. Tiers 1-3 need a verified session; some tools need the stronger check too. */
export function needsIdentity(tier: Tier, ctx: ToolCtx, level: "standard" | "stronger" = "standard"): string | null {
  if (tier === 0) return null;
  if (!ctx.user) return "Identity has not been verified in this conversation. Run verify_identity first.";
  if (level === "stronger" && !ctx.user.stronger) {
    return "This needs the stronger identity check. Call send_one_time_code: a code goes to the contact details on file and the customer types it into the form. Never send it anywhere else.";
  }
  return null;
}

/**
 * Check 8: the customer's yes. The first call stores the action and shows Yes/Cancel; only the
 * customer's button or typed yes confirms it (runTurn), never the model. Returns null once confirmed
 * (and uses the confirmation up), or the result to hand back while waiting.
 */
export async function confirmFirst(
  ctx: ToolCtx,
  tool: string,
  record: string,
  label: string,
  action: string,
  consequence: string,
): Promise<ToolResult | null> {
  const pending = ctx.conv.pending_action;
  if (pending && pending.tool === tool && pending.record === record && pending.confirmed) {
    await ctx.sql`update conversations set pending_action = null where id = ${ctx.conv.id}`;
    ctx.conv.pending_action = null;
    return null;
  }
  const next: PendingAction = { tool, record, label, confirmed: false, asked_at: ctx.now.toISOString() };
  await ctx.sql`update conversations set pending_action = ${ctx.sql.json(next as never)} where id = ${ctx.conv.id}`;
  ctx.conv.pending_action = next;
  ctx.emit({ type: "confirm", action, consequence });
  await audit(ctx, { kind: "rule", tool, summary: `${tool} · ${record} · waiting for the customer's yes` });
  return {
    ok: false,
    reason: `CONFIRMATION_NEEDED: the customer is being shown "Yes, go ahead" and "Cancel". In your reply, state the action (${action}) and its consequence (${consequence}) and wait for their answer. Do not call ${tool} again until they say yes.`,
  };
}
