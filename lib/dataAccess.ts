// What Alexis can see (Tomi, Nov 27: banks won't expose data protected by regulation). One switch per kind of data on
// the Rules screen ("What Alexis can see"); a switch that's off refuses every tool that reads or acts on that data,
// before the bank is asked for anything, so nothing of it reaches Orchestra or the AI. The team's own actions
// (staff actions) aren't limited by these switches.

export interface DataKind { rule: string; label: string; tools: string[] }

export const DATA_KINDS: DataKind[] = [
  { rule: "see_balances", label: "Account balances", tools: ["get_balance"] },
  { rule: "see_payouts", label: "Payouts and their recipients", tools: ["get_transfer_status", "generate_proof_of_payment", "initiate_recall", "draft_claim_pack"] },
  { rule: "see_incoming", label: "Incoming payments", tools: ["find_incoming_payment"] },
  { rule: "see_cards", label: "Cards and card transactions", tools: ["get_card", "freeze_card", "unfreeze_card", "change_card_settings", "order_replacement", "list_transactions", "open_dispute", "find_payments", "get_payment_by_id", "get_payment_timeline", "get_reversal_status", "request_reversal"] },
  { rule: "see_fees", label: "Fees and charges", tools: ["get_fees", "waive_fee"] },
  { rule: "see_verification", label: "Verification (KYC) status and reasons", tools: ["get_kyc_status"] },
  { rule: "see_restrictions", label: "Account restrictions and limits", tools: ["get_account_restrictions", "get_account_limits"] },
  { rule: "see_loans", label: "Loans", tools: ["get_loan", "payoff_quote", "request_deferral"] },
  { rule: "see_merchant_payouts", label: "Merchant settlements and holds", tools: ["get_payout_status", "list_holds"] },
  { rule: "see_bills", label: "Bill and airtime payments, USSD sessions", tools: ["get_bill_payment_status", "refund_bill_payment", "get_ussd_session"] },
  { rule: "see_checkout", label: "Checkout payments (people who paid a merchant)", tools: ["check_payment_evidence", "get_checkout_payment", "check_transfer_status", "resend_merchant_notification", "refund_checkout_payment"] },
];

/** The kind of data a tool reads, or null for tools that read no customer data (the knowledge base, a handoff). */
export function dataKindOf(tool: string): DataKind | null {
  return DATA_KINDS.find((k) => k.tools.includes(tool)) ?? null;
}
