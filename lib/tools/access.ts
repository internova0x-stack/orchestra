import { randomInt } from "node:crypto";
import { z } from "zod";
import { AWAITING_CODE, audit, confirmFirst, refuse, type Tier, type ToolCtx, type ToolResult } from "../toolkit.ts";
import type { Rules } from "../rules.ts";

// Use case 4: account access and recovery, and the stronger identity check it needs (Guardrails:
// "Stronger: tier 3 actions, and anything in account access and recovery").

export const maskPhone = (p: string | null) => (p ? `•••• ${p.replace(/\D/g, "").slice(-4)}` : "no phone on file");
export const maskEmail = (e: string | null) => {
  if (!e) return "no email on file";
  const [name, domain] = e.split("@");
  return `${name.slice(0, 1)}•••@${domain}`;
};

interface Contact { phone: string | null; email: string | null; login_locked: string | null }

async function contact(ctx: ToolCtx): Promise<Contact> {
  const [c] = await ctx.sql<Contact[]>`select phone, email, login_locked from business_users where id = ${ctx.user!.id}`;
  return c;
}

export const sendOneTimeCode = {
  name: "send_one_time_code",
  tier: 0 as Tier,
  description:
    "The stronger identity check. Sends a one-time code to the phone number already on file for the verified customer and shows them a form to type it in; the code never passes through you. Use it when a tool says the stronger check is needed. It only works after the standard check (verify_identity). It never sends to a number or address given in chat.",
  schema: z.object({}),
  async run(_input: Record<string, never>, ctx: ToolCtx, _rules: Rules): Promise<ToolResult | typeof AWAITING_CODE> {
    if (!ctx.user) return refuse(ctx, "send_one_time_code", {}, "Run the standard identity check (verify_identity) first.", "identity not verified");
    if (ctx.user.stronger) return { ok: true, data: { stronger_check: "already passed in this conversation" } };
    const c = await contact(ctx);
    if (!c.phone) return refuse(ctx, "send_one_time_code", {}, "There is no phone number on file, so no code can be sent. Offer the in-person or documented recovery route and hand off.", "no phone on file");
    const code = String(randomInt(0, 1_000_000)).padStart(6, "0");
    await ctx.sql`update conversations set pending_code = ${ctx.sql.json({ tool_use_id: ctx.toolUseId, code, sent_at: ctx.now.toISOString(), attempts: 0 } as never)} where id = ${ctx.conv.id}`;
    // A simulated text message: the demo has no real phone, so the screen shows what would arrive.
    ctx.emit({ type: "code_form", sentTo: maskPhone(c.phone), code });
    await audit(ctx, { kind: "identity", tool: "send_one_time_code", summary: `send_one_time_code · sent to ${maskPhone(c.phone)}` });
    return AWAITING_CODE;
  },
};

const resetSchema = z.object({});

export const sendResetLink = {
  name: "send_reset_link",
  tier: 2 as Tier,
  identity: "stronger" as const,
  description:
    "Send a password reset link to the email address already on file for the verified customer. Never to a new address or number given in chat. Needs the stronger check and the customer's yes. At most 3 a day.",
  schema: resetSchema,
  async run(_input: z.infer<typeof resetSchema>, ctx: ToolCtx, rules: Rules): Promise<ToolResult> {
    const T = "send_reset_link";
    const user = ctx.user!;
    const c = await contact(ctx);
    if (!c.email) return refuse(ctx, T, {}, "There is no email on file. Offer the documented recovery route and hand off.", "no email on file");
    const limit = rules.num("reset_link_limit", 3);
    const [{ n }] = await ctx.sql<{ n: number }[]>`
      select count(*)::int as n from audit_log where user_id = ${user.id} and kind = 'action' and tool = ${T}
        and created_at > ${new Date(ctx.now.getTime() - 86_400_000)}`;
    if (n >= limit) return refuse(ctx, T, {}, `${limit} reset links have been sent in the last 24 hours, so another needs a person to review it. Hand off.`, "daily limit reached");
    const waiting = await confirmFirst(ctx, T, user.id, "password reset link", `Send a password reset link to ${maskEmail(c.email)}?`, "The link goes to the email address on file and expires after a short time.");
    if (waiting) return waiting;
    await audit(ctx, { kind: "action", tool: T, summary: `${T} · sent to ${maskEmail(c.email)}` });
    return { ok: true, data: { sent_to: maskEmail(c.email), note: "Tell them where to look (the email on file), that the link expires soon, and not to share it." } };
  },
};

export const unlockAccount = {
  name: "unlock_account",
  tier: 3 as Tier,
  identity: "stronger" as const,
  description:
    "Unlock online access that was locked after too many failed sign-in attempts. Only that kind of lock: a lock placed by the bank is a restriction (use get_account_restrictions and its rules). Needs the stronger check and the customer's yes. Afterwards, suggest a password reset.",
  schema: z.object({}),
  async run(_input: Record<string, never>, ctx: ToolCtx, _rules: Rules): Promise<ToolResult> {
    const T = "unlock_account";
    const user = ctx.user!;
    const c = await contact(ctx);
    if (!c.login_locked) return refuse(ctx, T, {}, "Online access isn't locked, so there's nothing to unlock.", "not locked");
    if (c.login_locked !== "failed_logins") {
      return refuse(ctx, T, {}, "This lock was placed by the bank, not by failed sign-ins, so you can't lift it. Check get_account_restrictions and follow its rules; hand off.", "locked by the bank");
    }
    const waiting = await confirmFirst(ctx, T, user.id, "unlock online access", "Unlock your online access?", "You'll be able to sign in again straight away. I'd suggest resetting your password afterwards.");
    if (waiting) return waiting;
    await ctx.sql`update business_users set login_locked = null where id = ${user.id}`;
    await audit(ctx, { kind: "action", tool: T, summary: `${T} · ${user.first_name}'s online access unlocked` });
    return { ok: true, reference: `UNL-${user.id.toUpperCase()}`, data: { unlocked: true, note: "Tell them they can sign in now and suggest a password reset." } };
  },
};
