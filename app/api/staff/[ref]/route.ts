import { db } from "@/lib/db.ts";
import { decide, staffUser, type Decision } from "@/lib/staff.ts";
import { transcriptOf } from "@/lib/cases.ts";
import { moveTeam, pickUp } from "@/lib/routing.ts";

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

const ROUTING_ERRORS: Record<string, string> = {
  not_found: "That case isn't there any more.", closed: "This case is already closed.",
  unknown_team: "Choose one of the teams in the list.", already_assigned: "Someone else has already picked this case up.",
};

/** Approve or decline a prepared action, mark the case resolved, pick it up, or move it to another team. */
export async function POST(req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const body = (await req.json().catch(() => null)) as { decision?: Decision; note?: string; staffId?: string; route?: "pick_up" | "move"; team?: string } | null;
  if (body?.route === "pick_up" || body?.route === "move") {
    if (!process.env.DATABASE_URL) return Response.json({ error: "not_configured" }, { status: 503 });
    const sql = db();
    const staff = await staffUser(sql, body.staffId);
    if (!staff) return Response.json({ ok: false, error: "sign_in" }, { status: 401 });
    const err = body.route === "pick_up" ? await pickUp(sql, ref.toUpperCase(), staff) : await moveTeam(sql, ref.toUpperCase(), String(body.team ?? ""), staff);
    if (err) return Response.json({ ok: false, error: err, message: ROUTING_ERRORS[err] }, { status: err === "not_found" ? 404 : 409 });
    return Response.json({ ok: true });
  }
  if (!body?.decision || !["approve", "decline", "resolve", "claim_sent"].includes(body.decision)) return Response.json({ error: "bad_request" }, { status: 400 });
  if (!process.env.DATABASE_URL) return Response.json({ error: "not_configured" }, { status: 503 });
  const sql = db();
  const staff = await staffUser(sql, body.staffId);
  if (!staff) return Response.json({ ok: false, error: "sign_in" }, { status: 401 });
  const out = await decide(sql, ref.toUpperCase(), body.decision, body.note ?? null, staff);
  return Response.json(out, { status: out.ok ? 200 : out.error === "not_found" ? 404 : out.error === "supervisor_only" ? 403 : 409 });
}
