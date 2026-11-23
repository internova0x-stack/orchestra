// Tools, checks and sample data against a real Postgres (no model calls).
// Run with TEST_DATABASE_URL set, e.g. postgres://postgres@localhost:54329/postgres
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { seed } from "../lib/seed.ts";
import { runTool, respondBy, AWAITING_IDENTITY, AWAITING_CODE, type StreamEvent, type ToolCtx, type ToolResult } from "../lib/tools.ts";
import { createConversation, verifiedUser, type Conversation } from "../lib/session.ts";
import { checkIdentity } from "../lib/identity.ts";
import { Rules } from "../lib/rules.ts";
import { fromLocal } from "../lib/time.ts";
import { categoryOf, statusOf, urgencyOf, listCases, caseCounts, transcriptOf } from "../lib/cases.ts";
import { buildDashboard, timeRuleId } from "../lib/dashboard.ts";
import { proposeChange, decideChange, pendingChanges, ruleHistory, ruleImpact, isBig, proposeConflict, resolveConflict, decideMany } from "../lib/ruleChanges.ts";
import { RULE_SET } from "../lib/ruleSet.ts";
import { appendTurn, forModel, takeOver, handBack, staffReply, customerView } from "../lib/takeover.ts";
import { runTurn, operations } from "../lib/agent.ts";
import { staffUser } from "../lib/staff.ts";

const url = process.env.TEST_DATABASE_URL;
const sql = url ? postgres(url, { prepare: false, onnotice: () => {} }) : null;
const skip = !sql && "TEST_DATABASE_URL not set";

after(async () => {
  await sql?.end();
});

async function session(userId: string | null, now: Date, stronger = false) {
  const conv = await createConversation(sql!, randomUUID(), userId);
  let c: Conversation = conv;
  if (userId) {
    const strongAt = stronger ? now : null;
    await sql!`update conversations set verified_user_id = ${userId}, verified_at = ${now}, last_activity = ${now}, stronger_verified_at = ${strongAt} where id = ${conv.id}`;
    c = { ...conv, verified_user_id: userId, verified_at: now, last_activity: now, stronger_verified_at: strongAt };
  }
  const user = await verifiedUser(sql!, c, now);
  const events: StreamEvent[] = [];
  const ctx = (): ToolCtx => ({ sql: sql!, conv: c, user, now, toolUseId: randomUUID(), emit: (e) => events.push(e) });
  return { conv: c, user, events, ctx };
}

async function call(s: Awaited<ReturnType<typeof session>>, name: string, input: unknown) {
  const out = await runTool(name, input, s.ctx());
  assert.equal(typeof out, "object", "the tool paused for a form");
  return out as ToolResult;
}

// Monday 23 November 2026, 11:00 Lagos time.
const MONDAY = fromLocal(2026, 10, 23, 11 * 60);

before(async () => {
  if (sql) await seed(sql, MONDAY);
});

test("test 1: PO-88190 is processing by SWIFT and inside its window", { skip }, async () => {
  const s = await session("ada", MONDAY);
  const out = await call(s, "get_transfer_status", { reference: "PO-88190" });
  assert.equal(out.ok, true);
  const p = (out.data as { payouts: Record<string, unknown>[] }).payouts[0];
  assert.equal(p.status, "Processing");
  assert.equal(p.route, "SWIFT");
  assert.equal(p.normal_window, "1 to 3 business days");
  assert.equal(p.late, false);
  assert.equal(p.amount, "$4,200.00");
  assert.match(String(p.recipient_account), /^•••• \d{4}$/);
  assert.ok(s.events.some((e) => e.type === "card"));
  const rows = await sql!`select kind, summary from audit_log where conversation_id = ${s.conv.id} order by id`;
  assert.ok(rows.some((r) => r.kind === "rule" && r.summary.includes("SWIFT normal window · 1 to 3 business days")));
  assert.ok(rows.some((r) => r.kind === "lookup" && r.summary.includes("PO-88190 · found: processing")));
});

test("test 1 holds on every day of the week; the SWIFT-window change makes it late", { skip }, async () => {
  for (let d = 0; d < 7; d++) {
    const now = fromLocal(2026, 10, 23 + d, 11 * 60);
    await seed(sql!, now);
    const s = await session("ada", now);
    const p = ((await call(s, "get_transfer_status", { reference: "PO-88190" })).data as { payouts: Record<string, unknown>[] }).payouts[0];
    assert.equal(p.late, false, `day ${d}: inside the 3-day window`);
    await sql!`update rules set value = '2' where id = 'late_swift'`;
    const p2 = ((await call(s, "get_transfer_status", { reference: "PO-88190" })).data as { payouts: Record<string, unknown>[] }).payouts[0];
    assert.equal(p2.late, true, `day ${d}: late once the window is 2 days`);
  }
  await seed(sql!, MONDAY);
});

test("test 2: PO-88102 is past its window", { skip }, async () => {
  const s = await session("ada", MONDAY);
  const p = ((await call(s, "get_transfer_status", { recipient: "Castellan" })).data as { payouts: Record<string, unknown>[] }).payouts[0];
  assert.equal(p.reference, "PO-88102");
  assert.equal(p.late, true);
});

test("test 3: PO-77310 failed because the recipient's account is closed", { skip }, async () => {
  const s = await session("maya", MONDAY);
  const p = ((await call(s, "get_transfer_status", { recipient: "Ridgeway" })).data as { payouts: Record<string, unknown>[] }).payouts[0];
  assert.equal(p.reference, "PO-77310");
  assert.equal(p.status, "Failed");
  assert.match(String(p.failure_reason), /account is closed/);
});

test("test 4 data: PO-88213 is $14,500 to Northgate Supplies, sent today", { skip }, async () => {
  const s = await session("ada", MONDAY);
  const p = ((await call(s, "get_transfer_status", { reference: "po-88213" })).data as { payouts: Record<string, unknown>[] }).payouts[0];
  assert.equal(p.amount, "$14,500.00");
  assert.equal(p.recipient, "Northgate Supplies");
  assert.match(String(p.sent), /^23 November 2026/);
});

test("test 11: a payout on a review hold shows On hold, with no stage and no reason", { skip }, async () => {
  const s = await session("lena", MONDAY);
  const out = await call(s, "get_transfer_status", { recipient: "Varga" });
  const json = JSON.stringify(out);
  const p = (out.data as { payouts: Record<string, unknown>[] }).payouts[0];
  assert.equal(p.status, "On hold");
  assert.equal(p.stage, undefined);
  assert.doesNotMatch(json, /sanction|screening|compliance check/i);
  const audit = await sql!`select summary, result::text from audit_log where conversation_id = ${s.conv.id}`;
  assert.doesNotMatch(JSON.stringify(audit), /sanction/i);
});

test("ownership: another business's payout is not found", { skip }, async () => {
  const s = await session("maya", MONDAY);
  const out = await call(s, "get_transfer_status", { reference: "PO-88190" });
  assert.equal((out.data as { found: number }).found, 0);
});

test("identity first: an unverified session gets no account data", { skip }, async () => {
  const s = await session(null, MONDAY);
  const out = await call(s, "get_transfer_status", { reference: "PO-88190" });
  assert.equal(out.ok, false);
  assert.match(out.reason!, /not been verified/);
  const rows = await sql!`select kind from audit_log where conversation_id = ${s.conv.id}`;
  assert.deepEqual(rows.map((r) => r.kind), ["refusal"]);
});

test("verify_identity asks for the form, then the check matches only exact answers", { skip }, async () => {
  const s = await session(null, MONDAY);
  const out = await runTool("verify_identity", {}, s.ctx());
  assert.equal(out, AWAITING_IDENTITY);
  assert.ok(s.events.some((e) => e.type === "identity_form"));
  assert.equal(await checkIdentity(sql!, { full_name: "Ada Okafor", date_of_birth: "1988-03-14", registration_number: "11482037" }), "ada");
  assert.equal(await checkIdentity(sql!, { full_name: " ada  okafor ", date_of_birth: "1988-03-14", registration_number: "1148 2037" }), "ada");
  assert.equal(await checkIdentity(sql!, { full_name: "Ada Okafor", date_of_birth: "1988-03-15", registration_number: "11482037" }), null);
  assert.equal(await checkIdentity(sql!, { full_name: "Ada Okafor", date_of_birth: "1988-03-14", registration_number: "09731564" }), null);
  assert.equal(await checkIdentity(sql!, { full_name: "Sam Wright", date_of_birth: "1979-01-30", registration_number: "RC1764521" }), "sam");
  assert.equal(await checkIdentity(sql!, { full_name: "Tunde Bello", date_of_birth: "1993-07-02", registration_number: "11482037" }), "tunde");
});

test("escalations: ESC references, one open case per issue, CMP for complaints", { skip }, async () => {
  const s = await session("ada", MONDAY);
  const base = { request: "Where is my payout", checked: "PO-88102 late", did: "None", needed: "Chase the bank", told: "The team will pick it up" };
  const a = await call(s, "escalate_to_human", { ...base, trigger: "payout_past_window", urgency: "normal" });
  assert.equal(a.reference, "ESC-1042");
  const row = await sql!`select urgency, summary from escalations where reference = 'ESC-1042'`;
  assert.equal(row[0].urgency, "high", "a late payout is at least high, whatever the model says");
  assert.equal(row[0].summary.customer.business, "Brightline Studios Ltd");
  const again = await call(s, "escalate_to_human", { ...base, trigger: "payout_past_window", urgency: "high" });
  assert.equal(again.reference, "ESC-1042");
  const c = await call(s, "escalate_to_human", { ...base, trigger: "formal_complaint", urgency: "normal" });
  assert.equal(c.reference, "CMP-0211");
});

test("knowledge base answers never carry Nuvion's name or links", { skip }, async () => {
  const s = await session(null, MONDAY);
  for (const q of ["SWIFT settlement", "payout destinations", "verification documents", "conversion fee"]) {
    const out = await call(s, "search_knowledge_base", { query: q });
    const json = JSON.stringify(out);
    assert.doesNotMatch(json, /nuvion|https?:/i);
    assert.ok((out.data as { answers: unknown[] }).answers.length > 0, q);
  }
});

test("response targets follow the rules and business hours", { skip }, async () => {
  const rules = await Rules.load(sql!);
  const high = respondBy("high", MONDAY, rules); // Monday 11:00 + 4 business hours
  assert.equal(high.text, "today by 15:00");
  const late = respondBy("high", fromLocal(2026, 10, 23, 16 * 60), rules); // Monday 16:00
  assert.equal(late.text, "tomorrow by 12:00");
  const urgent = respondBy("urgent", MONDAY, rules);
  assert.equal(urgent.text, "today by 12:00");
  const friday = respondBy("normal", fromLocal(2026, 10, 27, 18 * 60), rules); // Friday 18:00, after hours
  assert.equal(friday.outsideHours, true);
  assert.match(friday.text, /Tuesday 1 December 2026|Monday 30 November 2026/);
});

test("seed: the named test users and records exist", { skip }, async () => {
  const users = await sql!`select full_name, role from business_users where id in ('ada','tunde','maya','sam','lena') order by id`;
  assert.equal(users.length, 5);
  const harbour = await sql!`select verification_status, verification_reason from businesses where id = 'harbour'`;
  assert.equal(harbour[0].verification_status, "incomplete");
  const unalloc = await sql!`select amount, status from incoming_payments where id = 'IN-50311'`;
  assert.equal(Number(unalloc[0].amount), 2750);
  assert.equal(unalloc[0].status, "unallocated");
  const adeyemi = await sql!`select count(*)::int as n from incoming_payments where payer_name ilike '%adeyemi%'`;
  assert.equal(adeyemi[0].n, 0);
  const fx = await sql!`select from_amount, to_amount, rate, amount from fees where id = 'FX-20418'`;
  assert.equal(Number(fx[0].amount), 25);
});

// ---------------------------------------------------------------- step 2: proof of payment

test("test 8: a confirmation for PO-88021, once, with a masked account", { skip }, async () => {
  await seed(sql!, MONDAY);
  const s = await session("ada", MONDAY);
  const out = await call(s, "generate_proof_of_payment", { reference: "PO-88021" });
  assert.equal(out.ok, true);
  assert.equal(out.reference, "PP-4101");
  const proof = (out.data as { confirmation: Record<string, string> }).confirmation;
  assert.equal(proof.amount, "£980.00");
  assert.equal(proof.recipient, "Fenwick Design");
  assert.match(proof.account, /^•••• \d{4}$/);
  assert.ok(s.events.some((e) => e.type === "proof"));
  const again = await call(s, "generate_proof_of_payment", { reference: "PO-88021" });
  assert.equal(again.reference, "PP-4101", "a second request returns the first confirmation");
  const n = await sql!`select count(*)::int as n from proofs`;
  assert.equal(n[0].n, 1);
  const rows = await sql!`select kind, summary from audit_log where conversation_id = ${s.conv.id} order by id`;
  assert.equal(rows[0].summary, "generate_proof_of_payment · PO-88021 · created");
});

test("test 9: no confirmation for PO-88190, still processing; the reason offers a status note", { skip }, async () => {
  const s = await session("ada", MONDAY);
  const out = await call(s, "generate_proof_of_payment", { reference: "PO-88190" });
  assert.equal(out.ok, false);
  assert.match(out.reason!, /status note/);
  const rows = await sql!`select kind, summary from audit_log where conversation_id = ${s.conv.id}`;
  assert.equal(rows[0].kind, "refusal");
  assert.equal(rows[0].summary, "generate_proof_of_payment · refused: payout processing");
});

test("proof: never for a failed payout, another business's payout, or a held one", { skip }, async () => {
  const maya = await session("maya", MONDAY);
  assert.equal((await call(maya, "generate_proof_of_payment", { reference: "PO-77310" })).ok, false);
  assert.equal((await call(maya, "generate_proof_of_payment", { reference: "PO-88021" })).ok, false);
  const lena = await session("lena", MONDAY);
  const held = await call(lena, "generate_proof_of_payment", { reference: "PO-88177" });
  assert.equal(held.ok, false);
  assert.doesNotMatch(JSON.stringify(held), /sanction/i);
});

test("proof: switched off on the Rules screen means no confirmation", { skip }, async () => {
  await sql!`update rules set value = 'off' where id = 'action_generate_proof_of_payment'`;
  const s = await session("ada", MONDAY);
  const out = await call(s, "generate_proof_of_payment", { reference: "PO-88021" });
  assert.equal(out.ok, false);
  assert.match(out.reason!, /switched off/);
  await sql!`update rules set value = 'on' where id = 'action_generate_proof_of_payment'`;
});

test("proof PDF: one page, watermarked, masked, no institution name", { skip }, async () => {
  const { proofPdf } = await import("../lib/proofPdf.ts");
  const bytes = await proofPdf({ reference: "PP-4101", payout: "PO-88021", amount: "₦1,200,000.00", currency: "NGN", date: "18 November 2026", recipient: "Fenwick Design", account: "•••• 3170", route: "Faster Payments", issued: "23 November 2026, 11:00" });
  const text = Buffer.from(bytes).toString("latin1");
  assert.ok(text.startsWith("%PDF"));
  assert.ok(bytes.length > 1000);
  assert.doesNotMatch(text, /nuvion/i);
});

// ---------------------------------------------------------------- step 3: incoming payments

test("test 6: the unallocated £2,750 from last Friday is found, and not credited", { skip }, async () => {
  const s = await session("maya", MONDAY);
  const out = await call(s, "find_incoming_payment", { amount: 2750, currency: "GBP", payer: "Ashby Retail" });
  const p = (out.data as { payments: Record<string, string>[] }).payments[0];
  assert.equal(p.status, "Unallocated");
  assert.equal(p.reference_used, "KSTRL INV 2O45");
  assert.match(p.received, /^20 November 2026/, "last Friday before Monday 23 November");
  const row = await sql!`select status from incoming_payments where id = 'IN-50311'`;
  assert.equal(row[0].status, "unallocated");
});

test("test 6: the unallocated payment is found by amount and date, without the payer's name", { skip }, async () => {
  const s = await session("maya", MONDAY);
  const out = await call(s, "find_incoming_payment", { amount: 2750, currency: "GBP", sent_on: "2026-11-20" });
  assert.equal((out.data as { found: number }).found, 1);
});

test("test 7: nothing from Adeyemi Stores", { skip }, async () => {
  const s = await session("maya", MONDAY);
  const out = await call(s, "find_incoming_payment", { amount: 1200000, currency: "NGN", payer: "Adeyemi Stores" });
  assert.equal((out.data as { found: number }).found, 0);
  assert.match((out.data as { note: string }).note, /proof of payment/);
  const rows = await sql!`select summary from audit_log where conversation_id = ${s.conv.id}`;
  assert.equal(rows[0].summary, "find_incoming_payment · no match");
});

test("incoming: other businesses' credited payments stay private; loose searches skip the unallocated pool", { skip }, async () => {
  const s = await session("maya", MONDAY);
  const out = await call(s, "find_incoming_payment", { payer: "Glasshouse" }); // Brightline's credited payment
  assert.equal((out.data as { found: number }).found, 0);
  const loose = await call(s, "find_incoming_payment", { amount: 420000 }); // Ember's unallocated, amount only
  assert.equal((loose.data as { found: number }).found, 0);
});

// ---------------------------------------------------------------- step 4: review hold

test("test 11 and S5: get_account_restrictions returns only \"review hold\"", { skip }, async () => {
  await seed(sql!, MONDAY);
  const s = await session("lena", MONDAY);
  const out = await call(s, "get_account_restrictions", { reference: "PO-88177" });
  const json = JSON.stringify(out);
  assert.match(json, /"type":"review hold"/);
  assert.doesNotMatch(json, /sanction|screening|name match/i);
  const rows = await sql!`select summary, result::text as result from audit_log where conversation_id = ${s.conv.id}`;
  assert.equal(rows[0].summary, "get_account_restrictions · review hold");
  assert.doesNotMatch(rows[0].result, /sanction/i);
});

test("restrictions: a customer-fixable one comes with its cause; other businesses' holds stay hidden", { skip }, async () => {
  const sam = await session("sam", MONDAY);
  const out = await call(sam, "get_account_restrictions", {});
  assert.match(JSON.stringify(out), /ownership document/);
  const ada = await session("ada", MONDAY);
  const none = await call(ada, "get_account_restrictions", { reference: "PO-88177" });
  assert.deepEqual((none.data as { restrictions: unknown[] }).restrictions, []);
});

// ---------------------------------------------------------------- step 5: recalls and the Staff queue

async function confirmPending(s: Awaited<ReturnType<typeof session>>) {
  // What the "Yes, go ahead" button does in runTurn: only the customer's yes sets this.
  const [row] = await sql!`update conversations set pending_action = jsonb_set(pending_action, '{confirmed}', 'true') where id = ${s.conv.id} returning pending_action`;
  s.conv.pending_action = row.pending_action;
}

test("recall: nothing happens without the customer's yes; then within the cap it's requested once", { skip }, async () => {
  await seed(sql!, MONDAY);
  const s = await session("ada", MONDAY);
  const first = await call(s, "initiate_recall", { reference: "PO-88150" });
  assert.equal(first.ok, false);
  assert.match(first.reason!, /CONFIRMATION_NEEDED/);
  assert.ok(s.events.some((e) => e.type === "confirm"));
  assert.equal((await sql!`select count(*)::int as n from recalls`)[0].n, 0, "no recall before the yes");
  // Calling again without a yes still does nothing: the model can't confirm on the customer's behalf.
  assert.match((await call(s, "initiate_recall", { reference: "PO-88150" })).reason!, /CONFIRMATION_NEEDED/);
  await confirmPending(s);
  const done = await call(s, "initiate_recall", { reference: "PO-88150" });
  assert.equal(done.ok, true);
  assert.equal(done.reference, "REC-5001");
  const dup = await call(s, "initiate_recall", { reference: "PO-88150" });
  assert.equal(dup.ok, false);
  assert.equal(dup.reference, "REC-5001", "a second recall returns the first reference");
  assert.equal((await sql!`select count(*)::int as n from recalls`)[0].n, 1);
});

test("test 4: a $14,500 recall is above the cap: prepared, refused, linked to the case, approved in the Staff queue", { skip }, async () => {
  const { decide } = await import("../lib/staff.ts");
  await seed(sql!, MONDAY);
  const s = await session("ada", MONDAY);
  await call(s, "initiate_recall", { reference: "PO-88213" });
  await confirmPending(s);
  const out = await call(s, "initiate_recall", { reference: "PO-88213" });
  assert.equal(out.ok, false);
  assert.equal(out.reference, "REC-5001");
  const rows = await sql!`select kind, summary from audit_log where conversation_id = ${s.conv.id} order by id`;
  assert.ok(rows.some((r) => r.kind === "refusal" && r.summary === "initiate_recall · refused: above cap $10,000"));
  const esc = await call(s, "escalate_to_human", { trigger: "recall_over_cap", urgency: "high", request: "Recall PO-88213", checked: "PO-88213 $14,500.00", did: "Recall prepared, not submitted", needed: "Approve or decline", told: "Needs approval" });
  const [kase] = await sql!`select action from escalations where reference = ${esc.reference!}`;
  assert.equal(kase.action.reference, "REC-5001");
  const decided = await decide(sql!, esc.reference!, "approve", null);
  assert.equal(decided.ok, true);
  const [recall] = await sql!`select status, decided_by from recalls where reference = 'REC-5001'`;
  assert.equal(recall.status, "approved");
  assert.equal(recall.decided_by, "Supervisor");
  const approval = await sql!`select summary, approver from audit_log where conversation_id = ${s.conv.id} and kind = 'approval'`;
  assert.equal(approval[0].summary, "approved by Supervisor · recall on PO-88213");
  assert.equal((await decide(sql!, esc.reference!, "approve", null)).ok, false, "a case is decided once");
});

test("test 5: a view-only user can't request a recall", { skip }, async () => {
  const s = await session("tunde", MONDAY);
  const out = await call(s, "initiate_recall", { reference: "PO-88213" });
  assert.equal(out.ok, false);
  assert.match(out.reason!, /view-only/);
  const rows = await sql!`select summary from audit_log where conversation_id = ${s.conv.id}`;
  assert.equal(rows[0].summary, "initiate_recall · refused: view-only role");
});

test("S6: lowering the cap to $2,000 sends the $3,200 recall for approval", { skip }, async () => {
  await seed(sql!, MONDAY);
  await sql!`update rules set value = '2000' where id = 'recall_cap_usd'`;
  const s = await session("ada", MONDAY);
  await call(s, "initiate_recall", { reference: "PO-88150" });
  await confirmPending(s);
  const out = await call(s, "initiate_recall", { reference: "PO-88150" });
  assert.equal(out.ok, false);
  assert.match(out.reason!, /above the \$2,000 cap/);
  const [r] = await sql!`select status from recalls where transfer_id = 'PO-88150'`;
  assert.equal(r.status, "awaiting_approval");
  await seed(sql!, MONDAY);
});

test("recall: never on a held payout, a failed one, or another business's", { skip }, async () => {
  const lena = await session("lena", MONDAY);
  assert.match((await call(lena, "initiate_recall", { reference: "PO-88177" })).reason!, /review hold/);
  const maya = await session("maya", MONDAY);
  assert.match((await call(maya, "initiate_recall", { reference: "PO-77310" })).reason!, /Failed/);
  assert.match((await call(maya, "initiate_recall", { reference: "PO-88213" })).reason!, /No payout/);
});

// ---------------------------------------------------------------- step 6: the Rules screen

test("rule edits are checked, logged, and change the next tool call", { skip }, async () => {
  const { editRule } = await import("../lib/ruleEdit.ts");
  await seed(sql!, MONDAY);
  assert.equal((await editRule(sql!, "recall_cap_usd", "two thousand")).ok, false);
  assert.equal((await editRule(sql!, "action_initiate_recall", "maybe")).ok, false);
  assert.equal((await editRule(sql!, "business_open", "9am")).ok, false);
  const ok = await editRule(sql!, "recall_cap_usd", "$2,000");
  assert.equal(ok.ok, true);
  assert.equal((await sql!`select value from rules where id = 'recall_cap_usd'`)[0].value, "2000");
  const log = await sql!`select summary from audit_log where kind = 'rule_edit'`;
  assert.equal(log[0].summary, "rule edited · Recall cap before human approval (USD) · 10000 → 2000");
  assert.equal((await sql!`select count(*)::int as n from rule_changes`)[0].n, 1);
  // S6 through the Rules screen's own path.
  const s = await session("ada", MONDAY);
  await call(s, "initiate_recall", { reference: "PO-88150" });
  await confirmPending(s);
  assert.match((await call(s, "initiate_recall", { reference: "PO-88150" })).reason!, /above the \$2,000 cap/);
  // Reset demo restores the original cap.
  await seed(sql!, MONDAY);
  assert.equal((await sql!`select value from rules where id = 'recall_cap_usd'`)[0].value, "10000");
});

// ---------------------------------------------------------------- step 7: verification, fees, S2

test("test 10: Harbour and Vine's verification is Incomplete, with the missing ownership document and how to submit it", { skip }, async () => {
  await seed(sql!, MONDAY);
  const s = await session("sam", MONDAY);
  const out = await call(s, "get_kyc_status", {});
  const d = out.data as Record<string, string>;
  assert.equal(d.status, "Incomplete");
  assert.match(d.reason, /Ownership document missing/);
  assert.match(d.missing, /ownership/);
  assert.match(d.how_to_submit, /dashboard/);
});

test("verification: Pending shows days against the normal window", { skip }, async () => {
  const s = await session("rosa", MONDAY);
  const d = (await call(s, "get_kyc_status", {})).data as Record<string, unknown>;
  assert.equal(d.status, "Pending");
  assert.equal(d.normal_review_time, "2 business days");
  assert.equal(d.past_window, false);
});

test("test 12: yesterday's GBP to USD conversion: rate, time, both amounts and the fee", { skip }, async () => {
  const s = await session("maya", MONDAY);
  const out = await call(s, "get_fees", { kind: "conversion" });
  const c = (out.data as { items: Record<string, string>[] }).items[0];
  assert.equal(c.type, "Conversion");
  assert.equal(c.converted, "£5,000.00");
  assert.equal(c.fee, "£25.00");
  assert.equal(c.rate, "1 GBP = 1.2718 USD");
  assert.equal(c.received, "$6,327.21");
  assert.match(c.time, /^22 November 2026, 10:42/);
});

test("balances: one per currency, only the business's own", { skip }, async () => {
  const s = await session("maya", MONDAY);
  const d = (await call(s, "get_balance", {})).data as { balances: { currency: string; balance: string }[] };
  assert.deepEqual(d.balances.map((b) => b.currency), ["GBP", "NGN", "USD"]);
  assert.equal(d.balances.find((b) => b.currency === "GBP")!.balance, "£31,877.42");
});

test("S2: no tool can add or change a beneficiary, contact details, or approve verification", { skip: false }, async () => {
  const { toolDefinitions } = await import("../lib/tools.ts");
  const names = toolDefinitions().map((t) => (t as { name: string }).name);
  for (const demo of [
    "escalate_to_human", "find_incoming_payment", "generate_proof_of_payment", "get_account_restrictions", "get_balance",
    "get_fees", "get_kyc_status", "get_transfer_status", "initiate_recall", "search_knowledge_base", "verify_identity",
  ]) assert.ok(names.includes(demo), demo);
  // Deliberately missing (Tools and Data Spec): no tool changes contact details or beneficiaries,
  // approves a loan, KYC or dispute, lifts a review hold, credits funds or contacts an outside party.
  assert.ok(!names.some((n) => /beneficiar|recipient|contact|approve|update_|credit|lift|decide|send_claim/.test(n)), names.join(", "));
});

// ---------------------------------------------------------------- deployment

test("first run: two visitors at once on an empty database seed it exactly once", { skip }, async () => {
  const { ensureSeeded } = await import("../lib/seed.ts");
  await sql!.unsafe(`drop schema public cascade; create schema public;`);
  (globalThis as { __orchestraReady?: unknown }).__orchestraReady = undefined;
  const other = postgres(url!, { prepare: false, onnotice: () => {} });
  try {
    // Two server processes: separate connections, separate caches.
    const first = ensureSeeded(sql!);
    (globalThis as { __orchestraReady?: unknown }).__orchestraReady = undefined;
    await Promise.all([first, ensureSeeded(other)]);
  } finally {
    await other.end();
  }
  assert.equal((await sql!`select count(*)::int as n from rules where id = 'late_swift'`)[0].n, 1);
  assert.equal((await sql!`select count(*)::int as n from businesses where kind = 'business'`)[0].n, 8);
  assert.equal((await sql!`select count(*)::int as n from businesses where kind = 'personal'`)[0].n, 5);

  // A later server process with the same schema runs no DDL: it holds no table locks, so a transaction
  // already holding a table lock doesn't block it.
  const { SCHEMA_VERSION } = await import("../lib/seed.ts");
  assert.equal((await sql!`select value from app_meta where key = 'schema_version'`)[0].value, SCHEMA_VERSION);
  const holder = postgres(url!, { prepare: false, onnotice: () => {} });
  try {
    await holder.begin(async (tx) => {
      await tx`lock table conversations in access share mode`;
      (globalThis as { __orchestraReady?: unknown }).__orchestraReady = undefined;
      const started = Date.now();
      await ensureSeeded(sql!);
      assert.ok(Date.now() - started < 2000, "the fast path didn't wait on table locks");
    });
  } finally {
    await holder.end();
  }
  await seed(sql!, MONDAY);
});

// ---------------------------------------------------------------- use case 4: account access

test("one-time code: only after the standard check, sent to the phone on file, pauses for the form", { skip }, async () => {
  await seed(sql!, MONDAY);
  const anon = await session(null, MONDAY);
  assert.equal((await call(anon, "send_one_time_code", {})).ok, false);
  const s = await session("emeka", MONDAY);
  const out = await runTool("send_one_time_code", {}, s.ctx());
  assert.equal(out, AWAITING_CODE);
  const form = s.events.find((e) => e.type === "code_form") as { sentTo: string; code: string };
  assert.equal(form.sentTo, "•••• 0177");
  assert.match(form.code, /^\d{6}$/);
  const [row] = await sql!`select pending_code from conversations where id = ${s.conv.id}`;
  assert.equal(row.pending_code.code, form.code);
});

test("planted 9: Emeka's locked access unlocks only with the stronger check and his yes", { skip }, async () => {
  const standard = await session("emeka", MONDAY);
  assert.match((await call(standard, "unlock_account", {})).reason!, /stronger identity check/);
  const s = await session("emeka", MONDAY, true);
  assert.match((await call(s, "unlock_account", {})).reason!, /CONFIRMATION_NEEDED/);
  await confirmPending(s);
  const done = await call(s, "unlock_account", {});
  assert.equal(done.ok, true);
  assert.equal((await sql!`select login_locked from business_users where id = 'emeka'`)[0].login_locked, null);
  assert.match((await call(s, "unlock_account", {})).reason!, /isn't locked/);
});

test("reset links go only to the email on file, three a day", { skip }, async () => {
  const s = await session("chioma", MONDAY, true);
  for (let i = 0; i < 3; i++) {
    await call(s, "send_reset_link", {});
    await confirmPending(s);
    const out = await call(s, "send_reset_link", {});
    assert.equal(out.ok, true);
    assert.equal((out.data as { sent_to: string }).sent_to, "c•••@example.com");
  }
  assert.match((await call(s, "send_reset_link", {})).reason!, /3 reset links/);
});

test("personal accounts: identity uses the last 4 digits of the account number", { skip }, async () => {
  assert.equal(await checkIdentity(sql!, { full_name: "Chioma Eze", date_of_birth: "1991-04-12", registration_number: "6789" }), "chioma");
  assert.equal(await checkIdentity(sql!, { full_name: "Grace Mensah", date_of_birth: "1990-02-27", registration_number: "5432" }), "grace");
  assert.equal(await checkIdentity(sql!, { full_name: "Chioma Eze", date_of_birth: "1991-04-12", registration_number: "0123456789" }), null);
});

// ---------------------------------------------------------------- use cases 1 and 2: cards and disputes

test("planted 1: Chioma's lost card is frozen after her yes, then the two charges after the loss are disputed", { skip }, async () => {
  await seed(sql!, MONDAY);
  const s = await session("chioma", MONDAY);
  const card = (await call(s, "get_card", {})).data as Record<string, string>;
  assert.equal(card.card, "•••• 4421");
  assert.equal(card.status, "Active");
  assert.match((await call(s, "freeze_card", {})).reason!, /CONFIRMATION_NEEDED/);
  assert.equal((await sql!`select status from cards where id = 'CARD-4421'`)[0].status, "active", "nothing before the yes");
  await confirmPending(s);
  assert.equal((await call(s, "freeze_card", {})).ok, true);
  assert.equal((await sql!`select status from cards where id = 'CARD-4421'`)[0].status, "frozen");
  for (const id of ["TX-90012", "TX-90013"]) {
    await call(s, "open_dispute", { transaction_id: id, reason: "not_mine" });
    await confirmPending(s);
    assert.equal((await call(s, "open_dispute", { transaction_id: id, reason: "not_mine" })).ok, true, id);
  }
  const again = await call(s, "open_dispute", { transaction_id: "TX-90012", reason: "not_mine" });
  assert.equal(again.ok, false);
  assert.equal(again.reference, "DSP-7001", "a second dispute returns the first");
});

test("card controls: unfreezing follows the institution's rules; a bank freeze and a 'not mine' dispute stay frozen", { skip }, async () => {
  // Chioma froze her card and disputed two charges as not hers (planted 1).
  const weak = await session("chioma", MONDAY);
  assert.match((await call(weak, "unfreeze_card", {})).reason!, /stronger identity check/, "the code first, by default");
  const s = await session("chioma", MONDAY, true);
  assert.match((await call(s, "unfreeze_card", {})).reason!, /weren't theirs \(DSP-7001\)/, "an open 'not mine' dispute keeps it frozen");
  await sql!`update rules set value = 'off' where id = 'card_unfreeze_block_dispute'`;
  assert.match((await call(s, "unfreeze_card", {})).reason!, /CONFIRMATION_NEEDED/);
  assert.equal((await sql!`select status from cards where id = 'CARD-4421'`)[0].status, "frozen", "nothing before the yes");
  await confirmPending(s);
  const done = await call(s, "unfreeze_card", {});
  assert.ok(done.ok, JSON.stringify(done));
  assert.match(done.reference!, /^CHG-/);
  assert.equal((await sql!`select status from cards where id = 'CARD-4421'`)[0].status, "active");
  // An institution that switches unfreezing off: Alexis hands off instead.
  await sql!`update cards set status = 'frozen', frozen_by = 'customer' where id = 'CARD-4421'`;
  await sql!`update rules set value = 'off' where id = 'action_unfreeze_card'`;
  assert.match((await call(s, "unfreeze_card", {})).reason!, /switched off/);
  // An institution that doesn't ask for the code.
  await sql!`update rules set value = 'on' where id = 'action_unfreeze_card'`;
  await sql!`update rules set value = 'off' where id = 'card_unfreeze_stronger'`;
  assert.match((await call(weak, "unfreeze_card", {})).reason!, /CONFIRMATION_NEEDED/);
  await sql!`update conversations set pending_action = null where id = ${weak.conv.id}`;
  await sql!`update rules set value = 'on' where id in ('card_unfreeze_stronger', 'card_unfreeze_block_dispute')`;

  // A freeze the bank placed is never lifted or worked around.
  await sql!`update cards set status = 'frozen', frozen_by = 'bank' where id = 'CARD-7710'`;
  const emeka = await session("emeka", MONDAY, true);
  assert.equal(((await call(emeka, "get_card", {})).data as { status: string }).status, "Frozen by the bank");
  assert.match((await call(emeka, "unfreeze_card", {})).reason!, /bank froze this card/);
  assert.match((await call(emeka, "change_card_settings", { contactless: false })).reason!, /bank froze this card/);
  await sql!`update cards set status = 'active', frozen_by = null where id = 'CARD-7710'`;
});

test("card controls: a setting that caused a decline is switched on; limit changes follow the caps and the code rules", { skip }, async () => {
  // Grace's online payment was declined because online payments are off on her card.
  const grace = await session("grace", MONDAY);
  const card = (await call(grace, "get_card", {})).data as { settings: Record<string, string>; recent_declines: { reason: string }[] };
  assert.equal(card.settings.online_payments, "Off");
  assert.match(card.recent_declines[0].reason, /Online payments are switched off/);
  assert.match((await call(grace, "change_card_settings", { online_payments: true })).reason!, /CONFIRMATION_NEEDED/, "no code needed by default to switch a setting on");
  await confirmPending(grace);
  const on = await call(grace, "change_card_settings", { online_payments: true });
  assert.ok(on.ok, JSON.stringify(on));
  assert.equal((await sql!`select online_payments from cards where id = 'CARD-3307'`)[0].online_payments, true);
  assert.equal(((await call(grace, "change_card_settings", { online_payments: true })).data as { nothing_changed: boolean }).nothing_changed, true, "no second change");
  await sql!`update rules set value = 'on' where id = 'card_settings_stronger'`;
  assert.match((await call(grace, "change_card_settings", { international_payments: false })).reason!, /CONFIRMATION_NEEDED/, "switching off never needs the code");
  await sql!`update conversations set pending_action = null where id = ${grace.conv.id}`;
  await sql!`update cards set international_payments = false where id = 'CARD-3307'`;
  assert.match((await call(grace, "change_card_settings", { international_payments: true })).reason!, /stronger identity check/, "an institution can require the code to switch one on");
  await sql!`update rules set value = 'off' where id = 'card_settings_stronger'`;
  await sql!`update cards set online_payments = false, international_payments = true where id = 'CARD-3307'`;

  // Emeka hit his ₦200,000 daily limit.
  const weak = await session("emeka", MONDAY);
  assert.match((await call(weak, "change_card_settings", { daily_limit: 400000 })).reason!, /stronger identity check/, "raising needs the code by default");
  assert.match((await call(weak, "change_card_settings", { daily_limit: 150000 })).reason!, /CONFIRMATION_NEEDED/, "lowering doesn't");
  await sql!`update conversations set pending_action = null where id = ${weak.conv.id}`;
  const s = await session("emeka", MONDAY, true);
  assert.match((await call(s, "change_card_settings", { daily_limit: 2000000 })).reason!, /above the ₦1,000,000/);
  await call(s, "change_card_settings", { daily_limit: 400000 });
  await confirmPending(s);
  assert.ok((await call(s, "change_card_settings", { daily_limit: 400000 })).ok);
  assert.equal(Number((await sql!`select daily_limit from cards where id = 'CARD-7710'`)[0].daily_limit), 400000);
  await sql!`update rules set value = 'off' where id = 'card_limit_change'`;
  assert.match((await call(s, "change_card_settings", { daily_limit: 500000 })).reason!, /isn't something you can do/);
  await sql!`update rules set value = 'on' where id = 'card_limit_change'`;
  await sql!`update cards set daily_limit = 200000 where id = 'CARD-7710'`;
});

test("planted 2: Emeka's decline is explained from the record", { skip }, async () => {
  const s = await session("emeka", MONDAY);
  const card = (await call(s, "get_card", {})).data as { recent_declines: { reason: string }[] };
  assert.match(card.recent_declines[0].reason, /Daily spending limit reached/);
});

test("planted 3: a duplicate where one is a pending hold can't be disputed", { skip }, async () => {
  const s = await session("chioma", MONDAY);
  const list = (await call(s, "list_transactions", { merchant: "shoprite" })).data as { transactions: Record<string, string>[] };
  assert.ok(list.transactions.some((t) => t.possible_duplicate_of && /pending hold/.test(t.note)));
  assert.match((await call(s, "open_dispute", { transaction_id: "TX-90015", reason: "duplicate" })).reason!, /pending hold/);
});

test("planted 4 and 5: a genuine duplicate is disputable; an odd statement name shows the merchant's full name", { skip }, async () => {
  const s = await session("grace", MONDAY);
  const dup = (await call(s, "list_transactions", { merchant: "hollow" })).data as { transactions: Record<string, string>[] };
  assert.ok(dup.transactions.every((t) => t.status === "Settled" && t.possible_duplicate_of));
  await call(s, "open_dispute", { transaction_id: "TX-90032", reason: "duplicate" });
  await confirmPending(s);
  assert.equal((await call(s, "open_dispute", { transaction_id: "TX-90032", reason: "duplicate" })).ok, true);
  const odd = (await call(s, "list_transactions", { merchant: "NBLX" })).data as { transactions: Record<string, string>[] };
  assert.match(odd.transactions[0].merchant, /Nimble Bikes/);
});

test("cards: a replacement needs the stronger check, charges the rule's fee, and happens once", { skip }, async () => {
  const standard = await session("david", MONDAY);
  assert.match((await call(standard, "order_replacement", { reason: "damaged" })).reason!, /stronger identity check/);
  const s = await session("david", MONDAY, true);
  await call(s, "order_replacement", { reason: "damaged" });
  await confirmPending(s);
  const out = await call(s, "order_replacement", { reason: "damaged" });
  assert.equal(out.ok, true);
  assert.equal((out.data as { fee: string }).fee, "$5.00");
  assert.equal((await sql!`select status from cards where id = 'CARD-9902'`)[0].status, "replaced");
});

test("switches: an action switched off on the Rules screen is refused before it runs", { skip }, async () => {
  await sql!`update rules set value = 'off' where id = 'action_freeze_card'`;
  const s = await session("amara", MONDAY);
  const out = await call(s, "freeze_card", {});
  assert.match(out.reason!, /switched off/);
  await sql!`update rules set value = 'on' where id = 'action_freeze_card'`;
});

// ---------------------------------------------------------------- use case 12: debited but no value

test("planted 16: Chioma's POS payment, debited, no reversal after 72 hours: request one, breach logged", { skip }, async () => {
  await seed(sql!, MONDAY);
  const s = await session("chioma", MONDAY, true);
  const found = (await call(s, "find_payments", { amount: 18750, channel: "POS" })).data as { payments: Record<string, string>[] };
  assert.equal(found.payments[0].id, "PAY-61001");
  assert.match(found.payments[0].outcome, /debited/);
  const st = (await call(s, "get_reversal_status", { payment_id: "PAY-61001" })).data as Record<string, unknown>;
  assert.equal(st.past_window, true);
  await call(s, "request_reversal", { payment_id: "PAY-61001" });
  await confirmPending(s);
  const out = await call(s, "request_reversal", { payment_id: "PAY-61001" });
  assert.equal(out.ok, true);
  assert.equal(out.reference, "REV-8101");
  assert.equal((out.data as { breach_logged: boolean }).breach_logged, true);
  assert.equal((await call(s, "request_reversal", { payment_id: "PAY-61001" })).reference, "REV-8101", "once");
});

test("planted 17: Emeka's ATM withdrawal at another bank is already reversed", { skip }, async () => {
  const s = await session("emeka", MONDAY, true);
  const st = (await call(s, "get_reversal_status", { payment_id: "PAY-61002" })).data as { reversal: Record<string, string>; window: string };
  assert.equal(st.reversal.status, "Reversed");
  assert.equal(st.window, "48 hours");
  assert.match((await call(s, "request_reversal", { payment_id: "PAY-61002" })).reason!, /already been reversed/);
});

test("reversal: never for a payment that succeeded, or for someone else's", { skip }, async () => {
  const s = await session("chioma", MONDAY, true);
  assert.match((await call(s, "request_reversal", { payment_id: "PAY-61003" })).reason!, /succeeded/);
  assert.match((await call(s, "request_reversal", { payment_id: "PAY-61002" })).reason!, /No payment/);
});

// ---------------------------------------------------------------- use cases 5 and 15 (the rest), and 13 for personal KYC

test("planted 11: Emeka's waivable fee is waived once, after the stronger check and his yes", { skip }, async () => {
  await seed(sql!, MONDAY);
  const s = await session("emeka", MONDAY, true);
  const fees = (await call(s, "get_fees", { kind: "fee" })).data as { items: Record<string, unknown>[] };
  assert.equal(fees.items.find((f) => f.id === "FE-P0101")!.waivable, true);
  await call(s, "waive_fee", { fee_id: "FE-P0101" });
  await confirmPending(s);
  const out = await call(s, "waive_fee", { fee_id: "FE-P0101" });
  assert.equal(out.ok, true);
  assert.equal((out.data as { refunded: string }).refunded, "₦1,050.00");
  assert.match((await call(s, "waive_fee", { fee_id: "FE-P0102" })).reason!, /isn't one that can be waived|used this year/);
});

test("planted 12: Grace already used this year's waiver: declined politely", { skip }, async () => {
  const s = await session("grace", MONDAY, true);
  const out = await call(s, "waive_fee", { fee_id: "FE-P0201" });
  assert.equal(out.ok, false);
  assert.match(out.reason!, /goodwill waiver/);
});

test("planted 19: Chioma's Tier 1 limit and how to move up", { skip }, async () => {
  const s = await session("chioma", MONDAY);
  const d = (await call(s, "get_account_limits", {})).data as Record<string, string>;
  assert.equal(d.tier, "Tier 1");
  assert.equal(d.single_transfer_limit, "₦50,000.00");
  assert.match(d.to_move_up, /BVN or NIN/);
});

test("planted 13: David's verification failed on a blurry document: the reason and what to resubmit", { skip }, async () => {
  const s = await session("david", MONDAY);
  const d = (await call(s, "get_kyc_status", {})).data as Record<string, string>;
  assert.equal(d.status, "Failed");
  assert.match(d.reason, /blurry/);
  assert.match(d.missing, /clear photo/);
});

// ---------------------------------------------------------------- use cases 9 and 11: payment tracing

test("use case 11: each failure type names the responsible party with evidence", { skip }, async () => {
  await seed(sql!, MONDAY);
  const s = await session("grace", MONDAY);
  const expect: [string, string, string][] = [
    ["PAY-62001", "Authorisation", "Card issuer"],
    ["PAY-62002", "Capture", "Merchant's integration"],
    ["PAY-62003", "Settlement", "Processor or acquirer"],
    ["PAY-62004", "Payout to the merchant", "Platform or bank hold"],
  ];
  for (const [id, stage, party] of expect) {
    const d = (await call(s, "get_payment_timeline", { transaction_id: id })).data as Record<string, string>;
    assert.equal(d.broke_at, stage, id);
    assert.equal(d.responsible, party, id);
    assert.ok(d.evidence.length > 10, id);
  }
});

test("use case 11: a conflicting timeline means 'can't tell', never a guess", { skip }, async () => {
  const s = await session("grace", MONDAY);
  const d = (await call(s, "get_payment_timeline", { transaction_id: "PAY-62005" })).data as Record<string, string>;
  assert.equal(d.diagnosis, "Can't tell");
  assert.equal(d.responsible, undefined);
});

test("use case 9: an ID on another customer's account reveals nothing", { skip }, async () => {
  const s = await session("chioma", MONDAY);
  const out = await call(s, "get_payment_by_id", { transaction_id: "PAY-62003" });
  assert.equal(out.ok, false);
  assert.doesNotMatch(JSON.stringify(out), /Camden|219|grace/i);
  const mine = await call(s, "get_payment_by_id", { transaction_id: "pay-61003" });
  assert.equal((mine.data as { merchant: string }).merchant, "Konga (online store)");
});

// ---------------------------------------------------------------- use cases 7 and 8: loans and merchant payouts

test("planted 14: Emeka can't pay: a deferral request is logged once, with a decision date", { skip }, async () => {
  await seed(sql!, MONDAY);
  const s = await session("emeka", MONDAY, true);
  const loan = (await call(s, "get_loan", {})).data as Record<string, string>;
  assert.equal(loan.next_payment, "₦79,300.00");
  const quote = (await call(s, "payoff_quote", {})).data as { payoff_amount: string; valid_until: string };
  assert.match(quote.payoff_amount, /^₦9\d\d,\d{3}\.\d\d$/);
  await call(s, "request_deferral", {});
  await confirmPending(s);
  const out = await call(s, "request_deferral", {});
  assert.equal(out.reference, "DEF-4401");
  assert.match((out.data as { note: string }).note, /not an approval/);
  assert.equal((await call(s, "request_deferral", {})).reference, "DEF-4401", "once");
});

test("planted 15: Okapi's payout rejected by its bank: cause from the record, totals reconcile", { skip }, async () => {
  const s = await session("chidi", MONDAY);
  const d = (await call(s, "get_payout_status", { payout_id: "PY-21007" })).data as { payouts: Record<string, unknown>[] };
  assert.match(String(d.payouts[0].cause), /account name/);
  assert.equal(d.payouts[0].reconciles, true);
});

test("merchant review hold: On hold, no reason, anywhere", { skip }, async () => {
  const s = await session("kemi", MONDAY);
  const payout = await call(s, "get_payout_status", {});
  const holds = await call(s, "list_holds", {});
  assert.match(JSON.stringify(payout), /On hold/);
  assert.doesNotMatch(JSON.stringify(payout) + JSON.stringify(holds), /chargeback|risk review/i);
});

// ---------------------------------------------------------------- use case 17: proactive status updates

test("use case 17: a reversal that completes after the chat ends sends one update to the phone on file", { skip }, async () => {
  const { runUpdates, SIM_REVERSAL_MINUTES } = await import("../lib/updates.ts");
  await seed(sql!, MONDAY);
  const s = await session("chioma", MONDAY, true);
  await call(s, "request_reversal", { payment_id: "PAY-61001" });
  await confirmPending(s);
  await call(s, "request_reversal", { payment_id: "PAY-61001" });
  await runUpdates(sql!, new Date(MONDAY.getTime() + 60_000));
  assert.equal((await sql!`select count(*)::int as n from outbox`)[0].n, 0, "nothing until something changes");
  const later = new Date(MONDAY.getTime() + (SIM_REVERSAL_MINUTES + 1) * 60_000);
  await runUpdates(sql!, later);
  await runUpdates(sql!, new Date(later.getTime() + 60_000));
  const msgs = await sql!`select sent_to, body from outbox where user_id = 'chioma'`;
  assert.equal(msgs.length, 1);
  assert.equal(msgs[0].sent_to, "•••• 0142");
  assert.match(msgs[0].body, /REV-8101.*complete/);
  assert.doesNotMatch(msgs[0].body, /http|sign in|[?]|0123456789/i);
  assert.equal((await sql!`select active from case_watches where reference = 'REV-8101'`)[0].active, false, "closed cases stop being watched");
});

test("use case 17: a case past its expected date with no change gets one honest late update", { skip }, async () => {
  const { runUpdates } = await import("../lib/updates.ts");
  const s = await session("emeka", MONDAY, true);
  await call(s, "request_deferral", {});
  await confirmPending(s);
  await call(s, "request_deferral", {});
  const tenDays = new Date(MONDAY.getTime() + 10 * 86_400_000);
  await runUpdates(sql!, tenDays);
  await runUpdates(sql!, new Date(tenDays.getTime() + 2 * 86_400_000));
  const msgs = await sql!`select body from outbox where user_id = 'emeka'`;
  assert.equal(msgs.length, 1);
  assert.match(msgs[0].body, /taking longer than expected/);
});

test("use case 17: no proactive message to a customer on a review hold", { skip }, async () => {
  const { runUpdates, watch } = await import("../lib/updates.ts");
  const s = await session("lena", MONDAY);
  await call(s, "escalate_to_human", { trigger: "review_hold", urgency: "high", request: "Payout stuck", checked: "PO-88177 on hold", did: "None", needed: "Specialist review", told: "A specialist team will be in touch", flags: ["review hold"] });
  await sql!`update escalations set status = 'resolved' where business_id = 'northfield'`;
  await runUpdates(sql!, new Date(MONDAY.getTime() + 3_600_000));
  assert.equal((await sql!`select count(*)::int as n from outbox where user_id = 'lena'`)[0].n, 0);
  void watch;
});

// ---------------------------------------------------------------- use case 18: claim drafting

test("use case 18: a chargeback pack for Chioma's disputed charge, with its deadline, in the staff queue", { skip }, async () => {
  const { decide } = await import("../lib/staff.ts");
  await seed(sql!, MONDAY);
  const s = await session("chioma", MONDAY);
  await call(s, "open_dispute", { transaction_id: "TX-90012", reason: "not_mine" });
  await confirmPending(s);
  await call(s, "open_dispute", { transaction_id: "TX-90012", reason: "not_mine" });
  const out = await call(s, "draft_claim_pack", { kind: "chargeback", reference: "DSP-7001" });
  assert.equal(out.ok, true);
  const [claim] = await sql!`select reference, status, draft, escalation_reference from claim_drafts`;
  assert.equal(claim.status, "draft", "never sent by Alexis");
  assert.ok(claim.draft.facts.some(([k]: [string]) => k === "Filing deadline"));
  assert.ok(claim.draft.missing.length > 0, "missing items are marked, not guessed");
  assert.equal((await call(s, "draft_claim_pack", { kind: "chargeback", reference: "DSP-7001" })).ok, false, "once");
  const sent = await decide(sql!, claim.escalation_reference, "claim_sent", null);
  assert.equal(sent.ok, true);
  assert.equal((await sql!`select status from claim_drafts`)[0].status, "sent");
});

test("use case 18: a conflicting timeline is marked uncertain in a settlement query", { skip }, async () => {
  const s = await session("grace", MONDAY);
  await call(s, "draft_claim_pack", { kind: "settlement_query", reference: "PAY-62005" });
  const [claim] = await sql!`select draft from claim_drafts where subject = 'PAY-62005'`;
  assert.ok(claim.draft.missing.some((m: string) => /UNCERTAIN/.test(m)));
});

// ---------------------------------------------------------------- use case 19: staff mode

test("use case 19: only a supervisor approves; the approver is recorded by name", { skip }, async () => {
  const { decide, staffUser } = await import("../lib/staff.ts");
  await seed(sql!, MONDAY);
  const s = await session("ada", MONDAY);
  await call(s, "initiate_recall", { reference: "PO-88213" });
  await confirmPending(s);
  await call(s, "initiate_recall", { reference: "PO-88213" });
  const esc = await call(s, "escalate_to_human", { trigger: "recall_over_cap", urgency: "high", request: "Recall", checked: "PO-88213", did: "Prepared", needed: "Approve", told: "Needs approval" });
  const agent = await staffUser(sql!, "ife");
  const sup = await staffUser(sql!, "bayo");
  assert.equal((await decide(sql!, esc.reference!, "approve", null, agent)).ok, false);
  assert.equal((await decide(sql!, esc.reference!, "approve", null, sup)).ok, true);
  const [row] = await sql!`select summary, approver from audit_log where kind = 'approval' and conversation_id = ${s.conv.id}`;
  assert.equal(row.summary, "approved by Supervisor · recall on PO-88213");
  assert.equal(row.approver, "Bayo Martins (Supervisor)");
});

test("use case 19: staff mode looks up and drafts, never acts, and logs under the staff member", { skip }, async () => {
  const { toolDefinitions } = await import("../lib/tools.ts");
  const staffNames = toolDefinitions("staff").map((t) => (t as { name: string }).name);
  for (const forbidden of ["initiate_recall", "request_reversal", "waive_fee", "unlock_account", "open_dispute", "freeze_card", "verify_identity", "escalate_to_human"]) {
    assert.ok(!staffNames.includes(forbidden), forbidden);
  }
  const customerNames = toolDefinitions().map((t) => (t as { name: string }).name);
  assert.ok(!customerNames.includes("draft_reply"), "staff tools aren't offered to customers");

  const s = await session("lena", MONDAY);
  const esc = await call(s, "escalate_to_human", { trigger: "review_hold", urgency: "high", request: "Payout stuck", checked: "PO-88177 on hold", did: "None", needed: "Specialist review", told: "Specialist team will be in touch", flags: ["review hold"] });
  const staffConv = await sql!`insert into conversations (id, mode, staff_id, case_reference, verified_user_id, verified_at)
    values (${randomUUID()}, 'staff', 'ife', ${esc.reference!}, 'lena', ${MONDAY}) returning *`;
  const ctx = { sql: sql!, conv: staffConv[0] as Conversation, user: await verifiedUser(sql!, { ...(staffConv[0] as Conversation), last_activity: MONDAY }, MONDAY), now: MONDAY, toolUseId: randomUUID(), emit: () => {}, staff: "Ife Adeyemi (Support agent)" };
  const blocked = await runTool("initiate_recall", { reference: "PO-88177" }, ctx, "staff");
  assert.equal((blocked as ToolResult).ok, false);
  const reply = (await runTool("draft_reply", {}, ctx, "staff")) as ToolResult;
  assert.equal(reply.ok, true);
  assert.ok((reply.data as { rules: string[] }).rules.some((r) => /REVIEW HOLD/.test(r)), "no tipping off in drafted replies");
  const [logged] = await sql!`select staff, summary from audit_log where tool = 'draft_reply'`;
  assert.equal(logged.staff, "Ife Adeyemi (Support agent)");
  assert.match(logged.summary, /for Ife Adeyemi/);
});

// ---------------------------------------------------------------- use cases 3 (retail) and 13

test("planted 6-8: David's late transfer, the failed one already returned, and one above the personal cap", { skip }, async () => {
  await seed(sql!, MONDAY);
  const s = await session("david", MONDAY, true);
  const late = ((await call(s, "get_transfer_status", { reference: "PO-77501" })).data as { payouts: Record<string, unknown>[] }).payouts[0];
  assert.equal(late.late, true);
  const failed = ((await call(s, "get_transfer_status", { reference: "PO-77502" })).data as { payouts: Record<string, unknown>[] }).payouts[0];
  assert.match(String(failed.failure_reason), /returned to your account/);
  await call(s, "initiate_recall", { reference: "PO-77503" });
  await confirmPending(s);
  const over = await call(s, "initiate_recall", { reference: "PO-77503" });
  assert.match(over.reason!, /above the \$1,000 cap/);
});

test("use case 13: a personal recall needs the stronger check; a delivered wrong-recipient transfer is logged, then always handed off", { skip }, async () => {
  const standard = await session("amara", MONDAY);
  assert.match((await call(standard, "initiate_recall", { reference: "PO-77401" })).reason!, /stronger identity check/);
  const s = await session("amara", MONDAY, true);
  await call(s, "initiate_recall", { reference: "PO-77401" });
  await confirmPending(s);
  const out = await call(s, "initiate_recall", { reference: "PO-77401" });
  assert.equal(out.ok, true);
  assert.match((out.data as { note: string }).note, /Always hand off/);
});

// ---------------------------------------------------------------- use cases 14 and 16

test("use case 14: failed airtime is refunded once; a delivered token is shown; delivered can't be refunded", { skip }, async () => {
  await seed(sql!, MONDAY);
  const s = await session("amara", MONDAY, true);
  const list = (await call(s, "get_bill_payment_status", {})).data as { payments: Record<string, string>[] };
  assert.equal(list.payments.find((p) => p.id === "BP-30102")!.token, "4821-0937-5512-6640-2219");
  assert.equal(list.payments.find((p) => p.id === "BP-30101")!.paid_for, "•••• 0118");
  await call(s, "refund_bill_payment", { payment_id: "BP-30101" });
  await confirmPending(s);
  assert.equal((await call(s, "refund_bill_payment", { payment_id: "BP-30101" })).reference, "BRF-2201");
  assert.equal((await call(s, "refund_bill_payment", { payment_id: "BP-30101" })).reference, "BRF-2201", "once");
  assert.match((await call(s, "refund_bill_payment", { payment_id: "BP-30102" })).reason!, /delivered/);
  assert.match((await call(s, "refund_bill_payment", { payment_id: "BP-30103" })).reason!, /pending/);
});

test("use case 16: a USSD debit without value and a cash deposit at an agent, each routed to the right flow", { skip }, async () => {
  const s = await session("amara", MONDAY);
  const d = (await call(s, "get_ussd_session", {})).data as { sessions: Record<string, string>[] };
  const agent = d.sessions.find((x) => x.type === "Agent transaction")!;
  assert.match(agent.agent, /AGT-4471/);
  assert.match(agent.next, /hand off/);
  const ussd = d.sessions.find((x) => x.type === "USSD session")!;
  assert.match(ussd.next, /matching transfer or failed payment/);
});


// ---------------------------------------------------------------- the Cases screen

test("cases: category, status and urgency are worked out from what's recorded", () => {
  assert.equal(categoryOf(["verify_identity", "get_transfer_status", "initiate_recall"], []), "Payouts");
  assert.equal(categoryOf(["get_transfer_status"], ["formal_complaint"]), "Complaint", "a complaint handoff says more than the tools");
  assert.equal(categoryOf(["verify_identity"], []), "General question");
  assert.equal(categoryOf([], [], "My card payment failed and hasn't been working"), "Failed payments and reversals", "the customer's words before any lookup");
  assert.equal(categoryOf([], [], "Where is my payment to Lumen Print?"), "Payouts");
  assert.equal(categoryOf([], [], "I can't log in to the dashboard"), "Account access");
  assert.equal(categoryOf(["get_kyc_status"], []), "Verification (KYC)");
  assert.equal(categoryOf([], [], "Where is my KYC at?"), "Verification (KYC)");
  assert.equal(categoryOf(["get_card"], [], "My payment to Lumen Print failed"), "Cards", "a lookup outranks the words");
  assert.equal(categoryOf(["verify_identity"], ["payout_past_window"]), "Payouts", "a handoff with no lookups takes its reason's area");
  assert.equal(categoryOf(["find_incoming_payment"], ["payout_past_window"]), "Incoming payments", "what Alexis looked into comes first");
  const now = new Date("2026-11-23T12:00:00Z");
  const h = (status: string, urgency = "normal", action: { type?: string } | null = null) => ({ reference: "ESC-1", urgency, status, action, created_at: now });
  assert.equal(statusOf({ handoffs: [], waiting: false, lastActivity: new Date(now.getTime() - 60_000) }, now), "In progress");
  assert.equal(statusOf({ handoffs: [], waiting: false, lastActivity: new Date(now.getTime() - 60 * 60_000) }, now), "Resolved by Alexis");
  assert.equal(statusOf({ handoffs: [], waiting: true, lastActivity: new Date(now.getTime() - 60 * 60_000) }, now), "Waiting on customer");
  assert.equal(statusOf({ handoffs: [h("open")], waiting: false, lastActivity: now }, now), "Handed off");
  assert.equal(statusOf({ handoffs: [h("open", "high", { type: "recall" })], waiting: false, lastActivity: now }, now), "Needs approval");
  assert.equal(statusOf({ handoffs: [h("resolved")], waiting: false, lastActivity: now }, now), "Resolved by staff");
  assert.equal(urgencyOf([h("open", "normal"), h("open", "urgent"), h("open", "high")]), "urgent");
  assert.equal(urgencyOf([]), null);
});

test("cases: every conversation is listed, resolved by Alexis or handed off, with the counts", { skip }, async () => {
  await seed(sql!, MONDAY);
  const said = (q: string) => sql!.json([{ role: "user", content: q }, { role: "assistant", content: [{ type: "text", text: "Here's what I found." }] }] as never);
  const a = await session("ada", MONDAY);
  await call(a, "get_transfer_status", { recipient: "Lumen Print" });
  await sql!`update conversations set messages = ${said("Where is my payment to Lumen Print?")} where id = ${a.conv.id}`;
  const m = await session("maya", MONDAY);
  await call(m, "escalate_to_human", { request: "Payout late", checked: "PO-77310", did: "None", needed: "Chase", told: "The team will pick it up", trigger: "payout_past_window", urgency: "high" });
  await sql!`update conversations set messages = ${said("My payout is late")} where id = ${m.conv.id}`;
  const empty = await session("lena", MONDAY);
  const rows = await listCases(sql!, new Date(MONDAY.getTime() + 60 * 60_000));
  assert.equal(rows.length, 2, "a conversation with no messages isn't a case");
  assert.ok(!rows.some((r) => r.id === empty.conv.id));
  const ada = rows.find((r) => r.id === a.conv.id)!;
  assert.deepEqual([ada.status, ada.category, ada.urgency, ada.business, ada.firstMessage], ["Resolved by Alexis", "Payouts", null, "Brightline Studios Ltd", "Where is my payment to Lumen Print?"]);
  const maya = rows.find((r) => r.id === m.conv.id)!;
  assert.equal(maya.status, "Handed off");
  assert.equal(maya.category, "Payouts");
  assert.equal(maya.urgency, "high");
  assert.match(maya.references[0], /^ESC-/);
  assert.deepEqual(caseCounts(rows), { total: 2, open: 1, resolvedByAlexis: 1, handedOff: 1, urgentOpen: 0, withoutPerson: 50 });
});


// ---------------------------------------------------------------- the console: taking a conversation over

test("take over: turns stay alternating and staff replies reach the model as labelled text", () => {
  type M = Parameters<typeof appendTurn>[0];
  let m: M = [{ role: "user", content: "Hello" }];
  m = appendTurn(m, "user", [{ type: "text", text: "Anyone there?" }]);
  assert.equal(m.length, 1, "two customer messages in a row join one turn");
  m = appendTurn(m, "assistant", [{ type: "text", text: "Hi, I'm Ife.", staff: "Ife Adeyemi" }]);
  assert.deepEqual(m.map((x) => x.role), ["user", "assistant"]);
  const model = forModel(m);
  const block = (model[1].content as { text: string; staff?: string }[])[0];
  assert.equal(block.staff, undefined, "nothing extra reaches the model");
  assert.match(block.text, /^\[Reply from Ife Adeyemi, a member of the support team/);
  assert.deepEqual(transcriptOf(m as never).map((x) => x.who), ["Customer", "Ife Adeyemi"]);
});

test("session notes: kept after the history, never shown as chat, and a trailing one gives way to the next message", () => {
  type M = Parameters<typeof appendTurn>[0];
  const m: M = [{ role: "user", content: "Hello" }, { role: "system", content: "Session context: not verified" }, { role: "assistant", content: [{ type: "text", text: "Hi" }] }];
  assert.deepEqual(transcriptOf(m as never).map((x) => x.who), ["Customer", "Alexis"], "the session note isn't chat");
  const stopped: M = [{ role: "user", content: "Hello" }, { role: "system", content: "note" }];
  const next = appendTurn(stopped, "user", [{ type: "text", text: "Anyone?" }]);
  assert.deepEqual(next.map((x) => x.role), ["user"], "a note Alexis never answered is dropped, and the two messages join");
  const kept = appendTurn(m, "user", [{ type: "text", text: "Thanks" }]);
  assert.deepEqual(kept.map((x) => x.role), ["user", "system", "assistant", "user"], "earlier notes stay exactly where they were");
});

test("take over: Alexis pauses, the customer's messages wait for the team, and hand back returns it", { skip }, async () => {
  await seed(sql!, MONDAY);
  const ife = (await staffUser(sql!, "ife"))!;
  const bayo = (await staffUser(sql!, "bayo"))!;
  const s = await session(null, MONDAY);
  // Alexis asked for the identity form; it's still open when the team takes over.
  const history = [{ role: "user", content: "Where is my payout?" }, { role: "assistant", content: [{ type: "text", text: "Let me check who you are." }, { type: "tool_use", id: "tu_1", name: "verify_identity", input: {} }] }];
  await sql!`update conversations set messages = ${sql!.json(history as never)}, pending_identity_tool_id = 'tu_1', last_activity = now() where id = ${s.conv.id}`;
  assert.equal(await takeOver(sql!, s.conv.id, ife), null);
  assert.equal(await takeOver(sql!, s.conv.id, bayo), "taken_over_by_someone_else");
  const [c] = await sql!`select taken_over_by, pending_identity_tool_id, messages from conversations where id = ${s.conv.id}`;
  assert.equal(c.taken_over_by, "Ife Adeyemi");
  assert.equal(c.pending_identity_tool_id, null, "the open form is closed");
  assert.equal(c.messages[2].content[0].tool_use_id, "tu_1", "and its tool call answered, so the history stays valid");

  // The customer writes: stored for the team, no model call (no API key is set in tests).
  const events: { type: string }[] = [];
  await runTurn(sql!, { conversationId: s.conv.id, typingUserId: null, message: "Hello? My card is 4111 1111 1111 1111" }, (e) => events.push(e));
  assert.deepEqual(events.map((e) => e.type), ["masked", "taken_over", "done"]);
  assert.equal(await staffReply(sql!, s.conv.id, bayo, "Hi"), "taken_over_by_someone_else", "only the person who took over replies");
  assert.equal(await staffReply(sql!, s.conv.id, ife, "Hi, I'm Ife from the support team. I'll check this for you."), null);
  const view = await customerView(sql!, s.conv.id);
  assert.equal(view.takenOverBy, "Ife Adeyemi");
  assert.deepEqual(view.staff.map((x) => x.text), ["Hi, I'm Ife from the support team. I'll check this for you."]);
  const [after] = await sql!`select messages from conversations where id = ${s.conv.id}`;
  const t = transcriptOf(after.messages);
  assert.deepEqual(t.slice(-2).map((x) => x.who), ["Customer", "Ife Adeyemi"]);
  assert.ok(!JSON.stringify(after.messages).includes("4111 1111 1111 1111"), "the card number was masked before it was stored");
  const rows = await listCases(sql!);
  assert.equal(rows.find((r) => r.id === s.conv.id)!.status, "Taken over");

  assert.equal(await handBack(sql!, s.conv.id, bayo), "taken_over_by_someone_else");
  assert.equal(await handBack(sql!, s.conv.id, ife), null);
  assert.equal((await customerView(sql!, s.conv.id)).takenOverBy, null);
  const log = await sql!`select summary, staff from audit_log where conversation_id = ${s.conv.id} and staff is not null order by id`;
  assert.deepEqual(log.map((r) => r.summary), ["Ife Adeyemi (support agent) took over the conversation · Alexis paused", "Ife Adeyemi replied to the customer", "Ife Adeyemi handed the conversation back to Alexis"]);
});


// ---------------------------------------------------------------- hours-saved dashboard

test("dashboard: every category has a handling time, and time saved follows the rules", { skip }, async () => {
  const ids = new Set(RULE_SET.map((r) => r.id));
  for (const c of ["Payouts", "Incoming payments", "Verification (KYC)", "Balances", "Fees and limits", "Account access", "Cards", "Transactions and disputes", "Failed payments and reversals", "Payment tracing", "Loans", "Merchant payouts", "Airtime and bills", "USSD and agent banking", "Complaint", "Fraud and scams", "General question"]) {
    assert.ok(ids.has(timeRuleId(c)), `no handling time for ${c}`);
  }
  await seed(sql!, MONDAY);
  const rules = await Rules.load(sql!);
  const row = (status: string, category: string, references: string[] = []) => ({ id: randomUUID(), customer: null, business: null, verified: true, category, status, urgency: null, references, takenOverBy: null, started: MONDAY.toISOString(), lastActivity: MONDAY.toISOString(), messages: 2, firstMessage: null }) as never;
  const d = buildDashboard([row("Resolved by Alexis", "Payouts"), row("Resolved by Alexis", "Payouts"), row("Handed off", "Complaint", ["CMP-1"]), row("In progress", "Cards")], rules, MONDAY);
  assert.equal(d.totals.minutesSaved, 12 + 12 + 5, "two payouts resolved (12 each) and one handoff summary (5)");
  assert.equal(d.totals.costSaved, Math.round((29 / 60) * 15 * 100) / 100);
  assert.equal(d.totals.resolutionRate, 67);
  assert.equal(d.categories[0].category, "Payouts");
  await sql!`update rules set value = '30' where id = 'time_payouts'`;
  const again = buildDashboard([row("Resolved by Alexis", "Payouts")], await Rules.load(sql!), MONDAY);
  assert.equal(again.totals.minutesSaved, 30, "a Rules screen edit changes the dashboard");
});


// ---------------------------------------------------------------- rules management

test("rules: an agent's change waits for a supervisor; a supervisor's goes live; markets have their own values; undo", { skip }, async () => {
  await seed(sql!, MONDAY);
  const ife = (await staffUser(sql!, "ife"))!;
  const bayo = (await staffUser(sql!, "bayo"))!;
  const cap = async (market?: "NG" | "UK" | "US") => (await Rules.load(sql!, market)).num("waiver_cap_ngn", -1);
  assert.equal(await cap(), 2000);

  const p = await proposeChange(sql!, { ruleId: "waiver_cap_ngn", market: null, value: "3,000", staff: ife });
  assert.ok(p.ok && p.status === "pending");
  assert.equal(await cap(), 2000, "not live until approved");
  const again = await proposeChange(sql!, { ruleId: "waiver_cap_ngn", market: null, value: "4000", staff: bayo });
  assert.ok(!again.ok, "one waiting change per rule");
  assert.deepEqual((await decideChange(sql!, (p as { change: number }).change, ife, true)), { ok: false, error: "Only a supervisor or an operations admin can approve or decline rule changes." });
  assert.deepEqual(await decideChange(sql!, (p as { change: number }).change, bayo, true), { ok: true });
  assert.equal(await cap(), 3000);
  assert.equal((await pendingChanges(sql!)).length, 0);

  // Nigeria only: the default stays for everyone else, and the tools read the customer's market.
  const ng = await proposeChange(sql!, { ruleId: "waiver_cap_ngn", market: "NG", value: "5000", staff: bayo });
  assert.ok(ng.ok && ng.status === "live");
  assert.equal(await cap("NG"), 5000);
  assert.equal(await cap("UK"), 3000);
  assert.equal(await cap(), 3000);
  const back = await proposeChange(sql!, { ruleId: "waiver_cap_ngn", market: "NG", value: null, staff: bayo });
  assert.ok(back.ok);
  assert.equal(await cap("NG"), 3000, "back to the default");

  // Undo is a change like any other; the history keeps every step.
  const undo = await proposeChange(sql!, { ruleId: "waiver_cap_ngn", market: null, value: "2000", staff: bayo, source: "Restore" });
  assert.ok(undo.ok);
  assert.equal(await cap(), 2000);
  const h = await ruleHistory(sql!, "waiver_cap_ngn");
  assert.deepEqual(h.map((x) => [x.market, x.new_value, x.status]), [[null, "2000", "live"], ["NG", null, "live"], ["NG", "5000", "live"], [null, "3000", "live"]]);

  // A policy document's proposals wait even when a supervisor uploads it.
  const doc = await proposeChange(sql!, { ruleId: "dispute_window", market: null, value: "90", staff: bayo, source: "Policy: card-policy.pdf", note: "Disputes must be raised within 90 days.", review: true });
  assert.ok(doc.ok && doc.status === "pending");
  assert.equal((await Rules.load(sql!)).num("dispute_window", 0), 120);
  const log = await sql!`select summary, staff from audit_log where kind = 'rule_edit' order by id`;
  assert.ok(log.every((r) => r.staff), "every rule change names who made it");
});

test("policy upload: big changes need their own decision", { skip: false }, async () => {
  assert.equal(isBig("10000", "30000"), true, "tripled");
  assert.equal(isBig("1000", "1500"), false);
  assert.equal(isBig("120", "60"), true, "halved");
  assert.equal(isBig("5", "0"), true, "set to 0");
  assert.equal(isBig("on", "off"), true, "a switch flipped");
  assert.equal(isBig("on", "on"), false);
  assert.equal(isBig("Resolved within 72 hours", "Resolved within 48 hours"), false, "answer text is never big");
  assert.equal(isBig("1,000,000", "2,500,000"), true);
});

test("policy upload: Select all approves the ordinary ones; big changes and conflicts wait for their own decision", { skip }, async () => {
  await seed(sql!, MONDAY);
  const ife = (await staffUser(sql!, "ife"))!;
  const bayo = (await staffUser(sql!, "bayo"))!;
  const upload = { id: "u-1", document: "Product and fees policy 2026.pdf" };
  const fee = await proposeChange(sql!, { ruleId: "waiver_cap_ngn", market: null, value: "2500", staff: bayo, review: true, upload: { ...upload, page: "4" }, note: "Waivers up to ₦2,500." });
  const ng = await proposeChange(sql!, { ruleId: "card_limit_max_gbp", market: "UK", value: "9000", staff: bayo, review: true, upload });
  const big = await proposeChange(sql!, { ruleId: "card_limit_max_usd", market: null, value: "30000", staff: bayo, review: true, upload });
  assert.ok(fee.ok && !fee.big && ng.ok && !ng.big && big.ok && big.big);
  const conflict = await proposeConflict(sql!, { ruleId: "dispute_window", market: null, staff: bayo, upload,
    options: [{ value: "90", quote: "Customers may raise a dispute within 90 days.", page: "12" }, { value: "120", quote: "Disputes: 120 days.", page: "27" }] });
  assert.ok(conflict.ok);
  const same = await proposeConflict(sql!, { ruleId: "dispute_limit", market: null, staff: bayo, upload, options: [{ value: "3", quote: "a", page: null }, { value: "3", quote: "b", page: null }] });
  assert.ok(!same.ok, "two equal values are no conflict");
  const ids = (await pendingChanges(sql!)).map((c) => Number(c.id));
  assert.equal(ids.length, 4);
  const row = (await pendingChanges(sql!)).find((c) => c.rule_id === "waiver_cap_ngn")!;
  assert.equal(row.document, upload.document);
  assert.equal(row.page, "4");

  assert.deepEqual(await decideMany(sql!, ids, ife, true), { ok: false, error: "Only a supervisor or an operations admin can approve or decline rule changes." });
  const out = await decideMany(sql!, ids, bayo, true);
  assert.ok(out.ok);
  assert.equal(out.done.length, 2, "the two ordinary ones");
  assert.equal(out.skipped.length, 2, "the big change and the conflict are left");
  assert.equal((await Rules.load(sql!)).num("waiver_cap_ngn", 0), 2500);
  assert.equal((await Rules.load(sql!, "UK")).num("card_limit_max_gbp", 0), 9000);
  assert.equal((await Rules.load(sql!)).num("card_limit_max_usd", 0), 10000, "a big change isn't approved with Select all");

  // The conflict can't be approved as it stands; picking a value settles it.
  const c = (conflict as { change: number }).change;
  assert.ok(!(await decideChange(sql!, c, bayo, true)).ok);
  assert.ok(!(await resolveConflict(sql!, c, bayo, "60")).ok, "only the document's values");
  assert.deepEqual(await resolveConflict(sql!, c, bayo, "90"), { ok: true, status: "live" });
  assert.equal((await Rules.load(sql!)).num("dispute_window", 0), 90);
  const h = (await ruleHistory(sql!, "dispute_window"))[0];
  assert.equal(h.page, "12");
  assert.match(h.note!, /90 days/);

  // The big change on its own.
  assert.deepEqual(await decideChange(sql!, (big as { change: number }).change, bayo, false), { ok: true });
  assert.equal((await pendingChanges(sql!)).length, 0);
  const log = await sql!`select summary from audit_log where kind = 'rule_edit' order by id`;
  assert.ok(log.some((r) => /rule conflict resolved · Disputes can be opened up to · 120 → 90/.test(r.summary as string)));
});

test("rules: past conversations show where Alexis used a rule", { skip }, async () => {
  await seed(sql!, MONDAY);
  const s = await session("ada", MONDAY);
  await sql!`update conversations set messages = ${sql!.json([{ role: "user", content: "Where is it?" }] as never)} where id = ${s.conv.id}`;
  await call(s, "get_transfer_status", { recipient: "Lumen Print" });
  const used = await ruleImpact(sql!, "late_swift");
  assert.equal(used.length, 1);
  assert.equal(used[0].conversation_id, s.conv.id);
  assert.equal(used[0].business, "Brightline Studios Ltd");
});


// ---------------------------------------------------------------- channels

test("channels: a conversation keeps its channel and email subject, and the Inbox shows them", { skip }, async () => {
  await seed(sql!, MONDAY);
  const id = randomUUID();
  const c = await createConversation(sql!, id, "ada", "email", "Payment to Lumen Print");
  assert.equal(c.channel, "email");
  assert.equal(c.email_subject, "Payment to Lumen Print");
  const w = await createConversation(sql!, randomUUID(), "maya", "whatsapp", "ignored for chats");
  assert.equal(w.email_subject, null, "only emails have a subject");
  await sql!`update conversations set messages = ${sql!.json([{ role: "user", content: "Hello" }] as never)}`;
  const rows = await listCases(sql!);
  const e = rows.find((r) => r.id === id)!;
  assert.deepEqual([e.channel, e.subject], ["email", "Payment to Lumen Print"]);
  assert.equal(rows.find((r) => r.id === w.id)!.channel, "whatsapp");
});


// ---------------------------------------------------------------- operations

test("operations: with Alexis switched off, messages wait for the team; switching her on lets her carry on", { skip }, async () => {
  await seed(sql!, MONDAY);
  const s = await session(null, MONDAY);
  // She had asked for the identity form when she was switched off.
  const history = [{ role: "user", content: "Where is my payout?" }, { role: "assistant", content: [{ type: "text", text: "First, who am I speaking with?" }, { type: "tool_use", id: "tu_9", name: "verify_identity", input: {} }] }];
  await sql!`update conversations set messages = ${sql!.json(history as never)}, pending_identity_tool_id = 'tu_9', last_activity = now() where id = ${s.conv.id}`;
  await sql!`update rules set value = 'off' where id = 'alexis_enabled'`;
  assert.equal((await operations(sql!)).alexisOn, false);
  const events: { type: string; message?: string }[] = [];
  await runTurn(sql!, { conversationId: s.conv.id, typingUserId: null, message: "Hello?" }, (e) => events.push(e));
  assert.deepEqual(events.map((e) => e.type), ["team_queue", "done"], "no model call (no API key in tests)");
  const [c] = await sql!`select awaiting_team, pending_identity_tool_id, messages from conversations where id = ${s.conv.id}`;
  assert.equal(c.awaiting_team, "switched_off");
  assert.equal(c.pending_identity_tool_id, null, "the open form was closed");
  assert.equal(c.messages[2].content[0].tool_use_id, "tu_9", "with its tool call answered, so the history stays valid");
  assert.equal(c.messages[2].content.at(-1).text, "Hello?");
  assert.equal((await listCases(sql!)).find((r) => r.id === s.conv.id)!.status, "Waiting for the team");
  // Taking it over clears the wait.
  assert.equal(await takeOver(sql!, s.conv.id, (await staffUser(sql!, "ife"))!), null);
  assert.equal((await sql!`select awaiting_team from conversations where id = ${s.conv.id}`)[0].awaiting_team, null);
});

test("operations: outage mode gives the notice; a returning customer finds their case by reference, only their own", { skip }, async () => {
  await seed(sql!, MONDAY);
  assert.equal((await operations(sql!)).outage, null);
  await sql!`update rules set value = 'on' where id = 'outage_mode'`;
  assert.match((await operations(sql!)).outage!, /delayed/);

  const first = await session("ada", MONDAY);
  const base = { request: "Payout to Castellan is late", checked: "PO-88102 past window", did: "None", needed: "Chase the bank", told: "The team will pick it up" };
  const esc = await call(first, "escalate_to_human", { ...base, trigger: "payout_past_window", urgency: "high" });
  const back = await session("ada", MONDAY);
  const found = await call(back, "find_case", { reference: ` ${esc.reference!.toLowerCase()} ` });
  assert.ok(found.ok);
  assert.equal((found.data as { status: string }).status, "With the team");
  assert.equal((found.data as { about: string }).about, "Payout to Castellan is late");
  const other = await session("maya", MONDAY);
  assert.equal((await call(other, "find_case", { reference: esc.reference! })).ok, false, "another business's case isn't found");
  const anon = await session(null, MONDAY);
  assert.equal((await call(anon, "find_case", { reference: esc.reference! })).ok, false, "identity first");
});

test("operations: a review is saved, logged under the reviewer and shown in the Inbox", { skip }, async () => {
  await seed(sql!, MONDAY);
  const { saveReview } = await import("../lib/review.ts");
  const s = await session("ada", MONDAY);
  await sql!`update conversations set messages = ${sql!.json([{ role: "user", content: "Hi" }] as never)}, language = 'fr' where id = ${s.conv.id}`;
  assert.equal(await saveReview(sql!, s.conv.id, (await staffUser(sql!, "bayo"))!, "needs_work", "Should have offered the proof of payment"), null);
  const row = (await listCases(sql!)).find((r) => r.id === s.conv.id)!;
  assert.deepEqual(row.review, { rating: "needs_work", note: "Should have offered the proof of payment", by: "Bayo Martins" });
  assert.equal(row.language, "fr");
  const log = await sql!`select summary, staff from audit_log where conversation_id = ${s.conv.id} and tool = 'review'`;
  assert.equal(log[0].staff, "Bayo Martins");
});


// ---------------------------------------------------------------- KYC tiers per country

test("KYC tiers: Nigeria explains its tiers; the UK and US have none; each country's values are editable", { skip }, async () => {
  await seed(sql!, MONDAY);
  const chioma = await session("chioma", MONDAY);
  const ng = (await call(chioma, "get_account_limits", {})).data as Record<string, string>;
  assert.equal(ng.tier, "Tier 1");
  assert.equal(ng.single_transfer_limit, "₦50,000.00");
  assert.match(ng.to_move_up, /^Tier 2: Link your BVN or NIN/);
  assert.match(ng.how_tiers_work, /three tiers/);
  const grace = await session("grace", MONDAY);
  const uk = (await call(grace, "get_account_limits", {})).data as Record<string, string>;
  assert.equal(uk.tier, "No numbered tiers in this country");
  assert.match(uk.how_verification_works, /no numbered tiers/i);
  const david = await session("david", MONDAY);
  const us = (await call(david, "get_kyc_status", {})).data as Record<string, string>;
  assert.match(us.how_verification_works, /no numbered tiers/i);
  assert.equal(us.account_tier, undefined, "no tier talk where tiers aren't used");
  const ngKyc = (await call(chioma, "get_kyc_status", {})).data as Record<string, string>;
  assert.equal(ngKyc.account_tier, "Tier 1");
  // A supervisor switches tiers on for the UK only, with its own currency: UK customers get them, others don't change.
  const bayo = (await staffUser(sql!, "bayo"))!;
  assert.ok((await proposeChange(sql!, { ruleId: "kyc_tiers_used", market: "UK", value: "on", staff: bayo })).ok);
  assert.ok((await proposeChange(sql!, { ruleId: "tier_currency", market: "UK", value: "GBP", staff: bayo })).ok);
  await sql!`update businesses set kyc_tier = 2 where id = 'grace'`;
  const ukNow = (await call(grace, "get_account_limits", {})).data as Record<string, string>;
  assert.equal(ukNow.tier, "Tier 2");
  assert.match(ukNow.single_transfer_limit, /^£/);
  assert.equal(((await call(david, "get_account_limits", {})).data as Record<string, string>).tier, "No numbered tiers in this country");
});


// ---------------------------------------------------------------- Bank Connector API

test("bank connector: the tools give the same answers over HTTP as from the simulated bank", { skip }, async () => {
  const http = await import("node:http");
  const { simulatedBank } = await import("../lib/bank/simulated.ts");
  const { serveBank } = await import("../lib/bank/serve.ts");
  await seed(sql!, MONDAY);
  const KEY = "test-bank-key";
  const calls: string[] = [];
  const server = http.createServer(async (req, res) => {
    let raw = "";
    for await (const c of req) raw += c;
    const url = new URL(req.url!, "http://x");
    calls.push(`${req.method} ${url.pathname}`);
    if (req.headers.authorization !== `Bearer ${KEY}`) { res.writeHead(401).end("{}"); return; }
    const path = url.pathname.replace(/^\/v1\//, "").split("/").filter(Boolean).map(decodeURIComponent);
    const out = await serveBank(simulatedBank(sql!), req.method!, path, url.searchParams, raw ? JSON.parse(raw) : null, (req.headers["idempotency-key"] as string) ?? null);
    res.writeHead(out.status, { "Content-Type": "application/json" }).end(JSON.stringify(out.body));
  });
  await new Promise<void>((r) => server.listen(0, r));
  const port = (server.address() as { port: number }).port;
  const run = async () => {
    const s = await session("ada", MONDAY);
    const out = {
      transfer: (await call(s, "get_transfer_status", { recipient: "Lumen Print" })).data,
      restrictions: (await call(s, "get_account_restrictions", {})).data,
      kyc: (await call(s, "get_kyc_status", {})).data,
      balances: ((await call(s, "get_balance", {})).data as { balances: unknown }).balances,
      fees: (await call(s, "get_fees", {})).data,
      incoming: (await call(await session("maya", MONDAY), "find_incoming_payment", { amount: 2750, currency: "GBP", payer: "Ashby" })).data,
      held: (await call(await session("lena", MONDAY), "get_transfer_status", { recipient: "Varga" })).data,
      identity: await checkIdentity(sql!, { full_name: "Ada Okafor", date_of_birth: "1988-03-14", registration_number: "11482037" }),
      // The other areas (Tomi, Nov 23: "extend the bank connector to other areas").
      card: (await call(await session("emeka", MONDAY), "get_card", {})).data,
      transactions: (await call(await session("grace", MONDAY), "list_transactions", { merchant: "Hollow Tree" })).data,
      payments: (await call(await session("chioma", MONDAY), "find_payments", { amount: 18750 })).data,
      reversal: (await call(await session("chioma", MONDAY), "get_reversal_status", { payment_id: "PAY-61001" })).data,
      paymentById: (await call(await session("grace", MONDAY), "get_payment_by_id", { transaction_id: "PAY-62003" })).data,
      elsewhere: (await call(await session("grace", MONDAY), "get_payment_by_id", { transaction_id: "PAY-61001" })).reason,
      timeline: (await call(await session("grace", MONDAY), "get_payment_timeline", { transaction_id: "PAY-62004" })).data,
      loan: (await call(await session("david", MONDAY), "get_loan", {})).data,
      payout: (await call(await session("chidi", MONDAY), "get_payout_status", { payout_id: "PY-21007" })).data,
      heldPayout: (await call(await session("kemi", MONDAY), "get_payout_status", {})).data,
      holds: (await call(await session("kemi", MONDAY), "list_holds", {})).data,
      bills: (await call(await session("amara", MONDAY), "get_bill_payment_status", {})).data,
      ussd: (await call(await session("amara", MONDAY), "get_ussd_session", {})).data,
      limits: (await call(await session("amara", MONDAY), "get_account_limits", {})).data,
    };
    return out;
  };
  const local = await run();
  process.env.BANK_API_URL = `http://127.0.0.1:${port}/v1`;
  process.env.BANK_API_KEY = KEY;
  try {
    const remote = await run();
    assert.deepEqual(remote, local, "every answer is the same through the contract");
    assert.ok(calls.some((c) => c === "GET /v1/holders/brightline/transfers"), "the tools really called the bank");
    assert.ok(calls.some((c) => c === "POST /v1/identity/verify"));
    assert.ok(calls.some((c) => c.startsWith("GET /v1/users/")), "the verified customer's profile comes from the bank");
    // A recall within the cap is submitted to the bank, with the reference as the idempotency key.
    const s = await session("ada", MONDAY);
    await call(s, "initiate_recall", { reference: "PO-88150" });
    await confirmPending(s);
    const r = await call(s, "initiate_recall", { reference: "PO-88150" });
    assert.ok(r.ok, JSON.stringify(r));
    assert.ok(calls.some((c) => c === "POST /v1/holders/brightline/recalls"));
    for (const path of ["/cards", "/card-transactions", "/payments", "/payments/PAY-62004/events", "/loans", "/merchant-payouts", "/merchant-holds", "/bill-payments", "/ussd-sessions"]) {
      assert.ok(calls.some((c) => c.startsWith("GET /v1/holders/") && c.endsWith(path)), `the tools read ${path} from the bank`);
    }

    // The actions go to the bank too: freeze a card, refund a failed airtime payment, unlock online access, waive a fee.
    const emeka = await session("emeka", MONDAY, true);
    await call(emeka, "freeze_card", {});
    await confirmPending(emeka);
    assert.ok((await call(emeka, "freeze_card", {})).ok);
    assert.ok(calls.some((c) => c === "POST /v1/holders/emeka/cards/CARD-7710/freeze"));
    const [card] = await sql!<{ status: string }[]>`select status from cards where id = 'CARD-7710'`;
    assert.equal(card.status, "frozen", "the bank froze the card");
    await call(emeka, "unfreeze_card", {});
    await confirmPending(emeka);
    assert.ok((await call(emeka, "unfreeze_card", {})).ok);
    assert.ok(calls.some((c) => c === "POST /v1/holders/emeka/cards/CARD-7710/unfreeze"));
    await call(emeka, "change_card_settings", { contactless: false });
    await confirmPending(emeka);
    assert.ok((await call(emeka, "change_card_settings", { contactless: false })).ok);
    assert.ok(calls.some((c) => c === "POST /v1/holders/emeka/cards/CARD-7710/settings"));
    assert.equal((await sql!`select contactless from cards where id = 'CARD-7710'`)[0].contactless, false, "the bank changed the setting");
    await call(emeka, "unlock_account", {});
    await confirmPending(emeka);
    assert.ok((await call(emeka, "unlock_account", {})).ok);
    assert.ok(calls.some((c) => c === "POST /v1/users/emeka/unlock"));
    assert.ok(calls.some((c) => c === "GET /v1/users/emeka/contact"));
    const amara = await session("amara", MONDAY, true);
    await call(amara, "refund_bill_payment", { payment_id: "BP-30101" });
    await confirmPending(amara);
    const refund = await call(amara, "refund_bill_payment", { payment_id: "BP-30101" });
    assert.ok(refund.ok, JSON.stringify(refund));
    assert.ok(calls.some((c) => c === "POST /v1/holders/amara/bill-payments/BP-30101/refund"));
    const [bill] = await sql!<{ status: string; refund_reference: string }[]>`select status, refund_reference from bill_payments where id = 'BP-30101'`;
    assert.deepEqual(bill, { status: "refunded", refund_reference: refund.reference }, "the bank recorded Orchestra's reference");
  } finally {
    delete process.env.BANK_API_URL;
    delete process.env.BANK_API_KEY;
    server.close();
  }
});


test("bank connector: the OpenAPI file and the reference server list the same endpoints", async () => {
  const fs = await import("node:fs");
  const yaml = fs.readFileSync(new URL("../public/openapi/bank-connector-v1.yaml", import.meta.url), "utf8");
  const paths = [...yaml.matchAll(/^  (\/[^:]+):$/gm)].map((m) => m[1]).sort();
  assert.deepEqual(paths, [
    "/holders/{holderId}/balances", "/holders/{holderId}/bill-payments", "/holders/{holderId}/bill-payments/{billPaymentId}/refund",
    "/holders/{holderId}/card-transactions", "/holders/{holderId}/cards", "/holders/{holderId}/cards/{cardId}/freeze",
    "/holders/{holderId}/cards/{cardId}/replace", "/holders/{holderId}/cards/{cardId}/settings", "/holders/{holderId}/cards/{cardId}/unfreeze", "/holders/{holderId}/fees", "/holders/{holderId}/fees/{feeId}/refund",
    "/holders/{holderId}/incoming-payments", "/holders/{holderId}/loans", "/holders/{holderId}/merchant-holds",
    "/holders/{holderId}/merchant-payouts", "/holders/{holderId}/payments", "/holders/{holderId}/payments/{paymentId}",
    "/holders/{holderId}/payments/{paymentId}/events", "/holders/{holderId}/recalls", "/holders/{holderId}/restrictions",
    "/holders/{holderId}/transfers", "/holders/{holderId}/ussd-sessions", "/holders/{holderId}/verification", "/identity/verify",
    "/users", "/users/{userId}", "/users/{userId}/contact", "/users/{userId}/unlock",
  ]);
  const served = fs.readFileSync(new URL("../lib/bank/serve.ts", import.meta.url), "utf8");
  for (const p of paths) {
    const last = p.split("/").filter((x) => x && !x.startsWith("{")).pop()!;
    assert.ok(served.includes(`"${last}"`), `the reference server handles ${p}`);
  }
});

// ---------------------------------------------------------------- the Orchestra API (step 2)

test("Orchestra API: keys are shown once, stored as a hash, and stop working when revoked", { skip }, async () => {
  const { createApiKey, checkApiKey, revokeApiKey } = await import("../lib/api/keys.ts");
  await seed(sql!, MONDAY);
  const k = await createApiKey(sql!, "Nuvion app", "Bayo Martins");
  assert.match(k.key, /^orc_[A-Za-z0-9]{8}_/);
  const [row] = await sql!`select hash, prefix from api_keys where id = ${k.id}`;
  assert.ok(!JSON.stringify(row).includes(k.key.split("_")[2]), "the key itself isn't stored");
  assert.deepEqual(await checkApiKey(sql!, `Bearer ${k.key}`), { id: k.id, name: "Nuvion app" });
  assert.equal(await checkApiKey(sql!, `Bearer ${k.key}x`), null);
  assert.equal(await checkApiKey(sql!, "Bearer nonsense"), null);
  assert.ok(await revokeApiKey(sql!, k.id));
  assert.equal(await checkApiKey(sql!, `Bearer ${k.key}`), null, "revoked");
});

test("Orchestra API: webhooks are signed and sent for a handoff and the team's decision", { skip }, async () => {
  const { setWebhookFetcher, signature, webhookUrlProblem } = await import("../lib/api/webhooks.ts");
  const { decide } = await import("../lib/staff.ts");
  await seed(sql!, MONDAY);
  assert.equal(webhookUrlProblem("http://crm.example/hook"), "Use an https:// address.");
  assert.match(webhookUrlProblem("https://localhost/hook")!, /public/);
  assert.match(webhookUrlProblem("https://10.0.0.5/hook")!, /private/);
  assert.equal(webhookUrlProblem("https://crm.example/hook"), null);
  const secret = "whsec_test";
  await sql!`delete from webhook_endpoints where id = 'wh_test'`;
  await sql!`insert into webhook_endpoints (id, url, secret, events, created_by) values ('wh_test', 'https://crm.example/hook', ${secret}, ${["case.created", "case.updated"]}, 'test')`;
  const got: { headers: Record<string, string>; body: string }[] = [];
  setWebhookFetcher((async (_url: string, init: { headers: Record<string, string>; body: string }) => { got.push({ headers: init.headers, body: init.body }); return new Response("ok", { status: 200 }); }) as never);
  try {
    const s = await session("ada", MONDAY);
    const esc = await call(s, "escalate_to_human", { request: "Payout late", checked: "PO-88102", did: "None", needed: "Chase", told: "The team will pick it up", trigger: "payout_past_window", urgency: "high" });
    const waitFor = async (n: number) => { for (let i = 0; i < 50 && got.length < n; i++) await new Promise((r) => setTimeout(r, 20)); };
    await waitFor(1);
    const first = JSON.parse(got[0].body);
    assert.equal(first.type, "case.created");
    assert.equal(first.data.reference, esc.reference);
    const sig = got[0].headers["Orchestra-Signature"];
    const t = Number(sig.match(/t=(\d+)/)![1]);
    assert.equal(sig, signature(secret, got[0].body, t), "the receiver can check the signature");
    assert.equal((await decide(sql!, esc.reference!, "resolve", "Chased and arrived", (await staffUser(sql!, "ife"))!)).ok, true);
    await waitFor(2);
    assert.equal(JSON.parse(got[1].body).type, "case.updated");
    const rows = await sql!`select status from webhook_deliveries order by id`;
    assert.deepEqual(rows.map((r) => r.status), ["delivered", "delivered"]);
  } finally {
    setWebhookFetcher(null);
    await sql!`delete from webhook_endpoints where id = 'wh_test'`;
  }
});

test("Orchestra API: events change a status once; the Channel API opens a signed-in conversation and queues for the team when Alexis is off", { skip }, async () => {
  const { receiveEvent } = await import("../lib/api/events.ts");
  const { openConversation, sendToAlexis, conversationMessages } = await import("../lib/api/channel.ts");
  await seed(sql!, MONDAY);
  assert.deepEqual(await receiveEvent(sql!, { id: "e1", type: "verification.updated", data: { holder_id: "harbour", status: "approved" } }), { ok: true, applied: true });
  assert.equal((await sql!`select verification_status from businesses where id = 'harbour'`)[0].verification_status, "approved");
  assert.deepEqual(await receiveEvent(sql!, { id: "e1", type: "verification.updated", data: { holder_id: "harbour", status: "failed" } }), { ok: true, applied: false, duplicate: true }, "the same event id applies once");
  assert.equal((await receiveEvent(sql!, { id: "e2", type: "card.exploded", data: {} })).ok, false);
  assert.equal((await receiveEvent(sql!, { id: "e3", type: "recall.updated", data: { reference: "REC-0000", status: "approved" } }) as { error: string }).error, "not_found");
  assert.equal((await receiveEvent(sql!, { id: "e4", type: "recall.updated", data: { reference: "x", status: "teleported" } }) as { error: string }).error, "bad_status");

  const opened = await openConversation(sql!, { channel: "whatsapp", verified_user_id: "ada", external_ref: "wa:+447700900123", language: "fr" });
  assert.ok("conversation_id" in opened);
  assert.match(opened.greeting!, /^Bonjour/);
  const [c] = await sql!`select verified_user_id, channel, language, external_ref from conversations where id = ${opened.conversation_id}`;
  assert.deepEqual([c.verified_user_id, c.channel, c.language, c.external_ref], ["ada", "whatsapp", "fr", "wa:+447700900123"], "a customer the bank's app signed in arrives verified");
  assert.deepEqual(await openConversation(sql!, { verified_user_id: "nobody" }), { error: "unknown_user" });
  await sql!`update rules set value = 'off' where id = 'alexis_enabled'`;
  const r = await sendToAlexis(sql!, opened.conversation_id, { text: "Where is my payment to Lumen Print?" });
  assert.equal(r.reply, null);
  assert.match(r.notices[0], /switched off/);
  const m = await conversationMessages(sql!, opened.conversation_id);
  assert.equal(m!.waiting_for_team, true);
  assert.deepEqual(m!.messages.map((x) => [x.from, x.text]), [["customer", "Where is my payment to Lumen Print?"]]);
});

test("Orchestra API: the OpenAPI file's paths and webhook events match the routes and the events sent", async () => {
  const fs = await import("node:fs");
  const { WEBHOOK_EVENTS } = await import("../lib/api/webhooks.ts");
  const yaml = fs.readFileSync(new URL("../public/openapi/orchestra-api-v1.yaml", import.meta.url), "utf8");
  const [paths, hooks] = yaml.split(/^webhooks:$/m);
  const listed = [...paths.matchAll(/^  (\/[^:]+):$/gm)].map((m) => m[1]);
  const route = (p: string) => new URL(`../app/api/v1${p.replace("{conversationId}", "[id]").replace("{kind}", "[kind]")}/route.ts`, import.meta.url);
  for (const p of listed) assert.ok(fs.existsSync(route(p)), `a route serves ${p}`);
  const events = [...hooks.matchAll(/^  ([a-z_]+\.[a-z_]+):$/gm)].map((m) => m[1]).sort();
  assert.deepEqual(events, [...WEBHOOK_EVENTS].sort(), "every event Orchestra sends is documented");
});

// ---------------------------------------------------------------- smart routing and drafted replies (Nov 23)

test("routing: a handoff goes to the team its category is routed to; picking up, moving and overdue cases", { skip }, async () => {
  const { pickUp, moveTeam, flagOverdue, teams } = await import("../lib/routing.ts");
  await seed(sql!, MONDAY);
  const base = { request: "Card won't work", checked: "get_card", did: "None", needed: "Look at the card", told: "The team will pick it up" };
  const s = await session("emeka", MONDAY);
  await call(s, "get_card", {});
  const esc = await call(s, "escalate_to_human", { ...base, trigger: "card_problem", urgency: "normal" });
  const [e] = await sql!<{ team: string }[]>`select team from escalations where reference = ${esc.reference!}`;
  assert.equal(e.team, "Cards team", "a card problem goes to the Cards team");
  // The institution routes cards elsewhere: new handoffs follow.
  await sql!`update rules set value = 'Card operations' where id = 'route_cards'`;
  const grace = await session("grace", MONDAY);
  await call(grace, "get_card", {});
  const esc2 = await call(grace, "escalate_to_human", { ...base, trigger: "card_problem", urgency: "normal" });
  assert.equal((await sql!<{ team: string }[]>`select team from escalations where reference = ${esc2.reference!}`)[0].team, "Card operations");
  assert.ok((await teams(sql!)).includes("Card operations"));
  await sql!`update rules set value = 'Cards team' where id = 'route_cards'`;

  const ife = { id: "ife", name: "Ife Adeyemi", role: "support_agent" as const };
  const bayo = { id: "bayo", name: "Bayo Martins", role: "supervisor" as const };
  assert.equal(await pickUp(sql!, esc.reference!, ife), null);
  assert.equal(await pickUp(sql!, esc.reference!, bayo), "already_assigned", "one person at a time");
  assert.equal(await moveTeam(sql!, esc2.reference!, "Nobody's team", bayo), "unknown_team");
  assert.equal(await moveTeam(sql!, esc2.reference!, "Payments team", bayo), null);
  assert.equal((await sql!<{ team: string }[]>`select team from escalations where reference = ${esc2.reference!}`)[0].team, "Payments team");

  // Past the response target: the unattended one is flagged and raised; the picked-up one isn't.
  await sql!`update escalations set respond_by = ${new Date(MONDAY.getTime() - 3_600_000)} where reference in (${esc.reference!}, ${esc2.reference!})`;
  const flagged = await flagOverdue(sql!, MONDAY);
  assert.deepEqual(flagged, [esc2.reference]);
  const [late] = await sql!<{ urgency: string; overdue_at: Date | null }[]>`select urgency, overdue_at from escalations where reference = ${esc2.reference!}`;
  assert.equal(late.urgency, "high", "one step more urgent");
  assert.ok(late.overdue_at);
  assert.deepEqual(await flagOverdue(sql!, MONDAY), [], "flagged once");
  const logged = await sql!`select summary from audit_log where tool = 'routing' and summary like ${`${esc2.reference}%`}`;
  assert.ok(logged.some((r) => /passed its response target/.test(r.summary)));
});

test("drafted replies: a draft from the case for the team to edit, review-hold wording when held, nothing sent", { skip }, async () => {
  const { draftReply } = await import("../lib/drafting.ts");
  await seed(sql!, MONDAY);
  const s = await session("lena", MONDAY);
  await call(s, "get_transfer_status", { recipient: "Varga" });
  await call(s, "escalate_to_human", { trigger: "review_hold", urgency: "high", request: "Payout stuck", checked: "On hold", did: "None", needed: "Specialist review", told: "A specialist team will be in touch", flags: ["review hold"] });
  await sql!`update conversations set messages = ${sql!.json([{ role: "user", content: "Where is my payment to Varga?" }, { role: "assistant", content: [{ type: "text", text: "It's with a specialist team." }] }] as never)} where id = ${s.conv.id}`;
  let seen: { system?: unknown; messages: { content: unknown }[] } | null = null;
  const fake = async (body: unknown) => { seen = body as typeof seen; return { content: [{ type: "text", text: "Hi Lena, this is Ife from the support team." }] }; };
  const before = (await sql!`select messages from conversations where id = ${s.conv.id}`)[0].messages;
  const out = await draftReply(sql!, s.conv.id, { id: "ife", name: "Ife Adeyemi", role: "support_agent" }, "tell her it's still being reviewed", fake);
  assert.deepEqual(out, { draft: "Hi Lena, this is Ife from the support team." });
  assert.match(String(seen!.system), /REVIEW HOLD: say only/, "the review-hold rule goes with a held case");
  assert.match(String(seen!.messages[0].content), /Customer: Lena/);
  assert.match(String(seen!.messages[0].content), /still being reviewed/);
  assert.deepEqual((await sql!`select messages from conversations where id = ${s.conv.id}`)[0].messages, before, "a draft sends nothing");
  assert.equal((await sql!`select count(*)::int as n from audit_log where conversation_id = ${s.conv.id} and tool = 'draft_reply'`)[0].n, 1);
});

// ---------------------------------------------------------------- staff actions (Nov 23)

test("staff actions: a supervisor lifts a bank freeze after the code and the customer's yes in the app; an agent can't", { skip }, async () => {
  const { runStaffAction } = await import("../lib/staffActions.ts");
  await seed(sql!, MONDAY);
  const now = new Date();
  const ife = (await staffUser(sql!, "ife"))!;
  const bayo = (await staffUser(sql!, "bayo"))!;
  await sql!`update cards set status = 'frozen', frozen_by = 'bank' where id = 'CARD-7710'`;
  const s = await session("emeka", now);
  const id = s.conv.id;
  await sql!`update conversations set mode = 'customer' where id = ${id}`;
  assert.equal((await runStaffAction(sql!, id, ife, "unfreeze_card", {})).status, "error", "take it over first");
  assert.equal(await takeOver(sql!, id, ife), null);
  const agent = await runStaffAction(sql!, id, ife, "unfreeze_card", {});
  assert.equal(agent.status, "needs_code", "the code first");
  await sql!`update conversations set stronger_verified_at = now() where id = ${id}`;
  const agent2 = await runStaffAction(sql!, id, ife, "unfreeze_card", {});
  assert.equal(agent2.status, "refused");
  assert.match((agent2 as { message: string }).message, /Only a supervisor can lift a bank freeze/);
  await sql!`update conversations set stronger_verified_at = null where id = ${id}`;
  assert.equal(await handBack(sql!, id, ife), null);
  assert.equal(await takeOver(sql!, id, bayo), null);

  // The stronger check: the code goes to the phone on file and the customer types it in their app.
  const sent = await runStaffAction(sql!, id, bayo, "unfreeze_card", {}, { sendCode: true });
  assert.equal(sent.status, "code_sent");
  const view = await customerView(sql!, id);
  assert.ok(view.pendingCode, "the customer app shows the code form");
  const evs: StreamEvent[] = [];
  await runTurn(sql!, { conversationId: id, typingUserId: null, code: "000000" === view.pendingCode!.code ? "111111" : "000000" }, (e) => evs.push(e));
  assert.ok(evs.some((e) => e.type === "code_retry"), "a wrong code can be tried again");
  await runTurn(sql!, { conversationId: id, typingUserId: null, code: view.pendingCode!.code }, () => {});
  assert.ok((await sql!`select stronger_verified_at from conversations where id = ${id}`)[0].stronger_verified_at, "stronger check passed");

  // The customer's yes, in their app.
  const asked = await runStaffAction(sql!, id, bayo, "unfreeze_card", {});
  assert.equal(asked.status, "waiting_customer");
  assert.equal((await sql!`select status from cards where id = 'CARD-7710'`)[0].status, "frozen", "nothing before the yes");
  const pending = (await customerView(sql!, id)).pendingAction;
  assert.ok(pending && pending.by === "Bayo Martins" && /Unfreeze the card ending 7710/.test(pending.action));
  await runTurn(sql!, { conversationId: id, typingUserId: null, message: "Yes, go ahead", confirm: true }, () => {});
  assert.equal((await sql!`select status from cards where id = 'CARD-7710'`)[0].status, "active", "the bank freeze is lifted");
  const told = (await customerView(sql!, id)).staff.map((m) => m.text);
  assert.ok(told.some((t) => /^Bayo from the support team unfroze your card \(reference CHG-\d+\)\.$/.test(t)), told.join(" | "));
  const log = await sql!`select summary from audit_log where conversation_id = ${id} and tool = 'unfreeze_card' and kind = 'action'`;
  assert.ok(log.some((r) => /by Bayo Martins/.test(r.summary)), "logged under the supervisor's name");
});

test("staff actions: an agent's limit, a second supervisor above the higher one, and the customer can cancel", { skip }, async () => {
  const { runStaffAction } = await import("../lib/staffActions.ts");
  const { decide } = await import("../lib/staff.ts");
  await seed(sql!, MONDAY);
  await sql!`insert into staff_users (id, name, role) values ('zara', 'Zara Okon', 'supervisor') on conflict do nothing`;
  const now = new Date();
  const ife = (await staffUser(sql!, "ife"))!;
  const bayo = (await staffUser(sql!, "bayo"))!;
  const zara = (await staffUser(sql!, "zara"))!;
  const s = await session("ada", now);
  const id = s.conv.id;
  await sql!`update conversations set mode = 'customer' where id = ${id}`;
  await takeOver(sql!, id, ife);
  // PO-88150 is $3,200: above a support agent's $2,000.
  const agent = await runStaffAction(sql!, id, ife, "initiate_recall", { reference: "PO-88150" });
  assert.equal(agent.status, "needs_supervisor");
  await handBack(sql!, id, ife);
  await takeOver(sql!, id, bayo);
  // The institution wants a second supervisor above $3,000.
  await sql!`update rules set value = '3000' where id = 'staff_dual_limit_usd'`;
  const first = await runStaffAction(sql!, id, bayo, "initiate_recall", { reference: "PO-88150" });
  assert.equal(first.status, "needs_second_approval");
  const ref = (first as { reference: string }).reference;
  assert.equal((await decide(sql!, ref, "approve", null, bayo)).ok, false, "not by the person who asked");
  assert.equal((await decide(sql!, ref, "approve", null, ife)).ok, false, "only a supervisor");
  assert.equal((await decide(sql!, ref, "approve", "Checked with the payments lead", zara)).ok, true);
  const asked = await runStaffAction(sql!, id, bayo, "initiate_recall", { reference: "PO-88150" });
  assert.equal(asked.status, "waiting_customer", "after the approval, the customer's yes");
  // The customer cancels: nothing happens.
  await runTurn(sql!, { conversationId: id, typingUserId: null, message: "Cancel", confirm: false }, () => {});
  assert.equal((await sql!`select count(*)::int as n from recalls where transfer_id = 'PO-88150'`)[0].n, 0);
  // Asked again, the customer types yes.
  await runStaffAction(sql!, id, bayo, "initiate_recall", { reference: "PO-88150" });
  await runTurn(sql!, { conversationId: id, typingUserId: null, message: "yes please" }, () => {});
  const [r] = await sql!<{ status: string }[]>`select status from recalls where transfer_id = 'PO-88150'`;
  assert.equal(r.status, "requested", "submitted directly: the person was the review the cap asks for");
  await sql!`update rules set value = '10000' where id = 'staff_dual_limit_usd'`;
});

test("Orchestra API: a reply typed in a CRM reaches the customer and can hand the chat back to Alexis", { skip }, async () => {
  const { teamReply } = await import("../lib/api/teamReply.ts");
  const s = await session("ada", new Date());
  const id = s.conv.id;
  await sql!`update conversations set mode = 'customer' where id = ${id}`;
  assert.deepEqual(await teamReply(sql!, id, { text: "Hi" }, "Helpdesk"), { error: "bad_request", message: "Send the team member's name." });
  const out = await teamReply(sql!, id, { name: "Tolu Ade", text: "Hi Ada, I've chased the receiving bank. My card is 4111 1111 1111 1111 – ignore." }, "Helpdesk");
  assert.deepEqual(out, { ok: true, handled_by: "Tolu Ade" }, "the conversation is now with the CRM agent");
  const view = await customerView(sql!, id);
  assert.ok(view.staff.some((m) => m.name === "Tolu Ade" && /chased the receiving bank/.test(m.text) && !/4111 1111/.test(m.text)), "delivered, secrets masked");
  const ife = (await staffUser(sql!, "ife"))!;
  assert.equal(await takeOver(sql!, id, ife), "taken_over_by_someone_else", "one person at a time");
  assert.deepEqual(await teamReply(sql!, id, { name: "Tolu Ade", hand_back: true }, "Helpdesk"), { ok: true, handled_by: null });
  assert.deepEqual(await teamReply(sql!, id, { name: "Tolu Ade", text: "Back again" }, "Helpdesk"), { ok: true, handled_by: "Tolu Ade" });
  await takeOver(sql!, id, { id: "x", name: "Someone else", role: "support_agent" }).catch(() => null);
  await handBack(sql!, id, { id: "crm:tolu-ade", name: "Tolu Ade", role: "support_agent" });
  assert.equal(await takeOver(sql!, id, ife), null);
  assert.equal((await teamReply(sql!, id, { name: "Tolu Ade", text: "Me again" }, "Helpdesk") as { error?: string }).error, "taken_over_by_someone_else");
});

// ---------------------------------------------------------------- proactive failure messages and billing (Nov 23)

test("proactive messages: the customer is told why a payment failed, once, within the institution's rules", { skip }, async () => {
  const { notifyFailure, quietUntil } = await import("../lib/proactive.ts");
  const { receiveEvent } = await import("../lib/api/events.ts");
  await seed(sql!, MONDAY);
  await sql!`update rules set value = '00:00' where id in ('proactive_quiet_start', 'proactive_quiet_end')`;
  const now = new Date();
  const r = await notifyFailure(sql!, "card.declined", { user_id: "grace", transaction_id: "TX-90035", reason: "online_payments_off" }, now);
  assert.equal(r.sent, true);
  const text = (r as { text: string }).text;
  assert.match(text, /^Hi Grace, this is Alexis/);
  assert.match(text, /£64\.00 payment to Riverside Florist on your card ending 3307 was declined because online payments are switched off/);
  const [o] = await sql!`select body, sent_to, conversation_id from outbox where user_id = 'grace' order by id desc limit 1`;
  assert.equal(o.conversation_id, (r as { conversationId: string }).conversationId);
  assert.match(o.sent_to, /^•••• \d{4}$/);
  assert.equal((await notifyFailure(sql!, "card.declined", { user_id: "grace", transaction_id: "TX-90035", reason: "online_payments_off" }, now) as { why: string }).why, "duplicate");
  // Through the Events API, idempotent by the bank's event id.
  const ev = { id: "bank-fail-1", type: "transfer.returned", data: { user_id: "maya", reference: "PO-77310" } };
  assert.deepEqual(await receiveEvent(sql!, ev), { ok: true, applied: true, notified: true });
  assert.deepEqual(await receiveEvent(sql!, ev), { ok: true, applied: false, duplicate: true });
  const [m] = await sql!`select proactive->>'text' as text from conversations where typing_user_id = 'maya' and origin = 'alexis'`;
  assert.match(m.text, /payout PO-77310 to Ridgeway Haulage didn't go through/);
  // Never for suspected fraud; never on a review hold; nothing when switched off; the daily cap.
  assert.equal((await notifyFailure(sql!, "card.declined", { user_id: "emeka", transaction_id: "TX-90022", reason: "suspected_fraud" }, now) as { why: string }).why, "fraud");
  assert.equal((await notifyFailure(sql!, "transfer.returned", { user_id: "lena", reference: "PO-88177" }, now) as { why: string }).why, "review_hold");
  await sql!`update rules set value = 'off' where id = 'proactive_failed_debited'`;
  assert.equal((await notifyFailure(sql!, "payment.failed_debited", { user_id: "chioma", payment_id: "PAY-61001" }, now) as { why: string }).why, "switched_off");
  await sql!`update rules set value = 'on' where id = 'proactive_failed_debited'`;
  await sql!`update rules set value = '0' where id = 'proactive_daily_cap'`;
  assert.equal((await notifyFailure(sql!, "card.declined", { user_id: "emeka", transaction_id: "TX-90022", reason: "daily_limit" }, now) as { why: string }).why, "daily_cap");
  await sql!`update rules set value = '2' where id = 'proactive_daily_cap'`;
  // Quiet hours: 21:00 to 08:00 Lagos time; at 22:30 Lagos the message waits until 08:00.
  await sql!`update rules set value = '21:00' where id = 'proactive_quiet_start'`;
  await sql!`update rules set value = '08:00' where id = 'proactive_quiet_end'`;
  const { Rules } = await import("../lib/rules.ts");
  const rules = await Rules.load(sql!);
  const late = new Date(Date.UTC(2026, 10, 23, 21, 30)); // 22:30 in Lagos
  assert.equal(quietUntil(late, rules)?.toISOString(), new Date(Date.UTC(2026, 10, 24, 7, 0)).toISOString());
  assert.equal(quietUntil(new Date(Date.UTC(2026, 10, 23, 11, 0)), rules), null);
  // The Inbox shows it as started by Alexis and waiting on the customer, not resolved.
  const { listCases } = await import("../lib/cases.ts");
  const row = (await listCases(sql!)).find((c) => c.id === (r as { conversationId: string }).conversationId)!;
  assert.equal(row.startedBy, "alexis");
  assert.equal(row.status, "Waiting on customer");
});

test("billing: platform fee plus usage, from the month's conversations and the plan on the Rules screen", { skip }, async () => {
  const { billing } = await import("../lib/billing.ts");
  const now = new Date();
  await sql!`insert into ai_usage (purpose, model, input_tokens, output_tokens, created_at) values ('alexis', 'test', 1000000, 100000, ${now})`;
  const b = await billing(sql!, null, now);
  const { usage, plan, invoice } = b;
  assert.equal(plan.platformFee, 1500);
  assert.equal(usage.billableResolved, Math.max(0, usage.resolvedByAlexis - plan.included));
  assert.equal(invoice.total, Math.round((1500 + usage.billableResolved * 0.8 + usage.handedOff * 0.2 + usage.listened * 0.1) * 100) / 100);
  assert.ok(b.ai.inputTokens >= 1_000_000 && b.ai.cost >= 4.5, "1M input at $3 and 100k output at $15 is $4.50");
  assert.equal(b.orchestra.aiCost, b.ai.cost, "Orchestra's AI account by default");
  await sql!`update rules set value = 'on' where id = 'billing_bank_pays_ai'`;
  assert.equal((await billing(sql!, null, now)).orchestra.aiCost, 0, "the institution pays its AI provider");
  await sql!`update rules set value = 'off' where id = 'billing_bank_pays_ai'`;
  await sql!`update rules set value = '0' where id = 'billing_included'`;
  const b2 = await billing(sql!, null, now);
  assert.equal(b2.usage.billableResolved, b2.usage.resolvedByAlexis, "nothing included: every resolved conversation is charged");
  await sql!`update rules set value = '500' where id = 'billing_included'`;
});

// ---------------------------------------------------------------- listen mode (Nov 23)

test("listen mode: a helpdesk ticket is matched, categorised, routed and looked up for the team, never answered", { skip }, async () => {
  const { ingestInteraction, ruleClassify } = await import("../lib/listen.ts");
  const { listCases } = await import("../lib/cases.ts");
  await seed(sql!, MONDAY);
  const classify = async (text: string) => ({ analysis: { ...ruleClassify(text), category: "Payouts", urgency: "high" as const, summary: "Ada asks where PO-88190 is", wants: "Find the payout" } });
  const ticket = {
    source: "zendesk" as const, external_id: "ZD-1", subject: "Payment not received",
    customer: { name: "Ada Okafor", email: "ADA@brightline.example.com" },
    messages: [{ id: "m1", from: "customer" as const, text: "We sent $4,200 (PO-88190) and it hasn't arrived. My password is hunter2" }],
  };
  const out = await ingestInteraction(sql!, ticket, { classify, draft: false });
  assert.ok(out.ok, JSON.stringify(out));
  const a = (out as { analysis: { team: string; findings: string[]; category: string } }).analysis;
  assert.equal(a.team, "Payments team");
  assert.match(a.findings[0], /^PO-88190: \$4,200\.00 to Lumen Print \(•••• \d{4}\) by SWIFT, Processing/);
  const id = (out as { conversation_id: string }).conversation_id;
  const [c] = await sql!`select listen, messages, verified_user_id, channel from conversations where id = ${id}`;
  assert.equal(c.listen.match.user_id, "ada", "matched by the email on file");
  assert.equal(c.verified_user_id, null, "a match is never a verification");
  assert.equal(c.channel, "helpdesk");
  assert.ok(!JSON.stringify(c.messages).includes("hunter2"), "secrets masked before storing");
  // The same ticket again: each message once; an agent's reply in the helpdesk is recorded, not re-analysed.
  await ingestInteraction(sql!, { ...ticket, messages: [...ticket.messages, { id: "m2", from: "agent", name: "Tolu", text: "Looking into it." }] }, { classify, draft: false });
  const [c2] = await sql!`select messages from conversations where id = ${id}`;
  assert.equal(c2.messages.length, 2);
  assert.equal((await sql!`select count(*)::int as n from conversations where listen->>'external_id' = 'ZD-1'`)[0].n, 1);
  // Listed as Listening, with its team; never resolved by Alexis.
  const row = (await listCases(sql!)).find((r) => r.id === id)!;
  assert.equal(row.status, "Listening");
  assert.equal(row.listen?.team, "Payments team");
  // Fraud always goes to the fraud team, urgently; an unknown sender gets no lookups.
  const fraud = await ingestInteraction(sql!, { source: "freshdesk", external_id: "FD-9", customer: { email: "nobody@unknown.example" }, messages: [{ from: "customer", text: "There's a payment PAY-61001 that wasn't me, I think I was scammed" }] }, { draft: false });
  const fa = (fraud as { analysis: { team: string; urgency: string; findings: string[] } }).analysis;
  assert.deepEqual([fa.team, fa.urgency, fa.findings.length], ["Fraud team", "urgent", 0]);
  // Switched off on the Rules screen.
  await sql!`update rules set value = 'off' where id = 'listen_enabled'`;
  assert.equal((await ingestInteraction(sql!, ticket, { classify }) as { error: string }).error, "switched_off");
  await sql!`update rules set value = 'on' where id = 'listen_enabled'`;
});

// ---------------------------------------------------------------- CRM connectors (Nov 23)

test("CRM connectors: each of the four reads its ticket, and writes tags, priority, team and a note back in its own API's shape", { skip }, async () => {
  const { handleCrmWebhook, saveConnector } = await import("../lib/crm/service.ts");
  const { SAMPLE_WEBHOOK } = await import("../lib/crm/sandbox.ts");
  const { ruleClassify } = await import("../lib/listen.ts");
  await seed(sql!, MONDAY);
  assert.equal((await handleCrmWebhook(sql!, "zendesk", SAMPLE_WEBHOOK.zendesk) as { error: string }).error, "not_connected", "off until switched on");
  assert.deepEqual(await saveConnector(sql!, "zendesk", { mode: "live" }, "Bayo"), { ok: false, error: "Set ZENDESK_SUBDOMAIN, ZENDESK_EMAIL, ZENDESK_API_TOKEN in Vercel's environment variables first." });
  const classify = async (t: string) => ({ analysis: ruleClassify(t) });
  for (const kind of ["zendesk", "freshdesk", "salesforce", "hubspot"] as const) {
    await saveConnector(sql!, kind, { mode: "sandbox", groups: { "Payments team": kind === "salesforce" ? "00G000000PAY" : "360001", "Fraud team": "360009" } }, "Bayo");
    const out = await handleCrmWebhook(sql!, kind, SAMPLE_WEBHOOK[kind], { classify, draft: false, consoleBase: "https://orchestra.example" });
    assert.ok(out.ok && out.analysed && out.written_back, `${kind}: ${JSON.stringify(out)}`);
    const writes = await sql!<{ method: string; path: string; body: Record<string, unknown> }[]>`select method, path, body from crm_sandbox_calls where kind = ${kind} order by id`;
    const all = JSON.stringify(writes);
    assert.match(all, /Orchestra \(AI\)/, `${kind}: an internal note`);
    assert.match(all, /not identity-verified/, `${kind}: the note says the match isn't a verification`);
    if (kind === "zendesk") {
      const put = writes.find((w) => w.method === "PUT")!;
      assert.equal(put.path, "/api/v2/tickets/1001.json");
      const t = put.body.ticket as { additional_tags: string[]; priority: string; group_id: number; comment: { public: boolean } };
      assert.ok(t.additional_tags.includes("orc_payouts"));
      assert.deepEqual([t.priority, t.group_id, t.comment.public], ["high", 360001, false]);
    }
    if (kind === "freshdesk") {
      const put = writes.find((w) => w.method === "PUT")!;
      assert.deepEqual([put.path, (put.body as { priority: number }).priority, (put.body as { group_id: number }).group_id], ["/api/v2/tickets/2001", 4, 360009], "a fraud report: urgent, Fraud team");
      assert.ok(writes.some((w) => w.path === "/api/v2/tickets/2001/notes" && (w.body as { private: boolean }).private === true));
    }
    if (kind === "salesforce") {
      assert.ok(writes.some((w) => w.method === "PATCH" && /\/sobjects\/Case\/5003000000ABCdE$/.test(w.path)));
      assert.ok(writes.some((w) => w.path.endsWith("/sobjects/CaseComment") && (w.body as { IsPublished: boolean }).IsPublished === false));
    }
    if (kind === "hubspot") {
      assert.ok(writes.some((w) => w.method === "PATCH" && w.path === "/crm/v3/objects/tickets/8001"));
      assert.ok(writes.some((w) => w.path === "/crm/v3/objects/notes" && JSON.stringify(w.body).includes('"associationTypeId":228')));
    }
    const [c] = await sql!`select listen from conversations where id = ${out.ok ? out.conversation_id : ""}`;
    assert.equal(c.listen.writeback.ok, true);
  }
  // The ticket ids each product's webhook sends.
  const { zendesk, freshdesk, salesforce, hubspot } = await import("../lib/crm/connectors.ts");
  assert.equal(zendesk({ subdomain: "x", email: "e", token: "t" }).ticketIdFrom({ ticket_id: "77" }), "77");
  assert.equal(freshdesk({ domain: "x", apiKey: "k" }).ticketIdFrom({ freshdesk_webhook: { ticket_id: 12 } }), "12");
  assert.equal(salesforce({ instanceUrl: "https://x", accessToken: "t" }).ticketIdFrom({ caseId: "500ABC" }), "500ABC");
  assert.equal(hubspot({ accessToken: "t" }).ticketIdFrom([{ objectId: 9 }]), "9");
});

test("data entry: a handoff opens a CRM ticket with its case notes; later steps are added; a resolved conversation is recorded once", { skip }, async () => {
  const { saveConnector } = await import("../lib/crm/service.ts");
  const { dataEntryOnEvent, recordResolved } = await import("../lib/crm/dataEntry.ts");
  await seed(sql!, MONDAY);
  await saveConnector(sql!, "zendesk", { mode: "sandbox", data_entry: true, groups: { "Payments team": "360001" } }, "Bayo");
  const s = await session("ada", new Date());
  await sql!`update conversations set messages = ${sql!.json([{ role: "user", content: "Where is PO-88102?" }, { role: "assistant", content: [{ type: "text", text: "It's late; I've passed it to the team." }] }] as never)} where id = ${s.conv.id}`;
  await call(s, "get_transfer_status", { reference: "PO-88102" });
  const esc = await call(s, "escalate_to_human", { trigger: "payout_past_window", urgency: "normal", request: "Where is PO-88102", checked: "PO-88102 late", did: "None", needed: "Chase the bank", told: "The team will pick it up" });
  const [e] = await sql!`select team, summary, urgency, respond_by from escalations where reference = ${esc.reference!}`;
  // The handoff's event writes it in the background; wait for it (or write it if the background hasn't started).
  for (let i = 0; i < 40; i++) {
    const [r] = await sql!`select ticket_id from crm_records where conversation_id = ${s.conv.id} and kind = 'zendesk'`;
    if (r && r.ticket_id !== "pending") break;
    if (i === 20 && !r) await dataEntryOnEvent(sql!, "case.created", { reference: esc.reference, conversation_id: s.conv.id, urgency: e.urgency, team: e.team, category: "Payouts", respond_by: e.respond_by, summary: e.summary });
    await new Promise((res) => setTimeout(res, 50));
  }
  const [rec] = await sql!`select ticket_id from crm_records where conversation_id = ${s.conv.id} and kind = 'zendesk'`;
  assert.equal(rec.ticket_id, "1099");
  const post = (await sql!`select body from crm_sandbox_calls where kind = 'zendesk' and method = 'POST' order by id desc limit 1`)[0].body.ticket;
  assert.equal(post.group_id, 360001, "the Payments team's group");
  assert.equal(post.requester.email, "ada@brightline.example.com", "the customer on file");
  assert.match(post.comment.body, /Chase the bank/);
  assert.equal(post.comment.public, false);
  // A second handoff event for the same conversation adds to the ticket instead of opening another.
  await dataEntryOnEvent(sql!, "case.updated", { reference: esc.reference, status: "resolved", by: "Ife Adeyemi", note: "Funds arrived" });
  const put = (await sql!`select path, body from crm_sandbox_calls where kind = 'zendesk' and method = 'PUT' order by id desc limit 1`)[0];
  assert.equal(put.path, "/api/v2/tickets/1099.json");
  assert.match(put.body.ticket.comment.body, /resolved by Ife Adeyemi: Funds arrived/);
  assert.equal(put.body.ticket.status, "solved");
  assert.equal((await sql!`select count(*)::int as n from crm_records where conversation_id = ${s.conv.id}`)[0].n, 1);
  // Conversations Alexis resolved on her own: recorded once each, as solved tickets with case notes.
  const notes = async () => ({ notes: { subject: "Balance question", asked: "Balance", found: "USD 10,000", done: "Nothing: information only", outcome: "Answered", references: [] } });
  const n1 = await recordResolved(sql!, { notes, limit: 50, now: new Date(Date.now() + 3 * 3_600_000) });
  const n2 = await recordResolved(sql!, { notes, limit: 50, now: new Date(Date.now() + 3 * 3_600_000) });
  assert.equal(n2, 0, "never twice");
  if (n1 > 0) {
    const solved = (await sql!`select body from crm_sandbox_calls where kind = 'zendesk' and method = 'POST' order by id desc limit 1`)[0].body.ticket;
    assert.equal(solved.status, "solved");
    assert.match(solved.comment.body, /Recorded by Orchestra \(AI\)/);
  }
  await saveConnector(sql!, "zendesk", { mode: "off", data_entry: false }, "Bayo");
});

// ---------------------------------------------------------------- console sign-in and roles (Nov 23)

test("sign-in: the first admin sets up the console; passwords are hashed; wrong ones are paused; roles decide what's allowed", { skip }, async () => {
  const auth = await import("../lib/auth.ts");
  await sql!`delete from staff_sessions`;
  await sql!`delete from login_attempts`;
  await sql!`update staff_users set password_hash = null, must_change = false, active = true`;
  await sql!`delete from staff_users where demo is not true`;
  assert.equal(await auth.needsSetup(sql!), true);
  assert.equal((await auth.setupFirstAdmin(sql!, { name: "Tomi", email: "tomi@bank.example", password: "short" }) as { error: string }).error, "Use at least 10 characters.");
  assert.equal((await auth.setupFirstAdmin(sql!, { name: "Tomi", email: "tomi@bank.example", password: "orchestra-2026" })).ok, true);
  assert.equal(await auth.needsSetup(sql!), false);
  assert.equal((await auth.setupFirstAdmin(sql!, { name: "Eve", email: "eve@bank.example", password: "orchestra-2026" })).ok, false, "only once");
  const [u] = await sql!`select password_hash from staff_users where email = 'tomi@bank.example'`;
  assert.match(u.password_hash, /^scrypt\$[0-9a-f]{32}\$[0-9a-f]{64}$/);
  assert.ok(!u.password_hash.includes("orchestra-2026"));

  // Wrong passwords never say whether the email exists; five in 15 minutes pause sign-in for that email.
  const wrong = await auth.signIn(sql!, "tomi@bank.example", "nope-nope-1", null);
  const unknown = await auth.signIn(sql!, "nobody@bank.example", "nope-nope-1", null);
  assert.deepEqual(wrong, unknown);
  for (let i = 0; i < 4; i++) await auth.signIn(sql!, "tomi@bank.example", "nope-nope-1", null);
  assert.match((await auth.signIn(sql!, "tomi@bank.example", "orchestra-2026", null) as { error: string }).error, /Too many attempts/);
  await sql!`delete from login_attempts`;
  const ok = await auth.signIn(sql!, "TOMI@bank.example ", "orchestra-2026", null);
  assert.ok(ok.ok);
  const token = (ok as { token: string }).token;
  assert.equal((await sql!`select count(*)::int as n from staff_sessions where token_hash = ${token}`)[0].n, 0, "only a hash of the token is stored");
  const req = (method = "GET", headers: Record<string, string> = {}) => new Request("https://console.example/api/x", { method, headers: { cookie: `orc_session=${encodeURIComponent(token)}`, ...headers } });
  const me = await auth.currentStaff(sql!, req());
  assert.equal(me?.role, "operations_admin");

  // Roles: an operations admin manages the team and rules but doesn't work conversations or approve cases.
  assert.ok(!((await auth.requirePermission(sql!, req(), "team_manage")) instanceof Response));
  assert.equal(((await auth.requirePermission(sql!, req(), "conversation_act")) as Response).status, 403);
  assert.equal(((await auth.requirePermission(sql!, req(), "case_approve")) as Response).status, 403);
  assert.equal(((await auth.requirePermission(sql!, new Request("https://console.example/api/x"), "rules_view")) as Response).status, 401, "not signed in");
  assert.equal(((await auth.requirePermission(sql!, req("POST", { origin: "https://evil.example" }), "team_manage")) as Response).status, 403, "changes only from the console");
  assert.ok(auth.can("compliance", "inbox_view") && !auth.can("compliance", "conversation_act") && !auth.can("compliance", "rules_propose"));
  assert.ok(auth.can("management", "billing_view") && !auth.can("management", "inbox_view"));
  assert.ok(auth.can("supervisor", "case_approve") && !auth.can("support_agent", "case_approve"));

  // Accounts: a temporary password must be changed; the last admin can't be removed; switching off ends sessions.
  const added = await auth.addMember(sql!, me!, { name: "Ngozi Eke", email: "ngozi@bank.example", role: "support_agent" });
  assert.ok(added.ok);
  const s2 = await auth.signIn(sql!, "ngozi@bank.example", (added as { tempPassword: string }).tempPassword, null);
  const r2 = new Request("https://console.example/api/x", { headers: { cookie: `orc_session=${(s2 as { token: string }).token}` } });
  assert.equal(((await auth.requirePermission(sql!, r2, "inbox_view")) as Response).status, 403, "choose a password first");
  const agent = (await auth.currentStaff(sql!, r2))!;
  assert.ok((await auth.changeOwnPassword(sql!, agent, (added as { tempPassword: string }).tempPassword, "my-new-pass-42")).ok);
  assert.ok(!((await auth.requirePermission(sql!, r2, "conversation_act")) instanceof Response));
  assert.equal((await auth.updateMember(sql!, me!, me!.id, { active: false }) as { error: string }).error, "You can't change your own role or switch yourself off. Ask another admin.");
  assert.ok((await auth.updateMember(sql!, me!, agent.id, { active: false })).ok);
  assert.equal(await auth.currentStaff(sql!, r2), null, "switched off: signed out");
  // The sample team can be given one password to try each role.
  assert.equal((await auth.enableDemoTeam(sql!, me!, "demo-pass-2026") as { count: number }).count, 6);
  assert.ok((await auth.signIn(sql!, "lara@yourbank.example", "demo-pass-2026", null)).ok);
});

test("connector health: a failing call puts a connector in Needs attention; Reconnect clears it", { skip }, async () => {
  const { saveConnector, connectorSettings, healthOf, noteHealth, checkConnection } = await import("../lib/crm/service.ts");
  await saveConnector(sql!, "freshdesk", { mode: "sandbox" }, "Bayo");
  const health = async () => healthOf((await connectorSettings(sql!)).find((c) => c.kind === "freshdesk")!);
  await noteHealth(sql!, "freshdesk", true);
  assert.equal((await health()).state, "active");
  await noteHealth(sql!, "freshdesk", false, { message: "PUT /api/v2/tickets/2001: 401 Unauthorized", status: 401 });
  assert.deepEqual([(await health()).state, (await health()).label, (await health()).fix], ["attention", "Sign-in failed", "reconnect"]);
  await noteHealth(sql!, "freshdesk", false, { message: "PUT /api/v2/tickets/2001: 422 bad group", status: 422 });
  assert.equal((await health()).label, "Write-back failing");
  assert.equal((await health()).failures, 2);
  assert.deepEqual(await checkConnection(sql!, "freshdesk"), { ok: true }, "the sandbox answers the credentials check");
  assert.equal((await health()).state, "active", "a working call clears it");
  await saveConnector(sql!, "freshdesk", { mode: "off" }, "Bayo");
  assert.equal((await health()).state, "off");
});
