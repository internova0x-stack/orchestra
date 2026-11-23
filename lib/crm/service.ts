import type { Sql } from "../db.ts";
import { ingestInteraction, type Classifier, type ListenState } from "../listen.ts";
import { CRM_KINDS, CRM_NAME, type CrmConnector, type CrmKind, type WriteBack } from "./contract.ts";
import { ENV_NEEDED, freshdesk, fromEnv, hubspot, salesforce, zendesk } from "./connectors.ts";
import { sandboxFetch } from "./sandbox.ts";

// Running the connectors: which one is on (off, sandbox or live), the team → group mapping, and the flow from the
// helpdesk's webhook to listen mode and back: read the ticket, analyse it, write the result into the ticket.

export type CrmMode = "off" | "sandbox" | "live";

export interface ConnectorSettings {
  kind: CrmKind;
  mode: CrmMode;
  /** Write tags, priority, the team's group and an internal note back into the ticket. */
  write_back: boolean;
  /** Data entry: open a ticket recording each conversation Orchestra handles, and add its outcome. */
  data_entry: boolean;
  /** Orchestra's team name → the helpdesk's group, queue or owner id. */
  groups: Record<string, string>;
  updated_by: string | null;
  updated_at: string | null;
  last_received_at: string | null;
  last_ok_at: string | null;
  last_error: string | null;
  last_error_status: number | null;
  last_error_at: string | null;
  /** The last 20 calls to the CRM: true for success. */
  recent: boolean[];
}

/** What the API page shows for a connector: needs attention (and why), active, or off. */
export function healthOf(c: ConnectorSettings & { envReady: boolean }): { state: "attention" | "active" | "off"; label: string | null; fix: "setup" | "reconnect" | "errors" | null; failures: number } {
  const failures = c.recent.filter((x) => !x).length;
  if (c.mode === "off") return { state: "off", label: null, fix: null, failures };
  if (c.mode === "live" && !c.envReady) return { state: "attention", label: "Credentials missing", fix: "setup", failures };
  const failing = c.last_error_at && (!c.last_ok_at || new Date(c.last_error_at) > new Date(c.last_ok_at));
  if (failing && (c.last_error_status === 401 || c.last_error_status === 403)) return { state: "attention", label: "Sign-in failed", fix: "reconnect", failures };
  if (failing) return { state: "attention", label: c.last_error_status === 0 ? "Can't reach it" : "Write-back failing", fix: c.last_error_status === 0 ? "reconnect" : "errors", failures };
  return { state: "active", label: null, fix: null, failures };
}

/** Record one call to the CRM for the API page's health (never throws). */
export async function noteHealth(sql: Sql, kind: CrmKind, ok: boolean, err?: { message: string; status?: number }) {
  try {
    await sql`insert into crm_connectors (kind) values (${kind}) on conflict (kind) do nothing`;
    if (ok) await sql`update crm_connectors set last_ok_at = now(), recent = (jsonb_build_array(true) || recent) - 20 where kind = ${kind}`;
    else await sql`update crm_connectors set last_error = ${(err?.message ?? "").slice(0, 300)}, last_error_status = ${err?.status ?? null}, last_error_at = now(),
      recent = (jsonb_build_array(false) || recent) - 20 where kind = ${kind}`;
  } catch (e) {
    console.error("connector health", e);
  }
}

const DEFAULTS = (kind: CrmKind): ConnectorSettings => ({ kind, mode: "off", write_back: true, data_entry: false, groups: {}, updated_by: null, updated_at: null,
  last_received_at: null, last_ok_at: null, last_error: null, last_error_status: null, last_error_at: null, recent: [] });

export async function connectorSettings(sql: Sql): Promise<(ConnectorSettings & { name: string; envReady: boolean; envNeeded: string[] })[]> {
  const rows = await sql<ConnectorSettings[]>`select kind, mode, write_back, data_entry, groups, updated_by, updated_at,
    last_received_at, last_ok_at, last_error, last_error_status, last_error_at, recent from crm_connectors`;
  return CRM_KINDS.map((k) => ({
    ...DEFAULTS(k), ...(rows.find((r) => r.kind === k) ?? {}),
    name: CRM_NAME[k], envNeeded: ENV_NEEDED[k], envReady: ENV_NEEDED[k].every((v) => Boolean(process.env[v])) || Boolean(fromEnv(k)),
  }));
}

export async function saveConnector(sql: Sql, kind: CrmKind, s: Partial<Pick<ConnectorSettings, "mode" | "write_back" | "data_entry" | "groups">>, by: string) {
  const cur = (await connectorSettings(sql)).find((c) => c.kind === kind)!;
  const next = { ...cur, ...s };
  if (next.mode === "live" && !fromEnv(kind)) return { ok: false as const, error: `Set ${ENV_NEEDED[kind].join(", ")} in Vercel's environment variables first.` };
  const groups = Object.fromEntries(Object.entries(next.groups ?? {}).map(([t, g]) => [String(t).trim().slice(0, 80), String(g).trim().slice(0, 80)]).filter(([t, g]) => t && g));
  await sql`insert into crm_connectors (kind, mode, write_back, data_entry, groups, updated_by, updated_at)
    values (${kind}, ${next.mode}, ${next.write_back}, ${next.data_entry}, ${sql.json(groups)}, ${by}, now())
    on conflict (kind) do update set mode = excluded.mode, write_back = excluded.write_back, data_entry = excluded.data_entry,
      groups = excluded.groups, updated_by = excluded.updated_by, updated_at = excluded.updated_at`;
  await sql`insert into audit_log (kind, tool, summary, staff) values ('rule', 'crm_connector', ${`${CRM_NAME[kind]} connector · ${next.mode}${next.write_back ? " · write-back on" : ""}${next.data_entry ? " · data entry on" : ""}`}, ${by})`;
  return { ok: true as const };
}

/** The connector to use for a kind right now: the sandbox stand-in, the live account, or none. */
export async function connector(sql: Sql, kind: CrmKind): Promise<{ conn: CrmConnector; settings: ConnectorSettings } | null> {
  const settings = (await connectorSettings(sql)).find((c) => c.kind === kind)!;
  if (settings.mode === "off") return null;
  if (settings.mode === "live") {
    const conn = fromEnv(kind);
    return conn ? { conn, settings } : null;
  }
  const f = sandboxFetch(sql, kind);
  const conn = kind === "zendesk" ? zendesk({ subdomain: "sandbox", email: "sandbox@example.com", token: "sandbox" }, f)
    : kind === "freshdesk" ? freshdesk({ domain: "sandbox", apiKey: "sandbox" }, f)
    : kind === "salesforce" ? salesforce({ instanceUrl: "https://sandbox.my.salesforce.com", clientId: "sandbox", clientSecret: "sandbox" }, f)
    : hubspot({ accessToken: "sandbox" }, f);
  return { conn, settings };
}

const slug = (s: string) => s.toLowerCase().replace(/\(.*?\)/g, "").replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "");

/** What Orchestra writes into the ticket: tags, priority, the team's group and an internal note for the agent. */
export function writeBackFor(a: NonNullable<ListenState["analysis"]>, groups: Record<string, string>, consoleUrl: string | null): WriteBack {
  const note = [
    `Orchestra (AI) · ${a.category} · ${a.urgency}${a.fraud_signal ? " · FRAUD SIGNAL" : ""} · routed to ${a.team}`,
    `Summary: ${a.summary}`,
    `Wants: ${a.wants} · sentiment: ${a.sentiment}`,
    ...(a.findings.length ? ["In the bank's records:", ...a.findings.map((f) => `- ${f}`)] : []),
    ...(a.draft ? ["", "Suggested reply (edit before sending):", a.draft] : []),
    ...(consoleUrl ? ["", `Open in Orchestra: ${consoleUrl}`] : []),
    "Customer matched by contact details only: not identity-verified.",
  ].join("\n");
  return {
    tags: ["orchestra", `orc_${slug(a.category)}`, `orc_${a.urgency}`, ...(a.fraud_signal ? ["orc_fraud_signal"] : [])],
    priority: a.urgency as WriteBack["priority"],
    groupId: groups[a.team] ?? null,
    note,
  };
}

export type WebhookOutcome =
  | { ok: true; conversation_id: string; analysed: boolean; written_back: boolean; error?: string }
  | { ok: false; error: string; message: string; status: number };

/** The helpdesk says a ticket was created or a customer replied: read it, analyse it, write the result back. */
export async function handleCrmWebhook(sql: Sql, kind: CrmKind, body: unknown, opts: { consoleBase?: string | null; classify?: Classifier; draft?: boolean } = {}): Promise<WebhookOutcome> {
  const c = await connector(sql, kind);
  if (!c) return { ok: false, error: "not_connected", message: `The ${CRM_NAME[kind]} connector is off. Switch it on on the API page.`, status: 409 };
  const id = c.conn.ticketIdFrom(body);
  if (!id) return { ok: false, error: "bad_request", message: "No ticket id in the webhook body.", status: 400 };
  await sql`update crm_connectors set last_received_at = now() where kind = ${kind}`;
  let ticket;
  try {
    ticket = await c.conn.fetchTicket(id);
    await noteHealth(sql, kind, true);
  } catch (err) {
    await noteHealth(sql, kind, false, { message: (err as Error).message, status: (err as { status?: number }).status });
    return { ok: false, error: "crm_unavailable", message: `Couldn't read the ticket from ${CRM_NAME[kind]}: ${(err as Error).message}`, status: 502 };
  }
  if (!ticket) return { ok: false, error: "not_found", message: "The ticket wasn't found.", status: 404 };
  const out = await ingestInteraction(sql, ticket, { classify: opts.classify, draft: opts.draft });
  if (!out.ok) return { ok: false, error: out.error, message: out.message, status: 409 };
  if (!out.analysis || !c.settings.write_back) return { ok: true, conversation_id: out.conversation_id, analysed: Boolean(out.analysis), written_back: false };
  const w = writeBackFor(out.analysis, c.settings.groups, opts.consoleBase ? `${opts.consoleBase}/messages?c=${out.conversation_id}` : null);
  try {
    await c.conn.writeBack(id, w);
  } catch (err) {
    const msg = (err as Error).message;
    await noteHealth(sql, kind, false, { message: msg, status: (err as { status?: number }).status });
    await sql`update conversations set listen = listen || ${sql.json({ writeback: { ok: false, error: msg.slice(0, 300), at: new Date().toISOString() } } as never)} where id = ${out.conversation_id}`;
    await sql`insert into audit_log (conversation_id, tool_use_id, kind, tool, summary) values (${out.conversation_id}, ${`crm-${Date.now()}`}, 'error', 'crm_write_back', ${`${CRM_NAME[kind]} ${id} · write-back failed: ${msg.slice(0, 160)}`})`;
    return { ok: true, conversation_id: out.conversation_id, analysed: true, written_back: false, error: msg };
  }
  await noteHealth(sql, kind, true);
  await sql`update conversations set listen = listen || ${sql.json({ writeback: { ok: true, at: new Date().toISOString(), tags: w.tags, priority: w.priority, group: w.groupId } } as never)} where id = ${out.conversation_id}`;
  await sql`insert into audit_log (conversation_id, tool_use_id, kind, tool, summary)
    values (${out.conversation_id}, ${`crm-${Date.now()}`}, 'action', 'crm_write_back',
            ${`${CRM_NAME[kind]} ${id} · tagged ${w.tags.join(", ")} · priority ${w.priority}${w.groupId ? ` · group ${w.groupId}` : ""} · internal note added`})`;
  return { ok: true, conversation_id: out.conversation_id, analysed: true, written_back: true };
}

/** The sandbox's record of what Orchestra wrote into each stand-in CRM (newest first). */
export async function sandboxCalls(sql: Sql, kind: CrmKind) {
  return sql<{ id: number; method: string; path: string; body: unknown; at: string }[]>`
    select id, method, path, body, at from crm_sandbox_calls where kind = ${kind} order by id desc limit 20`;
}

/** "Reconnect": check the credentials with a cheap read, and record the result. */
export async function checkConnection(sql: Sql, kind: CrmKind): Promise<{ ok: boolean; error?: string }> {
  const c = await connector(sql, kind);
  if (!c) return { ok: false, error: "The connector is off, or its credentials aren't set." };
  try {
    await c.conn.ping();
    await noteHealth(sql, kind, true);
    await sql`insert into audit_log (kind, tool, summary) values ('action', 'crm_connector', ${`${CRM_NAME[kind]} · connection checked · working`})`;
    return { ok: true };
  } catch (err) {
    const status = (err as { status?: number }).status;
    await noteHealth(sql, kind, false, { message: (err as Error).message, status });
    return { ok: false, error: status === 401 || status === 403 ? `${CRM_NAME[kind]} refused the credentials. Update them in Vercel's environment variables, redeploy, then try again.` : `Couldn't reach ${CRM_NAME[kind]}: ${(err as Error).message.slice(0, 160)}` };
  }
}

/** The connector's recent activity for the API page: write-backs, data entry, checks and failures. */
export async function connectorActivity(sql: Sql, kind: CrmKind) {
  return sql<{ id: number; kind: string; summary: string; created_at: string }[]>`
    select id, kind, summary, created_at from audit_log
    where tool in ('crm_write_back', 'crm_data_entry', 'crm_connector') and summary like ${CRM_NAME[kind] + "%"}
    order by id desc limit 8`;
}
