import { requirePermission } from "@/lib/auth.ts";
import { db } from "@/lib/db.ts";
import { ensureSeeded } from "@/lib/seed.ts";
import { demoToken, newSigningSecret, removeWidget, saveWidget, setWidgetLive, widgetView } from "@/lib/widget.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** The website chat widget on the API page: its settings (never the signing secret). */
export async function GET(req: Request) {
  if (!process.env.DATABASE_URL) return Response.json({ set: false }, { status: 503 });
  const sql = db();
  const viewer = await requirePermission(sql, req, "api_view");
  if (viewer instanceof Response) return viewer;
  await ensureSeeded(sql);
  return Response.json(await widgetView(sql), { headers: { "Cache-Control": "no-store" } });
}

/** Save the settings, create or replace the signing secret (shown once), go live or pause, remove; sign a sample token. */
export async function POST(req: Request) {
  if (!process.env.DATABASE_URL) return Response.json({ ok: false }, { status: 503 });
  const sql = db();
  const body = (await req.json().catch(() => ({}))) as { action?: string; title?: unknown; colour?: unknown; origins?: unknown; live?: unknown; customer?: unknown };
  // Trying the widget as a sample customer only needs the API page; changing it needs a manager.
  const s = await requirePermission(sql, req, body.action === "demo_token" ? "api_view" : "api_manage");
  if (s instanceof Response) return s;
  await ensureSeeded(sql);
  const out =
    body.action === "save" ? await saveWidget(sql, s, body)
    : body.action === "secret" ? await newSigningSecret(sql, s)
    : body.action === "live" ? await setWidgetLive(sql, s, body.live === true)
    : body.action === "remove" ? await removeWidget(sql, s)
    : body.action === "demo_token" ? await demoToken(sql, String(body.customer ?? ""))
    : { ok: false as const, error: "bad_request" };
  return Response.json(out, { status: out.ok ? 200 : 400, headers: { "Cache-Control": "no-store" } });
}
