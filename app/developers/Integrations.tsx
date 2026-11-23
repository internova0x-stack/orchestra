"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// The API page (Tomi, Nov 23: "use it for the whole api page"): every connection in one list, grouped like an app's
// plugin list: Needs attention, Active, Not active. A row shows what it is and its state in one line, a fix button when
// something's wrong, and a ··· menu; selecting it opens its settings beside the list. Connections: the bank (Bank
// Connector API), the four CRM connectors, webhook endpoints and API keys. Operations and IT admins change them;
// supervisors and compliance can look.

interface Field { id: string; label: string; placeholder: string; secret?: boolean; suffix?: string; hint?: string }
interface Health { state: "attention" | "active" | "off" | "demo"; label: string | null; fix: "setup" | "reconnect" | "errors" | null; failures: number }
interface Conn {
  kind: string; name: string; mode: "off" | "sandbox" | "live"; write_back: boolean; data_entry: boolean; groups: Record<string, string>;
  envReady: boolean; envNeeded: string[]; fromTeam: boolean; fields: Field[]; webhookPath: string | null; account: string | null; secret_last4: string | null; sample: unknown; health: Health; ticketsWeek: number; last_error: string | null; last_received_at: string | null;
  activity: { id: number; kind: string; summary: string; created_at: string }[]; writes: { id: number; method: string; path: string; body: unknown; at: string }[];
}
interface Key { id: string; name: string; prefix: string; created_by: string; created_at: string; last_used_at: string | null; revoked_at: string | null }
interface Endpoint { id: string; url: string; events: string[]; active: boolean; created_by: string; created_at: string }
interface Delivery { id: number; endpoint_id: string; url: string; event: string; status: string; attempts: number; last_status: number | null; last_error: string | null; created_at: string }
interface Bank { mode: "simulated" | "live"; host: string | null; urlSet: boolean; keySet: boolean; lookupsWeek: number; referenceServer: string }

type Tab = "all" | "connectors" | "webhooks" | "keys";
type Tone = "warn" | "ok" | "info" | "muted";
interface Item {
  id: string; tab: Exclude<Tab, "all">; name: string; sub: string; letter: string; tile: 1 | 2 | 3 | 4 | 5;
  state: "attention" | "active" | "off" | "demo"; chip: { text: string; tone: Tone } | null;
  primary: { label: string; run: () => void } | null;
  menu: { label: string; run: () => void; danger?: boolean }[];
}

const when = (iso: string | null) => (iso ? new Date(iso).toLocaleString("en-GB", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" }) : "never");
const ago = (iso: string) => {
  const m = Math.max(0, Math.round((Date.now() - new Date(iso).getTime()) / 60000));
  return m < 60 ? `${m} min` : m < 1440 ? `${Math.round(m / 60)} h` : `${Math.round(m / 1440)} d`;
};
const toLines = (g: Record<string, string>) => Object.entries(g).map(([t, id]) => `${t} = ${id}`).join("\n");
const fromLines = (s: string) => Object.fromEntries(s.split("\n").map((l) => l.split("=").map((x) => x.trim())).filter((p) => p.length === 2 && p[0] && p[1]));
const TILE: Record<string, 1 | 2 | 3 | 4 | 5> = { zendesk: 1, freshdesk: 2, salesforce: 3, hubspot: 4 };

export default function Integrations() {
  const [conns, setConns] = useState<Conn[]>([]);
  const [keys, setKeys] = useState<Key[]>([]);
  const [endpoints, setEndpoints] = useState<Endpoint[]>([]);
  const [deliveries, setDeliveries] = useState<Delivery[]>([]);
  const [events, setEvents] = useState<string[]>([]);
  const [bankInfo, setBankInfo] = useState<Bank | null>(null);
  const [canManage, setCanManage] = useState(false);
  const [tab, setTab] = useState<Tab>("all");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string>("bank");
  const [menuFor, setMenuFor] = useState<string | null>(null);
  const [adding, setAdding] = useState<"key" | "webhook" | null>(null);
  const [secret, setSecret] = useState<{ label: string; value: string } | null>(null);
  const [note, setNote] = useState<{ text: string; tone: "ok" | "stop" } | null>(null);
  const [busy, setBusy] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [loadFailed, setLoadFailed] = useState(false);
  const seq = useRef(0);

  // Every load is numbered and only the newest one is applied, so a slow background refresh that started
  // before a click can't put the old state back. An answer that fails keeps what's on screen.
  const load = useCallback(async () => {
    const mine = ++seq.current;
    const get = (u: string) => fetch(u, { cache: "no-store" }).then((r) => (r.ok ? r.json() : null)).catch(() => null);
    const [c, k, w, b, me] = await Promise.all([get("/api/admin/connectors"), get("/api/admin/keys"), get("/api/admin/webhooks"), get("/api/admin/bank"), get("/api/staff/users")]);
    if (mine !== seq.current) return false;
    if (c) setConns(c.connectors ?? []);
    if (k) setKeys(k.keys ?? []);
    if (w) { setEndpoints(w.endpoints ?? []); setDeliveries(w.deliveries ?? []); setEvents(w.events ?? []); }
    if (b) setBankInfo(b.mode ? b : null);
    if (me) setCanManage((me.permissions ?? []).includes("api_manage"));
    const ok = Boolean(c || b);
    setLoadFailed(!ok);
    if (ok) setLoaded(true);
    return ok;
  }, []);
  useEffect(() => {
    // The first load retries once on its own (a server waking up can miss the first answer).
    load().then((ok) => { if (!ok) setTimeout(load, 2500); });
    const t = setInterval(() => document.visibilityState === "visible" && load(), 15_000);
    return () => clearInterval(t);
  }, [load]);
  useEffect(() => {
    const close = () => setMenuFor(null);
    window.addEventListener("click", close);
    return () => window.removeEventListener("click", close);
  }, []);

  async function call(url: string, body: unknown, method = "POST", ok?: (j: Record<string, unknown>) => string | null) {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(url, { method, headers: { "Content-Type": "application/json" }, body: method === "DELETE" ? undefined : JSON.stringify(body) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || j.ok === false) { setNote({ text: j.error ?? j.message ?? "That didn't go through.", tone: "stop" }); return null; }
      const msg = ok?.(j);
      if (msg) setNote({ text: msg, tone: "ok" });
      await load();
      return j;
    } finally {
      setBusy(false);
    }
  }
  const crm = async (kind: string, body: { mode?: string; [k: string]: unknown }, ok?: (j: Record<string, unknown>) => string | null) => {
    const j = await call("/api/admin/connectors", { ...body, kind }, "POST", ok);
    // Move it at once; the reload that follows confirms it.
    if (j && body.mode) setConns((cs) => cs.map((c) => (c.kind === kind ? { ...c, mode: body.mode as Conn["mode"], health: body.mode === "off" ? { ...c.health, state: "off" } : c.health.state === "off" ? { ...c.health, state: "active" } : c.health } : c)));
    return j;
  };
  /** Connect a bank's own helpdesk: the error comes back to the form, not the top of the list. */
  async function connectCrm(kind: string, name: string, fields: Record<string, string>): Promise<string | null> {
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch("/api/admin/connectors", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ kind, action: "connect", fields }) });
      const j = await res.json().catch(() => ({}));
      if (!res.ok || !j.ok) return j.error ?? "That didn't go through. Try again.";
      setNote({ text: `✓ Connected to ${j.account}. Now step 2: tell ${name.split(" ")[0]} about new tickets.`, tone: "ok" });
      await load();
      return null;
    } catch {
      return "That didn't go through. Check the connection and try again.";
    } finally {
      setBusy(false);
    }
  }
  const open = (id: string) => { setSelected(id); setAdding(null); setNote(null); };

  // Every connection as a row.
  const items: Item[] = useMemo(() => {
    const out: Item[] = [];
    if (bankInfo) {
      const live = bankInfo.mode === "live";
      const half = bankInfo.urlSet !== bankInfo.keySet;
      out.push({
        id: "bank", tab: "connectors", name: "Bank Connector", letter: "B", tile: 5,
        sub: `Bank records and actions · ${live ? `your bank at ${bankInfo.host}` : "the simulated bank (invented data)"} · ${bankInfo.lookupsWeek} lookup${bankInfo.lookupsWeek === 1 ? "" : "s"} this week`,
        state: half ? "attention" : "active", chip: half ? { text: "Settings incomplete", tone: "warn" } : live ? { text: "✓ Live", tone: "ok" } : { text: "Simulated", tone: "info" },
        primary: half ? { label: "Set up", run: () => open("bank") } : null,
        menu: [{ label: "Settings", run: () => open("bank") }, { label: "Download the OpenAPI file", run: () => window.open("/openapi/bank-connector-v1.yaml") }],
      });
    }
    for (const c of conns) {
      const h = c.health;
      const short = c.name.split(" ")[0];
      const live = c.mode === "live", demo = c.mode === "sandbox", waiting = live && !c.last_received_at;
      out.push({
        id: `crm:${c.kind}`, tab: "connectors", name: c.name, letter: c.name[0], tile: TILE[c.kind] ?? 5,
        sub: c.mode === "off" ? "Helpdesk · Not connected"
          : demo ? `Demo · a pretend ${short} with sample tickets · nothing real connected`
          : `Helpdesk · ${c.fromTeam ? "the Orchestra team's test account" : c.account ?? short} · ${waiting ? "waiting for the first ticket" : `${c.ticketsWeek} ticket${c.ticketsWeek === 1 ? "" : "s"} this week · last ${ago(c.last_received_at!)} ago`}`,
        state: h.state,
        chip: h.state === "attention" ? { text: h.label!, tone: "warn" } : demo ? { text: "Demo", tone: "warn" } : waiting ? { text: "Step 2 to do", tone: "warn" } : live ? { text: "✓ Connected", tone: "ok" } : null,
        primary: !canManage ? null
          : h.fix === "reconnect" ? { label: "Reconnect", run: () => crm(c.kind, { action: "reconnect" }, () => `${c.name} is working again.`) }
          : h.fix === "errors" ? { label: "See errors", run: () => open(`crm:${c.kind}`) }
          : c.mode === "off" ? { label: "Connect", run: () => open(`crm:${c.kind}`) }
          : waiting ? { label: "Finish setup", run: () => open(`crm:${c.kind}`) }
          : { label: demo ? "End demo" : "Disconnect", run: () => crm(c.kind, { action: "disconnect", mode: "off" }, () => demo ? "Demo ended." : `${c.name} is disconnected and its stored details removed.`) },
        menu: [
          { label: c.mode === "off" ? "Connect" : "Settings", run: () => open(`crm:${c.kind}`) },
          ...(canManage && demo ? [{ label: "Send a sample ticket", run: () => crm(c.kind, { action: "test" }, (j) => j.written_back ? "Sample ticket read, analysed and written back." : "Received: nothing new to analyse.") }] : []),
          ...(canManage && live && c.webhookPath ? [{ label: "Copy webhook address", run: () => { navigator.clipboard?.writeText(`${window.location.origin}${c.webhookPath}`).catch(() => {}); setNote({ text: "Webhook address copied. Keep it private.", tone: "ok" }); } }] : []),
          ...(canManage && c.mode !== "off" ? [{ label: demo ? "End the demo" : "Disconnect", run: () => crm(c.kind, { action: "disconnect", mode: "off" }, () => demo ? "Demo ended." : `${c.name} is disconnected.`), danger: true }] : []),
        ],
      });
    }
    for (const e of endpoints) {
      const mine = deliveries.filter((d) => d.endpoint_id === e.id);
      const lastFail = mine[0] && mine[0].status !== "delivered" && mine[0].attempts > 0;
      out.push({
        id: `hook:${e.id}`, tab: "webhooks", name: e.url.replace(/^https:\/\//, ""), letter: "W", tile: 5,
        sub: `Webhook · ${e.events.length} event${e.events.length === 1 ? "" : "s"} · added by ${e.created_by}${mine[0] ? ` · last sent ${ago(mine[0].created_at)} ago` : " · nothing sent yet"}`,
        state: !e.active ? "off" : lastFail ? "attention" : "active",
        chip: !e.active ? null : lastFail ? { text: "Deliveries failing", tone: "warn" } : { text: "✓ On", tone: "ok" },
        primary: !canManage ? null : !e.active ? { label: "Turn on", run: () => call(`/api/admin/webhooks/${e.id}`, { action: "turn_on" }, "POST", () => "Turned on.") }
          : lastFail ? { label: "Retry", run: () => call(`/api/admin/webhooks/${e.id}`, { action: "retry" }, "POST", (j) => `Retried ${j.retried} deliver${j.retried === 1 ? "y" : "ies"}.`) } : null,
        menu: [
          { label: "Settings", run: () => open(`hook:${e.id}`) },
          ...(canManage && e.active ? [{ label: "Send a test event", run: () => call(`/api/admin/webhooks/${e.id}`, { action: "test" }, "POST", (j) => (j.delivery as { status?: string })?.status === "delivered" ? "Test event delivered." : `Not delivered: ${(j.delivery as { last_error?: string })?.last_error ?? "no answer"}.`) }] : []),
          ...(canManage && e.active ? [{ label: "Turn off", run: () => call(`/api/admin/webhooks/${e.id}`, { action: "turn_off" }, "POST", () => "Turned off.") }] : []),
          ...(canManage ? [{ label: "Delete", run: () => call(`/api/admin/webhooks/${e.id}`, null, "DELETE", () => "Endpoint deleted."), danger: true }] : []),
        ],
      });
    }
    for (const k of keys) {
      out.push({
        id: `key:${k.id}`, tab: "keys", name: k.name, letter: "K", tile: 5,
        sub: `API key ${k.prefix} · created by ${k.created_by} · ${k.revoked_at ? `revoked ${when(k.revoked_at)}` : `last used ${when(k.last_used_at)}`}`,
        state: k.revoked_at ? "off" : "active", chip: k.revoked_at ? null : { text: "✓ Active", tone: "ok" }, primary: null,
        menu: [{ label: "Details", run: () => open(`key:${k.id}`) }, ...(canManage && !k.revoked_at ? [{ label: "Revoke", run: () => call(`/api/admin/keys/${k.id}`, null, "DELETE", () => "Key revoked: it stops working at once."), danger: true }] : [])],
      });
    }
    return out;
  }, [bankInfo, conns, endpoints, deliveries, keys, canManage]); // eslint-disable-line react-hooks/exhaustive-deps

  const shown = items.filter((i) => (tab === "all" || i.tab === tab) && (!q.trim() || `${i.name} ${i.sub}`.toLowerCase().includes(q.trim().toLowerCase())));
  const groups: [string, Item[]][] = [
    ["Needs attention", shown.filter((i) => i.state === "attention")],
    ["Active", shown.filter((i) => i.state === "active")],
    ["Not active", shown.filter((i) => i.state === "off")],
    ...(shown.some((i) => i.state === "demo") ? [["Demos", shown.filter((i) => i.state === "demo")] as [string, Item[]]] : []),
  ];

  return (
    <div className="int">
      <div className="int-list">
        <div className="int-bar">
          <label className="sr-only" htmlFor="int-q">Filter connections</label>
          <input id="int-q" className="int-search" placeholder="Filter connections" value={q} onChange={(e) => setQ(e.target.value)} />
          <div className="int-seg" role="tablist" aria-label="Show">
            {(["all", "connectors", "webhooks", "keys"] as Tab[]).map((t) => (
              <button key={t} role="tab" aria-selected={tab === t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
                {t === "all" ? "All" : t === "connectors" ? "Connectors" : t === "webhooks" ? "Webhooks" : "API keys"}
              </button>
            ))}
          </div>
          {canManage && tab !== "connectors" && (
            <div className="int-add">
              {(tab === "all" || tab === "keys") && <button className="btn btn-primary" onClick={() => { setAdding("key"); setSelected(""); }}>Create an API key</button>}
              {(tab === "all" || tab === "webhooks") && <button className="btn" onClick={() => { setAdding("webhook"); setSelected(""); }}>Add a webhook</button>}
            </div>
          )}
        </div>
        {note && <div className={`int-note ${note.tone}`} role="status">{note.text}</div>}
        {loadFailed && (
          <div className="int-note stop" role="alert">
            The connections didn&apos;t load. <button className="copy" onClick={() => load()}>Try again</button>
          </div>
        )}
        {!loaded && !loadFailed && <p className="label int-empty">Loading connections…</p>}
        {loaded && groups.map(([title, list]) => (
          <section key={title} aria-label={title}>
            <h3 className="int-h">{title} <span className="int-count">{list.length}</span></h3>
            {list.length === 0 && <p className="label int-empty">{title === "Needs attention" ? "Nothing needs attention." : title === "Not active" ? "Turned-off connections appear here, with a way to turn them back on." : "Nothing active yet."}</p>}
            {list.map((i) => (
              <div key={i.id} className={`int-row${selected === i.id ? " sel" : ""}`} onClick={() => open(i.id)} role="button" tabIndex={0} onKeyDown={(e) => { if (e.key === "Enter") open(i.id); }}>
                <span className={`int-tile t${i.tile}`} aria-hidden="true">{i.letter}</span>
                <span className="int-text"><span className="int-name">{i.name}</span><span className="int-sub">{i.sub}</span></span>
                {i.chip ? <span className={`int-chip ${i.chip.tone}`}>{i.chip.text}</span> : <span />}
                {i.primary ? <button className="btn" disabled={busy} onClick={(e) => { e.stopPropagation(); i.primary!.run(); }}>{i.primary.label}</button> : <span />}
                <span className="int-more">
                  <button className="int-dots" aria-label={`More for ${i.name}`} onClick={(e) => { e.stopPropagation(); setMenuFor(menuFor === i.id ? null : i.id); }}>···</button>
                  {menuFor === i.id && (
                    <span className="int-menu" role="menu" onClick={(e) => e.stopPropagation()}>
                      {i.menu.map((m) => <button key={m.label} role="menuitem" className={m.danger ? "danger" : ""} onClick={() => { setMenuFor(null); m.run(); }}>{m.label}</button>)}
                    </span>
                  )}
                </span>
              </div>
            ))}
          </section>
        ))}
      </div>

      <aside className="int-panel" aria-label="Settings">
        {secret && (
          <div className="secret-box" role="status">
            <b>{secret.label}</b> Copy it now: it won&apos;t be shown again.
            <pre className="dev-code">{secret.value}</pre>
            <div className="dev-row">
              <button className="btn" onClick={() => navigator.clipboard?.writeText(secret.value).catch(() => {})}>Copy</button>
              <button className="btn" onClick={() => setSecret(null)}>Done</button>
            </div>
          </div>
        )}
        {adding === "key" && <AddKey busy={busy} onAdd={async (name) => { const j = await call("/api/admin/keys", { name }, "POST", () => "Key created."); if (j) setSecret({ label: "New API key.", value: String(j.key) }); }} />}
        {adding === "webhook" && <AddWebhook events={events} busy={busy} onAdd={async (url, evs) => { const j = await call("/api/admin/webhooks", { url, events: evs }, "POST", () => "Endpoint added."); if (j) setSecret({ label: "Signing secret for the new endpoint.", value: String(j.secret) }); }} />}
        {!adding && selected === "bank" && bankInfo && <BankPanel b={bankInfo} />}
        {!adding && selected.startsWith("crm:") && (() => {
          const c = conns.find((x) => `crm:${x.kind}` === selected);
          return c ? <CrmPanel c={c} canManage={canManage} busy={busy} act={(body, ok) => crm(c.kind, body as { mode?: string }, ok)} onReload={() => load()} onConnect={(fields) => connectCrm(c.kind, c.name, fields)} /> : null;
        })()}
        {!adding && selected.startsWith("hook:") && (() => {
          const e = endpoints.find((x) => `hook:${x.id}` === selected);
          return e ? <HookPanel e={e} deliveries={deliveries.filter((d) => d.endpoint_id === e.id)} /> : null;
        })()}
        {!adding && selected.startsWith("key:") && (() => {
          const k = keys.find((x) => `key:${x.id}` === selected);
          return k ? (
            <div>
              <PanelHead letter="K" tile={5} name={k.name} sub={k.revoked_at ? "Revoked" : "Active"} />
              <dl className="summary">
                <div><dt>Key</dt><dd className="ref">{k.prefix}</dd></div>
                <div><dt>Created</dt><dd>{when(k.created_at)} by {k.created_by}</dd></div>
                <div><dt>Last used</dt><dd>{when(k.last_used_at)}</dd></div>
              </dl>
              <p className="label">The key itself was shown once when it was created and is stored only as a fingerprint. Revoke it and create a new one if it may have leaked.</p>
            </div>
          ) : null;
        })()}
        {!adding && !selected && !secret && <p className="label">Choose a connection to see its settings.</p>}
      </aside>
    </div>
  );
}

function PanelHead({ letter, tile, name, sub }: { letter: string; tile: number; name: string; sub: string }) {
  return (
    <div className="int-ph">
      <span className={`int-tile t${tile}`} aria-hidden="true">{letter}</span>
      <span><span className="int-name">{name}</span><span className="int-sub">{sub}</span></span>
    </div>
  );
}

function Toggle({ on, label, hint, disabled, onChange }: { on: boolean; label: string; hint: string; disabled: boolean; onChange: (v: boolean) => void }) {
  return (
    <div className="int-sw">
      <span><span>{label}</span><span className="int-sub">{hint}</span></span>
      <button role="switch" aria-checked={on} aria-label={label} className={`int-toggle${on ? " on" : ""}`} disabled={disabled} onClick={() => onChange(!on)} />
    </div>
  );
}

const SHORT: Record<string, string> = { zendesk: "Zendesk", freshdesk: "Freshdesk", salesforce: "Salesforce", hubspot: "HubSpot" };

/** Where to paste the webhook address in each product, and what to send (step 2). */
const HOOK_STEPS: Record<string, string[]> = {
  zendesk: [
    "Admin Center → Apps and integrations → Webhooks → Create webhook: choose Trigger or automation, paste the address, method POST, format JSON.",
    "Objects and rules → Triggers → Add trigger: when a ticket is created (and when the requester replies), action Notify webhook, this webhook.",
    "Use this as the trigger's body: {\"ticket_id\": \"{{ticket.id}}\"}",
  ],
  freshdesk: [
    "Admin → Automations → Ticket creation → New rule.",
    "Action Trigger webhook: method POST, paste the address, content JSON.",
    "Body: {\"ticket_id\": \"{{ticket.id}}\"}",
  ],
  salesforce: [
    "Setup → Flows → New record-triggered flow on Case, when a record is created.",
    "Add an HTTP callout (POST) to the address, sending the Case's Id as caseId.",
    "Activate the flow.",
  ],
  hubspot: [
    "Automation → Workflows → create a ticket-based workflow, enrolled when a ticket is created.",
    "Add the action Send a webhook: method POST, paste the address.",
    "Turn the workflow on. HubSpot sends the ticket's id with each call.",
  ],
};

function ConnectForm({ c, busy, onConnect, onDemo, replacing, onCancel }: {
  c: Conn; busy: boolean; onConnect: (fields: Record<string, string>) => Promise<string | null>; onDemo?: () => void; replacing?: boolean; onCancel?: () => void;
}) {
  const [values, setValues] = useState<Record<string, string>>({});
  const [error, setError] = useState<string | null>(null);
  const ready = c.fields.every((f) => (values[f.id] ?? "").trim());
  const name = SHORT[c.kind] ?? c.name;
  return (
    <form className="int-form" onSubmit={async (e) => { e.preventDefault(); setError(null); const err = await onConnect(values); if (err) setError(err); }}>
      {c.fields.map((f) => (
        <label key={f.id} className="int-field">
          <span>{f.label}</span>
          <span className="int-input">
            <input type={f.secret ? "password" : "text"} autoComplete="off" spellCheck={false} placeholder={f.placeholder} value={values[f.id] ?? ""}
              onChange={(e) => setValues((v) => ({ ...v, [f.id]: e.target.value }))} />
            {f.suffix && <span className="int-suffix">{f.suffix}</span>}
          </span>
          {f.hint && <span className="label">{f.hint}{f.secret ? " Stored encrypted, never shown again." : ""}</span>}
        </label>
      ))}
      {error && <div className="int-alert" role="alert">{error}</div>}
      <div className="int-actions">
        <button className="btn btn-primary" type="submit" disabled={!ready || busy}>{busy ? "Checking with " + name + "…" : replacing ? "Test and replace" : "Test and connect"}</button>
        {!ready && !busy && <span className="label">Fill in {c.fields.length === 1 ? "the field" : `all ${c.fields.length}`} first</span>}
        {onCancel && <button type="button" className="copy" onClick={onCancel}>Cancel</button>}
      </div>
      {onDemo && <p className="label int-demo-line">No {name} account? <button type="button" className="copy" onClick={onDemo}>Try a demo instead</button>: a pretend {name} with sample tickets. Nothing real is connected.</p>}
    </form>
  );
}

function CrmPanel({ c, canManage, busy, act, onReload, onConnect }: {
  c: Conn; canManage: boolean; busy: boolean; act: (body: object, ok?: (j: Record<string, unknown>) => string | null) => Promise<unknown>;
  onReload: () => void; onConnect: (fields: Record<string, string>) => Promise<string | null>;
}) {
  const [groups, setGroups] = useState(toLines(c.groups));
  const [replace, setReplace] = useState(false);
  const [showHook, setShowHook] = useState(false);
  const [copied, setCopied] = useState(false);
  useEffect(() => { setGroups(toLines(c.groups)); }, [c.kind, c.groups]);
  useEffect(() => { setReplace(false); setShowHook(false); }, [c.kind, c.mode]);
  const unit = c.kind === "salesforce" ? "queues" : c.kind === "hubspot" ? "owners" : "groups";
  const name = SHORT[c.kind] ?? c.name;
  const address = c.webhookPath ? `${typeof window !== "undefined" ? window.location.origin : ""}${c.webhookPath}` : null;
  const connect = onConnect;

  const hookBox = address && (
    <div className="int-hook">
      <div className="int-addr"><span className="ref">{address}</span>
        <button className="btn" onClick={() => { navigator.clipboard?.writeText(address).then(() => { setCopied(true); setTimeout(() => setCopied(false), 2000); }).catch(() => {}); }}>{copied ? "Copied" : "Copy"}</button></div>
      <ol className="int-steps label">{HOOK_STEPS[c.kind].map((s) => <li key={s}>{s}</li>)}</ol>
      <p className="label">Keep this address private: anyone with it can send tickets to Orchestra.</p>
    </div>
  );

  const settings = (
    <>
      <Toggle on={c.write_back} label="Write findings into the ticket" hint="tags, priority, team, internal note" disabled={!canManage || busy} onChange={(v) => act({ write_back: v })} />
      <Toggle on={c.data_entry} label="Data entry" hint="record Orchestra's own conversations as tickets" disabled={!canManage || busy} onChange={(v) => act({ data_entry: v })} />
      <h4 className="int-lbl">Teams → {name} {unit}</h4>
      <textarea className="reply-box" rows={3} value={groups} onChange={(e) => setGroups(e.target.value)} disabled={!canManage} aria-label={`Teams to ${unit}`} placeholder="Payments team = 360001234" />
      {canManage && <button className="btn" disabled={busy} onClick={() => act({ groups: fromLines(groups) }, () => "Teams saved.")}>Save teams</button>}
      <h4 className="int-lbl">Recent activity</h4>
      {c.activity.length === 0 ? <p className="label">Nothing yet.</p> : (
        <ul className="int-act">{c.activity.map((a) => <li key={a.id} className={a.kind === "error" ? "bad" : ""}><span>{a.summary.replace(`${c.name} connector · `, "Settings changed: ").replace(`${c.name} `, "").replace(/^· /, "")}</span><span className="int-sub">{ago(a.created_at)}</span></li>)}</ul>
      )}
    </>
  );

  // Not connected: the form.
  if (c.mode === "off") return (
    <div>
      <PanelHead letter={c.name[0]} tile={TILE[c.kind] ?? 5} name={`Connect ${c.name}`} sub="Orchestra reads new tickets, sorts them and writes its findings back as tags and an internal note." />
      <div className="int-stepper"><span className="on">1 · Your account</span><span>2 · New tickets</span></div>
      {canManage ? <ConnectForm c={c} busy={busy} onConnect={connect} onDemo={() => act({ mode: "sandbox" }, () => `${c.name} demo is on: a pretend ${name} with sample tickets.`)} />
        : <p className="label">An operations or IT admin connects {name}.</p>}
    </div>
  );

  // A demo: pretend product.
  if (c.mode === "sandbox") return (
    <div>
      <PanelHead letter={c.name[0]} tile={TILE[c.kind] ?? 5} name={`${c.name} demo`} sub={`A pretend ${name} inside Orchestra with sample tickets. Nothing real is connected.`} />
      {canManage && <div className="int-actions">
        <button className="btn btn-primary" disabled={busy} onClick={() => act({ action: "test" }, (j) => j.written_back ? "Sample ticket read, analysed and written back." : "Received: nothing new to analyse.")}>Send a sample ticket</button>
        <button className="btn" disabled={busy} onClick={() => act({ action: "disconnect" }, () => "Demo ended.")}>End the demo</button>
      </div>}
      {canManage && (replace
        ? <><h4 className="int-lbl">Connect your real {name}</h4><ConnectForm c={c} busy={busy} onConnect={connect} onCancel={() => setReplace(false)} /></>
        : <p className="label">Ready for the real thing? <button className="copy" onClick={() => setReplace(true)}>Connect your {name} account</button></p>)}
      {settings}
      {c.writes.length > 0 && (
        <details className="int-more-info">
          <summary>What Orchestra wrote into the pretend {name} ({c.writes.length})</summary>
          <ul className="claim-list">{c.writes.map((w) => <li key={w.id}><span className="ref">{w.method} {w.path}</span><pre className="dev-code">{JSON.stringify(w.body, null, 2)}</pre></li>)}</ul>
        </details>
      )}
    </div>
  );

  // Live, waiting for the first ticket: step 2.
  const waiting = !c.last_received_at;
  return (
    <div>
      <PanelHead letter={c.name[0]} tile={TILE[c.kind] ?? 5} name={c.name} sub={c.fromTeam ? "Connected with the Orchestra team's test account" : `Connected to ${c.account}${c.secret_last4 ? ` · ending ${c.secret_last4}` : ""}`} />
      {c.health.state === "attention" && (
        <div className="int-alert" role="alert"><b>{c.health.label}.</b> {c.last_error}{c.health.failures > 0 && ` ${c.health.failures} of the last 20 calls failed.`}</div>
      )}
      {waiting ? (
        <>
          <div className="int-stepper"><span className="done">✓ Your account</span><span className="on">2 · New tickets</span></div>
          <p>So Orchestra hears about each new ticket, add this address in {name}:</p>
          {hookBox}
          <div className="int-actions"><button className="btn" onClick={onReload}>Check for the first ticket</button><span className="label">It turns green when one arrives.</span></div>
          <hr className="int-hr" />
        </>
      ) : (
        <p className="label">Last ticket {ago(c.last_received_at!)} ago · {c.ticketsWeek} this week.</p>
      )}
      {canManage && (
        <div className="int-actions">
          {!c.fromTeam && <button className="btn" onClick={() => setReplace((v) => !v)} aria-expanded={replace}>Replace details</button>}
          {!waiting && <button className="btn" onClick={() => setShowHook((v) => !v)} aria-expanded={showHook}>Webhook address</button>}
          <button className="btn int-danger" disabled={busy} onClick={() => act({ action: "disconnect" }, () => `${c.name} is disconnected and its stored details removed.`)}>Disconnect</button>
        </div>
      )}
      {replace && <ConnectForm c={c} busy={busy} replacing onConnect={async (f) => { const e = await connect(f); if (!e) setReplace(false); return e; }} onCancel={() => setReplace(false)} />}
      {showHook && !waiting && hookBox}
      {settings}
    </div>
  );
}

function BankPanel({ b }: { b: Bank }) {
  return (
    <div>
      <PanelHead letter="B" tile={5} name="Bank Connector" sub={b.mode === "live" ? `Live · your bank at ${b.host}` : "The simulated bank (invented data)"} />
      <p className="label">How Orchestra reads the bank&apos;s records and asks it to act: one published contract the bank implements once. Every check (identity, ownership, review holds, caps, approvals, confirmation) stays in Orchestra.</p>
      <dl className="summary">
        <div><dt>Talking to</dt><dd>{b.mode === "live" ? b.host : "The simulated bank in this app's database"}</dd></div>
        <div><dt>BANK_API_URL</dt><dd>{b.urlSet ? "set" : "not set"}</dd></div>
        <div><dt>BANK_API_KEY</dt><dd>{b.keySet ? "set" : "not set"}</dd></div>
        <div><dt>Reference server</dt><dd>{b.referenceServer}</dd></div>
      </dl>
      <h4 className="int-lbl">Switch to a real bank</h4>
      <ol className="dev-list">
        <li>The bank gives you its base address (for example <span className="ref">https://bank.example/orchestra/v1</span>) and an API key.</li>
        <li>In Vercel, add <span className="ref">BANK_API_URL</span> and <span className="ref">BANK_API_KEY</span> (Settings, Environment Variables), then redeploy.</li>
        <li>Remove them to go back to the simulated bank.</li>
      </ol>
      <a className="btn" href="/openapi/bank-connector-v1.yaml" download>Download the OpenAPI file</a>
    </div>
  );
}

function HookPanel({ e, deliveries }: { e: Endpoint; deliveries: Delivery[] }) {
  return (
    <div>
      <PanelHead letter="W" tile={5} name="Webhook endpoint" sub={e.active ? "On: events are sent" : "Off: nothing is sent"} />
      <dl className="summary">
        <div><dt>Address</dt><dd className="ref">{e.url}</dd></div>
        <div><dt>Events</dt><dd>{e.events.map((x) => <span key={x} className="ref int-ev">{x}</span>)}</dd></div>
        <div><dt>Added</dt><dd>{when(e.created_at)} by {e.created_by}</dd></div>
      </dl>
      <h4 className="int-lbl">Recent deliveries</h4>
      {deliveries.length === 0 ? <p className="label">Nothing sent yet.</p> : (
        <ul className="int-act">{deliveries.slice(0, 10).map((d) => (
          <li key={d.id} className={d.status === "delivered" ? "" : "bad"}><span><span className="ref">{d.event}</span> · {d.status === "delivered" ? "delivered" : `${d.status}${d.last_error ? `: ${d.last_error}` : ""}`} · {d.attempts} attempt{d.attempts === 1 ? "" : "s"}</span><span className="int-sub">{ago(d.created_at)}</span></li>
        ))}</ul>
      )}
      <p className="label">Each delivery is signed: <span className="ref">Orchestra-Signature: t=…,v1=…</span>, an HMAC-SHA256 of &quot;t.body&quot; with the endpoint&apos;s secret.</p>
    </div>
  );
}

function AddKey({ busy, onAdd }: { busy: boolean; onAdd: (name: string) => void }) {
  const [name, setName] = useState("");
  return (
    <form onSubmit={(e) => { e.preventDefault(); onAdd(name); setName(""); }}>
      <PanelHead letter="K" tile={5} name="New API key" sub="For a system that calls Orchestra: a channel, the bank's events, a CRM's webhooks" />
      <label className="int-lbl" htmlFor="key-name">What it&apos;s for</label>
      <input id="key-name" className="filter-input" placeholder="e.g. Mobile app chat" value={name} onChange={(e) => setName(e.target.value)} maxLength={80} />
      <p className="label">The key is shown once, then stored only as a fingerprint.</p>
      <button className="btn btn-primary" type="submit" disabled={busy || !name.trim()}>Create key</button>
    </form>
  );
}

function AddWebhook({ events, busy, onAdd }: { events: string[]; busy: boolean; onAdd: (url: string, events: string[]) => void }) {
  const [url, setUrl] = useState("");
  const [chosen, setChosen] = useState<string[]>(["case.created", "case.updated"]);
  return (
    <form onSubmit={(e) => { e.preventDefault(); onAdd(url, chosen); setUrl(""); }}>
      <PanelHead letter="W" tile={5} name="New webhook endpoint" sub="Where Orchestra posts what happened: a CRM, a helpdesk, a channel" />
      <label className="int-lbl" htmlFor="hook-url">Address</label>
      <input id="hook-url" className="filter-input" placeholder="https://your-crm.example/orchestra" value={url} onChange={(e) => setUrl(e.target.value)} />
      <fieldset className="dev-events">
        <legend className="int-lbl">Events</legend>
        {events.map((ev) => (
          <label key={ev} className="dev-check"><input type="checkbox" checked={chosen.includes(ev)} onChange={(e) => setChosen((c) => (e.target.checked ? [...c, ev] : c.filter((x) => x !== ev)))} /> <span className="ref">{ev}</span></label>
        ))}
      </fieldset>
      <button className="btn btn-primary" type="submit" disabled={busy || !url.trim() || !chosen.length}>Add endpoint</button>
    </form>
  );
}
