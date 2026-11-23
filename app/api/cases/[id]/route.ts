import { requirePermission } from "@/lib/auth.ts";
import { db } from "@/lib/db.ts";
import { transcriptOf } from "@/lib/cases.ts";
import { handBack, staffReply, takeOver } from "@/lib/takeover.ts";
import { saveReview, translateConversation } from "@/lib/review.ts";
import { runStaffAction, STAFF_ACTIONS } from "@/lib/staffActions.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

/** One conversation's full chat history (text only, secrets already masked), its activity log and handoffs. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!process.env.DATABASE_URL) return Response.json({ error: "not_configured" }, { status: 503 });
  if (!UUID.test(id)) return Response.json({ error: "not_found" }, { status: 404 });
  const sql = db();
  const viewer = await requirePermission(sql, req, "inbox_view");
  if (viewer instanceof Response) return viewer;
  const [c] = await sql`select c.id, c.messages, c.proactive, c.listen, c.taken_over_by, c.awaiting_team, c.language, r.rating, r.note, r.reviewed_by
    from conversations c left join conversation_reviews r on r.conversation_id = c.id where c.id = ${id} and c.mode = 'customer'`;
  if (!c) return Response.json({ error: "not_found" }, { status: 404 });
  const activity = await sql`select id, kind, summary, staff, created_at from audit_log where conversation_id = ${id} order by id`;
  const handoffs = await sql`select reference, urgency, status, trigger, created_at from escalations where conversation_id = ${id} order by created_at`;
  return Response.json({
    // A conversation Alexis started opens with her failure message.
    listen: c.listen ? { source: c.listen.source, externalId: c.listen.external_id, match: c.listen.match, analysis: c.listen.analysis ?? null } : null,
    transcript: [...(c.proactive ? [{ who: "Alexis", text: `${c.proactive.text}`, proactive: true }] : []), ...transcriptOf(c.messages)], activity, handoffs, takenOverBy: c.taken_over_by, awaitingTeam: c.awaiting_team, language: c.language,
    review: c.rating ? { rating: c.rating, note: c.note, by: c.reviewed_by } : null,
  }, { headers: { "Cache-Control": "no-store" } });
}

const ERRORS: Record<string, string> = {
  not_found: "That conversation isn't there any more.",
  taken_over_by_someone_else: "Someone else on the team is already handling this conversation.",
  not_taken_over: "Take the conversation over first.",
  empty: "Type a reply first.",
};

/** Take over, hand back, or reply to the customer as the signed-in member of the team. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!process.env.DATABASE_URL) return Response.json({ error: "not_configured" }, { status: 503 });
  if (!UUID.test(id)) return Response.json({ error: "not_found" }, { status: 404 });
  const body = (await req.json().catch(() => null)) as { action?: string; staffId?: string; text?: string; rating?: string; note?: string; tool?: string; input?: Record<string, unknown> } | null;
  const sql = db();
  const staff = await requirePermission(sql, req, "conversation_act");
  if (staff instanceof Response) return staff;
  // Account actions by the team (lib/staffActions.ts), and the one-time code they send for the stronger check.
  if (body?.action === "staff_action" || body?.action === "send_code") {
    const tool = String(body.tool ?? "");
    if (body.action === "staff_action" && !STAFF_ACTIONS[tool]) return Response.json({ error: "bad_request", message: "Choose an action." }, { status: 400 });
    const input = body.input && typeof body.input === "object" && !Array.isArray(body.input) ? body.input : {};
    const out = await runStaffAction(sql, id, staff, tool, input, { sendCode: body.action === "send_code" });
    return Response.json(out, { status: out.status === "error" ? (out.error === "not_found" ? 404 : 409) : 200 });
  }
  if (body?.action === "translate") {
    if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "not_configured", message: "The AI service isn't set up." }, { status: 503 });
    const t = await translateConversation(sql, id).catch(() => null);
    if (t === "not_found") return Response.json({ error: "not_found", message: ERRORS.not_found }, { status: 404 });
    if (!t) return Response.json({ error: "failed", message: "The translation didn't work. Try again." }, { status: 502 });
    return Response.json({ ok: true, translation: t });
  }
  if (body?.action === "review") {
    if (body.rating !== "good" && body.rating !== "needs_work") return Response.json({ error: "bad_request", message: "Choose Good or Needs work." }, { status: 400 });
    const r = await saveReview(sql, id, staff, body.rating, typeof body.note === "string" ? body.note : null);
    if (r) return Response.json({ error: r, message: ERRORS[r] }, { status: 404 });
    return Response.json({ ok: true });
  }
  const err =
    body?.action === "take_over" ? await takeOver(sql, id, staff)
    : body?.action === "hand_back" ? await handBack(sql, id, staff)
    : body?.action === "reply" && typeof body.text === "string" ? await staffReply(sql, id, staff, body.text)
    : "bad_request";
  if (err) return Response.json({ error: err, message: ERRORS[err] ?? "That didn't go through." }, { status: err === "not_found" ? 404 : 409 });
  return Response.json({ ok: true });
}
