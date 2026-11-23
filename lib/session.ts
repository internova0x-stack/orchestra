import type { Sql } from "./db.ts";
import { SESSION_IDLE_MINUTES } from "./config.ts";

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
  pending_code: { tool_use_id: string; code: string; sent_at: string; attempts: number } | null;
  last_activity: Date;
  /** The member of the team who took the conversation over in the console; Alexis is paused meanwhile. */
  taken_over_by: string | null;
  /** Where the customer wrote from: the bank's app, WhatsApp or email (simulated). */
  channel: Channel;
  email_subject: string | null;
}

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
  const rows = await sql<VerifiedUser[]>`
    select u.id, u.full_name, u.first_name, u.role, u.business_id, b.name as business_name,
      (b.kind = 'personal') as personal, false as stronger, b.country
    from business_users u join businesses b on b.id = u.business_id
    where u.id = ${conv.verified_user_id}`;
  const user = rows[0];
  if (!user) return null;
  user.stronger = Boolean(conv.stronger_verified_at);
  return user;
}

/** Most recent payout amount for a business: the second identity fact. */
export async function lastPayout(sql: Sql, businessId: string) {
  const rows = await sql<{ amount: string; currency: string }[]>`
    select amount, currency from transfers where business_id = ${businessId} order by sent_at desc limit 1`;
  return rows[0] ?? null;
}
