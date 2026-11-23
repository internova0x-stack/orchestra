import { db } from "@/lib/db.ts";
import { ensureSeeded } from "@/lib/seed.ts";
import { requireKey } from "@/lib/api/auth.ts";
import { ingestInteraction, type InteractionIn } from "@/lib/listen.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * Listen mode: a helpdesk, CRM or support mailbox sends each ticket or message as it happens. Orchestra matches
 * the customer, categorises, routes, looks up the references and drafts a reply for the team (interaction.analyzed).
 */
export async function POST(req: Request) {
  if (!process.env.DATABASE_URL) return Response.json({ error: "not_configured" }, { status: 503 });
  const sql = db();
  await ensureSeeded(sql);
  const key = await requireKey(sql, req);
  if (key instanceof Response) return key;
  const body = (await req.json().catch(() => null)) as InteractionIn | null;
  if (!body) return Response.json({ error: "bad_request", message: "Send JSON." }, { status: 400 });
  const out = await ingestInteraction(sql, body);
  if (!out.ok) return Response.json(out, { status: out.error === "switched_off" ? 409 : 400 });
  return Response.json(out, { status: 202 });
}
