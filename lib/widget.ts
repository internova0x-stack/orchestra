import { createHash, createHmac, randomBytes, timingSafeEqual } from "node:crypto";
import type { Sql } from "./db.ts";
import type { StaffUser } from "./staff.ts";
import { openConversation } from "./api/channel.ts";
import { bank } from "./bank/index.ts";
import { Rules } from "./rules.ts";
import { openCreds, sealCreds } from "./crm/credentials.ts";

// The website chat widget (Tomi, Nov 25: "build the chat widget"). A bank pastes one script tag on its website or in
// its app's web view (public/widget.js). The script puts a button in the corner and opens the chat in a frame served
// by Orchestra (/w/{key}); browsers refuse that frame on any site not in the widget's list (frame-ancestors, set in
// proxy.ts). Conversations are ordinary customer conversations (channel 'app', origin 'widget'): the same Alexis,
// rules, audit log, take-over and hand-back.
//
// A customer already signed in to the bank's site can arrive verified: the bank's server signs a short-lived token
// with the widget's signing secret (HMAC-SHA256 over the customer's id and an expiry), the page hands it to the
// widget, and Orchestra checks it before trusting it. The secret is shown once and kept encrypted.

export interface Widget {
  key: string; title: string; colour: string; origins: string[];
  secret_sealed: string | null; secret_last4: string | null; live: boolean; updated_at: string;
}

export const DEFAULT_TITLE = "Support";
export const DEFAULT_COLOUR = "#4F3BF3";
/** How long a signed-in customer's token may live, at most (the bank's server picks less). */
export const TOKEN_MAX_SECONDS = 3600;

export async function widget(sql: Sql): Promise<Widget | null> {
  const [w] = await sql<Widget[]>`select key, title, colour, origins, secret_sealed, secret_last4, live, updated_at from chat_widget where id = 1`;
  return w ?? null;
}

/** The widget by its public key, only while it's live. */
export async function liveWidget(sql: Sql, key: string): Promise<Widget | null> {
  if (!/^wk_[A-Za-z0-9_-]{8,64}$/.test(key)) return null;
  const w = await widget(sql);
  return w && w.live && w.key === key ? w : null;
}

/** For the API page. The signing secret itself is never sent back, only its last 4. */
export async function widgetView(sql: Sql) {
  const w = await widget(sql);
  if (!w) return { set: false as const };
  return { set: true as const, key: w.key, title: w.title, colour: w.colour, origins: w.origins, live: w.live, secretLast4: w.secret_last4 };
}

// ---------------------------------------------------------------- settings

/** The websites the widget may run on, as origins (https only; http only for this computer while testing). */
export function cleanOrigins(text: string): { ok: true; origins: string[] } | { ok: false; error: string } {
  const out: string[] = [];
  for (const raw of text.split(/[\s,]+/).map((x) => x.trim()).filter(Boolean)) {
    let u: URL;
    try {
      u = new URL(/^[a-z]+:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
      return { ok: false, error: `"${raw.slice(0, 80)}" isn't a website address.` };
    }
    const local = u.hostname === "localhost" || u.hostname === "127.0.0.1";
    if (u.protocol !== "https:" && !(u.protocol === "http:" && local)) return { ok: false, error: `${u.origin} must start with https://.` };
    if (u.username || u.password || u.hostname.includes("*")) return { ok: false, error: `"${raw.slice(0, 80)}" isn't a website address.` };
    if (!local && !u.hostname.includes(".")) return { ok: false, error: `"${raw.slice(0, 80)}" isn't a website address.` };
    if (!out.includes(u.origin)) out.push(u.origin);
  }
  if (out.length > 20) return { ok: false, error: "Up to 20 websites." };
  return { ok: true, origins: out };
}

const newKey = () => `wk_${randomBytes(15).toString("base64url")}`;
const HEX = /^#[0-9a-f]{6}$/i;

export async function saveWidget(sql: Sql, staff: StaffUser, input: { title?: unknown; colour?: unknown; origins?: unknown }) {
  const title = String(input.title ?? "").trim().slice(0, 60) || DEFAULT_TITLE;
  const colour = String(input.colour ?? "").trim() || DEFAULT_COLOUR;
  if (!HEX.test(colour)) return { ok: false as const, error: "Give the colour as a hex code, like #0F3D3E." };
  const o = cleanOrigins(String(input.origins ?? ""));
  if (!o.ok) return o;
  const was = await widget(sql);
  if (was) {
    await sql`update chat_widget set title = ${title}, colour = ${colour.toUpperCase()}, origins = ${o.origins}, updated_at = now() where id = 1`;
  } else {
    await sql`insert into chat_widget (id, key, title, colour, origins) values (1, ${newKey()}, ${title}, ${colour.toUpperCase()}, ${o.origins})`;
  }
  await log(sql, `Website chat · ${was ? "settings saved" : "set up"}: "${title}", ${o.origins.length ? o.origins.join(", ") : "no websites yet"}`, staff.name);
  return { ok: true as const };
}

/** A new signing secret, shown once. The old one stops working at once. */
export async function newSigningSecret(sql: Sql, staff: StaffUser) {
  const w = await widget(sql);
  if (!w) return { ok: false as const, error: "Set up the widget first." };
  const secret = `wsec_${randomBytes(24).toString("base64url")}`;
  await sql`update chat_widget set secret_sealed = ${sealCreds({ secret })}, secret_last4 = ${secret.slice(-4)}, updated_at = now() where id = 1`;
  await log(sql, `Website chat · ${w.secret_sealed ? "signing secret replaced (the old one no longer works)" : "signing secret created"}`, staff.name);
  return { ok: true as const, secret };
}

export async function setWidgetLive(sql: Sql, staff: StaffUser, live: boolean) {
  const w = await widget(sql);
  if (!w) return { ok: false as const, error: "Set up the widget first." };
  await sql`update chat_widget set live = ${live}, updated_at = now() where id = 1`;
  await log(sql, `Website chat · ${live ? "live: the chat opens on the listed websites" : "paused: the chat button no longer appears"}`, staff.name);
  return { ok: true as const };
}

/** Removes the widget and its key: the script tag stops working everywhere. Conversations stay. */
export async function removeWidget(sql: Sql, staff: StaffUser) {
  const w = await widget(sql);
  await sql`delete from chat_widget`;
  if (w) await log(sql, "Website chat · removed: its script tag no longer works", staff.name);
  return { ok: true as const };
}

async function log(sql: Sql, summary: string, staff: string) {
  await sql`insert into audit_log (tool_use_id, kind, tool, summary, staff)
    values (${`widget-${Date.now()}-${randomBytes(3).toString("hex")}`}, 'action', 'widget', ${summary.slice(0, 500)}, ${staff})`;
}

// ---------------------------------------------------------------- signed-in customers

const b64 = (s: string | Buffer) => Buffer.from(s).toString("base64url");
const mac = (secret: string, body: string) => createHmac("sha256", secret).update(body).digest("base64url");

/** What the bank's server does (Node shown on the API page): a token for one customer, good for `seconds`. */
export function signCustomerToken(secret: string, customerId: string, seconds = 600, now = Date.now()): string {
  const body = b64(JSON.stringify({ sub: customerId, exp: Math.floor(now / 1000) + Math.min(seconds, TOKEN_MAX_SECONDS) }));
  return `${body}.${mac(secret, body)}`;
}

/** The customer's id if the token is the bank's, unexpired and not too long-lived; otherwise null. */
export function readCustomerToken(secret: string, token: string, now = Date.now()): string | null {
  const [body, sig] = String(token).split(".");
  if (!body || !sig || token.length > 600) return null;
  const want = Buffer.from(mac(secret, body));
  const got = Buffer.from(sig);
  if (want.length !== got.length || !timingSafeEqual(want, got)) return null;
  try {
    const p = JSON.parse(Buffer.from(body, "base64url").toString("utf8")) as { sub?: unknown; exp?: unknown };
    const t = Math.floor(now / 1000);
    if (typeof p.sub !== "string" || !p.sub || p.sub.length > 100 || typeof p.exp !== "number") return null;
    if (p.exp < t || p.exp > t + TOKEN_MAX_SECONDS + 60) return null;
    return p.sub;
  } catch {
    return null;
  }
}

function secretOf(w: Widget): string | null {
  return openCreds(w.secret_sealed)?.secret ?? null;
}

/** The try-it page plays a signed-in customer: the server signs for a sample customer (never a typed secret). */
export async function demoToken(sql: Sql, customerId: string) {
  const w = await widget(sql);
  const secret = w && secretOf(w);
  if (!secret) return { ok: false as const, error: "Create the signing secret first (step 4)." };
  if (!(await bank(sql).getUser(customerId))) return { ok: false as const, error: "Unknown customer." };
  return { ok: true as const, token: signCustomerToken(secret, customerId, 600) };
}

// ---------------------------------------------------------------- conversations

/** A visitor, as a one-way hash of their address: enough to limit new conversations, never stored in the clear. */
export function visitorOf(req: Request): string {
  const ip = (req.headers.get("x-forwarded-for") ?? "").split(",")[0].trim() || req.headers.get("x-real-ip") || "unknown";
  return createHash("sha256").update(`orchestra-widget:${ip}`).digest("hex").slice(0, 32);
}

export type StartResult =
  | { ok: true; conversation_id: string; greeting: string | null; signedIn: string | null }
  | { ok: false; error: "too_many" | "bad_token" };

/** A new conversation from the widget. With the bank's token the customer arrives verified. */
export async function startConversation(sql: Sql, w: Widget, input: { token?: unknown; language?: unknown; country?: unknown; visitor: string }): Promise<StartResult> {
  const rules = await Rules.load(sql);
  const max = rules.num("widget_conversations_per_hour", 10);
  const [{ n }] = await sql<{ n: number }[]>`select count(*)::int as n from conversations
    where widget_visitor = ${input.visitor} and created_at > now() - interval '1 hour'`;
  if (n >= max) return { ok: false, error: "too_many" };
  let customer: string | null = null;
  let signedIn: string | null = null;
  if (typeof input.token === "string" && input.token) {
    const secret = secretOf(w);
    customer = secret ? readCustomerToken(secret, input.token) : null;
    const u = customer ? await bank(sql).getUser(customer) : null;
    // A token Orchestra can't trust is refused outright, never quietly treated as a guest.
    if (!u) return { ok: false, error: "bad_token" };
    signedIn = u.first_name || u.full_name.split(" ")[0];
  }
  const opened = await openConversation(sql, {
    channel: "app", origin: "widget", via: "website chat", language: typeof input.language === "string" ? input.language : undefined,
    country: typeof input.country === "string" ? input.country : undefined,
    ...(customer ? { verified_user_id: customer } : {}),
  });
  if ("error" in opened) return { ok: false, error: "bad_token" };
  await sql`update conversations set widget_visitor = ${input.visitor} where id = ${opened.conversation_id}`;
  return { ok: true, conversation_id: opened.conversation_id, greeting: opened.greeting, signedIn };
}

/** Whether this conversation was started by the widget (the only ones its routes may touch). */
export async function isWidgetConversation(sql: Sql, id: string): Promise<boolean> {
  if (!/^[0-9a-f-]{36}$/i.test(id)) return false;
  const [c] = await sql<{ origin: string | null }[]>`select origin from conversations where id = ${id} and mode = 'customer'`;
  return c?.origin === "widget";
}
