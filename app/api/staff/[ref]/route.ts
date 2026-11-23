import { db } from "@/lib/db.ts";
import { decide, staffUser, type Decision } from "@/lib/staff.ts";
import { transcriptOf } from "@/lib/cases.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** One case: the handoff summary, the transcript (text only, secrets already masked) and the activity log. */
export async function GET(_req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  if (!process.env.DATABASE_URL) return Response.json({ error: "not_configured" }, { status: 503 });
  const sql = db();
  const rows = await sql`
    select e.*, b.name as business, c.messages
    from escalations e left join businesses b on b.id = e.business_id left join conversations c on c.id = e.conversation_id
    where e.reference = ${ref.toUpperCase()}`;
  const c = rows[0];
  if (!c) return Response.json({ error: "not_found" }, { status: 404 });
  const transcript = transcriptOf(c.messages);
  const activity = c.conversation_id
    ? await sql`select id, kind, summary, approver, created_at from audit_log where conversation_id = ${c.conversation_id} order by id`
    : [];
  const { messages: _m, ...rest } = c;
  const claim = c.action?.type === "claim" ? (await sql`select reference, to_party, draft, deadline, status, sent_at from claim_drafts where reference = ${c.action.reference}`)[0] ?? null : null;
  return Response.json({ case: rest, transcript, activity, claim }, { headers: { "Cache-Control": "no-store" } });
}

/** Approve or decline a prepared action, or mark the case resolved. */
export async function POST(req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const body = (await req.json().catch(() => null)) as { decision?: Decision; note?: string; staffId?: string } | null;
  if (!body?.decision || !["approve", "decline", "resolve", "claim_sent"].includes(body.decision)) return Response.json({ error: "bad_request" }, { status: 400 });
  if (!process.env.DATABASE_URL) return Response.json({ error: "not_configured" }, { status: 503 });
  const sql = db();
  const staff = await staffUser(sql, body.staffId);
  if (!staff) return Response.json({ ok: false, error: "sign_in" }, { status: 401 });
  const out = await decide(sql, ref.toUpperCase(), body.decision, body.note ?? null, staff);
  return Response.json(out, { status: out.ok ? 200 : out.error === "not_found" ? 404 : out.error === "supervisor_only" ? 403 : 409 });
}
