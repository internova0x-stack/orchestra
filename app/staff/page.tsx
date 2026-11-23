"use client";

import { useCallback, useEffect, useState } from "react";
import { UrgencyChip, StatusChip } from "../components/Chat";
import { RESET_EVENT } from "../components/events";

interface CaseItem {
  reference: string; urgency: string; status: string; created_at: string; trigger: string | null; business: string | null;
  action: { type: string; reference: string; payout: string; amount: string } | null;
}
interface Summary {
  reference: string; urgency: string;
  customer: { business?: string; user?: string; role?: string; identity: string };
  request: string; checked: string; did: string; why: string; needed: string; told: string; flags: string[];
}
interface ClaimDraft {
  reference: string; to_party: string; status: string; deadline: string | null; sent_at: string | null;
  draft: { to: string; subject: string; facts: [string, string][]; timeline: { stage: string; status: string; time: string; reported_by: string }[]; evidence: string[]; missing: string[]; request: string };
}
interface CaseDetail {
  case: CaseItem & { summary: Summary; respond_by: string | null; resolution: string | null; decided_at: string | null };
  transcript: { who: string; text: string }[];
  activity: { id: number; kind: string; summary: string; created_at: string }[];
  claim: ClaimDraft | null;
}

interface Staff { id: string; name: string; role: "support_agent" | "supervisor" }
interface AssistMsg { id: string; who: "staff" | "alexis"; text: string; thinking?: boolean }

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

/** Staff mode (use case 19): ask Alexis about this case. Lookups and drafts only; logged under your name. */
function AskAlexis({ caseRef, staff }: { caseRef: string; staff: Staff }) {
  const [sessionId, setSessionId] = useState(newId);
  const [msgs, setMsgs] = useState<AssistMsg[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  useEffect(() => { setSessionId(newId()); setMsgs([]); }, [caseRef, staff.id]);

  async function ask(text: string) {
    if (!text.trim() || busy) return;
    setBusy(true);
    setMsgs((m) => [...m, { id: newId(), who: "staff", text }, { id: newId(), who: "alexis", text: "", thinking: true }]);
    const patch = (fn: (m: AssistMsg) => AssistMsg) => setMsgs((ms) => { const c = ms.slice(); c[c.length - 1] = fn(c[c.length - 1]); return c; });
    try {
      const res = await fetch("/api/staff/assist", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ sessionId, caseRef, staffId: staff.id, message: text }) });
      if (!res.ok || !res.body) { patch((m) => ({ ...m, thinking: false, text: "Alexis isn't available: check the API key and database are set up." })); return; }
      const reader = res.body.getReader();
      const dec = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += dec.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const e = JSON.parse(line);
          if (e.type === "text") patch((m) => ({ ...m, thinking: false, text: m.text + e.delta }));
          else if (e.type === "break") patch((m) => ({ ...m, text: m.text ? m.text + "\n\n" : m.text }));
          else if (e.type === "error") patch((m) => ({ ...m, thinking: false, text: (m.text ? m.text + "\n\n" : "") + e.message }));
        }
      }
    } finally {
      patch((m) => ({ ...m, thinking: false }));
      setBusy(false);
    }
  }

  return (
    <div className="assist">
      <p className="label">Staff mode: Alexis investigates with the same lookups, and drafts replies and notes for you to edit. No actions on the account; everything is logged under {staff.name}.</p>
      <div className="assist-quick">
        {["Summarise this case", "What happened with this payment?", "Draft a reply to the customer", "Write the case notes"].map((q) => (
          <button key={q} className="btn" disabled={busy} onClick={() => ask(q)}>{q}</button>
        ))}
      </div>
      <div className="assist-msgs" aria-live="polite">
        {msgs.map((m) => (
          <div key={m.id} className={`msg ${m.who === "staff" ? "msg-customer" : "msg-alexis"}`}>
            {m.who === "alexis" && <div className="msg-meta">Alexis · staff mode</div>}
            {m.thinking && !m.text ? <span className="dots" aria-label="Alexis is working"><span /><span /><span /></span> : m.text}
          </div>
        ))}
      </div>
      <form className="composer" style={{ padding: 0, border: 0 }} onSubmit={(e) => { e.preventDefault(); const t = draft; setDraft(""); ask(t); }}>
        <label className="sr-only" htmlFor="assist">Ask Alexis about this case</label>
        <textarea id="assist" rows={1} value={draft} placeholder="Ask Alexis about this case" onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); const t = draft; setDraft(""); ask(t); } }} />
        <button className="btn btn-primary" type="submit" disabled={busy || !draft.trim()}>Ask</button>
      </form>
    </div>
  );
}

const STATUS_WORD: Record<string, string> = { open: "Open", approved: "Approved", declined: "Declined", resolved: "Resolved" };

function age(iso: string) {
  const mins = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  if (mins < 60) return `${mins} min`;
  const h = Math.floor(mins / 60);
  return h < 24 ? `${h} h` : `${Math.floor(h / 24)} d`;
}

export default function StaffPage() {
  const [cases, setCases] = useState<CaseItem[] | null>(null);
  const [problem, setProblem] = useState<string | null>(null);
  const [selected, setSelected] = useState<string | null>(null);
  const [detail, setDetail] = useState<CaseDetail | null>(null);
  const [arming, setArming] = useState<"approve" | "decline" | "claim_sent" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [actError, setActError] = useState<string | null>(null);
  const [show, setShow] = useState<"summary" | "claim" | "assist" | "transcript" | "activity">("summary");
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [staffId, setStaffId] = useState<string>("");
  const staff = staffList.find((x) => x.id === staffId) ?? null;
  useEffect(() => {
    fetch("/api/staff/users", { cache: "no-store" }).then((r) => r.json()).then((j) => setStaffList(j.staff ?? [])).catch(() => {});
    try { setStaffId(localStorage.getItem("orchestra-staff") ?? ""); } catch {}
  }, []);
  const signIn = (id: string) => { setStaffId(id); try { localStorage.setItem("orchestra-staff", id); } catch {} };

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/staff", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) { setProblem("The database isn't connected yet."); setCases([]); return; }
      setProblem(null);
      setCases(json.cases);
    } catch {
      setProblem("Couldn't reach the app's server.");
      setCases([]);
    }
  }, []);

  const open = useCallback(async (ref: string) => {
    setSelected(ref);
    setActError(null);
    setArming(null);
    setShow("summary");
    const res = await fetch(`/api/staff/${ref}`, { cache: "no-store" });
    if (res.ok) setDetail(await res.json());
  }, []);

  // A link from the Cases screen (/staff?case=ESC-…) opens that case.
  useEffect(() => {
    const ref = new URLSearchParams(window.location.search).get("case");
    if (ref && /^[A-Z]+-[0-9]+$/i.test(ref)) open(ref.toUpperCase());
  }, [open]);

  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 4000);
    const onReset = () => { setSelected(null); setDetail(null); load(); };
    window.addEventListener(RESET_EVENT, onReset);
    return () => { clearInterval(t); window.removeEventListener(RESET_EVENT, onReset); };
  }, [load]);

  async function act(decision: "approve" | "decline" | "resolve" | "claim_sent") {
    if (!selected) return;
    setBusy(true);
    setActError(null);
    try {
      const res = await fetch(`/api/staff/${selected}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note: note || undefined, staffId }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        const err = (json as { error?: string }).error;
        setActError(err === "already_decided" ? "This case has already been decided." : err === "supervisor_only" ? "Only a supervisor can approve or decline." : err === "sign_in" ? "Sign in as a staff member first." : "That didn't go through. Try again.");
      }
      setNote("");
      setArming(null);
      await Promise.all([load(), open(selected)]);
    } catch {
      setActError("Couldn't reach the app's server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  const c = detail?.case;
  const s = c?.summary;
  const pendingRecall = c?.status === "open" && c.action?.type === "recall";

  return (
    <div className="staff-grid">
      <section className="panel" aria-label="Open cases">
        <div className="panel-head" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
          <span className="panel-title">Cases</span>
          <label className="picker">
            <span className="label">Signed in as</span>
            <select value={staffId} onChange={(e) => signIn(e.target.value)} aria-label="Staff sign-in (simulated)">
              <option value="">Choose…</option>
              {staffList.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.role === "supervisor" ? "Supervisor" : "Support agent"}</option>)}
            </select>
          </label>
        </div>
        <div className="case-list">
          {problem && <div className="empty">{problem}</div>}
          {cases === null && <div className="empty">Loading cases…</div>}
          {cases && cases.length === 0 && !problem && <div className="empty">No open cases. Handoffs from Alexis will appear here.</div>}
          {cases?.map((k) => (
            <button key={k.reference} className="case-row" aria-current={selected === k.reference ? "true" : undefined} onClick={() => open(k.reference)}>
              <span className="case-top">
                <UrgencyChip urgency={k.urgency} />
                <span className="ref">{k.reference}</span>
                <span className="label">{age(k.created_at)}</span>
              </span>
              <span className="case-business">{k.business ?? "Identity not verified"}</span>
              <span className="label">{k.trigger}{k.status !== "open" ? ` · ${STATUS_WORD[k.status]}` : ""}</span>
            </button>
          ))}
        </div>
      </section>

      <section className="panel" aria-label="Case">
        {!c || !s ? (
          <div className="empty">Choose a case to see Alexis's handoff summary.</div>
        ) : (
          <>
            <div className="panel-head" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
              <span className="panel-title"><span className="ref">{c.reference}</span> · {s.why}</span>
              <span style={{ display: "flex", gap: 8 }}>
                <UrgencyChip urgency={c.urgency} />
                <StatusChip status={c.status === "open" ? (pendingRecall ? "Needs approval" : "In review") : STATUS_WORD[c.status]} />
              </span>
            </div>
            <div className="case-tabs">
              {(["summary", ...(detail.claim ? (["claim"] as const) : []), "assist", "transcript", "activity"] as const).map((v) => (
                <button key={v} className="tab" aria-current={show === v ? "page" : undefined} onClick={() => setShow(v)}>
                  {v === "summary" ? "Handoff summary" : v === "claim" ? "Claim draft" : v === "assist" ? "Ask Alexis" : v === "transcript" ? "Transcript" : "Activity log"}
                </button>
              ))}
            </div>
            <div className="case-body">
              {show === "summary" && (
                <dl className="summary">
                  <div><dt>Reference</dt><dd className="ref">{c.reference}</dd></div>
                  <div><dt>Urgency</dt><dd>{c.urgency.charAt(0).toUpperCase() + c.urgency.slice(1)}</dd></div>
                  <div><dt>Customer</dt><dd>{s.customer.business ? `${s.customer.business}; ${s.customer.user}, ${s.customer.role?.toLowerCase()}; identity ${s.customer.identity.toLowerCase()}` : "Identity not verified"}</dd></div>
                  <div><dt>Request</dt><dd>{s.request}</dd></div>
                  <div><dt>What Alexis checked</dt><dd>{s.checked}</dd></div>
                  <div><dt>What Alexis did</dt><dd>{s.did}</dd></div>
                  <div><dt>Why it was handed off</dt><dd>{s.why}</dd></div>
                  <div><dt>What is needed</dt><dd>{s.needed}</dd></div>
                  <div><dt>What the customer was told</dt><dd>{s.told}</dd></div>
                  <div><dt>Flags</dt><dd>{s.flags.join(", ")}</dd></div>
                  {c.action && <div><dt>Prepared action</dt><dd>Recall <span className="ref">{c.action.reference}</span> on <span className="ref">{c.action.payout}</span>, {c.action.amount}</dd></div>}
                  {c.resolution && <div><dt>Note</dt><dd>{c.resolution}</dd></div>}
                </dl>
              )}
              {show === "claim" && detail.claim && (
                <div className="claim">
                  <p className="label">Draft {detail.claim.reference} · {detail.claim.status === "sent" ? `sent ${new Date(detail.claim.sent_at!).toLocaleString("en-GB")}` : "not sent: review and edit before sending from your usual channel"}{detail.claim.deadline ? ` · filing deadline ${new Date(detail.claim.deadline).toLocaleDateString("en-GB", { day: "numeric", month: "long", year: "numeric" })}` : ""}</p>
                  {detail.claim.draft.missing.length > 0 && (
                    <div className="claim-missing" role="note">
                      <b>Missing or uncertain</b>
                      <ul>{detail.claim.draft.missing.map((m) => <li key={m}>{m}</li>)}</ul>
                    </div>
                  )}
                  <dl className="summary">
                    <div><dt>To</dt><dd>{detail.claim.draft.to}</dd></div>
                    <div><dt>Subject</dt><dd>{detail.claim.draft.subject}</dd></div>
                    {detail.claim.draft.facts.map(([k, v]) => <div key={k}><dt>{k}</dt><dd>{v}</dd></div>)}
                    <div><dt>Request</dt><dd>{detail.claim.draft.request}</dd></div>
                  </dl>
                  {detail.claim.draft.timeline.length > 0 && (
                    <>
                      <h3 className="claim-h">Timeline</h3>
                      <ul className="claim-list">{detail.claim.draft.timeline.map((t, i) => <li key={i}>{t.time}: {t.stage}, {t.status} (reported by {t.reported_by})</li>)}</ul>
                    </>
                  )}
                  <h3 className="claim-h">Evidence from the case</h3>
                  <ul className="claim-list">{detail.claim.draft.evidence.map((e, i) => <li key={i}>{e}</li>)}</ul>
                </div>
              )}
              {show === "assist" && (staff ? <AskAlexis caseRef={c.reference} staff={staff} /> : <div className="empty">Sign in as a staff member (top left) to ask Alexis about this case.</div>)}
              {show === "transcript" && (
                <div className="transcript">
                  {detail.transcript.map((m, i) => (
                    <p key={i}><b>{m.who}:</b> {m.text}</p>
                  ))}
                </div>
              )}
              {show === "activity" && (
                <div className="activity-list">
                  {detail.activity.map((r) => (
                    <div key={r.id} className={`row k-${r.kind}`}>
                      <div className="row-line">
                        <span className="row-time">{new Date(r.created_at).toLocaleTimeString("en-GB")}</span>
                        <span className="row-text">{r.summary}</span>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
            {c.status === "open" && (
              <div className="case-actions">
                {actError && <div className="case-error" role="alert">{actError}</div>}
                <input className="note" placeholder="Note (optional)" value={note} onChange={(e) => setNote(e.target.value)} aria-label="Note" />
                {pendingRecall && staff?.role !== "supervisor" && <span className="label">Only a supervisor can approve or decline this recall.</span>}
                {pendingRecall && staff?.role === "supervisor" && (
                  arming === "approve" ? (
                    <button className="btn btn-primary" disabled={busy} onClick={() => act("approve")}>Confirm approval</button>
                  ) : (
                    <button className="btn btn-primary" disabled={busy} onClick={() => setArming("approve")}>Approve</button>
                  )
                )}
                {pendingRecall && staff?.role === "supervisor" && (
                  arming === "decline" ? (
                    <button className="btn" disabled={busy} onClick={() => act("decline")}>Confirm decline</button>
                  ) : (
                    <button className="btn" disabled={busy} onClick={() => setArming("decline")}>Decline</button>
                  )
                )}
                {c.action?.type === "claim" && (
                  arming === "claim_sent" ? (
                    <button className="btn btn-primary" disabled={busy} onClick={() => act("claim_sent")}>Confirm it was sent</button>
                  ) : (
                    <button className="btn btn-primary" disabled={busy} onClick={() => setArming("claim_sent")}>Mark claim as sent</button>
                  )
                )}
                {!pendingRecall && c.action?.type !== "claim" && <button className="btn" disabled={busy} onClick={() => act("resolve")}>Mark resolved</button>}
                {arming && <button className="btn" onClick={() => setArming(null)}>Cancel</button>}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
