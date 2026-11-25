import { db } from "@/lib/db.ts";
import { ensureSeeded } from "@/lib/seed.ts";
import { liveWidget } from "@/lib/widget.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The websites allowed to show the chat frame, for proxy.ts's frame-ancestors header. */
export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!process.env.DATABASE_URL) return Response.json({ origins: [] });
  const sql = db();
  await ensureSeeded(sql);
  const w = await liveWidget(sql, key);
  return Response.json({ origins: w?.origins ?? [] }, { headers: { "Cache-Control": "no-store" } });
}
