import type { Sql } from "./db.ts";
import { listCases, type CaseRow } from "./cases.ts";
import { Rules } from "./rules.ts";

// The hours-saved dashboard: how much handling time Alexis takes off the team, from the conversations
// themselves and the handling times on the Rules screen ("Time saved", sample values until the bank
// supplies its own). A conversation Alexis resolved saves the category's whole handling time; one handed
// to a person saves only what the handoff summary saves.

// The handling-time rule's id comes from the category's name without any bracketed note ("Verification (KYC)").
export const timeRuleId = (category: string) => `time_${category.replace(/\s*\(.*\)\s*$/, "").toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")}`;

export interface Dashboard {
  totals: { conversations: number; resolvedByAlexis: number; handedOff: number; open: number; minutesSaved: number; costSaved: number; costUnit: string; resolutionRate: number | null };
  reviews: { reviewed: number; good: number; needsWork: number; waitingForTeam: number };
  categories: { category: string; conversations: number; resolvedByAlexis: number; handedOff: number; minutesEach: number; minutesSaved: number }[];
  days: { day: string; conversations: number; minutesSaved: number }[];
  assumptions: { handoffMinutes: number; costPerHour: number; costUnit: string };
}

export function buildDashboard(rows: CaseRow[], rules: Rules, now = new Date()): Dashboard {
  const handoff = rules.num("time_handoff_summary", 5);
  const cost = rules.num("time_staff_cost", 15);
  const costUnit = rules.get("time_staff_cost")?.unit ?? "$";
  const saved = (r: CaseRow) => {
    if (r.status === "Resolved by Alexis") return rules.num(timeRuleId(r.category), rules.num("time_general_question", 6));
    return r.references.length > 0 ? handoff : 0;
  };
  const byCat = new Map<string, Dashboard["categories"][number]>();
  for (const r of rows) {
    const c = byCat.get(r.category) ?? { category: r.category, conversations: 0, resolvedByAlexis: 0, handedOff: 0, minutesEach: rules.num(timeRuleId(r.category), rules.num("time_general_question", 6)), minutesSaved: 0 };
    c.conversations++;
    if (r.status === "Resolved by Alexis") c.resolvedByAlexis++;
    if (r.references.length) c.handedOff++;
    c.minutesSaved += saved(r);
    byCat.set(r.category, c);
  }
  const days: Dashboard["days"] = [];
  for (let i = 6; i >= 0; i--) {
    const d = new Date(now.getTime() - i * 86_400_000).toISOString().slice(0, 10);
    const today = rows.filter((r) => r.started.slice(0, 10) === d);
    days.push({ day: d, conversations: today.length, minutesSaved: today.reduce((n, r) => n + saved(r), 0) });
  }
  const minutesSaved = rows.reduce((n, r) => n + saved(r), 0);
  const resolvedByAlexis = rows.filter((r) => r.status === "Resolved by Alexis").length;
  const handedOff = rows.filter((r) => r.references.length > 0).length;
  return {
    totals: {
      conversations: rows.length, resolvedByAlexis, handedOff,
      open: rows.filter((r) => !r.status.startsWith("Resolved")).length,
      minutesSaved, costSaved: Math.round((minutesSaved / 60) * cost * 100) / 100, costUnit,
      resolutionRate: resolvedByAlexis + handedOff ? Math.round((resolvedByAlexis / (resolvedByAlexis + handedOff)) * 100) : null,
    },
    reviews: {
      reviewed: rows.filter((r) => r.review).length,
      good: rows.filter((r) => r.review?.rating === "good").length,
      needsWork: rows.filter((r) => r.review?.rating === "needs_work").length,
      waitingForTeam: rows.filter((r) => r.status === "Waiting for the team").length,
    },
    categories: [...byCat.values()].sort((a, b) => b.minutesSaved - a.minutesSaved || b.conversations - a.conversations),
    days,
    assumptions: { handoffMinutes: handoff, costPerHour: cost, costUnit },
  };
}

export async function dashboard(sql: Sql): Promise<Dashboard> {
  const [rows, rules] = await Promise.all([listCases(sql), Rules.load(sql)]);
  return buildDashboard(rows, rules);
}
