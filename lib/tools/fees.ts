import { z } from "zod";
import { audit, confirmFirst, refuse, ruleRead, type Tier, type ToolCtx, type ToolResult } from "../toolkit.ts";
import type { Rules } from "../rules.ts";
import { money } from "../format.ts";
import { dateTime } from "../time.ts";

// Use case 5 (the rest): waiving a fee. Use case 15 (the rest): account limits and tiers.

const CAP: Record<string, string> = { USD: "waiver_cap_usd", GBP: "waiver_cap_gbp", NGN: "waiver_cap_ngn" };

const waiveInput = z.object({ fee_id: z.string().describe("The fee's id from get_fees, e.g. FE-P0101") });

export const waiveFee = {
  name: "waive_fee",
  tier: 3 as Tier,
  identity: "stronger" as const,
  description:
    "Reverse one fee as a goodwill gesture: only a fee marked waivable, under the cap, and only if the customer hasn't used this year's goodwill waiver. Needs the stronger check and the customer's yes. If the customer says the fee was charged wrongly (a bank error, not a goodwill request), don't waive it: escalate for staff to review the charge. When a waiver isn't possible, decline politely without accusing them.",
  schema: waiveInput,
  async run(input: z.infer<typeof waiveInput>, ctx: ToolCtx, rules: Rules): Promise<ToolResult> {
    const T = "waive_fee";
    const user = ctx.user!;
    const id = input.fee_id.trim().toUpperCase();
    const [fee] = await ctx.sql<{ id: string; kind: string; description: string; amount: string; currency: string; waivable: boolean; charged_at: Date }[]>`
      select id, kind, description, amount, currency, waivable, charged_at from fees where id = ${id} and business_id = ${user.business_id}`;
    if (!fee || fee.kind !== "fee") return refuse(ctx, T, input, "No fee with that id on this account.", "fee not found");
    const [done] = await ctx.sql<{ reference: string }[]>`select reference from waivers where fee_id = ${fee.id}`;
    if (done) {
      await audit(ctx, { kind: "refusal", tool: T, summary: `${T} · refused: already waived ${done.reference}`, input, refusal_reason: "Duplicate waiver" });
      return { ok: false, reference: done.reference, reason: `This fee was already waived (${done.reference}). Show that it's been reversed.` };
    }
    if (!fee.waivable) return refuse(ctx, T, input, "This fee isn't one that can be waived. Explain it plainly; if they think it was charged wrongly, escalate.", "fee not waivable");
    const limit = rules.num("waiver_limit", 1);
    const [{ n }] = await ctx.sql<{ n: number }[]>`
      select count(*)::int as n from waivers where holder_id = ${user.business_id} and created_at > ${new Date(ctx.now.getTime() - 365 * 86_400_000)}`;
    if (n >= limit) {
      return refuse(ctx, T, input, `The customer has used this year's goodwill waiver (${limit} per 12 months). Decline politely without suggesting they did anything wrong, and escalate if they think the fee was charged in error.`, "waiver already used this year");
    }
    const capId = CAP[fee.currency];
    const cap = rules.num(capId, 0);
    await ruleRead(ctx, rules, capId, `Fee waiver cap (${fee.currency})`);
    const amount = money(fee.amount, fee.currency);
    if (Number(fee.amount) > cap) return refuse(ctx, T, input, `${amount} is above the ${money(cap, fee.currency).replace(/\.00$/, "")} waiver cap; a person must decide. Escalate.`, `above cap ${money(cap, fee.currency).replace(/\.00$/, "")}`);
    const waiting = await confirmFirst(ctx, T, fee.id, `waiver of ${fee.id}`, `Waive the ${amount} ${fee.description.toLowerCase()}?`, "It will be refunded to your account. This uses your one goodwill waiver for the next 12 months.");
    if (waiting) return waiting;
    const [{ seq }] = await ctx.sql<{ seq: string }[]>`select nextval('waiver_seq')::text as seq`;
    const reference = `WVR-${seq}`;
    await ctx.sql`insert into waivers (reference, fee_id, holder_id, conversation_id, amount, currency)
      values (${reference}, ${fee.id}, ${user.business_id}, ${ctx.conv.id}, ${fee.amount}, ${fee.currency})`;
    await audit(ctx, { kind: "action", tool: T, summary: `${T} · ${fee.id} · ${amount} waived`, input, result: { reference } });
    return { ok: true, reference, data: { reference, refunded: amount, fee: fee.description, charged: dateTime(new Date(fee.charged_at)), note: "Say it's been reversed and shows as a refund." } };
  },
};

export const getAccountLimits = {
  name: "get_account_limits",
  tier: 1 as Tier,
  description:
    "The verified customer's account tier and limits (single transfer, daily transfers, balance) and exactly what's needed to move up, such as linking a BVN or NIN. For a hold or block placed by the bank, use get_account_restrictions and its rules instead.",
  schema: z.object({}),
  async run(_input: Record<string, never>, ctx: ToolCtx, rules: Rules): Promise<ToolResult> {
    const [b] = await ctx.sql<{ kind: string; kyc_tier: number | null; account_number: string | null }[]>`
      select kind, kyc_tier, account_number from businesses where id = ${ctx.user!.business_id}`;
    let data: Record<string, unknown>;
    if (b.kyc_tier) {
      const t = b.kyc_tier;
      await ruleRead(ctx, rules, `tier_${t}_single`);
      await ruleRead(ctx, rules, `tier_${t}_daily`);
      data = {
        tier: `Tier ${t}`,
        limits: rules.get(`tier_${t}`)?.value,
        single_transfer_limit: money(rules.num(`tier_${t}_single`, 0), "NGN"),
        daily_transfer_limit: money(rules.num(`tier_${t}_daily`, 0), "NGN"),
        ...(t < 3 ? { to_move_up: `Tier ${t + 1}: ${rules.get(`tier_up_${t + 1}`)?.value}`, next_tier_limits: rules.get(`tier_${t + 1}`)?.value } : { note: "Already the highest tier." }),
      };
    } else {
      data = { tier: "Standard", limits: rules.get("limits_standard")?.value };
    }
    await audit(ctx, { kind: "lookup", tool: "get_account_limits", summary: `get_account_limits · ${data.tier}`, result: data });
    return { ok: true, data };
  },
};
