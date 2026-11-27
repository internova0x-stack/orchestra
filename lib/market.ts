import type { Sql } from "./db.ts";
import type { Conversation, VerifiedUser } from "./session.ts";
import { bank } from "./bank/index.ts";
import { MARKETS, marketOf, type Market } from "./rules.ts";

// Which market's rules apply to a conversation (Tomi, Nov 27: "ask for which country the user is from, and then deal
// with the user based on their location"). The records decide wherever there are records; what the customer says
// only steers general answers before the identity check, never anything about their own account.
//   1. A verified customer: the country on the bank's records.
//   2. Someone who paid a merchant (no account): the merchant's country on the payment.
//   3. Before the identity check: the country the bank's app or website passed when the chat opened, or failing
//      that what the customer said (set_customer_country).

export type MarketSource = "records" | "payment" | "app" | "customer";
export interface MarketInfo { market: Market | null; name: string | null; source: MarketSource | null; stated: string | null }

export const marketName = (m: Market | null) => (m ? MARKETS.find((x) => x.id === m)!.name : null);

export async function conversationMarket(sql: Sql, conv: Conversation, user: VerifiedUser | null): Promise<MarketInfo> {
  const stated = conv.stated_country ?? null;
  if (user) {
    const m = marketOf(user.country);
    return { market: m, name: marketName(m) ?? user.country, source: "records", stated };
  }
  if (conv.payer_payment_id) {
    const p = await bank(sql).getCheckoutPayment(conv.payer_payment_id);
    if (p?.merchant_country) {
      const m = marketOf(p.merchant_country);
      return { market: m, name: marketName(m) ?? p.merchant_country, source: "payment", stated };
    }
  }
  if (stated) {
    const m = marketOf(stated);
    return { market: m, name: marketName(m) ?? stated, source: conv.stated_country_source === "app" ? "app" : "customer", stated };
  }
  return { market: null, name: null, source: null, stated: null };
}

/** The session line that tells Alexis which market's rules apply and where that came from. */
export function marketLine(info: MarketInfo): string {
  const list = MARKETS.map((m) => m.name).join(", ");
  if (!info.source) {
    return `- Market not known yet. If a general question depends on the country (timelines, fees, limits), ask which country they bank in and record it with set_customer_country (markets set up: ${list}); until then give only answers that hold everywhere, or say they vary by country.`;
  }
  const where = info.source === "records" ? "the country on the bank's records"
    : info.source === "payment" ? "the merchant's country on the payment"
    : info.source === "app" ? "passed by the bank's app or website when the chat opened"
    : "what the customer said; not verified";
  const lines = [`- Market: ${info.name} (${where}). The rules and answers you get are that market's${info.market ? "" : " defaults: it isn't one of the markets set up, so say details may differ for them"}.`];
  if ((info.source === "app" || info.source === "customer")) {
    lines.push("  Use it for general answers only. Once they pass the identity check, their records decide; never use it for anything about their own account.");
  }
  if ((info.source === "records" || info.source === "payment") && info.stated && marketOf(info.stated) !== info.market) {
    lines.push(`  Earlier the conversation had ${info.stated}; the records win. If it matters, say the account is set up in ${info.name}.`);
  }
  return lines.join("\n");
}

/** A country passed by the app or website when a chat opens: kept only if it names a market or a country in one. */
export async function setStatedCountry(sql: Sql, conversationId: string, country: unknown, source: "app" | "customer"): Promise<string | null> {
  if (typeof country !== "string" || !country.trim()) return null;
  const m = marketOf(country.trim());
  if (!m) return null;
  const name = country.trim().length <= 3 ? marketName(m)! : country.trim().slice(0, 60);
  await sql`update conversations set stated_country = ${name}, stated_country_source = ${source} where id = ${conversationId}`;
  return name;
}
