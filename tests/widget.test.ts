// The website chat widget (lib/widget.ts): settings, signed-in customers' tokens, starting conversations.
// The database tests need TEST_DATABASE_URL, e.g. postgres://postgres@localhost:54329/postgres
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import postgres from "postgres";
import { createHmac } from "node:crypto";
import { seed } from "../lib/seed.ts";
import { staffUser } from "../lib/staff.ts";
import {
  cleanOrigins, signCustomerToken, readCustomerToken, saveWidget, newSigningSecret, setWidgetLive, removeWidget,
  liveWidget, widget, widgetView, startConversation, isWidgetConversation, demoToken, TOKEN_MAX_SECONDS,
} from "../lib/widget.ts";

const url = process.env.TEST_DATABASE_URL;
const sql = url ? postgres(url, { prepare: false, onnotice: () => {} }) : null;
const skip = !sql && "TEST_DATABASE_URL not set";

before(async () => { if (sql) { await seed(sql, new Date()); await sql`delete from chat_widget`; } });
after(async () => { await sql?.end(); });

test("widget: websites are cleaned to https origins; anything else is refused with its name", () => {
  const ok = cleanOrigins("www.yourbank.com\nhttps://app.yourbank.com/help?x=1, www.yourbank.com http://localhost:3000");
  assert.deepEqual(ok, { ok: true, origins: ["https://www.yourbank.com", "https://app.yourbank.com", "http://localhost:3000"] });
  for (const bad of ["http://yourbank.com", "*.yourbank.com", "yourbank", "ftp://yourbank.com", "https://user:pw@yourbank.com"]) {
    assert.equal(cleanOrigins(bad).ok, false, bad);
  }
  assert.equal(cleanOrigins(Array.from({ length: 21 }, (_, i) => `s${i}.example.com`).join(" ")).ok, false);
});

test("widget: a signed-in customer's token is the bank's, unexpired and short-lived, or nothing", () => {
  const now = Date.now();
  const t = signCustomerToken("wsec_a", "ada", 600, now);
  assert.equal(readCustomerToken("wsec_a", t, now), "ada");
  assert.equal(readCustomerToken("wsec_b", t, now), null, "another secret");
  assert.equal(readCustomerToken("wsec_a", t, now + 601_000), null, "expired");
  const [body, sig] = t.split(".");
  const forged = Buffer.from(JSON.stringify({ sub: "zainab", exp: Math.floor(now / 1000) + 600 })).toString("base64url");
  assert.equal(readCustomerToken("wsec_a", `${forged}.${sig}`, now), null, "changed customer");
  assert.equal(readCustomerToken("wsec_a", `${body}.`, now), null);
  assert.equal(readCustomerToken("wsec_a", "nonsense", now), null);
  // A token the bank made to last a day is refused (signCustomerToken itself caps at an hour).
  const long = Buffer.from(JSON.stringify({ sub: "ada", exp: Math.floor(now / 1000) + 86_400 })).toString("base64url");
  assert.equal(readCustomerToken("wsec_a", `${long}.${createHmac("sha256", "wsec_a").update(long).digest("base64url")}`, now), null);
  assert.ok(TOKEN_MAX_SECONDS <= 3600);
});

test("widget: set up, go live, sign-in secret shown once, pause and remove; every change logged", { skip }, async () => {
  const admin = (await staffUser(sql!, "zainab"))!;
  assert.equal((await widgetView(sql!)).set, false);
  assert.equal((await saveWidget(sql!, admin, { title: "Okapi support", colour: "blue", origins: "" })).ok, false);
  assert.equal((await saveWidget(sql!, admin, { title: "Okapi support", colour: "#0f3d3e", origins: "www.okapi.example" })).ok, true);
  const w = (await widget(sql!))!;
  assert.match(w.key, /^wk_/);
  assert.equal(w.colour, "#0F3D3E");
  assert.equal(await liveWidget(sql!, w.key), null, "not live until switched on");
  await setWidgetLive(sql!, admin, true);
  assert.ok(await liveWidget(sql!, w.key));
  assert.equal(await liveWidget(sql!, "wk_somebodyelseskey"), null);
  const s = await newSigningSecret(sql!, admin);
  assert.ok(s.ok && s.secret.startsWith("wsec_"));
  const view = await widgetView(sql!);
  assert.ok(view.set && view.secretLast4 === s.secret.slice(-4));
  assert.ok(!JSON.stringify(view).includes(s.secret), "the secret never comes back");
  assert.ok(!(await widget(sql!))!.secret_sealed!.includes(s.secret), "stored encrypted");
  // Saving keeps the key: the line on the bank's site keeps working.
  await saveWidget(sql!, admin, { title: "Okapi help", colour: "#0F3D3E", origins: "www.okapi.example app.okapi.example" });
  assert.equal((await widget(sql!))!.key, w.key);
  const logged = await sql!<{ summary: string }[]>`select summary from audit_log where tool = 'widget' order by id`;
  assert.ok(logged.length >= 4 && logged.every((l) => !l.summary.includes(s.secret)));
  await setWidgetLive(sql!, admin, false);
  assert.equal(await liveWidget(sql!, w.key), null);
  await removeWidget(sql!, admin);
  assert.equal(await widget(sql!), null);
});

test("widget: conversations start as a guest or verified by the bank's token; a bad token is refused; visitors are limited", { skip }, async () => {
  const admin = (await staffUser(sql!, "zainab"))!;
  await saveWidget(sql!, admin, { title: "Support", colour: "#4F3BF3", origins: "www.okapi.example" });
  await setWidgetLive(sql!, admin, true);
  let w = (await widget(sql!))!;
  // Signed-in tokens need the secret first.
  assert.equal((await demoToken(sql!, "ada")).ok, false);
  const secret = (await newSigningSecret(sql!, admin) as { secret: string }).secret;
  w = (await widget(sql!))!;

  const guest = await startConversation(sql!, w, { visitor: "v-guest", language: "en" });
  assert.ok(guest.ok && guest.signedIn === null && guest.greeting);
  assert.equal(await isWidgetConversation(sql!, guest.conversation_id), true);
  const [g] = await sql!<{ verified_user_id: string | null; origin: string; channel: string }[]>`select verified_user_id, origin, channel from conversations where id = ${guest.conversation_id}`;
  assert.deepEqual(g, { verified_user_id: null, origin: "widget", channel: "app" });

  const signed = await startConversation(sql!, w, { visitor: "v-ada", token: signCustomerToken(secret, "ada") });
  assert.ok(signed.ok && signed.signedIn === "Ada");
  const [a] = await sql!<{ verified_user_id: string | null }[]>`select verified_user_id from conversations where id = ${signed.conversation_id}`;
  assert.equal(a.verified_user_id, "ada");
  const id = await sql!<{ summary: string }[]>`select summary from audit_log where conversation_id = ${signed.conversation_id} and kind = 'identity'`;
  assert.match(id[0].summary, /signed in to its website.*website chat/);

  assert.deepEqual(await startConversation(sql!, w, { visitor: "v-x", token: signCustomerToken("wsec_wrong", "ada") }), { ok: false, error: "bad_token" });
  assert.deepEqual(await startConversation(sql!, w, { visitor: "v-x", token: signCustomerToken(secret, "nobody") }), { ok: false, error: "bad_token" });
  const demo = await demoToken(sql!, "ada");
  assert.ok(demo.ok && readCustomerToken(secret, demo.token) === "ada");

  // The rule: 10 new conversations an hour per visitor by default.
  for (let i = 0; i < 9; i++) assert.ok((await startConversation(sql!, w, { visitor: "v-guest" })).ok);
  assert.deepEqual(await startConversation(sql!, w, { visitor: "v-guest" }), { ok: false, error: "too_many" });
  assert.ok((await startConversation(sql!, w, { visitor: "v-other" })).ok, "other visitors aren't affected");

  // Only the widget's own conversations are open to its routes.
  const [app] = await sql!<{ id: string }[]>`insert into conversations (id, channel) values (gen_random_uuid(), 'app') returning id`;
  assert.equal(await isWidgetConversation(sql!, app.id), false);
  assert.equal(await isWidgetConversation(sql!, "not-a-uuid"), false);
  await removeWidget(sql!, admin);
});
