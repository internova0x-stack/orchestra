import type { Sql } from "../db.ts";
import type { BankConnector, BankUser, Balance, FeeRecord, IdentityCheck, IncomingPayment, Restriction, Transfer, Verification } from "./contract.ts";

// The simulated bank behind the Bank Connector API: the seeded tables in this app's own database.
// It is the reference implementation of the contract (also served over HTTP at /api/bank/v1).

const iso = (d: Date | string | null) => (d == null ? null : new Date(d).toISOString());
const letters = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
const alnum = (s: string) => s.toLowerCase().replace(/[^a-z0-9]/g, "");

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
          ${q.since ? sql`and charged_at > ${new Date(q.since)}` : sql``}
          ${q.kind ? sql`and kind = ${q.kind}` : sql``}
          ${q.transfer ? sql`and transfer_id = ${q.transfer.trim().toUpperCase()}` : sql``}
        order by charged_at desc limit 40`;
      const str = (v: unknown) => (v == null ? null : String(v));
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
  };
}
