// Data protection (Nov 27): account numbers sent as last 4 only, what Alexis can see, retention, erasure, ID photos.
// The database tests need TEST_DATABASE_URL, e.g. postgres://postgres@localhost:54329/postgres
import { test, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { randomUUID } from "node:crypto";
import { seed } from "../lib/seed.ts";
import { runTool, type StreamEvent, type ToolCtx, type ToolResult } from "../lib/tools.ts";
import { createConversation, verifiedUser } from "../lib/session.ts";
import { bank } from "../lib/bank/index.ts";
import { staffUser } from "../lib/staff.ts";
import { applyRetention, eraseCustomer, erasurePreview } from "../lib/privacy.ts";
import { screenImage, type Classify } from "../lib/imageScreen.ts";
import { DATA_KINDS, dataKindOf } from "../lib/dataAccess.ts";
import { RULE_SET } from "../lib/ruleSet.ts";

const url = process.env.TEST_DATABASE_URL;
const sql = url ? postgres(url, { prepare: false, onnotice: () => {} }) : null;
const skip = !sql && "TEST_DATABASE_URL not set";
after(async () => { await sql?.end(); });

const NOW = new Date();
async function verified(userId: string) {
  const conv = await createConversation(sql!, randomUUID(), userId);
  await sql!`update conversations set verified_user_id = ${userId}, verified_at = ${NOW}, last_activity = ${NOW} where id = ${conv.id}`;
  const c = { ...conv, verified_user_id: userId, verified_at: NOW, last_activity: NOW };
  const user = await verifiedUser(sql!, c, NOW);
  const events: StreamEvent[] = [];
  const ctx = (): ToolCtx => ({ sql: sql!, conv: c, user, now: NOW, toolUseId: randomUUID(), emit: (e) => events.push(e) });
  return { conv: c, ctx };
}
const call = async (s: { ctx: () => ToolCtx }, name: string, input: unknown) => (await runTool(name, input, s.ctx())) as ToolResult;

test("data kinds: every switch is a rule, every tool named exists once", () => {
  const ids = new Set(RULE_SET.map((r) => r.id));
  for (const k of DATA_KINDS) assert.ok(ids.has(k.rule), k.rule);
  const all = DATA_KINDS.flatMap((k) => k.tools);
  assert.equal(new Set(all).size, all.length, "a tool in two kinds");
  assert.equal(dataKindOf("search_knowledge_base"), null);
});

test("the bank sends only the last 4 digits of account numbers", { skip }, async () => {
  await seed(sql!, NOW);
  const t = await bank(sql!).searchTransfers("brightline", {});
  assert.ok(t.length > 0);
  for (const x of t) {
    assert.match(x.recipient_account_last4, /^[A-Za-z0-9]{4}$/);
    assert.equal((x as unknown as Record<string, unknown>).recipient_account, undefined);
  }
  const bills = await bank(sql!).searchBillPayments("chioma", {});
  for (const b of bills) assert.match(b.customer_ref_last4, /^\d{4}$/);
});

test("what Alexis can see: a kind switched off is refused before the bank is asked, and logged", { skip }, async () => {
  await seed(sql!, NOW);
  const ada = await verified("ada");
  assert.equal((await call(ada, "get_balance", {})).ok, true);
  await sql!`update rules set value = 'off' where id = 'see_balances'`;
  const off = await call(ada, "get_balance", {});
  assert.equal(off.ok, false);
  assert.match(String(off.reason), /not to see account balances.*outside_alexis_access/);
  assert.ok(!JSON.stringify(off).match(/\d{1,3},\d{3}\.\d{2}/), "no balance in the refusal");
  const [row] = await sql!`select summary from audit_log where conversation_id = ${ada.conv.id} and kind = 'refusal' order by id desc limit 1`;
  assert.match(row.summary, /not visible: Account balances/);
  await sql!`update rules set value = 'on' where id = 'see_balances'`;
});

test("retention: old conversations go (not ones with an open case), old activity rows go, runs once an hour", { skip }, async () => {
  await seed(sql!, NOW);
  const old = await verified("ada");
  const kept = await verified("tunde");
  const recent = await verified("grace");
  const longAgo = new Date(NOW.getTime() - 400 * 86_400_000);
  await sql!`update conversations set last_activity = ${longAgo} where id in (${old.conv.id}, ${kept.conv.id})`;
  await sql!`insert into escalations (reference, conversation_id, urgency, trigger, summary) values ('ESC-9999', ${kept.conv.id}, 'normal', 'records_missing_or_contradictory', '{}')`;
  await sql!`insert into audit_log (conversation_id, tool_use_id, kind, tool, summary, created_at) values (null, 'x', 'lookup', 't', 'ancient', ${new Date(NOW.getTime() - 3000 * 86_400_000)})`;
  const r = await applyRetention(sql!, NOW, true);
  assert.equal(r?.conversations, 1);
  assert.equal(r?.auditRows, 1);
  const left = (await sql!`select id from conversations where id in (${old.conv.id}, ${kept.conv.id}, ${recent.conv.id})`).map((x) => x.id).sort();
  assert.deepEqual(left, [kept.conv.id, recent.conv.id].sort());
  assert.equal(await applyRetention(sql!, new Date(NOW.getTime() + 60_000)), null, "not again within the hour");
});

test("erasure: a verified customer's conversations go, the activity keeps the steps without details; refused while a case is open", { skip }, async () => {
  await seed(sql!, NOW);
  const zainab = (await staffUser(sql!, "zainab"))!;
  const a1 = await verified("ada");
  const a2 = await verified("ada");
  const other = await verified("tunde");
  await call(a1, "get_balance", {});
  await call(a2, "get_balance", {});
  await sql!`insert into escalations (reference, conversation_id, urgency, trigger, summary) values ('ESC-9998', ${a2.conv.id}, 'normal', 'records_missing_or_contradictory', '{}')`;
  const p = await erasurePreview(sql!, a1.conv.id);
  assert.ok(p.ok && p.verifiedCustomer && p.conversations === 2 && p.openCases === 1);
  assert.equal((await eraseCustomer(sql!, zainab, a1.conv.id)).ok, false, "open case");
  await sql!`update escalations set status = 'resolved' where reference = 'ESC-9998'`;
  const done = await eraseCustomer(sql!, zainab, a1.conv.id);
  assert.ok(done.ok && done.conversations === 2);
  assert.equal((await sql!`select count(*)::int as n from conversations where id in (${a1.conv.id}, ${a2.conv.id})`)[0].n, 0);
  assert.equal((await sql!`select count(*)::int as n from conversations where id = ${other.conv.id}`)[0].n, 1, "others untouched");
  const rows = await sql!<{ summary: string; input: unknown; result: unknown }[]>`select summary, input, result from audit_log where conversation_id in (${a1.conv.id}, ${a2.conv.id})`;
  assert.ok(rows.length >= 2);
  for (const r of rows) {
    assert.match(r.summary, /details deleted on the customer's request/);
    assert.equal(r.input, null);
    assert.equal(r.result, null);
  }
  const [log] = await sql!`select summary, staff from audit_log where tool = 'privacy' order by id desc limit 1`;
  assert.match(log.summary, /2 conversations of a verified customer · by Zainab Bello/);
  // The bank's own records are untouched.
  assert.ok((await bank(sql!).getBalances("brightline")).length > 0);
});

test("photos: an ID document or card is removed, other screenshots go through; a failed check removes it; the switch turns it off", { skip }, async () => {
  await seed(sql!, NOW);
  const img = { media_type: "image/png", data: "iVBORw0KGgo=" };
  const as = (kind: "id_document" | "payment_card" | "other"): Classify => async () => ({ kind });
  const id = await screenImage(sql!, randomUUID(), img, as("id_document"));
  assert.equal(id.keep, false);
  assert.match(id.notice!, /ID document/);
  assert.equal((await screenImage(sql!, randomUUID(), img, as("payment_card"))).keep, false);
  assert.equal((await screenImage(sql!, randomUUID(), img, as("other"))).keep, true);
  const broken: Classify = async () => { throw new Error("down"); };
  assert.equal((await screenImage(sql!, randomUUID(), img, broken)).keep, false, "fails closed");
  await sql!`update rules set value = 'off' where id = 'block_id_photos'`;
  assert.deepEqual(await screenImage(sql!, randomUUID(), img, as("id_document")), { keep: true, kind: "unchecked" });
  await sql!`update rules set value = 'on' where id = 'block_id_photos'`;
});
