import { randomBytes, timingSafeEqual } from "node:crypto";
import type { Sql } from "../db.ts";
import type { StaffUser } from "../staff.ts";
import { openConversation, sendToAlexis, type ChannelReply } from "../api/channel.ts";
import { loadConversation } from "../session.ts";
import { storeForTeam } from "../agent.ts";
import { postmark, postmarkReady, practiceRecords, type DnsRecord, type OutgoingEmail } from "./provider.ts";

// The email channel (Tomi, Nov 23: "email connections can be done now"; "Forward and send"). A bank forwards its
// support address to Orchestra's private inbound address; Orchestra replies from that address once its domain's DNS
// records are in place. Three steps on the API page: receive (a test email arrives), reply (DNS checked), go live
// (Drafts first: the team sends from Messages; or Alexis replies). Forms Alexis needs over email (the identity
// check, a Yes/Cancel, a one-time code) go out as a private link to /e/<token>, valid 24 hours.

export interface EmailChannel {
  address: string; domain: string; forward_hash: string; forward_address: string; inbound_secret: string; base_url: string;
  practice: boolean; domain_id: number | null; records: DnsRecord[]; test_received_at: Date | null; test_from: string | null;
  test_subject: string | null; confirm_code: string | null; confirm_link: string | null; dns_checked_at: Date | null;
  dns_verified_at: Date | null; mode: "drafts" | "replies"; live: boolean; live_at: Date | null; connected_by: string | null;
}

type Fetch = typeof fetch;
const token = (n: number) => randomBytes(n).toString("base64url");

export async function emailChannel(sql: Sql): Promise<EmailChannel | null> {
  const [row] = await sql<EmailChannel[]>`select * from email_channel where id = 1`;
  return row ?? null;
}

/** What the API page shows. The forwarding address and the inbound secret only for people who manage the API page. */
export async function emailView(sql: Sql, manager: boolean) {
  const c = await emailChannel(sql);
  const service = postmarkReady() ? "postmark" : "practice";
  if (!c) return { connected: false as const, service };
  const [today] = await sql<{ received: number; sent: number; drafts: number }[]>`
    select count(*) filter (where summary like 'email received%')::int as received, count(*) filter (where summary like 'email sent%')::int as sent,
      count(*) filter (where summary like 'email received%waiting for the team%')::int as drafts
    from audit_log where tool = 'email' and created_at > date_trunc('day', now())`;
  const step = !c.test_received_at ? 1 : !c.dns_verified_at ? 2 : !c.live ? 3 : 4;
  return {
    connected: true as const, service, step, address: c.address, domain: c.domain, practice: c.practice,
    forwardAddress: manager ? c.forward_address : null, records: c.records,
    test: c.test_received_at ? { at: c.test_received_at, from: c.test_from, subject: c.test_subject } : null,
    confirm: c.confirm_code || c.confirm_link ? { code: c.confirm_code, link: c.confirm_link } : null,
    dnsCheckedAt: c.dns_checked_at, dnsVerifiedAt: c.dns_verified_at, mode: c.mode, live: c.live, liveAt: c.live_at, today,
  };
}

const EMAIL = /^[^@\s<>]+@([a-z0-9-]+(\.[a-z0-9-]+)+)$/i;

/** Step 1: the bank's support address. Sets up the forwarding address and the domain's DNS records. */
export async function startEmail(sql: Sql, input: { address: string; staff: StaffUser; baseUrl: string }, fetcher: Fetch = fetch) {
  const address = input.address.trim().toLowerCase();
  const m = EMAIL.exec(address);
  if (!m) return { ok: false as const, error: "That doesn't look like an email address." };
  const domain = m[1];
  if (/^(gmail|googlemail|outlook|hotmail|live|yahoo|icloud|proton|protonmail)\./.test(domain)) {
    return { ok: false as const, error: "Use your own domain's address (like support@yourbank.com). Replies can't be sent from a personal Gmail or Outlook address." };
  }
  const hash = token(6).replace(/[-_]/g, "x").toLowerCase();
  const secret = token(24);
  let forward: string, records: DnsRecord[], domainId: number | null = null;
  const practice = !postmarkReady();
  if (practice) {
    forward = `${domain.split(".")[0]}-${hash}@inbound.practice.example`;
    records = practiceRecords(domain);
  } else {
    try {
      const pm = postmark(fetcher);
      const inbound = await pm.setUpInbound(`${input.baseUrl}/api/v1/email/inbound/${secret}`);
      forward = inbound.replace("@", `+${hash}@`);
      const d = await pm.addDomain(domain);
      domainId = d.id;
      records = d.records;
    } catch (err) {
      return { ok: false as const, error: `The email service didn't accept this: ${(err as Error).message.replace(/^Postmark /, "")}` };
    }
  }
  await sql`delete from email_channel`;
  await sql`insert into email_channel (id, address, domain, forward_hash, forward_address, inbound_secret, base_url, practice, domain_id, records, connected_by, updated_at)
    values (1, ${address}, ${domain}, ${hash}, ${forward}, ${secret}, ${input.baseUrl}, ${practice}, ${domainId}, ${sql.json(records as never)}, ${input.staff.name}, now())`;
  await log(sql, null, "action", `Support email · setting up ${address}${practice ? " (practice mode)" : ""}`, input.staff.name);
  return { ok: true as const };
}

/** Step 2: look the DNS records up. */
export async function checkDns(sql: Sql, staff: StaffUser, fetcher: Fetch = fetch) {
  const c = await emailChannel(sql);
  if (!c) return { ok: false as const, error: "Set up the support address first." };
  let records = c.records, verified = false;
  if (c.practice) {
    records = c.records.map((r) => ({ ...r, verified: true }));
    verified = true;
  } else {
    try {
      const out = await postmark(fetcher).verifyDomain(c.domain_id!);
      records = out.records;
      verified = out.verified;
    } catch (err) {
      return { ok: false as const, error: `Couldn't check the records: ${(err as Error).message.replace(/^Postmark /, "")}` };
    }
  }
  await sql`update email_channel set records = ${sql.json(records as never)}, dns_checked_at = now(),
    dns_verified_at = ${verified ? new Date() : null}, updated_at = now() where id = 1`;
  if (verified) await log(sql, null, "action", `Support email · DNS records found for ${c.domain}: replies can come from ${c.address}`, staff.name);
  return { ok: true as const, verified };
}

/** Step 3: go live (or change how Alexis works once live). */
export async function setEmailLive(sql: Sql, staff: StaffUser, mode: "drafts" | "replies") {
  const c = await emailChannel(sql);
  if (!c) return { ok: false as const, error: "Set up the support address first." };
  if (!c.test_received_at) return { ok: false as const, error: "No forwarded email has arrived yet: finish step 1 first." };
  if (!c.dns_verified_at) return { ok: false as const, error: "The DNS records haven't been found yet: finish step 2 first." };
  await sql`update email_channel set mode = ${mode}, live = true, live_at = coalesce(live_at, now()), updated_at = now() where id = 1`;
  await log(sql, null, "action", `Support email · ${c.live ? "now" : "live"}: ${mode === "drafts" ? "drafts first (the team sends)" : "Alexis replies"}`, staff.name);
  return { ok: true as const };
}

export async function disconnectEmail(sql: Sql, staff: StaffUser) {
  const c = await emailChannel(sql);
  await sql`delete from email_channel`;
  if (c) await log(sql, null, "action", `Support email · disconnected ${c.address}: Orchestra no longer receives or sends its email`, staff.name);
  return { ok: true as const };
}

/** One audit row (tool 'email'); `kind` is the audit log's own: setup and email traffic are actions. */
async function log(sql: Sql, conversationId: string | null, kind: "action" | "error", summary: string, staff: string | null = null) {
  await sql`insert into audit_log (conversation_id, tool_use_id, kind, tool, summary, staff)
    values (${conversationId}, ${`email-${Date.now()}-${token(3)}`}, ${kind}, 'email', ${summary.slice(0, 500)}, ${staff})`;
}

/** Whether a call to the inbound address carries the channel's secret. */
export async function inboundSecretOk(sql: Sql, secret: string): Promise<boolean> {
  const c = await emailChannel(sql);
  if (!c || !secret) return false;
  const a = Buffer.from(c.inbound_secret), b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

// ---------------------------------------------------------------- receiving

/** The fields Orchestra reads from Postmark's inbound JSON. */
export interface InboundEmail {
  From?: string; FromName?: string; FromFull?: { Email?: string; Name?: string };
  To?: string; OriginalRecipient?: string; MailboxHash?: string; Subject?: string;
  TextBody?: string; StrippedTextReply?: string; MessageID?: string;
  Headers?: { Name: string; Value: string }[];
}

const header = (e: InboundEmail, name: string) => e.Headers?.find((h) => h.Name.toLowerCase() === name.toLowerCase())?.Value ?? null;
const ids = (v: string | null) => (v ? v.match(/<[^>]+>/g) ?? [] : []);
export const baseSubject = (s: string) => s.replace(/^\s*((re|fw|fwd|aw|sv)\s*:\s*)+/i, "").trim().toLowerCase();

/** The customer's new words: Postmark's stripped reply when it has one, else the body without quoted history. */
export function newText(e: InboundEmail): string {
  if (e.StrippedTextReply?.trim()) return e.StrippedTextReply.trim();
  const lines = (e.TextBody ?? "").replace(/\r/g, "").split("\n");
  const out: string[] = [];
  for (const l of lines) {
    if (/^On .+wrote:\s*$/.test(l) || /^-{2,}\s*Original Message\s*-{2,}/i.test(l) || /^From: .+/.test(l) && out.length > 0) break;
    if (l.startsWith(">")) continue;
    out.push(l);
  }
  return out.join("\n").trim();
}

export type InboundResult =
  | { ok: true; kind: "test" | "confirmation" | "skipped" | "queued" | "answered"; conversation_id?: string; reason?: string }
  | { ok: false; error: string };

/**
 * An email forwarded from the bank's support address. Before the channel is live it only counts as the test; Google's
 * forwarding confirmation is kept for the API page; auto-replies and loops are dropped. Once live, it joins the
 * customer's thread (by its headers, else the same sender and subject in the last 30 days) and either waits for the
 * team (drafts first) or goes to Alexis, whose reply is emailed back.
 */
export async function handleInbound(sql: Sql, e: InboundEmail, opts: { fetcher?: Fetch; answer?: typeof sendToAlexis } = {}): Promise<InboundResult> {
  const c = await emailChannel(sql);
  if (!c) return { ok: false, error: "not_connected" };
  const hash = (e.MailboxHash || /\+([^@]+)@/.exec(e.OriginalRecipient ?? "")?.[1] || "").toLowerCase();
  if (hash !== c.forward_hash) return { ok: false, error: "wrong_address" };
  const from = (e.FromFull?.Email || e.From || "").trim().toLowerCase();
  const subject = (e.Subject ?? "").slice(0, 300);
  const body = e.TextBody ?? "";

  // Google's "confirm forwarding" email: show its code on the API page.
  if (/forwarding-noreply@google\.com$/.test(from)) {
    const code = /confirmation code:\s*(\d{6,12})/i.exec(body)?.[1] ?? null;
    const link = /(https:\/\/mail(-settings)?\.google\.com\/[^\s>]+)/.exec(body)?.[1] ?? null;
    await sql`update email_channel set confirm_code = ${code}, confirm_link = ${link}, updated_at = now() where id = 1`;
    return { ok: true, kind: "confirmation" };
  }
  // Never answer an automatic email, a bounce or Orchestra's own: that's how mail loops start.
  const auto = (header(e, "Auto-Submitted") ?? "no").toLowerCase() !== "no" || /^(mailer-daemon|postmaster|no-?reply)@/.test(from)
    || header(e, "X-Orchestra-Conversation") !== null || from === c.address || /^(bulk|junk|list)$/i.test(header(e, "Precedence") ?? "");
  if (!c.live) {
    if (!auto) await sql`update email_channel set test_received_at = now(), test_from = ${from}, test_subject = ${subject}, updated_at = now() where id = 1`;
    return { ok: true, kind: auto ? "skipped" : "test", reason: auto ? "automatic email" : undefined };
  }
  if (auto) return { ok: true, kind: "skipped", reason: "automatic email" };
  const text = newText(e).slice(0, 4000);
  if (!from || !text) return { ok: true, kind: "skipped", reason: "empty" };

  // The thread: a header naming a message of this conversation, else the same sender and subject.
  const refs = [...ids(header(e, "In-Reply-To")), ...ids(header(e, "References"))];
  const own = ids(header(e, "Message-ID"));
  let [conv] = refs.length
    ? await sql<{ id: string }[]>`select id from conversations where origin = 'email' and email_thread ?| ${refs} order by last_activity desc limit 1`
    : [];
  if (!conv) {
    [conv] = await sql<{ id: string }[]>`select id from conversations where origin = 'email' and email_from = ${from}
      and lower(regexp_replace(coalesce(email_subject, ''), '^\\s*((re|fw|fwd|aw|sv)\\s*:\\s*)+', '', 'i')) = ${baseSubject(subject)}
      and last_activity > now() - interval '30 days' order by last_activity desc limit 1`;
  }
  if (!conv) {
    const opened = await openConversation(sql, { channel: "email", subject: subject.replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, "") || "(no subject)" });
    if ("error" in opened) return { ok: false, error: opened.error };
    conv = { id: opened.conversation_id };
    await sql`update conversations set origin = 'email', email_from = ${from} where id = ${conv.id}`;
  }
  await sql`update conversations set email_thread = (select coalesce(jsonb_agg(distinct x), '[]') from jsonb_array_elements_text(email_thread || ${sql.json([...own, ...refs] as never)}) x)
    where id = ${conv.id}`;
  await log(sql, conv.id, "action", `email received from ${from}${c.mode === "drafts" ? " · waiting for the team (drafts first)" : ""}`);

  if (c.mode === "drafts") {
    const loaded = (await loadConversation(sql, conv.id))!;
    await storeForTeam(sql, loaded, { conversationId: conv.id, typingUserId: null, message: text }, new Date(), null, () => {});
    await sql`update conversations set awaiting_team = 'email_drafts' where id = ${conv.id} and taken_over_by is null`;
    return { ok: true, kind: "queued", conversation_id: conv.id };
  }
  const reply = await (opts.answer ?? sendToAlexis)(sql, conv.id, { text });
  await deliverAlexisReply(sql, conv.id, reply, opts.fetcher);
  return { ok: true, kind: "answered", conversation_id: conv.id };
}

// ---------------------------------------------------------------- sending

/** A private link for the forms Alexis needs over email, valid 24 hours (a new one replaces the old). */
export async function formLink(sql: Sql, conversationId: string, baseUrl: string): Promise<string> {
  const t = token(18);
  await sql`update conversations set email_link_token = ${t}, email_link_expires = now() + interval '24 hours' where id = ${conversationId}`;
  return `${baseUrl}/e/${t}`;
}

const NEED_TEXT: Record<string, string> = {
  identity: "Before I can look at your account, I need to confirm who you are. Please use this secure link (it works for 24 hours):",
  confirm: "To go ahead, please confirm on this secure page (it works for 24 hours):",
  code: "We've sent a one-time code to the phone number on your account. Enter it on this secure page (it works for 24 hours):",
};

/** Alexis's reply as an email, with a private link when she needs a form. */
export async function deliverAlexisReply(sql: Sql, conversationId: string, r: ChannelReply, fetcher?: Fetch) {
  const c = await emailChannel(sql);
  if (!c) return;
  const parts = [r.reply ?? ""];
  const need = r.needs[0];
  if (need) parts.push(`${NEED_TEXT[need.type]}\n${await formLink(sql, conversationId, c.base_url)}`);
  if (r.handled_by || r.notices.length && !r.reply) parts.push(r.notices.join("\n"));
  const text = parts.filter((p) => p.trim()).join("\n\n");
  if (text) await sendEmail(sql, conversationId, text, fetcher);
}

/** Send one email in the conversation's thread, from the bank's support address. */
export async function sendEmail(sql: Sql, conversationId: string, text: string, fetcher: Fetch = fetch): Promise<{ ok: boolean; error?: string }> {
  const c = await emailChannel(sql);
  if (!c || !c.live) return { ok: false, error: "The support email isn't live." };
  const [conv] = await sql<{ email_from: string | null; email_subject: string | null; email_thread: string[] }[]>`
    select email_from, email_subject, email_thread from conversations where id = ${conversationId}`;
  if (!conv?.email_from) return { ok: false, error: "No customer email address on this conversation." };
  const thread = conv.email_thread ?? [];
  const mine = `<orc-${conversationId.slice(0, 8)}-${Date.now().toString(36)}-${token(4)}@${c.domain}>`;
  const email: OutgoingEmail = {
    from: c.address, to: conv.email_from,
    subject: `Re: ${(conv.email_subject ?? "your message").replace(/^\s*((re|fw|fwd)\s*:\s*)+/i, "")}`,
    text,
    headers: {
      "Message-ID": mine, "X-Orchestra-Conversation": conversationId,
      ...(thread.length ? { "In-Reply-To": thread[thread.length - 1], References: thread.slice(-10).join(" ") } : {}),
    },
  };
  try {
    if (c.practice) {
      await sql`insert into email_practice_sent (conversation_id, sent_from, sent_to, subject, body, headers)
        values (${conversationId}, ${email.from}, ${email.to}, ${email.subject}, ${email.text}, ${sql.json(email.headers as never)})`;
    } else {
      await postmark(fetcher).send(email);
    }
  } catch (err) {
    await log(sql, conversationId, "error", `email to ${email.to} failed: ${(err as Error).message.slice(0, 200)}`);
    return { ok: false, error: (err as Error).message };
  }
  await sql`update conversations set email_thread = email_thread || ${sql.json([mine] as never)} where id = ${conversationId}`;
  await log(sql, conversationId, "action", `email sent to ${email.to}${c.practice ? " (practice: recorded, not sent)" : ""}`);
  return { ok: true };
}

/** Practice mode: play an email forwarded from the support address (the API page's "Send a test email"). */
export async function practiceIncoming(sql: Sql, input: { from: string; subject: string; text: string }, opts: { answer?: typeof sendToAlexis } = {}) {
  const c = await emailChannel(sql);
  if (!c?.practice) return { ok: false as const, error: "Only in practice mode." };
  return handleInbound(sql, {
    From: input.from, FromFull: { Email: input.from }, To: c.address, OriginalRecipient: c.forward_address, MailboxHash: c.forward_hash,
    Subject: input.subject, TextBody: input.text, MessageID: token(8),
    Headers: [{ Name: "Message-ID", Value: `<practice-${token(8)}@mail.example>` }],
  }, opts);
}

// ---------------------------------------------------------------- the private form page (/e/<token>)

export async function conversationForLink(sql: Sql, t: string) {
  if (!t || t.length < 16) return null;
  const [conv] = await sql<{ id: string }[]>`select id from conversations where email_link_token = ${t} and email_link_expires > now()`;
  if (!conv) return null;
  const loaded = await loadConversation(sql, conv.id);
  if (!loaded) return null;
  const need = loaded.pending_identity_tool_id ? { type: "identity" as const }
    : loaded.pending_code ? { type: "code" as const, sent_to: loaded.pending_code.sent_to ?? "the phone number on your account" }
    : loaded.pending_action && !loaded.pending_action.confirmed ? { type: "confirm" as const, action: loaded.pending_action.action ?? loaded.pending_action.label, consequence: loaded.pending_action.consequence ?? "" }
    : null;
  return { id: conv.id, need };
}
