import Anthropic from "@anthropic-ai/sdk";
import { zodOutputFormat } from "@anthropic-ai/sdk/helpers/zod";
import { z } from "zod";
import type { Sql } from "./db.ts";
import { recordUsage } from "./usage.ts";
import { MODEL } from "./config.ts";
import { MARKETS, type Market } from "./rules.ts";
import { randomUUID } from "node:crypto";
import { proposeChange, proposeConflict } from "./ruleChanges.ts";
import type { StaffUser } from "./staff.ts";

// Rules from a policy document (Tomi, Nov 23): Claude reads the document against the current rule list
// and proposes changes, each with the sentence it came from. Nothing goes live: every proposal waits on
// the Rules screen for a supervisor, and anything that isn't one of the existing rules is only listed.

const Proposals = z.object({
  changes: z.array(z.object({
    rule_id: z.string().describe("The id of an existing rule from the list"),
    market: z.enum(["all", "US", "UK", "CA", "EU", "AE", "NG"]).describe("all, unless the document gives the value for one market only"),
    new_value: z.string().describe("The value as the document states it, in the rule's own unit"),
    quote: z.string().describe("The exact sentence from the document this comes from"),
    page: z.string().describe("The page number the sentence is on, or an empty string if the document has no pages"),
  })),
  conflicts: z.array(z.object({
    rule_id: z.string().describe("The id of an existing rule from the list"),
    market: z.enum(["all", "US", "UK", "CA", "EU", "AE", "NG"]),
    options: z.array(z.object({
      value: z.string().describe("One value the document gives, in the rule's own unit"),
      quote: z.string().describe("The exact sentence that gives it"),
      page: z.string().describe("Its page number, or an empty string"),
    })).describe("Every different value the document gives for this rule, two or more"),
  })).describe("Rules for which the document itself gives two or more different values for the same market. Never also list these under changes."),
  not_matched: z.array(z.string()).describe("Rules or facts in the document that none of the existing rules covers, one short line each"),
});

export type Upload = { name: string; media_type: string; data: string };

const SYSTEM = `You read a bank's or fintech's policy document and compare it with the support assistant's current rules.
Propose a change only where the document clearly states a value for one of the listed rules that differs from the current value.
Use the rule's own unit (a number for limits, on or off for switches, HH:MM for times). Quote the exact sentence it comes from.
Never guess or infer a number the document doesn't state. If the document gives two or more different values for the same rule and market (for example 90 days on one page and 120 on another), don't choose: list it under conflicts with every value, its sentence and page, and leave it out of changes.
If the document covers something none of the rules does, list it under not_matched.
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
  await recordUsage(sql, { purpose: "policy_upload", model: res.model, usage: res.usage });
  const out = res.parsed_output;
  if (!out) throw new Error("The document couldn't be read into proposals.");

  const upload = { id: randomUUID(), document: file.name };
  const known = new Map(rules.map((r) => [r.id, r]));
  const marketOf = (m: string) => (m === "all" ? null : (m as Market));
  const marketLabel = (m: Market | null) => (m ? MARKETS.find((x) => x.id === m)!.name : "All markets");
  const proposed: Proposed[] = [];
  for (const c of out.changes) {
    const rule = known.get(c.rule_id);
    const market = marketOf(c.market);
    const base = { rule: c.rule_id, name: rule?.name ?? c.rule_id, category: rule?.category ?? "Other", unit: rule?.unit ?? null, old: rule?.value ?? null,
      value: c.new_value, market: marketLabel(market), quote: c.quote, page: c.page || null, big: false };
    if (!rule) { proposed.push({ ...base, error: "Not one of the rules" }); continue; }
    const r = await proposeChange(sql, { ruleId: c.rule_id, market, value: c.new_value, staff, source: `Policy: ${file.name}`, note: c.quote.slice(0, 500), review: true, upload: { ...upload, page: c.page || null } });
    proposed.push(r.ok ? { ...base, value: r.value ?? c.new_value, change: r.change, big: r.big } : { ...base, error: r.error });
  }
  const conflicts: Conflict[] = [];
  for (const c of out.conflicts) {
    const rule = known.get(c.rule_id);
    if (!rule) continue;
    const market = marketOf(c.market);
    const options = c.options.map((o) => ({ value: o.value, quote: o.quote, page: o.page || null }));
    const r = await proposeConflict(sql, { ruleId: c.rule_id, market, options, staff, upload });
    conflicts.push({ rule: c.rule_id, name: rule.name, category: rule.category, unit: rule.unit, old: rule.value, market: marketLabel(market), options, ...(r.ok ? { change: r.change } : { error: r.error }) });
  }
  return { upload: upload.id, document: file.name, rulesChecked: rules.length, proposed, conflicts, notMatched: out.not_matched };
}

export interface Proposed {
  rule: string; name: string; category: string; unit: string | null; old: string | null; value: string; market: string;
  quote: string; page: string | null; big: boolean; change?: number; error?: string;
}
export interface Conflict {
  rule: string; name: string; category: string; unit: string | null; old: string; market: string;
  options: { value: string; quote: string; page: string | null }[]; change?: number; error?: string;
}
