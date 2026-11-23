import { requirePermission } from "@/lib/auth.ts";
import { db } from "@/lib/db.ts";
import { decideChange, resolveConflict } from "@/lib/ruleChanges.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A supervisor approves or declines a waiting rule change, or picks a conflict's value (decision "use"). */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { decision?: string; value?: string } | null;
  if (!body || !["approve", "decline", "use"].includes(body.decision ?? "") || (body.decision === "use" && typeof body.value !== "string") || !/^\d+$/.test(id)) return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  if (!process.env.DATABASE_URL) return Response.json({ ok: false, error: "The database isn't connected." }, { status: 503 });
  const sql = db();
  const staff = await requirePermission(sql, req, "rules_approve");
  if (staff instanceof Response) return staff;
  if (body.decision === "use") {
    const r = await resolveConflict(sql, Number(id), staff, body.value!);
    return Response.json(r, { status: r.ok ? 200 : 400 });
  }
  const out = await decideChange(sql, Number(id), staff, body.decision === "approve");
  return Response.json(out, { status: out.ok ? 200 : 400 });
}
