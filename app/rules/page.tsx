"use client";

import { Fragment, useCallback, useEffect, useRef, useState } from "react";
import { RESET_EVENT } from "../components/events";

interface Rule {
  id: string; category: string; name: string; kind: "answer" | "limit"; origin: "sourced" | "sample";
  value: string; default_value: string; overridden: boolean; markets_with_own: number;
  unit: string | null; updated_by: string; updated_at: string;
}
interface Change {
  id: number; rule_id: string; rule_name: string; market: string | null; old_value: string | null; new_value: string | null;
  status: "pending" | "live" | "declined"; source: string | null; note: string | null;
  changed_by: string; changed_at: string; decided_by: string | null; decided_at: string | null;
}
interface Impact { conversation_id: string; used: string; at: string; customer: string | null; business: string | null; country: string | null }
interface Staff { id: string; name: string; role: string }
/** Supervisors and operations admins put rule changes live and approve others' (lib/auth.ts). */
const canApprove = (s: Staff | null | undefined) => Boolean(s && (s.role === "supervisor" || s.role === "operations_admin"));
interface Market { id: string; name: string }

// The Design System's categories first, then any others the rules use (Cards, Loans…), then Platform.
const ORDER = ["Payouts", "Incoming payments", "Proof of payment", "Verification", "Fees and FX", "Limits and approvals", "Response targets"];

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
const MONEY = ["$", "£", "₦"];
function shown(value: string | null, unit: string | null) {
  if (value == null) return "the default";
  const prefix = unit && MONEY.includes(unit) ? unit : "";
  const suffix = unit && !MONEY.includes(unit) ? ` ${unit}` : "";
  return `${prefix}${prefix && /^\d+(\.\d+)?$/.test(value) ? Number(value).toLocaleString("en-GB") : value}${suffix}`;
}

/** The saved conversations a rule was used in: what a change would have touched. */
function ImpactList({ ruleId }: { ruleId: string }) {
  const [rows, setRows] = useState<Impact[] | null>(null);
  useEffect(() => { fetch(`/api/rules/${ruleId}`, { cache: "no-store" }).then((r) => r.json()).then((j) => setRows(j.impact ?? [])).catch(() => setRows([])); }, [ruleId]);
  if (!rows) return <div className="label">Checking past conversations…</div>;
  if (!rows.length) return <div className="label">Alexis hasn&apos;t used this rule in any saved conversation yet, so a change touches none so far.</div>;
  return (
    <div className="impact">
      <div className="label">Used in {rows.length} saved conversation{rows.length === 1 ? "" : "s"}. Each would have gone differently under a new value:</div>
      <ul>
        {rows.map((r) => (
          <li key={r.conversation_id}>
            <a className="case-link" href={`/messages?c=${r.conversation_id}`}>{r.business ?? "Unverified customer"}{r.customer ? ` · ${r.customer}` : ""}</a>
            <span className="label"> · {when(r.at)} · {r.used.replace(/^rule · /, "")}{r.country ? ` · ${r.country}` : ""}</span>
          </li>
        ))}
      </ul>
    </div>
  );
}

function History({ rule, market, staff, onChanged }: { rule: Rule; market: string | null; staff: Staff | null; onChanged: (msg: string) => void }) {
  const [rows, setRows] = useState<Change[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const load = useCallback(() => { fetch(`/api/rules/${rule.id}`, { cache: "no-store" }).then((r) => r.json()).then((j) => setRows(j.history ?? [])).catch(() => setRows([])); }, [rule.id]);
  useEffect(load, [load]);

  async function restore(c: Change) {
    setError(null);
    const res = await fetch(`/api/rules/${rule.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value: c.old_value, market: c.market, staffId: staff?.id }) });
    const json = await res.json();
    if (!json.ok) { setError(json.error); return; }
    onChanged(json.status === "live" ? "Restored. It applies to Alexis's next message." : "Restore sent for a supervisor's approval.");
    load();
  }

  return (
    <div className="rule-detail">
      <div className="rule-detail-col">
        <div className="claim-h">History</div>
        {!rows ? <div className="label">Loading…</div> : rows.length === 0 ? <div className="label">Unchanged since the starting value ({shown(rule.default_value, rule.unit)}).</div> : (
          <ul className="history-list">
            {rows.map((c) => (
              <li key={c.id}>
                <span className={`tag tag-${c.status}`}>{c.status === "live" ? "Live" : c.status === "pending" ? "Waiting" : "Declined"}</span>{" "}
                {c.market ? `${c.market}: ` : ""}{shown(c.old_value, rule.unit)} → <b>{shown(c.new_value, rule.unit)}</b>
                <span className="label"> · {c.changed_by}, {when(c.changed_at)}{c.decided_by && c.decided_by !== c.changed_by ? ` · ${c.status === "declined" ? "declined" : "approved"} by ${c.decided_by}` : ""}{c.source && c.source !== "Rules screen" ? ` · ${c.source}` : ""}</span>
                {c.status === "live" && staff && (c.old_value != null || c.market) && (market ?? null) === (c.market ?? null) && (
                  <button className="copy" onClick={() => restore(c)} title="Undo this change">Restore {shown(c.old_value, rule.unit)}</button>
                )}
              </li>
            ))}
          </ul>
        )}
        {error && <div className="rule-error" role="alert">{error}</div>}
      </div>
      <div className="rule-detail-col">
        <div className="claim-h">Past conversations</div>
        <ImpactList ruleId={rule.id} />
      </div>
    </div>
  );
}

function RuleRow({ rule, market, marketName, staff, onSaved, onMessage }: { rule: Rule; market: string | null; marketName: string; staff: Staff | null; onSaved: () => void; onMessage: (m: string) => void }) {
  const [editing, setEditing] = useState(false);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState(rule.value);
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const [flash, setFlash] = useState(false);
  const input = useRef<HTMLTextAreaElement>(null);

  useEffect(() => { if (editing) input.current?.focus(); }, [editing]);
  useEffect(() => { if (!editing) setDraft(rule.value); }, [rule.value, editing]);

  async function save(value: string | null) {
    setSaving(true);
    setError(null);
    try {
      const res = await fetch(`/api/rules/${rule.id}`, { method: "PATCH", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ value, market, staffId: staff?.id }) });
      const json = await res.json();
      if (!json.ok) { setError(json.error ?? "That didn't save."); return; }
      setEditing(false);
      onMessage(json.status === "live" ? `${rule.name}: live now. It applies to Alexis's next message.` : `${rule.name}: sent for a supervisor's approval.`);
      onSaved();
      setFlash(true);
      setTimeout(() => setFlash(false), 1000);
    } catch {
      setError("That didn't save. Check the connection and try again.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <>
      <tr className={flash ? "rule-flash" : undefined}>
        <td className="rule-name">
          {rule.name}
          {market && rule.overridden && <div><span className="tag tag-market">{marketName}&apos;s own value</span></div>}
          {!market && rule.markets_with_own > 0 && <div className="label">{rule.markets_with_own} market{rule.markets_with_own === 1 ? " has its" : "s have their"} own value</div>}
        </td>
        <td className="rule-value">
          {editing ? (
            <div className="rule-edit">
              <textarea
                ref={input}
                rows={rule.value.length > 60 ? 3 : 1}
                value={draft}
                onChange={(e) => setDraft(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); save(draft); }
                  if (e.key === "Escape") { setEditing(false); setError(null); }
                }}
                aria-label={`New value for ${rule.name}${market ? ` in ${marketName}` : ""}`}
              />
              <div className="rule-edit-buttons">
                <button className="btn btn-primary" onClick={() => save(draft)} disabled={saving}>{canApprove(staff) ? "Save" : "Send for approval"}</button>
                <button className="btn" onClick={() => { setEditing(false); setError(null); }}>Cancel</button>
              </div>
              {market && <div className="label">Only for customers in {marketName}. The default stays {shown(rule.default_value, rule.unit)}.</div>}
            </div>
          ) : (
            <button className="rule-value-button" onClick={() => (staff ? setEditing(true) : setError("Sign in at the top to change a rule."))} aria-label={`Edit ${rule.name}: ${rule.value}`}>
              {shown(rule.value, rule.unit)}
            </button>
          )}
          {error && <div className="rule-error" role="alert">{error}</div>}
          {market && rule.overridden && !editing && staff && (
            <button className="copy" onClick={() => save(null)} disabled={saving}>Use the default ({shown(rule.default_value, rule.unit)})</button>
          )}
        </td>
        <td>
          <span className="tag">{rule.kind}</span>{" "}
          <span className={`tag tag-${rule.origin}`}>{rule.origin === "sourced" ? "Sourced" : "Sample"}</span>
        </td>
        <td className="label">
          {rule.updated_by === "Seed" ? "Starting value" : `${when(rule.updated_at)} · ${rule.updated_by}`}
          <div><button className="copy" onClick={() => setOpen((v) => !v)} aria-expanded={open}>{open ? "Hide" : "History"}</button></div>
        </td>
      </tr>
      {open && (
        <tr className="rule-detail-row"><td colSpan={4}><History rule={rule} market={market} staff={staff} onChanged={(m) => { onMessage(m); onSaved(); }} /></td></tr>
      )}
    </>
  );
}

function Pending({ changes, rules, staff, onDone }: { changes: Change[]; rules: Rule[]; staff: Staff | null; onDone: (m: string) => void }) {
  const [open, setOpen] = useState<number | null>(null);
  const [error, setError] = useState<string | null>(null);
  async function decide(c: Change, decision: "approve" | "decline") {
    setError(null);
    const res = await fetch(`/api/rules/changes/${c.id}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ decision, staffId: staff?.id }) });
    const json = await res.json();
    if (!json.ok) { setError(json.error); return; }
    onDone(decision === "approve" ? `${c.rule_name}: approved and live.` : `${c.rule_name}: declined.`);
  }
  if (!changes.length) return null;
  const unitOf = (id: string) => rules.find((r) => r.id === id)?.unit ?? null;
  return (
    <section className="panel pending" aria-label="Changes waiting for approval">
      <div className="panel-head"><span className="panel-title">Waiting for approval ({changes.length})</span>
        <span className="label">{canApprove(staff) ? "Check each one against past conversations, then approve or decline." : "A supervisor approves these before they go live."}</span></div>
      {error && <div className="case-error takeover-error" role="alert">{error}</div>}
      <ul className="pending-list">
        {changes.map((c) => (
          <li key={c.id}>
            <div className="pending-main">
              <div>
                <b>{c.rule_name}</b>{c.market ? <span className="tag tag-market">{c.market}</span> : null}
                <div>{shown(c.old_value, unitOf(c.rule_id))} → <b>{shown(c.new_value, unitOf(c.rule_id))}</b></div>
                <div className="label">{c.changed_by}, {when(c.changed_at)}{c.source && c.source !== "Rules screen" ? ` · ${c.source}` : ""}</div>
                {c.note && <blockquote className="pending-quote">“{c.note}”</blockquote>}
              </div>
              <div className="pending-buttons">
                <button className="btn" onClick={() => setOpen(open === c.id ? null : c.id)} aria-expanded={open === c.id}>Past conversations</button>
                {canApprove(staff) && <>
                  <button className="btn btn-primary" onClick={() => decide(c, "approve")}>Approve</button>
                  <button className="btn" onClick={() => decide(c, "decline")}>Decline</button>
                </>}
              </div>
            </div>
            {open === c.id && <ImpactList ruleId={c.rule_id} />}
          </li>
        ))}
      </ul>
    </section>
  );
}

function PolicyUpload({ staff, onDone }: { staff: Staff | null; onDone: () => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ proposed: { name: string; value: string; market: string; quote: string; change?: number; error?: string }[]; notMatched: string[] } | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function upload(f: File | undefined) {
    if (!f) return;
    setError(null);
    setResult(null);
    if (f.size > 3_000_000) { setError("Keep the file under 3 MB."); return; }
    const media_type = f.type === "application/pdf" ? "application/pdf" : /\.(md|markdown)$/i.test(f.name) ? "text/markdown" : "text/plain";
    if (media_type === "text/plain" && f.type && !f.type.startsWith("text/")) { setError("Upload a PDF or a text file."); return; }
    setBusy(true);
    try {
      const data = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] ?? ""); r.onerror = rej; r.readAsDataURL(f); });
      const resp = await fetch("/api/rules/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ staffId: staff?.id, file: { name: f.name, media_type, data } }) });
      const json = await resp.json();
      if (!json.ok) { setError(json.error); return; }
      setResult(json);
      onDone();
    } catch {
      setError("The upload didn't go through. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const made = result?.proposed.filter((p) => p.change).length ?? 0;
  return (
    <>
      <input ref={file} type="file" accept="application/pdf,text/plain,.md,.txt" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
      <button className="btn btn-primary" disabled={!staff || busy} onClick={() => file.current?.click()} title={staff ? "" : "Sign in first"}>{busy ? "Reading the document…" : "Upload a policy document"}</button>
      {(error || result) && (
        <div className="policy-result panel" role="status">
          {error && <div className="rule-error">{error}</div>}
          {result && <>
            <b>{made} change{made === 1 ? "" : "s"} proposed from the document</b>, each waiting for approval below.
            {result.proposed.length === 0 && <div className="label">The document didn&apos;t change any of the current values.</div>}
            <ul>{result.proposed.map((p, i) => <li key={i}>{p.name} ({p.market}): {p.value}{p.error ? <span className="rule-error"> · not proposed: {p.error}</span> : null}</li>)}</ul>
            {result.notMatched.length > 0 && <><div className="label">In the document but not one of the rules (not added):</div><ul>{result.notMatched.map((n, i) => <li key={i} className="label">{n}</li>)}</ul></>}
            <button className="copy" onClick={() => setResult(null)}>Close</button>
          </>}
        </div>
      )}
    </>
  );
}

export default function RulesPage() {
  const [rules, setRules] = useState<Rule[] | null>(null);
  const [fixed, setFixed] = useState<string[]>([]);
  const [markets, setMarkets] = useState<Market[]>([]);
  const [pending, setPending] = useState<Change[]>([]);
  const [category, setCategory] = useState(ORDER[0]);
  const [market, setMarket] = useState<string>("");
  const [problem, setProblem] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [staffId, setStaffId] = useState("");
  const staff = staffList.find((s) => s.id === staffId) ?? null;

  useEffect(() => {
    fetch("/api/staff/users", { cache: "no-store" }).then((r) => r.json()).then((j) => { setStaffList(j.staff ?? []); setStaffId(j.staff?.[0]?.id ?? ""); }).catch(() => {});
    // A link can open a category (the Dashboard links to Time saved).
    const c = new URLSearchParams(window.location.search).get("category");
    if (c) setCategory(c);
  }, []);

  const load = useCallback(async () => {
    try {
      const res = await fetch(`/api/rules${market ? `?market=${market}` : ""}`, { cache: "no-store" });
      const json = await res.json();
      setFixed(json.fixed ?? []);
      setMarkets(json.markets ?? []);
      if (!res.ok) { setProblem("The database isn't connected yet."); setRules([]); return; }
      setProblem(null);
      setRules(json.rules);
      setPending(json.pending ?? []);
    } catch {
      setProblem("Couldn't reach the app's server.");
      setRules([]);
    }
  }, [market]);

  useEffect(() => {
    load();
    window.addEventListener(RESET_EVENT, load);
    return () => window.removeEventListener(RESET_EVENT, load);
  }, [load]);

  useEffect(() => { if (!message) return; const t = setTimeout(() => setMessage(null), 5000); return () => clearTimeout(t); }, [message]);

  const marketName = markets.find((m) => m.id === market)?.name ?? "";
  const list = (rules ?? []).filter((r) => r.category === category);
  const used = [...new Set((rules ?? []).map((r) => r.category))];
  const CATEGORIES = [...ORDER, ...used.filter((c) => !ORDER.includes(c) && c !== "Platform"), "Platform"];

  return (
    <div className="rules-page">
      <div className="rules-toolbar">
        <label className="picker">
          <span className="label">Market</span>
          <select value={market} onChange={(e) => setMarket(e.target.value)} aria-label="Market">
            <option value="">All markets (default values)</option>
            {markets.map((m) => <option key={m.id} value={m.id}>{m.name}</option>)}
          </select>
        </label>
        <span className="label rules-who">
          {!staff ? "Sign in to change rules." : canApprove(staff) ? "Your changes go live at once." : "Your changes wait for a supervisor's approval."}
        </span>
        <PolicyUpload staff={staff} onDone={load} />
      </div>
      {message && <div className="toast" role="status">{message}</div>}

      <Pending changes={pending} rules={rules ?? []} staff={staff} onDone={(m) => { setMessage(m); load(); }} />

      <div className="rules-grid">
        <nav className="panel rules-rail" aria-label="Rule categories">
          {CATEGORIES.map((c) => (
            <button key={c} className="tab" aria-current={category === c ? "page" : undefined} onClick={() => setCategory(c)}>
              {c}
            </button>
          ))}
        </nav>
        <section className="panel" aria-label={`${category} rules`}>
          <div className="panel-head"><span className="panel-title">{category}{market ? ` · ${marketName}` : ""}</span>
            {market && <span className="label">Values for customers in {marketName}. A rule without its own value uses the default.</span>}</div>
          <div className="rules-body">
            {problem && <div className="empty">{problem}</div>}
            {rules === null && <div className="empty">Loading the rules…</div>}
            {rules && !problem && (
              <table className="rules-table">
                <thead>
                  <tr><th>Rule</th><th>Value</th><th>Kind</th><th>Last changed</th></tr>
                </thead>
                <tbody>
                  {list.map((r) => (
                    <Fragment key={r.id}>
                      <RuleRow rule={r} market={market || null} marketName={marketName} staff={staff} onSaved={load} onMessage={setMessage} />
                    </Fragment>
                  ))}
                </tbody>
              </table>
            )}
            <p className="rules-note">A supervisor&apos;s or operations admin&apos;s change applies to Alexis&apos;s next message. A support agent&apos;s waits for their approval.</p>
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
    </div>
  );
}
