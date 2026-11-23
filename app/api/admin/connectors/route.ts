import { requirePermission } from "@/lib/auth.ts";
import { db } from "@/lib/db.ts";
import { ensureSeeded } from "@/lib/seed.ts";
import { requireApiAdmin } from "@/lib/api/admin.ts";
import { CRM_KINDS, type CrmKind } from "@/lib/crm/contract.ts";
import { connectorSettings, handleCrmWebhook, sandboxCalls, saveConnector, type CrmMode } from "@/lib/crm/service.ts";
import { SAMPLE_WEBHOOK } from "@/lib/crm/sandbox.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const maxDuration = 60;

/** The four CRM connectors: settings, whether their credentials are set, and the sandbox's recent writes. */
export async function GET(req: Request) {
  if (!process.env.DATABASE_URL) return Response.json({ connectors: [] }, { status: 503 });
  const sql = db();
  const viewer = await requirePermission(sql, req, "api_view");
  if (viewer instanceof Response) return viewer;
  await ensureSeeded(sql);
  const list = await connectorSettings(sql);
  const connectors = await Promise.all(list.map(async (c) => ({ ...c, sample: SAMPLE_WEBHOOK[c.kind], writes: c.mode === "sandbox" ? await sandboxCalls(sql, c.kind) : [] })));
  return Response.json({ connectors }, { headers: { "Cache-Control": "no-store" } });
}

/** Change a connector (supervisors), or send the sandbox's test ticket through it. */
export async function POST(req: Request) {
  if (!process.env.DATABASE_URL) return Response.json({ ok: false }, { status: 503 });
  const sql = db();
  const body = (await req.json().catch(() => ({}))) as { staffId?: string; kind?: string; action?: string; mode?: string; write_back?: boolean; data_entry?: boolean; groups?: Record<string, string> };
  const s = await requireApiAdmin(sql, req);
  if (s instanceof Response) return s;
  if (!CRM_KINDS.includes(body.kind as CrmKind)) return Response.json({ ok: false, error: "Choose a connector." }, { status: 400 });
  const kind = body.kind as CrmKind;
  if (body.action === "test") {
    const out = await handleCrmWebhook(sql, kind, SAMPLE_WEBHOOK[kind], { consoleBase: new URL(req.url).origin });
    return Response.json(out.ok ? out : { ok: false, error: out.message }, { status: out.ok ? 200 : out.status });
  }
  const mode = body.mode as CrmMode | undefined;
  if (mode && !["off", "sandbox", "live"].includes(mode)) return Response.json({ ok: false, error: "Mode is off, sandbox or live." }, { status: 400 });
  const out = await saveConnector(sql, kind, {
    ...(mode ? { mode } : {}), ...(typeof body.write_back === "boolean" ? { write_back: body.write_back } : {}),
    ...(typeof body.data_entry === "boolean" ? { data_entry: body.data_entry } : {}), ...(body.groups && typeof body.groups === "object" ? { groups: body.groups } : {}),
  }, s.name);
  return Response.json(out, { status: out.ok ? 200 : 409 });
}
