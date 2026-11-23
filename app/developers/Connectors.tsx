"use client";

import { useCallback, useEffect, useState } from "react";

// The four CRM connectors on the API page: each one off, in the sandbox (a stand-in for the product, to try it) or
// live (the bank's account, credentials in Vercel's environment variables). Supervisors change them.

interface Write { id: number; method: string; path: string; body: unknown; at: string }
interface Conn {
  kind: string; name: string; mode: "off" | "sandbox" | "live"; write_back: boolean; data_entry: boolean;
  groups: Record<string, string>; envReady: boolean; envNeeded: string[]; sample: unknown; writes: Write[]; updated_by: string | null;
}

const toLines = (g: Record<string, string>) => Object.entries(g).map(([t, id]) => `${t} = ${id}`).join("\n");
const fromLines = (s: string) => Object.fromEntries(s.split("\n").map((l) => l.split("=").map((x) => x.trim())).filter((p) => p.length === 2 && p[0] && p[1]));

export default function Connectors({ staffId, supervisor }: { staffId: string; supervisor: boolean }) {
  const [list, setList] = useState<Conn[]>([]);
  const [msg, setMsg] = useState<Record<string, string>>({});
  const [groups, setGroups] = useState<Record<string, string>>({});
  const [busy, setBusy] = useState<string | null>(null);

  const load = useCallback(async () => {
    const j = await fetch("/api/admin/connectors", { cache: "no-store" }).then((r) => r.json()).catch(() => ({}));
    setList(j.connectors ?? []);
    setGroups((g) => Object.fromEntries((j.connectors ?? []).map((c: Conn) => [c.kind, g[c.kind] ?? toLines(c.groups)])));
  }, []);
  useEffect(() => { load(); }, [load]);

  async function post(kind: string, body: object, done?: (j: Record<string, unknown>) => string) {
    setBusy(kind);
    setMsg((m) => ({ ...m, [kind]: "" }));
    const res = await fetch("/api/admin/connectors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ ...body, kind, staffId }) });
    const j = await res.json().catch(() => ({}));
    setMsg((m) => ({ ...m, [kind]: !res.ok || j.ok === false ? (j.error ?? j.message ?? "That didn't go through.") : done ? done(j) : "Saved." }));
    setBusy(null);
    await load();
  }

  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return (
    <div className="dev-stack">
      {list.map((c) => (
        <div key={c.kind} className="connector">
          <div className="dev-row">
            <b>{c.name}</b>
            <span className={`tag ${c.mode === "live" ? "tag-live" : c.mode === "sandbox" ? "tag-pending" : ""}`}>{c.mode === "live" ? "Live" : c.mode === "sandbox" ? "Sandbox" : "Off"}</span>
            <span className="label">{c.envReady ? "Credentials set" : `Live needs ${c.envNeeded.join(", ")} in Vercel`}</span>
          </div>
          <div className="segmented" role="radiogroup" aria-label={`${c.name} mode`}>
            {(["off", "sandbox", "live"] as const).map((m) => (
              <button key={m} className="btn" role="radio" aria-checked={c.mode === m} disabled={!supervisor || busy === c.kind || (m === "live" && !c.envReady)}
                onClick={() => post(c.kind, { mode: m })}>{m === "off" ? "Off" : m === "sandbox" ? "Sandbox (stand-in)" : "Live account"}</button>
            ))}
          </div>
          <label className="dev-check"><input type="checkbox" checked={c.write_back} disabled={!supervisor} onChange={(e) => post(c.kind, { write_back: e.target.checked })} /> Write the result into the ticket (tags, priority, team, internal note)</label>
          <label className="dev-check"><input type="checkbox" checked={c.data_entry} disabled={!supervisor} onChange={(e) => post(c.kind, { data_entry: e.target.checked })} /> Data entry: record each conversation Orchestra handles as a ticket, with its case notes and outcome</label>
          <label className="staff-field">
            <span className="label">Teams → {c.kind === "salesforce" ? "queue ids" : c.kind === "hubspot" ? "owner ids" : "group ids"} (one per line: Payments team = 360001234)</span>
            <textarea className="reply-box" rows={3} value={groups[c.kind] ?? ""} onChange={(e) => setGroups((g) => ({ ...g, [c.kind]: e.target.value }))} disabled={!supervisor} />
          </label>
          <div className="dev-row">
            <button className="btn" disabled={!supervisor || busy === c.kind} onClick={() => post(c.kind, { groups: fromLines(groups[c.kind] ?? "") })}>Save teams</button>
            {c.mode === "sandbox" && (
              <button className="btn btn-primary" disabled={!supervisor || busy === c.kind} onClick={() => post(c.kind, { action: "test" }, (j) => j.written_back ? "The test ticket was read, analysed and written back. See below, and the Inbox." : j.analysed ? "Analysed; nothing written back (write-back is off)." : "Received: nothing new to analyse (already seen; Reset demo to try again).")}>
                {busy === c.kind ? "Working…" : "Send the test ticket"}
              </button>
            )}
            {msg[c.kind] && <span className="label" role="status">{msg[c.kind]}</span>}
          </div>
          <details>
            <summary className="label">Set it up in {c.name}</summary>
            <p className="label">Point a webhook ({c.kind === "zendesk" ? "Admin Center → Webhooks, called by a trigger on ticket created or updated by the requester" : c.kind === "freshdesk" ? "Admin → Automations → Ticket creation and updates → Trigger webhook" : c.kind === "salesforce" ? "a record-triggered Flow on Case with an HTTP callout" : "a ticket workflow with Send a webhook"}) at this address, with an Orchestra API key as the bearer token, sending this body:</p>
            <pre className="dev-code">{`POST ${origin}/api/v1/connectors/${c.kind}/webhook\nAuthorization: Bearer orc_…\n\n${JSON.stringify(c.sample, null, 2)}`}</pre>
          </details>
          {c.mode === "sandbox" && c.writes.length > 0 && (
            <details open>
              <summary className="label">What Orchestra wrote into the stand-in {c.name} ({c.writes.length})</summary>
              <ul className="claim-list">
                {c.writes.map((w) => <li key={w.id}><span className="ref">{w.method} {w.path}</span><pre className="dev-code">{JSON.stringify(w.body, null, 2)}</pre></li>)}
              </ul>
            </details>
          )}
        </div>
      ))}
    </div>
  );
}
