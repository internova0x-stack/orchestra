import type { Sql } from "./db.ts";
import { parseClock } from "./time.ts";

// Editing a rule on the Rules screen. Values are checked so a typo can't break a tool: limits must
// be numbers, switches on or off, times HH:MM. The Guardrails' fixed rules aren't in this table.

export const EDITOR = "Rules screen";

interface RuleRow { id: string; kind: string; value: string; unit: string | null; name: string }

export function validateRule(r: RuleRow, raw: string): { ok: true; value: string } | { ok: false; error: string } {
  const value = raw.trim();
  if (!value) return { ok: false, error: "A value is needed." };
  if (value.length > 500) return { ok: false, error: "Keep it under 500 characters." };
  if (r.kind !== "limit") return { ok: true, value };
  // A switch: the named ones, and any limit whose value is on or off (e.g. the card controls).
  if (r.id.startsWith("action_") || r.id === "alexis_enabled" || r.id === "outage_mode" || r.id === "kyc_tiers_used" || /^(on|off)$/i.test(r.value.trim())) {
    const v = value.toLowerCase();
    if (v !== "on" && v !== "off") return { ok: false, error: "Use on or off." };
    return { ok: true, value: v };
  }
  if (r.id === "business_open" || r.id === "business_close" || /^\d{1,2}:\d{2}$/.test(r.value.trim())) {
    if (!/^\d{1,2}[:.]\d{2}$/.test(value) || parseClock(value, -1) < 0 || parseClock(value, -1) > 24 * 60) return { ok: false, error: "Use a time like 09:00." };
    return { ok: true, value: value.replace(".", ":").padStart(5, "0") };
  }
  if (r.id === "business_days") {
    if (!/(monday|tuesday|wednesday|thursday|friday|saturday|sunday)/i.test(value)) return { ok: false, error: "Name the days, e.g. Monday to Friday." };
    return { ok: true, value };
  }
  const n = Number(value.replace(/[,\s$£₦]/g, ""));
  if (!Number.isFinite(n) || n < 0) return { ok: false, error: "Use a number, e.g. 2000." };
  return { ok: true, value: String(n) };
}

export async function editRule(sql: Sql, id: string, raw: string) {
  return sql.begin(async (tx) => {
    const rows = await tx<RuleRow[]>`select id, kind, value, unit, name from rules where id = ${id} for update`;
    const r = rows[0];
    if (!r) return { ok: false as const, error: "No such rule." };
    const checked = validateRule(r, raw);
    if (!checked.ok) return checked;
    if (checked.value === r.value) return { ok: true as const, value: r.value, changed: false };
    const now = new Date();
    await tx`update rules set value = ${checked.value}, updated_by = ${EDITOR}, updated_at = ${now} where id = ${id}`;
    await tx`insert into rule_changes (rule_id, old_value, new_value, changed_by, changed_at) values (${id}, ${r.value}, ${checked.value}, ${EDITOR}, ${now})`;
    await tx`insert into audit_log (kind, tool, summary, input, result)
      values ('rule_edit', 'rules', ${`rule edited · ${r.name} · ${r.value} → ${checked.value}`}, ${tx.json({ rule: id })}, ${tx.json({ old: r.value, new: checked.value })})`;
    return { ok: true as const, value: checked.value, changed: true };
  });
}
