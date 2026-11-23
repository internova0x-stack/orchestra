import { db } from "@/lib/db.ts";
import { decideChange } from "@/lib/ruleChanges.ts";
import { staffUser } from "@/lib/staff.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** A supervisor approves or declines a waiting rule change. */
export async function POST(req: Request, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = (await req.json().catch(() => null)) as { decision?: string; staffId?: string } | null;
  if (!body || !["approve", "decline"].includes(body.decision ?? "") || !/^\d+$/.test(id)) return Response.json({ ok: false, error: "bad_request" }, { status: 400 });
  if (!process.env.DATABASE_URL) return Response.json({ ok: false, error: "The database isn't connected." }, { status: 503 });
  const sql = db();
  const staff = await staffUser(sql, body.staffId);
  if (!staff) return Response.json({ ok: false, error: "Sign in as a supervisor first." }, { status: 403 });
  const out = await decideChange(sql, Number(id), staff, body.decision === "approve");
  return Response.json(out, { status: out.ok ? 200 : 400 });
}
