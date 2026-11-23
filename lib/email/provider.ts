// The email service behind the email channel (Tomi, Nov 23: "Forward and send"). Postmark, checked against its
// developer docs on Nov 23:
// - a server's inbound address is <hash>@inbound.postmarkapp.com; "<hash>+<something>@…" arrives with MailboxHash set;
//   GET /server returns InboundAddress, PUT /server sets InboundHookUrl (X-Postmark-Server-Token);
// - POST /email sends (From must be a verified domain or sender signature), MessageStream "outbound";
// - POST /domains {Name, ReturnPathDomain} returns the DKIM TXT record (DKIMPendingHost/DKIMPendingTextValue once it
//   exists, DKIMHost/DKIMTextValue after) and the Return-Path CNAME (ReturnPathDomain → ReturnPathDomainCNAMEValue);
//   PUT /domains/{id}/verifyDkim and /verifyReturnPath check them (X-Postmark-Account-Token).
// Without POSTMARK_SERVER_TOKEN and POSTMARK_ACCOUNT_TOKEN the channel runs in practice mode: nothing is sent or
// received for real; the API page plays the forwarded email and the DNS check, and replies are recorded.

export interface DnsRecord { type: "TXT" | "CNAME"; host: string; value: string; verified: boolean }
export interface OutgoingEmail { from: string; to: string; subject: string; text: string; headers: Record<string, string> }

type Fetch = typeof fetch;
const API = "https://api.postmarkapp.com";

export function postmarkReady(): boolean {
  return Boolean(process.env.POSTMARK_SERVER_TOKEN?.trim() && process.env.POSTMARK_ACCOUNT_TOKEN?.trim());
}

async function call<T>(fetcher: Fetch, method: string, path: string, token: { server?: boolean; account?: boolean }, body?: unknown): Promise<T> {
  const headers: Record<string, string> = { Accept: "application/json", "Content-Type": "application/json" };
  if (token.server) headers["X-Postmark-Server-Token"] = process.env.POSTMARK_SERVER_TOKEN!.trim();
  if (token.account) headers["X-Postmark-Account-Token"] = process.env.POSTMARK_ACCOUNT_TOKEN!.trim();
  const res = await fetcher(`${API}${path}`, { method, headers, body: body === undefined ? undefined : JSON.stringify(body) });
  const json = (await res.json().catch(() => ({}))) as T & { ErrorCode?: number; Message?: string };
  if (!res.ok || (json.ErrorCode && json.ErrorCode !== 0)) {
    throw Object.assign(new Error(`Postmark ${method} ${path}: ${json.Message ?? res.status}`), { status: res.status, code: json.ErrorCode });
  }
  return json;
}

interface PmDomain {
  ID: number; Name: string; DKIMVerified: boolean; ReturnPathDomainVerified: boolean;
  DKIMHost?: string; DKIMTextValue?: string; DKIMPendingHost?: string; DKIMPendingTextValue?: string;
  ReturnPathDomain?: string; ReturnPathDomainCNAMEValue?: string;
}

function recordsOf(d: PmDomain): DnsRecord[] {
  const dkimHost = d.DKIMPendingHost || d.DKIMHost || "";
  const dkimValue = d.DKIMPendingTextValue || d.DKIMTextValue || "";
  return [
    { type: "TXT", host: dkimHost, value: dkimValue, verified: Boolean(d.DKIMVerified) },
    { type: "CNAME", host: d.ReturnPathDomain ?? `pm-bounces.${d.Name}`, value: d.ReturnPathDomainCNAMEValue ?? "pm.mtasv.net", verified: Boolean(d.ReturnPathDomainVerified) },
  ];
}

export function postmark(fetcher: Fetch = fetch) {
  return {
    /** The server's inbound address, and point its inbound webhook at Orchestra. */
    async setUpInbound(hookUrl: string): Promise<string> {
      const server = await call<{ InboundAddress: string }>(fetcher, "GET", "/server", { server: true });
      await call(fetcher, "PUT", "/server", { server: true }, { InboundHookUrl: hookUrl });
      return server.InboundAddress;
    },
    /** Add the bank's domain (or find it if it's already there) and return the DNS records it needs. */
    async addDomain(name: string): Promise<{ id: number; records: DnsRecord[] }> {
      const list = await call<{ Domains: { ID: number; Name: string }[] }>(fetcher, "GET", "/domains?count=500&offset=0", { account: true });
      const found = list.Domains?.find((d) => d.Name.toLowerCase() === name.toLowerCase());
      const d = found
        ? await call<PmDomain>(fetcher, "GET", `/domains/${found.ID}`, { account: true })
        : await call<PmDomain>(fetcher, "POST", "/domains", { account: true }, { Name: name, ReturnPathDomain: `pm-bounces.${name}` });
      return { id: d.ID, records: recordsOf(d) };
    },
    /** Ask Postmark to look the records up now. */
    async verifyDomain(id: number): Promise<{ records: DnsRecord[]; verified: boolean }> {
      await call(fetcher, "PUT", `/domains/${id}/verifyDkim`, { account: true }).catch(() => null);
      await call(fetcher, "PUT", `/domains/${id}/verifyReturnPath`, { account: true }).catch(() => null);
      const d = await call<PmDomain>(fetcher, "GET", `/domains/${id}`, { account: true });
      // Replies are signed (DKIM) from the start; the Return-Path only improves bounce handling, so DKIM decides.
      return { records: recordsOf(d), verified: Boolean(d.DKIMVerified) };
    },
    async send(e: OutgoingEmail): Promise<string> {
      const out = await call<{ MessageID: string }>(fetcher, "POST", "/email", { server: true }, {
        From: e.from, To: e.to, Subject: e.subject, TextBody: e.text, MessageStream: "outbound",
        Headers: Object.entries(e.headers).map(([Name, Value]) => ({ Name, Value })),
      });
      return out.MessageID;
    },
  };
}

/** Practice mode's DNS records: shaped like Postmark's, never checked against real DNS. */
export function practiceRecords(domain: string): DnsRecord[] {
  return [
    { type: "TXT", host: `practice${new Date().getFullYear()}pm._domainkey.${domain}`, value: "k=rsa;p=PRACTICE-ONLY-NOT-A-REAL-KEY", verified: false },
    { type: "CNAME", host: `pm-bounces.${domain}`, value: "pm.mtasv.net", verified: false },
  ];
}
