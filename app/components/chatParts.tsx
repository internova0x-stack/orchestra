"use client";

import { useState } from "react";

// The chat's shared pieces: the message shape, status chips, payment and proof cards, the identity, code and
// Yes/Cancel forms, and how a streamed turn and the team's side of the chat change the messages. Used by the
// customer app (Chat.tsx) and the website chat widget (app/w).

export interface Card {
  reference: string; amount: string; counterparty: string; route: string; status: string; date: string;
  stages: { label: string; state: "done" | "current" | "failed" | "todo" }[];
}
export interface Handoff { reference: string; urgency: string; respond: string }
export interface Proof { reference: string; payout: string; amount: string; currency: string; date: string; recipient: string; account: string; route: string; issued: string }
export interface Msg {
  id: string;
  role: "alexis" | "customer" | "notice";
  /** A reply typed by a member of the team who took the chat over. */
  staff?: string;
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
export const newId = () => (typeof crypto !== "undefined" && "randomUUID" in crypto ? crypto.randomUUID() : `${Date.now()}-${Math.random()}`);

// ---------------------------------------------------------------- status chip

export const CHIP: Record<string, { tone: string; icon: "check" | "clock" | "cross" | "pause" }> = {
  Successful: { tone: "ok", icon: "check" }, Approved: { tone: "ok", icon: "check" }, Credited: { tone: "ok", icon: "check" },
  Unallocated: { tone: "wait", icon: "clock" },
  Pending: { tone: "wait", icon: "clock" }, Processing: { tone: "wait", icon: "clock" }, "In review": { tone: "wait", icon: "clock" },
  Failed: { tone: "stop", icon: "cross" }, Reversed: { tone: "stop", icon: "cross" }, Blocked: { tone: "stop", icon: "cross" },
  Declined: { tone: "stop", icon: "cross" }, Resolved: { tone: "ok", icon: "check" },
  "On hold": { tone: "info", icon: "pause" }, "Needs approval": { tone: "info", icon: "pause" },
  "In progress": { tone: "wait", icon: "clock" }, "Taken over": { tone: "info", icon: "pause" }, "Waiting for the team": { tone: "stop", icon: "clock" }, "Waiting on customer": { tone: "wait", icon: "clock" },
  "Handed off": { tone: "info", icon: "pause" }, "Resolved by Alexis": { tone: "ok", icon: "check" }, "Resolved by staff": { tone: "ok", icon: "check" },
};

export function Icon({ name }: { name: "check" | "clock" | "cross" | "pause" | "flag" }) {
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
export function ChoiceCard({ card, disabled, onChoose }: { card: Card; disabled: boolean; onChoose: () => void }) {
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

export function PaymentCard({ card }: { card: Card }) {
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

export function ProofCard({ proof, conversationId, href }: { proof: Proof; conversationId: string; href?: string }) {
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
      <a className="btn btn-primary" href={href ?? `/api/proof?ref=${proof.reference}&conversation=${conversationId}`} download>
        Download PDF
      </a>
    </div>
  );
}

export function CodeForm({ disabled, retry, onSubmit }: { disabled: boolean; retry: boolean; onSubmit: (code: string) => void }) {
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

export function IdentityForm({ disabled, onSubmit }: { disabled: boolean; onSubmit: (a: { full_name: string; date_of_birth: string; registration_number: string }) => void }) {
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


// ---------------------------------------------------------------- how the chat changes

/** One event of a streamed turn (lib/tools.ts StreamEvent), as the browser receives it. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
type TurnEvent = { type: string } & Record<string, any>;

/** The messages after one streamed event. Events that patch a reply change the last Alexis message only. */
export function applyEvent(ms: Msg[], e: TurnEvent): Msg[] {
  const patch = (fn: (m: Msg) => Msg) => {
    const i = ms.length - 1;
    if (i < 0 || ms[i].role !== "alexis") return ms;
    const copy = ms.slice();
    copy[i] = fn(copy[i]);
    return copy;
  };
  const dropThinking = (list: Msg[]) => (list[list.length - 1]?.role === "alexis" && list[list.length - 1].thinking ? list.slice(0, -1) : list);
  switch (e.type) {
    case "text": return patch((m) => ({ ...m, thinking: false, text: m.text + e.delta }));
    case "break": return patch((m) => ({ ...m, text: m.text ? m.text + "\n\n" : m.text }));
    case "team_queue": {
      // Alexis is switched off or the AI service is down: the message is with the team.
      const rest = dropThinking(ms);
      return rest.some((m) => m.role === "notice" && m.text === e.message) ? rest : [...rest, { id: newId(), role: "notice", text: e.message }];
    }
    // A member of the team is handling the chat: no reply from Alexis; theirs arrives by the team check.
    case "taken_over": return dropThinking(ms);
    case "card": return patch((m) => (m.proof ? m : { ...m, cards: e.cards }));
    case "identity_form": return patch((m) => ({ ...m, identity: "open" }));
    case "masked": {
      // Show the customer that the secret was removed, as it was in the stored transcript.
      const i = ms.map((x) => x.role).lastIndexOf("customer");
      if (i < 0) return ms;
      const copy = ms.slice();
      copy[i] = { ...copy[i], text: e.text };
      return copy;
    }
    case "image_removed": {
      // The customer's photo looked like an ID document or a card: it's gone from their message too.
      const i = ms.map((x) => x.role).lastIndexOf("customer");
      const copy = ms.slice();
      if (i >= 0) copy[i] = { ...copy[i], image: undefined, text: copy[i].text === "Screenshot" ? "" : copy[i].text };
      const at = copy.length && copy[copy.length - 1].role === "alexis" && copy[copy.length - 1].thinking ? copy.length - 1 : copy.length;
      copy.splice(at, 0, { id: newId(), role: "notice", text: e.message });
      return copy;
    }
    case "code_form": return patch((m) => ({ ...m, code: { sentTo: e.sentTo, code: e.code, state: "open" } }));
    case "code_retry": {
      // Wrong code: reopen the form on the message that showed it, and drop the empty reply.
      const copy = ms.slice(0, -1);
      const i = copy.map((x) => Boolean(x.code)).lastIndexOf(true);
      if (i >= 0) copy[i] = { ...copy[i], code: { ...copy[i].code!, state: "open", retry: true } };
      return copy;
    }
    case "confirm": return patch((m) => ({ ...m, confirm: { action: e.action, consequence: e.consequence, state: "open" } }));
    case "proof": return patch((m) => ({ ...m, proof: e.proof, cards: undefined })); // one card per reply
    case "handoff": return patch((m) => ({ ...m, handoff: { reference: e.reference, urgency: e.urgency, respond: e.respond } }));
    case "error": return patch((m) => ({ ...m, thinking: false, text: (m.text ? m.text + "\n\n" : "") + e.message }));
    default: return ms;
  }
}

/** The team's side of an open chat (lib/takeover.ts customerView): who's handling it, replies, decisions. */
export interface TeamView {
  takenOverBy: string | null; staff: { key: string; name: string; text: string }[]; updates: { id: number; message: string }[];
  pendingAction?: { key: string; action: string; consequence: string; by: string } | null;
  pendingCode?: { key: string; sentTo: string; code: string; by: string } | null;
}

/** The messages with the team's new replies, decisions, and any code or Yes/Cancel they're waiting on. */
export function mergeView(ms: Msg[], j: TeamView): Msg[] {
  const have = new Set(ms.map((m) => m.id));
  const add: Msg[] = [
    ...j.staff.filter((x) => !have.has(`staff-${x.key}`)).map((x) => ({ id: `staff-${x.key}`, role: "alexis" as const, text: x.text, staff: x.name, showLabel: true })),
    ...j.updates.filter((u) => !have.has(`update-${u.id}`)).map((u) => ({ id: `update-${u.id}`, role: "alexis" as const, text: `Update from the team: ${u.message}`, update: true, showLabel: true })),
    // An action or the one-time code from the member of the team handling the chat: the customer answers here.
    ...(j.pendingCode && !have.has(`staffcode-${j.pendingCode.key}`)
      ? [{ id: `staffcode-${j.pendingCode.key}`, role: "alexis" as const, staff: j.pendingCode.by, text: `To confirm it's you, ${j.pendingCode.by.split(" ")[0]} sent a one-time code to your phone. Type it below.`, code: { sentTo: j.pendingCode.sentTo, code: j.pendingCode.code, state: "open" as const }, showLabel: true }]
      : []),
    ...(j.pendingAction && !have.has(`staffask-${j.pendingAction.key}`)
      ? [{ id: `staffask-${j.pendingAction.key}`, role: "alexis" as const, staff: j.pendingAction.by, text: `${j.pendingAction.by.split(" ")[0]} needs your yes before going ahead.`, confirm: { action: j.pendingAction.action, consequence: j.pendingAction.consequence, state: "open" as const }, showLabel: true }]
      : []),
  ];
  return add.length ? [...ms, ...add] : ms;
}

/** Once the customer answers, the forms they answered close. */
export function closeForms(ms: Msg[]): Msg[] {
  return ms.map((m) => {
    let x = m;
    if (x.identity === "open") x = { ...x, identity: "sent" as const };
    if (x.confirm?.state === "open") x = { ...x, confirm: { ...x.confirm, state: "answered" as const } };
    if (x.code?.state === "open") x = { ...x, code: { ...x.code, state: "sent" as const } };
    return x;
  });
}

/** The notice when a member of the team joins or leaves, or null. */
export function takeoverNotice(was: string | null, now: string | null): string | null {
  if (was === now) return null;
  return now ? `${now} from the support team has joined the chat.` : was ? `${was} has left the chat. Alexis is back to help.` : null;
}

/** Reads a streamed turn (newline-delimited JSON), calling `on` for each event. */
export async function readTurn(res: Response, on: (e: TurnEvent) => void) {
  const reader = res.body!.getReader();
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
      if (line) on(JSON.parse(line));
    }
  }
}
