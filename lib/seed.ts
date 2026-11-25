import { createHash } from "node:crypto";
import type { Sql } from "./db.ts";
import { SCHEMA, TABLES_TO_WIPE } from "./schema.ts";
import { RULE_SET, SEED_OVERRIDES } from "./ruleSet.ts";
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

/**
 * Personal (retail) customers for the use cases after the demo (Tools and Data Spec, "Planted cases for
 * the MVP"). Each holds one account; the second identity fact is its last 4 digits.
 */
export const PERSONAL = [
  { id: "chioma", name: "Chioma Eze", dob: "1991-04-12", account: "0123456789", currency: "NGN", tier: 1, phone: "+234 803 555 0142", email: "chioma.eze@example.com", note: "Lost card, duplicate hold, POS debited without value, below the tier for a transfer" },
  { id: "emeka", name: "Emeka Obi", dob: "1986-09-03", account: "2087654321", currency: "NGN", tier: 3, phone: "+234 806 555 0177", email: "emeka.obi@example.com", note: "Daily limit decline, ATM reversal done, waivable fee, loan, locked login" },
  { id: "grace", name: "Grace Mensah", dob: "1990-02-27", account: "GB82 WEST 1234 5698 7654 32", currency: "GBP", tier: null, phone: "+44 7700 900461", email: "grace.mensah@example.com", note: "Genuine duplicate, unrecognised merchant, waiver already used" },
  { id: "david", name: "David Park", dob: "1983-12-19", account: "US64 0210 0002 7700 1234", currency: "USD", tier: null, phone: "+1 202 555 0193", email: "david.park@example.com", note: "Transfers: late, failed and reversed, above the cap; KYC document rejected" },
  { id: "amara", name: "Amara Nwosu", dob: "1995-06-08", account: "3011223344", currency: "NGN", tier: 2, phone: "+234 809 555 0118", email: "amara.nwosu@example.com", note: "Wrong recipient, airtime not delivered, USSD transfer" },
] as const;

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
  await sql.begin(async (tx) => {
    await tx`select pg_advisory_xact_lock(4207)`;
    await tx.unsafe(SCHEMA);
    await seedInto(tx, now);
  });
}

// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function seedInto(tx: any, now: Date) {
  {
    await tx.unsafe(`truncate ${TABLES_TO_WIPE.join(", ")} restart identity cascade`);
    await tx.unsafe(`alter sequence escalation_seq restart with 1042; alter sequence complaint_seq restart with 211; alter sequence proof_seq restart with 4101; alter sequence recall_seq restart with 5001; alter sequence dispute_seq restart with 7001; alter sequence replacement_seq restart with 3301; alter sequence reversal_seq restart with 8101; alter sequence waiver_seq restart with 9201; alter sequence deferral_seq restart with 4401; alter sequence claim_seq restart with 6601; alter sequence bill_refund_seq restart with 2201;`);

    for (const b of BUSINESSES) {
      await tx`insert into businesses (id, name, country, registration_number, verification_status, verification_reason, verification_missing, verification_submitted_at)
        values (${b.id}, ${b.name}, ${b.country}, ${b.reg}, ${b.status}, ${b.reason ?? null}, ${b.missing ?? null},
                ${b.submittedDaysAgo != null ? new Date(now.getTime() - b.submittedDaysAgo * DAY) : null})`;
    }
    for (const u of USERS) {
      await tx`insert into business_users ${tx(u)}`;
    }
    for (const c of PERSONAL) {
      await tx`insert into businesses (id, name, country, kind, account_number, kyc_tier, verification_status)
        values (${c.id}, ${c.name + " (personal)"}, ${c.currency === "NGN" ? "Nigeria" : c.currency === "GBP" ? "United Kingdom" : "United States"},
                'personal', ${c.account}, ${c.tier}, ${c.id === "david" ? "failed" : "approved"})`;
      await tx`insert into business_users (id, business_id, full_name, first_name, date_of_birth, role, phone, email)
        values (${c.id}, ${c.id}, ${c.name}, ${c.name.split(" ")[0]}, ${c.dob}, 'payment_rights', ${c.phone}, ${c.email})`;
    }
    await seedCards(tx, now);
    await seedPayments(tx, now);
    await seedFeesAndLimits(tx, now);
    await seedTimelines(tx, now);
    await seedLoansAndPayouts(tx, now);
    await seedRetailTransfers(tx, now);
    await seedBillsAndUssd(tx, now);
    await seedCheckouts(tx, now);
    // The sample team, one per role (invented people). Accounts survive Reset demo; they can sign in once an admin
    // gives them a password (Team page: "Let the sample team sign in").
    await tx`insert into staff_users (id, name, role, email, demo) values
      ('ife', 'Ife Adeyemi', 'support_agent', 'ife@yourbank.example', true),
      ('bayo', 'Bayo Martins', 'supervisor', 'bayo@yourbank.example', true),
      ('zainab', 'Zainab Bello', 'operations_admin', 'zainab@yourbank.example', true),
      ('lara', 'Lara Cole', 'compliance', 'lara@yourbank.example', true),
      ('musa', 'Musa Danjuma', 'management', 'musa@yourbank.example', true),
      ('dayo', 'Dayo Akin', 'it_admin', 'dayo@yourbank.example', true)
      on conflict (id) do nothing`;

    // Planted case 9: Emeka's online access is locked after failed sign-ins.
    await tx`update business_users set login_locked = 'failed_logins' where id = 'emeka'`;
    for (const u of USERS) {
      const digits = String(Math.abs([...u.id].reduce((h, ch) => (h * 31 + ch.charCodeAt(0)) | 0, 7))).slice(-4).padStart(4, "0");
      await tx`update business_users set phone = ${"+44 7700 90" + digits}, email = ${u.first_name.toLowerCase() + "@" + u.business_id + ".example.com"} where id = ${u.id}`;
    }

    const balances: [string, string, number][] = [
      ["brightline", "USD", 48210.55], ["brightline", "GBP", 23940.1], ["brightline", "NGN", 1250000],
      ["kestrel", "GBP", 31877.42], ["kestrel", "USD", 12650.0], ["kestrel", "NGN", 2140500],
      ["harbour", "NGN", 0], ["northfield", "USD", 96420.3], ["okapi", "NGN", 18450000], ["okapi", "USD", 7300],
      ["saltmarsh", "GBP", 0], ["tidewater", "USD", 152300.75], ["tidewater", "GBP", 8800], ["ember", "NGN", 6230000],
      ["chioma", "NGN", 184250.5], ["emeka", "NGN", 942100], ["grace", "GBP", 2310.44], ["david", "USD", 5870.12], ["amara", "NGN", 61300],
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

    // Harbour and Vine can't move money until verification is complete: a restriction it can fix.
    await tx`insert into restrictions (id, business_id, transfer_id, kind, customer_reason, internal_reason, created_at)
      values ('RS-2990', 'harbour', null, 'customer_fixable', 'Payouts and incoming payments are paused until business verification is complete. Upload the missing ownership document in the dashboard under Verification.', null, ${new Date(now.getTime() - 4 * DAY)})`;

    // Test 11: a review hold on Lena's payout. The internal reason never leaves the database.
    await tx`insert into restrictions (id, business_id, transfer_id, kind, customer_reason, internal_reason, created_at)
      values ('RS-3001', 'northfield', 'PO-88177', 'review_hold', null, 'Sanctions screening: possible name match on recipient', ${new Date(now.getTime() - 2 * DAY + HOUR)})`;

    let sort = 0;
    for (const r of RULE_SET) {
      await tx`insert into rules (id, category, name, kind, origin, value, unit, source_url, sort, updated_by, updated_at)
        values (${r.id}, ${r.category}, ${r.name}, ${r.kind}, ${r.origin}, ${r.value}, ${r.unit ?? null}, ${r.source_url ?? null}, ${sort++}, 'Seed', ${now})`;
    }
    for (const o of SEED_OVERRIDES) {
      await tx`insert into rule_overrides (rule_id, market, value, updated_by, updated_at) values (${o.rule}, ${o.market}, ${o.value}, 'Seed', ${now})`;
    }
  }
}

const ready = globalThis as unknown as { __orchestraReady?: Promise<void> };

/**
 * Create and seed the database the first time it is used. Runs once per server process; a
 * Postgres advisory lock stops two first visitors from seeding at the same time.
 */
/** A fingerprint of the schema: the database records the one it has, so unchanged schemas aren't re-run. */
export const SCHEMA_VERSION = createHash("sha256").update(SCHEMA).update(JSON.stringify(RULE_SET.map((r) => r.id))).update(JSON.stringify(SEED_OVERRIDES)).digest("hex").slice(0, 16);

/**
 * Make sure the tables exist and the sample bank is loaded, once per server process. Serverless hosts
 * start new processes all the time, and the schema's ALTERs take table locks that queue every other
 * request behind them, so the common case is one quick read: the schema version is current and the
 * bank is seeded, nothing to do.
 */
export function ensureSeeded(sql: Sql): Promise<void> {
  if (!ready.__orchestraReady) {
    ready.__orchestraReady = (async () => {
      try {
        const [row] = await sql<{ value: string; n: number }[]>`
          select value, (select count(*)::int from rules) as n from app_meta where key = 'schema_version'`;
        if (row?.value === SCHEMA_VERSION && row.n > 0) return;
      } catch {
        // No app_meta table yet (a new database, or one from before it existed): set up below.
      }
      // Schema and first seed in one transaction under one lock: the schema's ALTERs and the seed's
      // TRUNCATE take table locks in different orders, so they must never overlap between processes.
      await sql.begin(async (tx) => {
        await tx`select pg_advisory_xact_lock(4207)`;
        await tx`set local lock_timeout = '20s'`;
        await tx.unsafe(SCHEMA);
        const [{ n }] = await tx<{ n: number }[]>`select count(*)::int as n from rules`;
        if (n === 0) await seedInto(tx, new Date());
        else {
          // Rules added in a new version reach a database seeded before them; edited values are kept.
          let sort = 0;
          const added = new Set<string>();
          for (const r of RULE_SET) {
            const ins = await tx`insert into rules (id, category, name, kind, origin, value, unit, source_url, sort)
              values (${r.id}, ${r.category}, ${r.name}, ${r.kind}, ${r.origin}, ${r.value}, ${r.unit ?? null}, ${r.source_url ?? null}, ${sort++})
              on conflict (id) do nothing returning id`;
            if (ins.length) added.add(r.id);
          }
          // A new rule's market values come with it; a market value someone removed stays removed.
          for (const o of SEED_OVERRIDES.filter((x) => added.has(x.rule))) {
            await tx`insert into rule_overrides (rule_id, market, value, updated_by) values (${o.rule}, ${o.market}, ${o.value}, 'Seed') on conflict do nothing`;
          }
        }
        await tx`insert into app_meta (key, value) values ('schema_version', ${SCHEMA_VERSION})
          on conflict (key) do update set value = excluded.value`;
      });
    })().catch((err) => {
      ready.__orchestraReady = undefined; // try again on the next request
      throw err;
    });
  }
  return ready.__orchestraReady;
}

// ---------------------------------------------------------------- use cases 1 and 2

const H = 3_600_000;

/** Cards and card transactions for the personal customers, with planted cases 1 to 5. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function seedCards(tx: any, now: Date) {
  const cards = [
    { id: "CARD-4421", holder_id: "chioma", last4: "4421", currency: "NGN", daily_limit: 500000, delivery_address: "14 Admiralty Way, Lekki Phase 1, Lagos" },
    { id: "CARD-7710", holder_id: "emeka", last4: "7710", currency: "NGN", daily_limit: 200000, delivery_address: "3 Aminu Kano Crescent, Wuse 2, Abuja" },
    { id: "CARD-3307", holder_id: "grace", last4: "3307", currency: "GBP", daily_limit: 1500, delivery_address: "Flat 4, 22 Pratt Street, Camden, London", online_payments: false },
    { id: "CARD-9902", holder_id: "david", last4: "9902", currency: "USD", daily_limit: 2500, delivery_address: "418 Elm Street, Arlington, Virginia" },
    { id: "CARD-5150", holder_id: "amara", last4: "5150", currency: "NGN", daily_limit: 300000, delivery_address: "9 Ogui Road, Enugu" },
  ];
  for (const c of cards) {
    // Grace's card has online payments switched off (planted: why her online payment was declined).
    await tx`insert into cards (id, holder_id, last4, status, currency, daily_limit, delivery_address, online_payments, created_at)
      values (${c.id}, ${c.holder_id}, ${c.last4}, 'active', ${c.currency}, ${c.daily_limit}, ${c.delivery_address}, ${"online_payments" in c ? c.online_payments : true}, ${new Date(now.getTime() - 300 * 86_400_000)})`;
  }
  const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * H);
  const rows: [string, string, string, string, string | null, string | null, string, number, string, string, string | null, Date][] = [
    // id, holder, card, descriptor, merchant name, location, channel, amount, currency, status, decline reason, at
    // Planted 1: Chioma lost her card yesterday evening; two payments after the loss aren't hers.
    ["TX-90011", "chioma", "CARD-4421", "MOBIL LEKKI", "Mobil filling station", "Lekki, Lagos", "POS", 18500, "NGN", "settled", null, at(40)],
    ["TX-90012", "chioma", "CARD-4421", "LEKKI GADGETS HUB", "Lekki Gadgets Hub", "Lekki, Lagos", "POS", 85000, "NGN", "settled", null, at(9)],
    ["TX-90013", "chioma", "CARD-4421", "QUICKBITE*LAGOS", "QuickBite Lagos (food delivery)", "Online", "web", 12500, "NGN", "settled", null, at(7)],
    // Planted 3: a duplicate where one is a pending hold.
    ["TX-90014", "chioma", "CARD-4421", "SHOPRITE LEKKI", "Shoprite, Lekki", "Lekki, Lagos", "POS", 23400, "NGN", "settled", null, at(50)],
    ["TX-90015", "chioma", "CARD-4421", "SHOPRITE LEKKI", "Shoprite, Lekki", "Lekki, Lagos", "POS", 23400, "NGN", "pending", null, at(49.9)],
    // Planted 2: Emeka's card declined for reaching the daily limit.
    ["TX-90021", "emeka", "CARD-7710", "JUMIA ONLINE", "Jumia (online store)", "Online", "web", 180000, "NGN", "settled", null, at(5)],
    ["TX-90022", "emeka", "CARD-7710", "JUMIA ONLINE", "Jumia (online store)", "Online", "web", 65000, "NGN", "declined", "Daily spending limit reached (₦200,000 a day)", at(2)],
    ["TX-90023", "emeka", "CARD-7710", "CHICKEN REP WUSE", "Chicken Republic, Wuse", "Abuja", "POS", 7800, "NGN", "settled", null, at(30)],
    // Planted 4: Grace's genuine duplicate, both settled.
    ["TX-90031", "grace", "CARD-3307", "HOLLOW TREE BOOKS", "Hollow Tree Books", "Camden, London", "card", 42.99, "GBP", "settled", null, at(72)],
    ["TX-90032", "grace", "CARD-3307", "HOLLOW TREE BOOKS", "Hollow Tree Books", "Camden, London", "card", 42.99, "GBP", "settled", null, at(71.98)],
    // Planted 5: an unrecognised statement name that is a known merchant under another name.
    ["TX-90033", "grace", "CARD-3307", "PP*NBLX 0294 LONDON", "Nimble Bikes Ltd (bike hire, paid through a payment processor)", "Online, London", "web", 29.0, "GBP", "settled", null, at(26)],
    ["TX-90034", "grace", "CARD-3307", "TFL TRAVEL CH", "Transport for London (contactless travel)", "London", "card", 7.8, "GBP", "settled", null, at(20)],
    // Planted: an online payment declined because online payments are switched off on her card.
    ["TX-90035", "grace", "CARD-3307", "RIVERSIDE FLORIST", "Riverside Florist", "Online, London", "web", 64, "GBP", "declined", "Online payments are switched off on this card", at(50)],
    ["TX-90041", "david", "CARD-9902", "GROCERY OUTLET", "Grocery Outlet", "Arlington, VA", "card", 63.12, "USD", "settled", null, at(30)],
    ["TX-90051", "amara", "CARD-5150", "SPAR ENUGU", "Spar, Enugu", "Enugu", "POS", 15200, "NGN", "settled", null, at(28)],
  ];
  for (const r of rows) {
    await tx`insert into transactions (id, holder_id, card_id, descriptor, merchant_name, location, channel, amount, currency, status, decline_reason, at)
      values (${r[0]}, ${r[1]}, ${r[2]}, ${r[3]}, ${r[4]}, ${r[5]}, ${r[6]}, ${r[7]}, ${r[8]}, ${r[9]}, ${r[10]}, ${r[11]})`;
  }
}

// ---------------------------------------------------------------- use case 12 (and 9, 11 later)

/** Card, POS, ATM and web payments, with planted cases 16 and 17. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function seedPayments(tx: any, now: Date) {
  const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * H);
  const rows = [
    // Planted 16: Chioma's POS payment declined at the merchant but debited, no reversal after 72 hours.
    { id: "PAY-61001", holder_id: "chioma", channel: "POS", merchant_name: "Mama Cass Kitchen", location: "Allen Avenue, Ikeja, Lagos", terminal_bank: "Eko Commercial Bank", processor: "Interswitch-style switch (simulated)", card_last4: "4421", amount: 18750, currency: "NGN", outcome: "failed_debited", failure_detail: "Terminal showed 'Transaction declined'; the account was debited", at: at(4 * 24 + 3) },
    // Planted 17: Emeka's withdrawal at another bank's ATM, debited without cash, already reversed.
    { id: "PAY-61002", holder_id: "emeka", channel: "ATM", merchant_name: "Sahel Trust Bank ATM", location: "Wuse Market, Abuja", terminal_bank: "Sahel Trust Bank", processor: "Interbank ATM network (simulated)", card_last4: "7710", amount: 40000, currency: "NGN", outcome: "failed_debited", failure_detail: "No cash dispensed; the account was debited", at: at(3 * 24) },
    // Ordinary successful payments, so a search has something to look through.
    { id: "PAY-61003", holder_id: "chioma", channel: "web", merchant_name: "Konga (online store)", location: "Online", terminal_bank: null, processor: "Card processor (simulated)", card_last4: "4421", amount: 32000, currency: "NGN", outcome: "successful", failure_detail: null, at: at(6 * 24) },
    { id: "PAY-61004", holder_id: "emeka", channel: "POS", merchant_name: "Chicken Republic, Wuse", location: "Abuja", terminal_bank: "Sahel Trust Bank", processor: "Interswitch-style switch (simulated)", card_last4: "7710", amount: 7800, currency: "NGN", outcome: "successful", failure_detail: null, at: at(30) },
  ];
  for (const r of rows) await tx`insert into payments ${tx(r)}`;
  await tx`insert into reversals (reference, payment_id, holder_id, amount, currency, status, automatic, requested_at, completed_at)
    values ('REV-8001', 'PAY-61002', 'emeka', 40000, 'NGN', 'completed', true, ${at(3 * 24)}, ${at(2 * 24 + 2)})`;
}

// ---------------------------------------------------------------- use cases 5 and 15 (and 6 for personal)

/** Personal fees (planted 11 and 12), and the KYC record for planted 13. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function seedFeesAndLimits(tx: any, now: Date) {
  const day = 86_400_000;
  const fees = [
    // Planted 11: Emeka's waivable fee, first request.
    { id: "FE-P0101", business_id: "emeka", kind: "fee", description: "Account maintenance fee", trigger: "Monthly account maintenance, November", currency: "NGN", amount: 1050, charged_at: new Date(now.getTime() - 3 * day), waivable: true },
    { id: "FE-P0102", business_id: "emeka", kind: "fee", description: "SMS alert fee", trigger: "Transaction alerts, October", currency: "NGN", amount: 480, charged_at: new Date(now.getTime() - 20 * day), waivable: false },
    // Planted 12: Grace's waivable fee, but she used this year's goodwill waiver in July.
    { id: "FE-P0201", business_id: "grace", kind: "fee", description: "Unarranged overdraft fee", trigger: "Balance went below zero on 17 November", currency: "GBP", amount: 15, charged_at: new Date(now.getTime() - 6 * day), waivable: true },
    { id: "FE-P0202", business_id: "grace", kind: "fee", description: "Unarranged overdraft fee", trigger: "Balance went below zero in July", currency: "GBP", amount: 15, charged_at: new Date(now.getTime() - 130 * day), waivable: true },
    { id: "FE-P0301", business_id: "chioma", kind: "fee", description: "Card maintenance fee", trigger: "Quarterly card fee", currency: "NGN", amount: 150, charged_at: new Date(now.getTime() - 9 * day), waivable: false },
  ];
  for (const f of fees) await tx`insert into fees ${tx(f)}`;
  await tx`insert into waivers (reference, fee_id, holder_id, amount, currency, created_at)
    values ('WVR-9100', 'FE-P0202', 'grace', 15, 'GBP', ${new Date(now.getTime() - 128 * day)})`;
  // Planted 13: David's verification failed on a blurry document.
  await tx`update businesses set verification_reason = 'Document unreadable: the photo of the driving licence was blurry',
    verification_missing = 'a clear photo of the front and back of the driving licence, all four corners visible',
    verification_submitted_at = ${new Date(now.getTime() - 5 * day)} where id = 'david'`;
}

// ---------------------------------------------------------------- use cases 9 and 11

/** One payment per failure type, plus one with a conflicting timeline (Tools and Data Spec, phase 3). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function seedTimelines(tx: any, now: Date) {
  const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * H);
  const base = { holder_id: "grace", channel: "card", location: "London", terminal_bank: null, processor: "Thames Card Processing (simulated)", card_last4: "3307", currency: "GBP" };
  const payments = [
    { ...base, id: "PAY-62001", merchant_name: "Riverside Florist", amount: 64, outcome: "declined", failure_detail: "Declined by the card issuer at authorisation", at: at(50) },
    { ...base, id: "PAY-62002", merchant_name: "Northline Rail (tickets)", amount: 38.5, outcome: "successful", failure_detail: null, at: at(98) },
    { ...base, id: "PAY-62003", merchant_name: "Camden Electronics", amount: 219, outcome: "successful", failure_detail: null, at: at(120) },
    { ...base, id: "PAY-62004", merchant_name: "Studio Nine Yoga", amount: 90, outcome: "successful", failure_detail: null, at: at(170) },
    { ...base, id: "PAY-62005", merchant_name: "Blue Fern Café", amount: 12.4, outcome: "successful", failure_detail: null, at: at(75) },
  ];
  for (const p of payments) await tx`insert into payments ${tx(p)}`;
  const ev = (payment_id: string, stage: string, status: string, reported_by: string, hoursAgo: number, detail: string | null = null) =>
    tx`insert into payment_events (payment_id, stage, status, detail, reported_by, at) values (${payment_id}, ${stage}, ${status}, ${detail}, ${reported_by}, ${at(hoursAgo)})`;
  // Declined at authorisation: the card issuer.
  await ev("PAY-62001", "authorization", "failed", "Card issuer", 50, "Declined: card's online payments setting was off");
  // Authorised but never captured: the merchant's integration.
  await ev("PAY-62002", "authorization", "ok", "Card issuer", 98);
  // Captured but not settled: the processor or acquirer.
  await ev("PAY-62003", "authorization", "ok", "Card issuer", 120);
  await ev("PAY-62003", "capture", "ok", "Merchant (Camden Electronics)", 119.5);
  // Settled but no payout: a platform or bank hold on the merchant's side.
  await ev("PAY-62004", "authorization", "ok", "Card issuer", 170);
  await ev("PAY-62004", "capture", "ok", "Merchant (Studio Nine Yoga)", 169.8);
  await ev("PAY-62004", "settlement", "ok", "Thames Card Processing", 146);
  // Conflicting: the processor reports settlement failed and settled.
  await ev("PAY-62005", "authorization", "ok", "Card issuer", 75);
  await ev("PAY-62005", "capture", "ok", "Merchant (Blue Fern Café)", 74.9);
  await ev("PAY-62005", "settlement", "failed", "Thames Card Processing", 51, "Settlement file rejected");
  await ev("PAY-62005", "settlement", "ok", "Acquiring bank (simulated)", 50);
  // The demo's own payments also get a timeline, so tracing works on them.
  await ev("PAY-61003", "authorization", "ok", "Card issuer", 6 * 24);
  await ev("PAY-61003", "capture", "ok", "Merchant (Konga)", 6 * 24 - 0.1);
  await ev("PAY-61003", "settlement", "ok", "Card processor", 5 * 24);
  await ev("PAY-61003", "payout", "ok", "Card processor", 4 * 24);
}

// ---------------------------------------------------------------- use cases 7 and 8

/** Loans (planted 14) and merchant payouts (planted 15, plus a review hold and a reconciliation). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function seedLoansAndPayouts(tx: any, now: Date) {
  const day = 86_400_000;
  const loans = [
    // Planted 14: Emeka can't pay this month.
    { id: "LN-30021", holder_id: "emeka", product: "Personal loan", currency: "NGN", principal: 1500000, balance: 912400, annual_rate: 24, monthly_payment: 79300, next_due_at: new Date(now.getTime() + 4 * day), arrears: 0, status: "current", started_at: new Date(now.getTime() - 300 * day) },
    { id: "LN-30022", holder_id: "david", product: "Car loan", currency: "USD", principal: 18000, balance: 11240.55, annual_rate: 6.9, monthly_payment: 412.2, next_due_at: new Date(now.getTime() + 12 * day), arrears: 0, status: "current", started_at: new Date(now.getTime() - 820 * day) },
  ];
  for (const l of loans) await tx`insert into loans ${tx(l)}`;
  const payouts = [
    // Planted 15: Okapi's payout delayed because the settlement bank rejected it.
    { id: "PY-21007", business_id: "okapi", amount: 2847500, currency: "NGN", scheduled_for: new Date(now.getTime() - 1 * day), status: "rejected", delay_reason: "The settlement bank rejected the payout: the account name on file doesn't match the bank's records", sales: 3125000, fees: 46875, refunds: 180625, disputes: 50000, paid_at: null },
    { id: "PY-21006", business_id: "okapi", amount: 2310000, currency: "NGN", scheduled_for: new Date(now.getTime() - 8 * day), status: "paid", delay_reason: null, sales: 2400000, fees: 36000, refunds: 54000, disputes: 0, paid_at: new Date(now.getTime() - 8 * day) },
    // Ember's payout is held for review: the reason is never shown.
    { id: "PY-21011", business_id: "ember", amount: 1188000, currency: "NGN", scheduled_for: new Date(now.getTime() - 2 * day), status: "on_hold", delay_reason: null, sales: 1220000, fees: 18300, refunds: 13700, disputes: 0, paid_at: null },
    { id: "PY-21012", business_id: "tidewater", amount: 18420.4, currency: "USD", scheduled_for: new Date(now.getTime() + 2 * day), status: "scheduled", delay_reason: null, sales: 19210, fees: 422.6, refunds: 367, disputes: 0, paid_at: null },
  ];
  for (const p of payouts) await tx`insert into merchant_payouts ${tx(p)}`;
  await tx`insert into merchant_holds (id, business_id, payout_id, amount, currency, kind, customer_reason, internal_reason, created_at) values
    ('MH-501', 'ember', 'PY-21011', 1188000, 'NGN', 'review_hold', null, 'Chargeback ratio spike under risk review', ${new Date(now.getTime() - 2 * day)}),
    ('MH-502', 'okapi', null, 50000, 'NGN', 'customer_fixable', 'Reserve for an open card dispute (DSP on 12 November); released when the dispute closes', null, ${new Date(now.getTime() - 10 * day)})`;
}

// ---------------------------------------------------------------- use cases 3 (retail) and 13

/** Personal transfers: planted 6 to 8 (David) and the delivered wrong-recipient transfer (Amara). */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function seedRetailTransfers(tx: any, now: Date) {
  const rows = [
    // Planted 6: pending past its window: ACH is same or next day, this one was sent four business days ago.
    transfer({ id: "PO-77501", business_id: "david", created_by: "david", recipient_name: "Mia Torres", recipient_account: "US02 0260 0959 4100 8812", recipient_bank: "Lakeshore National Bank", recipient_country: "United States", amount: 650, currency: "USD", route: "ACH", description: "Rent share, November", status: "processing", stage: "Sent to the payment route", failure_reason: null, sent_at: subtractBusinessDays(now, 4), completed_at: null }),
    // Planted 7: failed, and the money is already back.
    transfer({ id: "PO-77502", business_id: "david", created_by: "david", recipient_name: "Coastline Storage LLC", recipient_account: "US77 0210 0002 3300 1190", recipient_bank: "Harbor Point Bank", recipient_country: "United States", amount: 300, currency: "USD", route: "ACH", description: "Storage unit, December", status: "failed", stage: null, failure_reason: "Invalid account details; the money was returned to your account the next day", sent_at: new Date(now.getTime() - 6 * 86_400_000), completed_at: new Date(now.getTime() - 5 * 86_400_000) }),
    // Planted 8: above the personal recall cap ($1,000).
    transfer({ id: "PO-77503", business_id: "david", created_by: "david", recipient_name: "J. Whitaker", recipient_account: "US31 0110 0043 2200 6643", recipient_bank: "Harbor Point Bank", recipient_country: "United States", amount: 1800, currency: "USD", route: "RTP", description: "Used car deposit", status: "successful", stage: null, failure_reason: null, sent_at: new Date(now.getTime() - 3 * 3_600_000), completed_at: new Date(now.getTime() - 3 * 3_600_000 + 60_000) }),
    // Use case 13: Amara sent ₦85,000 to the wrong account yesterday; it was delivered.
    transfer({ id: "PO-77401", business_id: "amara", created_by: "amara", recipient_name: "Chukwudi Okeke", recipient_account: "0567123498", recipient_bank: "Sahel Trust Bank", recipient_country: "Nigeria", amount: 85000, currency: "NGN", route: "NIP", description: "School fees", status: "successful", stage: null, failure_reason: null, sent_at: new Date(now.getTime() - 26 * 3_600_000), completed_at: new Date(now.getTime() - 26 * 3_600_000 + 5_000) }),
  ];
  for (const t of rows) {
    await tx`insert into transfers (id, business_id, created_by, recipient_name, recipient_account, recipient_bank, recipient_country,
        amount, currency, route, description, status, stage, failure_reason, sent_at, completed_at, history)
      values (${t.id}, ${t.business_id}, ${t.created_by}, ${t.recipient_name}, ${t.recipient_account}, ${t.recipient_bank},
        ${t.recipient_country}, ${t.amount}, ${t.currency}, ${t.route}, ${t.description}, ${t.status}, ${t.stage},
        ${t.failure_reason}, ${t.sent_at}, ${t.completed_at}, ${tx.json(t.history)})`;
  }
}

// ---------------------------------------------------------------- use cases 14 and 16

/** Amara's airtime, electricity and USSD records, and a cash deposit at an agent that wasn't credited. */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function seedBillsAndUssd(tx: any, now: Date) {
  const at = (h: number) => new Date(now.getTime() - h * 3_600_000);
  const bills = [
    // Paid, but the airtime failed at the provider: refundable.
    { id: "BP-30101", holder_id: "amara", biller: "Skyline Mobile (airtime)", kind: "airtime", customer_ref: "08095550118", amount: 2000, currency: "NGN", status: "failed_at_provider", token: null, provider_ref: "SKY-AT-778201", at: at(20) },
    // Delivered: the electricity token is on the record.
    { id: "BP-30102", holder_id: "amara", biller: "Eastern Grid (prepaid electricity)", kind: "electricity", customer_ref: "45021187634", amount: 10000, currency: "NGN", status: "delivered", token: "4821-0937-5512-6640-2219", provider_ref: "EG-PP-120944", at: at(30) },
    // Still pending at the provider.
    { id: "BP-30103", holder_id: "amara", biller: "Skyline Mobile (data, 10GB)", kind: "data", customer_ref: "08095550118", amount: 3500, currency: "NGN", status: "pending", token: null, provider_ref: "SKY-DT-778390", at: at(0.5) },
  ];
  for (const b of bills) await tx`insert into bill_payments ${tx(b)}`;
  const sessions = [
    // A USSD transfer that failed after the debit; it continues as debited but no value.
    { id: "US-9001", holder_id: "amara", kind: "ussd", code: "*894*1#", agent_name: null, agent_id: null, location: null, action: "Transfer ₦15,000 to 2087654321", amount: 15000, currency: "NGN", outcome: "Session timed out after the debit; transfer not completed", linked_ref: null, at: at(5) },
    // Cash deposited with an agent, not credited.
    { id: "US-9002", holder_id: "amara", kind: "agent", code: null, agent_name: "Iya Basira POS Agent", agent_id: "AGT-4471", location: "Ogbete Market, Enugu", action: "Cash deposit", amount: 30000, currency: "NGN", outcome: "Agent's terminal recorded the deposit; not credited to the account", linked_ref: null, at: at(28) },
  ];
  for (const u of sessions) await tx`insert into ussd_sessions ${tx(u)}`;
}

// ---------------------------------------------------------------- a payment company's checkouts (Nov 25)

/**
 * Payments invented people made to two Nigerian merchants (Ember and Oak Foods, Okapi Logistics) at checkout:
 * one of each case a payer writes in about. The payers hold no account; they're found by the payment itself.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
async function seedCheckouts(tx: any, now: Date) {
  const at = (h: number) => new Date(now.getTime() - h * 3_600_000);
  const plus = (d: Date, min: number) => new Date(d.getTime() + min * 60_000);
  const base = { currency: "NGN", expires_at: null, received_at: null, payer_card_last4: null, payer_account_last4: null, payer_bank: null, session_id: null, virtual_account_last4: null, notify_status: null, notify_attempts: 0, notify_last_at: null, review_hold: false };
  const pwt = (h: number) => ({ created_at: at(h), expires_at: plus(at(h), 30) });
  const rows = [
    // Paid and received; the merchant's system never got the "paid" notification: re-send it.
    { ...base, ...pwt(3), id: "CK-90101", reference: "PWT-5K2Q8M", merchant_holder_id: "ember", channel: "pay_with_transfer", amount_expected: 45000, amount_received: 45000, received_at: plus(at(3), 4), status: "successful", payer_email: "chidi.okafor@mail.example", payer_account_last4: "4417", payer_bank: "Eko Commercial Bank", session_id: "000013261124093015123456789001", notify_status: "failed", notify_attempts: 3, notify_last_at: plus(at(3), 20) },
    // Arrived 40 minutes after the checkout expired: the automatic refund is under way.
    { ...base, ...pwt(26), id: "CK-90102", reference: "PWT-7HD31L", merchant_holder_id: "okapi", channel: "pay_with_transfer", amount_expected: 32000, amount_received: 32000, received_at: plus(at(26), 70), status: "received_late", payer_email: "bola.ade@mail.example", payer_account_last4: "9032", payer_bank: "Sahel Trust Bank", session_id: "000013261123151122123456789002" },
    // Paid ₦500 short: not yet refunded.
    { ...base, ...pwt(5), id: "CK-90103", reference: "PWT-2MN84R", merchant_holder_id: "ember", channel: "pay_with_transfer", amount_expected: 20000, amount_received: 19500, received_at: plus(at(5), 6), status: "received_short", payer_email: "tunde.bello@mail.example", payer_account_last4: "2281", payer_bank: "Eko Commercial Bank", session_id: "000013261124080503123456789003" },
    // Nothing has arrived; the payer's transfer is still pending at their own bank (NIBSS session below).
    { ...base, ...pwt(2), id: "CK-90104", reference: "PWT-9QX55T", merchant_holder_id: "okapi", channel: "pay_with_transfer", amount_expected: 60000, status: "awaiting", payer_email: "kemi.jacobs@mail.example" },
    // Nothing arrived; the sending bank reversed the transfer to the payer.
    { ...base, ...pwt(30), id: "CK-90105", reference: "PWT-4BV19C", merchant_holder_id: "ember", channel: "pay_with_transfer", amount_expected: 15000, status: "awaiting", payer_email: "ngozi.eze@mail.example" },
    // A wallet top-up through a dedicated virtual account: received, and the merchant was told.
    { ...base, id: "CK-90106", reference: "DVA-88Z3PL", merchant_holder_id: "okapi", channel: "virtual_account", amount_expected: null, amount_received: 50000, created_at: at(6), received_at: at(6), status: "successful", payer_email: "musa.dauda@mail.example", payer_account_last4: "7765", payer_bank: "Sahel Trust Bank", session_id: "000013261124074411123456789006", virtual_account_last4: "3312", notify_status: "delivered", notify_attempts: 1, notify_last_at: plus(at(6), 1) },
    // A card payment that failed at checkout but debited the card: reversed by the card's bank.
    { ...base, id: "CK-90107", reference: "CRD-61JF2W", merchant_holder_id: "ember", channel: "card", amount_expected: 12500, amount_received: 12500, created_at: at(20), received_at: at(20), status: "failed_debited", payer_email: "femi.kolade@mail.example", payer_card_last4: "4821" },
    // Charged twice for one order: the second charge is the duplicate.
    { ...base, id: "CK-90108", reference: "CRD-3TT8KX", merchant_holder_id: "okapi", channel: "card", amount_expected: 8000, amount_received: 8000, created_at: at(8), received_at: at(8), status: "successful", payer_email: "halima.yusuf@mail.example", payer_card_last4: "5530", notify_status: "delivered", notify_attempts: 1, notify_last_at: at(8) },
    { ...base, id: "CK-90109", reference: "CRD-3TT8KY", merchant_holder_id: "okapi", channel: "card", amount_expected: 8000, amount_received: 8000, created_at: plus(at(8), 1), received_at: plus(at(8), 1), status: "duplicate", payer_email: "halima.yusuf@mail.example", payer_card_last4: "5530" },
    // The merchant refunded a card payment three days ago; the ARN lets the payer's bank trace it.
    { ...base, id: "CK-90110", reference: "CRD-8RE04D", merchant_holder_id: "ember", channel: "card", amount_expected: 27000, amount_received: 27000, created_at: at(96), received_at: at(96), status: "successful", payer_email: "chioma.nwosu@mail.example", payer_card_last4: "6671", notify_status: "delivered", notify_attempts: 1, notify_last_at: at(96) },
    // On a review hold: the payer hears only that it's under review.
    { ...base, ...pwt(4), id: "CK-90111", reference: "PWT-6WW70A", merchant_holder_id: "okapi", channel: "pay_with_transfer", amount_expected: 100000, amount_received: 100000, received_at: plus(at(4), 3), status: "successful", payer_email: "obinna.m@mail.example", payer_account_last4: "1209", payer_bank: "Eko Commercial Bank", session_id: "000013261124091212123456789011", review_hold: true, notify_status: "pending", notify_attempts: 0 },
    // Paid ₦5,000 too much: the excess comes back.
    { ...base, ...pwt(7), id: "CK-90112", reference: "PWT-1LP63S", merchant_holder_id: "ember", channel: "pay_with_transfer", amount_expected: 10000, amount_received: 15000, received_at: plus(at(7), 5), status: "received_over", payer_email: "sade.ojo@mail.example", payer_account_last4: "6610", payer_bank: "Sahel Trust Bank", session_id: "000013261124060702123456789012", notify_status: "delivered", notify_attempts: 1, notify_last_at: plus(at(7), 6) },
  ];
  for (const r of rows) await tx`insert into checkout_payments ${tx(r)}`;
  await tx`insert into checkout_refunds (id, payment_id, amount, status, arn, started_at, completed_at, started_by) values
    ('RF-6901', 'CK-90102', 32000, 'processing', null, ${plus(at(26), 75)}, null, 'Automatic: arrived after the checkout expired'),
    ('RF-6902', 'CK-90110', 27000, 'processing', '74321654987123456789012', ${at(72)}, null, 'Merchant refund')`;
  await tx`insert into nip_sessions (session_id, status, beneficiary_account_last4, at, detail) values
    ('000013261124110012123456789004', 'pending', null, ${at(2)}, 'Still pending at the sending bank'),
    ('000013261123120918123456789005', 'reversed', null, ${at(29)}, 'Not completed; reversed to the sender''s account by the sending bank'),
    ('000013261124093015123456789001', 'successful', '0742', ${plus(at(3), 4)}, null),
    ('000013261124080503123456789003', 'successful', '0742', ${plus(at(5), 6)}, null)`;
}

