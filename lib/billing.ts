import type { Sql } from "./db.ts";
import { listCases, type CaseRow } from "./cases.ts";
import { buildDashboard } from "./dashboard.ts";
import { Rules } from "./rules.ts";

// Platform fee plus usage (Tomi, Nov 23): what an institution pays Orchestra each month, worked out from the
// month's conversations and the plan on the Rules screen ("Billing", sample values). A monthly platform fee covers
// the console, Rules, routing, drafts and the APIs, with a number of conversations included; past that, each
// conversation Alexis resolves is charged, and each one handed to the team at a lower rate (the summary and
// routing still save time). AI usage is measured on every model call (lib/usage.ts) and priced from the Rules
// screen, for Orchestra's own view of its cost, or shown as the bank's when it pays its AI provider directly.

export interface Billing {
  month: string;
  months: string[];
  currency: string;
  plan: { platformFee: number; included: number; perResolved: number; perHandoff: number; bankPaysAi: boolean };
  usage: { conversations: number; resolvedByAlexis: number; handedOff: number; other: number; billableResolved: number };
  invoice: { platformFee: number; resolvedCharge: number; handoffCharge: number; total: number };
  value: { staffCostSaved: number; hoursSaved: number; returnMultiple: number | null };
  ai: { calls: number; inputTokens: number; outputTokens: number; cacheReadTokens: number; cacheWriteTokens: number; cost: number; perConversation: number | null };
  orchestra: { revenue: number; aiCost: number; margin: number; marginPct: number | null };
}

const r2 = (n: number) => Math.round(n * 100) / 100;
export const monthOf = (iso: string | Date) => new Date(iso).toISOString().slice(0, 7);

/** The month's bill from its conversations (pure, tested). */
export function priceMonth(rows: CaseRow[], rules: Rules, ai: Omit<Billing["ai"], "cost" | "perConversation">, month: string, now = new Date()): Omit<Billing, "months"> {
  const plan = {
    platformFee: rules.num("billing_platform_fee", 0),
    included: rules.num("billing_included", 0),
    perResolved: rules.num("billing_price_resolved", 0),
    perHandoff: rules.num("billing_price_handoff", 0),
    bankPaysAi: rules.get("billing_bank_pays_ai")?.value.trim().toLowerCase() === "on",
  };
  const resolvedByAlexis = rows.filter((r) => r.status === "Resolved by Alexis").length;
  const handedOff = rows.filter((r) => r.references.length > 0).length;
  const billableResolved = Math.max(0, resolvedByAlexis - plan.included);
  const resolvedCharge = r2(billableResolved * plan.perResolved);
  const handoffCharge = r2(handedOff * plan.perHandoff);
  const total = r2(plan.platformFee + resolvedCharge + handoffCharge);
  const d = buildDashboard(rows, rules, now);
  const cost = r2(
    (ai.inputTokens * rules.num("ai_price_input", 0) + ai.outputTokens * rules.num("ai_price_output", 0)
      + ai.cacheReadTokens * rules.num("ai_price_cache_read", 0) + ai.cacheWriteTokens * rules.num("ai_price_cache_write", 0)) / 1_000_000,
  );
  const aiCostToOrchestra = plan.bankPaysAi ? 0 : cost;
  return {
    month,
    currency: rules.get("billing_platform_fee")?.unit ?? "$",
    plan,
    usage: { conversations: rows.length, resolvedByAlexis, handedOff, other: rows.length - resolvedByAlexis - handedOff, billableResolved },
    invoice: { platformFee: plan.platformFee, resolvedCharge, handoffCharge, total },
    value: { staffCostSaved: d.totals.costSaved, hoursSaved: Math.round((d.totals.minutesSaved / 60) * 10) / 10, returnMultiple: total > 0 ? Math.round((d.totals.costSaved / total) * 10) / 10 : null },
    ai: { ...ai, cost, perConversation: rows.length ? r2(cost / rows.length) : null },
    orchestra: { revenue: total, aiCost: aiCostToOrchestra, margin: r2(total - aiCostToOrchestra), marginPct: total > 0 ? Math.round(((total - aiCostToOrchestra) / total) * 100) : null },
  };
}

export async function billing(sql: Sql, month?: string | null, now = new Date()): Promise<Billing> {
  const all = await listCases(sql, now);
  const current = monthOf(now);
  const m = month && /^\d{4}-\d{2}$/.test(month) ? month : current;
  const rows = all.filter((r) => monthOf(r.started) === m);
  const start = new Date(`${m}-01T00:00:00Z`);
  const end = new Date(Date.UTC(start.getUTCFullYear(), start.getUTCMonth() + 1, 1));
  const [u] = await sql<{ calls: number; i: string; o: string; cr: string; cw: string }[]>`
    select count(*)::int as calls, coalesce(sum(input_tokens),0)::text as i, coalesce(sum(output_tokens),0)::text as o,
      coalesce(sum(cache_read_tokens),0)::text as cr, coalesce(sum(cache_write_tokens),0)::text as cw
    from ai_usage where created_at >= ${start} and created_at < ${end}`;
  const rules = await Rules.load(sql);
  const months = [...new Set([current, ...all.map((r) => monthOf(r.started))])].sort().reverse().slice(0, 12);
  return {
    ...priceMonth(rows, rules, { calls: u.calls, inputTokens: Number(u.i), outputTokens: Number(u.o), cacheReadTokens: Number(u.cr), cacheWriteTokens: Number(u.cw) }, m, now),
    months,
  };
}
