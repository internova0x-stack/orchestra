"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GREETINGS, LANGUAGE_NAMES, OPENERS_BY_LANGUAGE } from "@/lib/greeting";
import { RESET_CHANNEL } from "./events";
import { drawSample, readImage, type Attachment, type Sample } from "./screenshots";
import { ChoiceCard, CodeForm, IdentityForm, PaymentCard, ProofCard, UrgencyChip, applyEvent, closeForms, mergeView, takeoverNotice, type Msg, type TeamView } from "./chatParts";

export { StatusChip, UrgencyChip } from "./chatParts";

// ---------------------------------------------------------------- types

interface PickerUser { id: string; name: string; business: string; role: string; dob: string; registration: string }
/** Someone who paid a merchant at checkout and has no account (a payment company's customer's customer). */
interface PickerPayer { id: string; name: string; scene: string; merchant: string; paid: string; details: string[]; session: string | null }
const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);
/** The bank's support address in the simulated email channel (an invented domain). */
const SUPPORT_EMAIL = "support@yourbank.example";
type Channel = "app" | "whatsapp" | "email";

const greeting = (lang = "en"): Msg => ({ id: newId(), role: "alexis", text: GREETINGS[lang] ?? GREETINGS.en, showLabel: true });

interface OutboxMsg { id: number; channel: string; sent_to: string; body: string; sent_at: string; conversation_id?: string | null }

/** Use case 17: the messages sent to this customer's phone on file (simulated). */
function Outbox({ messages, onOpen }: { messages: OutboxMsg[]; onOpen: (m: OutboxMsg) => void }) {
  return (
    <div className="activity-list" aria-live="polite">
      {messages.length === 0 && (
        <div className="empty">Status updates Alexis sends to this customer's phone on file appear here: when a reversal, dispute, recall or case they're waiting on changes, or runs late.</div>
      )}
      {messages.map((m) => (
        <div key={m.id} className="sms outbox-msg">
          <span className="label">{m.channel} to {m.sent_to} · {new Date(m.sent_at).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}</span>
          <span>{m.body}</span>
          {m.conversation_id && <button className="btn" onClick={() => onOpen(m)}>Reply in the app</button>}
        </div>
      ))}
    </div>
  );
}

// ---------------------------------------------------------------- the screen

/** The customer app: a banking app's support chat, in a phone frame. The bank's side is the console. */
export default function Chat() {
  const [users, setUsers] = useState<PickerUser[]>([]);
  const [payers, setPayers] = useState<PickerPayer[]>([]);
  const [setupProblem, setSetupProblem] = useState<string | null>(null);
  const [typingUserId, setTypingUserId] = useState<string>("ada");
  const [conversationId, setConversationId] = useState<string>(() => newId());
  // Simulated channels (Tomi, Nov 23): the bank's app chat, WhatsApp or email. Each is its own conversation.
  const [channel, setChannel] = useState<Channel>("app");
  const [subject, setSubject] = useState("");
  const [language, setLanguage] = useState("en");
  const languageRef = useRef("en");
  languageRef.current = language;
  const [status, setStatus] = useState<{ alexisOn: boolean; outage: string | null }>({ alexisOn: true, outage: null });
  const [messages, setMessages] = useState<Msg[]>(() => [greeting()]);
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const [outbox, setOutbox] = useState<OutboxMsg[]>([]);
  const [samples, setSamples] = useState<Sample[]>([]);
  const [attachError, setAttachError] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const [takenOverBy, setTakenOverBy] = useState<string | null>(null);
  const [showTexts, setShowTexts] = useState(false);
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
      setPayers(json.payers ?? []);
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
  // The service status: an outage notice, and whether Alexis is answering.
  useEffect(() => {
    const load = () => fetch("/api/status", { cache: "no-store" }).then((r) => r.json()).then(setStatus).catch(() => {});
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 15_000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => {
    fetch("/api/samples", { cache: "no-store" }).then((r) => r.json()).then((j) => setSamples(j.samples ?? [])).catch(() => {});
  }, []);

  // Proactive failure messages (lib/proactive.ts): open the conversation Alexis started, to reply to it.
  const [dismissed, setDismissed] = useState<string[]>([]);
  const openAlert = useCallback((m: OutboxMsg) => {
    if (!m.conversation_id) return;
    setChannel("app");
    setConversationId(m.conversation_id);
    setMessages([{ id: `alert-${m.id}`, role: "alexis", text: m.body, showLabel: true }]);
    setTakenOverBy(null);
    setDismissed((d) => [...d, m.conversation_id!]);
  }, []);
  const [failures, setFailures] = useState<{ id: string; user: string; label: string }[]>([]);
  const [failureNote, setFailureNote] = useState<string | null>(null);
  useEffect(() => {
    fetch("/api/demo/failure", { cache: "no-store" }).then((r) => r.json()).then((j) => setFailures(j.scenarios ?? [])).catch(() => {});
  }, []);
  async function simulateFailure(id: string) {
    setFailureNote(null);
    try {
      const r = await fetch("/api/demo/failure", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ scenario: id }) }).then((x) => x.json());
      const why: Record<string, string> = {
        switched_off: "No message: proactive messages for this are switched off on the Rules screen.",
        review_hold: "No message: the customer is on a review hold.", fraud: "No message: possible fraud is never messaged automatically.",
        duplicate: "No message: the customer was already told about this payment (Reset demo to try again).",
        daily_cap: "No message: the customer has had today's maximum.", no_phone: "No message: no phone on file.",
        not_found: "That record isn't on this customer's account.", not_messaged: "No message for this kind of failure.",
      };
      setFailureNote(r.sent ? (r.heldUntil ? `Held for quiet hours: it goes out at ${new Date(r.heldUntil).toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })} (change quiet hours on the Rules screen).` : "Sent: it's on the customer's phone now.") : why[r.why] ?? "No message.");
      const j = await fetch(`/api/outbox?user=${typingUserId}`, { cache: "no-store" }).then((x) => x.json());
      setOutbox(j.messages ?? []);
    } catch {
      setFailureNote("Couldn't reach the app's server.");
    }
  }

  const startOver = useCallback((ch?: Channel) => {
    setConversationId(newId());
    // An email starts with the customer writing in; the chats open with Alexis's greeting.
    setMessages((ch ?? channelRef.current) === "email" ? [] : [greeting(languageRef.current)]);
    setTakenOverBy(null);
    setSubject("");
  }, []);
  const channelRef = useRef<Channel>("app");
  channelRef.current = channel;

  // Reset demo in the console (another tab or window) starts this chat over too.
  useEffect(() => {
    let ch: BroadcastChannel | null = null;
    try {
      ch = new BroadcastChannel(RESET_CHANNEL);
      ch.onmessage = () => { startOver(); loadUsers(); };
    } catch {}
    return () => ch?.close();
  }, [startOver, loadUsers]);

  // While the chat is open: whether a member of the team has joined, their replies, and the team's
  // decisions on this customer's cases. The customer never sees the bank's activity log.
  const polling = useRef(false);
  const pollConversation = useCallback(async () => {
    if (polling.current) return;
    polling.current = true;
    const id = convRef.current;
    try {
      const res = await fetch(`/api/conversation/${id}`, { cache: "no-store" });
      const j = (await res.json()) as TeamView;
      if (id !== convRef.current) return;
      setTakenOverBy((was) => {
        const text = takeoverNotice(was, j.takenOverBy);
        if (text) setMessages((ms) => [...ms, { id: newId(), role: "notice", text }]);
        return j.takenOverBy;
      });
      setMessages((ms) => mergeView(ms, j));
    } catch {
    } finally {
      polling.current = false;
    }
  }, []);

  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") pollConversation(); }, 2500);
    return () => clearInterval(t);
  }, [pollConversation]);

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
      ...closeForms(ms),
      { id: newId(), role: "customer", text: shown, image: imagePreview },
      { id: newId(), role: "alexis", text: "", thinking: true, showLabel: true },
    ]);
    try {
      const res = await fetch("/api/chat", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ conversationId, typingUserId: typingUserId.startsWith("payer:") ? null : typingUserId, channel, language, ...(channel === "email" && subject.trim() ? { subject: subject.trim() } : {}), ...body }),
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
          setMessages((ms) => applyEvent(ms, e));
          if (e.type === "taken_over") pollConversation();
        }
      }
    } catch {
      patchLast((m) => ({ ...m, thinking: false, text: (m.text ? m.text + "\n\n" : "") + "Something went wrong on my side and I couldn't complete that. Please try again in a moment." }));
    } finally {
      patchLast((m) => ({ ...m, thinking: false }));
      setBusy(false);
      pollConversation();
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
  const payer = payers.find((p) => p.id === typingUserId);
  const empty = messages.length === 1 && channel !== "email";
  const firstEmail = channel === "email" && !messages.some((m) => m.role === "customer");
  const who = (m: Msg) => (m.staff ? `${m.staff} · Support team` : channel === "email" ? "Alexis, AI support assistant" : "Alexis · AI");

  return (
    <div className="customer-page">
      <div className="banner" role="note">Prototype - simulated data · the customer's side</div>
      <div className="customer-stage">
        <aside className="tester panel" aria-label="Tester controls">
          <div className="panel-head"><span className="panel-title">Playing the customer</span></div>
          <div className="tester-body">
            <p className="label">This is what a bank's customer sees in their app. Messages arrive in the bank's support console, where the team can watch Alexis and take over.</p>
            <label className="tester-field">
              <span className="label">Customer</span>
              <select value={typingUserId} onChange={(e) => { setTypingUserId(e.target.value); startOver(); }} disabled={busy}>
                {users.length === 0 && <option value="ada">Ada Okafor</option>}
                <optgroup label="Account holders">
                  {users.map((u) => (
                    <option key={u.id} value={u.id}>{u.name} · {u.role === "Personal" ? "Personal account" : `${u.business} · ${u.role}`}</option>
                  ))}
                </optgroup>
                {payers.length > 0 && (
                  <optgroup label="Paid a merchant (no account)">
                    {payers.map((p) => <option key={p.id} value={p.id}>{p.name} · {p.scene}</option>)}
                  </optgroup>
                )}
              </select>
            </label>
            {payer && (
              <div className="tester-id">
                <span className="label">What's on their receipt (Alexis checks it)</span>
                <span>Paid {payer.paid} to {payer.merchant}</span>
                {payer.details.map((d) => <span key={d}>{d}</span>)}
                {payer.session && <span>session ID {payer.session}</span>}
              </div>
            )}
            {selected && (
              <div className="tester-id">
                <span className="label">Answers for the identity check</span>
                <span>{selected.name}</span>
                <span>Born {selected.dob}</span>
                <span>{selected.registration}</span>
              </div>
            )}
            <label className="tester-field">
              <span className="label">Language</span>
              <select value={language} disabled={busy} onChange={(e) => {
                const lang = e.target.value;
                setLanguage(lang);
                languageRef.current = lang;
                // Before the customer writes, the greeting follows the language.
                setMessages((ms) => (ms.length === 1 && ms[0].role === "alexis" && !ms[0].staff ? [greeting(lang)] : ms));
              }}>
                {LANGUAGE_NAMES.map(([id, name]) => <option key={id} value={id}>{name}</option>)}
              </select>
            </label>
            <div className="tester-field">
              <span className="label">Channel</span>
              <div className="segmented" role="radiogroup" aria-label="Channel">
                {(["app", "whatsapp", "email"] as Channel[]).map((c) => (
                  <button key={c} className="btn" role="radio" aria-checked={channel === c} disabled={busy}
                    onClick={() => { if (c !== channel) { setChannel(c); startOver(c); } }}>
                    <ChannelIcon channel={c} />{c === "app" ? "App chat" : c === "whatsapp" ? "WhatsApp" : "Email"}
                  </button>
                ))}
              </div>
            </div>
            <button className="btn" onClick={() => startOver()} disabled={busy}>Start a new conversation</button>
            <button className="btn" onClick={() => setShowTexts((v) => !v)} aria-expanded={showTexts}>
              Text messages to this customer ({outbox.length})
            </button>
            {showTexts && <Outbox messages={outbox} onOpen={openAlert} />}
            {failures.some((f) => f.user === typingUserId) && (
              <div className="tester-field">
                <span className="label">Play the bank: a payment fails</span>
                {failures.filter((f) => f.user === typingUserId).map((f) => (
                  <button key={f.id} className="btn" onClick={() => simulateFailure(f.id)} disabled={busy}>{f.label}</button>
                ))}
                {failureNote && <span className="label" role="status">{failureNote}</span>}
              </div>
            )}
          </div>
        </aside>

        <section className={`phone phone-${channel}`} aria-label={channel === "app" ? "Customer app" : channel === "whatsapp" ? "WhatsApp" : "Email"}>
          <div className="phone-head">
            <div className="avatar" aria-hidden="true">{takenOverBy ? takenOverBy.charAt(0) : channel === "email" ? "@" : "A"}</div>
            <div>
              <div className="panel-title">{channel === "email" ? "Email to support" : takenOverBy ?? "Alexis"}</div>
              <div className="label">
                {channel === "email" ? `${SUPPORT_EMAIL}${takenOverBy ? ` · ${takenOverBy} is replying` : ""}`
                  : channel === "whatsapp" ? (takenOverBy ? "Support team · WhatsApp" : "AI support assistant · WhatsApp business account")
                  : takenOverBy ? "Support team" : "AI support assistant"}
              </div>
            </div>
            <span className="phone-title label">{channel === "app" ? "Help & support" : channel === "whatsapp" ? "WhatsApp" : "Mail"}</span>
          </div>

        {status.outage && <div className="service-notice" role="status"><b>Service notice</b> {status.outage}</div>}
        {(() => {
          // A new failure alert from the bank: the phone's notification, until it's opened or dismissed.
          const alert = outbox.find((m) => m.conversation_id && m.conversation_id !== conversationId && !dismissed.includes(m.conversation_id) && Date.now() - new Date(m.sent_at).getTime() < 30 * 60_000);
          return alert ? (
            <div className="alert-banner" role="status">
              <span className="label">Notification from your bank</span>
              <span>{alert.body}</span>
              <span className="dev-row">
                <button className="btn btn-primary" onClick={() => openAlert(alert)}>Reply</button>
                <button className="btn" onClick={() => setDismissed((d) => [...d, alert.conversation_id!])}>Dismiss</button>
              </span>
            </div>
          ) : null;
        })()}
        <div className="messages" ref={messagesRef} aria-live="polite">
          {setupProblem && <div className="msg msg-alexis" role="alert">{setupProblem}</div>}
          {messages.map((m) => (
            m.role === "notice" ? <div key={m.id} className="chat-notice" role="status">{m.text}</div> :
            <div key={m.id} className={`msg msg-${m.role}${m.update ? " update" : ""}${m.staff ? " msg-staff" : ""}`}>
              {channel === "email" && m.role === "customer" && <div className="msg-meta">From you to {SUPPORT_EMAIL}</div>}
              {m.role === "alexis" && m.showLabel && <div className="msg-meta">{who(m)}</div>}
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
              {channel !== "app" && (m.identity || m.confirm || m.code) && (
                <div className="secure-link label">Secure link from the bank: opens this form outside the {channel === "whatsapp" ? "chat" : "email"}</div>
              )}
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
          {empty && OPENERS_BY_LANGUAGE[language] && (
            <div className="openers">
              {OPENERS_BY_LANGUAGE[language].map((o) => (
                <button key={o} className="btn" onClick={() => send({ message: o }, o)} disabled={busy}>{o}</button>
              ))}
            </div>
          )}
        </div>

        {channel === "email" && messages.length === 0 && (
          <div className="empty">Write to {SUPPORT_EMAIL}. Alexis replies to each email.</div>
        )}
        {firstEmail && (
          <div className="email-subject">
            <label className="sr-only" htmlFor="email-subject">Subject</label>
            <input id="email-subject" className="filter-input" placeholder="Subject" value={subject} onChange={(e) => setSubject(e.target.value)} maxLength={200} />
          </div>
        )}
        <form className="composer" onSubmit={(e) => { e.preventDefault(); submit(); }}>
          <label className="sr-only" htmlFor="message">Message</label>
          <textarea
            id="message"
            className="ph-sensitive"
            value={draft}
            rows={channel === "email" ? 4 : 1}
            placeholder={channel === "email" ? "Write your email" : "Type a message"}
            onChange={(e) => setDraft(e.target.value)}
            onKeyDown={(e) => {
              // An email is written in paragraphs: Enter adds a line, the Send button sends.
              if (e.key === "Enter" && !e.shiftKey && channel !== "email") { e.preventDefault(); submit(); }
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
      </div>
    </div>
  );
}

/** The channel switcher's icons: a chat bubble, WhatsApp's phone-in-a-bubble mark, an envelope. */
function ChannelIcon({ channel }: { channel: Channel }) {
  const common = { width: 16, height: 16, viewBox: "0 0 16 16", "aria-hidden": true, className: "channel-icon" } as const;
  if (channel === "app") return (
    <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
      <path d="M2.5 3.5h11a1 1 0 0 1 1 1v6a1 1 0 0 1-1 1H7l-3 2.5v-2.5H2.5a1 1 0 0 1-1-1v-6a1 1 0 0 1 1-1z" />
      <path d="M4.75 7.5h.01M8 7.5h.01M11.25 7.5h.01" strokeWidth="2" strokeLinecap="round" />
    </svg>
  );
  if (channel === "whatsapp") return (
    <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinejoin="round">
      <path d="M8 1.75a6.25 6.25 0 0 0-5.4 9.4L1.75 14.25l3.2-.83A6.25 6.25 0 1 0 8 1.75z" />
      <path d="M5.9 4.9c.25 0 .45.05.6.4l.5 1.2c.05.15.05.3-.05.45l-.4.5c.4.8 1 1.4 1.85 1.85l.5-.45c.15-.1.3-.1.45-.05l1.2.55c.3.15.35.35.35.6-.05.8-.75 1.35-1.5 1.35C7.45 11.3 4.7 8.6 4.6 6.4c0-.75.55-1.45 1.3-1.5z" fill="currentColor" stroke="none" />
    </svg>
  );
  return (
    <svg {...common} fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round">
      <rect x="1.75" y="3.25" width="12.5" height="9.5" rx="1.25" />
      <path d="M2.25 4l5.75 4.5L13.75 4" strokeLinecap="round" />
    </svg>
  );
}

