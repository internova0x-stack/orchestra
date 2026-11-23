import type { InteractionIn } from "../listen.ts";
import { CrmError, type CrmConnector, type CrmKind, type NewTicket, type WriteBack } from "./contract.ts";

// The four connectors, each to its product's published REST API. Every call goes through `req`, with a 10-second
// timeout and the product's own authentication; tests and the console's sandbox pass a stand-in `fetch`.
// Before going live with a real account, check each mapping against the product's current API reference: these
// are written from the published documentation, and products change field names and limits.

type Fetch = typeof fetch;

function client(base: string, headers: Record<string, string>, fetcher: Fetch) {
  return async function req<T>(method: string, path: string, body?: unknown): Promise<T> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), 10_000);
    try {
      const res = await fetcher(base.replace(/\/+$/, "") + path, {
        method,
        headers: { Accept: "application/json", ...(body !== undefined ? { "Content-Type": "application/json" } : {}), ...headers },
        body: body !== undefined ? JSON.stringify(body) : undefined,
        signal: ctrl.signal,
      });
      if (!res.ok) throw new CrmError(res.status, `${method} ${path}: ${res.status} ${(await res.text().catch(() => "")).slice(0, 200)}`);
      const text = await res.text();
      return (text ? JSON.parse(text) : {}) as T;
    } catch (err) {
      if (err instanceof CrmError) throw err;
      throw new CrmError(0, `${method} ${path}: ${(err as Error).message}`);
    } finally {
      clearTimeout(timer);
    }
  };
}

const enc = encodeURIComponent;
const firstId = (...vals: unknown[]) => {
  for (const v of vals) if ((typeof v === "string" && v.trim()) || typeof v === "number") return String(v).trim();
  return null;
};
const obj = (v: unknown): Record<string, unknown> => (v && typeof v === "object" ? (v as Record<string, unknown>) : {});

// ---------------------------------------------------------------- Zendesk (Support API v2)
// Auth: an API token, "email/token:token" as Basic. A trigger or webhook sends {"ticket_id": "{{ticket.id}}"}.

export function zendesk(cfg: { subdomain: string; email: string; token: string }, fetcher: Fetch = fetch): CrmConnector {
  const req = client(`https://${cfg.subdomain}.zendesk.com`, { Authorization: `Basic ${Buffer.from(`${cfg.email}/token:${cfg.token}`).toString("base64")}` }, fetcher);
  return {
    kind: "zendesk",
    ticketIdFrom: (b) => firstId(obj(b).ticket_id, obj(obj(b).ticket).id, obj(obj(b).detail).id),
    async fetchTicket(id) {
      const { ticket } = await req<{ ticket: { id: number; subject: string | null; requester_id: number } }>("GET", `/api/v2/tickets/${enc(id)}.json`);
      const { comments } = await req<{ comments: { id: number; author_id: number; plain_body?: string; body: string; public: boolean; created_at: string }[] }>("GET", `/api/v2/tickets/${enc(id)}/comments.json`);
      const { user } = await req<{ user: { name: string | null; email: string | null; phone: string | null } }>("GET", `/api/v2/users/${ticket.requester_id}.json`);
      return {
        source: "zendesk", external_id: String(ticket.id), subject: ticket.subject,
        customer: { name: user.name, email: user.email, phone: user.phone },
        messages: comments.filter((c) => c.public).map((c) => ({ id: String(c.id), from: c.author_id === ticket.requester_id ? "customer" : "agent", text: c.plain_body ?? c.body, at: c.created_at })),
      } satisfies InteractionIn;
    },
    async writeBack(id, w: WriteBack) {
      await req("PUT", `/api/v2/tickets/${enc(id)}.json`, {
        ticket: { additional_tags: w.tags, priority: w.priority, ...(w.groupId ? { group_id: Number(w.groupId) || w.groupId } : {}), comment: { body: w.note, public: false } },
      });
    },
    async reply(id, text) {
      await req("PUT", `/api/v2/tickets/${enc(id)}.json`, { ticket: { comment: { body: text, public: true } } });
      return { public: true };
    },
    async addNote(id, text, opts) {
      await req("PUT", `/api/v2/tickets/${enc(id)}.json`, { ticket: { comment: { body: text, public: false }, ...(opts?.solve ? { status: "solved" } : {}) } });
    },
    async createTicket(t: NewTicket) {
      const { ticket } = await req<{ ticket: { id: number } }>("POST", "/api/v2/tickets.json", {
        ticket: {
          subject: t.subject, comment: { body: t.note, public: false }, tags: t.tags, priority: t.priority, status: t.status,
          requester: { name: t.requester.name ?? "Customer", ...(t.requester.email ? { email: t.requester.email } : {}) },
          ...(t.groupId ? { group_id: Number(t.groupId) || t.groupId } : {}),
        },
      });
      return String(ticket.id);
    },
  };
}

// ---------------------------------------------------------------- Freshdesk (API v2)
// Auth: the API key as the Basic user, "X" as the password. An automation webhook sends {"freshdesk_webhook": {"ticket_id": ...}}.

const FD_PRIORITY = { normal: 2, high: 3, urgent: 4 } as const;

export function freshdesk(cfg: { domain: string; apiKey: string }, fetcher: Fetch = fetch): CrmConnector {
  const req = client(`https://${cfg.domain}.freshdesk.com`, { Authorization: `Basic ${Buffer.from(`${cfg.apiKey}:X`).toString("base64")}` }, fetcher);
  return {
    kind: "freshdesk",
    ticketIdFrom: (b) => firstId(obj(obj(b).freshdesk_webhook).ticket_id, obj(b).ticket_id, obj(b).id),
    async fetchTicket(id) {
      const t = await req<{ id: number; subject: string | null; description_text: string; created_at: string; requester?: { name: string | null; email: string | null; phone: string | null } }>("GET", `/api/v2/tickets/${enc(id)}?include=requester`);
      const conv = await req<{ id: number; body_text: string; incoming: boolean; private: boolean; created_at: string }[]>("GET", `/api/v2/tickets/${enc(id)}/conversations`);
      return {
        source: "freshdesk", external_id: String(t.id), subject: t.subject,
        customer: { name: t.requester?.name ?? null, email: t.requester?.email ?? null, phone: t.requester?.phone ?? null },
        messages: [
          { id: "description", from: "customer" as const, text: t.description_text, at: t.created_at },
          ...conv.filter((c) => !c.private).map((c) => ({ id: String(c.id), from: c.incoming ? ("customer" as const) : ("agent" as const), text: c.body_text, at: c.created_at })),
        ],
      } satisfies InteractionIn;
    },
    async writeBack(id, w) {
      // Freshdesk replaces the tag list, so the ticket's own tags are read and kept.
      const t = await req<{ tags?: string[] }>("GET", `/api/v2/tickets/${enc(id)}`);
      await req("PUT", `/api/v2/tickets/${enc(id)}`, { tags: [...new Set([...(t.tags ?? []), ...w.tags])], priority: FD_PRIORITY[w.priority], ...(w.groupId ? { group_id: Number(w.groupId) } : {}) });
      await req("POST", `/api/v2/tickets/${enc(id)}/notes`, { body: w.note.replace(/\n/g, "<br>"), private: true });
    },
    async reply(id, text) {
      await req("POST", `/api/v2/tickets/${enc(id)}/reply`, { body: text.replace(/\n/g, "<br>") });
      return { public: true };
    },
    async addNote(id, text, opts) {
      await req("POST", `/api/v2/tickets/${enc(id)}/notes`, { body: text.replace(/\n/g, "<br>"), private: true });
      if (opts?.solve) await req("PUT", `/api/v2/tickets/${enc(id)}`, { status: 4 });
    },
    async createTicket(t) {
      const created = await req<{ id: number }>("POST", "/api/v2/tickets", {
        subject: t.subject, description: t.note.replace(/\n/g, "<br>"), email: t.requester.email ?? "unknown@customer.invalid", name: t.requester.name ?? "Customer",
        ...(t.requester.phone ? { phone: t.requester.phone } : {}), priority: FD_PRIORITY[t.priority], status: t.status === "solved" ? 4 : 2, tags: t.tags,
        ...(t.groupId ? { group_id: Number(t.groupId) } : {}),
      });
      return String(created.id);
    },
  };
}

// ---------------------------------------------------------------- Salesforce Service Cloud (REST API)
// Auth: an OAuth access token for a connected app (client credentials flow), Bearer. A Flow's HTTP callout sends {"caseId": "{!$Record.Id}"}.
// Customer emails are EmailMessage records (Incoming = true); team members' notes are CaseComments.

const SF = "/services/data/v60.0";
const SF_PRIORITY = { normal: "Medium", high: "High", urgent: "High" } as const;
const soql = (q: string) => `${SF}/query?q=${enc(q)}`;
const sfId = (id: string) => id.replace(/[^A-Za-z0-9]/g, "");

export function salesforce(cfg: { instanceUrl: string; accessToken?: string; clientId?: string; clientSecret?: string }, fetcher: Fetch = fetch): CrmConnector {
  // A connected app's client credentials get a fresh access token (tokens expire); a fixed token also works.
  let token = cfg.accessToken ?? null;
  async function auth(): Promise<string> {
    if (token) return token;
    const res = await fetcher(`${cfg.instanceUrl.replace(/\/+$/, "")}/services/oauth2/token`, {
      method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({ grant_type: "client_credentials", client_id: cfg.clientId ?? "", client_secret: cfg.clientSecret ?? "" }).toString(),
    });
    if (!res.ok) throw new CrmError(res.status, `Salesforce sign-in: ${res.status}`);
    token = ((await res.json()) as { access_token: string }).access_token;
    return token;
  }
  const req = async <T>(method: string, path: string, body?: unknown): Promise<T> => client(cfg.instanceUrl, { Authorization: `Bearer ${await auth()}` }, fetcher)<T>(method, path, body);
  return {
    kind: "salesforce",
    ticketIdFrom: (b) => firstId(obj(b).caseId, obj(b).CaseId, obj(b).Id, obj(b).id),
    async fetchTicket(id) {
      const c = await req<{ Id: string; Subject: string | null; Description: string | null; SuppliedName: string | null; SuppliedEmail: string | null; SuppliedPhone: string | null; CreatedDate: string }>("GET", `${SF}/sobjects/Case/${sfId(id)}`);
      const mail = await req<{ records: { Id: string; TextBody: string | null; Incoming: boolean; FromName: string | null; CreatedDate: string }[] }>("GET", soql(`SELECT Id, TextBody, Incoming, FromName, CreatedDate FROM EmailMessage WHERE ParentId = '${sfId(id)}' ORDER BY CreatedDate`));
      return {
        source: "salesforce", external_id: c.Id, subject: c.Subject,
        customer: { name: c.SuppliedName, email: c.SuppliedEmail, phone: c.SuppliedPhone },
        messages: [
          ...(c.Description ? [{ id: "description", from: "customer" as const, text: c.Description, at: c.CreatedDate }] : []),
          ...mail.records.filter((m) => m.TextBody).map((m) => ({ id: m.Id, from: m.Incoming ? ("customer" as const) : ("agent" as const), name: m.FromName, text: m.TextBody!, at: m.CreatedDate })),
        ],
      } satisfies InteractionIn;
    },
    async writeBack(id, w) {
      // Salesforce has no tags on a Case: they go in the note. The team is a queue (OwnerId).
      await req("PATCH", `${SF}/sobjects/Case/${sfId(id)}`, { Priority: SF_PRIORITY[w.priority], ...(w.groupId ? { OwnerId: w.groupId } : {}) });
      await req("POST", `${SF}/sobjects/CaseComment`, { ParentId: sfId(id), CommentBody: `${w.note}\nTags: ${w.tags.join(", ")}`, IsPublished: false });
    },
    async reply(id, text) {
      // A published case comment (shown in the customer's portal and notification emails).
      await req("POST", `${SF}/sobjects/CaseComment`, { ParentId: sfId(id), CommentBody: text, IsPublished: true });
      return { public: true };
    },
    async addNote(id, text, opts) {
      await req("POST", `${SF}/sobjects/CaseComment`, { ParentId: sfId(id), CommentBody: text, IsPublished: false });
      if (opts?.solve) await req("PATCH", `${SF}/sobjects/Case/${sfId(id)}`, { Status: "Closed" });
    },
    async createTicket(t) {
      const created = await req<{ id: string }>("POST", `${SF}/sobjects/Case`, {
        Subject: t.subject, Description: t.note, Origin: "Web", Priority: SF_PRIORITY[t.priority], Status: t.status === "solved" ? "Closed" : "New",
        SuppliedName: t.requester.name, SuppliedEmail: t.requester.email, SuppliedPhone: t.requester.phone, ...(t.groupId ? { OwnerId: t.groupId } : {}),
      });
      return created.id;
    },
  };
}

// ---------------------------------------------------------------- HubSpot Service Hub (CRM API v3)
// Auth: a private app's access token, Bearer. A workflow's "Send a webhook" action sends the ticket's {"objectId": ...}.
// The thread lives in HubSpot's inbox, so listen mode reads the ticket's description; notes are engagement notes.

const HS_PRIORITY = { normal: "MEDIUM", high: "HIGH", urgent: "URGENT" } as const;
/** HubSpot's default association type id for a note on a ticket. */
const NOTE_TO_TICKET = 228;

export function hubspot(cfg: { accessToken: string }, fetcher: Fetch = fetch): CrmConnector {
  const req = client("https://api.hubapi.com", { Authorization: `Bearer ${cfg.accessToken}` }, fetcher);
  const note = (id: string, body: string) => req("POST", "/crm/v3/objects/notes", {
    properties: { hs_note_body: body.replace(/\n/g, "<br>"), hs_timestamp: new Date().toISOString() },
    associations: [{ to: { id }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: NOTE_TO_TICKET }] }],
  });
  return {
    kind: "hubspot",
    ticketIdFrom: (b) => firstId(obj(b).objectId, obj(Array.isArray(b) ? b[0] : null).objectId, obj(b).hs_object_id, obj(b).id),
    async fetchTicket(id) {
      const t = await req<{ id: string; createdAt: string; properties: { subject: string | null; content: string | null }; associations?: { contacts?: { results: { id: string }[] } } }>(
        "GET", `/crm/v3/objects/tickets/${enc(id)}?properties=subject,content&associations=contacts`);
      const cid = t.associations?.contacts?.results[0]?.id;
      const contact = cid ? await req<{ properties: { email: string | null; phone: string | null; firstname: string | null; lastname: string | null } }>("GET", `/crm/v3/objects/contacts/${enc(cid)}?properties=email,phone,firstname,lastname`) : null;
      const p = contact?.properties;
      return {
        source: "hubspot", external_id: t.id, subject: t.properties.subject,
        customer: { name: p ? [p.firstname, p.lastname].filter(Boolean).join(" ") || null : null, email: p?.email ?? null, phone: p?.phone ?? null },
        messages: t.properties.content ? [{ id: "content", from: "customer" as const, text: t.properties.content, at: t.createdAt }] : [],
      } satisfies InteractionIn;
    },
    async writeBack(id, w) {
      await req("PATCH", `/crm/v3/objects/tickets/${enc(id)}`, { properties: { hs_ticket_priority: HS_PRIORITY[w.priority], ...(w.groupId ? { hubspot_owner_id: w.groupId } : {}) } });
      await note(id, `${w.note}\nTags: ${w.tags.join(", ")}`);
    },
    async reply(id, text, author) {
      // Replies to the customer go through HubSpot's conversations inbox, which this connector doesn't send to;
      // the reply is recorded on the ticket as a note for the agent to send.
      await note(id, `Reply to send (from ${author}, via Orchestra):\n${text}`);
      return { public: false };
    },
    async addNote(id, text, opts) {
      await note(id, text);
      if (opts?.solve) await req("PATCH", `/crm/v3/objects/tickets/${enc(id)}`, { properties: { hs_pipeline_stage: "4" } });
    },
    async createTicket(t) {
      const created = await req<{ id: string }>("POST", "/crm/v3/objects/tickets", {
        properties: { subject: t.subject, content: t.note, hs_ticket_priority: HS_PRIORITY[t.priority], hs_pipeline: "0", hs_pipeline_stage: t.status === "solved" ? "4" : "1", ...(t.groupId ? { hubspot_owner_id: t.groupId } : {}) },
      });
      return created.id;
    },
  };
}

/** The connector for a kind from its environment variables, or null when they aren't set. */
export function fromEnv(kind: CrmKind, fetcher: Fetch = fetch): CrmConnector | null {
  const e = process.env;
  if (kind === "zendesk" && e.ZENDESK_SUBDOMAIN && e.ZENDESK_EMAIL && e.ZENDESK_API_TOKEN) return zendesk({ subdomain: e.ZENDESK_SUBDOMAIN, email: e.ZENDESK_EMAIL, token: e.ZENDESK_API_TOKEN }, fetcher);
  if (kind === "freshdesk" && e.FRESHDESK_DOMAIN && e.FRESHDESK_API_KEY) return freshdesk({ domain: e.FRESHDESK_DOMAIN, apiKey: e.FRESHDESK_API_KEY }, fetcher);
  if (kind === "salesforce" && e.SALESFORCE_INSTANCE_URL && (e.SALESFORCE_ACCESS_TOKEN || (e.SALESFORCE_CLIENT_ID && e.SALESFORCE_CLIENT_SECRET))) {
    return salesforce({ instanceUrl: e.SALESFORCE_INSTANCE_URL, accessToken: e.SALESFORCE_ACCESS_TOKEN, clientId: e.SALESFORCE_CLIENT_ID, clientSecret: e.SALESFORCE_CLIENT_SECRET }, fetcher);
  }
  if (kind === "hubspot" && e.HUBSPOT_ACCESS_TOKEN) return hubspot({ accessToken: e.HUBSPOT_ACCESS_TOKEN }, fetcher);
  return null;
}

export const ENV_NEEDED: Record<CrmKind, string[]> = {
  zendesk: ["ZENDESK_SUBDOMAIN", "ZENDESK_EMAIL", "ZENDESK_API_TOKEN"],
  freshdesk: ["FRESHDESK_DOMAIN", "FRESHDESK_API_KEY"],
  salesforce: ["SALESFORCE_INSTANCE_URL", "SALESFORCE_CLIENT_ID", "SALESFORCE_CLIENT_SECRET"],
  hubspot: ["HUBSPOT_ACCESS_TOKEN"],
};

export type { CrmKind };
