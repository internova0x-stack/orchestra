import { requirePermission } from "@/lib/auth.ts";
import { db } from "@/lib/db.ts";
import { decideMany } from "@/lib/ruleChanges.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Select all: a supervisor approves or declines many waiting changes. Big changes and conflicts are skipped. */
export async function POST(req: Request) {
  const body = (await req.json().catch(() => null)) as { ids?: unknown; decision?: string } | null;
  const ids = Array.isArray(body?.ids) ? body!.ids.map(Number).filter((n) => Number.isInteger(n) && n > 0) : [];
  if (!ids.length || !["approve", "decline"].includes(body?.decision ?? "")) return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  if (!process.env.DATABASE_URL) return Response.json({ ok: false, error: "The database isn't connected." }, { status: 503 });
  const sql = db();
  const staff = await requirePermission(sql, req, "rules_approve");
  if (staff instanceof Response) return staff;
  const out = await decideMany(sql, ids, staff, body!.decision === "approve");
  return Response.json(out, { status: out.ok ? 200 : 400 });
}
