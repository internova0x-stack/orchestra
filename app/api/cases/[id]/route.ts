import { db } from "@/lib/db.ts";
import { transcriptOf } from "@/lib/cases.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One conversation's full chat history (text only, secrets already masked), its activity log and handoffs. */
export async function GET(_req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!process.env.DATABASE_URL) return Response.json({ error: "not_configured" }, { status: 503 });
  if (!/^[0-9a-f-]{36}$/i.test(id)) return Response.json({ error: "not_found" }, { status: 404 });
  const sql = db();
  const [c] = await sql`select id, messages from conversations where id = ${id} and mode = 'customer'`;
  if (!c) return Response.json({ error: "not_found" }, { status: 404 });
  const activity = await sql`select id, kind, summary, staff, created_at from audit_log where conversation_id = ${id} order by id`;
  const handoffs = await sql`select reference, urgency, status, trigger, created_at from escalations where conversation_id = ${id} order by created_at`;
  return Response.json({ transcript: transcriptOf(c.messages), activity, handoffs }, { headers: { "Cache-Control": "no-store" } });
}
