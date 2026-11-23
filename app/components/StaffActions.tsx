"use client";

import { useState } from "react";

// The team's account actions on a conversation they've taken over (lib/staffActions.ts). The same checks as
// Alexis's; the customer says yes in their app; amounts above the team's limits go to a supervisor or a second one.

type Field =
  | { key: string; label: string; kind: "text"; placeholder?: string; required?: boolean }
  | { key: string; label: string; kind: "number"; placeholder?: string; required?: boolean }
  | { key: string; label: string; kind: "choice"; options: [string, string][]; required?: boolean }
  | { key: string; label: string; kind: "toggle" };

const LAST4: Field = { key: "last4", label: "Card's last 4 (if more than one)", kind: "text", placeholder: "7710" };

const ACTIONS: { tool: string; label: string; fields: Field[] }[] = [
  { tool: "freeze_card", label: "Freeze a card", fields: [LAST4] },
  { tool: "unfreeze_card", label: "Unfreeze a card", fields: [LAST4] },
  {
    tool: "change_card_settings", label: "Change card settings", fields: [
      LAST4,
      { key: "online_payments", label: "Online payments", kind: "toggle" },
      { key: "international_payments", label: "International payments", kind: "toggle" },
      { key: "contactless", label: "Contactless", kind: "toggle" },
      { key: "daily_limit", label: "New daily limit", kind: "number", placeholder: "Leave empty to keep it" },
    ],
  },
  { tool: "order_replacement", label: "Order a replacement card", fields: [LAST4, { key: "reason", label: "Reason", kind: "choice", options: [["lost", "Lost"], ["stolen", "Stolen"], ["damaged", "Damaged"], ["expired", "Expired"]], required: true }] },
  { tool: "open_dispute", label: "Open a dispute", fields: [{ key: "transaction_id", label: "Transaction", kind: "text", placeholder: "TX-90021", required: true }, { key: "reason", label: "Reason", kind: "choice", options: [["not_mine", "Not mine"], ["duplicate", "Charged twice"], ["not_received", "Not received"], ["wrong_amount", "Wrong amount"], ["other", "Other"]], required: true }] },
  { tool: "request_reversal", label: "Request a reversal", fields: [{ key: "payment_id", label: "Payment", kind: "text", placeholder: "PAY-61001", required: true }] },
  { tool: "initiate_recall", label: "Request a recall", fields: [{ key: "reference", label: "Payout", kind: "text", placeholder: "PO-88150", required: true }] },
  { tool: "refund_bill_payment", label: "Refund a bill or airtime payment", fields: [{ key: "payment_id", label: "Bill payment", kind: "text", placeholder: "BP-30101", required: true }] },
  { tool: "waive_fee", label: "Waive a fee", fields: [{ key: "fee_id", label: "Fee", kind: "text", placeholder: "FEE-…", required: true }] },
  { tool: "request_deferral", label: "Log a loan deferral request", fields: [{ key: "loan_id", label: "Loan (if more than one)", kind: "text", placeholder: "LN-30021" }, { key: "months", label: "Months", kind: "choice", options: [["1", "1"], ["2", "2"], ["3", "3"]] }] },
  { tool: "unlock_account", label: "Unlock online access", fields: [] },
  { tool: "send_reset_link", label: "Send a password reset link", fields: [] },
  { tool: "generate_proof_of_payment", label: "Issue a payment confirmation", fields: [{ key: "reference", label: "Payout", kind: "text", placeholder: "PO-88102", required: true }] },
];

type Outcome = { status: string; message?: string; action?: string; reference?: string | null; sentTo?: string };

export default function StaffActions({ conversationId, staffId, onChange }: { conversationId: string; staffId: string; onChange: () => void }) {
  const [tool, setTool] = useState("");
  const [values, setValues] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const def = ACTIONS.find((a) => a.tool === tool);

  function input(): Record<string, unknown> {
    const out: Record<string, unknown> = {};
    for (const f of def?.fields ?? []) {
      const v = values[f.key]?.trim();
      if (!v) continue;
      if (f.kind === "toggle") out[f.key] = v === "on";
      else if (f.kind === "number") out[f.key] = Number(v.replace(/[,\s]/g, ""));
      else if (f.key === "months") out[f.key] = Number(v);
      else out[f.key] = v;
    }
    return out;
  }

  async function post(body: object) {
    setBusy(true);
    setOutcome(null);
    try {
      const res = await fetch(`/api/cases/${conversationId}`, { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, staffId }) });
      const json = (await res.json().catch(() => ({}))) as Outcome & { message?: string };
      setOutcome(json.status ? json : { status: "refused", message: json.message ?? "That didn't go through." });
      onChange();
    } catch {
      setOutcome({ status: "refused", message: "Couldn't reach the app's server." });
    } finally {
      setBusy(false);
    }
  }

  const missing = def?.fields.some((f) => "required" in f && f.required && !values[f.key]?.trim());
  const say: Record<string, string> = {
    done: "Done.",
    waiting_customer: "Waiting for the customer's yes in their app.",
    code_sent: "Code sent. When the customer has typed it in, run the action again.",
  };

  return (
    <div className="staff-actions">
      <div className="dev-row">
        <label className="picker">
          <span className="label">Account action</span>
          <select value={tool} onChange={(e) => { setTool(e.target.value); setValues({}); setOutcome(null); }} aria-label="Account action">
            <option value="">Choose…</option>
            {ACTIONS.map((a) => <option key={a.tool} value={a.tool}>{a.label}</option>)}
          </select>
        </label>
      </div>
      {def && (
        <form className="staff-action-form" onSubmit={(e) => { e.preventDefault(); post({ action: "staff_action", tool, input: input() }); }}>
          {def.fields.map((f) => (
            <label key={f.key} className="staff-field">
              <span className="label">{f.label}</span>
              {f.kind === "choice" ? (
                <select value={values[f.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}>
                  <option value="">{f.required ? "Choose…" : "Default"}</option>
                  {f.options.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
              ) : f.kind === "toggle" ? (
                <select value={values[f.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))}>
                  <option value="">No change</option>
                  <option value="on">On</option>
                  <option value="off">Off</option>
                </select>
              ) : (
                <input className="filter-input" inputMode={f.kind === "number" ? "decimal" : undefined} placeholder={f.placeholder} value={values[f.key] ?? ""} onChange={(e) => setValues((v) => ({ ...v, [f.key]: e.target.value }))} />
              )}
            </label>
          ))}
          <div className="dev-row">
            <button className="btn btn-primary" type="submit" disabled={busy || missing}>{busy ? "Working…" : def.label}</button>
            <span className="label">The customer confirms in their app before anything changes.</span>
          </div>
        </form>
      )}
      {outcome && (
        <div className={`staff-outcome ${outcome.status === "done" ? "ok" : outcome.status === "waiting_customer" || outcome.status === "code_sent" ? "wait" : "stop"}`} role="status">
          <b>{say[outcome.status] ?? (outcome.status === "needs_supervisor" ? "Needs a supervisor." : outcome.status === "needs_second_approval" ? "Needs a second supervisor." : outcome.status === "needs_code" ? "Needs the stronger check." : "Not done.")}</b>{" "}
          {outcome.status === "code_sent" ? `Sent to ${outcome.sentTo}.` : outcome.status === "waiting_customer" ? outcome.action : outcome.message}
          {outcome.status === "needs_code" && (
            <div className="dev-row" style={{ marginTop: 8 }}>
              <button className="btn" disabled={busy} onClick={() => post({ action: "send_code" })}>Send a one-time code to the phone on file</button>
            </div>
          )}
        </div>
      )}
    </div>
  );
}
