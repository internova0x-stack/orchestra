import type { Sql } from "../db.ts";
import { runUpdates } from "../updates.ts";

// The Events API (the Orchestra API, Nov 23): the bank tells Orchestra a status changed, so Alexis's
// proactive updates go out without anyone asking. Each event has the sender's own id: the same id twice
// is applied once. In this prototype the event updates the simulated bank's record (it is the bank);
// with a real bank Orchestra records the new status for its updates the same way.

export const EVENT_TYPES = {
  "recall.updated": { statuses: ["approved", "declined"], table: "recalls" },
  "reversal.updated": { statuses: ["in_progress", "completed"], table: "reversals" },
  "dispute.updated": { statuses: ["open", "investigating", "resolved", "declined"], table: "disputes" },
  "verification.updated": { statuses: ["incomplete", "pending", "approved", "failed"], table: "businesses" },
} as const;
export type EventType = keyof typeof EVENT_TYPES;

export type EventResult = { ok: true; applied: boolean; duplicate?: boolean } | { ok: false; error: string; message: string };

export async function receiveEvent(sql: Sql, ev: { id?: unknown; type?: unknown; data?: Record<string, unknown> }): Promise<EventResult> {
  if (typeof ev.id !== "string" || !ev.id.trim() || ev.id.length > 200) return { ok: false, error: "bad_request", message: "Give the event an id (yours, unique per event)." };
  const def = EVENT_TYPES[ev.type as EventType];
  if (!def) return { ok: false, error: "unknown_type", message: `Unknown event type. Use one of: ${Object.keys(EVENT_TYPES).join(", ")}.` };
  const d = ev.data ?? {};
  const status = String(d.status ?? "");
  if (!(def.statuses as readonly string[]).includes(status)) return { ok: false, error: "bad_status", message: `status must be one of: ${def.statuses.join(", ")}.` };
  const [seen] = await sql<{ id: string }[]>`select id from api_events_received where id = ${ev.id}`;
  if (seen) return { ok: true, applied: false, duplicate: true };

  let rows: readonly unknown[] = [];
  if (ev.type === "verification.updated") {
    const holder = String(d.holder_id ?? "");
    rows = await sql`update businesses set verification_status = ${status},
      verification_missing = ${typeof d.missing === "string" ? d.missing.slice(0, 500) : null},
      verification_reason = ${typeof d.reason === "string" ? d.reason.slice(0, 500) : null}
      where id = ${holder} returning id`;
  } else {
    const ref = String(d.reference ?? "").toUpperCase();
    if (ev.type === "recall.updated") rows = await sql`update recalls set status = ${status}, decided_at = now() where reference = ${ref} returning reference`;
    if (ev.type === "reversal.updated") rows = await sql`update reversals set status = ${status} ${status === "completed" ? sql`, completed_at = now()` : sql``} where reference = ${ref} returning reference`;
    if (ev.type === "dispute.updated") rows = await sql`update disputes set status = ${status} where reference = ${ref} returning reference`;
  }
  if (!rows.length) return { ok: false, error: "not_found", message: "No record with that reference (or holder id)." };
  await sql`insert into api_events_received (id, type, result) values (${ev.id}, ${String(ev.type)}, ${sql.json({ status } as never)}) on conflict do nothing`;
  await sql`insert into audit_log (kind, tool, summary, input) values ('rule', 'events_api', ${`event received · ${String(ev.type)} · ${status}`}, ${sql.json({ id: ev.id, data: d } as never)})`;
  // Proactive updates go out now for whatever this changed.
  await runUpdates(sql);
  return { ok: true, applied: true };
}
