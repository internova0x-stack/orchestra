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
import { proposeChange, decideChange, pendingChanges, ruleHistory, ruleImpact } from "../lib/ruleChanges.ts";
import { RULE_SET } from "../lib/ruleSet.ts";
import { appendTurn, forModel, takeOver, handBack, staffReply, customerView } from "../lib/takeover.ts";
import { runTurn } from "../lib/agent.ts";
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
  for (const c of ["Payouts", "Incoming payments", "Verification", "Balances", "Fees and limits", "Account access", "Cards", "Transactions and disputes", "Failed payments and reversals", "Payment tracing", "Loans", "Merchant payouts", "Airtime and bills", "USSD and agent banking", "Complaint", "Fraud and scams", "General question"]) {
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
  assert.deepEqual((await decideChange(sql!, (p as { change: number }).change, ife, true)), { ok: false, error: "Only a supervisor can approve or decline rule changes." });
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
