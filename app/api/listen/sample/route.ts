import { requirePermission } from "@/lib/auth.ts";
import { db } from "@/lib/db.ts";
import { ensureSeeded } from "@/lib/seed.ts";
import { ingestInteraction, SAMPLE_TICKETS } from "@/lib/listen.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** Testing: play a helpdesk sending Orchestra a ticket (invented customers), as POST /api/v1/interactions would. */
export async function GET() {
  return Response.json({ samples: SAMPLE_TICKETS.map((t, i) => ({ index: i, label: t.label })) });
}

export async function POST(req: Request) {
  if (!process.env.DATABASE_URL) return Response.json({ error: "not_configured" }, { status: 503 });
  const body = (await req.json().catch(() => null)) as { index?: number } | null;
  const t = SAMPLE_TICKETS[Number(body?.index)];
  if (!t) return Response.json({ error: "bad_request" }, { status: 400 });
  const sql = db();
  const viewer = await requirePermission(sql, req, "conversation_act");
  if (viewer instanceof Response) return viewer;
  await ensureSeeded(sql);
  // A fresh ticket id each time, so the sample can be sent again.
  const { label: _label, ...ticket } = t;
  const out = await ingestInteraction(sql, { ...ticket, external_id: `${t.external_id}-${Date.now().toString(36).slice(-4).toUpperCase()}` });
  return Response.json(out, { status: out.ok ? 200 : 400 });
}
