import { z } from "zod";
import { audit, refuse, type Tier, type ToolCtx, type ToolResult } from "../toolkit.ts";
import type { Rules } from "../rules.ts";
import { MARKETS, marketOf } from "../rules.ts";
import { conversationMarket, marketName, setStatedCountry } from "../market.ts";

// set_customer_country (Tomi, Nov 27): before the identity check, the customer says which country they bank in, so
// general answers use that market's rules. Only for general answers: once verified (or matched to a payment), the
// records decide and this is refused.

const T = "set_customer_country";

export const setCustomerCountry = {
  name: T,
  tier: 0 as Tier,
  description:
    "Record which country an unverified customer says they bank in, so general answers (timelines, fees, limits, how things work) use that market's rules. Only before the identity check, and only for general answers: once they're verified or matched to a payment, their records decide and this is refused. Never use it to change anything about their account.",
  schema: z.object({ country: z.string().trim().min(2).max(60).describe("The country (or market) they said, e.g. Canada, Germany, Dubai, United Kingdom") }),
  async run(input: { country: string }, ctx: ToolCtx, rules: Rules): Promise<ToolResult> {
    void rules;
    const now = await conversationMarket(ctx.sql, ctx.conv, ctx.user);
    if (now.source === "records" || now.source === "payment") {
      return refuse(ctx, T, input, `Their ${now.source === "records" ? "records" : "payment"} decide: the market is ${now.name}. Don't change it; if they say otherwise, explain the account is set up in ${now.name}.`, "records decide");
    }
    const m = marketOf(input.country);
    if (!m) {
      return refuse(ctx, T, input, `${input.country} isn't one of the markets set up (${MARKETS.map((x) => x.name).join(", ")}). Give answers that hold everywhere, say details may differ for them, and offer a person if it matters.`, "market not set up");
    }
    const name = await setStatedCountry(ctx.sql, ctx.conv.id, input.country, "customer");
    ctx.conv.stated_country = name;
    ctx.conv.stated_country_source = "customer";
    const data = { country: name, market: marketName(m), note: "General answers now use this market's rules. Not verified: their records decide after the identity check." };
    await audit(ctx, { kind: "lookup", tool: T, summary: `${T} · ${name} (${marketName(m)}) · said by the customer, not verified`, input, result: data });
    return { ok: true, data };
  },
};
