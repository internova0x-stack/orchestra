import { db } from "@/lib/db.ts";
import { requirePermission, updateMember } from "@/lib/auth.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Change someone's role, switch their account on or off, or reset their password (a new temporary one, shown once). */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!process.env.DATABASE_URL) return Response.json({ ok: false }, { status: 503 });
  const sql = db();
  const me = await requirePermission(sql, req, "team_manage");
  if (me instanceof Response) return me;
  const out = await updateMember(sql, me, id, (await req.json().catch(() => ({}))) ?? {});
  return Response.json(out, { status: out.ok ? 200 : 400 });
}
