"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";

// The API page (Tomi, Nov 23: "use it for the whole api page"): every connection in one list, grouped like an app's
// plugin list: Needs attention, Active, Not active. A row shows what it is and its state in one line, a fix button when
// something's wrong, and a ··· menu; selecting it opens its settings beside the list. Connections: the bank (Bank
// Connector API), the four CRM connectors, webhook endpoints and API keys. Operations and IT admins change them;
// supervisors and compliance can look.

interface Health { state: "attention" | "active" | "off"; label: string | null; fix: "setup" | "reconnect" | "errors" | null; failures: number }
interface Conn {
  kind: string; name: string; mode: "off" | "sandbox" | "live"; write_back: boolean; data_entry: boolean; groups: Record<string, string>;
  envReady: boolean; envNeeded: string[]; sample: unknown; health: Health; ticketsWeek: number; last_error: string | null; last_received_at: string | null;
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
  state: "attention" | "active" | "off"; chip: { text: string; tone: Tone } | null;
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
      out.push({
        id: `crm:${c.kind}`, tab: "connectors", name: c.name, letter: c.name[0], tile: TILE[c.kind] ?? 5,
        sub: c.mode === "off" ? "CRM connector · Off" : `CRM connector · Write-back ${c.write_back ? "on" : "off"} · Data entry ${c.data_entry ? "on" : "off"} · ${Object.keys(c.groups).length} team${Object.keys(c.groups).length === 1 ? "" : "s"} mapped · ${c.ticketsWeek} ticket${c.ticketsWeek === 1 ? "" : "s"} this week`,
        state: h.state,
        chip: h.state === "attention" ? { text: h.label!, tone: "warn" } : c.mode === "live" ? { text: "✓ Live", tone: "ok" } : c.mode === "sandbox" ? { text: "Sandbox", tone: "info" } : null,
        primary: !canManage ? null
          : h.fix === "reconnect" ? { label: "Reconnect", run: () => crm(c.kind, { action: "reconnect" }, () => `${c.name} is working again.`) }
          : h.fix === "errors" ? { label: "See errors", run: () => open(`crm:${c.kind}`) }
          : h.fix === "setup" ? { label: "Set up", run: () => open(`crm:${c.kind}`) }
          : c.mode === "off" ? { label: "Connect", run: () => open(`crm:${c.kind}`) }
          : { label: "Disconnect", run: () => crm(c.kind, { mode: "off" }, () => `${c.name} is disconnected. Nothing is read from it or written to it.`) },
        menu: [
          { label: "Settings", run: () => open(`crm:${c.kind}`) },
          ...(canManage && c.mode !== "off" ? [{ label: "Send a test ticket", run: () => crm(c.kind, { action: "test" }, (j) => j.written_back ? "Test ticket read, analysed and written back." : "Received: nothing new to analyse.") }] : []),
          ...(canManage && c.mode === "live" ? [{ label: "Switch to sandbox", run: () => crm(c.kind, { mode: "sandbox" }, () => "Switched to the sandbox.") }] : []),
          ...(canManage && c.mode === "sandbox" && c.envReady ? [{ label: "Go live", run: () => crm(c.kind, { mode: "live" }, () => "Live.") }] : []),
          { label: "Copy webhook address", run: () => { navigator.clipboard?.writeText(`${window.location.origin}/api/v1/connectors/${c.kind}/webhook`).catch(() => {}); setNote({ text: "Webhook address copied.", tone: "ok" }); } },
          ...(canManage && c.mode !== "off" ? [{ label: "Disconnect", run: () => crm(c.kind, { mode: "off" }, () => `${c.name} is disconnected.`), danger: true }] : []),
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
          return c ? <CrmPanel c={c} canManage={canManage} busy={busy} act={(body, ok) => crm(c.kind, body as { mode?: string }, ok)} /> : null;
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

function CrmPanel({ c, canManage, busy, act }: { c: Conn; canManage: boolean; busy: boolean; act: (body: object, ok?: (j: Record<string, unknown>) => string | null) => Promise<unknown> }) {
  const [groups, setGroups] = useState(toLines(c.groups));
  useEffect(() => { setGroups(toLines(c.groups)); }, [c.kind, c.groups]);
  const unit = c.kind === "salesforce" ? "queues" : c.kind === "hubspot" ? "owners" : "groups";
  return (
    <div>
      <PanelHead letter={c.name[0]} tile={TILE[c.kind] ?? 5} name={c.name} sub={`${c.mode === "live" ? "Live" : c.mode === "sandbox" ? "Sandbox (a stand-in for the product)" : "Off"} · ${c.envReady ? "credentials set in Vercel" : "credentials not set"}`} />
      {c.health.state === "attention" && (
        <div className="int-alert" role="alert">
          <b>{c.health.label}.</b>{" "}
          {c.health.fix === "setup" ? `Add ${c.envNeeded.join(", ")} in Vercel (Settings, Environment Variables), redeploy, then press Reconnect.` : c.last_error}
          {c.health.failures > 0 && ` ${c.health.failures} of the last 20 calls failed.`}
        </div>
      )}
      {c.mode === "off" ? (
        <div className="int-connect">
          <h4 className="int-lbl">Connect {c.name}</h4>
          <div className="int-option">
            <b>Try it in the sandbox</b>
            <p className="label">A stand-in {c.name.split(" ")[0]} inside Orchestra, so you can try the whole flow with test tickets. Nothing reaches a real {c.name.split(" ")[0]} account.</p>
            <button className="btn btn-primary" disabled={!canManage || busy} onClick={() => act({ mode: "sandbox" }, () => `${c.name} is connected to the sandbox. Send a test ticket from the ··· menu.`)}>Use the sandbox</button>
          </div>
          <div className="int-option">
            <b>Connect your own {c.name.split(" ")[0]}</b>
            <p className="label">{c.name.split(" ")[0]} doesn&apos;t open a sign-in window here: Orchestra connects with an API credential that your {c.name.split(" ")[0]} admin creates, kept only in Vercel&apos;s settings, never on this screen.</p>
            <ol className="label int-steps">
              <li>{c.kind === "zendesk" ? "In Zendesk: Admin Center → Apps and integrations → Zendesk API → add an API token." : c.kind === "freshdesk" ? "In Freshdesk: Profile settings → View API key." : c.kind === "salesforce" ? "In Salesforce: create a Connected App with the client-credentials flow." : "In HubSpot: Settings → Integrations → Private apps → create an app with the tickets scope."}</li>
              <li>In Vercel: Settings → Environment Variables, add {c.envNeeded.join(", ")}, then redeploy.</li>
              <li>Come back here and press Go live.</li>
              <li>Point {c.name.split(" ")[0]}&apos;s webhook at Orchestra (Set it up in {c.name.split(" ")[0]}, below).</li>
            </ol>
            <button className="btn" disabled={!canManage || busy || !c.envReady} title={c.envReady ? "" : `Needs ${c.envNeeded.join(", ")} in Vercel first`}
              onClick={() => act({ mode: "live" }, () => `${c.name} is live.`)}>{c.envReady ? "Go live" : "Go live (credentials not set yet)"}</button>
          </div>
        </div>
      ) : <>
      <div className="int-seg wide" role="radiogroup" aria-label="Mode">
        {(["off", "sandbox", "live"] as const).map((m) => (
          <button key={m} role="radio" aria-checked={c.mode === m} className={c.mode === m ? "on" : ""} disabled={!canManage || busy || (m === "live" && !c.envReady)}
            title={m === "live" && !c.envReady ? `Needs ${c.envNeeded.join(", ")} in Vercel` : ""} onClick={() => act({ mode: m }, () => `${c.name}: ${m === "off" ? "off" : m === "sandbox" ? "sandbox" : "live"}.`)}>
            {m === "off" ? "Disconnected" : m === "sandbox" ? "Sandbox" : "Live"}
          </button>
        ))}
      </div>
      <Toggle on={c.write_back} label="Write the result into the ticket" hint="tags, priority, team, internal note" disabled={!canManage || busy} onChange={(v) => act({ write_back: v })} />
      <Toggle on={c.data_entry} label="Data entry" hint="record Orchestra's own conversations as tickets" disabled={!canManage || busy} onChange={(v) => act({ data_entry: v })} />
      </>}
      <h4 className="int-lbl">Teams → {c.name.split(" ")[0]} {unit}</h4>
      <textarea className="reply-box" rows={4} value={groups} onChange={(e) => setGroups(e.target.value)} disabled={!canManage} aria-label={`Teams to ${unit}`} placeholder="Payments team = 360001234" />
      {canManage && <button className="btn" disabled={busy} onClick={() => act({ groups: fromLines(groups) }, () => "Teams saved.")}>Save teams</button>}
      <h4 className="int-lbl">Recent activity</h4>
      {c.activity.length === 0 ? <p className="label">Nothing yet.</p> : (
        <ul className="int-act">{c.activity.map((a) => <li key={a.id} className={a.kind === "error" ? "bad" : ""}><span>{a.summary.replace(`${c.name} connector · `, "Settings changed: ").replace(`${c.name} `, "").replace(/^· /, "")}</span><span className="int-sub">{ago(a.created_at)}</span></li>)}</ul>
      )}
      <details className="int-more-info">
        <summary>Set it up in {c.name.split(" ")[0]}</summary>
        <p className="label">Point a webhook ({c.kind === "zendesk" ? "Admin Center → Webhooks, called by a trigger on ticket created or updated by the requester" : c.kind === "freshdesk" ? "Admin → Automations → Ticket creation and updates → Trigger webhook" : c.kind === "salesforce" ? "a record-triggered Flow on Case with an HTTP callout" : "a ticket workflow with Send a webhook"}) at this address, with an Orchestra API key as the bearer token, sending this body:</p>
        <pre className="dev-code">{`POST ${typeof window !== "undefined" ? window.location.origin : ""}/api/v1/connectors/${c.kind}/webhook\nAuthorization: Bearer orc_…\n\n${JSON.stringify(c.sample, null, 2)}`}</pre>
        <p className="label">Live needs {c.envNeeded.join(", ")} in Vercel&apos;s environment variables.</p>
      </details>
      {c.mode === "sandbox" && c.writes.length > 0 && (
        <details className="int-more-info">
          <summary>What Orchestra wrote into the stand-in ({c.writes.length})</summary>
          <ul className="claim-list">{c.writes.map((w) => <li key={w.id}><span className="ref">{w.method} {w.path}</span><pre className="dev-code">{JSON.stringify(w.body, null, 2)}</pre></li>)}</ul>
        </details>
      )}
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
