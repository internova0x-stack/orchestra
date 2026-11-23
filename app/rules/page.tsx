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
  upload_id: string | null; document: string | null; page: string | null; big: boolean; conflict: ConflictOption[] | null;
}
interface ConflictOption { value: string; quote: string; page: string | null }
interface Proposed { rule: string; name: string; category: string; unit: string | null; old: string | null; value: string; market: string; quote: string; page: string | null; big: boolean; change?: number; error?: string }
interface ConflictOut { rule: string; name: string; category: string; unit: string | null; old: string; market: string; options: ConflictOption[]; change?: number; error?: string }
interface Extracted { upload: string; document: string; rulesChecked: number; proposed: Proposed[]; conflicts: ConflictOut[]; notMatched: string[] }
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

/** A value short enough for a button: money keeps its sign, other units keep their first word ("90 days"). */
function short(value: string, unit: string | null) {
  if (!unit || MONEY.includes(unit)) return shown(value, unit);
  return `${value} ${unit.split(" ")[0]}`;
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
                <span className="label"> · {c.changed_by}, {when(c.changed_at)}{c.decided_by && c.decided_by !== c.changed_by ? ` · ${c.status === "declined" ? (c.conflict ? "kept" : "declined") : "approved"} by ${c.decided_by}` : ""}{c.document ? ` · from ${c.document}${c.page ? `, p. ${c.page}` : ""}` : c.source && c.source !== "Rules screen" ? ` · ${c.source}` : ""}</span>
                {c.note && c.document && <blockquote className="pending-quote">“{c.note}”</blockquote>}
                {c.conflict && c.status !== "pending" && <div className="label">Conflict resolved: the document also said {c.conflict.filter((o) => o.value !== c.new_value).map((o) => `${shown(o.value, rule.unit)}${o.page ? ` (p. ${o.page})` : ""}`).join(", ")}</div>}
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

const pageOf = (p: string | null) => (p ? `p. ${p}` : null);

/** One proposal or conflict in Waiting for approval. */
function PendingRow({ c, unit, staff, ticked, onTick, onDecide, onUse }: {
  c: Change; unit: string | null; staff: Staff | null; ticked: boolean; onTick: () => void;
  onDecide: (c: Change, d: "approve" | "decline") => void; onUse: (c: Change, value: string) => void;
}) {
  const [open, setOpen] = useState(false);
  const own = Boolean(c.big || c.conflict);
  const approver = canApprove(staff);
  return (
    <li className={ticked ? "is-ticked" : undefined}>
      <div className="pending-main">
        {approver && (
          <input type="checkbox" className={`pending-check${own ? " is-own" : ""}`} checked={ticked} disabled={own} onChange={onTick}
            aria-label={own ? `${c.rule_name} needs its own decision` : `Select ${c.rule_name}`} title={own ? (c.conflict ? "A conflict: pick the value the bank means" : "A big change: decide it on its own") : undefined} />
        )}
        <div className="pending-body">
          <div><b>{c.rule_name}</b>{c.market ? <span className="tag tag-market">{c.market}</span> : null}
            {c.big && <span className="tag tag-big">big change</span>}
            {c.conflict && <span className="tag tag-big">conflict</span>}</div>
          {c.conflict ? (
            <ul className="conflict-options">
              {c.conflict.map((o) => (
                <li key={o.value}><b>{shown(o.value, unit)}</b>{pageOf(o.page) ? <span className="label"> ({pageOf(o.page)})</span> : null}<blockquote className="pending-quote">“{o.quote}”</blockquote></li>
              ))}
            </ul>
          ) : (
            <>
              <div>{shown(c.old_value, unit)} → <b>{shown(c.new_value, unit)}</b></div>
              {c.note && <blockquote className="pending-quote">“{c.note}”{pageOf(c.page) ? <span className="label"> · {pageOf(c.page)}</span> : null}</blockquote>}
            </>
          )}
          <div className="label">{c.changed_by}, {when(c.changed_at)}{c.document ? ` · ${c.document}` : c.source && c.source !== "Rules screen" ? ` · ${c.source}` : ""}{c.conflict ? ` · in force now: ${shown(c.old_value, unit)}` : ""}</div>
        </div>
        <div className="pending-buttons">
          <button className="btn" onClick={() => setOpen((v) => !v)} aria-expanded={open}>Past conversations</button>
          {approver && c.conflict && c.conflict.map((o) => (
            <button key={o.value} className={`btn${o.value === c.old_value ? "" : " btn-primary"}`} onClick={() => onUse(c, o.value)}>
              {o.value === c.old_value ? "Keep" : "Use"} {short(o.value, unit)}
            </button>
          ))}
          {approver && c.big && <>
            <button className="btn" onClick={() => onDecide(c, "decline")}>Decline</button>
            <button className="btn btn-primary" onClick={() => onDecide(c, "approve")}>Approve</button>
          </>}
        </div>
      </div>
      {open && <ImpactList ruleId={c.rule_id} />}
    </li>
  );
}

/**
 * Waiting for approval. Filters by document, area and market; Select all ticks the changes that can be
 * approved together (big changes and conflicts are left out); a bar at the bottom approves or declines the
 * ticked ones after a check.
 */
function Pending({ changes, rules, staff, doc, setDoc, onDone }: {
  changes: Change[]; rules: Rule[]; staff: Staff | null; doc: string; setDoc: (d: string) => void; onDone: (m: string) => void;
}) {
  const [area, setArea] = useState("");
  const [mkt, setMkt] = useState("");
  const [ticked, setTicked] = useState<Set<number>>(new Set());
  const [confirm, setConfirm] = useState<"approve" | "decline" | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const ruleOf = (id: string) => rules.find((r) => r.id === id);
  const areaOf = (c: Change) => ruleOf(c.rule_id)?.category ?? "Other";

  const docs = [...new Map(changes.filter((c) => c.upload_id).map((c) => [c.upload_id!, c.document ?? "Policy document"])).entries()];
  const shownList = changes.filter((c) => (!doc || (doc === "screen" ? !c.upload_id : c.upload_id === doc)) && (!area || areaOf(c) === area) && (!mkt || (c.market ?? "all") === mkt));
  const areas = [...new Set(changes.map(areaOf))];
  const mkts = [...new Set(changes.map((c) => c.market ?? "all"))];
  const eligible = shownList.filter((c) => !c.big && !c.conflict);
  const picked = eligible.filter((c) => ticked.has(c.id));
  const bigs = shownList.filter((c) => c.big).length, conflicts = shownList.filter((c) => c.conflict).length;

  // A document whose proposals are all decided drops out of the filter.
  useEffect(() => { if (doc && doc !== "screen" && !changes.some((c) => c.upload_id === doc)) setDoc(""); }, [changes, doc, setDoc]);
  // Keep only ticks that are still on screen and still waiting.
  useEffect(() => { setTicked((t) => new Set([...t].filter((id) => eligible.some((c) => c.id === id)))); }, [changes, doc, area, mkt]); // eslint-disable-line react-hooks/exhaustive-deps
  const allBox = useRef<HTMLInputElement>(null);
  useEffect(() => { if (allBox.current) allBox.current.indeterminate = picked.length > 0 && picked.length < eligible.length; });

  async function post(url: string, body: unknown) {
    setError(null);
    const res = await fetch(url, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
    const json = await res.json().catch(() => ({ ok: false, error: "That didn't go through." }));
    if (!json.ok) setError(json.error ?? "That didn't go through.");
    return json;
  }
  async function decide(c: Change, decision: "approve" | "decline") {
    const json = await post(`/api/rules/changes/${c.id}`, { decision });
    if (json.ok) onDone(decision === "approve" ? `${c.rule_name}: approved and live for Alexis's next message.` : `${c.rule_name}: declined.`);
  }
  async function use(c: Change, value: string) {
    const json = await post(`/api/rules/changes/${c.id}`, { decision: "use", value });
    if (json.ok) onDone(json.status === "live" ? `${c.rule_name} ${short(value, ruleOf(c.rule_id)?.unit ?? null)}: live for Alexis's next message.` : `${c.rule_name}: kept at ${short(value, ruleOf(c.rule_id)?.unit ?? null)}.`);
  }
  async function bulk(decision: "approve" | "decline") {
    setBusy(true);
    const json = await post("/api/rules/changes", { ids: picked.map((c) => c.id), decision });
    setBusy(false);
    setConfirm(null);
    if (!json.ok) return;
    setTicked(new Set());
    const n = json.done.length;
    const left = json.skipped.length ? ` ${json.skipped.length} couldn't be: ${json.skipped[0].reason}` : "";
    onDone(decision === "approve" ? `✓ ${n} change${n === 1 ? "" : "s"} approved · live for Alexis's next message.${left}` : `${n} change${n === 1 ? "" : "s"} declined.${left}`);
  }

  if (!changes.length) return null;
  const approver = canApprove(staff);
  const allOn = eligible.length > 0 && picked.length === eligible.length;
  const toggleAll = () => setTicked(allOn ? new Set() : new Set(eligible.map((c) => c.id)));
  const byArea = picked.reduce<Record<string, number>>((m, c) => ({ ...m, [areaOf(c)]: (m[areaOf(c)] ?? 0) + 1 }), {});
  const own = [bigs ? `${bigs} big change${bigs === 1 ? "" : "s"}` : "", conflicts ? `${conflicts} conflict${conflicts === 1 ? "" : "s"}` : ""].filter(Boolean).join(" and ");

  return (
    <section className="panel pending" id="waiting" aria-label="Changes waiting for approval">
      <div className="panel-head"><span className="panel-title">Waiting for approval ({changes.length})</span>
        <span className="label">{approver ? "Check them against past conversations, then approve or decline." : "A supervisor approves these before they go live."}</span></div>
      <div className="pending-filters">
        <label className="picker"><span className="label">From</span>
          <select value={doc} onChange={(e) => setDoc(e.target.value)} aria-label="From document">
            <option value="">Everything</option>
            {docs.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
            {changes.some((c) => !c.upload_id) && <option value="screen">Changes made on this screen</option>}
          </select></label>
        <label className="picker"><span className="label">Area</span>
          <select value={area} onChange={(e) => setArea(e.target.value)} aria-label="Area">
            <option value="">All</option>{areas.map((a) => <option key={a} value={a}>{a}</option>)}
          </select></label>
        <label className="picker"><span className="label">Market</span>
          <select value={mkt} onChange={(e) => setMkt(e.target.value)} aria-label="Market">
            <option value="">All</option>{mkts.map((m) => <option key={m} value={m}>{m === "all" ? "All markets" : m}</option>)}
          </select></label>
        <span className="label pending-count">{shownList.length} waiting</span>
      </div>
      {approver && eligible.length > 0 && (
        <label className="select-all">
          <input ref={allBox} type="checkbox" checked={allOn} onChange={toggleAll} />
          <b>Select all</b>
          <span className="label">
            {picked.length ? `${picked.length} of ${eligible.length} selected` : `${eligible.length} can be approved together`}
            {own ? ` · ${own} need${bigs + conflicts === 1 ? "s" : ""} ${bigs + conflicts === 1 ? "its" : "their"} own decision` : ""}
          </span>
        </label>
      )}
      {error && <div className="case-error takeover-error" role="alert">{error}</div>}
      <ul className="pending-list">
        {shownList.map((c) => (
          <PendingRow key={c.id} c={c} unit={ruleOf(c.rule_id)?.unit ?? null} staff={staff} ticked={ticked.has(c.id)}
            onTick={() => setTicked((t) => { const n = new Set(t); if (n.has(c.id)) n.delete(c.id); else n.add(c.id); return n; })}
            onDecide={decide} onUse={use} />
        ))}
        {!shownList.length && <li className="label">Nothing waiting with these filters.</li>}
      </ul>

      {approver && picked.length > 0 && (
        <div className="bulk-bar" role="region" aria-label="Selected changes">
          <b>{picked.length} selected</b>
          <button className="copy" onClick={() => setTicked(new Set())}>Clear</button>
          <span className="bulk-gap" />
          <button className="btn" onClick={() => setConfirm("decline")}>Decline {picked.length}</button>
          <button className="btn btn-primary" onClick={() => setConfirm("approve")}>Approve {picked.length}</button>
        </div>
      )}

      {confirm && (
        <div className="dialog-scrim" role="presentation" onClick={() => !busy && setConfirm(null)}>
          <div className="dialog panel" role="dialog" aria-modal="true" aria-labelledby="bulk-title" onClick={(e) => e.stopPropagation()}>
            <h2 id="bulk-title">{confirm === "approve" ? "Approve" : "Decline"} {picked.length} change{picked.length === 1 ? "" : "s"}?</h2>
            <p>{confirm === "approve"
              ? "They apply to Alexis's next message. Each one is recorded under your name with the sentence it came from, and can be restored from its History."
              : "They stay as they are now. Each one is recorded under your name as declined."}</p>
            <p className="label">{Object.entries(byArea).map(([a, n]) => `${a} ${n}`).join(" · ")}</p>
            <div className="dialog-buttons">
              <button className="btn" onClick={() => setConfirm(null)} disabled={busy}>Cancel</button>
              <button className="btn btn-primary" onClick={() => bulk(confirm)} disabled={busy} autoFocus>
                {busy ? "Working…" : `${confirm === "approve" ? "Approve" : "Decline"} ${picked.length} change${picked.length === 1 ? "" : "s"}`}
              </button>
            </div>
          </div>
        </div>
      )}
    </section>
  );
}

const READING = ["Reading {doc}…", "Comparing every value with {n} rules…", "Checking every market…", "Looking for places the document disagrees with itself…"];

/**
 * Upload a policy document: the panel explains the four steps, reads the file, then sums up what was
 * proposed by area, flagging big changes and conflicts, with a way into Waiting for approval.
 */
function PolicyUpload({ staff, ruleCount, onDone, onReview }: { staff: Staff | null; ruleCount: number; onDone: () => void; onReview: (upload: string) => void }) {
  const file = useRef<HTMLInputElement>(null);
  const [open, setOpen] = useState(false);
  const [reading, setReading] = useState<string | null>(null);
  const [stage, setStage] = useState(0);
  const [drag, setDrag] = useState(false);
  const [result, setResult] = useState<Extracted | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => { if (!reading) return; setStage(0); const t = setInterval(() => setStage((s) => Math.min(s + 1, READING.length - 1)), 7000); return () => clearInterval(t); }, [reading]);

  async function upload(f: File | undefined) {
    if (!f) return;
    setError(null);
    setResult(null);
    if (f.size > 3_000_000) { setError("Keep the file under 3 MB."); return; }
    const media_type = f.type === "application/pdf" || /\.pdf$/i.test(f.name) ? "application/pdf" : /\.(md|markdown)$/i.test(f.name) ? "text/markdown" : "text/plain";
    if (media_type === "text/plain" && ((f.type && !f.type.startsWith("text/")) || (!f.type && !/\.txt$/i.test(f.name)))) { setError("Upload a PDF or a text file. Word files aren't read yet: save it as PDF first."); return; }
    setReading(f.name);
    try {
      const data = await new Promise<string>((res, rej) => { const r = new FileReader(); r.onload = () => res(String(r.result).split(",")[1] ?? ""); r.onerror = rej; r.readAsDataURL(f); });
      const resp = await fetch("/api/rules/extract", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ file: { name: f.name, media_type, data } }) });
      const json = await resp.json();
      if (!json.ok) { setError(json.error); return; }
      setResult(json);
      onDone();
    } catch {
      setError("The upload didn't go through. Try again.");
    } finally {
      setReading(null);
    }
  }

  const made = result ? result.proposed.filter((p) => p.change) : [];
  const conflicts = result ? result.conflicts.filter((c) => c.change) : [];
  const failed = result ? [...result.proposed.filter((p) => !p.change), ...result.conflicts.filter((c) => !c.change)] : [];
  const bigs = made.filter((p) => p.big).length;
  const groups = [...new Set([...made.map((p) => p.category), ...conflicts.map((c) => c.category)])];
  const waiting = made.length + conflicts.length;
  const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;

  return (
    <>
      <input ref={file} type="file" accept="application/pdf,text/plain,.md,.txt,.pdf" hidden onChange={(e) => { upload(e.target.files?.[0]); e.target.value = ""; }} />
      <button className="btn btn-primary" disabled={!staff} onClick={() => setOpen(true)} title={staff ? "" : "Sign in first"} aria-expanded={open}>Upload a policy document</button>
      {!open && <p className="label policy-hint">Upload a policy (PDF or text). The AI compares it with these rules and proposes changes for approval; nothing goes live until someone approves it.</p>}
      {open && (
        <div className="policy-panel panel" role="region" aria-label="Upload a policy document">
          <div className="policy-head">
            <b>{result ? result.document : "Upload a policy document"}</b>
            {!reading && <button className="copy" onClick={() => { setOpen(false); setResult(null); setError(null); }}>Close ✕</button>}
          </div>

          {!reading && !result && <>
            <ol className="policy-steps">
              <li>Choose the policy: fees, disputes, refunds, limits, timelines.</li>
              <li>The AI compares every value with the rules on this screen.</li>
              <li>Where it differs, it proposes a change, quoting the sentence it came from. Where the document gives two values for one rule, it shows both and doesn&apos;t choose.</li>
              <li>Each proposal waits for a supervisor or operations admin. Nothing changes until approved.</li>
            </ol>
            <div className={`dropzone${drag ? " is-over" : ""}`}
              onDragOver={(e) => { e.preventDefault(); setDrag(true); }} onDragLeave={() => setDrag(false)}
              onDrop={(e) => { e.preventDefault(); setDrag(false); upload(e.dataTransfer.files?.[0]); }}>
              <span>Drop a file here, or</span>
              <button className="btn btn-primary" onClick={() => file.current?.click()}>Choose file</button>
              <span className="label">PDF or text file, up to 3 MB</span>
            </div>
          </>}

          {reading && (
            <div className="policy-reading" role="status" aria-live="polite">
              <div className="progress"><span /></div>
              <b>{READING[stage].replace("{doc}", reading).replace("{n}", String(ruleCount))}</b>
              <span className="label">About 20 to 60 seconds for a long document. You can leave this page: the proposals will be waiting under Waiting for approval.</span>
            </div>
          )}

          {error && <div className="rule-error" role="alert">{error}</div>}

          {result && <>
            <div className="policy-counts">
              <span className="count"><b>{made.length}</b> change{made.length === 1 ? "" : "s"} proposed</span>
              {bigs > 0 && <span className="count is-bad"><b>{bigs}</b> big change{bigs === 1 ? "" : "s"}</span>}
              {conflicts.length > 0 && <span className="count is-bad"><b>{conflicts.length}</b> conflict{conflicts.length === 1 ? "" : "s"}</span>}
              <span className="count"><b>{result.notMatched.length}</b> not covered by any rule</span>
            </div>
            {waiting === 0 && <div className="label">The document didn&apos;t change any of the current values.</div>}
            {groups.map((g) => {
              const ps = made.filter((p) => p.category === g), cs = conflicts.filter((c) => c.category === g);
              return (
                <details key={g} className="policy-group">
                  <summary>{g} · {ps.length + cs.length}{ps.some((p) => p.big) || cs.length ? <span className="tag tag-big">needs its own decision</span> : null}</summary>
                  <ul>
                    {ps.map((p) => (
                      <li key={p.change}>{p.name}{p.market !== "All markets" ? ` · ${p.market}` : ""}: {shown(p.old, p.unit)} → <b>{shown(p.value, p.unit)}</b>
                        {p.big && <span className="tag tag-big">big change</span>}
                        <blockquote className="pending-quote">“{p.quote}”{p.page ? ` · p. ${p.page}` : ""}</blockquote></li>
                    ))}
                    {cs.map((c) => (
                      <li key={c.change}>{c.name}{c.market !== "All markets" ? ` · ${c.market}` : ""} <span className="tag tag-big">conflict</span>
                        <div className="label">{c.options.map((o) => `“${short(o.value, c.unit)}”${o.page ? ` (p. ${o.page})` : ""}`).join(" vs ")}</div></li>
                    ))}
                  </ul>
                </details>
              );
            })}
            {result.notMatched.length > 0 && (
              <details className="policy-group">
                <summary>Not covered by any rule · {result.notMatched.length}</summary>
                <div className="label">In the document, but not one of the rules, so nothing was added. Your team can add a rule for it.</div>
                <ul>{result.notMatched.map((n, i) => <li key={i}>{n}</li>)}</ul>
              </details>
            )}
            {failed.length > 0 && (
              <details className="policy-group">
                <summary>Not proposed · {failed.length}</summary>
                <ul>{failed.map((p, i) => <li key={i}>{p.name} ({p.market}): <span className="rule-error">{p.error}</span></li>)}</ul>
              </details>
            )}
            <div className="policy-actions">
              <button className="copy" onClick={() => setResult(null)}>Upload another</button>
              {waiting > 0 && <button className="btn btn-primary" onClick={() => { onReview(result.upload); setOpen(false); setResult(null); }}>Review the {plural(waiting, "proposal")}</button>}
            </div>
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
  const [doc, setDoc] = useState("");
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
        <PolicyUpload staff={staff} ruleCount={rules?.length ?? 0} onDone={load}
          onReview={(u) => { setDoc(u); setTimeout(() => document.getElementById("waiting")?.scrollIntoView({ behavior: "smooth", block: "start" }), 50); }} />
      </div>
      {message && <div className="toast" role="status">{message}</div>}

      <Pending changes={pending} rules={rules ?? []} staff={staff} doc={doc} setDoc={setDoc} onDone={(m) => { setMessage(m); load(); }} />

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
