import { db } from "@/lib/db.ts";
import { ensureSeeded } from "@/lib/seed.ts";
import { caseCounts, listCases } from "@/lib/cases.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every customer conversation with its category, status and urgency, and the counts at the top. */
export async function GET() {
  if (!process.env.DATABASE_URL) return Response.json({ error: "not_configured", cases: [] }, { status: 503 });
  const sql = db();
  await ensureSeeded(sql);
  const cases = await listCases(sql);
  return Response.json({ cases, counts: caseCounts(cases) }, { headers: { "Cache-Control": "no-store" } });
}
