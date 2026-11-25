import { requirePermission } from "@/lib/auth.ts";
import { db } from "@/lib/db.ts";
import { ensureSeeded } from "@/lib/seed.ts";
import { conversationMessages, openConversation, sendToAlexis } from "@/lib/api/channel.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

// The "use your own chat" test page (/try-your-chat): the same Channel API functions as /api/v1, run for a signed-in
// member of the team instead of an API key, so a developer sees exactly what their server would send and get back.
// It only touches conversations it opened itself.
const TEST_REF = "API test page";

export async function POST(req: Request) {
  if (!process.env.DATABASE_URL) return Response.json({ error: "not_configured" }, { status: 503 });
  const sql = db();
  const s = await requirePermission(sql, req, "api_view");
  if (s instanceof Response) return s;
  await ensureSeeded(sql);
  const body = (await req.json().catch(() => ({}))) as { action?: string; conversation_id?: string; request?: Record<string, unknown> };
  const r = body.request ?? {};

  if (body.action === "open") {
    const out = await openConversation(sql, {
      channel: "app", external_ref: TEST_REF, language: typeof r.language === "string" ? r.language : undefined,
      ...(typeof r.verified_user_id === "string" && r.verified_user_id ? { verified_user_id: r.verified_user_id } : {}),
    });
    return "error" in out
      ? Response.json({ status: 404, body: { error: out.error, message: "The bank doesn't know that user." } })
      : Response.json({ status: 201, body: out });
  }

  const id = String(body.conversation_id ?? "");
  const [c] = /^[0-9a-f-]{36}$/i.test(id) ? await sql<{ external_ref: string | null }[]>`select external_ref from conversations where id = ${id} and mode = 'customer'` : [];
  if (!c || c.external_ref !== TEST_REF) return Response.json({ status: 404, body: { error: "not_found" } });

  if (body.action === "send") {
    if (!process.env.ANTHROPIC_API_KEY) return Response.json({ status: 503, body: { error: "not_configured" } });
    const i = r.identity as Record<string, unknown> | undefined;
    const identity = i && typeof i.full_name === "string" && typeof i.date_of_birth === "string" && typeof i.registration_number === "string"
      ? { full_name: i.full_name, date_of_birth: i.date_of_birth, registration_number: i.registration_number } : undefined;
    if (typeof r.text !== "string" && typeof r.confirm !== "boolean" && typeof r.code !== "string" && !identity) {
      return Response.json({ status: 400, body: { error: "bad_request", message: "Send text, identity, confirm or code." } });
    }
    const out = await sendToAlexis(sql, id, {
      text: typeof r.text === "string" ? r.text.slice(0, 4000) : undefined, identity,
      confirm: typeof r.confirm === "boolean" ? r.confirm : undefined, code: typeof r.code === "string" ? r.code.slice(0, 12) : undefined,
    });
    return Response.json({ status: 200, body: out });
  }
  if (body.action === "get") return Response.json({ status: 200, body: await conversationMessages(sql, id) });
  return Response.json({ status: 400, body: { error: "bad_request" } });
}
