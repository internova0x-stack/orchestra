import { randomUUID } from "node:crypto";
import type { Sql } from "../db.ts";
import { runTurn, type TurnInput } from "../agent.ts";
import { bank } from "../bank/index.ts";
import { transcriptOf } from "../cases.ts";
import { GREETINGS } from "../greeting.ts";
import { CHANNELS, LANGUAGES, createConversation, type Channel } from "../session.ts";
import type { StreamEvent } from "../tools.ts";

// The Channel API (the Orchestra API, Nov 23): a bank's app, a WhatsApp provider or a mailbox brings its
// customers' messages to Alexis and gets the replies back, as JSON. The same turn as the customer app:
// every check, the audit log, take-over and hand-back. What a form-based step needs (the identity check,
// a Yes/Cancel, a one-time code) comes back under `needs`; the channel shows it its own way (a secure
// link, buttons) and sends the answer back on the same endpoint.

export interface ChannelReply {
  conversation_id: string;
  /** Alexis's reply, or null when a member of the team is handling the conversation or it's waiting for them. */
  reply: string | null;
  handled_by: string | null;
  needs: ({ type: "identity" } | { type: "confirm"; action: string; consequence: string } | { type: "code"; sent_to: string })[];
  cards: unknown[];
  handoff: { reference: string; urgency: string; respond: string } | null;
  proof: unknown | null;
  notices: string[];
}

export async function openConversation(
  sql: Sql,
  input: { channel?: string; verified_user_id?: string; external_ref?: string; language?: string; subject?: string },
): Promise<{ conversation_id: string; greeting: string | null } | { error: string }> {
  const channel: Channel = CHANNELS.includes(input.channel as Channel) ? (input.channel as Channel) : "app";
  const id = randomUUID();
  // A customer the bank's app has already signed in arrives verified; the bank vouches for them.
  let verified: string | null = null;
  if (input.verified_user_id) {
    const u = await bank(sql).getUser(input.verified_user_id);
    if (!u) return { error: "unknown_user" };
    verified = u.id;
  }
  const language = input.language && LANGUAGES[input.language] ? input.language : "en";
  await createConversation(sql, id, verified, channel, input.subject ?? null);
  await sql`update conversations set language = ${language}, external_ref = ${input.external_ref?.slice(0, 200) ?? null}
    ${verified ? sql`, verified_user_id = ${verified}, verified_at = now(), last_activity = now()` : sql``}
    where id = ${id}`;
  if (verified) {
    await sql`insert into audit_log (conversation_id, user_id, tool_use_id, kind, tool, summary)
      values (${id}, ${verified}, ${`api-${id}`}, 'identity', 'verify_identity', 'verified by the bank (signed in to its app) · Channel API')`;
  }
  return { conversation_id: id, greeting: channel === "email" ? null : GREETINGS[language] ?? GREETINGS.en };
}

/** One customer turn through the Channel API: a message, or the answer to a form, a confirmation or a code. */
export async function sendToAlexis(
  sql: Sql,
  conversationId: string,
  body: { text?: string; identity?: TurnInput["identity"]; confirm?: boolean; code?: string; image?: TurnInput["image"] },
): Promise<ChannelReply> {
  const out: ChannelReply = { conversation_id: conversationId, reply: null, handled_by: null, needs: [], cards: [], handoff: null, proof: null, notices: [] };
  let text = "";
  const emit = (e: StreamEvent) => {
    switch (e.type) {
      case "text": text += e.delta; break;
      case "break": if (text) text += "\n\n"; break;
      case "identity_form": out.needs.push({ type: "identity" }); break;
      case "confirm": out.needs.push({ type: "confirm", action: e.action, consequence: e.consequence }); break;
      case "code_form": out.needs.push({ type: "code", sent_to: e.sentTo }); break;
      case "card": out.cards.push(...e.cards); break;
      case "handoff": out.handoff = { reference: e.reference, urgency: e.urgency, respond: e.respond }; break;
      case "proof": out.proof = e.proof; break;
      case "taken_over": out.handled_by = e.by; break;
      case "team_queue": out.notices.push(e.message); break;
      case "masked": out.notices.push("A secret was removed from the customer's message before anyone saw it."); break;
      case "error": text += (text ? "\n\n" : "") + e.message; break;
    }
  };
  const [c] = await sql<{ typing_user_id: string | null }[]>`select typing_user_id from conversations where id = ${conversationId} and mode = 'customer'`;
  await runTurn(sql, {
    conversationId, typingUserId: c?.typing_user_id ?? null,
    message: typeof body.text === "string" ? body.text.slice(0, 4000) : undefined,
    identity: body.identity, confirm: typeof body.confirm === "boolean" ? body.confirm : undefined,
    code: typeof body.code === "string" ? body.code.slice(0, 12) : undefined, image: body.image,
  }, emit);
  out.reply = text.trim() || null;
  return out;
}

/** The conversation so far, for a channel that polls (team replies arrive here and as message.created webhooks). */
export async function conversationMessages(sql: Sql, conversationId: string) {
  const [c] = await sql<{ messages: never; taken_over_by: string | null; awaiting_team: string | null; channel: string }[]>`
    select messages, taken_over_by, awaiting_team, channel from conversations where id = ${conversationId} and mode = 'customer'`;
  if (!c) return null;
  return {
    conversation_id: conversationId,
    channel: c.channel,
    handled_by: c.taken_over_by,
    waiting_for_team: Boolean(c.awaiting_team),
    messages: transcriptOf(c.messages).map((m, i) => ({ index: i, from: m.who === "Customer" ? "customer" : m.staff ? "team" : "alexis", ...(m.staff ? { name: m.staff } : {}), text: m.text })),
  };
}
