import type { Sql } from "../db.ts";
import type { ActionResult, BankConnector, CardSettings, BankUser, Balance, BillPayment, Card, CardTransaction, Contact, FeeRecord, IdentityCheck, IncomingPayment, Loan, MerchantHold, MerchantPayout, Payment, PaymentEvent, Restriction, Transfer, UssdSession, Verification } from "./contract.ts";

// The simulated bank behind the Bank Connector API: the seeded tables in this app's own database.
// It is the reference implementation of the contract (also served over HTTP at /api/bank/v1).

const iso = (d: Date | string | null) => (d == null ? null : new Date(d).toISOString());
const letters = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");
const up = (s: string) => s.trim().toUpperCase();
const str = (v: unknown) => (v == null ? null : String(v));
const done = (status: string): ActionResult => ({ accepted: true, bank_reference: null, status });
const refused = (status: string): ActionResult => ({ accepted: false, bank_reference: null, status });

/** Turns a row's dates into ISO strings and its numbers into decimal strings, as the contract sends them. */
function wire<T>(row: Record<string, unknown>, dates: string[], amounts: string[]): T {
  const out: Record<string, unknown> = { ...row };
  for (const k of dates) out[k] = iso(row[k] as Date | null);
  for (const k of amounts) out[k] = str(row[k]);
  return out as T;
}
const PAYMENT_AMOUNTS = ["amount"];

export function simulatedBank(sql: Sql): BankConnector {
  return {
    kind: "simulated",

    /** The standard identity check: full name, date of birth, and the registration number (or a personal account's last 4). */
    async verifyIdentity(a: IdentityCheck) {
      const name = letters(a.full_name ?? "");
      const reg = alnum(a.registration_number ?? "");
      const dob = (a.date_of_birth ?? "").slice(0, 10);
      if (!name || !reg || !dob) return { user_id: null };
      const rows = await sql<{ id: string; full_name: string; dob: string; reg: string | null; kind: string; account: string | null }[]>`
        select u.id, u.full_name, to_char(u.date_of_birth, 'YYYY-MM-DD') as dob, b.registration_number as reg, b.kind, b.account_number as account
        from business_users u join businesses b on b.id = u.business_id`;
      const fact = (u: (typeof rows)[number]) => (u.kind === "personal" ? alnum(u.account ?? "").slice(-4) : alnum(u.reg ?? ""));
      const user = rows.find((u) => letters(u.full_name) === name && u.dob === dob && fact(u) !== "" && fact(u) === reg);
      return { user_id: user?.id ?? null };
    },

    async getUser(userId: string): Promise<BankUser | null> {
      const [u] = await sql<BankUser[]>`
        select u.id, u.full_name, u.first_name, u.role, u.business_id as holder_id, b.name as holder_name,
          (b.kind = 'personal') as personal, b.country
        from business_users u join businesses b on b.id = u.business_id where u.id = ${userId}`;
      return u ?? null;
    },

    async searchTransfers(holderId, q): Promise<Transfer[]> {
      const ref = q.reference?.trim().toUpperCase();
      const rows = await sql<(Omit<Transfer, "sent_at" | "completed_at"> & { business_id: string; sent_at: Date; completed_at: Date | null })[]>`
        select t.*, exists (select 1 from restrictions r where r.transfer_id = t.id and r.kind = 'review_hold') as review_hold
        from transfers t
        where t.business_id = ${holderId}
          ${ref ? sql`and upper(t.id) = ${ref}` : sql``}
          ${q.recipient ? sql`and t.recipient_name ilike ${"%" + q.recipient + "%"}` : sql``}
          ${q.amount != null ? sql`and t.amount = ${q.amount}` : sql``}
        order by t.sent_at desc limit 20`;
      return rows.map((t) => ({
        id: t.id, holder_id: t.business_id, recipient_name: t.recipient_name, recipient_account: t.recipient_account,
        recipient_bank: t.recipient_bank, recipient_country: t.recipient_country, amount: String(t.amount), currency: t.currency,
        route: t.route, description: t.description, status: t.status, stage: t.stage, failure_reason: t.failure_reason,
        sent_at: iso(t.sent_at)!, completed_at: iso(t.completed_at), history: t.history ?? [], review_hold: t.review_hold,
      }));
    },

    async searchIncomingPayments(holderId, q): Promise<IncomingPayment[]> {
      // The holder's own payments, plus unallocated ones (no holder yet) that the caller matches strictly.
      const rows = await sql<{ id: string; business_id: string | null; payer_name: string; payer_bank: string | null; amount: string; currency: string; reference: string | null; status: "credited" | "unallocated"; received_at: Date; credited_at: Date | null }[]>`
        select id, business_id, payer_name, payer_bank, amount, currency, reference, status, received_at, credited_at
        from incoming_payments
        where (business_id = ${holderId} or status = 'unallocated')
          ${q.amount != null ? sql`and amount = ${q.amount}` : sql``}
          ${q.currency ? sql`and currency = ${q.currency}` : sql``}
        order by received_at desc limit 50`;
      return rows.map((r) => ({
        id: r.id, holder_id: r.business_id, payer_name: r.payer_name, payer_bank: r.payer_bank, amount: String(r.amount), currency: r.currency,
        reference: r.reference, status: r.status, received_at: iso(r.received_at)!, credited_at: iso(r.credited_at),
      }));
    },

    async getVerification(holderId): Promise<Verification | null> {
      const [b] = await sql<{ status: Verification["status"]; reason: string | null; missing: string | null; submitted_at: Date | null; kyc_tier: number | null }[]>`
        select verification_status as status, verification_reason as reason, verification_missing as missing,
          verification_submitted_at as submitted_at, kyc_tier
        from businesses where id = ${holderId}`;
      return b ? { ...b, submitted_at: iso(b.submitted_at) } : null;
    },

    async getBalances(holderId): Promise<Balance[]> {
      const rows = await sql<{ currency: string; amount: string }[]>`select currency, amount from balances where business_id = ${holderId} order by currency`;
      return rows.map((r) => ({ currency: r.currency, amount: String(r.amount) }));
    },

    async listFees(holderId, q): Promise<FeeRecord[]> {
      const rows = await sql<(Omit<FeeRecord, "charged_at"> & { charged_at: Date })[]>`
        select id, kind, description, trigger, transfer_id, currency, amount, from_currency, from_amount, to_currency, to_amount, rate, charged_at, waivable
        from fees where business_id = ${holderId}
          ${q.id ? sql`and id = ${up(q.id)}` : sql``}
          ${q.since ? sql`and charged_at > ${new Date(q.since)}` : sql``}
          ${q.kind ? sql`and kind = ${q.kind}` : sql``}
          ${q.transfer ? sql`and transfer_id = ${q.transfer.trim().toUpperCase()}` : sql``}
        order by charged_at desc limit 40`;
      return rows.map((r) => ({
        ...r, amount: String(r.amount), from_amount: str(r.from_amount), to_amount: str(r.to_amount), rate: str(r.rate), charged_at: iso(r.charged_at)!,
      }));
    },

    async listRestrictions(holderId, q): Promise<Restriction[]> {
      // The internal reason is never selected, so it can't leave the bank.
      const ref = q.transfer?.trim().toUpperCase() ?? null;
      const rows = await sql<{ id: string; transfer_id: string | null; kind: string; customer_reason: string | null }[]>`
        select id, transfer_id, kind, customer_reason from restrictions
        where business_id = ${holderId} ${ref ? sql`and (transfer_id = ${ref} or transfer_id is null)` : sql``}
        order by created_at`;
      return rows.map((r) => (r.kind === "review_hold"
        ? { id: r.id, transfer_id: r.transfer_id, type: "review_hold" as const, customer_reason: null }
        : { id: r.id, transfer_id: r.transfer_id, type: "customer_can_fix" as const, customer_reason: r.customer_reason }));
    },

    /**
     * The simulated bank takes the request as given: Orchestra's own recalls table is the record, and the
     * simulation moves it along (lib/updates.ts). A real bank returns its own reference and status.
     */
    async requestRecall() {
      return { accepted: true, bank_reference: null, status: "requested" };
    },

    async getContact(userId): Promise<Contact | null> {
      const [c] = await sql<Contact[]>`select phone, email, login_locked from business_users where id = ${userId}`;
      return c ?? null;
    },

    async findUserByContact(q) {
      const email = q.email?.trim().toLowerCase() || null;
      const digits = q.phone?.replace(/\D/g, "") || null;
      if (!email && (!digits || digits.length < 7)) return null;
      const rows = await sql<{ id: string; email: string | null; phone: string | null }[]>`select id, email, phone from business_users`;
      const hit = rows.find((u) => (email && u.email?.toLowerCase() === email) || (digits && digits.length >= 7 && u.phone?.replace(/\D/g, "").endsWith(digits.slice(-10))));
      return hit ? this.getUser(hit.id) : null;
    },

    async unlockLogin(userId) {
      const [c] = await sql<{ login_locked: string | null }[]>`select login_locked from business_users where id = ${userId}`;
      if (!c) return refused("not_found");
      if (!c.login_locked) return done("not_locked");
      if (c.login_locked !== "failed_logins") return refused("locked_by_bank");
      await sql`update business_users set login_locked = null where id = ${userId}`;
      return done("unlocked");
    },

    async listCards(holderId, q): Promise<Card[]> {
      const rows = await sql<Record<string, unknown>[]>`
        select id, last4, status, currency, daily_limit, delivery_address, online_payments, international_payments, contactless, frozen_by, created_at from cards
        where holder_id = ${holderId} ${q.last4 ? sql`and last4 = ${q.last4}` : sql``}
        order by created_at desc`;
      return rows.map((r) => wire<Card>(r, ["created_at"], ["daily_limit"]));
    },

    async freezeCard(holderId, cardId) {
      const [c] = await sql<{ status: string }[]>`select status from cards where id = ${cardId} and holder_id = ${holderId}`;
      if (!c) return refused("not_found");
      if (c.status === "frozen") return done("frozen");
      if (c.status !== "active") return refused(c.status);
      await sql`update cards set status = 'frozen', frozen_by = 'customer' where id = ${cardId}`;
      return done("frozen");
    },

    async unfreezeCard(holderId, cardId, req) {
      const [c] = await sql<{ status: string; frozen_by: string | null }[]>`select status, frozen_by from cards where id = ${cardId} and holder_id = ${holderId}`;
      if (!c) return refused("not_found");
      if (c.status === "active") return done("active");
      if (c.status !== "frozen") return refused(c.status);
      if (c.frozen_by === "bank" && !req.approved_by) return refused("frozen_by_bank");
      await sql`update cards set status = 'active', frozen_by = null where id = ${cardId}`;
      return done("active");
    },

    async updateCardSettings(holderId, cardId, st: CardSettings) {
      const [c] = await sql<{ status: string; frozen_by: string | null }[]>`select status, frozen_by from cards where id = ${cardId} and holder_id = ${holderId}`;
      if (!c) return refused("not_found");
      if (c.status !== "active" && c.status !== "frozen") return refused(c.status);
      if (c.frozen_by === "bank") return refused("frozen_by_bank");
      const set: Record<string, unknown> = {};
      for (const k of ["online_payments", "international_payments", "contactless"] as const) if (typeof st[k] === "boolean") set[k] = st[k];
      if (st.daily_limit != null && Number.isFinite(Number(st.daily_limit)) && Number(st.daily_limit) >= 0) set.daily_limit = Number(st.daily_limit);
      if (!Object.keys(set).length) return refused("nothing_to_change");
      await sql`update cards set ${sql(set)} where id = ${cardId}`;
      return done("updated");
    },

    async replaceCard(holderId, cardId) {
      const [c] = await sql<{ status: string }[]>`select status from cards where id = ${cardId} and holder_id = ${holderId}`;
      if (!c) return refused("not_found");
      await sql`update cards set status = 'replaced' where id = ${cardId}`;
      return done("ordered");
    },

    async searchCardTransactions(holderId, q): Promise<CardTransaction[]> {
      const rows = await sql<Record<string, unknown>[]>`
        select t.id, t.card_id, c.last4 as card_last4, t.descriptor, t.merchant_name, t.location, t.channel, t.amount, t.currency, t.status, t.decline_reason, t.at
        from transactions t left join cards c on c.id = t.card_id
        where t.holder_id = ${holderId}
          ${q.id ? sql`and t.id = ${up(q.id)}` : sql``}
          ${q.card ? sql`and t.card_id = ${q.card}` : sql``}
          ${q.status ? sql`and t.status = ${q.status}` : sql``}
          ${q.since ? sql`and t.at > ${new Date(q.since)}` : sql``}
          ${q.merchant ? sql`and (t.descriptor ilike ${"%" + q.merchant + "%"} or t.merchant_name ilike ${"%" + q.merchant + "%"})` : sql``}
          ${q.amount != null ? sql`and t.amount = ${q.amount}` : sql``}
        order by t.at desc limit 50`;
      return rows.map((r) => wire<CardTransaction>(r, ["at"], ["amount"]));
    },

    async searchPayments(holderId, q): Promise<Payment[]> {
      const rows = await sql<Record<string, unknown>[]>`
        select * from payments where holder_id = ${holderId}
          ${q.amount != null ? sql`and amount = ${q.amount}` : sql``}
          ${q.channel ? sql`and channel = ${q.channel}` : sql``}
          ${q.card_last4 ? sql`and card_last4 = ${q.card_last4}` : sql``}
          ${q.merchant ? sql`and merchant_name ilike ${"%" + q.merchant + "%"}` : sql``}
        order by at desc limit 20`;
      return rows.map((r) => wire<Payment>(r, ["at"], PAYMENT_AMOUNTS));
    },

    async getPayment(holderId, paymentId) {
      const [r] = await sql<Record<string, unknown>[]>`select * from payments where id = ${up(paymentId)}`;
      if (!r) return { payment: null, elsewhere: false };
      // Another holder's payment: say only that it isn't this holder's.
      if (r.holder_id !== holderId) return { payment: null, elsewhere: true };
      return { payment: wire<Payment>(r, ["at"], PAYMENT_AMOUNTS), elsewhere: false };
    },

    async getPaymentEvents(holderId, paymentId): Promise<PaymentEvent[]> {
      const rows = await sql<Record<string, unknown>[]>`
        select e.stage, e.status, e.detail, e.reported_by, e.at from payment_events e join payments p on p.id = e.payment_id
        where p.id = ${up(paymentId)} and p.holder_id = ${holderId} order by e.at, e.id`;
      return rows.map((r) => wire<PaymentEvent>(r, ["at"], []));
    },

    async listLoans(holderId, q): Promise<Loan[]> {
      const rows = await sql<Record<string, unknown>[]>`
        select id, product, currency, principal, balance, annual_rate, monthly_payment, next_due_at, arrears, status, started_at
        from loans where holder_id = ${holderId} ${q.id ? sql`and id = ${up(q.id)}` : sql``}
        order by started_at desc`;
      return rows.map((r) => wire<Loan>(r, ["next_due_at", "started_at"], ["principal", "balance", "annual_rate", "monthly_payment", "arrears"]));
    },

    async listMerchantPayouts(holderId, q): Promise<MerchantPayout[]> {
      const rows = await sql<Record<string, unknown>[]>`
        select p.id, p.amount, p.currency, p.scheduled_for, p.status, p.delay_reason, p.sales, p.fees, p.refunds, p.disputes, p.paid_at,
          exists (select 1 from merchant_holds h where h.payout_id = p.id and h.kind = 'review_hold') as review_hold
        from merchant_payouts p where p.business_id = ${holderId} ${q.id ? sql`and p.id = ${up(q.id)}` : sql``}
        order by p.scheduled_for desc limit 10`;
      // A payout on a review hold carries no reason.
      return rows.map((r) => wire<MerchantPayout>(r.review_hold ? { ...r, delay_reason: null } : r, ["scheduled_for", "paid_at"], ["amount", "sales", "fees", "refunds", "disputes"]));
    },

    async listMerchantHolds(holderId): Promise<MerchantHold[]> {
      // The internal reason is never selected, so it can't leave the bank.
      const rows = await sql<{ id: string; payout_id: string | null; amount: string; currency: string; kind: string; customer_reason: string | null }[]>`
        select id, payout_id, amount, currency, kind, customer_reason from merchant_holds where business_id = ${holderId} order by created_at`;
      return rows.map((h) => ({
        id: h.id, payout_id: h.payout_id, amount: String(h.amount), currency: h.currency,
        type: h.kind === "review_hold" ? ("review_hold" as const) : ("customer_can_fix" as const),
        customer_reason: h.kind === "review_hold" ? null : h.customer_reason,
      }));
    },

    async searchBillPayments(holderId, q): Promise<BillPayment[]> {
      const rows = await sql<Record<string, unknown>[]>`
        select id, biller, kind, customer_ref, amount, currency, status, token, provider_ref, refund_reference, at
        from bill_payments where holder_id = ${holderId}
          ${q.id ? sql`and id = ${up(q.id)}` : sql``}
          ${q.amount != null ? sql`and amount = ${q.amount}` : sql``}
          ${q.kind ? sql`and kind = ${q.kind}` : sql``}
        order by at desc limit 10`;
      return rows.map((r) => wire<BillPayment>(r, ["at"], ["amount"]));
    },

    async refundBillPayment(holderId, id, req) {
      const [b] = await sql<{ status: string; refund_reference: string | null }[]>`select status, refund_reference from bill_payments where id = ${up(id)} and holder_id = ${holderId}`;
      if (!b) return refused("not_found");
      if (b.refund_reference) return { accepted: true, bank_reference: b.refund_reference, status: "refunded" };
      if (b.status !== "failed_at_provider") return refused(b.status);
      await sql`update bill_payments set status = 'refunded', refund_reference = ${req.reference} where id = ${up(id)}`;
      return done("refunded");
    },

    async searchUssdSessions(holderId, q): Promise<UssdSession[]> {
      const rows = await sql<Record<string, unknown>[]>`
        select id, kind, code, agent_name, agent_id, location, action, amount, currency, outcome, linked_ref, at
        from ussd_sessions where holder_id = ${holderId}
          ${q.amount != null ? sql`and amount = ${q.amount}` : sql``}
          ${q.kind ? sql`and kind = ${q.kind}` : sql``}
        order by at desc limit 5`;
      return rows.map((r) => wire<UssdSession>(r, ["at"], ["amount"]));
    },

    /** The simulated bank takes a checked refund as given: Orchestra's waivers table is the record. */
    async refundFee(holderId, feeId) {
      const [f] = await sql<{ id: string }[]>`select id from fees where id = ${up(feeId)} and business_id = ${holderId} and kind = 'fee'`;
      return f ? done("refunded") : refused("not_found");
    },
  };
}
