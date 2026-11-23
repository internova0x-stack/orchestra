import { randomBytes } from "node:crypto";
import { db } from "@/lib/db.ts";
import { ensureSeeded } from "@/lib/seed.ts";
import { WEBHOOK_EVENTS, newSecret, webhookUrlProblem } from "@/lib/api/webhooks.ts";
import { logAdmin, requireSupervisor } from "@/lib/api/admin.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Webhook endpoints (the secret is never sent again) and the latest deliveries. */
export async function GET() {
  if (!process.env.DATABASE_URL) return Response.json({ endpoints: [], deliveries: [], events: WEBHOOK_EVENTS }, { status: 503 });
  const sql = db();
  await ensureSeeded(sql);
  const endpoints = await sql`select id, url, events, active, created_by, created_at from webhook_endpoints order by created_at desc`;
  const deliveries = await sql`select d.id, d.endpoint_id, e.url, d.event, d.status, d.attempts, d.last_status, d.last_error, d.created_at, d.delivered_at
    from webhook_deliveries d join webhook_endpoints e on e.id = d.endpoint_id order by d.id desc limit 30`;
  return Response.json({ endpoints, deliveries, events: WEBHOOK_EVENTS }, { headers: { "Cache-Control": "no-store" } });
}

/** Add an endpoint. Its signing secret is in this response only. */
export async function POST(req: Request) {
  if (!process.env.DATABASE_URL) return Response.json({ ok: false }, { status: 503 });
  const sql = db();
  const body = (await req.json().catch(() => ({}))) as { url?: string; events?: string[]; staffId?: string };
  const s = await requireSupervisor(sql, body.staffId);
  if (s instanceof Response) return s;
  const url = (body.url ?? "").trim();
  const problem = webhookUrlProblem(url);
  if (problem) return Response.json({ ok: false, error: problem }, { status: 400 });
  const events = (body.events ?? []).filter((e) => (WEBHOOK_EVENTS as readonly string[]).includes(e));
  if (!events.length) return Response.json({ ok: false, error: "Choose at least one event." }, { status: 400 });
  const id = `wh_${randomBytes(6).toString("hex")}`;
  const secret = newSecret();
  await sql`insert into webhook_endpoints (id, url, secret, events, created_by) values (${id}, ${url}, ${secret}, ${events}, ${s.name})`;
  await logAdmin(sql, s.name, `webhook added · ${url} · ${events.join(", ")}`);
  return Response.json({ ok: true, id, secret });
}
