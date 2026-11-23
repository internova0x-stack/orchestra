"use client";

import { use, useEffect, useState } from "react";

// The private page a customer opens from one of Alexis's emails (lib/email/channel.ts): the identity check, a
// Yes/Cancel for an action, or a one-time code. One use; the answer goes to Alexis and her reply is emailed.

type Need = { type: "identity" } | { type: "confirm"; action: string; consequence: string } | { type: "code"; sent_to: string } | null;

export default function EmailForm({ params }: { params: Promise<{ token: string }> }) {
  const { token } = use(params);
  const [need, setNeed] = useState<Need | undefined>(undefined);
  const [problem, setProblem] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [done, setDone] = useState<{ reply: string | null; more: boolean } | null>(null);
  const [f, setF] = useState({ full_name: "", date_of_birth: "", registration_number: "", code: "" });

  useEffect(() => {
    fetch(`/api/e/${token}`, { cache: "no-store" }).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setProblem(j.message ?? "This link can't be used.");
      else setNeed(j.need ?? null);
    }).catch(() => setProblem("Couldn't reach the server. Try again."));
  }, [token]);

  async function send(body: object) {
    setBusy(true);
    setProblem(null);
    try {
      const r = await fetch(`/api/e/${token}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setProblem(j.message ?? "That didn't go through.");
      else setDone({ reply: j.reply ?? null, more: Boolean(j.more) });
    } catch {
      setProblem("Couldn't reach the server. Try again.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <>
    <div className="banner" role="note">Prototype - simulated data · the customer&apos;s side</div>
    <main className="eform">
      <section className="panel eform-card">
        <div className="eform-head"><b>Secure form</b><span className="label">From your support email conversation</span></div>
        {problem && <div className="rule-error" role="alert">{problem}</div>}
        {need === undefined && !problem && <p className="label">Loading…</p>}
        {done ? (
          <div className="eform-done">
            <b>Thank you.</b>
            {done.reply && <p>{done.reply}</p>}
            <p className="label">We&apos;ve also emailed you{done.more ? ", including what's needed next" : ""}. You can close this page.</p>
          </div>
        ) : need === null ? (
          <p>Nothing is waiting here any more. Reply to our email if you need anything else.</p>
        ) : need?.type === "identity" ? (
          <form className="eform-fields" onSubmit={(e) => { e.preventDefault(); send({ identity: { full_name: f.full_name, date_of_birth: f.date_of_birth, registration_number: f.registration_number } }); }}>
            <p>To look at your account, please confirm these details. We never ask for passwords, PINs or full card numbers.</p>
            <label className="int-field"><span>Your full name</span><span className="int-input"><input value={f.full_name} onChange={(e) => setF({ ...f, full_name: e.target.value })} autoComplete="name" /></span></label>
            <label className="int-field"><span>Date of birth</span><span className="int-input"><input type="date" value={f.date_of_birth} onChange={(e) => setF({ ...f, date_of_birth: e.target.value })} /></span></label>
            <label className="int-field"><span>Business registration number</span><span className="int-input"><input value={f.registration_number} onChange={(e) => setF({ ...f, registration_number: e.target.value })} /></span></label>
            <button className="btn btn-primary" disabled={busy || !f.full_name.trim() || !f.date_of_birth || !f.registration_number.trim()}>{busy ? "Checking…" : "Confirm my details"}</button>
          </form>
        ) : need?.type === "confirm" ? (
          <div className="eform-fields">
            <p><b>{need.action}</b></p>
            {need.consequence && <p className="label">{need.consequence}</p>}
            <div className="int-actions">
              <button className="btn btn-primary" disabled={busy} onClick={() => send({ confirm: true })}>{busy ? "Working…" : "Yes, go ahead"}</button>
              <button className="btn" disabled={busy} onClick={() => send({ confirm: false })}>Cancel</button>
            </div>
          </div>
        ) : need?.type === "code" ? (
          <form className="eform-fields" onSubmit={(e) => { e.preventDefault(); send({ code: f.code }); }}>
            <p>Enter the one-time code we sent to {need.sent_to}.</p>
            <label className="int-field"><span>Code</span><span className="int-input"><input inputMode="numeric" autoComplete="one-time-code" value={f.code} onChange={(e) => setF({ ...f, code: e.target.value })} /></span></label>
            <button className="btn btn-primary" disabled={busy || !f.code.trim()}>{busy ? "Checking…" : "Confirm"}</button>
          </form>
        ) : null}
        <p className="label eform-foot">You&apos;re talking with an AI support assistant. A member of the team is available any time you prefer.</p>
      </section>
    </main>
    </>
  );
}
