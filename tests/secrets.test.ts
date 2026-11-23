import { test } from "node:test";
import assert from "node:assert/strict";
import { maskSecrets } from "../lib/secrets.ts";

test("S3: a pasted API secret key is removed", () => {
  const r = maskSecrets("Here is my API secret key so you can check: sk_live_9f2a71c4e0");
  assert.doesNotMatch(r.text, /9f2a71c4e0/);
  assert.deepEqual(r.found, ["API key"]);
});

test("card numbers, PINs, one-time codes, CVVs and passwords are removed", () => {
  const cases: [string, string, string][] = [
    ["my card is 4539 1488 0343 6467", "4539", "card number"],
    ["my PIN is 4821", "4821", "PIN"],
    ["the code is 551203", "551203", "one-time code"],
    ["OTP: 908172", "908172", "one-time code"],
    ["cvv 123", "123", "CVV"],
    ["my password is Hunter2Hunter2", "Hunter2", "password"],
  ];
  for (const [input, secret, kind] of cases) {
    const r = maskSecrets(input);
    assert.ok(!r.text.includes(secret), `${input} -> ${r.text}`);
    assert.ok(r.found.includes(kind as never), `${input}: ${r.found}`);
  }
});

test("ordinary messages are left alone", () => {
  for (const s of [
    "Where is my payment to Lumen Print? I sent $4,200 two days ago.",
    "We're waiting on ₦1,200,000 from Adeyemi Stores. Has it come in?",
    "Our haulier has a new bank account. Update their details to sort code 20-11-45, account 60114829 and resend.",
    "The reference was KSTRL INV 2O45 and PO-88190",
    "I need proof of payment for the £980 we sent to Fenwick Design.",
  ]) {
    const r = maskSecrets(s);
    assert.equal(r.text, s);
    assert.deepEqual(r.found, []);
  }
});
