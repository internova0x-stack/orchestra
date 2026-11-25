"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import { GREETINGS } from "@/lib/greeting";
import { readImage, type Attachment } from "../../components/screenshots";
import {
  ChoiceCard, CodeForm, IdentityForm, PaymentCard, ProofCard, UrgencyChip,
  applyEvent, closeForms, mergeView, newId, readTurn, takeoverNotice, type Msg, type TeamView,
} from "../../components/chatParts";

// The website chat widget's conversation (lib/widget.ts). It runs in a frame on the bank's page; the page talks to it
// only by messages from its own listed websites: "init" (start, with a signed-in customer's token if the page has
// one) and "identify" (the customer has just signed in). It tells the page "ready" and "close".

interface Props { widgetKey: string; title: string; colour: string; origins: string[] }
type Saved = { id: string; at: number; signed: boolean };
type Line = { role: "customer" | "alexis"; text: string; staff?: string; key?: string };

const WAIT_FOR_PAGE_MS = 1500;
const RESUME_MS = 30 * 60_000;
const OOPS = "Something went wrong on my side and I couldn't complete that. Please try again in a moment.";

/** Relative luminance, for picking readable text on and beside the bank's colour. */
function luminance(hex: string): number {
  const c = [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * c[0] + 0.7152 * c[1] + 0.0722 * c[2];
}
const contrastWithWhite = (hex: string) => 1.05 / (luminance(hex) + 0.05);

export default function WidgetChat({ widgetKey, title, colour, origins }: Props) {
  const api = `/api/w/${widgetKey}`;
  const store = `orchestra-widget:${widgetKey}`;
  const [conversationId, setConversationId] = useState<string | null>(null);
  const [messages, setMessages] = useState<Msg[]>([]);
  const [problem, setProblem] = useState<string | null>(null);
  const [signedIn, setSignedIn] = useState<string | null>(null);
  const [takenOverBy, setTakenOverBy] = useState<string | null>(null);
  const [status, setStatus] = useState<{ alexisOn: boolean; outage: string | null }>({ alexisOn: true, outage: null });
  const [busy, setBusy] = useState(false);
  const [draft, setDraft] = useState("");
  const [attachment, setAttachment] = useState<Attachment | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const messagesRef = useRef<HTMLDivElement>(null);
  const convRef = useRef<string | null>(null);
  convRef.current = conversationId;
  const started = useRef(false);
  // Inside the bank's page (the usual case) or opened on its own; known only in the browser.
  const [embedded, setEmbedded] = useState(false);
  useEffect(() => { setEmbedded(window.parent !== window); }, []);

  const save = (s: Saved | null) => { try { if (s) localStorage.setItem(store, JSON.stringify(s)); else localStorage.removeItem(store); } catch {} };
  const saved = (): Saved | null => { try { return JSON.parse(localStorage.getItem(store) ?? "null"); } catch { return null; } };
  const toPage = (data: object) => { if (window.parent !== window) window.parent.postMessage({ source: "orchestra-chat", ...data }, "*"); };

  /** A new conversation, or the one from the bank's last page if it's recent and the customer is the same. */
  const start = useCallback(async (token: string | null, language: string, fresh = false) => {
    setProblem(null);
    const last = saved();
    if (!fresh && last && Date.now() - last.at < RESUME_MS && last.signed === Boolean(token)) {
      const r = await fetch(`${api}/conversation/${last.id}?history=1`, { cache: "no-store" }).catch(() => null);
      if (r?.ok) {
        const j = (await r.json()) as TeamView & { history: Line[]; status: typeof status };
        setConversationId(last.id);
        setStatus(j.status);
        setTakenOverBy(j.takenOverBy);
        setMessages(j.history.map((l, i) => ({
          id: l.key ? `staff-${l.key}` : `h-${i}`, role: l.role, text: l.text, staff: l.staff,
          showLabel: l.role === "alexis" && (i === 0 || j.history[i - 1].role !== "alexis" || Boolean(l.staff)),
        })));
        return;
      }
    }
    const r = await fetch(`${api}/start`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ token, language }) }).catch(() => null);
    const j = r ? await r.json().catch(() => ({})) : {};
    if (r?.status === 401 && token) {
      // The page's sign-in couldn't be confirmed: carry on as a guest; Alexis checks who they are as usual.
      setProblem("We couldn't confirm you're signed in. You can still chat: Alexis will check who you are first.");
      return start(null, language, true);
    }
    if (!r?.ok) {
      setProblem(r?.status === 429 ? "You've started a lot of chats in the last hour. Please try again a little later." : "The chat couldn't start. Please try again in a moment.");
      return;
    }
    setConversationId(j.conversation_id);
    setSignedIn(j.signedIn ?? null);
    setTakenOverBy(null);
    save({ id: j.conversation_id, at: Date.now(), signed: Boolean(token) });
    setMessages([{ id: newId(), role: "alexis", text: j.greeting ?? GREETINGS[language] ?? GREETINGS.en, showLabel: true }]);
  }, [api]); // eslint-disable-line react-hooks/exhaustive-deps

  // The bank's page sends "init" when the frame is ready; opened on its own (no page), the chat starts by itself.
  useEffect(() => {
    const allowed = (o: string) => o === window.location.origin || origins.includes(o);
    const onMessage = (e: MessageEvent) => {
      if (!allowed(e.origin) || e.source !== window.parent) return;
      const d = e.data as { source?: string; type?: string; token?: unknown; language?: unknown };
      if (d?.source !== "orchestra-page") return;
      const token = typeof d.token === "string" && d.token ? d.token : null;
      const language = typeof d.language === "string" && GREETINGS[d.language] ? d.language : "en";
      if (d.type === "init" && !started.current) { started.current = true; start(token, language); }
      if (d.type === "identify" && token) { started.current = true; start(token, language, true); }
    };
    window.addEventListener("message", onMessage);
    toPage({ type: "ready" });
    const t = setTimeout(() => { if (!started.current) { started.current = true; start(null, "en"); } }, window.parent === window ? 0 : WAIT_FOR_PAGE_MS);
    return () => { window.removeEventListener("message", onMessage); clearTimeout(t); };
  }, [origins, start]);

  // While open: the team's replies and decisions, whether someone has taken over, and the service notice.
  const polling = useRef(false);
  const poll = useCallback(async () => {
    const id = convRef.current;
    if (!id || polling.current) return;
    polling.current = true;
    try {
      const r = await fetch(`${api}/conversation/${id}`, { cache: "no-store" });
      if (!r.ok) return;
      const j = (await r.json()) as TeamView & { status: typeof status };
      if (id !== convRef.current) return;
      setStatus(j.status);
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
  }, [api]);
  useEffect(() => {
    const t = setInterval(() => { if (document.visibilityState === "visible") poll(); }, 2500);
    return () => clearInterval(t);
  }, [poll]);

  useEffect(() => { messagesRef.current?.scrollTo({ top: messagesRef.current.scrollHeight, behavior: "smooth" }); }, [messages]);

  const patchLast = (fn: (m: Msg) => Msg) => setMessages((ms) => {
    const i = ms.length - 1;
    if (i < 0 || ms[i].role !== "alexis") return ms;
    const copy = ms.slice();
    copy[i] = fn(copy[i]);
    return copy;
  });

  async function send(body: { message?: string; confirm?: boolean; code?: string; image?: { media_type: string; data: string }; identity?: { full_name: string; date_of_birth: string; registration_number: string } }, shown: string, imagePreview?: string) {
    if (busy || !conversationId) return;
    setBusy(true);
    setMessages((ms) => [...closeForms(ms), { id: newId(), role: "customer", text: shown, image: imagePreview }, { id: newId(), role: "alexis", text: "", thinking: true, showLabel: true }]);
    save({ id: conversationId, at: Date.now(), signed: Boolean(signedIn) });
    try {
      const res = await fetch(`${api}/chat`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId, ...body }) });
      if (!res.ok || !res.body) { patchLast((m) => ({ ...m, thinking: false, text: OOPS })); return; }
      await readTurn(res, (e) => {
        setMessages((ms) => applyEvent(ms, e));
        if (e.type === "taken_over") poll();
      });
    } catch {
      patchLast((m) => ({ ...m, thinking: false, text: (m.text ? m.text + "\n\n" : "") + OOPS }));
    } finally {
      patchLast((m) => ({ ...m, thinking: false }));
      setBusy(false);
      poll();
    }
  }

  const submit = () => {
    const text = draft.trim();
    if (!text && !attachment) return;
    const a = attachment;
    setDraft("");
    setAttachment(null);
    send({ message: text, ...(a ? { image: { media_type: a.media_type, data: a.data } } : {}) }, text || "Screenshot", a?.preview);
  };

  async function attach(file: File | undefined) {
    if (!file) return;
    if (!/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) { setProblem("Attach a PNG, JPEG, WebP or GIF image."); return; }
    try { setAttachment(await readImage(file)); setProblem(null); } catch { setProblem("That image couldn't be read."); }
  }

  // The bank's colour on buttons and labels; text on it stays readable whatever colour they choose.
  const onColour = contrastWithWhite(colour) >= 3 ? "#ffffff" : "#1e2c42";
  const textColour = contrastWithWhite(colour) >= 4.5 ? colour : "#1e2c42";
  const theme = {
    "--brand-600": colour, "--brand-500": colour, "--brand-300": `${colour}88`, "--on-brand": onColour,
    "--brand-text": textColour, "--brand-accent": textColour, "--wchat-head": colour, "--wchat-on-head": onColour,
  } as React.CSSProperties;
  const who = (m: Msg) => (m.staff ? `${m.staff} · Support team` : "Alexis · AI assistant");

  return (
    <div className="wchat" style={theme}>
      <header className="wchat-head">
        <div className="wchat-avatar" aria-hidden="true">{(takenOverBy ?? "A").charAt(0)}</div>
        <div className="wchat-who">
          <div className="wchat-title">{title}</div>
          <div className="wchat-sub">{takenOverBy ? `${takenOverBy} · Support team` : "Alexis · AI assistant"}{signedIn ? ` · Signed in as ${signedIn}` : ""}</div>
        </div>
        {embedded && (
          <button className="wchat-close" onClick={() => toPage({ type: "close" })} aria-label="Close the chat">
            <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M4 4l8 8M12 4l-8 8" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" /></svg>
          </button>
        )}
      </header>
      {status.outage && <div className="service-notice" role="status"><b>Service notice</b> {status.outage}</div>}
      <div className="messages wchat-messages" ref={messagesRef} aria-live="polite">
        {problem && <div className="chat-notice" role="status">{problem}</div>}
        {!conversationId && !problem && <span className="dots" aria-label="Starting the chat"><span /><span /><span /></span>}
        {messages.map((m) => (
          m.role === "notice" ? <div key={m.id} className="chat-notice" role="status">{m.text}</div> :
          <div key={m.id} className={`msg msg-${m.role}${m.update ? " update" : ""}${m.staff ? " msg-staff" : ""}`}>
            {m.role === "alexis" && m.showLabel && <div className="msg-meta">{who(m)}</div>}
            {m.image && <img className="msg-image" src={m.image} alt="Screenshot you sent" />}
            {m.thinking && !m.text ? <span className="dots" aria-label="Alexis is thinking"><span /><span /><span /></span> : m.text}
            {m.cards && m.cards.length > 1
              ? m.cards.map((c) => (
                  <ChoiceCard key={c.reference} card={c} disabled={busy || m.id !== messages[messages.length - 1]?.id}
                    onChoose={() => { const text = `This one: ${c.amount}, ${c.counterparty.replace(/^From /, "from ")}, ${c.reference}`; send({ message: text }, text); }} />
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
            {m.proof && conversationId && <ProofCard proof={m.proof} conversationId={conversationId} href={`${api}/proof?ref=${m.proof.reference}&conversation=${conversationId}`} />}
            {m.identity && <IdentityForm disabled={m.identity === "sent" || busy} onSubmit={(a) => send({ identity: a }, "Identity details submitted")} />}
            {m.handoff && (
              <div className="handoff">
                <strong>Passed to the team</strong>
                <span className="ref">{m.handoff.reference}</span> · <UrgencyChip urgency={m.handoff.urgency} />
                <div className="card-line">Expect a response {m.handoff.respond}.</div>
              </div>
            )}
          </div>
        ))}
      </div>
      {attachment && (
        <div className="attach-bar">
          <span className="attach-chip">
            <img src={attachment.preview} alt="" />
            {attachment.name}
            <button className="copy" type="button" onClick={() => setAttachment(null)} aria-label="Remove the screenshot">Remove</button>
          </span>
        </div>
      )}
      <form className="composer wchat-composer" onSubmit={(e) => { e.preventDefault(); submit(); }}>
        <input ref={fileRef} type="file" accept="image/png,image/jpeg,image/webp,image/gif" hidden onChange={(e) => { attach(e.target.files?.[0]); e.target.value = ""; }} />
        <button className="btn wchat-attach" type="button" onClick={() => fileRef.current?.click()} disabled={busy || !conversationId} aria-label="Attach a screenshot">
          <svg viewBox="0 0 16 16" width="16" height="16" aria-hidden="true"><path d="M10.5 4.5l-5 5a1.5 1.5 0 0 0 2.1 2.1l5.3-5.3a3 3 0 0 0-4.2-4.2L3.4 7.4a4.5 4.5 0 0 0 6.4 6.4l3.7-3.7" fill="none" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" /></svg>
        </button>
        <label className="sr-only" htmlFor="wchat-message">Message</label>
        <textarea id="wchat-message" className="ph-sensitive" rows={1} value={draft} placeholder="Type a message" disabled={!conversationId}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); submit(); } }} />
        <button className="btn btn-primary" type="submit" disabled={busy || !conversationId || (!draft.trim() && !attachment)}>Send</button>
      </form>
      <div className="wchat-foot">You&apos;re chatting with an AI assistant. A person from the team can take over.</div>
    </div>
  );
}
