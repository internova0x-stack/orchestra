import { db } from "@/lib/db.ts";
import { ensureSeeded } from "@/lib/seed.ts";
import { later } from "@/lib/api/webhooks.ts";
import { handleInbound, inboundSecretOk, type InboundEmail } from "@/lib/email/channel.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The email service (Postmark) posts each email forwarded from the bank's support address here. The secret in the
 * address is set by Orchestra when the channel is set up. Answered at once; Alexis's reply is worked out afterwards.
 */
export async function POST(req: Request, { params }: { params: Promise<{ secret: string }> }) {
  const { secret } = await params;
  if (!process.env.DATABASE_URL) return Response.json({ error: "not_configured" }, { status: 503 });
  const sql = db();
  await ensureSeeded(sql);
  if (!(await inboundSecretOk(sql, secret))) return Response.json({ error: "unauthorized" }, { status: 401 });
  const email = (await req.json().catch(() => null)) as InboundEmail | null;
  if (!email || typeof email !== "object") return Response.json({ error: "bad_request" }, { status: 400 });
  await later(async () => {
    try { await handleInbound(sql, email); } catch (err) { console.error("inbound email failed", err); }
  });
  return Response.json({ ok: true });
}
