import { db } from "@/lib/db.ts";
import { ensureSeeded } from "@/lib/seed.ts";
import { requireKey, UUID } from "@/lib/api/auth.ts";
import { sendToAlexis } from "@/lib/api/channel.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Channel API: send the customer's message (or their answer to the identity check, a confirmation or a
 * code) and get Alexis's reply. Only after the API key and the conversation are checked.
 */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!process.env.DATABASE_URL || !process.env.ANTHROPIC_API_KEY) return Response.json({ error: "not_configured" }, { status: 503 });
  const sql = db();
  await ensureSeeded(sql);
  const key = await requireKey(sql, req);
  if (key instanceof Response) return key;
  if (!UUID.test(id)) return Response.json({ error: "not_found" }, { status: 404 });
  const [c] = await sql`select id from conversations where id = ${id} and mode = 'customer'`;
  if (!c) return Response.json({ error: "not_found", message: "Open the conversation first (POST /api/v1/conversations)." }, { status: 404 });
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const hasOne = body && (typeof body.text === "string" || typeof body.confirm === "boolean" || typeof body.code === "string" || (body.identity && typeof body.identity === "object"));
  if (!hasOne) return Response.json({ error: "bad_request", message: "Send text, identity, confirm or code." }, { status: 400 });
  const id2 = body!.identity as { full_name?: unknown; date_of_birth?: unknown; registration_number?: unknown } | undefined;
  const identity = id2 && typeof id2.full_name === "string" && typeof id2.date_of_birth === "string" && typeof id2.registration_number === "string"
    ? { full_name: id2.full_name, date_of_birth: id2.date_of_birth, registration_number: id2.registration_number } : undefined;
  const out = await sendToAlexis(sql, id, {
    text: typeof body!.text === "string" ? body!.text : undefined,
    identity,
    confirm: typeof body!.confirm === "boolean" ? body!.confirm : undefined,
    code: typeof body!.code === "string" ? body!.code : undefined,
  });
  return Response.json(out);
}
