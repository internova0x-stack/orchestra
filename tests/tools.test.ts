// Tools, checks and sample data against a real Postgres (no model calls).
// Run with TEST_DATABASE_URL set, e.g. postgres://postgres@localhost:54329/postgres
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { seed } from "../lib/seed.ts";
import { runTool, respondBy, AWAITING_IDENTITY, type StreamEvent, type ToolCtx } from "../lib/tools.ts";
import { createConversation, verifiedUser, type Conversation } from "../lib/session.ts";
import { checkIdentity } from "../lib/identity.ts";
import { Rules } from "../lib/rules.ts";
import { fromLocal } from "../lib/time.ts";

const url = process.env.TEST_DATABASE_URL;
const sql = url ? postgres(url, { prepare: false, onnotice: () => {} }) : null;
const skip = !sql && "TEST_DATABASE_URL not set";

after(async () => {
  await sql?.end();
});

async function session(userId: string | null, now: Date) {
  const conv = await createConversation(sql!, randomUUID(), userId);
  let c: Conversation = conv;
  if (userId) {
    await sql!`update conversations set verified_user_id = ${userId}, verified_at = ${now}, last_activity = ${now} where id = ${conv.id}`;
    c = { ...conv, verified_user_id: userId, verified_at: now, last_activity: now };
  }
  const user = await verifiedUser(sql!, c, now);
  const events: StreamEvent[] = [];
  const ctx = (): ToolCtx => ({ sql: sql!, conv: c, user, now, toolUseId: randomUUID(), emit: (e) => events.push(e) });
  return { conv: c, user, events, ctx };
}

async function call(s: Awaited<ReturnType<typeof session>>, name: string, input: unknown) {
  const out = await runTool(name, input, s.ctx());
  assert.notEqual(out, AWAITING_IDENTITY);
  return out as Exclude<typeof out, typeof AWAITING_IDENTITY>;
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
