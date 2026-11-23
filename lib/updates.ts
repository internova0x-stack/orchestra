import type { Sql } from "./db.ts";
import { bank } from "./bank/index.ts";
import { money } from "./format.ts";
import { dayMonthYear } from "./time.ts";
import { emitEvent } from "./api/webhooks.ts";

// Use case 17: proactive status updates. Every case Alexis opens is watched; when its status changes,
// or its expected date passes with no change, the customer gets a short message on the contact
// details on file. The Playbook's rules are enforced here: contact on file only, never a full
// account number, never a question, never a login link, at most one update per case per day, and
// nothing at all while the customer is on a review hold.

export type WatchKind = "reversal" | "recall" | "dispute" | "deferral" | "case" | "verification";

/** How fast the simulated bank moves in the demo: a requested reversal completes after this long. */
export const SIM_REVERSAL_MINUTES = 3;

export async function watch(
  sql: Sql,
  w: { conversationId: string | null; holderId: string; userId: string | null; kind: WatchKind; reference: string; label: string; status: string; expectedBy?: Date | null },
) {
  await sql`insert into case_watches (conversation_id, holder_id, user_id, kind, reference, label, last_status, expected_by)
    values (${w.conversationId}, ${w.holderId}, ${w.userId}, ${w.kind}, ${w.reference}, ${w.label}, ${w.status}, ${w.expectedBy ?? null})
    on conflict (kind, reference) do nothing`;
}

/** The subject's status now, straight from its own table. */
export async function currentStatus(sql: Sql, kind: WatchKind, reference: string): Promise<string | null> {
  // Verification is the bank's record (the reference is the holder id); the rest are Orchestra's cases.
  if (kind === "verification") return (await bank(sql).getVerification(reference))?.status ?? null;
  const q = {
    reversal: sql`select status from reversals where reference = ${reference}`,
    recall: sql`select status from recalls where reference = ${reference}`,
    dispute: sql`select status from disputes where reference = ${reference}`,
    deferral: sql`select status from deferral_requests where reference = ${reference}`,
    case: sql`select status from escalations where reference = ${reference}`,
  }[kind];
  const rows = (await q) as unknown as { status: string }[];
  return rows[0]?.status ?? null;
}

const CLOSED = new Set(["completed", "approved", "declined", "resolved", "approved_kyc"]);

const WORDS: Record<string, string> = {
  completed: "is complete", approved: "has been approved", declined: "has been declined", resolved: "has been resolved",
  investigating: "is now being investigated", requested: "has been requested", open: "is open", in_progress: "is in progress",
  awaiting_approval: "is waiting for approval", pending: "is under review", incomplete: "still needs a document",
};

/** The message: what changed, what happens next, the reference. Composed here, never by the model. */
function compose(label: string, reference: string, status: string, late: boolean, expectedBy: Date | null): string {
  if (late) {
    return `Update on ${reference}: your ${label} is taking longer than expected${expectedBy ? ` (we expected it by ${dayMonthYear(expectedBy)})` : ""}. It has been raised with our team and we'll update you when it moves. No reply needed.`;
  }
  const next = status === "completed" ? " The money is back in your account." : status === "approved" ? " It has been sent on and we'll update you when it completes." : status === "declined" ? " Our team will explain why." : status === "investigating" ? " We'll update you when there's a decision." : "";
  return `Update on ${reference}: your ${label} ${WORDS[status] ?? `is now ${status.replace(/_/g, " ")}`}.${next} No reply needed.`;
}

/** The simulated bank moves on: requested reversals complete; open disputes go under investigation. */
async function simulateBank(sql: Sql, now: Date) {
  await sql`update reversals set status = 'completed', completed_at = ${now}
    where status = 'requested' and requested_at < ${new Date(now.getTime() - SIM_REVERSAL_MINUTES * 60_000)}`;
  await sql`update disputes set status = 'investigating' where status = 'open' and created_at < ${new Date(now.getTime() - 2 * SIM_REVERSAL_MINUTES * 60_000)}`;
}

/** Run the watches once. Safe to call often: a database lock lets one caller at a time do it. */
export async function runUpdates(sql: Sql, now = new Date()) {
  const sent: { holder_id: string; user_id: string | null; reference: string; body: string }[] = [];
  await runUpdatesInTx(sql, now, sent);
  for (const m of sent) await emitEvent(sql, "customer.notified", { channel: "sms", ...m });
}

async function runUpdatesInTx(sql: Sql, now: Date, sent: { holder_id: string; user_id: string | null; reference: string; body: string }[]) {
  await sql.begin(async (tx) => {
    const [{ got }] = await tx<{ got: boolean }[]>`select pg_try_advisory_xact_lock(4209) as got`;
    if (!got) return;
    await simulateBank(tx as unknown as Sql, now);
    const watches = await tx<{ id: string; holder_id: string; user_id: string | null; kind: WatchKind; reference: string; label: string; last_status: string; expected_by: Date | null; late_notified: boolean }[]>`
      select id, holder_id, user_id, kind, reference, label, last_status, expected_by, late_notified from case_watches where active`;
    for (const w of watches) {
      const status = await currentStatus(tx as unknown as Sql, w.kind, w.reference);
      if (!status) continue;
      const changed = status !== w.last_status;
      const late = !changed && !w.late_notified && w.expected_by != null && new Date(w.expected_by) < now && !CLOSED.has(status);
      if (!changed && !late) continue;
      // No proactive message while the customer is on a review hold.
      const b = bank(tx as unknown as Sql);
      const held = {
        n: (await b.listRestrictions(w.holder_id, {})).filter((r) => r.type === "review_hold").length
          + (await b.listMerchantHolds(w.holder_id)).filter((h) => h.type === "review_hold").length,
      };
      const [recent] = await tx<{ n: number }[]>`select count(*)::int as n from outbox where watch_id = ${w.id} and sent_at > ${new Date(now.getTime() - 86_400_000)}`;
      const contact = w.user_id ? await b.getContact(w.user_id) : { phone: null };
      // One update per case per day: a change inside the day waits for tomorrow's run, still unsent.
      if (held.n === 0 && recent.n > 0) continue;
      const canSend = held.n === 0 && contact?.phone;
      if (canSend) {
        const body = compose(w.label, w.reference, status, late, w.expected_by);
        await tx`insert into outbox (holder_id, user_id, watch_id, channel, sent_to, body, sent_at)
          values (${w.holder_id}, ${w.user_id}, ${w.id}, 'Text message', ${`•••• ${contact.phone!.replace(/\D/g, "").slice(-4)}`}, ${body}, ${now})`;
        sent.push({ holder_id: w.holder_id, user_id: w.user_id, reference: w.reference, body });
      }
      // Held customers get nothing; their watch just follows the status. A closed case stops being watched.
      await tx`update case_watches set last_status = ${status}, late_notified = ${w.late_notified || (late && Boolean(canSend))}, active = ${!CLOSED.has(status)} where id = ${w.id}`;
    }
  });
}

/** Readable label for an amount, for watch labels. */
export const amountLabel = (amount: string | number, currency: string) => money(amount, currency);
