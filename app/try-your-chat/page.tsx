"use client";

import { useCallback, useEffect, useRef, useState } from "react";

// "Use your own chat" (Tomi, Nov 25): a bank that already has a chat sends each customer message to Alexis through the
// Channel API and shows her reply in its own design. This page plays both sides: on the left, a plain stand-in for the
// bank's chat; on the right, every request its server would send to Orchestra and the answer it would get back.
// The calls run through /api/admin/channel-test (the same functions as /api/v1, for the signed-in person, never a key).

interface Need { type: "identity" | "confirm" | "code"; action?: string; consequence?: string; sent_to?: string }
interface Reply {
  conversation_id: string; reply: string | null; handled_by: string | null; needs: Need[];
  handoff: { reference: string; urgency: string; respond: string } | null; notices: string[];
}
interface Line { id: string; from: "customer" | "alexis" | "team" | "notice"; text: string; name?: string; needs?: Need[]; answered?: boolean }
interface Call { id: number; method: string; path: string; request?: object; status: number; response: unknown }
interface U { id: string; name: string; role: string; business: string }

let seq = 0;
const nid = () => `l${++seq}`;

export default function TryYourChat() {
  const [users, setUsers] = useState<U[]>([]);
  const [who, setWho] = useState("");
  const [conv, setConv] = useState<string | null>(null);
  const [lines, setLines] = useState<Line[]>([]);
  const [calls, setCalls] = useState<Call[]>([]);
  const [draft, setDraft] = useState("");
  const [busy, setBusy] = useState(false);
  const [origin, setOrigin] = useState("");
  const seenTeam = useRef(0);
  const convRef = useRef<string | null>(null);
  convRef.current = conv;

  useEffect(() => {
    setOrigin(window.location.origin);
    fetch("/api/users", { cache: "no-store" }).then((r) => r.json()).then((j) => setUsers(j.users ?? [])).catch(() => {});
  }, []);

  const api = useCallback(async (action: string, method: string, path: string, request?: object, log = true) => {
    const r = await fetch("/api/admin/channel-test", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ action, conversation_id: convRef.current, request }) });
    const j = r.ok ? await r.json() : { status: r.status, body: { error: r.status === 403 ? "Your role can't use the API page." : "That didn't go through." } };
    if (log) setCalls((cs) => [{ id: Date.now() + Math.random(), method, path, request, status: j.status, response: j.body }, ...cs].slice(0, 20));
    return j as { status: number; body: Record<string, unknown> };
  }, []);

  async function start() {
    setBusy(true);
    setLines([]); setCalls([]); seenTeam.current = 0; convRef.current = null; setConv(null);
    const request = who ? { channel: "app", verified_user_id: who } : { channel: "app" };
    const j = await api("open", "POST", "/api/v1/conversations", request);
    if (j.status === 201) {
      setConv(String(j.body.conversation_id));
      convRef.current = String(j.body.conversation_id);
      if (j.body.greeting) setLines([{ id: nid(), from: "alexis", text: String(j.body.greeting) }]);
    }
    setBusy(false);
  }

  async function send(request: object, shown: string) {
    if (!conv || busy) return;
    setBusy(true);
    setLines((ls) => [...ls.map((l) => ({ ...l, answered: true })), { id: nid(), from: "customer", text: shown }]);
    const j = await api("send", "POST", `/api/v1/conversations/${conv}/messages`, request);
    const b = j.body as unknown as Reply;
    if (j.status === 200) {
      const add: Line[] = [];
      for (const n of b.notices ?? []) add.push({ id: nid(), from: "notice", text: n });
      if (b.reply || b.needs?.length) add.push({ id: nid(), from: "alexis", text: b.reply ?? "", needs: b.needs });
      if (b.handoff) add.push({ id: nid(), from: "notice", text: `Passed to the team · ${b.handoff.reference} · expect a response ${b.handoff.respond}` });
      if (b.handled_by && !b.reply) add.push({ id: nid(), from: "notice", text: `${b.handled_by} from the team is handling this chat: their reply arrives by webhook or GET.` });
      setLines((ls) => [...ls, ...add]);
    } else {
      setLines((ls) => [...ls, { id: nid(), from: "notice", text: `Error ${j.status}: ${String(j.body.message ?? j.body.error ?? "")}` }]);
    }
    setBusy(false);
  }

  // Team replies (someone took over in Messages): what GET /api/v1/conversations/{id} returns, checked every 4 s.
  useEffect(() => {
    if (!conv) return;
    const t = setInterval(async () => {
      if (document.visibilityState !== "visible" || busy) return;
      const j = await api("get", "GET", `/api/v1/conversations/${conv}`, undefined, false);
      const team = ((j.body?.messages as { from: string; name?: string; text: string }[]) ?? []).filter((m) => m.from === "team");
      if (team.length > seenTeam.current) {
        const fresh = team.slice(seenTeam.current);
        seenTeam.current = team.length;
        setLines((ls) => [...ls, ...fresh.map((m) => ({ id: nid(), from: "team" as const, name: m.name, text: m.text }))]);
        setCalls((cs) => [{ id: Date.now(), method: "GET", path: `/api/v1/conversations/${conv}`, status: j.status, response: j.body }, ...cs].slice(0, 20));
      }
    }, 4000);
    return () => clearInterval(t);
  }, [conv, busy, api]);

  const curl = (c: Call) => `curl -X ${c.method} ${origin}${c.path} \\\n  -H "Authorization: Bearer $ORCHESTRA_API_KEY"${c.request ? ` \\\n  -H "Content-Type: application/json" \\\n  -d '${JSON.stringify(c.request)}'` : ""}`;

  return (
    <div className="ych">
      <p className="label ych-intro">
        Play a customer in the stand-in chat on the left. On the right is each request your server would send to Orchestra and
        the answer it gets back, to show in your own chat. These are real conversations: they appear in Messages, where you can
        take one over and watch the team&apos;s reply arrive here. <a href="/developers">Back to the API page</a>
      </p>
      <div className="ych-grid">
        <section className="panel ych-chat" aria-label="Your chat (stand-in)">
          <div className="panel-head"><span className="panel-title">Your chat (a stand-in)</span></div>
          <div className="ych-start">
            <label className="tester-field">
              <span className="label">The customer</span>
              <select value={who} onChange={(e) => setWho(e.target.value)} disabled={busy}>
                <option value="">Not signed in (Alexis checks who they are)</option>
                {users.map((u) => <option key={u.id} value={u.id}>Signed in to your app: {u.name}</option>)}
              </select>
            </label>
            <button className="btn btn-primary" onClick={start} disabled={busy}>{conv ? "Start a new conversation" : "Start a conversation"}</button>
          </div>
          <div className="messages" aria-live="polite">
            {!conv && <div className="empty">Start a conversation. Your server opens it with POST /api/v1/conversations, passing the customer&apos;s id if your app has signed them in.</div>}
            {lines.map((l) => l.from === "notice" ? <div key={l.id} className="chat-notice">{l.text}</div> : (
              <div key={l.id} className={`msg msg-${l.from === "customer" ? "customer" : "alexis"}`}>
                {l.from !== "customer" && <div className="msg-meta">{l.from === "team" ? `${l.name ?? "Team"} · Support team` : "Alexis · AI"}</div>}
                {l.text}
                {l.needs?.map((n, i) => <NeedView key={i} need={n} disabled={busy || Boolean(l.answered)} onAnswer={send} />)}
              </div>
            ))}
            {busy && conv && <span className="dots" aria-label="Waiting for Alexis"><span /><span /><span /></span>}
          </div>
          <form className="composer" onSubmit={(e) => { e.preventDefault(); const t = draft.trim(); if (t) { setDraft(""); send({ text: t }, t); } }}>
            <label className="sr-only" htmlFor="ych-msg">Message</label>
            <textarea id="ych-msg" className="ph-sensitive" rows={1} value={draft} disabled={!conv} placeholder="Type as the customer"
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => { if (e.key === "Enter" && !e.shiftKey) { e.preventDefault(); (e.currentTarget.form as HTMLFormElement).requestSubmit(); } }} />
            <button className="btn btn-primary" disabled={!conv || busy || !draft.trim()}>Send</button>
          </form>
        </section>

        <section className="panel ych-calls" aria-label="What your server sends and gets">
          <div className="panel-head"><span className="panel-title">What your server sends and gets</span><span className="label">newest first</span></div>
          <div className="ych-list">
            {calls.length === 0 && <div className="empty">Each call appears here with the request, Orchestra&apos;s answer and the same call as curl.</div>}
            {calls.map((c) => (
              <div key={c.id} className="ych-call">
                <div className="ych-line"><span className="ref">{c.method}</span> <span className="ych-path">{c.path}</span> <span className={`chip ${c.status < 300 ? "chip-ok" : "chip-stop"}`}>{c.status}</span></div>
                {c.request && <><div className="label">Request body</div><pre className="dev-code wrap">{JSON.stringify(c.request, null, 2)}</pre></>}
                <div className="label">Answer</div>
                <pre className="dev-code wrap">{JSON.stringify(c.response, null, 2)}</pre>
                <details className="int-details"><summary>As curl</summary><pre className="dev-code wrap">{curl(c)}</pre></details>
              </div>
            ))}
          </div>
        </section>
      </div>
    </div>
  );
}

/** What `needs` asks your chat to show: Yes/Cancel, a code box, or the identity form (or a link to your own). */
function NeedView({ need, disabled, onAnswer }: { need: Need; disabled: boolean; onAnswer: (req: object, shown: string) => void }) {
  const [code, setCode] = useState("");
  const [f, setF] = useState({ full_name: "", date_of_birth: "", registration_number: "" });
  if (need.type === "confirm") return (
    <div className="confirm">
      <div className="confirm-action">{need.action}</div>
      <div className="card-line">{need.consequence}</div>
      <div className="confirm-buttons">
        <button className="btn btn-primary" disabled={disabled} onClick={() => onAnswer({ confirm: true }, "Yes, go ahead")}>Yes, go ahead</button>
        <button className="btn" disabled={disabled} onClick={() => onAnswer({ confirm: false }, "Cancel")}>Cancel</button>
      </div>
      <div className="label">needs: confirm → send {"{ \"confirm\": true }"} or false</div>
    </div>
  );
  if (need.type === "code") return (
    <form className="form" onSubmit={(e) => { e.preventDefault(); onAnswer({ code }, "Code entered"); }}>
      <label>Code sent to {need.sent_to}<input inputMode="numeric" value={code} onChange={(e) => setCode(e.target.value)} disabled={disabled} required /></label>
      <button className="btn btn-primary" disabled={disabled}>Confirm code</button>
      <div className="label">needs: code → send {"{ \"code\": \"…\" }"}</div>
    </form>
  );
  return (
    <form className="form" autoComplete="off" onSubmit={(e) => { e.preventDefault(); onAnswer({ identity: f }, "Identity details submitted"); }}>
      <label>Full name<input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} disabled={disabled} required /></label>
      <label>Date of birth<input type="date" value={f.date_of_birth} onChange={(e) => setF({ ...f, date_of_birth: e.target.value })} disabled={disabled} required /></label>
      <label>Registration number, or a personal account&apos;s last 4 digits<input value={f.registration_number} onChange={(e) => setF({ ...f, registration_number: e.target.value })} disabled={disabled} required /></label>
      <button className="btn btn-primary" disabled={disabled}>Confirm</button>
      <div className="label">needs: identity → send {"{ \"identity\": { full_name, date_of_birth, registration_number } }"}</div>
    </form>
  );
}
