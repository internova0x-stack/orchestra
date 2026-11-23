import { db } from "@/lib/db.ts";
import { ensureSeeded } from "@/lib/seed.ts";
import { createApiKey } from "@/lib/api/keys.ts";
import { logAdmin, requireSupervisor } from "@/lib/api/admin.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The API keys (never the keys themselves: only their prefix). */
export async function GET() {
  if (!process.env.DATABASE_URL) return Response.json({ keys: [] }, { status: 503 });
  const sql = db();
  await ensureSeeded(sql);
  const keys = await sql`select id, name, prefix, created_by, created_at, last_used_at, revoked_at from api_keys order by created_at desc`;
  return Response.json({ keys }, { headers: { "Cache-Control": "no-store" } });
}

/** Create a key. The full key is in this response only; it isn't stored. */
export async function POST(req: Request) {
  if (!process.env.DATABASE_URL) return Response.json({ ok: false }, { status: 503 });
  const sql = db();
  const body = (await req.json().catch(() => ({}))) as { name?: string; staffId?: string };
  const s = await requireSupervisor(sql, body.staffId);
  if (s instanceof Response) return s;
  const k = await createApiKey(sql, body.name ?? "", s.name);
  await logAdmin(sql, s.name, `API key created · ${body.name?.trim() || "Unnamed"} · ${k.prefix}`);
  return Response.json({ ok: true, ...k });
}
