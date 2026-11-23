// The dummy rule set (docs/KNOWLEDGE-BASE.md), loaded into the `rules` table by the seed.
// Answer rules are what Alexis may say; limit rules are what the tools enforce.
// Nuvion's name never appears in a value (owner, Nov 23); source links stay in source_url only.

export interface RuleSeed {
  id: string;
  category: string;
  name: string;
  kind: "answer" | "limit";
  origin: "sourced" | "sample";
  value: string;
  unit?: string;
  source_url?: string;
}

const DOCS = {
  intro: "https://docs.nuvion.co/introduction",
  payout: "https://docs.nuvion.co/guides/send-a-payout",
  accept: "https://docs.nuvion.co/guides/accept-a-payment.md",
  entities: "https://docs.nuvion.co/core-concepts/entities.md",
  product: "https://www.nuvion.co/products/payout",
};

const a = (
  id: string,
  category: string,
  name: string,
  value: string,
  origin: "sourced" | "sample",
  source_url?: string,
): RuleSeed => ({ id, category, name, kind: "answer", origin, value, source_url });

const l = (id: string, category: string, name: string, value: string, unit?: string): RuleSeed => ({
  id,
  category,
  name,
  kind: "limit",
  origin: "sample",
  value,
  unit,
});

export const RULE_SET: RuleSeed[] = [
  // Platform (sourced)
  a("platform_what", "Platform", "What the platform is", "A global banking and cross-border payments platform built on regular currency and stablecoin rails", "sourced", DOCS.product),
  a("platform_who", "Platform", "Who it serves", "Businesses, freelancers, creators, marketplaces and platforms", "sourced", DOCS.product),
  a("platform_accounts", "Platform", "Accounts", "Multi-currency accounts that hold, receive and send balances", "sourced", DOCS.intro),
  a("platform_incoming", "Platform", "Incoming payments", "Bank transfers and other local payment methods are accepted, and funds settle into the customer's account", "sourced", DOCS.intro),
  a("platform_payouts", "Platform", "Payouts", "Money can be sent to bank accounts or wallets worldwide by wire, local bank rails and real-time payment networks", "sourced", DOCS.intro),
  a("platform_stablecoins", "Platform", "Stablecoins", "Customers can receive, hold and send stablecoins and move between regular currency and on-chain assets", "sourced", DOCS.intro),
  a("platform_destinations", "Platform", "Payout destinations", "Bank accounts, mobile money wallets, stablecoin addresses and other accounts on the platform", "sourced", DOCS.payout),
  a("platform_out_of_scope", "Platform", "Not covered in this chat", "Cards, stablecoin support, Earn, IPO applications and developer questions: Alexis can't help with these here and offers a handoff to the team", "sample"),

  // Payouts: normal settlement by route (sourced)
  a("settle_faster_payments", "Payouts", "Normal settlement: United Kingdom, GBP, Faster Payments", "Same day", "sourced", DOCS.payout),
  a("settle_ach", "Payouts", "Normal settlement: United States, USD, ACH", "Same or next day", "sourced", DOCS.payout),
  a("settle_wire", "Payouts", "Normal settlement: United States, USD, Wire", "Same day", "sourced", DOCS.payout),
  a("settle_rtp", "Payouts", "Normal settlement: United States, USD, RTP", "Instant", "sourced", DOCS.payout),
  a("settle_nip", "Payouts", "Normal settlement: Nigeria, NGN, NIP", "Instant", "sourced", DOCS.payout),
  a("settle_sepa", "Payouts", "Normal settlement: Eurozone, EUR, SEPA", "Same day", "sourced", DOCS.payout),
  a("settle_eft", "Payouts", "Normal settlement: Canada, CAD, EFT", "Same or next day", "sourced", DOCS.payout),
  a("settle_aed", "Payouts", "Normal settlement: UAE, AED, Local transfer", "Same or next day", "sourced", DOCS.payout),
  a("settle_mobile_money", "Payouts", "Normal settlement: Kenya, Ghana, Tanzania, Mobile money", "Instant", "sourced", DOCS.payout),
  a("settle_swift", "Payouts", "Normal settlement: anywhere, SWIFT", "1 to 3 business days", "sourced", DOCS.payout),
  a("settle_stablecoin", "Payouts", "Normal settlement: stablecoin transfer", "Near-instant", "sourced", DOCS.payout),
  a("settle_internal", "Payouts", "Normal settlement: another account on the platform, internal transfer", "Instant", "sourced", DOCS.payout),
  a("status_pending", "Payouts", "Status: Pending", "Created and waiting to be processed. Say: it has been created and is queued to go out.", "sourced", DOCS.payout),
  a("status_processing", "Payouts", "Status: Processing", "Being carried out by the payment network. Say: it has left us and is with the payment network.", "sourced", DOCS.payout),
  a("status_successful", "Payouts", "Status: Successful", "Delivered to the recipient. Say: it was delivered on [date].", "sourced", DOCS.payout),
  a("status_failed", "Payouts", "Status: Failed", "Could not be completed. Say: it did not go through, then the reason if the record has one.", "sourced", DOCS.payout),
  a("status_reversed", "Payouts", "Status: Reversed", "Reversed after completion. Say: it completed and was then reversed on [date].", "sourced", DOCS.payout),
  a("payout_recipient", "Payouts", "What a payout needs", "A registered recipient with payment details, and a description passed to the recipient's statement where the route supports it", "sourced", DOCS.payout),
  a("payout_route_limits", "Payouts", "Per-transfer limits", "Some routes have per-transfer limits; for example Interac transfers in Canada are capped at 25,000 CAD and larger amounts must be split", "sourced", DOCS.payout),
  a("payout_retry", "Payouts", "Retrying a failed payout", "A failed payout cannot be retried under the same reference; a new one is needed", "sourced", DOCS.payout),
  a("payout_stages", "Payouts", "Stages inside Processing", "Compliance check, sent to the payment route, with an intermediary bank", "sample"),
  a("payout_failure_reasons", "Payouts", "Reasons a payout fails or is returned", "Account closed, name does not match the account, invalid account details, receiving bank rejected", "sample"),
  a("payout_recall", "Payouts", "Recall", "Can be requested for a payout sent in error; success depends on the receiving bank and is not guaranteed", "sample"),
  a("payout_cutoff", "Payouts", "Cut-off times", "None set in the prototype", "sample"),
  a("wrong_recipient", "Payouts", "Money sent to the wrong account", "A delivered transfer can only be returned with the recipient's consent or through the receiving bank; recovery is not guaranteed. The bank logs a recall request and contacts the receiving bank", "sample"),
  a("payout_fix_failed", "Payouts", "Fixing a failed payout", "Correct the recipient's details in the dashboard under Beneficiaries, where a second approver confirms changes, then send a new payout", "sample"),
  l("late_swift", "Payouts", "SWIFT payout counts as late after", "3", "business days"),
  l("late_other", "Payouts", "Other routes count as late after", "1", "business days"),

  // Incoming payments
  a("incoming_ways", "Incoming payments", "How a customer gets paid", "By sharing account details (bank details or a stablecoin wallet address) that the payer sends to directly, or by creating a funding session that the payer completes", "sourced", DOCS.accept),
  a("incoming_sessions", "Incoming payments", "Funding sessions", "A hosted bank-transfer checkout, a mobile money prompt on the payer's phone, a hosted stablecoin checkout, or an Interac email", "sourced", DOCS.accept),
  a("incoming_stablecoins", "Incoming payments", "Stablecoins received", "USDC and USDT", "sourced", DOCS.accept),
  a("incoming_not_showing", "Incoming payments", "Why a payment may not show", "It arrived with a wrong or missing reference and is waiting to be matched; it is still in transit; or it was never sent", "sample"),
  a("incoming_unallocated", "Incoming payments", "Unallocated payments", "Held until matched to an account; staff credit it once the match is confirmed", "sample"),
  a("incoming_trace", "Incoming payments", "What helps trace a missing payment", "The payer's proof of payment: amount, date, sending bank, reference", "sample"),

  // Proof of payment
  a("proof_when", "Proof of payment", "When a confirmation is issued", "Only for a payout with the status Successful", "sample"),
  a("proof_shows", "Proof of payment", "What it shows", "Amount, currency, date, recipient name, masked account number, reference, payout route", "sample"),
  a("proof_unfinished", "Proof of payment", "Payout still pending or processing", "A status note is offered: initiated on [date], current status", "sample"),
  a("proof_failed", "Proof of payment", "Failed or reversed payout", "No confirmation is issued", "sample"),
  a("proof_stamped", "Proof of payment", "Bank-stamped documents or SWIFT message copies", "Requested through the team; Alexis hands off", "sample"),

  // Verification
  a("kyc_incomplete", "Verification", "Status: Incomplete", "Created, but required information or documents are missing. Say what is missing and how to submit it.", "sourced", DOCS.entities),
  a("kyc_pending", "Verification", "Status: Pending", "Submitted and under review. Say it is with the compliance team for review.", "sourced", DOCS.entities),
  a("kyc_approved", "Verification", "Status: Approved", "Verification is complete; accounts can be opened and money moved. Say the account is fully verified.", "sourced", DOCS.entities),
  a("kyc_failed", "Verification", "Status: Failed", "Verification did not pass. Give the recorded reason, and say a new application cannot simply be recreated.", "sourced", DOCS.entities),
  a("kyc_blocked", "Verification", "Status: Blocked", "The account cannot transact. Follow the no-tipping-off rule and hand off to the team.", "sourced", DOCS.entities),
  a("kyc_business_docs", "Verification", "What a business must provide", "Certificate of Incorporation, Memorandum of Association and proof of address for the business. A tax verification document is optional.", "sourced", DOCS.entities),
  a("kyc_officer_docs", "Verification", "What each officer must provide", "A government-issued ID and proof of address", "sourced", DOCS.entities),
  a("kyc_national_ids", "Verification", "National identity numbers", "BVN and NIN for Nigerian nationals and residents; a Social Security number for US nationals and residents", "sourced", DOCS.entities),
  a("kyc_individual_docs", "Verification", "What an individual must provide", "A government-issued ID (passport, driver's licence or national ID) and proof of address dated within the last 3 months, such as a utility bill or bank statement", "sourced", DOCS.entities),
  a("kyc_before_money", "Verification", "Before money moves", "Verification must be complete before an account can hold or move money", "sourced", DOCS.entities),
  a("kyc_faster", "Verification", "Making it faster", "Supplying full document details, such as issue and expiry dates, makes verification faster", "sourced", DOCS.entities),
  a("kyc_how_to_submit", "Verification", "How to submit documents", "Through the platform's dashboard, under Verification. Documents and ID numbers are never collected in chat.", "sample"),
  a("kyc_fail_reasons", "Verification", "Reasons verification fails", "Ownership document missing, document unreadable, name or address does not match, document expired", "sample"),
  l("kyc_review_days", "Verification", "Normal review time", "2", "business days"),

  // Fees and FX (all sample)
  a("fee_local", "Fees and FX", "Local payout fee", "$1.00, £1.00 or ₦50 per payout", "sample"),
  a("fee_swift", "Fees and FX", "SWIFT payout fee", "$15.00 per payout", "sample"),
  a("fee_internal", "Fees and FX", "Internal transfer to another account on the platform", "Free", "sample"),
  a("fee_conversion", "Fees and FX", "Currency conversion", "Rate shown at the time of conversion, with a 0.5% conversion fee", "sample"),
  a("fee_monthly", "Fees and FX", "Monthly account fee", "None", "sample"),

  // Cards and disputes (sample, use cases 1 and 2)
  a("card_replacement_fee", "Cards", "Replacement card fee", "$5.00, £5.00 or ₦1,000 per card", "sample"),
  a("card_delivery", "Cards", "Replacement card delivery", "Sent to the address on file; usually arrives in 5 to 7 business days", "sample"),
  a("card_pin_help", "Cards", "PIN or activation help", "Activate the card and set or reset the PIN in the app under Cards; the PIN is never shared in chat", "sample"),
  a("card_holds", "Cards", "Pending holds", "A pending card payment is a hold, not a charge; if the merchant doesn't collect it, it drops off within 7 days", "sample"),
  a("dispute_process", "Cards", "How a dispute works", "The bank investigates with the merchant through the card scheme; the customer gets a reference and an update within 10 business days; the outcome isn't decided in chat", "sample"),
  l("dispute_window", "Cards", "Disputes can be opened up to", "120", "days after the transaction"),
  l("replacement_fee_usd", "Cards", "Replacement card fee (USD)", "5", "$"),
  l("replacement_fee_gbp", "Cards", "Replacement card fee (GBP)", "5", "£"),
  l("replacement_fee_ngn", "Cards", "Replacement card fee (NGN)", "1000", "₦"),

  // Failed payments and reversals (Nigeria, from the Guardrails' market pack; to verify against current CBN rules)
  a("reversal_atm_own", "Reversals", "Failed ATM withdrawal at the customer's own bank", "Reversal should be instant; if that fails, a manual reversal within 24 hours", "sample"),
  a("reversal_atm_other", "Reversals", "Failed ATM withdrawal at another bank's machine", "Refund within 48 hours", "sample"),
  a("reversal_pos_web", "Reversals", "Failed or disputed POS or web payment", "Resolved within 72 hours", "sample"),
  l("reversal_window_atm_own", "Reversals", "Own-bank ATM reversal due within", "24", "hours"),
  l("reversal_window_atm_other", "Reversals", "Other-bank ATM reversal due within", "48", "hours"),
  l("reversal_window_pos_web", "Reversals", "POS and web reversal due within", "72", "hours"),

  // Account tiers (Nigeria, sample values; to verify against the current CBN tiered KYC rules)
  a("tier_1", "Account limits", "Tier 1 account (NGN)", "Single transfer up to ₦50,000; daily transfers up to ₦300,000; balance up to ₦300,000", "sample"),
  a("tier_2", "Account limits", "Tier 2 account (NGN)", "Single transfer up to ₦100,000; daily transfers up to ₦500,000; balance up to ₦500,000", "sample"),
  a("tier_3", "Account limits", "Tier 3 account (NGN)", "Single transfer up to ₦5,000,000; daily transfers up to ₦25,000,000; no balance cap", "sample"),
  a("tier_up_2", "Account limits", "Moving to Tier 2", "Link your BVN or NIN and add a selfie in the app under Account, Upgrade", "sample"),
  a("tier_up_3", "Account limits", "Moving to Tier 3", "Tier 2 plus proof of address dated within the last 3 months, uploaded in the app", "sample"),
  a("limits_standard", "Account limits", "Standard limits (GBP and USD accounts)", "Daily transfers up to £10,000 or $15,000; higher limits on request after a review", "sample"),
  l("tier_1_single", "Account limits", "Tier 1 single transfer limit", "50000", "₦"),
  l("tier_2_single", "Account limits", "Tier 2 single transfer limit", "100000", "₦"),
  l("tier_3_single", "Account limits", "Tier 3 single transfer limit", "5000000", "₦"),
  l("tier_1_daily", "Account limits", "Tier 1 daily transfer limit", "300000", "₦"),
  l("tier_2_daily", "Account limits", "Tier 2 daily transfer limit", "500000", "₦"),
  l("tier_3_daily", "Account limits", "Tier 3 daily transfer limit", "25000000", "₦"),

  // Loans (sample)
  a("loan_deferral", "Loans", "Payment deferral", "A request to move one month's payment to the end of the loan. Interest keeps running for the deferred month. A request is not an approval: the lending team decides within 3 business days", "sample"),
  a("loan_payoff", "Loans", "Payoff quote", "The balance plus interest to the payoff date; a quote is valid for 7 days", "sample"),
  a("loan_hardship", "Loans", "Financial difficulty", "Customers in financial difficulty are passed to the specialist team, who can discuss options; Alexis doesn't give advice on borrowing", "sample"),
  l("deferral_decision_days", "Loans", "Deferral decision within", "3", "business days"),
  l("payoff_valid_days", "Loans", "Payoff quote valid for", "7", "days"),

  // Merchant payouts (sample)
  a("payout_schedule", "Merchant payouts", "Payout schedule", "Card sales are paid out daily, the next business day, net of fees, refunds and dispute reserves", "sample"),
  a("payout_rejected", "Merchant payouts", "A payout the merchant's bank rejected", "The merchant corrects the settlement account in the dashboard; the payout is resent within 1 business day after", "sample"),

  // Limits and approvals
  l("action_initiate_recall", "Limits and approvals", "Recalls switched on", "on"),
  l("action_generate_proof_of_payment", "Limits and approvals", "Proof of payment switched on", "on"),
  l("recall_cap_usd", "Limits and approvals", "Recall cap before human approval (USD)", "10000", "$"),
  l("recall_cap_gbp", "Limits and approvals", "Recall cap before human approval (GBP)", "8000", "£"),
  l("recall_cap_ngn", "Limits and approvals", "Recall cap before human approval (NGN)", "10000000", "₦"),
  l("recall_limit", "Limits and approvals", "Recalls per customer before a human reviews", "3", "per 30 days"),
  l("recall_cap_personal_usd", "Limits and approvals", "Recall cap for personal accounts (USD)", "1000", "$"),
  l("recall_cap_personal_gbp", "Limits and approvals", "Recall cap for personal accounts (GBP)", "800", "£"),
  l("recall_cap_personal_ngn", "Limits and approvals", "Recall cap for personal accounts (NGN)", "500000", "₦"),
  l("identity_attempts", "Limits and approvals", "Failed identity checks before the check ends", "2", "per conversation"),
  l("reset_link_limit", "Limits and approvals", "Password reset links per customer", "3", "per 24 hours"),
  l("dispute_cap_usd", "Limits and approvals", "Dispute cap before human approval (USD)", "500", "$"),
  l("dispute_cap_gbp", "Limits and approvals", "Dispute cap before human approval (GBP)", "400", "£"),
  l("dispute_cap_ngn", "Limits and approvals", "Dispute cap before human approval (NGN)", "250000", "₦"),
  l("dispute_limit", "Limits and approvals", "Disputes per customer before a human reviews", "3", "per 90 days"),
  l("replacement_limit", "Limits and approvals", "Replacement cards per customer", "2", "per 12 months"),
  l("reversal_cap_usd", "Limits and approvals", "Reversal cap before human approval (USD)", "1000", "$"),
  l("reversal_cap_gbp", "Limits and approvals", "Reversal cap before human approval (GBP)", "800", "£"),
  l("reversal_cap_ngn", "Limits and approvals", "Reversal cap before human approval (NGN)", "500000", "₦"),
  l("action_request_reversal", "Limits and approvals", "Reversal requests switched on", "on"),
  l("waiver_cap_usd", "Limits and approvals", "Fee waiver cap (USD)", "35", "$"),
  l("waiver_cap_gbp", "Limits and approvals", "Fee waiver cap (GBP)", "25", "£"),
  l("waiver_cap_ngn", "Limits and approvals", "Fee waiver cap (NGN)", "2000", "₦"),
  l("waiver_limit", "Limits and approvals", "Goodwill fee waivers per customer", "1", "per 12 months"),
  l("action_waive_fee", "Limits and approvals", "Fee waivers switched on", "on"),
  l("action_request_deferral", "Limits and approvals", "Loan deferral requests switched on", "on"),
  l("action_freeze_card", "Limits and approvals", "Card freezing switched on", "on"),
  l("action_order_replacement", "Limits and approvals", "Replacement cards switched on", "on"),
  l("action_open_dispute", "Limits and approvals", "Disputes switched on", "on"),
  l("action_send_reset_link", "Limits and approvals", "Reset links switched on", "on"),
  l("action_unlock_account", "Limits and approvals", "Unlocking switched on", "on"),

  // Response targets (owner, Nov 23) and the business-hours calendar
  l("response_urgent", "Response targets", "Urgent: first human response within", "1", "hours"),
  l("response_high", "Response targets", "High: first human response within", "4", "business hours"),
  l("response_normal", "Response targets", "Normal: first human response within", "1", "business days"),
  l("business_days", "Response targets", "Business days", "Monday to Friday"),
  l("business_open", "Response targets", "Business hours start", "09:00"),
  l("business_close", "Response targets", "Business hours end", "17:00"),
];

/** The Guardrails' fixed rules: shown locked on the Rules screen, enforced in code, never editable. */
export const FIXED_RULES = [
  "Identity is checked before any account data is shared or any action is taken",
  "Alexis never asks for or uses passwords, one-time codes, full card numbers or API secret keys",
  "No tipping off: the reason for a review hold is never revealed or hinted at",
  "Every lookup, action, refusal and approval is written to the audit log",
  "Alexis always says it is an AI and offers a human",
];
