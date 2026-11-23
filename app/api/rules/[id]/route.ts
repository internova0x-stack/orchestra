import { requirePermission } from "@/lib/auth.ts";
import { db } from "@/lib/db.ts";
import { MARKETS, type Market } from "@/lib/rules.ts";
import { proposeChange, ruleHistory, ruleImpact } from "@/lib/ruleChanges.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A rule's history and the saved conversations it was used in. */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!process.env.DATABASE_URL) return Response.json({ history: [], impact: [] }, { status: 503 });
  const sql = db();
  const viewer = await requirePermission(sql, req, "rules_view");
  if (viewer instanceof Response) return viewer;
  const [history, impact] = await Promise.all([ruleHistory(sql, id), ruleImpact(sql, id)]);
  return Response.json({ history, impact }, { headers: { "Cache-Control": "no-store" } });
}

/**
 * Change a rule as the signed-in member of the team: a supervisor's change applies to Alexis's next
 * message; anyone else's waits for a supervisor. `value: null` with a market returns it to the default.
 */
export async function PATCH(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { value?: unknown; market?: unknown; staffId?: string } | null;
  if (body?.value !== null && typeof body?.value !== "string") return Response.json({ ok: false, error: "A value is needed." }, { status: 400 });
  if (!process.env.DATABASE_URL) return Response.json({ ok: false, error: "The database isn't connected." }, { status: 503 });
  const sql = db();
  const staff = await requirePermission(sql, req, "rules_propose");
  if (staff instanceof Response) return staff;
  const market = MARKETS.some((m) => m.id === body.market) ? (body.market as Market) : null;
  const out = await proposeChange(sql, { ruleId: id, market, value: body.value as string | null, staff });
  return Response.json(out, { status: out.ok ? 200 : 400 });
}
