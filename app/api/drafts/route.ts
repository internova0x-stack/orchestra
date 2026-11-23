import { db } from "@/lib/db.ts";
import { staffUser } from "@/lib/staff.ts";
import { draftReply } from "@/lib/drafting.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const UUID = /^[0-9a-f-]{36}$/i;

/** Draft the team's reply to a customer (Inbox and Staff queue). Returns text for the person to edit; sends nothing. */
export async function POST(req: Request) {
  if (!process.env.DATABASE_URL) return Response.json({ error: "not_configured", message: "The database isn't connected." }, { status: 503 });
  if (!process.env.ANTHROPIC_API_KEY) return Response.json({ error: "not_configured", message: "The AI service isn't set up." }, { status: 503 });
  const body = (await req.json().catch(() => null)) as { conversationId?: string; staffId?: string; purpose?: string } | null;
  if (!body?.conversationId || !UUID.test(body.conversationId)) return Response.json({ error: "bad_request", message: "Open a conversation first." }, { status: 400 });
  const sql = db();
  const staff = await staffUser(sql, body.staffId);
  if (!staff) return Response.json({ error: "sign_in", message: "Sign in as a member of the team first." }, { status: 403 });
  try {
    const out = await draftReply(sql, body.conversationId, staff, typeof body.purpose === "string" ? body.purpose : null);
    if ("error" in out) return Response.json({ error: out.error, message: out.error === "empty" ? "There's nothing in the conversation to reply to yet." : "That conversation isn't there any more." }, { status: 404 });
    return Response.json({ ok: true, draft: out.draft });
  } catch {
    return Response.json({ error: "failed", message: "Alexis couldn't draft a reply just now. Try again, or write it yourself." }, { status: 502 });
  }
}
