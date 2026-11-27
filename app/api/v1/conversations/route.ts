import { db } from "@/lib/db.ts";
import { ensureSeeded } from "@/lib/seed.ts";
import { requireKey } from "@/lib/api/auth.ts";
import { openConversation } from "@/lib/api/channel.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Channel API: open a conversation for a customer (optionally one the bank's app already signed in). */
export async function POST(req: Request) {
  if (!process.env.DATABASE_URL) return Response.json({ error: "not_configured" }, { status: 503 });
  const sql = db();
  await ensureSeeded(sql);
  const key = await requireKey(sql, req);
  if (key instanceof Response) return key;
  const body = (await req.json().catch(() => ({}))) as { channel?: string; verified_user_id?: string; external_ref?: string; language?: string; subject?: string; country?: string };
  const out = await openConversation(sql, body);
  if ("error" in out) return Response.json({ error: out.error, message: "The bank doesn't know that user." }, { status: 404 });
  return Response.json(out, { status: 201 });
}
