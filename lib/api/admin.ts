import type { Sql } from "../db.ts";
import { staffUser, type StaffUser } from "../staff.ts";

/** Managing keys and webhooks is a supervisor's job (simulated sign-in, like the rest of the console). */
export async function requireSupervisor(sql: Sql, staffId: string | null | undefined): Promise<StaffUser | Response> {
  const s = await staffUser(sql, staffId);
  if (!s) return Response.json({ ok: false, error: "Sign in at the top of the API page first." }, { status: 403 });
  if (s.role !== "supervisor") return Response.json({ ok: false, error: "Only a supervisor can manage API keys and webhooks." }, { status: 403 });
  return s;
}

export async function logAdmin(sql: Sql, staff: string, summary: string) {
  await sql`insert into audit_log (kind, tool, summary, staff) values ('rule_edit', 'api_admin', ${summary}, ${staff})`;
}
