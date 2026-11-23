"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { StatusChip, UrgencyChip } from "../components/Chat";
import { RESET_EVENT } from "../components/events";

interface CaseRow {
  id: string; customer: string | null; business: string | null; verified: boolean;
  category: string; status: string; urgency: string | null; references: string[];
  started: string; lastActivity: string; messages: number; firstMessage: string | null;
}
interface Counts { total: number; open: number; resolvedByAlexis: number; handedOff: number; urgentOpen: number; withoutPerson: number | null }
interface Detail {
  transcript: { who: string; text: string }[];
  activity: { id: number; kind: string; summary: string; staff: string | null; created_at: string }[];
  handoffs: { reference: string; urgency: string; status: string; trigger: string; created_at: string }[];
}

const ALL = "all";
const STATUS_ORDER = ["In progress", "Waiting on customer", "Handed off", "Needs approval", "Resolved by Alexis", "Resolved by staff"];

function ago(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
}

const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

/** Every customer conversation: who, what it was about, where it stands, and the full chat history. */
export default function CasesPage() {
  const [cases, setCases] = useState<CaseRow[] | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [status, setStatus] = useState(ALL);
  const [category, setCategory] = useState(ALL);
  const [urgency, setUrgency] = useState(ALL);
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [show, setShow] = useState<"chat" | "activity">("chat");

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/cases", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) { setProblem("The database isn't connected yet."); setCases([]); return; }
      setProblem(null);
      setCases(json.cases);
      setCounts(json.counts);
    } catch {
      setProblem("Couldn't reach the app's server.");
      setCases([]);
    }
  }, []);

  const open = useCallback(async (id: string) => {
    setSelected(id);
    const res = await fetch(`/api/cases/${id}`, { cache: "no-store" });
    if (res.ok) setDetail(await res.json());
  }, []);

  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 5000);
    const onReset = () => { setSelected(null); setDetail(null); load(); };
    window.addEventListener(RESET_EVENT, onReset);
    return () => { clearInterval(t); window.removeEventListener(RESET_EVENT, onReset); };
  }, [load]);

  // Keep the open conversation's history current while it's still going.
  useEffect(() => {
    if (!selected) return;
    const t = setInterval(() => document.visibilityState === "visible" && open(selected), 5000);
    return () => clearInterval(t);
  }, [selected, open]);

  const categories = useMemo(() => [...new Set((cases ?? []).map((c) => c.category))].sort(), [cases]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (cases ?? []).filter((c) =>
      (status === ALL || (status === "open" ? !c.status.startsWith("Resolved") : c.status === status)) &&
      (category === ALL || c.category === category) &&
      (urgency === ALL || (urgency === "none" ? !c.urgency : c.urgency === urgency)) &&
      (!q || [c.customer, c.business, c.firstMessage, ...c.references].some((v) => v?.toLowerCase().includes(q))));
  }, [cases, status, category, urgency, search]);

  const c = cases?.find((x) => x.id === selected) ?? null;

  return (
    <div className="cases-page">
      {counts && (
        <div className="stat-row" aria-label="Case numbers">
          <Stat value={counts.total} label="Conversations" />
          <Stat value={counts.open} label="Open now" />
          <Stat value={counts.resolvedByAlexis} label="Resolved by Alexis" />
          <Stat value={counts.handedOff} label="Handed to a person" />
          <Stat value={counts.urgentOpen} label="Urgent and open" tone={counts.urgentOpen ? "stop" : undefined} />
          <Stat value={counts.withoutPerson == null ? "–" : `${counts.withoutPerson}%`} label="Resolved without a person" />
        </div>
      )}

      <div className="cases-grid">
        <section className="panel" aria-label="Conversations">
          <div className="filters">
            <label className="sr-only" htmlFor="case-search">Search</label>
            <input id="case-search" className="filter-input" placeholder="Search customer, business or reference" value={search} onChange={(e) => setSearch(e.target.value)} />
            <div className="filter-row">
              <Filter label="Status" value={status} onChange={setStatus} options={[[ALL, "Status"], ["open", "All open"], ...STATUS_ORDER.map((s) => [s, s] as [string, string])]} />
              <Filter label="Category" value={category} onChange={setCategory} options={[[ALL, "Category"], ...categories.map((s) => [s, s] as [string, string])]} />
              <Filter label="Urgency" value={urgency} onChange={setUrgency} options={[[ALL, "Urgency"], ["urgent", "Urgent"], ["high", "High"], ["normal", "Normal"], ["none", "Not handed off"]]} />
            </div>
            <span className="label">{shown.length} of {cases?.length ?? 0} conversations</span>
          </div>
          <div className="case-list">
            {problem && <div className="empty">{problem}</div>}
            {cases === null && <div className="empty">Loading conversations…</div>}
            {cases && cases.length === 0 && !problem && <div className="empty">No conversations yet. Each chat with Alexis will appear here.</div>}
            {cases && cases.length > 0 && shown.length === 0 && <div className="empty">No conversations match these filters.</div>}
            {shown.map((k) => (
              <button key={k.id} className="case-row" aria-current={selected === k.id ? "true" : undefined} onClick={() => { setShow("chat"); open(k.id); }}>
                <span className="case-top">
                  <StatusChip status={k.status} />
                  {k.urgency && <UrgencyChip urgency={k.urgency} />}
                  <span className="label" style={{ marginLeft: "auto" }}>{ago(k.lastActivity)}</span>
                </span>
                <span className="case-business">{k.business ?? "Customer not chosen"}{k.customer ? ` · ${k.customer}` : ""}</span>
                <span className="label">{k.category}{k.verified ? "" : " · identity not verified"}</span>
                {k.firstMessage && <span className="case-snippet">“{k.firstMessage}”</span>}
              </button>
            ))}
          </div>
        </section>

        <section className="panel" aria-label="Conversation">
          {!c || !detail ? (
            <div className="empty">Choose a conversation to see its chat history and what Alexis did.</div>
          ) : (
            <>
              <div className="panel-head" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
                <span className="panel-title">{c.business ?? "Customer not chosen"}{c.customer ? ` · ${c.customer}` : ""}</span>
                <span style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <StatusChip status={c.status} />
                  {c.urgency && <UrgencyChip urgency={c.urgency} />}
                </span>
              </div>
              <dl className="case-facts">
                <div><dt>Category</dt><dd>{c.category}</dd></div>
                <div><dt>Started</dt><dd>{when(c.started)}</dd></div>
                <div><dt>Last activity</dt><dd>{ago(c.lastActivity)}</dd></div>
                <div><dt>Identity</dt><dd>{c.verified ? "Verified" : "Not verified"}</dd></div>
                {detail.handoffs.length > 0 && (
                  <div><dt>Handed off</dt><dd>{detail.handoffs.map((h) => (
                    <a key={h.reference} className="ref case-link" href={`/staff?case=${h.reference}`}>{h.reference} · {h.urgency} · {h.trigger.replace(/_/g, " ")}</a>
                  ))}</dd></div>
                )}
              </dl>
              <div className="case-tabs">
                {(["chat", "activity"] as const).map((v) => (
                  <button key={v} className="tab" aria-current={show === v ? "page" : undefined} onClick={() => setShow(v)}>
                    {v === "chat" ? `Chat history (${detail.transcript.length})` : `Activity log (${detail.activity.length})`}
                  </button>
                ))}
              </div>
              <div className="case-body">
                {show === "chat" && (
                  <div className="history">
                    {detail.transcript.length === 0 && <div className="empty">No messages yet.</div>}
                    {detail.transcript.map((m, i) => (
                      <div key={i} className={`msg ${m.who === "Customer" ? "msg-customer" : "msg-alexis"}`}>
                        {m.who === "Alexis" && <div className="msg-meta">Alexis · AI</div>}
                        {m.text}
                      </div>
                    ))}
                  </div>
                )}
                {show === "activity" && (
                  <div className="activity-list">
                    {detail.activity.length === 0 && <div className="empty">Nothing looked up or done yet.</div>}
                    {detail.activity.map((r) => (
                      <div key={r.id} className={`row k-${r.kind}`}>
                        <div className="row-line">
                          <span className="row-time">{new Date(r.created_at).toLocaleTimeString("en-GB")}</span>
                          <span className="row-text">{r.summary}{r.staff ? ` · ${r.staff}` : ""}</span>
                        </div>
                      </div>
                    ))}
                  </div>
                )}
              </div>
            </>
          )}
        </section>
      </div>
    </div>
  );
}

function Stat({ value, label, tone }: { value: number | string; label: string; tone?: "stop" }) {
  return (
    <div className={`stat${tone ? ` stat-${tone}` : ""}`}>
      <span className="stat-value">{value}</span>
      <span className="label">{label}</span>
    </div>
  );
}

function Filter({ label, value, onChange, options }: { label: string; value: string; onChange: (v: string) => void; options: [string, string][] }) {
  return (
    <label className="filter">
      <span className="sr-only">{label}</span>
      <select value={value} onChange={(e) => onChange(e.target.value)} aria-label={label}>
        {options.map(([v, t]) => <option key={v} value={v}>{t}</option>)}
      </select>
    </label>
  );
}
