"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { RESET_EVENT } from "../components/events";
import type { Billing } from "@/lib/billing";

const fmt = (n: number, unit: string) => `${unit}${n.toLocaleString("en-GB", { minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits: 2 })}`;
const tokens = (n: number) => (n >= 1_000_000 ? `${(n / 1_000_000).toFixed(2)}M` : n >= 1000 ? `${(n / 1000).toFixed(1)}k` : String(n));
const monthName = (m: string) => new Date(`${m}-15T12:00:00Z`).toLocaleDateString("en-GB", { month: "long", year: "numeric" });

/** Plan and usage: what the institution pays Orchestra this month, and the AI usage behind it. */
export default function BillingPage() {
  const [b, setB] = useState<Billing | null>(null);
  const [month, setMonth] = useState<string>("");
  const [problem, setProblem] = useState<string | null>(null);
  const [inside, setInside] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/billing${month ? `?month=${month}` : ""}`, { cache: "no-store" });
      if (!res.ok) { setProblem("The database isn't connected yet."); return; }
      setProblem(null);
      setB(await res.json());
    } catch {
      setProblem("Couldn't reach the app's server.");
    }
  }, [month]);

  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 15_000);
    window.addEventListener(RESET_EVENT, load);
    return () => { clearInterval(t); window.removeEventListener(RESET_EVENT, load); };
  }, [load]);

  if (problem) return <div className="empty">{problem}</div>;
  if (!b) return <div className="empty">Loading plan and usage…</div>;
  const c = b.currency;

  return (
    <div className="dash">
      <div className="dev-row">
        <label className="picker">
          <span className="label">Month</span>
          <select value={b.month} onChange={(e) => setMonth(e.target.value)} aria-label="Month">
            {b.months.map((m) => <option key={m} value={m}>{monthName(m)}</option>)}
          </select>
        </label>
        <span className="label">Sample plan: agree the real one with each institution and set it on the <Link href="/rules?category=Billing">Rules screen, Billing</Link>.</span>
      </div>

      <div className="stat-row" aria-label="This month">
        <Stat value={fmt(b.invoice.total, c)} label={`Bill for ${monthName(b.month)}`} />
        <Stat value={b.usage.resolvedByAlexis} label="Resolved by Alexis" />
        <Stat value={b.usage.handedOff} label="Handed to the team" />
        <Stat value={fmt(b.value.staffCostSaved, c)} label="Staff cost saved" />
        <Stat value={b.value.returnMultiple == null ? "–" : `${b.value.returnMultiple}×`} label="Saved for each unit paid" />
      </div>

      <div className="dash-grid">
        <section className="panel" aria-label="The bill">
          <div className="panel-head"><span className="panel-title">The bill</span></div>
          <div className="table-wrap">
            <table className="dash-table">
              <tbody>
                <tr><th scope="row">Platform fee</th><td className="label">Console, Rules, routing, drafted replies, APIs; {b.plan.included.toLocaleString("en-GB")} resolved conversations included</td><td>{fmt(b.invoice.platformFee, c)}</td></tr>
                <tr><th scope="row">Resolved by Alexis</th><td className="label">{b.usage.resolvedByAlexis} in all, {b.usage.billableResolved} beyond those included, at {fmt(b.plan.perResolved, c)}</td><td>{fmt(b.invoice.resolvedCharge, c)}</td></tr>
                <tr><th scope="row">Handed to the team</th><td className="label">{b.usage.handedOff} at {fmt(b.plan.perHandoff, c)} (summary and routing)</td><td>{fmt(b.invoice.handoffCharge, c)}</td></tr>
                <tr><th scope="row">Helpdesk tickets analysed</th><td className="label">{b.usage.listened} in listen mode at {fmt(b.plan.perListened, c)}</td><td>{fmt(b.invoice.listenCharge, c)}</td></tr>
                <tr><th scope="row">Total</th><td className="label">{b.usage.other ? `${b.usage.other} other conversations (open, or answered with nothing to resolve) aren't charged` : ""}</td><td><b>{fmt(b.invoice.total, c)}</b></td></tr>
              </tbody>
            </table>
          </div>
        </section>

        <section className="panel" aria-label="AI usage">
          <div className="panel-head"><span className="panel-title">AI usage</span></div>
          <div className="table-wrap">
            <table className="dash-table">
              <tbody>
                <tr><th scope="row">Model calls</th><td>{b.ai.calls.toLocaleString("en-GB")}</td></tr>
                <tr><th scope="row">Input tokens</th><td>{tokens(b.ai.inputTokens)}{b.ai.cacheReadTokens ? ` (+${tokens(b.ai.cacheReadTokens)} from the cache)` : ""}</td></tr>
                <tr><th scope="row">Output tokens</th><td>{tokens(b.ai.outputTokens)}</td></tr>
                <tr><th scope="row">AI cost</th><td>{fmt(b.ai.cost, c)}{b.plan.bankPaysAi ? " · billed to you by your AI provider, not by Orchestra" : ""}</td></tr>
                <tr><th scope="row">Per conversation</th><td>{b.ai.perConversation == null ? "–" : fmt(b.ai.perConversation, c)}</td></tr>
              </tbody>
            </table>
          </div>
          <p className="dash-note label">Measured on every model call (Alexis, staff mode, drafts, translations, policy uploads). The prices per token are samples on the Rules screen.</p>
        </section>
      </div>

      <details className="panel orchestra-view" open={inside} onToggle={(e) => setInside((e.target as HTMLDetailsElement).open)}>
        <summary className="panel-head"><span className="panel-title">Orchestra&apos;s view (for the seller, not the institution)</span></summary>
        <div className="table-wrap">
          <table className="dash-table">
            <tbody>
              <tr><th scope="row">Revenue this month</th><td>{fmt(b.orchestra.revenue, c)}</td></tr>
              <tr><th scope="row">AI cost to Orchestra</th><td>{fmt(b.orchestra.aiCost, c)}{b.plan.bankPaysAi ? " (the institution pays its AI provider)" : ""}</td></tr>
              <tr><th scope="row">Gross margin</th><td><b>{fmt(b.orchestra.margin, c)}</b>{b.orchestra.marginPct == null ? "" : ` · ${b.orchestra.marginPct}%`}</td></tr>
            </tbody>
          </table>
        </div>
        <p className="dash-note label">Before hosting and support costs. In a real deployment this section isn&apos;t shown to the institution.</p>
      </details>
    </div>
  );
}

function Stat({ value, label }: { value: number | string; label: string }) {
  return (
    <div className="stat">
      <span className="stat-value">{value}</span>
      <span className="label">{label}</span>
    </div>
  );
}
