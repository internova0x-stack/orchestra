import { randomUUID } from "node:crypto";
import { db } from "@/lib/db.ts";
import { deliver, retryPending } from "@/lib/api/webhooks.ts";
import { logAdmin, requireApiAdmin } from "@/lib/api/admin.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Send a test event to the endpoint, or retry its pending deliveries. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!process.env.DATABASE_URL) return Response.json({ ok: false }, { status: 503 });
  const sql = db();
  const body = (await req.json().catch(() => ({}))) as { action?: string; staffId?: string };
  const s = await requireApiAdmin(sql, req);
  if (s instanceof Response) return s;
  const [e] = await sql<{ id: string }[]>`select id from webhook_endpoints where id = ${id}`;
  if (!e) return Response.json({ ok: false, error: "No such endpoint." }, { status: 404 });
  if (body.action === "retry") return Response.json({ ok: true, retried: await retryPending(sql) });
  const payload = { id: `evt_${randomUUID()}`, type: "test", created: new Date().toISOString(), data: { message: "A test event from Orchestra. No action needed." } };
  const [d] = await sql<{ id: number }[]>`insert into webhook_deliveries (endpoint_id, event_id, event, payload) values (${id}, ${payload.id}, 'test', ${sql.json(payload as never)}) returning id`;
  await deliver(sql, d.id);
  const [r] = await sql<{ status: string; last_status: number | null; last_error: string | null }[]>`select status, last_status, last_error from webhook_deliveries where id = ${d.id}`;
  return Response.json({ ok: true, delivery: r });
}

/** Remove an endpoint (its deliveries go with it). */
export async function DELETE(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!process.env.DATABASE_URL) return Response.json({ ok: false }, { status: 503 });
  const sql = db();
  const s = await requireApiAdmin(sql, req);
  if (s instanceof Response) return s;
  const r = await sql`delete from webhook_endpoints where id = ${id} returning url`;
  if (r.length) await logAdmin(sql, s.name, `webhook removed · ${r[0].url}`);
  return Response.json({ ok: r.length > 0 });
}
