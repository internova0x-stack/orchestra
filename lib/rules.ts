import type { Sql } from "./db.ts";
import { DEFAULT_HOURS, parseClock, parseDays, type BusinessHours } from "./time.ts";

export interface Rule {
  id: string;
  category: string;
  name: string;
  kind: "answer" | "limit";
  origin: "sourced" | "sample";
  value: string;
  unit: string | null;
}

/**
 * The rules, read fresh from the database. Called once per tool call, never cached across
 * messages, so a Rules screen edit applies to Alexis's next message.
 */
/** The markets a rule can have its own value in. */
// The main markets (Tomi, Nov 27: "the us, uk, canada, eu, dubai"), plus Nigeria, where the first payment company is.
export type Market = "US" | "UK" | "CA" | "EU" | "AE" | "NG";
export const MARKETS: { id: Market; name: string; country: string; countries?: string[] }[] = [
  { id: "US", name: "United States", country: "United States" },
  { id: "UK", name: "United Kingdom", country: "United Kingdom" },
  { id: "CA", name: "Canada", country: "Canada" },
  {
    id: "EU", name: "European Union", country: "European Union",
    countries: ["Austria", "Belgium", "Bulgaria", "Croatia", "Cyprus", "Czechia", "Denmark", "Estonia", "Finland", "France", "Germany", "Greece",
      "Hungary", "Ireland", "Italy", "Latvia", "Lithuania", "Luxembourg", "Malta", "Netherlands", "Poland", "Portugal", "Romania", "Slovakia",
      "Slovenia", "Spain", "Sweden"],
  },
  { id: "AE", name: "United Arab Emirates", country: "United Arab Emirates", countries: ["UAE", "Dubai", "Abu Dhabi"] },
  { id: "NG", name: "Nigeria", country: "Nigeria" },
];
/** The market a country belongs to (a market's own name works too, e.g. "European Union" or "Dubai"). */
export const marketOf = (country: string | null | undefined): Market | null => {
  const c = (country ?? "").trim().toLowerCase();
  if (!c) return null;
  return MARKETS.find((m) => m.country.toLowerCase() === c || m.name.toLowerCase() === c || m.id.toLowerCase() === c || (m.countries ?? []).some((x) => x.toLowerCase() === c))?.id ?? null;
};

export class Rules {
  private byId: Map<string, Rule>;
  private constructor(byId: Map<string, Rule>) {
    this.byId = byId;
  }

  /**
   * The rules in force, read fresh. With a market (US, UK, CA, EU, AE, NG), that market's own values replace the
   * defaults where the Rules screen set one.
   */
  static async load(sql: Sql, market?: Market | null): Promise<Rules> {
    const rows = market
      ? await sql<Rule[]>`select r.id, r.category, r.name, r.kind, r.origin, coalesce(o.value, r.value) as value, r.unit
          from rules r left join rule_overrides o on o.rule_id = r.id and o.market = ${market}`
      : await sql<Rule[]>`select id, category, name, kind, origin, value, unit from rules`;
    return new Rules(new Map(rows.map((r) => [r.id, r])));
  }

  static fromList(list: Rule[]): Rules {
    return new Rules(new Map(list.map((r) => [r.id, r])));
  }

  get(id: string): Rule | undefined {
    return this.byId.get(id);
  }

  /** A limit rule's number; the fallback only if the rule is missing or unreadable. */
  num(id: string, fallback: number): number {
    const v = this.byId.get(id)?.value.replace(/[^0-9.\-]/g, "");
    const n = v ? Number(v) : NaN;
    return Number.isFinite(n) ? n : fallback;
  }

  /** An on/off switch rule. Anything other than an explicit "off"/"no"/"false" is on. */
  on(id: string): boolean {
    const v = this.byId.get(id)?.value.trim().toLowerCase();
    return !(v === "off" || v === "no" || v === "false");
  }

  hours(): BusinessHours {
    return {
      days: parseDays(this.byId.get("business_days")?.value ?? ""),
      open: parseClock(this.byId.get("business_open")?.value ?? "", DEFAULT_HOURS.open),
      close: parseClock(this.byId.get("business_close")?.value ?? "", DEFAULT_HOURS.close),
    };
  }

  answers(): Rule[] {
    return [...this.byId.values()].filter((r) => r.kind === "answer");
  }
}

/** The settlement rule id for a payout route. */
export function settlementRuleId(route: string): string {
  const r = route.toLowerCase();
  if (r.includes("swift")) return "settle_swift";
  if (r.includes("faster")) return "settle_faster_payments";
  if (r.includes("ach")) return "settle_ach";
  if (r.includes("wire")) return "settle_wire";
  if (r.includes("rtp")) return "settle_rtp";
  if (r.includes("nip")) return "settle_nip";
  if (r.includes("sepa")) return "settle_sepa";
  if (r.includes("eft")) return "settle_eft";
  if (r.includes("mobile")) return "settle_mobile_money";
  if (r.includes("stablecoin")) return "settle_stablecoin";
  if (r.includes("internal")) return "settle_internal";
  return "settle_aed";
}
