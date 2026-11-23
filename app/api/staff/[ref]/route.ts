import { db } from "@/lib/db.ts";
import { decide, type Decision } from "@/lib/staff.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Block = { type: string; text?: string };
type Message = { role: string; content: string | Block[] };

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
  const transcript = ((c.messages ?? []) as Message[])
    .map((m) => ({
      who: m.role === "assistant" ? "Alexis" : "Customer",
      text: typeof m.content === "string" ? m.content : m.content.map((b) => (b.type === "text" && b.text?.trim() ? b.text : b.type === "image" ? "[Screenshot attached]" : "")).filter(Boolean).join("\n"),
    }))
    .filter((m) => m.text);
  const activity = c.conversation_id
    ? await sql`select id, kind, summary, approver, created_at from audit_log where conversation_id = ${c.conversation_id} order by id`
    : [];
  const { messages: _m, ...rest } = c;
  return Response.json({ case: rest, transcript, activity }, { headers: { "Cache-Control": "no-store" } });
}

/** Approve or decline a prepared action, or mark the case resolved. */
export async function POST(req: Request, { params }: { params: Promise<{ ref: string }> }) {
  const { ref } = await params;
  const body = (await req.json().catch(() => null)) as { decision?: Decision; note?: string } | null;
  if (!body?.decision || !["approve", "decline", "resolve"].includes(body.decision)) return Response.json({ error: "bad_request" }, { status: 400 });
  if (!process.env.DATABASE_URL) return Response.json({ error: "not_configured" }, { status: 503 });
  const out = await decide(db(), ref.toUpperCase(), body.decision, body.note ?? null);
  return Response.json(out, { status: out.ok ? 200 : out.error === "not_found" ? 404 : 409 });
}
