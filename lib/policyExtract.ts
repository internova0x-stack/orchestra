import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Sql } from "./db.ts";
import { MODEL } from "./config.ts";
import { MARKETS, type Market } from "./rules.ts";
import { proposeChange } from "./ruleChanges.ts";
import type { StaffUser } from "./staff.ts";

// Rules from a policy document (Tomi, Nov 23): Claude reads the document against the current rule list
// and proposes changes, each with the sentence it came from. Nothing goes live: every proposal waits on
// the Rules screen for a supervisor, and anything that isn't one of the existing rules is only listed.

const Proposals = z.object({
  changes: z.array(z.object({
    rule_id: z.string().describe("The id of an existing rule from the list"),
    market: z.enum(["all", "NG", "UK", "US"]).describe("all, unless the document gives the value for one market only"),
    new_value: z.string().describe("The value as the document states it, in the rule's own unit"),
    quote: z.string().describe("The exact sentence from the document this comes from"),
  })),
  not_matched: z.array(z.string()).describe("Rules or facts in the document that none of the existing rules covers, one short line each"),
});

export type Upload = { name: string; media_type: string; data: string };

const SYSTEM = `You read a bank's or fintech's policy document and compare it with the support assistant's current rules.
Propose a change only where the document clearly states a value for one of the listed rules that differs from the current value.
Use the rule's own unit (a number for limits, on or off for switches, HH:MM for times). Quote the exact sentence it comes from.
Never guess or infer a number the document doesn't state. If the document covers something none of the rules does, list it under not_matched.
If nothing in the document changes a rule, return an empty changes list.`;

export async function extractFromPolicy(sql: Sql, file: Upload, staff: StaffUser) {
  const rules = await sql<{ id: string; category: string; name: string; kind: string; value: string; unit: string | null }[]>`
    select id, category, name, kind, value, unit from rules order by sort`;
  const list = rules.map((r) => `${r.id} | ${r.category} | ${r.name} | ${r.kind} | current: ${r.value}${r.unit ? ` ${r.unit}` : ""}`).join("\n");
  const doc: Anthropic.ContentBlockParam =
    file.media_type === "application/pdf"
      ? { type: "document", source: { type: "base64", media_type: "application/pdf", data: file.data }, title: file.name }
      : { type: "document", source: { type: "text", media_type: "text/plain", data: Buffer.from(file.data, "base64").toString("utf8") }, title: file.name };

  const client = new Anthropic({ maxRetries: 4 });
  const res = await client.messages.parse({
    model: MODEL,
    max_tokens: 16000,
    system: SYSTEM,
    messages: [{ role: "user", content: [doc, { type: "text", text: `The current rules (id | category | name | kind | current value):\n${list}` }] }],
    output_config: { format: zodOutputFormat(Proposals) },
  });
  const out = res.parsed_output;
  if (!out) throw new Error("The document couldn't be read into proposals.");

  const known = new Set(rules.map((r) => r.id));
  const proposed: { rule: string; name: string; value: string; market: string; quote: string; change?: number; error?: string }[] = [];
  for (const c of out.changes) {
    const name = rules.find((r) => r.id === c.rule_id)?.name ?? c.rule_id;
    const market = c.market === "all" ? null : (c.market as Market);
    const marketName = market ? MARKETS.find((m) => m.id === market)!.name : "All markets";
    if (!known.has(c.rule_id)) { proposed.push({ rule: c.rule_id, name, value: c.new_value, market: marketName, quote: c.quote, error: "Not one of the rules" }); continue; }
    const r = await proposeChange(sql, { ruleId: c.rule_id, market, value: c.new_value, staff, source: `Policy: ${file.name}`, note: c.quote.slice(0, 500), review: true });
    proposed.push({ rule: c.rule_id, name, value: c.new_value, market: marketName, quote: c.quote, ...(r.ok ? { change: r.change } : { error: r.error }) });
  }
  return { proposed, notMatched: out.not_matched };
}
