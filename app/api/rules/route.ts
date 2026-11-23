import { db } from "@/lib/db.ts";
import { ensureSeeded } from "@/lib/seed.ts";
import { FIXED_RULES } from "@/lib/ruleSet.ts";
import { MARKETS, type Market } from "@/lib/rules.ts";
import { pendingChanges } from "@/lib/ruleChanges.ts";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * Every rule for the Rules screen, as it stands in one market (?market=NG|UK|US) or for all markets, and
 * the changes waiting for approval. Source links stay in the database: never shown (owner, Nov 23).
 */
export async function GET(req: Request) {
  if (!process.env.DATABASE_URL) return Response.json({ error: "not_configured", rules: [], fixed: FIXED_RULES, markets: MARKETS, pending: [] }, { status: 503 });
  const m = new URL(req.url).searchParams.get("market");
  const market: Market | null = MARKETS.some((x) => x.id === m) ? (m as Market) : null;
  const sql = db();
  await ensureSeeded(sql);
  const rules = await sql`
    select r.id, r.category, r.name, r.kind, r.origin, coalesce(o.value, r.value) as value, r.value as default_value,
      (o.value is not null) as overridden, r.unit, coalesce(o.updated_by, r.updated_by) as updated_by, coalesce(o.updated_at, r.updated_at) as updated_at,
      (select count(*)::int from rule_overrides x where x.rule_id = r.id) as markets_with_own
    from rules r left join rule_overrides o on o.rule_id = r.id and o.market = ${market ?? "none"}
    order by r.sort`;
  return Response.json({ rules, fixed: FIXED_RULES, markets: MARKETS, pending: await pendingChanges(sql) }, { headers: { "Cache-Control": "no-store" } });
}
