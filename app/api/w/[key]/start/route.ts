import { db } from "@/lib/db.ts";
import { ensureSeeded } from "@/lib/seed.ts";
import { liveWidget, startConversation, visitorOf } from "@/lib/widget.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A visitor opens the chat: a new conversation, verified if the bank's page passed a signed-in customer's token. */
export async function POST(req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!process.env.DATABASE_URL) return Response.json({ error: "not_configured" }, { status: 503 });
  const sql = db();
  await ensureSeeded(sql);
  const w = await liveWidget(sql, key);
  if (!w) return Response.json({ error: "not_live" }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { token?: unknown; language?: unknown };
  const out = await startConversation(sql, w, { token: body.token, language: body.language, visitor: visitorOf(req) });
  return Response.json(out, { status: out.ok ? 200 : out.error === "too_many" ? 429 : 401, headers: { "Cache-Control": "no-store" } });
}
