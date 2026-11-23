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
export class Rules {
  private byId: Map<string, Rule>;
  private constructor(byId: Map<string, Rule>) {
    this.byId = byId;
  }

  static async load(sql: Sql): Promise<Rules> {
    const rows = await sql<Rule[]>`select id, category, name, kind, origin, value, unit from rules`;
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
