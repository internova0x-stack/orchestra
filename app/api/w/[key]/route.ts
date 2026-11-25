import { db } from "@/lib/db.ts";
import { ensureSeeded } from "@/lib/seed.ts";
import { liveWidget } from "@/lib/widget.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

// The website chat widget's look, read by public/widget.js on the bank's page (any site may read it: it's
// public, and the chat itself only opens on the widget's listed websites).
const CORS = { "Access-Control-Allow-Origin": "*", "Cache-Control": "public, max-age=60" };

export async function GET(_req: Request, { params }: { params: Promise<{ key: string }> }) {
  const { key } = await params;
  if (!process.env.DATABASE_URL) return Response.json({ live: false }, { status: 503, headers: CORS });
  const sql = db();
  await ensureSeeded(sql);
  const w = await liveWidget(sql, key);
  if (!w) return Response.json({ live: false }, { status: 404, headers: CORS });
  return Response.json({ live: true, title: w.title, colour: w.colour }, { headers: CORS });
}
