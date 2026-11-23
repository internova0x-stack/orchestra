import { db } from "@/lib/db.ts";
import { enableDemoTeam, requirePermission } from "@/lib/auth.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Let the sample team (invented people, one per role) sign in with one password the admin chooses, to try each role. */
export async function POST(req: Request) {
  if (!process.env.DATABASE_URL) return Response.json({ ok: false }, { status: 503 });
  const sql = db();
  const me = await requirePermission(sql, req, "team_manage");
  if (me instanceof Response) return me;
  const body = (await req.json().catch(() => ({}))) as { password?: unknown };
  const out = await enableDemoTeam(sql, me, body.password);
  return Response.json(out, { status: out.ok ? 200 : 400 });
}
