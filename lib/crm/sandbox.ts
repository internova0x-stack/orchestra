import type { Sql } from "../db.ts";
import type { CrmKind } from "./contract.ts";

// The sandbox: a stand-in for each CRM's API, inside Orchestra, so a connector can be tried end to end without a real
// account (and tested). It answers the same requests the connector sends, with each product's JSON shapes, from a few
// invented tickets, and records every write Orchestra makes (crm_sandbox_calls) so the API page can show them.

type Ticket = { id: string; subject: string; requester: { name: string; email: string | null; phone: string | null }; messages: { id: string; from: "customer" | "agent"; text: string; at: string }[]; tags: string[] };

const at = (h: number) => new Date(Date.now() - h * 3_600_000).toISOString();

/** One invented ticket per CRM (the console's "Send a test ticket"). */
export const SANDBOX_TICKETS: Record<CrmKind, Ticket> = {
  zendesk: { id: "1001", subject: "Payment to Lumen Print still not received", requester: { name: "Ada Okafor", email: "ada@brightline.example.com", phone: null }, tags: ["web"],
    messages: [{ id: "9001", from: "customer", text: "Hello, we sent $4,200 to Lumen Print (PO-88190) two days ago and they say they haven't received it. Where is it? It's getting urgent.", at: at(2) }] },
  freshdesk: { id: "2001", subject: "Charge I don't recognise", requester: { name: "Grace Mensah", email: "grace.mensah@example.com", phone: null }, tags: [],
    messages: [{ id: "description", from: "customer", text: "There's a £29 charge from PP*NBLX on my card that wasn't me. I think my card details were stolen!!", at: at(1) }] },
  salesforce: { id: "5003000000ABCdE", subject: "POS payment failed but money gone", requester: { name: "Chioma Eze", email: "chioma.eze@example.com", phone: null }, tags: [],
    messages: [{ id: "description", from: "customer", text: "I paid ₦18,750 at Mama Cass Kitchen with my card, the terminal said declined but my account was debited. Payment PAY-61001. Please refund.", at: at(5) }] },
  hubspot: { id: "8001", subject: "Airtime not delivered", requester: { name: "Amara Nwosu", email: "amara.nwosu@example.com", phone: null }, tags: [],
    messages: [{ id: "content", from: "customer", text: "I bought ₦2,000 airtime (BP-30101) and never got it. Can I have my money back?", at: at(3) }] },
};

async function record(sql: Sql, kind: CrmKind, method: string, path: string, body: unknown) {
  await sql`insert into crm_sandbox_calls (kind, method, path, body) values (${kind}, ${method}, ${path}, ${body === undefined ? null : sql.json(body as never)})`;
}

const json = (status: number, body: unknown) => new Response(JSON.stringify(body), { status, headers: { "Content-Type": "application/json" } });

/** A fetch that answers as the CRM would. Writes are recorded and acknowledged; unknown requests are 404s. */
export function sandboxFetch(sql: Sql, kind: CrmKind): typeof fetch {
  const t = SANDBOX_TICKETS[kind];
  return (async (input: RequestInfo | URL, init?: RequestInit) => {
    const url = new URL(typeof input === "string" ? input : input instanceof URL ? input.href : input.url);
    const method = (init?.method ?? "GET").toUpperCase();
    const path = decodeURIComponent(url.pathname + url.search);
    const body = init?.body ? (() => { try { return JSON.parse(String(init.body)); } catch { return String(init.body); } })() : undefined;
    if (method !== "GET") {
      await record(sql, kind, method, path, body);
      if (kind === "salesforce" && path.endsWith("/oauth2/token")) return json(200, { access_token: "sandbox" });
      if (method === "POST" && /\/tickets(\.json)?$|\/sobjects\/Case$|\/objects\/tickets$/.test(url.pathname)) {
        return json(201, kind === "zendesk" ? { ticket: { id: 1099 } } : kind === "salesforce" ? { id: "5003000000NEW01", success: true } : { id: kind === "freshdesk" ? 2099 : "8099" });
      }
      return json(200, kind === "zendesk" ? { ticket: { id: Number(t.id) } } : { id: t.id });
    }
    const requesterId = 777;
    switch (kind) {
      case "zendesk":
        if (url.pathname === `/api/v2/tickets/${t.id}.json`) return json(200, { ticket: { id: Number(t.id), subject: t.subject, requester_id: requesterId, tags: t.tags } });
        if (url.pathname === `/api/v2/tickets/${t.id}/comments.json`) return json(200, { comments: t.messages.map((m) => ({ id: Number(m.id), author_id: m.from === "customer" ? requesterId : 1, body: m.text, plain_body: m.text, public: true, created_at: m.at })) });
        if (url.pathname === `/api/v2/users/${requesterId}.json`) return json(200, { user: t.requester });
        break;
      case "freshdesk":
        if (url.pathname === `/api/v2/tickets/${t.id}`) return json(200, { id: Number(t.id), subject: t.subject, description_text: t.messages[0].text, created_at: t.messages[0].at, requester: t.requester, tags: t.tags });
        if (url.pathname === `/api/v2/tickets/${t.id}/conversations`) return json(200, []);
        break;
      case "salesforce":
        if (url.pathname.endsWith(`/sobjects/Case/${t.id}`)) return json(200, { Id: t.id, Subject: t.subject, Description: t.messages[0].text, SuppliedName: t.requester.name, SuppliedEmail: t.requester.email, SuppliedPhone: t.requester.phone, CreatedDate: t.messages[0].at });
        if (url.pathname.endsWith("/query")) return json(200, { records: [] });
        break;
      case "hubspot":
        if (url.pathname === `/crm/v3/objects/tickets/${t.id}`) return json(200, { id: t.id, createdAt: t.messages[0].at, properties: { subject: t.subject, content: t.messages[0].text }, associations: { contacts: { results: [{ id: "c1" }] } } });
        if (url.pathname === "/crm/v3/objects/contacts/c1") { const [firstname, ...rest] = t.requester.name.split(" "); return json(200, { properties: { email: t.requester.email, phone: t.requester.phone, firstname, lastname: rest.join(" ") } }); }
        break;
    }
    return json(404, { error: "not found in the sandbox" });
  }) as typeof fetch;
}

/** The webhook body each product sends Orchestra for the sandbox ticket (what the bank configures in its CRM). */
export const SAMPLE_WEBHOOK: Record<CrmKind, unknown> = {
  zendesk: { ticket_id: SANDBOX_TICKETS.zendesk.id },
  freshdesk: { freshdesk_webhook: { ticket_id: Number(SANDBOX_TICKETS.freshdesk.id) } },
  salesforce: { caseId: SANDBOX_TICKETS.salesforce.id },
  hubspot: [{ objectId: Number(SANDBOX_TICKETS.hubspot.id), subscriptionType: "ticket.creation" }],
};
