import type { Sql } from "./db.ts";
import { ensureSchema, TABLES_TO_WIPE } from "./schema.ts";
import { RULE_SET } from "./ruleSet.ts";
import { fromLocal, lastWeekday, local, subtractBusinessDays } from "./time.ts";

// The simulated bank. Every date is an offset from `now`, so "inside its window" and "late" stay
// true on whatever day the demo runs. The records named in docs/TESTS.md are fixed; the rest is
// generated with a seeded random number generator so every reset gives the same bank.

const HOUR = 3_600_000;
const DAY = 24 * HOUR;

interface Business { id: string; name: string; country: string; reg: string; status: string; reason?: string; missing?: string; submittedDaysAgo?: number }
interface User { id: string; business_id: string; full_name: string; first_name: string; date_of_birth: string; role: "view_only" | "payment_rights" }

export const BUSINESSES: Business[] = [
  { id: "brightline", reg: "11482037", name: "Brightline Studios Ltd", country: "United Kingdom", status: "approved" },
  { id: "kestrel", reg: "09731564", name: "Kestrel Freight Ltd", country: "United Kingdom", status: "approved" },
  { id: "harbour", reg: "RC 1764521", name: "Harbour and Vine Ltd", country: "Nigeria", status: "incomplete", reason: "Ownership document missing", missing: "a shareholder register (or equivalent ownership document) showing who owns the business", submittedDaysAgo: 4 },
  { id: "northfield", reg: "84-2917735", name: "Northfield Trading Ltd", country: "United States", status: "approved" },
  { id: "okapi", reg: "RC 1530988", name: "Okapi Logistics Ltd", country: "Nigeria", status: "approved" },
  { id: "saltmarsh", reg: "13206642", name: "Saltmarsh Design Co", country: "United Kingdom", status: "pending", submittedDaysAgo: 1 },
  { id: "tidewater", reg: "47-3381902", name: "Tidewater Analytics Inc", country: "United States", status: "approved" },
  { id: "ember", reg: "RC 1689204", name: "Ember and Oak Foods Ltd", country: "Nigeria", status: "approved" },
];

export const USERS: User[] = [
  { id: "ada", business_id: "brightline", full_name: "Ada Okafor", first_name: "Ada", date_of_birth: "1988-03-14", role: "payment_rights" },
  { id: "tunde", business_id: "brightline", full_name: "Tunde Bello", first_name: "Tunde", date_of_birth: "1993-07-02", role: "view_only" },
  { id: "maya", business_id: "kestrel", full_name: "Maya Chen", first_name: "Maya", date_of_birth: "1985-11-21", role: "payment_rights" },
  { id: "kestrel-viewer", business_id: "kestrel", full_name: "Owen Price", first_name: "Owen", date_of_birth: "1990-05-09", role: "view_only" },
  { id: "sam", business_id: "harbour", full_name: "Sam Wright", first_name: "Sam", date_of_birth: "1979-01-30", role: "payment_rights" },
  { id: "harbour-viewer", business_id: "harbour", full_name: "Ngozi Eze", first_name: "Ngozi", date_of_birth: "1995-09-17", role: "view_only" },
  { id: "lena", business_id: "northfield", full_name: "Lena Hoffman", first_name: "Lena", date_of_birth: "1982-06-25", role: "payment_rights" },
  { id: "northfield-viewer", business_id: "northfield", full_name: "Marcus Hale", first_name: "Marcus", date_of_birth: "1991-02-11", role: "view_only" },
  { id: "chidi", business_id: "okapi", full_name: "Chidi Nwosu", first_name: "Chidi", date_of_birth: "1987-12-03", role: "payment_rights" },
  { id: "okapi-viewer", business_id: "okapi", full_name: "Funmi Adebayo", first_name: "Funmi", date_of_birth: "1996-04-22", role: "view_only" },
  { id: "rosa", business_id: "saltmarsh", full_name: "Rosa Lindqvist", first_name: "Rosa", date_of_birth: "1984-08-08", role: "payment_rights" },
  { id: "saltmarsh-viewer", business_id: "saltmarsh", full_name: "Tom Barker", first_name: "Tom", date_of_birth: "1998-10-15", role: "view_only" },
  { id: "priya", business_id: "tidewater", full_name: "Priya Raman", first_name: "Priya", date_of_birth: "1989-03-27", role: "payment_rights" },
  { id: "tidewater-viewer", business_id: "tidewater", full_name: "Jack Moreno", first_name: "Jack", date_of_birth: "1994-12-01", role: "view_only" },
  { id: "kemi", business_id: "ember", full_name: "Kemi Balogun", first_name: "Kemi", date_of_birth: "1983-07-19", role: "payment_rights" },
  { id: "ember-viewer", business_id: "ember", full_name: "Daniel Osei", first_name: "Daniel", date_of_birth: "1997-01-05", role: "view_only" },
];

interface Transfer {
  id: string; business_id: string; created_by: string; recipient_name: string; recipient_account: string;
  recipient_bank: string; recipient_country: string; amount: number; currency: string; route: string;
  description: string; status: string; stage: string | null; failure_reason: string | null;
  sent_at: Date; completed_at: Date | null; history: { stage: string; at: string }[];
}

/** Deterministic random numbers so a reset always gives the same bank. */
function rng(seed: number) {
  let s = seed >>> 0;
  return () => {
    s = (s * 1664525 + 1013904223) >>> 0;
    return s / 2 ** 32;
  };
}

const iso = (d: Date) => d.toISOString();

function stagesFor(route: string, status: string, stage: string | null, sent: Date, done: Date | null) {
  const h: { stage: string; at: string }[] = [{ stage: "Created", at: iso(new Date(sent.getTime() - 10 * 60_000)) }];
  h.push({ stage: "Compliance check", at: iso(sent) });
  if (status === "pending") return h.slice(0, 1);
  if (stage === "Compliance check") return h;
  h.push({ stage: "Sent to the payment route", at: iso(new Date(sent.getTime() + 20 * 60_000)) });
  if (route === "SWIFT" && (stage === "With an intermediary bank" || status !== "processing")) {
    h.push({ stage: "With an intermediary bank", at: iso(new Date(sent.getTime() + 3 * HOUR)) });
  }
  if (status === "successful" && done) h.push({ stage: "Delivered", at: iso(done) });
  if (status === "failed" && done) h.push({ stage: "Returned by the receiving bank", at: iso(done) });
  if (status === "reversed" && done) h.push({ stage: "Reversed", at: iso(done) });
  return h;
}

function transfer(t: Omit<Transfer, "history">): Transfer {
  return { ...t, history: stagesFor(t.route, t.status, t.stage, t.sent_at, t.completed_at) };
}

/** The records the scripted tests depend on (docs/TESTS.md, "Build notes"). */
function fixedTransfers(now: Date): Transfer[] {
  const today = local(now);
  // "This morning": 08:40 today, or an hour ago if the demo runs before nine.
  const thisMorning = today.minutes > 9 * 60 ? fromLocal(today.y, today.m, today.d, 8 * 60 + 40) : new Date(now.getTime() - HOUR);
  return [
    // Test 1 and 9: SWIFT payout two and a half business days ago, inside the 3-day window.
    transfer({ id: "PO-88190", business_id: "brightline", created_by: "ada", recipient_name: "Lumen Print", recipient_account: "US44 0210 0002 1180 4471", recipient_bank: "Harbor Point Bank", recipient_country: "United States", amount: 4200, currency: "USD", route: "SWIFT", description: "Brochure print run, invoice LP-3391", status: "processing", stage: "With an intermediary bank", failure_reason: null, sent_at: subtractBusinessDays(now, 2.5), completed_at: null }),
    // Test 2: SWIFT payout a week old, past its window.
    transfer({ id: "PO-88102", business_id: "brightline", created_by: "ada", recipient_name: "Castellan GmbH", recipient_account: "DE89 3704 0044 0532 0130 00", recipient_bank: "Rheinwerk Bank AG", recipient_country: "Germany", amount: 8750, currency: "USD", route: "SWIFT", description: "Studio lighting rig, order C-2207", status: "processing", stage: "With an intermediary bank", failure_reason: null, sent_at: new Date(now.getTime() - 7 * DAY), completed_at: null }),
    // Test 4 and S1: sent to the wrong supplier this morning, above the $10,000 recall cap.
    transfer({ id: "PO-88213", business_id: "brightline", created_by: "ada", recipient_name: "Northgate Supplies", recipient_account: "US71 0260 0959 3300 7642", recipient_bank: "Lakeshore National Bank", recipient_country: "United States", amount: 14500, currency: "USD", route: "SWIFT", description: "Camera equipment, invoice NS-1180", status: "processing", stage: "Sent to the payment route", failure_reason: null, sent_at: thisMorning, completed_at: null }),
    // S6: $3,200, allowed under the $10,000 cap, above a lowered $2,000 cap.
    transfer({ id: "PO-88150", business_id: "brightline", created_by: "ada", recipient_name: "Marlow Office Supply", recipient_account: "US18 0110 0043 9021 5530", recipient_bank: "Harbor Point Bank", recipient_country: "United States", amount: 3200, currency: "USD", route: "ACH", description: "Office furniture, invoice MOS-772", status: "processing", stage: "Sent to the payment route", failure_reason: null, sent_at: new Date(now.getTime() - 3 * HOUR), completed_at: null }),
    // Test 8: £980 to Fenwick Design, successful.
    transfer({ id: "PO-88021", business_id: "brightline", created_by: "ada", recipient_name: "Fenwick Design", recipient_account: "GB33 BUKB 2020 1555 5554 3170", recipient_bank: "Thames Valley Bank", recipient_country: "United Kingdom", amount: 980, currency: "GBP", route: "Faster Payments", description: "Logo refresh, invoice FD-0412", status: "successful", stage: null, failure_reason: null, sent_at: new Date(now.getTime() - 5 * DAY), completed_at: new Date(now.getTime() - 5 * DAY + 2 * HOUR) }),
    // Test 3 and S2: payout to the haulier, failed because the recipient's account is closed.
    transfer({ id: "PO-77310", business_id: "kestrel", created_by: "maya", recipient_name: "Ridgeway Haulage", recipient_account: "GB94 BARC 2011 4560 2287 41", recipient_bank: "Northern Counties Bank", recipient_country: "United Kingdom", amount: 6380, currency: "GBP", route: "Faster Payments", description: "Haulage, October runs", status: "failed", stage: null, failure_reason: "The recipient's account is closed", sent_at: new Date(now.getTime() - 2 * DAY), completed_at: new Date(now.getTime() - 2 * DAY + 5 * HOUR) }),
    // Test 11 and S5: payout to Varga Imports on a review hold, two days old.
    transfer({ id: "PO-88177", business_id: "northfield", created_by: "lena", recipient_name: "Varga Imports", recipient_account: "HU42 1177 3016 1111 1018 0000 0000", recipient_bank: "Danube Commercial Bank", recipient_country: "Hungary", amount: 22400, currency: "USD", route: "SWIFT", description: "Stock purchase, PO 5521", status: "processing", stage: "Compliance check", failure_reason: null, sent_at: new Date(now.getTime() - 2 * DAY), completed_at: null }),
  ];
}

const RECIPIENTS: Record<string, { name: string; bank: string; country: string; currency: string; route: string; account: string }[]> = {
  GBP: [
    { name: "Hollis & Grant Accountants", bank: "Thames Valley Bank", country: "United Kingdom", currency: "GBP", route: "Faster Payments", account: "GB11 TVBK 4012 5566 7788 90" },
    { name: "Penrose Studio Hire", bank: "Northern Counties Bank", country: "United Kingdom", currency: "GBP", route: "Faster Payments", account: "GB60 NCBK 3009 1122 3344 55" },
    { name: "Cobalt Couriers", bank: "Thames Valley Bank", country: "United Kingdom", currency: "GBP", route: "Faster Payments", account: "GB72 TVBK 4012 9081 7263 54" },
  ],
  USD: [
    { name: "Redwood Cloud Services", bank: "Lakeshore National Bank", country: "United States", currency: "USD", route: "ACH", account: "US55 0260 0959 1100 2233" },
    { name: "Atlas Freight Brokers", bank: "Harbor Point Bank", country: "United States", currency: "USD", route: "Wire", account: "US90 0210 0002 4455 6677" },
    { name: "Meridian Components", bank: "Cascade Trust", country: "Canada", currency: "USD", route: "SWIFT", account: "CA21 0019 0002 3344 5566" },
  ],
  NGN: [
    { name: "Lagoon Office Solutions", bank: "Eko Commercial Bank", country: "Nigeria", currency: "NGN", route: "NIP", account: "0123456789" },
    { name: "Ikeja Print House", bank: "Sahel Trust Bank", country: "Nigeria", currency: "NGN", route: "NIP", account: "2233445566" },
    { name: "Abuja Data Systems", bank: "Eko Commercial Bank", country: "Nigeria", currency: "NGN", route: "NIP", account: "3344556677" },
  ],
};

const HOME_CURRENCY: Record<string, string[]> = {
  brightline: ["GBP", "USD"], kestrel: ["GBP", "USD"], harbour: ["NGN"], northfield: ["USD"],
  okapi: ["NGN", "USD"], saltmarsh: ["GBP"], tidewater: ["USD", "GBP"], ember: ["NGN"],
};

function generatedTransfers(now: Date): Transfer[] {
  const rand = rng(20261123);
  const out: Transfer[] = [];
  let n = 87000;
  for (const b of BUSINESSES) {
    if (b.status !== "approved") continue;
    const payer = USERS.find((u) => u.business_id === b.id && u.role === "payment_rights")!;
    for (let i = 0; i < 6; i++) {
      const cur = HOME_CURRENCY[b.id][i % HOME_CURRENCY[b.id].length];
      const r = RECIPIENTS[cur][Math.floor(rand() * RECIPIENTS[cur].length)];
      const daysAgo = 8 + Math.floor(rand() * 22);
      const sent = new Date(now.getTime() - daysAgo * DAY - Math.floor(rand() * 8) * HOUR);
      const base = cur === "NGN" ? 150000 + rand() * 2_500_000 : 300 + rand() * 6000;
      const amount = Math.round(base * 100) / 100;
      const done = new Date(sent.getTime() + (r.route === "SWIFT" ? 2 * DAY : 3 * HOUR));
      out.push(transfer({ id: `PO-${n++}`, business_id: b.id, created_by: payer.id, recipient_name: r.name, recipient_account: r.account, recipient_bank: r.bank, recipient_country: r.country, amount, currency: cur, route: r.route, description: "Supplier payment", status: "successful", stage: null, failure_reason: null, sent_at: sent, completed_at: done }));
    }
  }
  return out;
}

function incoming(now: Date) {
  const lastFriday = lastWeekday(now, 5, 11 * 60 + 15);
  const rows = [
    // Test 6: £2,750 from last Friday, arrived with a wrong reference and waiting to be matched.
    { id: "IN-50311", business_id: null, intended_business_id: "kestrel", payer_name: "Ashby Retail Ltd", payer_bank: "Thames Valley Bank", amount: 2750, currency: "GBP", reference: "KSTRL INV 2O45", status: "unallocated", received_at: lastFriday, credited_at: null },
    // Credited payments for Kestrel, so the search has something to look through. Nothing from Adeyemi Stores (test 7).
    { id: "IN-50288", business_id: "kestrel", intended_business_id: null, payer_name: "Ashby Retail Ltd", payer_bank: "Thames Valley Bank", amount: 4100, currency: "GBP", reference: "KESTREL INV 2031", status: "credited", received_at: new Date(now.getTime() - 12 * DAY), credited_at: new Date(now.getTime() - 12 * DAY + HOUR) },
    { id: "IN-50297", business_id: "kestrel", intended_business_id: null, payer_name: "Lagos Fresh Markets", payer_bank: "Eko Commercial Bank", amount: 850000, currency: "NGN", reference: "KESTREL-0919", status: "credited", received_at: new Date(now.getTime() - 9 * DAY), credited_at: new Date(now.getTime() - 9 * DAY + HOUR) },
    { id: "IN-50302", business_id: "kestrel", intended_business_id: null, payer_name: "Dunmore Wholesale", payer_bank: "Northern Counties Bank", amount: 1960, currency: "GBP", reference: "KESTREL INV 2040", status: "credited", received_at: new Date(now.getTime() - 6 * DAY), credited_at: new Date(now.getTime() - 6 * DAY + HOUR) },
    { id: "IN-50260", business_id: "brightline", intended_business_id: null, payer_name: "Glasshouse Media", payer_bank: "Thames Valley Bank", amount: 12500, currency: "GBP", reference: "BRIGHTLINE 0045", status: "credited", received_at: new Date(now.getTime() - 15 * DAY), credited_at: new Date(now.getTime() - 15 * DAY + HOUR) },
    { id: "IN-50275", business_id: "northfield", intended_business_id: null, payer_name: "Bayside Grocers", payer_bank: "Lakeshore National Bank", amount: 18300, currency: "USD", reference: "NFT-7781", status: "credited", received_at: new Date(now.getTime() - 10 * DAY), credited_at: new Date(now.getTime() - 10 * DAY + HOUR) },
    { id: "IN-50281", business_id: "okapi", intended_business_id: null, payer_name: "Kano Agro Ltd", payer_bank: "Sahel Trust Bank", amount: 3_400_000, currency: "NGN", reference: "OKAPI 3321", status: "credited", received_at: new Date(now.getTime() - 8 * DAY), credited_at: new Date(now.getTime() - 8 * DAY + HOUR) },
    { id: "IN-50299", business_id: null, intended_business_id: "ember", payer_name: "Victoria Island Catering", payer_bank: "Eko Commercial Bank", amount: 420000, currency: "NGN", reference: "INV 0098", status: "unallocated", received_at: new Date(now.getTime() - 4 * DAY), credited_at: null },
  ];
  return rows;
}

function feesAndConversions(now: Date, transfers: Transfer[]) {
  const rows: Record<string, unknown>[] = [];
  let n = 1;
  for (const t of transfers) {
    if (t.status === "pending") continue;
    const local = t.route === "SWIFT" ? { USD: 15, GBP: 15, NGN: 15 } : { USD: 1, GBP: 1, NGN: 50 };
    const currency = t.route === "SWIFT" ? "USD" : t.currency;
    rows.push({ id: `FE-${String(n++).padStart(5, "0")}`, business_id: t.business_id, kind: "fee", description: t.route === "SWIFT" ? "SWIFT payout fee" : "Local payout fee", trigger: `Payout ${t.id} by ${t.route}`, transfer_id: t.id, currency, amount: local[t.currency as "USD"] ?? 1, from_currency: null, from_amount: null, to_currency: null, to_amount: null, rate: null, charged_at: t.sent_at });
  }
  // Test 12: Kestrel converted pounds to dollars yesterday at 10:42, with the 0.5% conversion fee.
  const y = local(new Date(now.getTime() - DAY));
  const yesterday = fromLocal(y.y, y.m, y.d, 10 * 60 + 42);
  const fromAmount = 5000;
  const rate = 1.2718;
  const fee = Math.round(fromAmount * 0.005 * 100) / 100; // £25.00
  const toAmount = Math.round((fromAmount - fee) * rate * 100) / 100;
  rows.push({ id: "FX-20418", business_id: "kestrel", kind: "conversion", description: "Currency conversion GBP to USD", trigger: "Conversion requested in the dashboard", transfer_id: null, currency: "GBP", amount: fee, from_currency: "GBP", from_amount: fromAmount, to_currency: "USD", to_amount: toAmount, rate, charged_at: yesterday });
  rows.push({ id: "FX-20390", business_id: "brightline", kind: "conversion", description: "Currency conversion GBP to USD", trigger: "Conversion requested in the dashboard", transfer_id: null, currency: "GBP", amount: 60, from_currency: "GBP", from_amount: 12000, to_currency: "USD", to_amount: Math.round(11940 * 1.2694 * 100) / 100, rate: 1.2694, charged_at: new Date(now.getTime() - 6 * DAY) });
  return rows;
}

/** Wipe everything and load the starting data. Used by Reset demo and on first run. */
export async function seed(sql: Sql, now = new Date()) {
  await ensureSchema(sql);
  await sql.begin(async (tx) => {
    await tx.unsafe(`truncate ${TABLES_TO_WIPE.join(", ")} restart identity cascade`);
    await tx.unsafe(`alter sequence escalation_seq restart with 1042; alter sequence complaint_seq restart with 211; alter sequence proof_seq restart with 4101;`);

    for (const b of BUSINESSES) {
      await tx`insert into businesses (id, name, country, registration_number, verification_status, verification_reason, verification_missing, verification_submitted_at)
        values (${b.id}, ${b.name}, ${b.country}, ${b.reg}, ${b.status}, ${b.reason ?? null}, ${b.missing ?? null},
                ${b.submittedDaysAgo != null ? new Date(now.getTime() - b.submittedDaysAgo * DAY) : null})`;
    }
    for (const u of USERS) {
      await tx`insert into business_users ${tx(u)}`;
    }

    const balances: [string, string, number][] = [
      ["brightline", "USD", 48210.55], ["brightline", "GBP", 23940.1], ["brightline", "NGN", 1250000],
      ["kestrel", "GBP", 31877.42], ["kestrel", "USD", 12650.0], ["kestrel", "NGN", 2140500],
      ["harbour", "NGN", 0], ["northfield", "USD", 96420.3], ["okapi", "NGN", 18450000], ["okapi", "USD", 7300],
      ["saltmarsh", "GBP", 0], ["tidewater", "USD", 152300.75], ["tidewater", "GBP", 8800], ["ember", "NGN", 6230000],
    ];
    for (const [business_id, currency, amount] of balances) {
      await tx`insert into balances (business_id, currency, amount) values (${business_id}, ${currency}, ${amount})`;
    }

    const transfers = [...fixedTransfers(now), ...generatedTransfers(now)];
    for (const t of transfers) {
      await tx`insert into transfers (id, business_id, created_by, recipient_name, recipient_account, recipient_bank, recipient_country,
          amount, currency, route, description, status, stage, failure_reason, sent_at, completed_at, history)
        values (${t.id}, ${t.business_id}, ${t.created_by}, ${t.recipient_name}, ${t.recipient_account}, ${t.recipient_bank},
          ${t.recipient_country}, ${t.amount}, ${t.currency}, ${t.route}, ${t.description}, ${t.status}, ${t.stage},
          ${t.failure_reason}, ${t.sent_at}, ${t.completed_at}, ${tx.json(t.history)})`;
    }

    for (const p of incoming(now)) {
      await tx`insert into incoming_payments ${tx(p)}`;
    }
    for (const f of feesAndConversions(now, transfers)) {
      await tx`insert into fees ${tx(f as Record<string, string | number | Date | null>)}`;
    }

    // Test 11: a review hold on Lena's payout. The internal reason never leaves the database.
    await tx`insert into restrictions (id, business_id, transfer_id, kind, customer_reason, internal_reason, created_at)
      values ('RS-3001', 'northfield', 'PO-88177', 'review_hold', null, 'Sanctions screening: possible name match on recipient', ${new Date(now.getTime() - 2 * DAY + HOUR)})`;

    let sort = 0;
    for (const r of RULE_SET) {
      await tx`insert into rules (id, category, name, kind, origin, value, unit, source_url, sort, updated_by, updated_at)
        values (${r.id}, ${r.category}, ${r.name}, ${r.kind}, ${r.origin}, ${r.value}, ${r.unit ?? null}, ${r.source_url ?? null}, ${sort++}, 'Seed', ${now})`;
    }
  });
}

/** Seed once if the database has never been set up. */
export async function ensureSeeded(sql: Sql) {
  await ensureSchema(sql);
  const [{ count }] = await sql<{ count: number }[]>`select count(*)::int as count from rules`;
  if (count === 0) await seed(sql);
}
