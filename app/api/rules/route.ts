import { db } from "@/lib/db.ts";
import { ensureSeeded } from "@/lib/seed.ts";
import { FIXED_RULES } from "@/lib/ruleSet.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** Every rule for the Rules screen. Source links stay in the database: never shown (owner, Nov 23). */
export async function GET() {
  if (!process.env.DATABASE_URL) return Response.json({ error: "not_configured", rules: [], fixed: FIXED_RULES }, { status: 503 });
  const sql = db();
  await ensureSeeded(sql);
  const rules = await sql`select id, category, name, kind, origin, value, unit, updated_by, updated_at from rules order by sort`;
  return Response.json({ rules, fixed: FIXED_RULES }, { headers: { "Cache-Control": "no-store" } });
}
