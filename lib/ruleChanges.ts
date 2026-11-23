import type { Sql } from "./db.ts";
import { can } from "./auth.ts";
import { validateRule } from "./ruleEdit.ts";
import { MARKETS, type Market } from "./rules.ts";
import type { StaffUser } from "./staff.ts";

// Rules management (Tomi, Nov 23): every change goes through here.
// - A supervisor's edit goes live at once; anyone else's waits for a supervisor to approve it.
// - A change can be for one market (Nigeria, UK, US): an override of the default value for customers there,
//   or the removal of that override (back to the default).
// - Every change is kept: the history, and an undo that is itself a change (approved the same way).
// - A policy document's proposals always wait for approval, whoever uploaded it.

export interface ChangeRow {
  id: number; rule_id: string; rule_name: string; market: Market | null; old_value: string | null; new_value: string | null;
  status: "pending" | "live" | "declined"; source: string | null; note: string | null;
  changed_by: string; changed_at: Date; decided_by: string | null; decided_at: Date | null;
}

const marketName = (m: Market | null) => (m ? MARKETS.find((x) => x.id === m)?.name ?? m : "all markets");

/** The value in force for a rule in a market (the default when the market has none of its own). */
async function current(sql: Sql, ruleId: string, market: Market | null): Promise<{ value: string; own: boolean } | null> {
  const [r] = await sql<{ value: string; own: string | null }[]>`
    select r.value, o.value as own from rules r
      left join rule_overrides o on o.rule_id = r.id and o.market = ${market ?? "none"}
    where r.id = ${ruleId}`;
  if (!r) return null;
  return market && r.own != null ? { value: r.own, own: true } : { value: r.value, own: false };
}

async function apply(tx: Sql, ruleId: string, market: Market | null, value: string | null, by: string) {
  const now = new Date();
  if (!market) await tx`update rules set value = ${value!}, updated_by = ${by}, updated_at = ${now} where id = ${ruleId}`;
  else if (value == null) await tx`delete from rule_overrides where rule_id = ${ruleId} and market = ${market}`;
  else await tx`insert into rule_overrides (rule_id, market, value, updated_by, updated_at) values (${ruleId}, ${market}, ${value}, ${by}, ${now})
    on conflict (rule_id, market) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at`;
}

async function log(tx: Sql, summary: string, input: unknown, result: unknown, staff: string) {
  await tx`insert into audit_log (kind, tool, summary, input, result, staff, approver)
    values ('rule_edit', 'rules', ${summary}, ${tx.json(input as never)}, ${tx.json(result as never)}, ${staff}, null)`;
}

export type ProposeResult =
  | { ok: true; status: "live" | "pending"; change: number; value: string | null }
  | { ok: false; error: string };

/**
 * Propose a new value (or, with `value: null` and a market, a return to the default there).
 * `review: true` makes it wait for approval even from a supervisor (policy documents).
 */
export async function proposeChange(
  sql: Sql,
  input: { ruleId: string; market: Market | null; value: string | null; staff: StaffUser; source?: string; note?: string; review?: boolean },
): Promise<ProposeResult> {
  return sql.begin(async (tx) => {
    const [rule] = await tx<{ id: string; kind: string; value: string; unit: string | null; name: string }[]>`
      select id, kind, value, unit, name from rules where id = ${input.ruleId} for update`;
    if (!rule) return { ok: false as const, error: "No such rule." };
    if (input.value == null && !input.market) return { ok: false as const, error: "A value is needed." };
    let value: string | null = null;
    if (input.value != null) {
      const checked = validateRule(rule, input.value);
      if (!checked.ok) return checked;
      value = checked.value;
    }
    const now = await current(tx as unknown as Sql, rule.id, input.market);
    if (value != null && value === now!.value && (now!.own || !input.market)) return { ok: false as const, error: "That's already the value." };
    if (value == null && !now!.own) return { ok: false as const, error: `${marketName(input.market)} already uses the default value.` };
    const [waiting] = await tx<{ id: number }[]>`select id from rule_changes where rule_id = ${rule.id} and status = 'pending' and market is not distinct from ${input.market}`;
    if (waiting) return { ok: false as const, error: "A change to this rule is already waiting for approval. Approve or decline it first." };
    const live = can(input.staff.role, "rules_approve") && !input.review;
    const [{ id }] = await tx<{ id: number }[]>`
      insert into rule_changes (rule_id, old_value, new_value, changed_by, changed_at, market, status, source, note, decided_by, decided_at)
      values (${rule.id}, ${now!.own || !input.market ? now!.value : null}, ${value}, ${input.staff.name}, now(), ${input.market}, ${live ? "live" : "pending"},
        ${input.source ?? "Rules screen"}, ${input.note ?? null}, ${live ? input.staff.name : null}, ${live ? new Date() : null})
      returning id`;
    const what = value == null ? `back to the default in ${marketName(input.market)}` : `${now!.value} → ${value}${input.market ? ` in ${marketName(input.market)}` : ""}`;
    if (live) await apply(tx as unknown as Sql, rule.id, input.market, value, input.staff.name);
    await log(tx as unknown as Sql, `rule ${live ? "edited" : "change proposed"} · ${rule.name} · ${what}${input.source && input.source !== "Rules screen" ? ` · from ${input.source}` : ""}`,
      { rule: rule.id, market: input.market, change: id }, { old: now!.value, new: value, status: live ? "live" : "pending" }, input.staff.name);
    return { ok: true as const, status: live ? ("live" as const) : ("pending" as const), change: id, value };
  });
}

/** A supervisor approves (it goes live now) or declines a waiting change. */
export async function decideChange(sql: Sql, changeId: number, staff: StaffUser, approve: boolean): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!can(staff.role, "rules_approve")) return { ok: false, error: "Only a supervisor or an operations admin can approve or decline rule changes." };
  return sql.begin(async (tx) => {
    const [c] = await tx<ChangeRow[]>`
      select c.*, r.name as rule_name from rule_changes c join rules r on r.id = c.rule_id where c.id = ${changeId} for update of c`;
    if (!c) return { ok: false as const, error: "That change isn't there any more." };
    if (c.status !== "pending") return { ok: false as const, error: "That change has already been decided." };
    await tx`update rule_changes set status = ${approve ? "live" : "declined"}, decided_by = ${staff.name}, decided_at = now() where id = ${changeId}`;
    if (approve) await apply(tx as unknown as Sql, c.rule_id, c.market, c.new_value, staff.name);
    const what = c.new_value == null ? `back to the default in ${marketName(c.market)}` : `${c.new_value}${c.market ? ` in ${marketName(c.market)}` : ""}`;
    await log(tx as unknown as Sql, `rule change ${approve ? "approved" : "declined"} · ${c.rule_name} · ${what} · proposed by ${c.changed_by}`,
      { rule: c.rule_id, market: c.market, change: changeId }, { status: approve ? "live" : "declined" }, staff.name);
    return { ok: true as const };
  });
}

/** Changes waiting for approval, oldest first. */
export async function pendingChanges(sql: Sql): Promise<ChangeRow[]> {
  return sql<ChangeRow[]>`select c.*, r.name as rule_name from rule_changes c join rules r on r.id = c.rule_id where c.status = 'pending' order by c.id`;
}

/** One rule's history, newest first. */
export async function ruleHistory(sql: Sql, ruleId: string): Promise<ChangeRow[]> {
  return sql<ChangeRow[]>`select c.*, r.name as rule_name from rule_changes c join rules r on r.id = c.rule_id where c.rule_id = ${ruleId} order by c.id desc limit 50`;
}

/**
 * Checking a change against saved conversations: every conversation in which Alexis read this rule, with
 * the value she used then and the customer, so the team sees what a change would have touched before
 * approving it.
 */
export async function ruleImpact(sql: Sql, ruleId: string) {
  const [rule] = await sql<{ name: string }[]>`select name from rules where id = ${ruleId}`;
  if (!rule) return [];
  return sql<{ conversation_id: string; used: string; at: Date; customer: string | null; business: string | null; country: string | null }[]>`
    select distinct on (a.conversation_id) a.conversation_id, a.summary as used, a.created_at as at,
      u.full_name as customer, b.name as business, b.country
    from audit_log a
      join conversations c on c.id = a.conversation_id and c.mode = 'customer'
      left join business_users u on u.id = c.verified_user_id left join businesses b on b.id = u.business_id
    where a.kind = 'rule' and (a.input->>'rule' = ${ruleId} or a.summary like ${`rule · ${rule.name} · %`})
    order by a.conversation_id, a.created_at desc
    limit 50`;
}
