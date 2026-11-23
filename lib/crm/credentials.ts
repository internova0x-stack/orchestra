import { createCipheriv, createDecipheriv, createHash, randomBytes } from "node:crypto";
import type { CrmConnector, CrmKind } from "./contract.ts";
import { freshdesk, hubspot, salesforce, zendesk, type Fetch } from "./connectors.ts";

// A bank connects its own helpdesk on the API page (Tomi, Nov 23: "the bank doesn't have access to Vercel"): the
// admin types the details the product gives out, Orchestra checks them with the product, then keeps them encrypted
// (AES-256-GCM) in crm_connectors. They are never sent back to the browser: only the account and the last 4 characters.
// The key comes from CREDENTIALS_KEY when set, otherwise it is derived from the database address.

export interface Field { id: string; label: string; placeholder: string; secret?: boolean; suffix?: string; hint?: string }

export const FIELDS: Record<CrmKind, Field[]> = {
  zendesk: [
    { id: "subdomain", label: "Your Zendesk address", placeholder: "yourbank", suffix: ".zendesk.com" },
    { id: "email", label: "Admin email", placeholder: "it-admin@yourbank.com" },
    { id: "token", label: "API token", placeholder: "Paste the token", secret: true, hint: "In Zendesk: Admin Center → Apps and integrations → Zendesk API → Add API token." },
  ],
  freshdesk: [
    { id: "domain", label: "Your Freshdesk address", placeholder: "yourbank", suffix: ".freshdesk.com" },
    { id: "apiKey", label: "API key", placeholder: "Paste the key", secret: true, hint: "In Freshdesk: your profile picture → Profile settings → View API key (use an admin's)." },
  ],
  salesforce: [
    { id: "instanceUrl", label: "Your Salesforce address", placeholder: "https://yourbank.my.salesforce.com" },
    { id: "clientId", label: "Consumer key", placeholder: "From the connected app" },
    { id: "clientSecret", label: "Consumer secret", placeholder: "From the connected app", secret: true, hint: "In Salesforce Setup: App Manager → New Connected App with the client credentials flow enabled and a run-as user." },
  ],
  hubspot: [
    { id: "accessToken", label: "Private app token", placeholder: "pat-…", secret: true, hint: "In HubSpot: Settings → Integrations → Private apps → Create, with the tickets and contacts scopes." },
  ],
};

export type Creds = Record<string, string>;

/** Tidy what was typed (a pasted address, a full URL) and check nothing is missing. */
export function cleanCreds(kind: CrmKind, input: Record<string, unknown>): { ok: true; creds: Creds } | { ok: false; error: string } {
  const creds: Creds = {};
  for (const f of FIELDS[kind]) {
    let v = String(input[f.id] ?? "").trim();
    if (f.suffix) v = v.replace(/^https?:\/\//i, "").replace(/\/.*$/, "").replace(new RegExp(`${f.suffix.replace(/\./g, "\\.")}$`, "i"), "");
    if (f.id === "instanceUrl") v = v.replace(/\/+$/, "").replace(/^(?!https?:\/\/)/i, "https://");
    if (!v) return { ok: false, error: `${f.label} is missing.` };
    if (v.length > 500) return { ok: false, error: `${f.label} is too long.` };
    if (f.suffix && !/^[a-z0-9][a-z0-9-]*$/i.test(v)) return { ok: false, error: `${f.label}: just the first part, for example ${f.placeholder}.` };
    if (f.id === "email" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v)) return { ok: false, error: "That email doesn't look right." };
    if (f.id === "instanceUrl" && !/^https:\/\/[a-z0-9.-]+$/i.test(v)) return { ok: false, error: "Your Salesforce address should look like https://yourbank.my.salesforce.com." };
    creds[f.id] = v;
  }
  return { ok: true, creds };
}

/** The connector for a set of credentials. */
export function connectorFor(kind: CrmKind, c: Creds, fetcher: Fetch = fetch): CrmConnector {
  if (kind === "zendesk") return zendesk({ subdomain: c.subdomain, email: c.email, token: c.token }, fetcher);
  if (kind === "freshdesk") return freshdesk({ domain: c.domain, apiKey: c.apiKey }, fetcher);
  if (kind === "salesforce") return salesforce({ instanceUrl: c.instanceUrl, clientId: c.clientId, clientSecret: c.clientSecret }, fetcher);
  return hubspot({ accessToken: c.accessToken }, fetcher);
}

/** What the screen may show: which account, and the end of the secret. */
export function describeCreds(kind: CrmKind, c: Creds): { account: string; last4: string } {
  const secret = FIELDS[kind].find((f) => f.secret)!;
  const account = kind === "zendesk" ? `${c.subdomain}.zendesk.com as ${c.email}` : kind === "freshdesk" ? `${c.domain}.freshdesk.com`
    : kind === "salesforce" ? c.instanceUrl.replace(/^https:\/\//, "") : "your HubSpot account";
  return { account, last4: (c[secret.id] ?? "").slice(-4) };
}

function key(): Buffer {
  const base = process.env.CREDENTIALS_KEY?.trim() || `orchestra-credentials:${process.env.DATABASE_URL ?? "local"}`;
  return createHash("sha256").update(base).digest();
}

export function sealCreds(c: Creds): string {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", key(), iv);
  const data = Buffer.concat([cipher.update(JSON.stringify(c), "utf8"), cipher.final()]);
  return ["v1", iv.toString("base64"), cipher.getAuthTag().toString("base64"), data.toString("base64")].join(".");
}

/** null when it can't be read (for example the key changed): the screen then asks for the details again. */
export function openCreds(sealed: string | null): Creds | null {
  if (!sealed) return null;
  try {
    const [v, iv, tag, data] = sealed.split(".");
    if (v !== "v1") return null;
    const d = createDecipheriv("aes-256-gcm", key(), Buffer.from(iv, "base64"));
    d.setAuthTag(Buffer.from(tag, "base64"));
    return JSON.parse(Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8"));
  } catch {
    return null;
  }
}

/** The secret part of a connector's webhook address. */
export const newWebhookToken = () => randomBytes(18).toString("base64url");
