import type { Sql } from "./db.ts";
import { bank } from "./bank/index.ts";
import { Rules, marketOf } from "./rules.ts";
import { loadConversation, verifiedUser, type Conversation, type PendingAction } from "./session.ts";
import { runTool } from "./tools.ts";
import { AWAITING_CODE, audit, type StaffActor, type StreamEvent, type ToolCtx } from "./toolkit.ts";
import { staffReply } from "./takeover.ts";
import { staffUser, type StaffUser } from "./staff.ts";
import { routeCase } from "./routing.ts";
import { emitEvent } from "./api/webhooks.ts";
import { money } from "./format.ts";

// Staff actions (Tomi, Nov 23: "build it now"): a member of the team takes the same account actions as Alexis
// from the console, on a conversation they have taken over. The same tools run with the same checks and the
// same Bank Connector calls. On top of them:
// - who may act: the Rules screen's "Staff actions" settings (agents on or off, the amount an agent may act on
//   alone, the amount above which a second supervisor must approve);
// - the customer still says yes, in their app, to anything that needs a yes; staff can't say it for them;
// - the stronger check still applies where it does for Alexis: staff send the one-time code to the phone on file;
// - every step is in the activity log under the staff member's name, and the customer is told who did it.

/** The actions the team can take, with how the customer is told once it's done. */
export const STAFF_ACTIONS: Record<string, { label: string; done: string }> = {
  freeze_card: { label: "Freeze a card", done: "froze your card" },
  unfreeze_card: { label: "Unfreeze a card", done: "unfroze your card" },
  change_card_settings: { label: "Change card settings", done: "changed your card's settings" },
  order_replacement: { label: "Order a replacement card", done: "ordered your replacement card" },
  open_dispute: { label: "Open a dispute", done: "opened a dispute on the payment" },
  request_reversal: { label: "Request a reversal", done: "requested the reversal" },
  initiate_recall: { label: "Request a recall", done: "requested the recall" },
  refund_bill_payment: { label: "Refund a bill or airtime payment", done: "refunded the payment" },
  waive_fee: { label: "Waive a fee", done: "waived the fee" },
  request_deferral: { label: "Log a loan deferral request", done: "sent your deferral request to the lending team" },
  unlock_account: { label: "Unlock online access", done: "unlocked your online access" },
  send_reset_link: { label: "Send a password reset link", done: "sent a password reset link to the email on file" },
  generate_proof_of_payment: { label: "Issue a payment confirmation", done: "issued your payment confirmation" },
};

export type StaffActionResult =
  | { status: "done"; reference: string | null; message: string }
  | { status: "waiting_customer"; action: string }
  | { status: "needs_code"; message: string }
  | { status: "code_sent"; sentTo: string }
  | { status: "needs_supervisor"; message: string }
  | { status: "needs_second_approval"; reference: string; message: string }
  | { status: "refused"; message: string }
  | { status: "error"; error: "not_found" | "not_taken_over" | "not_verified" | "unknown_action" | "switched_off"; message: string };

const CUR = (c: string) => c.toLowerCase();

/** The amount an action moves or applies to, for the staff limits. Null when it has none. */
async function amountOf(sql: Sql, holder: string, tool: string, input: Record<string, unknown>): Promise<{ amount: number; currency: string } | null> {
  const b = bank(sql);
  const id = (k: string) => String(input[k] ?? "").trim().toUpperCase();
  const pick = (x: { amount: string; currency: string } | null | undefined) => (x ? { amount: Number(x.amount), currency: x.currency } : null);
  switch (tool) {
    case "initiate_recall": return pick((await b.searchTransfers(holder, { reference: id("reference") }))[0]);
    case "request_reversal": return pick((await b.getPayment(holder, id("payment_id"))).payment);
    case "open_dispute": return pick((await b.searchCardTransactions(holder, { id: id("transaction_id") }))[0]);
    case "refund_bill_payment": return pick((await b.searchBillPayments(holder, { id: id("payment_id") }))[0]);
    case "waive_fee": return pick((await b.listFees(holder, { id: id("fee_id") }))[0]);
    case "change_card_settings": {
      if (typeof input.daily_limit !== "number") return null;
      const last4 = typeof input.last4 === "string" ? input.last4 : undefined;
      const card = (await b.listCards(holder, { last4 })).find((c) => c.status !== "replaced");
      return card ? { amount: input.daily_limit, currency: card.currency } : null;
    }
    default: return null;
  }
}

/** A stable key for "this exact action", so a second supervisor's approval applies to it and nothing else. */
const actionKey = (tool: string, input: unknown) => `${tool}:${JSON.stringify(input, Object.keys((input as object) ?? {}).sort())}`;

const actor = (s: StaffUser, approvedBy?: string | null): StaffActor => ({ id: s.id, name: s.name, role: s.role, approvedBy: approvedBy ?? null });

/** Run (or continue) a staff action on a conversation the staff member has taken over. */
export async function runStaffAction(
  sql: Sql,
  conversationId: string,
  staff: StaffUser,
  tool: string,
  rawInput: Record<string, unknown>,
  opts: { now?: Date; sendCode?: boolean } = {},
): Promise<StaffActionResult> {
  const now = opts.now ?? new Date();
  const conv = await loadConversation(sql, conversationId);
  if (!conv || (conv as unknown as { mode: string }).mode !== "customer") return { status: "error", error: "not_found", message: "That conversation isn't there any more." };
  if (conv.taken_over_by !== staff.name) return { status: "error", error: "not_taken_over", message: "Take the conversation over first, so the customer knows a person is acting on their account." };
  const user = await verifiedUser(sql, conv, now);
  if (!user) return { status: "error", error: "not_verified", message: "The customer isn't verified in this conversation. Hand it back to Alexis to run the identity check, then take it over again." };
  const rules = await Rules.load(sql, marketOf(user.country));
  const emitted: StreamEvent[] = [];
  const ctx = (approvedBy?: string | null): ToolCtx => ({
    sql, conv, user, now, toolUseId: `staff-${staff.id}-${now.getTime()}`, emit: (e) => emitted.push(e), staffAction: actor(staff, approvedBy),
  });

  // The stronger check: a one-time code to the phone on file, typed by the customer in their app.
  if (opts.sendCode) {
    const r = await runTool("send_one_time_code", {}, ctx());
    if (r === AWAITING_CODE) {
      const sent = emitted.find((e) => e.type === "code_form") as { sentTo: string } | undefined;
      return { status: "code_sent", sentTo: sent?.sentTo ?? "the phone on file" };
    }
    const res = r as { ok: boolean; reason?: string; data?: unknown };
    return res.ok ? { status: "done", reference: null, message: "The customer has already passed the stronger check in this conversation." } : { status: "refused", message: res.reason ?? "The code couldn't be sent." };
  }

  const def = STAFF_ACTIONS[tool];
  if (!def) return { status: "error", error: "unknown_action", message: "That isn't an action the team can take here." };
  if (!rules.on("staff_actions_enabled")) return { status: "error", error: "switched_off", message: "Account actions from the console are switched off on the Rules screen." };
  await audit(ctx(), { kind: "rule", tool: "staff_action", summary: `staff_action · ${def.label.toLowerCase()} · started` });
  if (staff.role === "support_agent" && !rules.on("staff_agent_actions")) {
    return { status: "needs_supervisor", message: "At this institution only supervisors take account actions. Ask a supervisor to take the conversation over." };
  }

  // The amount limits: an agent acts alone up to their limit; above the second limit, another supervisor approves.
  const money_ = await amountOf(sql, user.business_id, tool, rawInput);
  const key = actionKey(tool, rawInput);
  let approvedBy: string | null = null;
  if (money_) {
    const cur = CUR(money_.currency);
    const agentLimit = rules.num(`staff_agent_limit_${cur}`, Infinity);
    const dualLimit = rules.num(`staff_dual_limit_${cur}`, Infinity);
    const amount = money(money_.amount, money_.currency);
    if (staff.role === "support_agent" && money_.amount > agentLimit) {
      return { status: "needs_supervisor", message: `${amount} is above the ${money(agentLimit, money_.currency).replace(/\.00$/, "")} a support agent can act on alone. Ask a supervisor to take the conversation over.` };
    }
    if (money_.amount > dualLimit) {
      const [ok] = await sql<{ approved_by: string }[]>`
        select e.action->>'approved_by' as approved_by from escalations e
        where e.conversation_id = ${conv.id} and e.status = 'approved' and e.action->>'type' = 'staff_action' and e.action->>'key' = ${key}
        order by e.decided_at desc limit 1`;
      if (!ok) return requestSecondApproval(sql, conv, user.business_id, staff, tool, rawInput, key, amount, rules);
      approvedBy = ok.approved_by;
    }
  }

  const r = await runTool(tool, rawInput, ctx(approvedBy));
  const res = r as { ok: boolean; reason?: string; reference?: string; data?: Record<string, unknown> };
  const confirm = emitted.find((e) => e.type === "confirm") as { action: string; consequence: string } | undefined;
  if (confirm) {
    // The customer answers in their app; remember who asked and exactly what, so their yes runs this action.
    const [c] = await sql<{ pending_action: PendingAction | null }[]>`select pending_action from conversations where id = ${conv.id}`;
    if (c.pending_action) {
      const p: PendingAction = { ...c.pending_action, staff: { id: staff.id, name: staff.name, role: staff.role, approvedBy }, input: rawInput, action: confirm.action, consequence: confirm.consequence };
      await sql`update conversations set pending_action = ${sql.json(p as never)} where id = ${conv.id}`;
    }
    return { status: "waiting_customer", action: confirm.action };
  }
  if (!res.ok) {
    const reason = res.reason ?? "The action didn't go through.";
    if (/stronger identity check/i.test(reason)) return { status: "needs_code", message: "This needs the stronger check first: send the customer a one-time code to the phone on file." };
    return { status: "refused", message: reason.replace(/^CONFIRMATION_NEEDED:.*/, "Waiting for the customer.") };
  }
  const reference = res.reference ?? (res.data?.reference as string | undefined) ?? null;
  const told = `${staff.name.split(" ")[0]} from the support team ${def.done}${reference ? ` (reference ${reference})` : ""}.`;
  await staffReply(sql, conv.id, staff, told);
  return { status: "done", reference, message: told };
}

/** Above the second limit: the action waits in the Staff queue for another supervisor. */
async function requestSecondApproval(sql: Sql, conv: Conversation, holderId: string, staff: StaffUser, tool: string, input: Record<string, unknown>, key: string, amount: string, rules: Rules): Promise<StaffActionResult> {
  const [open] = await sql<{ reference: string }[]>`
    select reference from escalations where conversation_id = ${conv.id} and status = 'open' and action->>'type' = 'staff_action' and action->>'key' = ${key}`;
  if (open) return { status: "needs_second_approval", reference: open.reference, message: `Already waiting for a second supervisor (${open.reference}).` };
  const label = STAFF_ACTIONS[tool].label;
  const [{ n }] = await sql<{ n: string }[]>`select nextval('escalation_seq')::text as n`;
  const reference = `ESC-${n}`;
  const summary = {
    reference, urgency: "high",
    customer: { identity: "Verified" },
    request: `${label}: ${amount}`, checked: `Requested by ${staff.name} from the console, on input ${JSON.stringify(input)}`,
    did: "Nothing yet: waiting for a second supervisor.", why: "A second supervisor must approve a staff action this large",
    needed: `A supervisor other than ${staff.name} approves or declines. Once approved, ${staff.name} runs it and the customer confirms in their app.`,
    told: "Nothing yet.", flags: ["Four-eyes approval"],
  };
  const route = await routeCase(sql, conv.id, "staff_action_approval", rules);
  const action = { type: "staff_action", key, tool, input, label, amount, requested_by: staff.name, requested_by_id: staff.id };
  await sql`insert into escalations (reference, conversation_id, business_id, user_id, urgency, trigger, summary, respond_by, action, team)
    values (${reference}, ${conv.id}, ${holderId}, ${conv.verified_user_id}, 'high', 'staff_action_approval', ${sql.json(summary)}, ${new Date(Date.now() + 4 * 3_600_000)}, ${sql.json(action as never)}, ${route.team})`;
  await sql`insert into audit_log (conversation_id, tool_use_id, kind, tool, summary, staff)
    values (${conv.id}, ${`staff-approval-${reference}`}, 'handoff', 'staff_action', ${`staff_action · ${label.toLowerCase()} · ${amount} · ${reference} waiting for a second supervisor`}, ${staff.name})`;
  await emitEvent(sql, "case.created", { reference, conversation_id: conv.id, urgency: "high", team: route.team, trigger: "staff_action_approval", summary, action });
  return { status: "needs_second_approval", reference, message: `${amount} needs a second supervisor's approval. It's in Cases as ${reference}; run the action again once it's approved.` };
}

/** The customer's Yes or Cancel (button or typed) on an action a member of the team asked for. */
export async function answerStaffAction(sql: Sql, conv: Conversation, yes: boolean): Promise<StaffActionResult | null> {
  const p = conv.pending_action;
  if (!p?.staff || p.confirmed) return null;
  const staff = await staffUser(sql, p.staff.id);
  if (!staff || conv.taken_over_by !== staff.name) {
    await sql`update conversations set pending_action = null where id = ${conv.id}`;
    return null;
  }
  const log = (summary: string) => sql`insert into audit_log (conversation_id, tool_use_id, kind, tool, summary, staff)
    values (${conv.id}, ${`staff-answer-${Date.now()}`}, ${yes ? "approval" : "refusal"}, ${p.tool}, ${summary}, ${staff.name})`;
  if (!yes) {
    await sql`update conversations set pending_action = null where id = ${conv.id}`;
    await log(`${p.tool} · ${p.record} · the customer cancelled`);
    return { status: "refused", message: "The customer cancelled." };
  }
  await sql`update conversations set pending_action = ${sql.json({ ...p, confirmed: true } as never)} where id = ${conv.id}`;
  await log(`${p.tool} · ${p.record} · the customer said yes in the app`);
  return runStaffAction(sql, conv.id, staff, p.tool, (p.input ?? {}) as Record<string, unknown>);
}

/** The customer typed the one-time code a member of the team sent. */
export async function answerStaffCode(sql: Sql, conv: Conversation, code: string, now = new Date()): Promise<"passed" | "retry" | "failed" | null> {
  const pc = conv.pending_code;
  if (!pc?.staff) return null;
  const ok = String(code).replace(/\D/g, "") === pc.code;
  const attempts = pc.attempts + 1;
  const ctx = { sql, conv, user: null, toolUseId: pc.tool_use_id, staff: pc.staff };
  if (ok) {
    await sql`update conversations set stronger_verified_at = ${now}, pending_code = null where id = ${conv.id}`;
    await audit(ctx, { kind: "identity", tool: "send_one_time_code", summary: "send_one_time_code · code confirmed · stronger check passed" });
    return "passed";
  }
  const ended = attempts >= 3;
  await sql`update conversations set pending_code = ${ended ? null : sql.json({ ...pc, attempts } as never)} where id = ${conv.id}`;
  await audit(ctx, { kind: ended ? "refusal" : "identity", tool: "send_one_time_code", summary: `send_one_time_code · wrong code (${attempts} of 3)${ended ? " · check failed" : ""}` });
  return ended ? "failed" : "retry";
}

/** What the customer app shows for a staff action or code waiting on the customer. */
export function customerPending(conv: { pending_action: PendingAction | null; pending_code: Conversation["pending_code"] }) {
  const p = conv.pending_action;
  const c = conv.pending_code;
  return {
    pendingAction: p?.staff && !p.confirmed ? { key: p.asked_at, action: p.action ?? p.label, consequence: p.consequence ?? "", by: p.staff.name } : null,
    pendingCode: c?.staff ? { key: c.sent_at, sentTo: c.sent_to ?? "the phone on file", code: c.code, by: c.staff } : null,
  };
}
