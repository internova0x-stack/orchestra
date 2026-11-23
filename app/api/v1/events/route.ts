import { db } from "@/lib/db.ts";
import { ensureSeeded } from "@/lib/seed.ts";
import { requireKey } from "@/lib/api/auth.ts";
import { receiveEvent } from "@/lib/api/events.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Events API: the bank reports a status change; Alexis's proactive updates follow. */
export async function POST(req: Request) {
  if (!process.env.DATABASE_URL) return Response.json({ error: "not_configured" }, { status: 503 });
  const sql = db();
  await ensureSeeded(sql);
  const key = await requireKey(sql, req);
  if (key instanceof Response) return key;
  const body = (await req.json().catch(() => null)) as { id?: unknown; type?: unknown; data?: Record<string, unknown> } | null;
  const out = await receiveEvent(sql, body ?? {});
  return Response.json(out, { status: out.ok ? (out.duplicate ? 200 : 202) : out.error === "not_found" ? 404 : 400 });
}
