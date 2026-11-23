import { db } from "@/lib/db.ts";
import { ensureSeeded } from "@/lib/seed.ts";
import { requireKey } from "@/lib/api/auth.ts";
import { CRM_KINDS, type CrmKind } from "@/lib/crm/contract.ts";
import { handleCrmWebhook } from "@/lib/crm/service.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * A CRM connector's webhook: Zendesk, Freshdesk, Salesforce or HubSpot calls it when a ticket is created or the
 * customer replies. Orchestra reads the ticket through the connector, analyses it (listen mode) and writes the result
 * back into the ticket. Authenticated with an Orchestra API key (header, or ?key= for tools that can't set one).
 */
export async function POST(req: Request, { params }: { params: Promise<{ kind: string }> }) {
  const { kind } = await params;
  if (!CRM_KINDS.includes(kind as CrmKind)) return Response.json({ error: "not_found" }, { status: 404 });
  if (!process.env.DATABASE_URL) return Response.json({ error: "not_configured" }, { status: 503 });
  const sql = db();
  await ensureSeeded(sql);
  const key = await requireKey(sql, req);
  if (key instanceof Response) return key;
  const body = await req.json().catch(() => null);
  const out = await handleCrmWebhook(sql, kind as CrmKind, body, { consoleBase: new URL(req.url).origin });
  return Response.json(out, { status: out.ok ? 200 : out.status });
}
