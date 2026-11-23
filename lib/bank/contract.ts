// The Bank Connector API, v1 (Tomi, Nov 23: "build something systems can connect to").
//
// Orchestra reads a bank's records and asks it to act through this one contract. A bank (or its
// middleware) implements the contract once; Orchestra calls it over HTTPS (lib/bank/http.ts). The
// simulated bank implements the same contract in-process (lib/bank/simulated.ts) and also serves it
// over HTTP at /api/bank/v1, the reference implementation. The machine-readable version is
// public/openapi/bank-connector-v1.yaml; the readable one is the console's API page.
//
// v1 covers the core records: the identity check, the customer, payouts, incoming payments,
// verification, balances, fees, restrictions and the recall request. Cards, loans, bills and the other
// areas still read the simulated bank directly and will follow the same pattern.
//
// Rules of the contract:
// - Every record belongs to an account holder (a business or a personal account). Orchestra always
//   passes the verified customer's holder id; the bank returns only that holder's records.
// - Amounts are decimal strings in the currency's major unit ("4200.00"); currencies are ISO 4217.
// - Times are ISO 8601 with a time zone.
// - A review hold comes back as a flag only. The bank never sends Orchestra the reason.
// - Actions carry an Idempotency-Key header: the same key twice returns the first result.

export type Currency = string;

export interface IdentityCheck {
  full_name: string;
  date_of_birth: string; // YYYY-MM-DD
  /** A business's registration number, or a personal account's last 4 digits. */
  registration_number: string;
}

export interface BankUser {
  id: string;
  full_name: string;
  first_name: string;
  role: "view_only" | "payment_rights";
  holder_id: string;
  holder_name: string;
  personal: boolean;
  country: string;
}

export type TransferStatus = "pending" | "processing" | "successful" | "failed" | "reversed";

export interface Transfer {
  id: string;
  holder_id: string;
  recipient_name: string;
  /** The full account number: Orchestra masks it to the last 4 before Alexis sees it. */
  recipient_account: string;
  recipient_bank: string | null;
  recipient_country: string | null;
  amount: string;
  currency: Currency;
  route: string;
  description: string | null;
  status: TransferStatus;
  stage: string | null;
  failure_reason: string | null;
  sent_at: string;
  completed_at: string | null;
  history: { stage: string; at: string }[];
  review_hold: boolean;
}

export interface IncomingPayment {
  id: string;
  /** Null while the payment is unallocated (arrived with a reference that matches no account). */
  holder_id: string | null;
  payer_name: string;
  payer_bank: string | null;
  amount: string;
  currency: Currency;
  reference: string | null;
  status: "credited" | "unallocated";
  received_at: string;
  credited_at: string | null;
}

export interface Verification {
  status: "incomplete" | "pending" | "approved" | "failed" | "blocked";
  reason: string | null;
  missing: string | null;
  submitted_at: string | null;
  kyc_tier: number | null;
}

export interface Balance { currency: Currency; amount: string }

export interface FeeRecord {
  id: string;
  kind: "fee" | "conversion";
  description: string;
  trigger: string | null;
  transfer_id: string | null;
  currency: Currency;
  amount: string;
  from_currency: Currency | null;
  from_amount: string | null;
  to_currency: Currency | null;
  to_amount: string | null;
  rate: string | null;
  charged_at: string;
  waivable: boolean;
}

export interface Restriction {
  id: string;
  transfer_id: string | null;
  type: "review_hold" | "customer_can_fix";
  /** Only for customer_can_fix: the cause and the fix, in words for the customer. Never for a review hold. */
  customer_reason: string | null;
}

export interface RecallRequest {
  transfer_id: string;
  amount: string;
  currency: Currency;
  /** Orchestra's reference for the request, e.g. REC-5501. */
  reference: string;
  requested_by: string;
  /** Set when a supervisor approved a recall above the cap. */
  approved_by?: string | null;
}

export interface RecallResult { accepted: boolean; bank_reference: string | null; status: string }

/** What Orchestra needs from a bank. */
export interface BankConnector {
  readonly kind: "simulated" | "http";
  verifyIdentity(check: IdentityCheck): Promise<{ user_id: string | null }>;
  getUser(userId: string): Promise<BankUser | null>;
  searchTransfers(holderId: string, q: { reference?: string; recipient?: string; amount?: number }): Promise<Transfer[]>;
  searchIncomingPayments(holderId: string, q: { amount?: number; currency?: string }): Promise<IncomingPayment[]>;
  getVerification(holderId: string): Promise<Verification | null>;
  getBalances(holderId: string): Promise<Balance[]>;
  listFees(holderId: string, q: { kind?: "fee" | "conversion"; transfer?: string; since?: string }): Promise<FeeRecord[]>;
  listRestrictions(holderId: string, q: { transfer?: string }): Promise<Restriction[]>;
  requestRecall(holderId: string, req: RecallRequest, idempotencyKey: string): Promise<RecallResult>;
}
