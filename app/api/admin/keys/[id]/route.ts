import { db } from "@/lib/db.ts";
import { revokeApiKey } from "@/lib/api/keys.ts";
import { logAdmin, requireApiAdmin } from "@/lib/api/admin.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Revoke a key: calls with it are refused from now on. */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!process.env.DATABASE_URL) return Response.json({ ok: false }, { status: 503 });
  const sql = db();
  const s = await requireApiAdmin(sql, req);
  if (s instanceof Response) return s;
  const done = await revokeApiKey(sql, id);
  if (done) await logAdmin(sql, s.name, `API key revoked · ${id}`);
  return Response.json({ ok: done });
}
