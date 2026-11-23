import type { Sql } from "./db.ts";
import { ALL_CATEGORIES, categoryOf } from "./cases.ts";
import { Rules } from "./rules.ts";
import { emitEvent } from "./api/webhooks.ts";
import type { StaffUser } from "./staff.ts";

// Smart routing (Tomi, Nov 23: "build" drafted replies and smart routing). Every handoff goes to a team,
// chosen from the case's category by the institution's own routing rules ("Team for: Cards" and so on, on
// the Rules screen). A member of the team picks it up; anyone can move it to another team. A case that passes
// its response target with nobody on it is flagged overdue for supervisors and, if the institution wants,
// its urgency goes up one step.

export const DEFAULT_TEAM = "Customer support";

/** The rule that names the team for a category, e.g. "Verification (KYC)" → route_verification. */
export const routeRuleId = (category: string) =>
  "route_" + category.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z]+/g, "_").replace(/^_+|_+$/g, "");

/** Starting teams (sample values; each institution edits them on the Rules screen). */
export const DEFAULT_ROUTES: Record<string, string> = {
  "Account access": DEFAULT_TEAM, "Airtime and bills": "Payments team", Balances: DEFAULT_TEAM, Cards: "Cards team",
  Complaint: "Complaints team", "Failed payments and reversals": "Payments team", "Fees and limits": DEFAULT_TEAM,
  "Fraud and scams": "Fraud team", "General question": DEFAULT_TEAM, "Incoming payments": "Payments team", Loans: "Lending team",
  "Merchant payouts": "Merchant team", "Payment tracing": "Payments team", Payouts: "Payments team",
  "Transactions and disputes": "Cards team", "USSD and agent banking": "Payments team", "Verification (KYC)": "Compliance team",
};

/** The category and team for a new handoff, from what happened in the conversation and why it was handed off. */
export async function routeCase(sql: Sql, conversationId: string | null, trigger: string, rules: Rules): Promise<{ category: string; team: string }> {
  const tools = conversationId
    ? (await sql<{ tool: string }[]>`select distinct tool from audit_log where conversation_id = ${conversationId} and tool is not null`).map((r) => r.tool)
    : [];
  const category = categoryOf(tools, [trigger]);
  const team = rules.get(routeRuleId(category))?.value?.trim() || DEFAULT_TEAM;
  return { category, team };
}

/** Every team the routing rules name, for the Staff queue's filter and "Move to". */
export async function teams(sql: Sql): Promise<string[]> {
  const ids = ALL_CATEGORIES.map(routeRuleId);
  const rows = await sql<{ value: string }[]>`select distinct value from rules where id in ${sql(ids)}`;
  return [...new Set([...rows.map((r) => r.value.trim()).filter(Boolean), DEFAULT_TEAM])].sort();
}

async function log(sql: Sql, conversationId: string | null, staff: string, summary: string) {
  await sql`insert into audit_log (conversation_id, tool_use_id, kind, tool, summary, staff)
    values (${conversationId}, ${`routing-${Date.now()}-${Math.random().toString(36).slice(2, 6)}`}, 'handoff', 'routing', ${summary}, ${staff})`;
}

export type RoutingError = "not_found" | "closed" | "unknown_team" | "already_assigned";

/** A member of the team picks the case up: it's theirs, and it's no longer at risk of going overdue unattended. */
export async function pickUp(sql: Sql, reference: string, staff: StaffUser): Promise<RoutingError | null> {
  const [c] = await sql<{ conversation_id: string | null; status: string; assigned_to: string | null }[]>`
    select conversation_id, status, assigned_to from escalations where reference = ${reference}`;
  if (!c) return "not_found";
  if (c.status !== "open") return "closed";
  if (c.assigned_to === staff.name) return null;
  if (c.assigned_to) return "already_assigned";
  const done = await sql`update escalations set assigned_to = ${staff.name}, assigned_at = now() where reference = ${reference} and assigned_to is null returning reference`;
  if (!done.length) return "already_assigned";
  await log(sql, c.conversation_id, staff.name, `${reference} picked up by ${staff.name}`);
  await emitEvent(sql, "case.updated", { reference, status: "open", assigned_to: staff.name });
  return null;
}

/** Move a case to another team (it waits there for someone to pick it up). */
export async function moveTeam(sql: Sql, reference: string, team: string, staff: StaffUser): Promise<RoutingError | null> {
  const known = await teams(sql);
  if (!known.includes(team)) return "unknown_team";
  const [c] = await sql<{ conversation_id: string | null; status: string; team: string | null }[]>`
    select conversation_id, status, team from escalations where reference = ${reference}`;
  if (!c) return "not_found";
  if (c.status !== "open") return "closed";
  if (c.team === team) return null;
  await sql`update escalations set team = ${team}, assigned_to = null, assigned_at = null where reference = ${reference}`;
  await log(sql, c.conversation_id, staff.name, `${reference} moved from ${c.team ?? "no team"} to ${team} by ${staff.name}`);
  await emitEvent(sql, "case.updated", { reference, status: "open", team, moved_by: staff.name });
  return null;
}

const UP: Record<string, string> = { normal: "high", high: "urgent", urgent: "urgent" };

/**
 * Open cases past their response target that nobody has picked up: flagged overdue once, logged, sent to
 * webhooks, and (rule route_overdue_raise) one step more urgent. Runs whenever the Staff queue loads.
 */
export async function flagOverdue(sql: Sql, now = new Date()): Promise<string[]> {
  const late = await sql<{ reference: string; conversation_id: string | null; urgency: string; team: string | null }[]>`
    select reference, conversation_id, urgency, team from escalations
    where status = 'open' and assigned_to is null and overdue_at is null and respond_by is not null and respond_by < ${now}`;
  if (!late.length) return [];
  const rules = await Rules.load(sql);
  const raise = rules.on("route_overdue_raise");
  const flagged: string[] = [];
  for (const c of late) {
    const urgency = raise ? UP[c.urgency] ?? c.urgency : c.urgency;
    const done = await sql`update escalations set overdue_at = ${now}, urgency = ${urgency} where reference = ${c.reference} and overdue_at is null returning reference`;
    if (!done.length) continue;
    flagged.push(c.reference);
    await log(sql, c.conversation_id, "Routing", `${c.reference} passed its response target with nobody on it${c.team ? ` (${c.team})` : ""}${urgency !== c.urgency ? ` · urgency raised to ${urgency}` : ""}`);
    await emitEvent(sql, "case.updated", { reference: c.reference, status: "open", overdue: true, urgency, team: c.team });
  }
  return flagged;
}
