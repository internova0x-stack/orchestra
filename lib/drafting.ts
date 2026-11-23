import Anthropic from "@anthropic-ai/sdk";
import type { Sql } from "./db.ts";
import { recordUsage, type Usage } from "./usage.ts";
import { MODEL } from "./config.ts";
import { transcriptOf } from "./cases.ts";
import { bank } from "./bank/index.ts";
import { LANGUAGES } from "./session.ts";
import type { StaffUser } from "./staff.ts";

// Drafted replies (Tomi, Nov 23): one click in the Inbox or the Staff queue and Alexis drafts the team's
// reply to the customer from the conversation, the handoff summaries and the team's decisions. It is only a
// draft: it goes into the reply box for the person to edit and send, and nothing reaches the customer until
// they do. The customer-facing rules apply to it, review holds most of all.

type Create = (body: Anthropic.MessageCreateParamsNonStreaming) => Promise<{ content: { type: string; text?: string }[] }>;

const RULES = [
  "Write as the member of the support team named below, in the first person, to the customer by first name.",
  "Warm and plain: two to five short sentences. Give the case reference and what happens next, and when the customer will next hear from the team if the records say so.",
  "Use facts only from the materials. Never promise an outcome or a date the bank doesn't control, never give financial or legal advice, never blame the customer.",
  "Never ask for or repeat passwords, PINs, codes or full card or account numbers, and include no links.",
  "If the purpose given by the team member says what the reply should do, do that.",
  "Return only the message text: no subject line, no notes to the team, no placeholders in brackets.",
];

const HOLD_RULE = "REVIEW HOLD: say only that the matter is with a specialist team for review. Give no reason, don't confirm or deny any investigation, and don't suggest ways to lift it.";

export type DraftError = "not_found" | "empty";

export async function draftReply(
  sql: Sql,
  conversationId: string,
  staff: StaffUser,
  purpose: string | null,
  create: Create = (body) => new Anthropic({ maxRetries: 4 }).messages.create(body),
  opts: { customerName?: string | null } = {},
): Promise<{ draft: string } | { error: DraftError }> {
  const [c] = await sql<{ messages: never; verified_user_id: string | null; language: string | null; channel: string | null }[]>`
    select messages, verified_user_id, language, channel from conversations where id = ${conversationId} and mode = 'customer'`;
  if (!c) return { error: "not_found" };
  const transcript = transcriptOf(c.messages);
  if (!transcript.length) return { error: "empty" };
  const cases = await sql<{ reference: string; status: string; trigger: string; summary: Record<string, unknown>; resolution: string | null; team: string | null }[]>`
    select reference, status, trigger, summary, resolution, team from escalations where conversation_id = ${conversationId} order by created_at`;
  const decisions = (await sql<{ result: { message?: string } | null }[]>`
    select result from audit_log where conversation_id = ${conversationId} and approver is not null order by id`).map((r) => r.result?.message).filter(Boolean);
  const user = c.verified_user_id ? await bank(sql).getUser(c.verified_user_id) : null;
  const held = cases.some((k) => k.trigger === "review_hold" || JSON.stringify(k.summary).toLowerCase().includes("review hold"));
  const language = c.language && c.language !== "en" ? LANGUAGES[c.language] ?? null : null;

  const materials = [
    `Team member: ${staff.name}`,
    `Customer: ${user ? user.first_name : opts.customerName ? `${opts.customerName} (the name they gave; not verified)` : "not verified (don't use a name)"}`,
    `Channel: ${c.channel ?? "app"}${c.channel === "email" ? " (write it as an email body with a greeting and sign-off)" : ""}`,
    ...(language ? [`Write in ${language}, the language the customer has been using.`] : []),
    purpose?.trim() ? `What the reply should do: ${purpose.trim().slice(0, 300)}` : "What the reply should do: answer the customer's latest message and update them on their case.",
    "",
    "Cases with the team:",
    ...(cases.length ? cases.map((k) => `- ${k.reference} (${k.status}${k.team ? `, ${k.team}` : ""}): ${JSON.stringify(k.summary)}${k.resolution ? `; note: ${k.resolution}` : ""}`) : ["- none"]),
    "",
    "The team's decisions already sent to the customer:",
    ...(decisions.length ? decisions.map((d) => `- ${d}`) : ["- none"]),
    "",
    "The conversation so far:",
    ...transcript.slice(-30).map((m) => `${m.who}: ${m.text}`),
  ].join("\n");

  const res = await create({
    model: MODEL,
    max_tokens: 1200,
    system: `You draft a reply from a bank's support team to a customer, for the team member to edit before sending.\n${[...RULES, ...(held ? [HOLD_RULE] : [])].map((r) => `- ${r}`).join("\n")}`,
    messages: [{ role: "user", content: materials }],
  });
  await recordUsage(sql, { conversationId, purpose: "draft_reply", model: MODEL, usage: (res as { usage?: Usage }).usage });
  const draft = res.content.map((b) => (b.type === "text" ? b.text ?? "" : "")).join("").trim();
  await sql`insert into audit_log (conversation_id, tool_use_id, kind, tool, summary, staff)
    values (${conversationId}, ${`draft-${Date.now()}`}, 'action', 'draft_reply', ${`reply drafted for ${staff.name} to edit · not sent`}, ${staff.name})`;
  return { draft };
}
