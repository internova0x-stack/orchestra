import { db } from "@/lib/db.ts";
import { sendToAlexis } from "@/lib/api/channel.ts";
import { conversationForLink, deliverAlexisReply } from "@/lib/email/channel.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The private form page from an email: what's needed now (the identity check, a Yes/Cancel or a code). */
export async function GET(_req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!process.env.DATABASE_URL) return Response.json({ error: "not_configured" }, { status: 503 });
  const c = await conversationForLink(db(), token);
  if (!c) return Response.json({ error: "expired", message: "This link has expired. Reply to our email and we'll send a new one." }, { status: 404 });
  return Response.json({ need: c.need });
}

/** The customer's answer: it goes to Alexis like any turn, and her reply is emailed and shown on the page. */
export async function POST(req: Request, { params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  if (!process.env.DATABASE_URL || !process.env.ANTHROPIC_API_KEY) return Response.json({ error: "not_configured" }, { status: 503 });
  const sql = db();
  const c = await conversationForLink(sql, token);
  if (!c?.need) return Response.json({ error: "expired", message: "Nothing is waiting on this link. Reply to our email if you need anything else." }, { status: 404 });
  const body = (await req.json().catch(() => ({}))) as { identity?: { full_name?: unknown; date_of_birth?: unknown; registration_number?: unknown }; confirm?: unknown; code?: unknown };
  const id = body.identity;
  const identity = c.need.type === "identity" && id && typeof id.full_name === "string" && typeof id.date_of_birth === "string" && typeof id.registration_number === "string"
    ? { full_name: id.full_name.slice(0, 200), date_of_birth: id.date_of_birth.slice(0, 20), registration_number: id.registration_number.slice(0, 40) } : undefined;
  const confirm = c.need.type === "confirm" && typeof body.confirm === "boolean" ? body.confirm : undefined;
  const code = c.need.type === "code" && typeof body.code === "string" ? body.code.slice(0, 12) : undefined;
  if (!identity && confirm === undefined && code === undefined) return Response.json({ error: "bad_request", message: "Fill in the form first." }, { status: 400 });
  // One use: the link is spent once answered (a new form gets a new link in the next email).
  await sql`update conversations set email_link_token = null, email_link_expires = null where id = ${c.id}`;
  const reply = await sendToAlexis(sql, c.id, { identity, confirm, code });
  await deliverAlexisReply(sql, c.id, reply);
  return Response.json({ ok: true, reply: reply.reply, more: reply.needs.length > 0 });
}
