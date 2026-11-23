import { z } from "zod";
import { audit, refuse, type Tier, type ToolCtx, type ToolResult } from "../toolkit.ts";
import type { Rules } from "../rules.ts";
import { dateTime } from "../time.ts";

// Use case 19: staff mode. These tools hand Alexis the case's materials; Alexis writes the summary,
// the customer reply or the case notes from them, and the staff member edits and sends or saves.

type Block = { type: string; text?: string };

async function caseMaterials(ctx: ToolCtx) {
  const ref = (ctx.conv as unknown as { case_reference: string | null }).case_reference;
  if (!ref) return null;
  const [c] = await ctx.sql<{ reference: string; urgency: string; trigger: string; status: string; summary: Record<string, unknown>; conversation_id: string | null; resolution: string | null; respond_by: Date | null; action: unknown }[]>`
    select reference, urgency, trigger, status, summary, conversation_id, resolution, respond_by, action from escalations where reference = ${ref}`;
  if (!c) return null;
  const [conv] = c.conversation_id ? await ctx.sql<{ messages: { role: string; content: string | Block[] }[] }[]>`select messages from conversations where id = ${c.conversation_id}` : [];
  const transcript = (conv?.messages ?? [])
    .map((m) => ({ who: m.role === "assistant" ? "Alexis" : "Customer", text: typeof m.content === "string" ? m.content : m.content.filter((b) => b.type === "text" && b.text?.trim()).map((b) => b.text).join(" ") }))
    .filter((m) => m.text);
  const activity = c.conversation_id
    ? (await ctx.sql<{ summary: string; created_at: Date }[]>`select summary, created_at from audit_log where conversation_id = ${c.conversation_id} order by id`).map((r) => `${dateTime(new Date(r.created_at))}: ${r.summary}`)
    : [];
  const reviewHold = JSON.stringify(c.summary).toLowerCase().includes("review hold") || c.trigger === "review_hold";
  return { case: c.reference, urgency: c.urgency, status: c.status, handoff_summary: c.summary, ...(c.resolution ? { resolution: c.resolution } : {}), ...(c.respond_by ? { respond_by: dateTime(new Date(c.respond_by)) } : {}), transcript, activity, review_hold: reviewHold };
}

const none = z.object({});

export const summariseCase = {
  name: "summarise_case",
  tier: 0 as Tier,
  description: "The open case's materials: the handoff summary, the transcript and the activity log. Use them to summarise the case for the staff member: what was asked, what the records show, what has been done, what is outstanding.",
  schema: none,
  async run(_i: Record<string, never>, ctx: ToolCtx, _r: Rules): Promise<ToolResult> {
    const m = await caseMaterials(ctx);
    if (!m) return refuse(ctx, "summarise_case", {}, "No case is open in this staff session.", "no case");
    await audit(ctx, { kind: "lookup", tool: "summarise_case", summary: `summarise_case · ${m.case}` });
    return { ok: true, data: m };
  },
};

export const draftReply = {
  name: "draft_reply",
  tier: 0 as Tier,
  description: "Materials and rules for drafting a reply to the customer on this case, for the staff member to edit and send. Every customer-facing rule applies, including no tipping off and no promised outcomes or dates.",
  schema: z.object({ purpose: z.string().optional().describe("What the reply should do, e.g. 'tell her the recall was approved'") }),
  async run(i: { purpose?: string }, ctx: ToolCtx, _r: Rules): Promise<ToolResult> {
    const m = await caseMaterials(ctx);
    if (!m) return refuse(ctx, "draft_reply", i, "No case is open in this staff session.", "no case");
    await audit(ctx, { kind: "action", tool: "draft_reply", summary: `draft_reply · ${m.case} · draft for staff to edit` });
    return {
      ok: true,
      data: {
        ...m,
        rules: [
          "Warm, plain, two to five short sentences; the customer's first name; the case reference; when to expect the next update.",
          "Facts only from the records above; never promise an outcome or a date the bank doesn't control.",
          ...(m.review_hold ? ["REVIEW HOLD: say only that it needs review by a specialist team; no reason, no confirming or denying an investigation, no ways to lift it."] : []),
          "No full account numbers, no request for passwords or codes, no sign-in links.",
          "Label it clearly as a draft for the staff member to edit and send.",
        ],
      },
    };
  },
};

export const draftCaseNotes = {
  name: "draft_case_notes",
  tier: 0 as Tier,
  description: "Materials for drafting case notes for the staff member to save: what the customer asked, what was checked and found, what was done, what's outstanding, and the suggested next action with the playbook flow it comes from.",
  schema: none,
  async run(_i: Record<string, never>, ctx: ToolCtx, _r: Rules): Promise<ToolResult> {
    const m = await caseMaterials(ctx);
    if (!m) return refuse(ctx, "draft_case_notes", {}, "No case is open in this staff session.", "no case");
    await audit(ctx, { kind: "action", tool: "draft_case_notes", summary: `draft_case_notes · ${m.case} · draft for staff to save` });
    return { ok: true, data: { ...m, format: "Asked / Checked and found / Done / Outstanding / Suggested next action (and which playbook flow it comes from). Facts only; mark anything uncertain." } };
  },
};
