import { db } from "@/lib/db.ts";
import { ensureSeeded } from "@/lib/seed.ts";
import { ALL_CATEGORIES, caseCounts, listCases } from "@/lib/cases.ts";
import { later } from "@/lib/api/webhooks.ts";
import { recordResolved } from "@/lib/crm/dataEntry.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every customer conversation with its category, status and urgency, and the counts at the top. */
export async function GET() {
  if (!process.env.DATABASE_URL) return Response.json({ error: "not_configured", cases: [] }, { status: 503 });
  const sql = db();
  await ensureSeeded(sql);
  const cases = await listCases(sql);
  // Data entry: conversations Alexis resolved on her own are recorded in the CRM, a few at a time, after the response.
  await later(async () => { await recordResolved(sql).catch((err) => console.error("data entry", err)); });
  return Response.json({ cases, counts: caseCounts(cases), categories: ALL_CATEGORIES }, { headers: { "Cache-Control": "no-store" } });
}
