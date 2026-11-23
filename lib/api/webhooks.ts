import { createHmac, randomBytes, randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";

// Webhooks (the Orchestra API, Nov 23): Orchestra tells a bank's other systems (a CRM, a helpdesk, a
// channel provider) what happened. Each delivery is signed: the header Orchestra-Signature is
// "t=<unix seconds>,v1=<hex HMAC-SHA256 of "<t>.<body>" with the endpoint's secret>", so the receiver can
// check it came from Orchestra and isn't replayed. A failed delivery is kept and can be retried.

export const WEBHOOK_EVENTS = [
  "case.created",          // Alexis handed a conversation to the team (the handoff summary, urgency, response target)
  "case.updated",          // a supervisor approved or declined, or the team resolved a case
  "conversation.taken_over", // a member of the team took a conversation over
  "conversation.handed_back", // and handed it back to Alexis
  "conversation.reviewed", // the team reviewed a conversation (good / needs work)
  "message.created",       // a reply to the customer from Alexis or the team (for channels that deliver it)
  "customer.notified",     // a proactive status update was sent to the customer's phone on file
] as const;
export type WebhookEvent = (typeof WEBHOOK_EVENTS)[number];

export function signature(secret: string, body: string, t = Math.floor(Date.now() / 1000)): string {
  return `t=${t},v1=${createHmac("sha256", secret).update(`${t}.${body}`).digest("hex")}`;
}

export const newSecret = () => `whsec_${randomBytes(24).toString("base64url")}`;

/** Only public HTTPS addresses: never this machine or a private network (no requests into internal systems). */
export function webhookUrlProblem(raw: string): string | null {
  let u: URL;
  try { u = new URL(raw); } catch { return "That isn't a web address."; }
  if (u.protocol !== "https:") return "Use an https:// address.";
  const h = u.hostname.toLowerCase();
  if (h === "localhost" || h.endsWith(".localhost") || h.endsWith(".internal") || h.endsWith(".local")) return "Use a public address.";
  if (/^(127\.|10\.|192\.168\.|169\.254\.|0\.|172\.(1[6-9]|2\d|3[01])\.)/.test(h) || h === "::1" || h.startsWith("[")) return "Use a public address, not an IP on a private network.";
  return null;
}

type Fetcher = typeof fetch;
let fetcher: Fetcher = fetch;
/** Tests swap the network for a stand-in. */
export function setWebhookFetcher(f: Fetcher | null) { fetcher = f ?? fetch; }

/** Send one delivery now. Never throws: the outcome is recorded on the delivery. */
export async function deliver(sql: Sql, deliveryId: number): Promise<void> {
  const [d] = await sql<{ id: number; payload: unknown; url: string; secret: string; attempts: number }[]>`
    select d.id, d.payload, e.url, e.secret, d.attempts from webhook_deliveries d join webhook_endpoints e on e.id = d.endpoint_id
    where d.id = ${deliveryId} and d.status <> 'delivered'`;
  if (!d) return;
  const body = JSON.stringify(d.payload);
  let status = 0;
  let error: string | null = null;
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), 8000);
  try {
    const res = await fetcher(d.url, {
      method: "POST",
      headers: { "Content-Type": "application/json", "User-Agent": "Orchestra-Webhooks/1", "Orchestra-Signature": signature((d as { secret: string }).secret, body) },
      body,
      signal: ctrl.signal,
      redirect: "manual",
    });
    status = res.status;
    if (!res.ok) error = `HTTP ${res.status}`;
  } catch (err) {
    error = (err as Error).message.slice(0, 200);
  } finally {
    clearTimeout(timer);
  }
  const ok = status >= 200 && status < 300;
  await sql`update webhook_deliveries set attempts = attempts + 1, last_status = ${status || null}, last_error = ${error},
    status = ${ok ? "delivered" : d.attempts + 1 >= 5 ? "failed" : "pending"}, delivered_at = ${ok ? new Date() : null}
    where id = ${d.id}`.catch(() => {});
}

/** Run work after the response where the platform allows it (Next's after()), otherwise straight away. */
async function later(work: () => Promise<void>) {
  try {
    const { after } = await import("next/server");
    after(work);
  } catch {
    void work().catch(() => {});
  }
}

/**
 * Record an event for every active endpoint that wants it and send them. Never throws and never slows
 * the caller: a webhook problem must not break a conversation.
 */
export async function emitEvent(sql: Sql, event: WebhookEvent, data: Record<string, unknown>): Promise<void> {
  try {
    const endpoints = await sql<{ id: string }[]>`select id from webhook_endpoints where active and ${event} = any(events)`;
    if (!endpoints.length) return;
    const payload = { id: `evt_${randomUUID()}`, type: event, created: new Date().toISOString(), data };
    const ids: number[] = [];
    for (const e of endpoints) {
      const [r] = await sql<{ id: number }[]>`insert into webhook_deliveries (endpoint_id, event_id, event, payload)
        values (${e.id}, ${payload.id}, ${event}, ${sql.json(payload as never)}) returning id`;
      ids.push(r.id);
    }
    await later(async () => { for (const id of ids) await deliver(sql, id); });
  } catch (err) {
    console.error("webhook event failed", event, err);
  }
}

/** Retry deliveries still pending (fewer than 5 attempts), oldest first. */
export async function retryPending(sql: Sql, limit = 20): Promise<number> {
  const rows = await sql<{ id: number }[]>`select id from webhook_deliveries where status = 'pending' and attempts > 0 order by id limit ${limit}`;
  for (const r of rows) await deliver(sql, r.id);
  return rows.length;
}
