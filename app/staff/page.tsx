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
interface CaseDetail {
  case: CaseItem & { summary: Summary; respond_by: string | null; resolution: string | null; decided_at: string | null };
  transcript: { who: string; text: string }[];
  activity: { id: number; kind: string; summary: string; created_at: string }[];
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
  const [arming, setArming] = useState<"approve" | "decline" | null>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [actError, setActError] = useState<string | null>(null);
  const [show, setShow] = useState<"summary" | "transcript" | "activity">("summary");

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

  useEffect(() => {
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 4000);
    const onReset = () => { setSelected(null); setDetail(null); load(); };
    window.addEventListener(RESET_EVENT, onReset);
    return () => { clearInterval(t); window.removeEventListener(RESET_EVENT, onReset); };
  }, [load]);

  async function act(decision: "approve" | "decline" | "resolve") {
    if (!selected) return;
    setBusy(true);
    setActError(null);
    try {
      const res = await fetch(`/api/staff/${selected}`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ decision, note: note || undefined }),
      });
      if (!res.ok) {
        const json = await res.json().catch(() => ({}));
        setActError((json as { error?: string }).error === "already_decided" ? "This case has already been decided." : "That didn't go through. Try again.");
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
        <div className="panel-head"><span className="panel-title">Cases</span></div>
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
              {(["summary", "transcript", "activity"] as const).map((v) => (
                <button key={v} className="tab" aria-current={show === v ? "page" : undefined} onClick={() => setShow(v)}>
                  {v === "summary" ? "Handoff summary" : v === "transcript" ? "Transcript" : "Activity log"}
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
                {pendingRecall && (
                  arming === "approve" ? (
                    <button className="btn btn-primary" disabled={busy} onClick={() => act("approve")}>Confirm approval</button>
                  ) : (
                    <button className="btn btn-primary" disabled={busy} onClick={() => setArming("approve")}>Approve</button>
                  )
                )}
                {pendingRecall && (
                  arming === "decline" ? (
                    <button className="btn" disabled={busy} onClick={() => act("decline")}>Confirm decline</button>
                  ) : (
                    <button className="btn" disabled={busy} onClick={() => setArming("decline")}>Decline</button>
                  )
                )}
                {!pendingRecall && <button className="btn" disabled={busy} onClick={() => act("resolve")}>Mark resolved</button>}
                {arming && <button className="btn" onClick={() => setArming(null)}>Cancel</button>}
              </div>
            )}
          </>
        )}
      </section>
    </div>
  );
}
