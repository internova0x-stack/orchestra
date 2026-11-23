import type { Sql } from "./db.ts";
import { SESSION_IDLE_MINUTES } from "./config.ts";
import { bank } from "./bank/index.ts";

export interface Conversation {
  id: string;
  typing_user_id: string | null;
  messages: unknown[];
  verified_user_id: string | null;
  verified_at: Date | null;
  failed_attempts: number;
  pending_identity_tool_id: string | null;
  pending_results: unknown[];
  pending_action: PendingAction | null;
  stronger_verified_at: Date | null;
  pending_code: { tool_use_id: string; code: string; sent_at: string; attempts: number; staff?: string; sent_to?: string } | null;
  last_activity: Date;
  /** The member of the team who took the conversation over in the console; Alexis is paused meanwhile. */
  taken_over_by: string | null;
  /** Where the customer wrote from: the bank's app, WhatsApp or email (simulated). */
  channel: Channel;
  email_subject: string | null;
  /** Waiting for the team: Alexis switched off ('switched_off') or the AI service down ('ai_unavailable'). */
  awaiting_team: string | null;
  /** The language the customer chose in the app (en, fr, pcm). */
  language: string;
}

/** The languages the customer app offers; Alexis replies in the one chosen. */
export const LANGUAGES: Record<string, string> = { en: "English", fr: "French", pcm: "Nigerian Pidgin" };

export type Channel = "app" | "whatsapp" | "email";
export const CHANNELS: Channel[] = ["app", "whatsapp", "email"];

/** An action Alexis has asked the customer to confirm. Only the customer's own yes confirms it. */
export interface PendingAction {
  tool: string;
  /** The record the action applies to (a payout, card, transaction, fee…). */
  record: string;
  /** How to name it to Alexis and in the activity panel, e.g. "recall on PO-88213". */
  label: string;
  confirmed: boolean;
  asked_at: string;
  /** Set when a member of the team asked for it from the console (lib/staffActions.ts): the customer answers in their app. */
  staff?: { id: string; name: string; role: "support_agent" | "supervisor"; approvedBy?: string | null };
  input?: unknown;
  action?: string;
  consequence?: string;
}

export interface VerifiedUser {
  id: string;
  full_name: string;
  first_name: string;
  role: "view_only" | "payment_rights";
  business_id: string;
  business_name: string;
  /** Personal (retail) account rather than a business. */
  personal: boolean;
  /** Passed the stronger check (one-time code) in this session. */
  stronger: boolean;
  /** The business's country, which picks the market's rule values. */
  country: string;
}

export async function loadConversation(sql: Sql, id: string): Promise<Conversation | null> {
  const rows = await sql<Conversation[]>`select * from conversations where id = ${id}`;
  return rows[0] ?? null;
}

export async function createConversation(sql: Sql, id: string, typingUserId: string | null, channel: Channel = "app", subject: string | null = null): Promise<Conversation> {
  const rows = await sql<Conversation[]>`
    insert into conversations (id, typing_user_id, channel, email_subject)
    values (${id}, ${typingUserId}, ${channel}, ${channel === "email" ? subject : null}) returning *`;
  return rows[0];
}

/** The verified user, or null if the session isn't verified or has been idle too long. */
export async function verifiedUser(sql: Sql, conv: Conversation, now: Date): Promise<VerifiedUser | null> {
  if (!conv.verified_user_id || !conv.verified_at) return null;
  const idle = now.getTime() - new Date(conv.last_activity).getTime();
  if (idle > SESSION_IDLE_MINUTES * 60_000) return null;
  // The customer's profile comes from the bank (Bank Connector API, GET /users/{id}).
  const b = await bank(sql).getUser(conv.verified_user_id);
  if (!b) return null;
  const user: VerifiedUser = {
    id: b.id, full_name: b.full_name, first_name: b.first_name, role: b.role, business_id: b.holder_id,
    business_name: b.holder_name, personal: Boolean(b.personal), stronger: false, country: b.country,
  };
  user.stronger = Boolean(conv.stronger_verified_at);
  return user;
}

