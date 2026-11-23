import { db } from "@/lib/db.ts";
import { ensureSeeded } from "@/lib/seed.ts";
import { offered, type CrmKind } from "@/lib/crm/contract.ts";
import { handleCrmWebhook, webhookTokenOk } from "@/lib/crm/service.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/**
 * The address a bank pastes into its helpdesk (the API page's step 2): the secret at the end of the address
 * stands in for an API key, since a helpdesk's webhook can't always send one. Disconnecting keeps the address;
 * calls simply stop doing anything until the connector is on again.
 */
export async function POST(req: Request, { params }: { params: Promise<{ kind: string; token: string }> }) {
  const { kind, token } = await params;
  if (!offered(kind)) return Response.json({ error: "not_found" }, { status: 404 });
  if (!process.env.DATABASE_URL) return Response.json({ error: "not_configured" }, { status: 503 });
  const sql = db();
  await ensureSeeded(sql);
  if (!(await webhookTokenOk(sql, kind as CrmKind, token))) return Response.json({ error: "unauthorized", message: "This webhook address isn't valid. Copy it again from the API page." }, { status: 401 });
  const body = await req.json().catch(() => null);
  const out = await handleCrmWebhook(sql, kind as CrmKind, body, { consoleBase: new URL(req.url).origin });
  return Response.json(out, { status: out.ok ? 200 : out.status });
}
