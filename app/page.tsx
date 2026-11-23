"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { StatusChip, UrgencyChip } from "./components/Chat";
import { RESET_EVENT } from "./components/events";

// The console's Inbox: every customer conversation as it comes in. Alexis answers each one; the team
// watches the chat and her activity live, takes a conversation over to reply in person, and hands it back.

interface CaseRow {
  id: string; customer: string | null; business: string | null; verified: boolean;
  category: string; status: string; urgency: string | null; references: string[]; takenOverBy: string | null;
  channel: "app" | "whatsapp" | "email"; subject: string | null;
  language: string; review: { rating: "good" | "needs_work"; note: string | null; by: string } | null;
  started: string; lastActivity: string; messages: number; firstMessage: string | null;
}
interface Counts { total: number; open: number; resolvedByAlexis: number; handedOff: number; urgentOpen: number; withoutPerson: number | null }
interface Detail {
  transcript: { who: string; text: string; staff?: string }[];
  activity: { id: number; kind: string; summary: string; staff: string | null; created_at: string }[];
  handoffs: { reference: string; urgency: string; status: string; trigger: string; created_at: string }[];
  takenOverBy: string | null;
  awaitingTeam: string | null;
  language: string;
  review: { rating: "good" | "needs_work"; note: string | null; by: string } | null;
}
interface Staff { id: string; name: string; role: "support_agent" | "supervisor" }

const ALL = "all";
const LANGUAGE_NAME: Record<string, string> = { en: "English", fr: "French", pcm: "Pidgin", yo: "Yoruba", ha: "Hausa", ig: "Igbo" };
const CHANNEL_NAME = { app: "App chat", whatsapp: "WhatsApp", email: "Email" } as const;

/** Where the customer wrote from, as a small labelled chip. */
function ChannelChip({ channel }: { channel: keyof typeof CHANNEL_NAME }) {
  return <span className={`chip chip-channel chip-${channel}`}>{CHANNEL_NAME[channel]}</span>;
}
const STATUS_ORDER = ["In progress", "Taken over", "Waiting on customer", "Handed off", "Needs approval", "Resolved by Alexis", "Resolved by staff"];

function ago(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 1) return "just now";
  if (mins < 60) return `${mins} min ago`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h} h ago` : `${Math.floor(h / 24)} d ago`;
}
const when = (iso: string) => new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });

export default function InboxPage() {
  const [cases, setCases] = useState<CaseRow[] | null>(null);
  const [counts, setCounts] = useState<Counts | null>(null);
  const [allCategories, setAllCategories] = useState<string[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [status, setStatus] = useState(ALL);
  const [category, setCategory] = useState(ALL);
  const [urgency, setUrgency] = useState(ALL);
  const [channel, setChannel] = useState(ALL);
  const [reviewed, setReviewed] = useState(ALL);
  const [translation, setTranslation] = useState<{ who: string; text: string; staff?: string }[] | null>(null);
  const [reviewNote, setReviewNote] = useState("");
  const [search, setSearch] = useState("");
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<Detail | null>(null);
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [staffId, setStaffId] = useState("");
  const [reply, setReply] = useState("");
  const [acting, setActing] = useState(false);
  const [actError, setActError] = useState<string | null>(null);
  const picked = useRef(false);
  const chatRef = useRef<HTMLDivElement>(null);
  const staff = staffList.find((s) => s.id === staffId) ?? null;

  // A link from the Rules screen (/?c=<conversation>) opens that conversation.
  useEffect(() => {
    const id = new URLSearchParams(window.location.search).get("c");
    if (id && /^[0-9a-f-]{36}$/i.test(id)) { picked.current = true; setSelected(id); }
  }, []);

  useEffect(() => {
    fetch("/api/staff/users", { cache: "no-store" }).then((r) => r.json()).then((j) => setStaffList(j.staff ?? [])).catch(() => {});
    try { setStaffId(localStorage.getItem("orchestra-staff") ?? ""); } catch {}
  }, []);
  const signIn = (id: string) => { setStaffId(id); try { localStorage.setItem("orchestra-staff", id); } catch {} };

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/cases", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) { setProblem(json.message ?? "The database isn't connected yet."); setCases([]); return; }
      setProblem(null);
      setCases(json.cases);
      setCounts(json.counts);
      if (json.categories) setAllCategories(json.categories);
      // Open the newest conversation on arrival, so a message sent from the customer app shows at once.
      if (!picked.current && json.cases.length) { picked.current = true; setSelected(json.cases[0].id); }
    } catch {
      setProblem("Couldn't reach the app's server.");
      setCases([]);
    }
  }, []);

  const loadDetail = useCallback(async (id: string) => {
    const res = await fetch(`/api/cases/${id}`, { cache: "no-store" }).catch(() => null);
    if (res?.ok) {
      const d = (await res.json()) as Detail;
      setDetail((cur) => (selectedRef.current === id ? d : cur));
    }
  }, []);
  const selectedRef = useRef<string | null>(null);
  selectedRef.current = selected;

  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 3000);
    const onReset = () => { setSelected(null); setDetail(null); picked.current = false; load(); };
    window.addEventListener(RESET_EVENT, onReset);
    return () => { clearInterval(t); window.removeEventListener(RESET_EVENT, onReset); };
  }, [load]);

  useEffect(() => {
    setDetail(null);
    setActError(null);
    setTranslation(null);
    setReviewNote("");
    if (!selected) return;
    loadDetail(selected);
    const t = setInterval(() => document.visibilityState === "visible" && loadDetail(selected), 2000);
    return () => clearInterval(t);
  }, [selected, loadDetail]);

  // Follow the conversation as it grows.
  const lines = detail?.transcript.length ?? 0;
  useEffect(() => { chatRef.current?.scrollTo({ top: chatRef.current.scrollHeight, behavior: "smooth" }); }, [lines, selected]);

  // Every category, not only those the current conversations have, with how many are in each.
  const categories = useMemo(() => [...new Set([...allCategories, ...(cases ?? []).map((c) => c.category)])].sort(), [cases, allCategories]);
  const inCategory = useMemo(() => {
    const n = new Map<string, number>();
    for (const c of cases ?? []) n.set(c.category, (n.get(c.category) ?? 0) + 1);
    return n;
  }, [cases]);
  const shown = useMemo(() => {
    const q = search.trim().toLowerCase();
    return (cases ?? []).filter((c) =>
      (status === ALL || (status === "open" ? !c.status.startsWith("Resolved") : c.status === status)) &&
      (category === ALL || c.category === category) &&
      (urgency === ALL || (urgency === "none" ? !c.urgency : c.urgency === urgency)) &&
      (channel === ALL || c.channel === channel) &&
      (reviewed === ALL || (reviewed === "none" ? !c.review : c.review?.rating === reviewed)) &&
      (!q || [c.customer, c.business, c.firstMessage, c.subject, ...c.references].some((v) => v?.toLowerCase().includes(q))));
  }, [cases, status, category, urgency, channel, reviewed, search]);

  const c = cases?.find((x) => x.id === selected) ?? null;
  const takenBy = detail?.takenOverBy ?? null;
  const mine = Boolean(staff && takenBy === staff.name);
  const last = detail?.transcript[detail.transcript.length - 1];
  const waiting = detail?.awaitingTeam ?? null;
  const alexisWorking = Boolean(c && !takenBy && !waiting && last?.who === "Customer" && Date.now() - new Date(c.lastActivity).getTime() < 90_000);

  async function act(action: "take_over" | "hand_back" | "reply" | "review" | "translate", text?: string, rating?: "good" | "needs_work") {
    if (!selected) return;
    setActing(true);
    setActError(null);
    try {
      const res = await fetch(`/api/cases/${selected}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, staffId, text, rating, note: action === "review" ? reviewNote : undefined }) });
      const json = await res.json().catch(() => ({}));
      if (!res.ok) setActError((json as { message?: string }).message ?? "That didn't go through. Try again.");
      else if (action === "reply") setReply("");
      else if (action === "translate") setTranslation((json as { translation: { who: string; text: string }[] }).translation);
      await Promise.all([loadDetail(selected), load()]);
    } catch {
      setActError("Couldn't reach the app's server. Try again.");
    } finally {
      setActing(false);
    }
  }

  return (
    <div className="cases-page">
      {counts && (
        <div className="stat-row" aria-label="Inbox numbers">
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
              <Filter label="Category" value={category} onChange={setCategory} options={[[ALL, "Category"], ...categories.map((s) => [s, `${s} (${inCategory.get(s) ?? 0})`] as [string, string])]} />
              <Filter label="Urgency" value={urgency} onChange={setUrgency} options={[[ALL, "Urgency"], ["urgent", "Urgent"], ["high", "High"], ["normal", "Normal"], ["none", "Not handed off"]]} />
              <Filter label="Channel" value={channel} onChange={setChannel} options={[[ALL, "Channel"], ["app", "App chat"], ["whatsapp", "WhatsApp"], ["email", "Email"]]} />
              <Filter label="Review" value={reviewed} onChange={setReviewed} options={[[ALL, "Review"], ["none", "Not reviewed"], ["good", "Good"], ["needs_work", "Needs work"]]} />
            </div>
            <span className="label">{shown.length} of {cases?.length ?? 0} conversations · updates live</span>
          </div>
          <div className="case-list">
            {problem && <div className="empty">{problem}</div>}
            {cases === null && <div className="empty">Loading conversations…</div>}
            {cases && cases.length === 0 && !problem && (
              <div className="empty">No conversations yet. Open the customer app (top right), send a message, and it will arrive here.</div>
            )}
            {cases && cases.length > 0 && shown.length === 0 && <div className="empty">No conversations match these filters.</div>}
            {shown.map((k) => (
              <button key={k.id} className="case-row" aria-current={selected === k.id ? "true" : undefined} onClick={() => { picked.current = true; setSelected(k.id); }}>
                <span className="case-top">
                  <StatusChip status={k.status} />
                  {k.urgency && <UrgencyChip urgency={k.urgency} />}
                  <ChannelChip channel={k.channel} />
                  <span className="label" style={{ marginLeft: "auto" }}>{ago(k.lastActivity)}</span>
                </span>
                <span className="case-business">{k.business ?? "Customer not identified"}{k.customer ? ` · ${k.customer}` : ""}</span>
                <span className="label">{k.category}{k.verified ? "" : " · identity not verified"}{k.takenOverBy ? ` · ${k.takenOverBy} is handling it` : ""}</span>
                {k.subject && <span className="case-snippet"><b>{k.subject}</b></span>}
                {k.firstMessage && <span className="case-snippet">“{k.firstMessage}”</span>}
              </button>
            ))}
          </div>
        </section>

        <section className="panel" aria-label="Conversation">
          {!c ? (
            <div className="empty">Choose a conversation to watch it live.</div>
          ) : (
            <>
              <div className="panel-head inbox-head">
                <div>
                  <div className="panel-title">{c.business ?? "Customer not identified"}{c.customer ? ` · ${c.customer}` : ""}</div>
                  <div className="label">{c.language !== "en" ? `${LANGUAGE_NAME[c.language] ?? c.language} · ` : ""}{CHANNEL_NAME[c.channel]}{c.subject ? ` · “${c.subject}”` : ""} · {c.category} · started {when(c.started)} · identity {c.verified ? "verified" : "not verified"}</div>
                </div>
                <span className="inbox-chips">
                  <StatusChip status={c.status} />
                  {c.urgency && <UrgencyChip urgency={c.urgency} />}
                  {detail?.handoffs.map((h) => (
                    <a key={h.reference} className="ref case-link" href={`/staff?case=${h.reference}`} title={h.trigger.replace(/_/g, " ")}>{h.reference} ↗</a>
                  ))}
                </span>
              </div>

              <div className="takeover-bar">
                <label className="picker">
                  <span className="label">Signed in as</span>
                  <select value={staffId} onChange={(e) => signIn(e.target.value)} aria-label="Staff sign-in (simulated)">
                    <option value="">Choose…</option>
                    {staffList.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.role === "supervisor" ? "Supervisor" : "Support agent"}</option>)}
                  </select>
                </label>
                <span className="takeover-state">
                  {takenBy ? <><b>{takenBy}</b> is handling this conversation. Alexis is paused.</>
                    : waiting ? <><b>Waiting for the team.</b> {waiting === "switched_off" ? "Alexis is switched off, so the customer's messages come to you." : "The AI service was down, so this came to you. Alexis answers again on the customer's next message."} Take over to reply.</>
                    : <>Alexis is handling this conversation.</>}
                </span>
                {!takenBy && <button className="btn btn-primary" disabled={!staff || acting || !detail} onClick={() => act("take_over")} title={staff ? "" : "Sign in first"}>Take over</button>}
                {mine && <button className="btn" disabled={acting} onClick={() => act("hand_back")}>Hand back to Alexis</button>}
              </div>
              <div className="takeover-bar review-bar">
                <span className="label">Review</span>
                {detail?.review && <span className={`tag tag-${detail.review.rating === "good" ? "live" : "pending"}`}>{detail.review.rating === "good" ? "Good" : "Needs work"} · {detail.review.by}{detail.review.note ? `: ${detail.review.note}` : ""}</span>}
                <label className="sr-only" htmlFor="review-note">Review note</label>
                <input id="review-note" className="filter-input review-note" placeholder="Note (optional)" value={reviewNote} onChange={(e) => setReviewNote(e.target.value)} maxLength={1000} />
                <button className="btn" disabled={!staff || acting || !detail} onClick={() => act("review", undefined, "good")} title={staff ? "" : "Sign in first"}>Good</button>
                <button className="btn" disabled={!staff || acting || !detail} onClick={() => act("review", undefined, "needs_work")} title={staff ? "" : "Sign in first"}>Needs work</button>
                {detail && detail.language !== "en" && (
                  translation
                    ? <button className="btn" onClick={() => setTranslation(null)}>Show the original ({LANGUAGE_NAME[detail.language] ?? detail.language})</button>
                    : <button className="btn" disabled={!staff || acting} onClick={() => act("translate")}>Translate to English</button>
                )}
              </div>
              {actError && <div className="case-error takeover-error" role="alert">{actError}</div>}

              {!detail ? (
                <div className="empty">Loading…</div>
              ) : (
                <div className="watch-grid">
                  <div className="watch-chat">
                    <div className="history" ref={chatRef} aria-live="polite">
                      {translation && <div className="chat-notice">English translation for the team. The customer sees the original.</div>}
                      {(translation ?? detail.transcript).map((m, i) => (
                        <div key={i} className={`msg ${m.who === "Customer" ? "msg-in" : "msg-out"}${m.staff ? " msg-staff" : ""}`}>
                          <div className="msg-meta">{m.who === "Customer" ? (c.customer ?? "Customer") : m.staff ? `${m.staff} · support team` : "Alexis · AI"}</div>
                          {m.text}
                        </div>
                      ))}
                      {alexisWorking && (
                        <div className="msg msg-out"><div className="msg-meta">Alexis · AI</div><span className="dots" aria-label="Alexis is replying"><span /><span /><span /></span></div>
                      )}
                    </div>
                    {mine ? (
                      <form className="composer" onSubmit={(e) => { e.preventDefault(); if (reply.trim()) act("reply", reply); }}>
                        <label className="sr-only" htmlFor="staff-reply">Reply to the customer</label>
                        <textarea id="staff-reply" rows={1} value={reply} placeholder={`Reply as ${staff!.name}`} onChange={(e) => setReply(e.target.value)}
                          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); if (reply.trim()) act("reply", reply); } }} />
                        <button className="btn btn-primary" type="submit" disabled={acting || !reply.trim()}>Send</button>
                      </form>
                    ) : (
                      <div className="watch-note label">
                        {takenBy ? `Only ${takenBy} can reply while they're handling it.` : staff ? "Take over to reply to the customer yourself." : "Sign in above to take over and reply."}
                      </div>
                    )}
                  </div>
                  <div className="watch-activity">
                    <div className="watch-title">What Alexis is doing</div>
                    <div className="activity-list">
                      {detail.activity.length === 0 && <div className="empty">Nothing looked up or done yet.</div>}
                      {detail.activity.map((r) => (
                        <div key={r.id} className={`row k-${r.kind}`}>
                          <div className="row-line">
                            <span className="row-time">{new Date(r.created_at).toLocaleTimeString("en-GB")}</span>
                            <span className="row-text">{r.summary}</span>
                          </div>
                        </div>
                      ))}
                    </div>
                  </div>
                </div>
              )}
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
