import type { Sql } from "./db.ts";
import type { StaffUser } from "./staff.ts";
import { Rules } from "./rules.ts";

// Data protection (Tomi, Nov 27). Two things Orchestra does with what it holds about customers; the bank's own records
// (in its systems, behind the Bank Connector) are never touched here.
//   - Retention: conversations with no activity for `retention_conversation_days` are deleted (unless a case on them is
//     still open), and activity log entries older than `retention_audit_days`. Run at most once an hour.
//   - Erasure: on a customer's request, an operations admin deletes everything Orchestra holds from that customer's
//     conversations. The activity log keeps a row per lookup and action (the bank's record that they happened) with the
//     details removed, and one row saying who erased what and when.

const RUN_EVERY_MS = 60 * 60_000;

/** Deletes what is past the retention periods. Returns what it removed (nothing when it ran less than an hour ago). */
export async function applyRetention(sql: Sql, now = new Date(), force = false): Promise<{ conversations: number; auditRows: number } | null> {
  if (!force) {
    const [last] = await sql<{ value: string }[]>`select value from app_meta where key = 'retention_ran_at'`;
    if (last && now.getTime() - new Date(last.value).getTime() < RUN_EVERY_MS) return null;
  }
  await sql`insert into app_meta (key, value) values ('retention_ran_at', ${now.toISOString()})
    on conflict (key) do update set value = excluded.value`;
  const rules = await Rules.load(sql);
  const convDays = rules.num("retention_conversation_days", 365);
  const auditDays = rules.num("retention_audit_days", 2555);
  let conversations = 0;
  let auditRows = 0;
  if (convDays > 0) {
    const old = await sql<{ id: string }[]>`
      select c.id from conversations c
      where c.mode = 'customer' and c.last_activity < ${new Date(now.getTime() - convDays * 86_400_000)}
        and not exists (select 1 from escalations e where e.conversation_id = c.id and e.status = 'open')`;
    if (old.length) {
      const ids = old.map((o) => o.id);
      await sql`update audit_log set input = null, result = null where conversation_id = any(${ids}::uuid[])`;
      await sql`delete from conversations where id = any(${ids}::uuid[])`;
      conversations = ids.length;
    }
  }
  if (auditDays > 0) {
    const r = await sql`delete from audit_log where created_at < ${new Date(now.getTime() - auditDays * 86_400_000)}`;
    auditRows = r.count;
  }
  if (conversations || auditRows) {
    await sql`insert into audit_log (tool_use_id, kind, tool, summary)
      values (${`retention-${now.getTime()}`}, 'action', 'privacy',
              ${`Retention · ${conversations} conversation${conversations === 1 ? "" : "s"} past ${convDays} days deleted · ${auditRows} activity log entr${auditRows === 1 ? "y" : "ies"} past ${auditDays} days deleted`})`;
  }
  return { conversations, auditRows };
}

/** Whose conversations an erasure covers: the verified customer's (all of them), or just this one if never verified. */
async function scope(sql: Sql, conversationId: string): Promise<{ customer: string | null; ids: string[] } | null> {
  const [c] = await sql<{ id: string; verified_user_id: string | null; typing_user_id: string | null; payer_payment_id: string | null; origin: string | null }[]>`
    select id, verified_user_id, typing_user_id, payer_payment_id, origin from conversations where id = ${conversationId} and mode = 'customer'`;
  if (!c) return null;
  // The person is known only when the bank verified them; a tester's choice of sample customer (typing_user_id) or
  // what someone typed proves nothing.
  const [prev] = await sql<{ user_id: string | null }[]>`
    select user_id from audit_log where conversation_id = ${c.id} and kind = 'identity' and user_id is not null order by id desc limit 1`;
  const customer = c.verified_user_id ?? prev?.user_id ?? null;
  if (!customer) return { customer: null, ids: [c.id] };
  const rows = await sql<{ id: string }[]>`
    select distinct c.id from conversations c
    where c.mode = 'customer' and (c.verified_user_id = ${customer}
      or c.id in (select conversation_id from audit_log where kind = 'identity' and user_id = ${customer} and conversation_id is not null))`;
  return { customer, ids: [...new Set([c.id, ...rows.map((r) => r.id)])] };
}

/** What an erasure from this conversation would delete, for the confirmation step. */
export async function erasurePreview(sql: Sql, conversationId: string) {
  const s = await scope(sql, conversationId);
  if (!s) return { ok: false as const, error: "That conversation doesn't exist." };
  const [{ open }] = await sql<{ open: number }[]>`select count(*)::int as open from escalations where conversation_id = any(${s.ids}::uuid[]) and status = 'open'`;
  return { ok: true as const, verifiedCustomer: Boolean(s.customer), conversations: s.ids.length, openCases: open };
}

/** Deletes everything Orchestra holds from the customer's conversations. Refused while one of their cases is open. */
export async function eraseCustomer(sql: Sql, staff: StaffUser, conversationId: string, now = new Date()) {
  const s = await scope(sql, conversationId);
  if (!s) return { ok: false as const, error: "That conversation doesn't exist." };
  const ids = s.ids;
  const [{ open }] = await sql<{ open: number }[]>`select count(*)::int as open from escalations where conversation_id = any(${ids}::uuid[]) and status = 'open'`;
  if (open > 0) return { ok: false as const, error: `${open} of their case${open === 1 ? " is" : "s are"} still open. Resolve ${open === 1 ? "it" : "them"} in Cases first, then delete.` };
  await sql.begin(async (tx) => {
    // The activity log keeps that each lookup and action happened, without its details.
    await tx`update audit_log set input = null, result = null, refusal_reason = null,
        summary = coalesce(tool, kind) || ' · details deleted on the customer''s request'
      where conversation_id = any(${ids}::uuid[])${s.customer ? tx` or user_id = ${s.customer}` : tx``}`;
    await tx`delete from outbox where conversation_id = any(${ids}::uuid[])${s.customer ? tx` or user_id = ${s.customer}` : tx``}`;
    // Cases, proofs, drafts, reviews and the rest of each conversation go with it (they cascade).
    await tx`delete from conversations where id = any(${ids}::uuid[])`;
    await tx`insert into audit_log (tool_use_id, kind, tool, summary, staff)
      values (${`erase-${now.getTime()}`}, 'action', 'privacy',
              ${`Customer data deleted on request · ${ids.length} conversation${ids.length === 1 ? "" : "s"}${s.customer ? " of a verified customer" : ""} · by ${staff.name}. The bank's own records are unchanged.`},
              ${staff.name})`;
  });
  return { ok: true as const, conversations: ids.length };
}
