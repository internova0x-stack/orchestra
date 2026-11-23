import { test } from "node:test";
import assert from "node:assert/strict";
import { addBusinessDays, addBusinessHours, businessDaysBetween, fromLocal, lastWeekday, local, subtractBusinessDays } from "../lib/time.ts";

test("business days skip the weekend", () => {
  const fri = fromLocal(2026, 10, 27, 10 * 60); // Friday 27 November, 10:00
  const mon = fromLocal(2026, 10, 30, 10 * 60);
  assert.equal(businessDaysBetween(fri, mon), 1);
  assert.equal(local(addBusinessDays(fri, 1)).d, 30);
});

test("two and a half business days back, then forward, is the same instant", () => {
  for (let d = 0; d < 7; d++) {
    const now = fromLocal(2026, 10, 23 + d, 11 * 60);
    const sent = subtractBusinessDays(now, 2.5);
    assert.ok(Math.abs(businessDaysBetween(sent, now) - 2.5) < 1e-6, `day ${d}`);
  }
});

test("business hours roll over to the next working morning", () => {
  const fri4pm = fromLocal(2026, 10, 27, 16 * 60);
  const due = local(addBusinessHours(fri4pm, 4));
  assert.equal(due.d, 30); // Monday
  assert.equal(due.minutes, 12 * 60); // 1 hour Friday + 3 hours Monday from 09:00
});

test("last Friday is always in the past week", () => {
  const sat = fromLocal(2026, 10, 28, 9 * 60);
  assert.equal(local(lastWeekday(sat, 5, 600)).d, 27);
  const fri = fromLocal(2026, 10, 27, 9 * 60);
  assert.equal(local(lastWeekday(fri, 5, 600)).d, 20);
});
