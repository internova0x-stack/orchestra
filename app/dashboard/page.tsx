"use client";

import Link from "next/link";
import { useCallback, useEffect, useState } from "react";
import { RESET_EVENT } from "../components/events";
import type { Dashboard } from "@/lib/dashboard";

const hours = (m: number) => (m < 60 ? `${m} min` : `${(m / 60).toFixed(m % 60 ? 1 : 0)} h`);
const money = (n: number, unit: string) => `${unit}${n.toLocaleString("en-GB", { maximumFractionDigits: 2 })}`;
const dayName = (d: string) => new Date(`${d}T12:00:00Z`).toLocaleDateString("en-GB", { weekday: "short", day: "numeric", month: "short" });

/** Hours saved: the team's handling time Alexis takes on, from real conversations and sample handling times. */
export default function DashboardPage() {
  const [d, setD] = useState<Dashboard | null>(null);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/dashboard", { cache: "no-store" });
      if (!res.ok) { setProblem("The database isn't connected yet."); return; }
      setProblem(null);
      setD(await res.json());
    } catch {
      setProblem("Couldn't reach the app's server.");
    }
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 10_000);
    window.addEventListener(RESET_EVENT, load);
    return () => { clearInterval(t); window.removeEventListener(RESET_EVENT, load); };
  }, [load]);

  if (problem) return <div className="empty">{problem}</div>;
  if (!d) return <div className="empty">Loading the dashboard…</div>;
  const t = d.totals;

  return (
    <div className="dash">
      <div className="stat-row" aria-label="Time saved">
        <Stat value={hours(t.minutesSaved)} label="Staff time saved" />
        <Stat value={money(t.costSaved, t.costUnit)} label="Staff cost saved" />
        <Stat value={t.resolutionRate == null ? "–" : `${t.resolutionRate}%`} label="Resolved without a person" />
        <Stat value={t.resolvedByAlexis} label="Resolved by Alexis" />
        <Stat value={t.handedOff} label="Handed to a person" />
        <Stat value={t.conversations} label="Conversations" />
      </div>

      <div className="stat-row" aria-label="Reviews and the team">
        <Stat value={d.reviews.reviewed} label="Conversations reviewed" />
        <Stat value={d.reviews.reviewed ? `${Math.round((d.reviews.good / d.reviews.reviewed) * 100)}%` : "–"} label="Reviewed as good" />
        <Stat value={d.reviews.needsWork} label="Need work" />
        <Stat value={d.reviews.waitingForTeam} label="Waiting for the team" />
        <Stat value={t.open} label="Open now" />
        <Stat value={d.categories.length} label="Categories in use" />
      </div>

      <p className="dash-note label" role="note">
        Sample handling times, not measured ones. A conversation Alexis resolves saves its category&apos;s handling
        time; one handed to a person saves {d.assumptions.handoffMinutes} minutes (the summary means nobody starts
        from scratch); a staff hour costs {money(d.assumptions.costPerHour, d.assumptions.costUnit)}. Change them
        on the <Link href="/rules?category=Time%20saved">Rules screen, Time saved</Link>.
      </p>

      <div className="dash-grid">
        <section className="panel" aria-label="By category">
          <div className="panel-head"><span className="panel-title">By category</span></div>
          {d.categories.length === 0 ? (
            <div className="empty">No conversations yet. Time saved appears here as customers write in.</div>
          ) : (
            <div className="table-wrap">
              <table className="dash-table">
                <thead><tr><th scope="col">Category</th><th scope="col">Conversations</th><th scope="col">Resolved by Alexis</th><th scope="col">Handed off</th><th scope="col">Handling time</th><th scope="col">Time saved</th></tr></thead>
                <tbody>
                  {d.categories.map((c) => (
                    <tr key={c.category}>
                      <th scope="row">{c.category}</th>
                      <td>{c.conversations}</td><td>{c.resolvedByAlexis}</td><td>{c.handedOff}</td>
                      <td>{c.minutesEach} min</td><td><b>{hours(c.minutesSaved)}</b></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          )}
        </section>

        <section className="panel" aria-label="Last 7 days">
          <div className="panel-head"><span className="panel-title">Last 7 days</span></div>
          <div className="table-wrap">
            <table className="dash-table">
              <thead><tr><th scope="col">Day</th><th scope="col">Conversations</th><th scope="col">Time saved</th></tr></thead>
              <tbody>
                {d.days.slice().reverse().map((x) => (
                  <tr key={x.day}><th scope="row">{dayName(x.day)}</th><td>{x.conversations}</td><td>{hours(x.minutesSaved)}</td></tr>
                ))}
              </tbody>
            </table>
          </div>
        </section>
      </div>
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
