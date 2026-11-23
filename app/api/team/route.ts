import { db } from "@/lib/db.ts";
import { ensureSeeded } from "@/lib/seed.ts";
import { addMember, listTeam, requirePermission, ROLE_ABOUT, ROLE_NAME, ROLES } from "@/lib/auth.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The team's accounts (operations and IT admins). Never a password or its hash. */
export async function GET(req: Request) {
  if (!process.env.DATABASE_URL) return Response.json({ team: [] }, { status: 503 });
  const sql = db();
  await ensureSeeded(sql);
  const me = await requirePermission(sql, req, "team_manage");
  if (me instanceof Response) return me;
  return Response.json({ team: await listTeam(sql), roles: ROLES.map((r) => ({ id: r, name: ROLE_NAME[r], about: ROLE_ABOUT[r] })), me: me.id }, { headers: { "Cache-Control": "no-store" } });
}

/** Add an account: the temporary password is in this response only. */
export async function POST(req: Request) {
  if (!process.env.DATABASE_URL) return Response.json({ ok: false }, { status: 503 });
  const sql = db();
  const me = await requirePermission(sql, req, "team_manage");
  if (me instanceof Response) return me;
  const out = await addMember(sql, me, (await req.json().catch(() => ({}))) ?? {});
  return Response.json(out, { status: out.ok ? 200 : 400 });
}
