import { z } from "zod";
import { audit, refuse, type Tier, type ToolCtx, type ToolResult } from "../toolkit.ts";
import type { Rules } from "../rules.ts";
import { currentStatus, watch, type WatchKind } from "../updates.ts";

// Use case 17: Alexis can watch a case the customer is waiting on (cases Alexis opens are watched
// automatically) and tell them they'll be updated without having to ask.

const watchInput = z.object({
  kind: z.enum(["reversal", "recall", "dispute", "deferral", "case", "verification"]),
  reference: z.string().describe("The case's reference (REV-, REC-, DSP-, DEF-, ESC-). For verification, leave empty."),
});

const OWNER = {
  reversal: "select holder_id as owner from reversals where reference = $1",
  recall: "select business_id as owner from recalls where reference = $1",
  dispute: "select holder_id as owner from disputes where reference = $1",
  deferral: "select holder_id as owner from deferral_requests where reference = $1",
  case: "select business_id as owner from escalations where reference = $1",
} as const;

export const watchCase = {
  name: "watch_case",
  tier: 1 as Tier,
  description:
    "Watch a reversal, recall, dispute, deferral request, handoff case or the customer's verification review, so they get a text message on the phone number on file when its status changes or its expected date passes. Cases you open are watched automatically; use this for one the customer was already waiting on. Then tell them they'll be updated without having to ask.",
  schema: watchInput,
  async run(input: z.infer<typeof watchInput>, ctx: ToolCtx, _rules: Rules): Promise<ToolResult> {
    const user = ctx.user!;
    const kind = input.kind as WatchKind;
    const reference = kind === "verification" ? user.business_id : input.reference.trim().toUpperCase();
    if (kind !== "verification") {
      const rows = (await ctx.sql.unsafe(OWNER[kind as keyof typeof OWNER], [reference])) as unknown as { owner: string }[];
      if (rows[0]?.owner !== user.business_id) return refuse(ctx, "watch_case", input, "No case with that reference on this account.", "case not found");
    }
    const status = await currentStatus(ctx.sql, kind, reference);
    if (!status) return refuse(ctx, "watch_case", input, "No case with that reference on this account.", "case not found");
    await watch(ctx.sql, { conversationId: ctx.conv.id, holderId: user.business_id, userId: user.id, kind, reference, label: kind === "verification" ? "business verification" : `${kind} ${reference}`, status });
    await audit(ctx, { kind: "action", tool: "watch_case", summary: `watch_case · ${kind} ${reference} · updates on`, input });
    return { ok: true, data: { watching: reference, status, note: "Tell them they'll get a text message on the number on file when it changes; they don't need to ask." } };
  },
};
