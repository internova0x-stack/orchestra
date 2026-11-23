// The Bank Connector API, v1 (Tomi, Nov 23: "build something systems can connect to").
//
// Orchestra reads a bank's records and asks it to act through this one contract. A bank (or its
// middleware) implements the contract once; Orchestra calls it over HTTPS (lib/bank/http.ts). The
// simulated bank implements the same contract in-process (lib/bank/simulated.ts) and also serves it
// over HTTP at /api/bank/v1, the reference implementation. The machine-readable version is
// public/openapi/bank-connector-v1.yaml; the readable one is the console's API page.
//
// v1 covers every record Alexis reads and every action she takes at the bank: the identity check, the
// customer and their contact details, payouts and the recall request, incoming payments, verification,
// balances, fees and the fee refund, restrictions, cards (freeze, replace) and card transactions, card,
// POS, ATM and web payments with their stage-by-stage timeline, loans, merchant payouts and holds, bill
// and airtime payments (refund), USSD and agent sessions, and the online-access unlock.
// Orchestra's own records (disputes, reversals, deferral requests, waivers, recalls, escalations and the
// audit log) stay in Orchestra: they're the cases it opened, not the bank's ledger.
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

export interface Contact {
  /** The phone and email on file: Orchestra masks them before Alexis sees them and sends codes and links only to these. */
  phone: string | null;
  email: string | null;
  /** Why online access is locked: "failed_logins" (the customer can be helped to unlock it), any other value (a lock the bank placed), or null. */
  login_locked: string | null;
}

export interface Card {
  id: string;
  last4: string;
  status: "active" | "frozen" | "replaced" | "expired";
  currency: Currency;
  daily_limit: string | null;
  /** The delivery address on file: Orchestra shortens it before Alexis sees it. */
  delivery_address: string | null;
  online_payments: boolean;
  international_payments: boolean;
  contactless: boolean;
  /** Who froze it: "customer" (in the app or through Alexis), "bank" (a freeze Alexis must never lift), or null. */
  frozen_by: "customer" | "bank" | null;
  created_at: string;
}

/** The card settings Orchestra can ask the bank to change (only the ones given change). */
export interface CardSettings {
  online_payments?: boolean;
  international_payments?: boolean;
  contactless?: boolean;
  /** The new daily spending limit, a decimal string in the card's currency. */
  daily_limit?: string;
}

export interface CardTransaction {
  id: string;
  card_id: string | null;
  card_last4: string | null;
  /** The name on the statement. */
  descriptor: string;
  merchant_name: string | null;
  location: string | null;
  channel: "card" | "POS" | "ATM" | "web" | "transfer";
  amount: string;
  currency: Currency;
  status: "pending" | "settled" | "declined" | "reversed";
  decline_reason: string | null;
  at: string;
}

export interface Payment {
  id: string;
  holder_id: string;
  channel: "card" | "POS" | "ATM" | "web";
  merchant_name: string;
  location: string | null;
  /** Another bank's ATM or terminal; null for the bank's own. */
  terminal_bank: string | null;
  processor: string | null;
  card_last4: string | null;
  amount: string;
  currency: Currency;
  outcome: "successful" | "failed_debited" | "declined";
  failure_detail: string | null;
  at: string;
}

export interface PaymentEvent {
  stage: "authorization" | "capture" | "settlement" | "payout";
  status: "ok" | "failed";
  detail: string | null;
  /** The party that reported the stage (the issuer, the acquirer, the processor, the merchant's provider). */
  reported_by: string;
  at: string;
}

export interface Loan {
  id: string;
  product: string;
  currency: Currency;
  principal: string;
  balance: string;
  /** Percent a year, e.g. "18.500". */
  annual_rate: string;
  monthly_payment: string;
  next_due_at: string;
  arrears: string;
  status: "current" | "in_arrears" | "default";
  started_at: string;
}

export interface MerchantPayout {
  id: string;
  amount: string;
  currency: Currency;
  scheduled_for: string;
  status: "scheduled" | "paid" | "delayed" | "rejected" | "on_hold";
  /** The cause of a delay or rejection, in words for the customer. Never sent for a payout on a review hold. */
  delay_reason: string | null;
  sales: string;
  fees: string;
  refunds: string;
  disputes: string;
  paid_at: string | null;
  review_hold: boolean;
}

export interface MerchantHold {
  id: string;
  payout_id: string | null;
  amount: string;
  currency: Currency;
  type: "review_hold" | "customer_can_fix";
  /** Only for customer_can_fix. Never for a review hold. */
  customer_reason: string | null;
}

export interface BillPayment {
  id: string;
  biller: string;
  kind: "airtime" | "data" | "electricity" | "tv" | "water";
  /** The phone, meter or account number paid for: Orchestra shortens it before Alexis sees it. */
  customer_ref: string;
  amount: string;
  currency: Currency;
  status: "delivered" | "pending" | "failed_at_provider" | "refunded";
  token: string | null;
  provider_ref: string | null;
  refund_reference: string | null;
  at: string;
}

export interface UssdSession {
  id: string;
  kind: "ussd" | "agent";
  code: string | null;
  agent_name: string | null;
  agent_id: string | null;
  location: string | null;
  action: string;
  amount: string;
  currency: Currency;
  outcome: string;
  linked_ref: string | null;
  at: string;
}

/** An action at the bank that Orchestra asks for with its own reference (e.g. CRD-7001, BRF-2201, WVR-3101). */
export interface ActionRequest {
  reference: string;
  requested_by: string;
  reason?: string | null;
}

export interface ActionResult { accepted: boolean; bank_reference: string | null; status: string }

/** What Orchestra needs from a bank. */
export interface BankConnector {
  readonly kind: "simulated" | "http";
  verifyIdentity(check: IdentityCheck): Promise<{ user_id: string | null }>;
  getUser(userId: string): Promise<BankUser | null>;
  searchTransfers(holderId: string, q: { reference?: string; recipient?: string; amount?: number }): Promise<Transfer[]>;
  searchIncomingPayments(holderId: string, q: { amount?: number; currency?: string }): Promise<IncomingPayment[]>;
  getVerification(holderId: string): Promise<Verification | null>;
  getBalances(holderId: string): Promise<Balance[]>;
  listFees(holderId: string, q: { id?: string; kind?: "fee" | "conversion"; transfer?: string; since?: string }): Promise<FeeRecord[]>;
  listRestrictions(holderId: string, q: { transfer?: string }): Promise<Restriction[]>;
  requestRecall(holderId: string, req: RecallRequest, idempotencyKey: string): Promise<RecallResult>;

  getContact(userId: string): Promise<Contact | null>;
  /** Lifts a lock from failed sign-in attempts only; a lock the bank placed is refused (accepted: false). */
  unlockLogin(userId: string, req: ActionRequest, idempotencyKey: string): Promise<ActionResult>;

  listCards(holderId: string, q: { last4?: string }): Promise<Card[]>;
  freezeCard(holderId: string, cardId: string, req: ActionRequest, idempotencyKey: string): Promise<ActionResult>;
  /** Stops the card and sends a new one to the delivery address on file. */
  replaceCard(holderId: string, cardId: string, req: ActionRequest, idempotencyKey: string): Promise<ActionResult>;
  /** Lifts a freeze the customer placed; a freeze the bank placed is refused (accepted: false, status frozen_by_bank). */
  unfreezeCard(holderId: string, cardId: string, req: ActionRequest, idempotencyKey: string): Promise<ActionResult>;
  updateCardSettings(holderId: string, cardId: string, settings: CardSettings, req: ActionRequest, idempotencyKey: string): Promise<ActionResult>;
  searchCardTransactions(holderId: string, q: { id?: string; card?: string; status?: CardTransaction["status"]; since?: string; merchant?: string; amount?: number }): Promise<CardTransaction[]>;

  searchPayments(holderId: string, q: { amount?: number; channel?: string; card_last4?: string; merchant?: string }): Promise<Payment[]>;
  /** One payment by id. `elsewhere` is true when the id exists on another holder's account; nothing else about it is returned. */
  getPayment(holderId: string, paymentId: string): Promise<{ payment: Payment | null; elsewhere: boolean }>;
  getPaymentEvents(holderId: string, paymentId: string): Promise<PaymentEvent[]>;

  listLoans(holderId: string, q: { id?: string }): Promise<Loan[]>;
  listMerchantPayouts(holderId: string, q: { id?: string }): Promise<MerchantPayout[]>;
  listMerchantHolds(holderId: string): Promise<MerchantHold[]>;

  searchBillPayments(holderId: string, q: { id?: string; amount?: number; kind?: string }): Promise<BillPayment[]>;
  refundBillPayment(holderId: string, billPaymentId: string, req: ActionRequest, idempotencyKey: string): Promise<ActionResult>;
  searchUssdSessions(holderId: string, q: { amount?: number; kind?: string }): Promise<UssdSession[]>;

  /** Refunds one fee (a goodwill waiver Orchestra has checked against its rules). */
  refundFee(holderId: string, feeId: string, req: ActionRequest, idempotencyKey: string): Promise<ActionResult>;
}
