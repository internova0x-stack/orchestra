import type { Sql } from "../db.ts";
import { requirePermission, type Staff } from "../auth.ts";

/** Managing keys, webhooks and connectors: operations and IT admins (lib/auth.ts). */
export async function requireApiAdmin(sql: Sql, req: Request): Promise<Staff | Response> {
  const s = await requirePermission(sql, req, "api_manage");
  if (s instanceof Response) {
    const j = (await s.clone().json().catch(() => ({}))) as { message?: string };
    return Response.json({ ok: false, error: j.message ?? "Not allowed." }, { status: s.status });
  }
  return s;
}

export async function logAdmin(sql: Sql, staff: string, summary: string) {
  await sql`insert into audit_log (kind, tool, summary, staff) values ('rule_edit', 'api_admin', ${summary}, ${staff})`;
}
