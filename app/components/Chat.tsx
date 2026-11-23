"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GREETING, OPENERS } from "@/lib/greeting";
import { RESET_EVENT } from "./events";
import { drawSample, readImage, type Attachment, type Sample } from "./screenshots";

// ---------------------------------------------------------------- types

interface PickerUser { id: string; name: string; business: string; role: string; dob: string; registration: string }
interface Card {
  reference: string; amount: string; counterparty: string; route: string; status: string; date: string;
  stages: { label: string; state: "done" | "current" | "failed" | "todo" }[];
}
interface Handoff { reference: string; urgency: string; respond: string }
interface Proof { reference: string; payout: string; amount: string; currency: string; date: string; recipient: string; account: string; route: string; issued: string }
interface Msg {
  id: string;
  role: "alexis" | "customer";
  text: string;
  cards?: Card[];
  identity?: "open" | "sent";
  handoff?: Handoff;
  proof?: Proof;
  confirm?: { action: string; consequence: string; state: "open" | "answered" };
  code?: { sentTo: string; code: string; state: "open" | "sent"; retry?: boolean };
  update?: boolean;
  image?: string;
  thinking?: boolean;
  showLabel?: boolean;
}
interface ActivityRow {
  id: number; tool_use_id: string | null; kind: string; tool: string | null; summary: string;
  input: unknown; result: unknown; refusal_reason: string | null; approver: string | null; created_at: string;
}

const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
const greeting = (): Msg => ({ id: newId(), role: "alexis", text: GREETING, showLabel: true });

// ---------------------------------------------------------------- status chip

const CHIP: Record<string, { tone: string; icon: "check" | "clock" | "cross" | "pause" }> = {
  Successful: { tone: "ok", icon: "check" }, Approved: { tone: "ok", icon: "check" }, Credited: { tone: "ok", icon: "check" },
  Unallocated: { tone: "wait", icon: "clock" },
  Pending: { tone: "wait", icon: "clock" }, Processing: { tone: "wait", icon: "clock" }, "In review": { tone: "wait", icon: "clock" },
  Failed: { tone: "stop", icon: "cross" }, Reversed: { tone: "stop", icon: "cross" }, Blocked: { tone: "stop", icon: "cross" },
  Declined: { tone: "stop", icon: "cross" }, Resolved: { tone: "ok", icon: "check" },
  "On hold": { tone: "info", icon: "pause" }, "Needs approval": { tone: "info", icon: "pause" },
};

function Icon({ name }: { name: "check" | "clock" | "cross" | "pause" | "flag" }) {
  const p = { fill: "none", stroke: "currentColor", strokeWidth: 2, strokeLinecap: "round" as const, strokeLinejoin: "round" as const };
  return (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      {name === "check" && <path d="M3 8.5l3 3 7-7" {...p} />}
      {name === "clock" && (<><circle cx="8" cy="8" r="6" {...p} /><path d="M8 4.5V8l2.5 1.5" {...p} /></>)}
      {name === "cross" && <path d="M4 4l8 8M12 4l-8 8" {...p} />}
      {name === "pause" && <path d="M6 4v8M10 4v8" {...p} />}
      {name === "flag" && <path d="M4 14V2.5M4 3h7l-1.5 2.5L11 8H4" {...p} />}
    </svg>
  );
}

export function StatusChip({ status }: { status: string }) {
  const c = CHIP[status] ?? { tone: "grey", icon: "clock" as const };
  return (
    <span className={`chip chip-${c.tone}`}>
      <Icon name={c.icon} />
      {status}
    </span>
  );
}

export function UrgencyChip({ urgency }: { urgency: string }) {
  const tone = urgency === "urgent" ? "stop" : urgency === "high" ? "wait" : "grey";
  return (
    <span className={`chip chip-${tone}`}>
      <Icon name="flag" />
      {urgency.charAt(0).toUpperCase() + urgency.slice(1)}
    </span>
  );
}

// ---------------------------------------------------------------- pieces

/** Several possible matches: compact cards the customer clicks to choose (Design System). */
function ChoiceCard({ card, disabled, onChoose }: { card: Card; disabled: boolean; onChoose: () => void }) {
  return (
    <button className="card card-choice" disabled={disabled} onClick={onChoose} aria-label={`Choose ${card.amount} ${card.counterparty}, ${card.reference}`}>
      <span className="card-amount">{card.amount}</span>
      <span className="card-line">{card.counterparty} · {card.route}</span>
      <span className="card-row">
        <StatusChip status={card.status} />
        <span className="card-line">{card.date}</span>
        <span className="ref">{card.reference}</span>
      </span>
    </button>
  );
}

function PaymentCard({ card }: { card: Card }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="card">
      <div className="card-amount">{card.amount}</div>
      <div className="card-line">{card.counterparty} · {card.route}</div>
      <div className="card-row">
        <StatusChip status={card.status} />
        <span className="card-line">{card.date}</span>
        <span className="ref">
          {card.reference}
          <button
            className="copy"
            onClick={() => {
              navigator.clipboard?.writeText(card.reference).catch(() => {});
              setCopied(true);
              setTimeout(() => setCopied(false), 1200);
            }}
            aria-label={`Copy reference ${card.reference}`}
          >
            {copied ? "Copied" : "Copy"}
          </button>
        </span>
      </div>
      {card.stages.length > 0 && (
        <ol className="timeline" aria-label="Payout stages">
          {card.stages.map((s) => (
            <li key={s.label} className={`tl-step ${s.state}`}>
              <span className="tl-dot">{s.state === "failed" ? "✕" : ""}</span>
              <span className="tl-label">
                {s.label}
                <span className="sr-only"> ({s.state === "current" ? "current stage" : s.state})</span>
              </span>
            </li>
          ))}
        </ol>
      )}
    </div>
  );
}

function ProofCard({ proof, conversationId }: { proof: Proof; conversationId: string }) {
  const rows: [string, string][] = [
    ["Recipient", proof.recipient],
    ["Account", proof.account],
    ["Date delivered", proof.date],
    ["Payout reference", proof.payout],
    ["Route", proof.route],
  ];
  return (
    <div className="card proof">
      <div className="proof-mark" aria-hidden="true">Simulated document</div>
      <div className="label">Payment confirmation · <span className="ref">{proof.reference}</span></div>
      <div className="card-amount">{proof.amount}</div>
      <dl className="proof-fields">
        {rows.map(([k, v]) => (
          <div key={k}><dt>{k}</dt><dd>{v}</dd></div>
        ))}
      </dl>
      <span className="sr-only">Simulated document.</span>
      <a className="btn btn-primary" href={`/api/proof?ref=${proof.reference}&conversation=${conversationId}`} download>
        Download PDF
      </a>
    </div>
  );
}

function CodeForm({ disabled, retry, onSubmit }: { disabled: boolean; retry: boolean; onSubmit: (code: string) => void }) {
  const [code, setCode] = useState("");
  return (
    <form className="form" autoComplete="off" onSubmit={(e) => { e.preventDefault(); onSubmit(code); setCode(""); }}>
      <label>
        {retry ? "That code didn't match. Enter the code again" : "Enter the code we sent"}
        <input inputMode="numeric" pattern="[0-9 ]*" maxLength={8} value={code} onChange={(e) => setCode(e.target.value)} required disabled={disabled} />
      </label>
      <button className="btn btn-primary" type="submit" disabled={disabled}>Confirm code</button>
    </form>
  );
}

function IdentityForm({ disabled, onSubmit }: { disabled: boolean; onSubmit: (a: { full_name: string; date_of_birth: string; registration_number: string }) => void }) {
  const [full_name, setName] = useState("");
  const [date_of_birth, setDob] = useState("");
  const [registration_number, setReg] = useState("");
  return (
    <form
      className="form"
      autoComplete="off"
      onSubmit={(e) => {
        e.preventDefault();
        onSubmit({ full_name, date_of_birth, registration_number });
        setName(""); setDob(""); setReg("");
      }}
    >
      <label>Full name<input value={full_name} onChange={(e) => setName(e.target.value)} required disabled={disabled} /></label>
      <label>Date of birth<input type="date" value={date_of_birth} onChange={(e) => setDob(e.target.value)} required disabled={disabled} /></label>
      <label>Business registration number, or for a personal account the last 4 digits of the account number<input value={registration_number} onChange={(e) => setReg(e.target.value)} required disabled={disabled} /></label>
      <button className="btn btn-primary" type="submit" disabled={disabled}>Confirm</button>
    </form>
  );
}

interface OutboxMsg { id: number; channel: string; sent_to: string; body: string; sent_at: string }

/** Use case 17: the messages sent to this customer's phone on file (simulated). */
function Outbox({ messages }: { messages: OutboxMsg[] }) {
  return (
    <div className="activity-list" aria-live="polite">
      {messages.length === 0 && (
        <div className="empty">Status updates Alexis sends to this customer's phone on file appear here: when a reversal, dispute, recall or case they're waiting on changes, or runs late.</div>
      )}
      {messages.map((m) => (
        <div key={m.id} className="sms outbox-msg">
          <span className="label">{m.channel} to {m.sent_to} · {new Date(m.sent_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
          <span>{m.body}</span>
        </div>
      ))}
    </div>
  );
}

function Activity({ rows, running, onClose, outbox }: { rows: ActivityRow[]; running: { id: string; name: string }[]; onClose?: () => void; outbox: OutboxMsg[] }) {
  const [tab, setTab] = useState<"activity" | "outbox">("activity");
  const listRef = useRef<HTMLDivElement>(null);
  useEffect(() => {
    listRef.current?.scrollTo({ top: listRef.current.scrollHeight, behavior: "smooth" });
  }, [rows.length, running.length]);
  const lookups = rows.filter((r) => r.kind === "lookup" || r.kind === "rule" || r.kind === "identity").length;
  const actions = rows.filter((r) => r.kind === "action" || r.kind === "handoff" || r.kind === "approval").length;
  const refusals = rows.filter((r) => r.kind === "refusal").length;
  const doneIds = new Set(rows.map((r) => r.tool_use_id));
  return (
    <section className="panel activity" aria-label="What Alexis is doing">
      <div className="panel-head" style={{ justifyContent: "space-between", flexWrap: "wrap" }}>
        <span className="case-tabs" style={{ padding: 0 }}>
          <button className="tab" aria-current={tab === "activity" ? "page" : undefined} onClick={() => setTab("activity")}>What Alexis is doing</button>
          <button className="tab" aria-current={tab === "outbox" ? "page" : undefined} onClick={() => setTab("outbox")}>
            Messages to the customer{outbox.length ? ` (${outbox.length})` : ""}
          </button>
        </span>
        <span className="counter">
          <span><b>{lookups}</b> lookups</span><span><b>{actions}</b> actions</span><span><b>{refusals}</b> refusals</span>
        </span>
        {onClose && <button className="btn" onClick={onClose}>Back to chat</button>}
      </div>
      {tab === "outbox" ? <Outbox messages={outbox} /> : <div className="activity-list" ref={listRef} aria-live="polite">
        {rows.length === 0 && running.length === 0 && <div className="empty">Each lookup, refusal and action appears here as Alexis works.</div>}
        {rows.map((r) => {
          const time = new Date(r.created_at).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit" });
          const detail = r.input || r.result || r.refusal_reason ? JSON.stringify({ asked: r.input ?? undefined, returned: r.result ?? undefined, refusal: r.refusal_reason ?? undefined }, null, 2) : null;
          return (
            <details key={r.id} className={`row k-${r.kind}`}>
              <summary>
                <span className="row-time">{time}</span>
                <span className="row-text">{r.summary}</span>
              </summary>
              {detail ? <pre>{detail}</pre> : <pre>No further detail.</pre>}
            </details>
          );
        })}
        {running.filter((t) => !doneIds.has(t.id)).map((t) => (
          <div key={t.id} className="row k-lookup">
            <div className="row-line"><span className="spinner" aria-hidden="true" /><span className="row-text">{t.name} · running</span></div>
          </div>
        ))}
      </div>}
    </section>
  );
}

// ---------------------------------------------------------------- the screen

export default function Chat() {
  const [users, setUsers] = useState<PickerUser[]>([]);
  const [setupProblem, setSetupProblem] = useState<string | null>(null);
  const [typingUserId, setTypingUserId] = useState<string>("ada");
  const [conversationId, setConversationId] = useState<string>(() => newId());
  const [messages, setMessages] = useState<Msg[]>(() => [greeting()]);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [outbox, setOutbox] = useState<OutboxMsg[]>([]);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [rows, setRows] = useState<ActivityRow[]>([]);
  const [running, setRunning] = useState<{ id: string; name: string }[]>([]);
  const [view, setView] = useState<"chat" | "activity">("chat");
  const lastRowId = useRef(0);
  const messagesRef = useRef<HTMLDivElement>(null);
  const convRef = useRef(conversationId);
  convRef.current = conversationId;

  const loadUsers = useCallback(async () => {
    try {
      const res = await fetch("/api/users", { cache: "no-store" });
      const json = await res.json();
      if (!res.ok) {
        setSetupProblem(json.error === "not_configured" ? "The database isn't connected yet: add DATABASE_URL in Vercel's settings." : json.message ?? "Couldn't load the sample users.");
        return;
      }
      setSetupProblem(null);
      setUsers(json.users);
    } catch {
      setSetupProblem("Couldn't reach the app's server.");
    }
  }, []);

  useEffect(() => { loadUsers(); }, [loadUsers]);
  // Proactive updates: poll this customer's simulated phone (also runs the watches on the server).
  useEffect(() => {
    let live = true;
    const load = () =>
      fetch(`/api/outbox?user=${typingUserId}`, { cache: "no-store" })
        .then((r) => r.json())
        .then((j) => { if (live) setOutbox(j.messages ?? []); })
        .catch(() => {});
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 5000);
    return () => { live = false; clearInterval(t); };
  }, [typingUserId]);
  useEffect(() => {
    fetch("/api/samples", { cache: "no-store" }).then((r) => r.json()).then((j) => setSamples(j.samples ?? [])).catch(() => {});
  }, []);

  const startOver = useCallback(() => {
    setConversationId(newId());
    setMessages([greeting()]);
    setRows([]);
    setRunning([]);
    lastRowId.current = 0;
  }, []);

  useEffect(() => {
    const onReset = () => { startOver(); loadUsers(); };
    window.addEventListener(RESET_EVENT, onReset);
    return () => window.removeEventListener(RESET_EVENT, onReset);
  }, [startOver, loadUsers]);

  // The activity panel: poll the audit log, quickly while Alexis is working.
  const polling = useRef(false);
  const pollActivity = useCallback(async () => {
    if (polling.current) return; // one request at a time, so rows never arrive twice
    polling.current = true;
    const id = convRef.current;
    try {
      const res = await fetch(`/api/activity?conversation=${id}&after=${lastRowId.current}`, { cache: "no-store" });
      const json = (await res.json()) as { rows: ActivityRow[] };
      if (id !== convRef.current || !json.rows?.length) return;
      lastRowId.current = Math.max(lastRowId.current, json.rows[json.rows.length - 1].id);
      setRows((r) => {
        const seen = new Set(r.map((x) => x.id));
        return [...r, ...json.rows.filter((x) => !seen.has(x.id))];
      });
      // A decision by the support team closes the loop in the conversation too.
      const updates = json.rows.filter((x) => x.approver && (x.result as { message?: string } | null)?.message);
      if (updates.length) {
        setMessages((ms) => {
          const have = new Set(ms.map((m) => m.id));
          const add = updates
            .filter((u) => !have.has(`update-${u.id}`))
            .map((u) => ({ id: `update-${u.id}`, role: "alexis" as const, text: `Update from the team: ${(u.result as { message: string }).message}`, update: true, showLabel: true }));
          return add.length ? [...ms, ...add] : ms;
        });
      }
    } catch {
    } finally {
      polling.current = false;
    }
  }, []);

  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") pollActivity(); }, busy ? 700 : 3000);
    return () => clearInterval(t);
  }, [busy, pollActivity]);

  useEffect(() => {
    messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" });
  }, [messages]);

  /** Update the Alexis message currently being written. */
  const patchLast = (fn: (m: Msg) => Msg) =>
    setMessages((ms) => {
      const i = ms.length - 1;
      if (i < 0 || ms[i].role !== "alexis") return ms;
      const copy = ms.slice();
      copy[i] = fn(copy[i]);
      return copy;
    });

  async function send(body: { message?: string; confirm?: boolean; code?: string; image?: { media_type: string; data: string }; identity?: { full_name: string; date_of_birth: string; registration_number: string } }, shown: string, imagePreview?: string) {
    if (busy) return;
    setBusy(true);
    setMessages((ms) => [
      ...ms.map((m) => {
        let x = m;
        if (x.identity === "open") x = { ...x, identity: "sent" as const };
        if (x.confirm?.state === "open") x = { ...x, confirm: { ...x.confirm, state: "answered" as const } };
        if (x.code?.state === "open") x = { ...x, code: { ...x.code, state: "sent" as const } };
        return x;
      }),
      { id: newId(), role: "customer", text: shown, image: imagePreview },
      { id: newId(), role: "alexis", text: "", thinking: true, showLabel: true },
    ]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, typingUserId, ...body }),
      });
      if (!res.ok || !res.body) {
        const json = await res.json().catch(() => ({}));
        const missing = (json as { missing?: string[] }).missing;
        patchLast((m) => ({
          ...m, thinking: false,
          text: missing?.length
            ? `Setup isn't finished: ${missing.join(" and ")} ${missing.length > 1 ? "are" : "is"} missing in Vercel's settings.`
            : "Something went wrong on my side and I couldn't complete that. Please try again in a moment.",
        }));
        return;
      }
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let buf = "";
      for (;;) {
        const { value, done } = await reader.read();
        if (done) break;
        buf += decoder.decode(value, { stream: true });
        let nl: number;
        while ((nl = buf.indexOf("\n")) >= 0) {
          const line = buf.slice(0, nl).trim();
          buf = buf.slice(nl + 1);
          if (!line) continue;
          const e = JSON.parse(line);
          switch (e.type) {
            case "text": patchLast((m) => ({ ...m, thinking: false, text: m.text + e.delta })); break;
            case "break": patchLast((m) => ({ ...m, text: m.text ? m.text + "\n\n" : m.text })); break;
            case "tool_start": setRunning((r) => [...r, { id: e.id, name: e.name }]); break;
            case "tool_end": pollActivity(); break;
            case "card": patchLast((m) => (m.proof ? m : { ...m, cards: e.cards })); break;
            case "identity_form": patchLast((m) => ({ ...m, identity: "open" })); break;
            case "masked":
              // Show the customer that the secret was removed, as it was in the stored transcript.
              setMessages((ms) => {
                const i = ms.map((x) => x.role).lastIndexOf("customer");
                if (i < 0) return ms;
                const copy = ms.slice();
                copy[i] = { ...copy[i], text: e.text };
                return copy;
              });
              break;
            case "code_form": patchLast((m) => ({ ...m, code: { sentTo: e.sentTo, code: e.code, state: "open" } })); break;
            case "code_retry":
              // Wrong code: reopen the form on the message that showed it, and drop the empty reply.
              setMessages((ms) => {
                const copy = ms.slice(0, -1);
                const i = copy.map((x) => Boolean(x.code)).lastIndexOf(true);
                if (i >= 0) copy[i] = { ...copy[i], code: { ...copy[i].code!, state: "open", retry: true } };
                return copy;
              });
              break;
            case "confirm": patchLast((m) => ({ ...m, confirm: { action: e.action, consequence: e.consequence, state: "open" } })); break;
            case "proof": patchLast((m) => ({ ...m, proof: e.proof, cards: undefined })); break; // one card per reply
            case "handoff": patchLast((m) => ({ ...m, handoff: { reference: e.reference, urgency: e.urgency, respond: e.respond } })); break;
            case "error": patchLast((m) => ({ ...m, thinking: false, text: (m.text ? m.text + "\n\n" : "") + e.message })); break;
          }
        }
      }
    } catch {
      patchLast((m) => ({ ...m, thinking: false, text: (m.text ? m.text + "\n\n" : "") + "Something went wrong on my side and I couldn't complete that. Please try again in a moment." }));
    } finally {
      patchLast((m) => ({ ...m, thinking: false }));
      setBusy(false);
      setRunning([]);
      pollActivity();
    }
  }

  const submit = () => {
    const text = draft.trim();
    if (!text && !attachment) return;
    const a = attachment;
    setDraft("");
    setAttachment(null);
    send({ message: text, ...(a ? { image: { media_type: a.media_type, data: a.data } } : {}) }, text, a?.preview);
  };

  async function attachFile(file: File | undefined) {
    setAttachError(null);
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) { setAttachError("Attach a PNG, JPEG, WebP or GIF image."); return; }
    try {
      setAttachment(await readImage(file));
    } catch {
      setAttachError("That image couldn't be read.");
    }
  }

  const selected = users.find((u) => u.id === typingUserId);
  const empty = messages.length === 1;

  return (
    <div className="chat-grid" data-view={view}>
      <div className="mobile-tabs" role="tablist">
        <button className="btn" aria-pressed={view === "chat"} onClick={() => setView("chat")}>Conversation</button>
        <button className="btn" aria-pressed={view === "activity"} onClick={() => setView("activity")}>What Alexis is doing</button>
      </div>

      <section className="panel conversation" aria-label="Conversation">
        <div className="panel-head conv-head">
          <div className="alexis-id">
            <div className="avatar" aria-hidden="true">A</div>
            <div>
              <div className="panel-title">Alexis</div>
              <div className="label">AI support assistant</div>
            </div>
          </div>
          <div>
            <label className="picker">
              <span className="label">Chatting as</span>
              <select
                value={typingUserId}
                onChange={(e) => { setTypingUserId(e.target.value); startOver(); }}
                disabled={busy}
              >
                {users.length === 0 && <option value="ada">Ada Okafor</option>}
                {users.map((u) => (
                  <option key={u.id} value={u.id}>{u.name} · {u.role === "Personal" ? "Personal account" : `${u.business} · ${u.role}`}</option>
                ))}
              </select>
            </label>
            {selected && (
              <div className="picker-hint" title="The details this sample user gives at the identity check">
                Identity check: {selected.name} · born {selected.dob} · {selected.registration}
              </div>
            )}
          </div>
        </div>

        <div className="messages" ref={messagesRef} aria-live="polite">
          {setupProblem && <div className="msg msg-alexis" role="alert">{setupProblem}</div>}
          {messages.map((m) => (
            <div key={m.id} className={`msg msg-${m.role}${m.update ? " update" : ""}`}>
              {m.role === "alexis" && m.showLabel && <div className="msg-meta">Alexis · AI</div>}
              {m.image && <img className="msg-image" src={m.image} alt="Screenshot sent by the customer" />}
              {m.thinking && !m.text ? (
                <span className="dots" aria-label="Alexis is thinking"><span /><span /><span /></span>
              ) : (
                m.text
              )}
              {m.cards && m.cards.length > 1
                ? m.cards.map((c) => (
                    <ChoiceCard
                      key={c.reference}
                      card={c}
                      disabled={busy || m.id !== messages[messages.length - 1]?.id}
                      onChoose={() => {
                        const text = `This one: ${c.amount}, ${c.counterparty.replace(/^From /, "from ")}, ${c.reference}`;
                        send({ message: text }, text);
                      }}
                    />
                  ))
                : m.cards?.map((c) => <PaymentCard key={c.reference} card={c} />)}
              {m.code && (
                <div className="code-box">
                  <div className="sms" aria-label="Simulated text message">
                    <span className="label">Simulated text message to {m.code.sentTo}</span>
                    <span>Your verification code is <b className="ref">{m.code.code}</b>. Never share it with anyone.</span>
                  </div>
                  <CodeForm disabled={m.code.state !== "open" || busy} retry={Boolean(m.code.retry)} onSubmit={(code) => send({ code }, "Code entered")} />
                </div>
              )}
              {m.confirm && (
                <div className="confirm">
                  <div className="confirm-action">{m.confirm.action}</div>
                  <div className="card-line">{m.confirm.consequence}</div>
                  <div className="confirm-buttons">
                    <button className="btn btn-primary" disabled={m.confirm.state !== "open" || busy} onClick={() => send({ message: "Yes, go ahead", confirm: true }, "Yes, go ahead")}>Yes, go ahead</button>
                    <button className="btn" disabled={m.confirm.state !== "open" || busy} onClick={() => send({ message: "Cancel", confirm: false }, "Cancel")}>Cancel</button>
                  </div>
                </div>
              )}
              {m.proof && <ProofCard proof={m.proof} conversationId={conversationId} />}
              {m.identity && (
                <IdentityForm
                  disabled={m.identity === "sent" || busy}
                  onSubmit={(a) => send({ identity: a }, "Identity details submitted")}
                />
              )}
              {m.handoff && (
                <div className="handoff">
                  <strong>Passed to the team</strong>
                  <span className="ref">{m.handoff.reference}</span> · <UrgencyChip urgency={m.handoff.urgency} />
                  <div className="card-line">Expect a response {m.handoff.respond}.</div>
                </div>
              )}
            </div>
          ))}
          {empty && (
            <div className="openers">
              {OPENERS.map((o) => (
                <button key={o} className="btn" onClick={() => send({ message: o }, o)} disabled={busy}>{o}</button>
              ))}
            </div>
          )}
        </div>

        <form className="composer" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <label className="sr-only" htmlFor="message">Message</label>
          <textarea
            id="message"
            className="ph-sensitive"
            rows={1}
            value={draft}
            placeholder="Type a message"
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); }
            }}
          />
          <button className="btn btn-primary" type="submit" disabled={busy || (!draft.trim() && !attachment)}>Send</button>
        </form>
        <div className="attach-bar">
          <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { attachFile(e.target.files?.[0]); e.target.value = ""; }} />
          <button className="btn" type="button" onClick={() => fileRef.current?.click()} disabled={busy}>Attach screenshot</button>
          {samples.length > 0 && (
            <select
              aria-label="Attach a sample screenshot"
              value=""
              disabled={busy}
              onChange={(e) => { const sm = samples.find((x) => x.id === e.target.value); if (sm) setAttachment(drawSample(sm)); }}
            >
              <option value="">Sample screenshots…</option>
              {samples.map((sm) => <option key={sm.id} value={sm.id}>{sm.label}</option>)}
            </select>
          )}
          {attachment && (
            <span className="attach-chip">
              <img src={attachment.preview} alt="" />
              {attachment.name}
              <button className="copy" type="button" onClick={() => setAttachment(null)} aria-label="Remove the screenshot">Remove</button>
            </span>
          )}
          {attachError && <span className="rule-error" role="alert">{attachError}</span>}
        </div>
      </section>

      <Activity rows={rows} running={running} outbox={outbox} />
    </div>
  );
}
