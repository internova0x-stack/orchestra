"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { RESET_EVENT } from "../components/events";

interface Rule {
  id: string; category: string; name: string; kind: "answer" | "limit"; origin: "sourced" | "sample";
  value: string; unit: string | null; updated_by: string; updated_at: string;
}

// The Design System's categories first, then any others the rules use (Cards, Loans…), then Platform.
const ORDER = ["Payouts", "Incoming payments", "Proof of payment", "Verification", "Fees and FX", "Limits and approvals", "Response targets"];

function when(iso: string) {
  const d = new Date(iso);
  return d.toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

function RuleRow({ rule, onSaved }: { rule: Rule; onSaved: (r: Rule) => void }) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(rule.value);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (editing) input.current?.focus(); }, [editing]);
  useEffect(() => { if (!editing) setDraft(rule.value); }, [rule.value, editing]);

  async function save() {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/rules/${rule.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value: draft }) });
      const json = await res.json();
      if (!json.ok) { setError(json.error ?? "That didn't save."); return; }
      setEditing(false);
      onSaved({ ...rule, value: json.value, updated_by: "Rules screen", updated_at: new Date().toISOString() });
      setFlash(true);
      setTimeout(() => setFlash(false), 1000);
    } catch {
      setError("That didn't save. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  const unit = rule.unit && !["$", "£", "₦"].includes(rule.unit) ? rule.unit : null;
  const prefix = rule.unit && ["$", "£", "₦"].includes(rule.unit) ? rule.unit : null;

  return (
    <tr className={flash ? "rule-flash" : undefined}>
      <td className="rule-name">{rule.name}</td>
      <td className="rule-value">
        {editing ? (
          <div className="rule-edit">
            <textarea
              ref={input}
              rows={rule.value.length > 60 ? 3 : 1}
              value={draft}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(); }
                if (e.key === "Escape") { setEditing(false); setError(null); }
              }}
              aria-label={`New value for ${rule.name}`}
            />
            <div className="rule-edit-buttons">
              <button className="btn btn-primary" onClick={save} disabled={saving}>Save</button>
              <button className="btn" onClick={() => { setEditing(false); setError(null); }}>Cancel</button>
            </div>
            {error && <div className="rule-error" role="alert">{error}</div>}
          </div>
        ) : (
          <button className="rule-value-button" onClick={() => setEditing(true)} aria-label={`Edit ${rule.name}: ${rule.value}`}>
            {prefix}{prefix && /^\d+(\.\d+)?$/.test(rule.value) ? Number(rule.value).toLocaleString("en-GB") : rule.value}{unit ? ` ${unit}` : ""}
          </button>
        )}
      </td>
      <td>
        <span className="tag">{rule.kind}</span>{" "}
        <span className={`tag tag-${rule.origin}`}>{rule.origin === "sourced" ? "Sourced" : "Sample"}</span>
      </td>
      <td className="label">{rule.updated_by === "Seed" ? "Starting value" : `${when(rule.updated_at)}`}</td>
    </tr>
  );
}

export default function RulesPage() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [fixed, setFixed] = useState<string[]>([]);
  const [category, setCategory] = useState(ORDER[0]);
  const [problem, setProblem] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/rules", { cache: "no-store" });
      const json = await res.json();
      setFixed(json.fixed ?? []);
      if (!res.ok) { setProblem("The database isn't connected yet."); setRules([]); return; }
      setProblem(null);
      setRules(json.rules);
    } catch {
      setProblem("Couldn't reach the app's server.");
      setRules([]);
    }
  }, []);

  useEffect(() => {
    load();
    window.addEventListener(RESET_EVENT, load);
    return () => window.removeEventListener(RESET_EVENT, load);
  }, [load]);

  const shown = (rules ?? []).filter((r) => r.category === category);
  const used = [...new Set((rules ?? []).map((r) => r.category))];
  const CATEGORIES = [...ORDER, ...used.filter((c) => !ORDER.includes(c) && c !== "Platform"), "Platform"];

  return (
    <div className="rules-grid">
      <nav className="panel rules-rail" aria-label="Rule categories">
        {CATEGORIES.map((c) => (
          <button key={c} className="tab" aria-current={category === c ? "page" : undefined} onClick={() => setCategory(c)}>
            {c}
          </button>
        ))}
      </nav>
      <section className="panel" aria-label={`${category} rules`}>
        <div className="panel-head"><span className="panel-title">{category}</span></div>
        <div className="rules-body">
          {problem && <div className="empty">{problem}</div>}
          {rules === null && <div className="empty">Loading the rules…</div>}
          {rules && !problem && (
            <table className="rules-table">
              <thead>
                <tr><th>Rule</th><th>Value</th><th>Kind</th><th>Last changed</th></tr>
              </thead>
              <tbody>
                {shown.map((r) => (
                  <RuleRow key={r.id} rule={r} onSaved={(next) => setRules((all) => all!.map((x) => (x.id === next.id ? next : x)))} />
                ))}
              </tbody>
            </table>
          )}
          <p className="rules-note">Changes apply to Alexis&apos;s next message.</p>
          <ul className="fixed-rules" aria-label="Fixed rules">
            {fixed.map((f) => (
              <li key={f} title="Fixed by the Guardrails policy. These can't be switched off.">
                <svg viewBox="0 0 16 16" aria-hidden="true"><rect x="3.5" y="7" width="9" height="7" rx="1.5" fill="none" stroke="currentColor" strokeWidth="1.5" /><path d="M5.5 7V5a2.5 2.5 0 0 1 5 0v2" fill="none" stroke="currentColor" strokeWidth="1.5" /></svg>
                <span>{f}</span>
                <span className="tag">Fixed</span>
              </li>
            ))}
          </ul>
        </div>
      </section>
    </div>
  );
}
