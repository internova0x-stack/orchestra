import { z } from "zod";
import { audit, refuse, type Tier, type ToolCtx, type ToolResult } from "../toolkit.ts";
import type { Rules } from "../rules.ts";
import { currentStatus, type WatchKind } from "../updates.ts";
import { dateTime } from "../time.ts";

// Operations (Nov 23): a customer comes back in a new conversation with a case reference. Alexis finds
// the case on their account (never someone else's) and picks it up from where it stands: no need to
// explain it again.

const STATUS: Record<string, string> = {
  open: "With the team", approved: "Approved by the team", declined: "Declined by the team", resolved: "Resolved",
  requested: "Requested", completed: "Completed", investigating: "Being investigated", awaiting_approval: "Waiting for a supervisor's approval",
  in_progress: "In progress", pending: "Under review", incomplete: "Still needs a document",
};

export const findCase = {
  name: "find_case",
  tier: 1 as Tier,
  description:
    "A customer returning with a case reference from an earlier conversation (ESC-, CMP-, REC-, REV-, DSP-, DEF-, BRF- and so on): find it on their own account and say where it stands, what was done and what happens next. Only cases on the verified customer's account. If a handed-off case is still open, give its status and the response target; don't open a second case for the same issue.",
  schema: z.object({ reference: z.string().describe("The case reference the customer gave, e.g. ESC-1042") }),
  async run(input: { reference: string }, ctx: ToolCtx, _rules: Rules): Promise<ToolResult> {
    const T = "find_case";
    const ref = input.reference.trim().toUpperCase().replace(/\s+/g, "");
    const user = ctx.user!;
    const [e] = await ctx.sql<{ reference: string; urgency: string; status: string; trigger: string; summary: { request?: string; did?: string; told?: string }; respond_by: Date | null; resolution: string | null; decided_at: Date | null; created_at: Date }[]>`
      select reference, urgency, status, trigger, summary, respond_by, resolution, decided_at, created_at from escalations
      where reference = ${ref} and business_id = ${user.business_id}`;
    if (e) {
      const data = {
        reference: e.reference, type: "Case with the support team", opened: dateTime(new Date(e.created_at)),
        status: STATUS[e.status] ?? e.status, urgency: e.urgency, about: e.summary?.request, what_was_done: e.summary?.did, customer_was_told: e.summary?.told,
        ...(e.status === "open" && e.respond_by ? { team_responds_by: dateTime(new Date(e.respond_by)) } : {}),
        ...(e.decided_at ? { decided: dateTime(new Date(e.decided_at)) } : {}),
        ...(e.resolution ? { team_note: e.resolution } : {}),
      };
      await audit(ctx, { kind: "lookup", tool: T, summary: `${T} · ${e.reference} · ${data.status.toLowerCase()}`, input, result: data });
      return { ok: true, reference: e.reference, data };
    }
    const [w] = await ctx.sql<{ kind: WatchKind; reference: string; label: string; expected_by: Date | null; created_at: Date }[]>`
      select kind, reference, label, expected_by, created_at from case_watches where reference = ${ref} and holder_id = ${user.business_id}`;
    if (w) {
      const status = (await currentStatus(ctx.sql, w.kind, w.reference)) ?? "unknown";
      const data = {
        reference: w.reference, type: w.label, opened: dateTime(new Date(w.created_at)), status: STATUS[status] ?? status.replace(/_/g, " "),
        ...(w.expected_by ? { expected_by: dateTime(new Date(w.expected_by)), late: new Date(w.expected_by) < ctx.now && !["completed", "approved", "declined", "resolved"].includes(status) } : {}),
      };
      await audit(ctx, { kind: "lookup", tool: T, summary: `${T} · ${w.reference} · ${data.status.toLowerCase()}`, input, result: data });
      return { ok: true, reference: w.reference, data };
    }
    return refuse(ctx, T, input, "No case with that reference on this account. Ask them to check it (it may belong to another login), or offer to look into the issue afresh.", "not found");
  },
};
