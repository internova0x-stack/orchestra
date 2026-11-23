"use client";

import { useCallback, useEffect, useState } from "react";
import Connectors from "./Connectors";

// Managing the Orchestra API from the console: API keys for systems that call Orchestra, and webhook
// endpoints Orchestra posts to. Supervisors only (simulated sign-in, as on the other screens).

interface Staff { id: string; name: string; role: "support_agent" | "supervisor" }
interface Key { id: string; name: string; prefix: string; created_by: string; created_at: string; last_used_at: string | null; revoked_at: string | null }
interface Endpoint { id: string; url: string; events: string[]; active: boolean; created_by: string; created_at: string }
interface Delivery { id: number; url: string; event: string; status: string; attempts: number; last_status: number | null; last_error: string | null; created_at: string }

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never");

function Secret({ label, value, onDone }: { label: string; value: string; onDone: () => void }) {
  const [copied, setCopied] = useState(false);
  return (
    <div className="secret-box" role="status">
      <b>{label}</b> Copy it now: it won&apos;t be shown again.
      <pre className="dev-code">{value}</pre>
      <div className="dev-row">
        <button className="btn" onClick={() => { navigator.clipboard?.writeText(value).then(() => setCopied(true)).catch(() => {}); }}>{copied ? "Copied" : "Copy"}</button>
        <button className="btn" onClick={onDone}>Done</button>
      </div>
    </div>
  );
}

export default function ApiAdmin() {
  const [staffList, setStaffList] = useState<Staff[]>([]);
  const [staffId, setStaffId] = useState("");
  const [keys, setKeys] = useState<Key[]>([]);
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  const [keyName, setKeyName] = useState("");
  const [newKey, setNewKey] = useState<string | null>(null);
  const [url, setUrl] = useState("");
  const [chosen, setChosen] = useState<string[]>(["case.created", "case.updated"]);
  const [newSecret, setNewSecret] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const staff = staffList.find((s) => s.id === staffId) ?? null;
  const supervisor = staff?.role === "supervisor";

  const load = useCallback(async () => {
    const [k, w] = await Promise.all([
      fetch("/api/admin/keys", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
      fetch("/api/admin/webhooks", { cache: "no-store" }).then((r) => r.json()).catch(() => ({})),
    ]);
    setKeys(k.keys ?? []);
    setEndpoints(w.endpoints ?? []);
    setDeliveries(w.deliveries ?? []);
    setEvents(w.events ?? []);
  }, []);

  useEffect(() => {
    fetch("/api/staff/users", { cache: "no-store" }).then((r) => r.json()).then((j) => setStaffList(j.staff ?? [])).catch(() => {});
    try { setStaffId(localStorage.getItem("orchestra-staff") ?? ""); } catch {}
    load();
    const t = setInterval(() => document.visibilityState === "visible" && load(), 10_000);
    return () => clearInterval(t);
  }, [load]);
  const signIn = (id: string) => { setStaffId(id); try { localStorage.setItem("orchestra-staff", id); } catch {} };

  async function post(path: string, body: unknown, method = "POST") {
    setError(null);
    setMessage(null);
    const res = await fetch(path, { method, headers: { "Content-Type": "application/json" }, body: method === "DELETE" ? undefined : JSON.stringify(body) });
    const json = await res.json().catch(() => ({}));
    if (!res.ok || json.ok === false) { setError(json.error ?? "That didn't go through."); return null; }
    await load();
    return json;
  }

  return (
    <div className="dev-body">
      <div className="dev-row">
        <label className="picker">
          <span className="label">Signed in as</span>
          <select value={staffId} onChange={(e) => signIn(e.target.value)} aria-label="Staff sign-in (simulated)">
            <option value="">Choose…</option>
            {staffList.map((x) => <option key={x.id} value={x.id}>{x.name} · {x.role === "supervisor" ? "Supervisor" : "Support agent"}</option>)}
          </select>
        </label>
        <span className="label">{supervisor ? "You can manage keys and webhooks." : "A supervisor manages keys and webhooks."}</span>
      </div>
      {error && <div className="case-error" role="alert">{error}</div>}
      {message && <div className="label" role="status">{message}</div>}

      <h3 className="dev-h">API keys</h3>
      <p className="label">For systems that call Orchestra (a channel, the bank&apos;s events). Each key is shown once and stored only as a fingerprint.</p>
      {newKey && <Secret label="New API key." value={newKey} onDone={() => setNewKey(null)} />}
      <form className="dev-row" onSubmit={async (e) => { e.preventDefault(); const j = await post("/api/admin/keys", { name: keyName, staffId }); if (j) { setNewKey(j.key); setKeyName(""); } }}>
        <label className="sr-only" htmlFor="key-name">Key name</label>
        <input id="key-name" className="filter-input dev-input" placeholder="What it's for, e.g. Mobile app chat" value={keyName} onChange={(e) => setKeyName(e.target.value)} maxLength={80} />
        <button className="btn btn-primary" type="submit" disabled={!supervisor}>Create key</button>
      </form>
      {keys.length > 0 && (
        <div className="table-wrap">
          <table className="dash-table dev-table">
            <thead><tr><th scope="col">Name</th><th scope="col">Key</th><th scope="col">Created</th><th scope="col">Last used</th><th scope="col"></th></tr></thead>
            <tbody>
              {keys.map((k) => (
                <tr key={k.id}>
                  <td>{k.name}</td><td><span className="ref">{k.prefix}</span></td><td>{when(k.created_at)} · {k.created_by}</td><td>{when(k.last_used_at)}</td>
                  <td>{k.revoked_at ? <span className="tag tag-declined">Revoked</span> : <button className="copy" disabled={!supervisor} onClick={() => post(`/api/admin/keys/${k.id}?staffId=${staffId}`, null, "DELETE")}>Revoke</button>}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}

      <h3 className="dev-h">CRM and helpdesk connectors</h3>
      <p className="label">Zendesk, Freshdesk, Salesforce Service Cloud and HubSpot Service Hub. When a ticket arrives or the customer replies, the helpdesk calls Orchestra; Orchestra reads the ticket, categorises, routes and looks it up (listen mode) and writes the result into the ticket. Try each one in the sandbox, a stand-in for the product, before connecting the bank&apos;s account.</p>
      <Connectors staffId={staffId} supervisor={supervisor} />

      <h3 className="dev-h">Webhooks</h3>
      <p className="label">Where Orchestra posts what happened: a CRM or helpdesk, or the channel that delivers replies. Each delivery is signed with the endpoint&apos;s secret.</p>
      {newSecret && <Secret label="Signing secret for the new endpoint." value={newSecret} onDone={() => setNewSecret(null)} />}
      <form className="dev-stack" onSubmit={async (e) => { e.preventDefault(); const j = await post("/api/admin/webhooks", { url, events: chosen, staffId }); if (j) { setNewSecret(j.secret); setUrl(""); } }}>
        <div className="dev-row">
          <label className="sr-only" htmlFor="hook-url">Endpoint address</label>
          <input id="hook-url" className="filter-input dev-input" placeholder="https://your-crm.example/orchestra" value={url} onChange={(e) => setUrl(e.target.value)} />
          <button className="btn btn-primary" type="submit" disabled={!supervisor || !url.trim() || !chosen.length}>Add endpoint</button>
        </div>
        <fieldset className="dev-events">
          <legend className="label">Events</legend>
          {events.map((ev) => (
            <label key={ev} className="dev-check">
              <input type="checkbox" checked={chosen.includes(ev)} onChange={(e) => setChosen((c) => (e.target.checked ? [...c, ev] : c.filter((x) => x !== ev)))} />
              <span className="ref">{ev}</span>
            </label>
          ))}
        </fieldset>
      </form>
      {endpoints.length > 0 && (
        <div className="table-wrap">
          <table className="dash-table dev-table">
            <thead><tr><th scope="col">Address</th><th scope="col">Events</th><th scope="col">Added</th><th scope="col"></th></tr></thead>
            <tbody>
              {endpoints.map((e) => (
                <tr key={e.id}>
                  <td><span className="ref">{e.url}</span></td><td className="dev-desc">{e.events.join(", ")}</td><td>{when(e.created_at)} · {e.created_by}</td>
                  <td className="dev-actions">
                    <button className="copy" disabled={!supervisor} onClick={async () => { const j = await post(`/api/admin/webhooks/${e.id}`, { action: "test", staffId }); if (j) setMessage(j.delivery?.status === "delivered" ? "Test event delivered." : `Test event not delivered: ${j.delivery?.last_error ?? "no answer"}.`); }}>Send test</button>
                    <button className="copy" disabled={!supervisor} onClick={() => post(`/api/admin/webhooks/${e.id}?staffId=${staffId}`, null, "DELETE")}>Remove</button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      {deliveries.length > 0 && (
        <>
          <div className="dev-row">
            <h3 className="dev-h">Recent deliveries</h3>
            {deliveries.some((d) => d.status === "pending") && endpoints[0] && (
              <button className="btn" disabled={!supervisor} onClick={async () => { const j = await post(`/api/admin/webhooks/${endpoints[0].id}`, { action: "retry", staffId }); if (j) setMessage(`Retried ${j.retried} deliver${j.retried === 1 ? "y" : "ies"}.`); }}>Retry pending</button>
            )}
          </div>
          <div className="table-wrap">
            <table className="dash-table dev-table">
              <thead><tr><th scope="col">Event</th><th scope="col">To</th><th scope="col">Status</th><th scope="col">Attempts</th><th scope="col">When</th></tr></thead>
              <tbody>
                {deliveries.map((d) => (
                  <tr key={d.id}>
                    <td><span className="ref">{d.event}</span></td><td className="dev-desc">{d.url}</td>
                    <td><span className={`tag ${d.status === "delivered" ? "tag-live" : d.status === "failed" ? "tag-declined" : "tag-pending"}`}>{d.status === "delivered" ? "Delivered" : d.status === "failed" ? "Failed" : "Pending"}</span>{d.last_error ? <span className="label"> · {d.last_error}</span> : null}</td>
                    <td>{d.attempts}</td><td>{when(d.created_at)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </>
      )}
    </div>
  );
}
