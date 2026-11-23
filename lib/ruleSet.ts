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

  // Card controls (Tomi, Nov 23: "give configuration ability where applicable"). Each institution decides
  // whether Alexis may unfreeze cards and change settings, what needs the one-time code, and the highest
  // daily limit she may set; per market on the Rules screen. Making a card safer never needs the code.
  a("card_settings_help", "Cards", "Card settings in the app", "Customers can switch online, international and contactless payments on or off, change the daily limit and unfreeze a card they froze themselves, in the app under Cards", "sample"),
  l("card_unfreeze_stronger", "Cards", "Unfreezing a card needs the one-time code", "on"),
  l("card_unfreeze_block_dispute", "Cards", "No unfreezing while a 'not mine' dispute is open on the card", "on"),
  l("card_settings_stronger", "Cards", "Switching a card setting on needs the one-time code (switching off never does)", "off"),
  l("card_limit_change", "Cards", "Alexis can change a card's daily limit", "on"),
  l("card_limit_raise_stronger", "Cards", "Raising the daily limit needs the one-time code (lowering never does)", "on"),
  l("card_limit_max_usd", "Cards", "Highest daily card limit Alexis can set (USD)", "10000", "$"),
  l("card_limit_max_gbp", "Cards", "Highest daily card limit Alexis can set (GBP)", "8000", "£"),
  l("card_limit_max_ngn", "Cards", "Highest daily card limit Alexis can set (NGN)", "1000000", "₦"),

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
  // KYC tiers per country (Nov 23): only some countries use numbered tiers. The switch, the explanation
  // and the tier currency have a value per market (SEED_OVERRIDES below); the tier figures apply where
  // tiers are used. Alexis explains them; the bank's own systems apply them.
  l("kyc_tiers_used", "Account limits", "This country uses numbered KYC tiers", "off"),
  a("kyc_approach", "Account limits", "How verification and limits work here", "Accounts are verified with the standard identity checks when they open. Limits depend on the account, and higher limits are available on request after a review", "sample"),
  a("tier_currency", "Account limits", "Currency of the tier limits", "NGN", "sample"),
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

  // Airtime, data and bills (sample; the CBN/NCC framework for failed airtime and data is an exposure draft)
  a("bills_failed", "Bills and airtime", "Paid but not delivered", "If the provider shows the purchase failed, it is refunded to the account; delivered purchases can't be refunded here", "sample"),
  a("bills_pending", "Bills and airtime", "Pending at the provider", "Usually delivered within 30 minutes; check again after that", "sample"),
  a("ussd_help", "USSD and agents", "USSD and agent banking", "USSD problems are handled like the matching transfer or failed payment; cash problems at an agent location are passed to the team, who contact the agent", "sample"),
  l("bill_refund_cap_ngn", "Limits and approvals", "Bill or airtime refund cap (NGN)", "50000", "₦"),
  l("bill_refund_cap_usd", "Limits and approvals", "Bill or airtime refund cap (USD)", "100", "$"),
  l("bill_refund_cap_gbp", "Limits and approvals", "Bill or airtime refund cap (GBP)", "80", "£"),
  l("action_refund_bill_payment", "Limits and approvals", "Bill and airtime refunds switched on", "on"),

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
  l("action_unfreeze_card", "Limits and approvals", "Card unfreezing switched on", "on"),
  l("action_change_card_settings", "Limits and approvals", "Card settings changes switched on", "on"),
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

  // Routing (Nov 23): the team each kind of handoff goes to (lib/routing.ts). Sample teams; edit to match the institution.
  a("route_account_access", "Routing", "Team for: Account access", "Customer support", "sample"),
  a("route_airtime_and_bills", "Routing", "Team for: Airtime and bills", "Payments team", "sample"),
  a("route_balances", "Routing", "Team for: Balances", "Customer support", "sample"),
  a("route_cards", "Routing", "Team for: Cards", "Cards team", "sample"),
  a("route_complaint", "Routing", "Team for: Complaint", "Complaints team", "sample"),
  a("route_failed_payments_and_reversals", "Routing", "Team for: Failed payments and reversals", "Payments team", "sample"),
  a("route_fees_and_limits", "Routing", "Team for: Fees and limits", "Customer support", "sample"),
  a("route_fraud_and_scams", "Routing", "Team for: Fraud and scams", "Fraud team", "sample"),
  a("route_general_question", "Routing", "Team for: General question", "Customer support", "sample"),
  a("route_incoming_payments", "Routing", "Team for: Incoming payments", "Payments team", "sample"),
  a("route_loans", "Routing", "Team for: Loans", "Lending team", "sample"),
  a("route_merchant_payouts", "Routing", "Team for: Merchant payouts", "Merchant team", "sample"),
  a("route_payment_tracing", "Routing", "Team for: Payment tracing", "Payments team", "sample"),
  a("route_payouts", "Routing", "Team for: Payouts", "Payments team", "sample"),
  a("route_transactions_and_disputes", "Routing", "Team for: Transactions and disputes", "Cards team", "sample"),
  a("route_ussd_and_agent_banking", "Routing", "Team for: USSD and agent banking", "Payments team", "sample"),
  a("route_verification", "Routing", "Team for: Verification (KYC)", "Compliance team", "sample"),
  l("route_overdue_raise", "Routing", "Raise a case's urgency one step when it passes its response target with nobody on it", "on"),

  // Staff actions (Nov 23): account actions the team takes from the console (lib/staffActions.ts). The same checks as
  // Alexis's, the customer's yes in their app and the stronger check stay fixed; these say who may act on how much.
  l("staff_actions_enabled", "Staff actions", "Staff can take account actions from the console", "on"),
  l("staff_agent_actions", "Staff actions", "Support agents can take account actions (off: supervisors only)", "on"),
  l("staff_agent_limit_usd", "Staff actions", "Highest amount a support agent can act on alone (USD)", "2000", "$"),
  l("staff_agent_limit_gbp", "Staff actions", "Highest amount a support agent can act on alone (GBP)", "1500", "£"),
  l("staff_agent_limit_ngn", "Staff actions", "Highest amount a support agent can act on alone (NGN)", "1000000", "₦"),
  l("staff_dual_limit_usd", "Staff actions", "Above this, a second supervisor must approve (USD)", "10000", "$"),
  l("staff_dual_limit_gbp", "Staff actions", "Above this, a second supervisor must approve (GBP)", "8000", "£"),
  l("staff_dual_limit_ngn", "Staff actions", "Above this, a second supervisor must approve (NGN)", "5000000", "₦"),

  // Proactive failure messages (Nov 23, Tomi: "build #2"; lib/proactive.ts). Never on a review hold or for fraud (fixed).
  l("proactive_enabled", "Proactive messages", "Message customers when a payment fails", "on"),
  l("proactive_card_declined", "Proactive messages", "Declined card payments (a setting, the limit, a frozen card, funds)", "on"),
  l("proactive_transfer_returned", "Proactive messages", "Payouts that didn't go through and came back", "on"),
  l("proactive_failed_debited", "Proactive messages", "Card, POS or ATM payments that failed but debited the account", "on"),
  l("proactive_daily_cap", "Proactive messages", "Most failure messages to one customer in 24 hours", "2", "messages"),
  l("proactive_quiet_start", "Proactive messages", "Quiet hours start (messages wait until they end)", "21:00"),
  l("proactive_quiet_end", "Proactive messages", "Quiet hours end", "08:00"),
  a("proactive_text_card_declined", "Proactive messages", "Wording: declined card payment", "Your {amount} payment to {merchant} on your card ending {card} was declined because {reason}. {fix} If this wasn't you, reply \"not me\" and we'll freeze the card.", "sample"),
  a("proactive_text_transfer_returned", "Proactive messages", "Wording: payout returned", "Your {amount} payout {reference} to {recipient} didn't go through: {reason}. The money is back in your account. Reply here and I can help you send it again with the right details.", "sample"),
  a("proactive_text_failed_debited", "Proactive messages", "Wording: failed but debited", "Your {amount} {channel} payment at {merchant} didn't go through, but your account was debited. The money should come back within {window}; reply here if it hasn't and I'll chase it.", "sample"),

  // Billing (Nov 23, Tomi: "platform fee plus usage"; lib/billing.ts). Sample plan values to agree with each
  // institution. AI prices are samples too: set them from the model provider's price list.
  l("billing_platform_fee", "Billing", "Monthly platform fee", "1500", "$"),
  l("billing_included", "Billing", "Conversations resolved by Alexis included each month", "500", "conversations"),
  l("billing_price_resolved", "Billing", "Price per conversation resolved by Alexis, beyond those included", "0.80", "$"),
  l("billing_price_handoff", "Billing", "Price per conversation handed to the team (summary and routing)", "0.20", "$"),
  l("billing_bank_pays_ai", "Billing", "The institution pays its AI provider directly (off: Orchestra's AI account)", "off"),
  l("ai_price_input", "Billing", "AI price per million input tokens (sample)", "3", "$"),
  l("ai_price_output", "Billing", "AI price per million output tokens (sample)", "15", "$"),
  l("ai_price_cache_read", "Billing", "AI price per million cached input tokens read (sample)", "0.30", "$"),
  l("ai_price_cache_write", "Billing", "AI price per million input tokens written to the cache (sample)", "3.75", "$"),

  // Operations (Nov 23): the switch for Alexis herself, and outage mode with the notice customers see.
  l("alexis_enabled", "Operations", "Alexis answers customers (off: every message goes to the team)", "on"),
  l("outage_mode", "Operations", "Outage mode (Alexis and the customer app show the notice below)", "off"),
  a("outage_notice", "Operations", "Outage notice", "Card payments and payouts are delayed while we fix a problem with a payment partner. No money is lost, and delayed payments will complete once it's fixed. We'll update this notice.", "sample"),

  // Time saved (sample values for the hours-saved dashboard, Nov 23): how long a person takes to handle
  // each kind of conversation, and what a handoff summary saves when the case still goes to a person.
  l("time_payouts", "Time saved", "Staff handling time: payouts", "12", "minutes"),
  l("time_incoming_payments", "Time saved", "Staff handling time: incoming payments", "15", "minutes"),
  l("time_verification", "Time saved", "Staff handling time: verification", "10", "minutes"),
  l("time_balances", "Time saved", "Staff handling time: balances", "4", "minutes"),
  l("time_fees_and_limits", "Time saved", "Staff handling time: fees and limits", "8", "minutes"),
  l("time_account_access", "Time saved", "Staff handling time: account access", "10", "minutes"),
  l("time_cards", "Time saved", "Staff handling time: cards", "10", "minutes"),
  l("time_transactions_and_disputes", "Time saved", "Staff handling time: transactions and disputes", "15", "minutes"),
  l("time_failed_payments_and_reversals", "Time saved", "Staff handling time: failed payments and reversals", "15", "minutes"),
  l("time_payment_tracing", "Time saved", "Staff handling time: payment tracing", "20", "minutes"),
  l("time_loans", "Time saved", "Staff handling time: loans", "12", "minutes"),
  l("time_merchant_payouts", "Time saved", "Staff handling time: merchant payouts", "15", "minutes"),
  l("time_airtime_and_bills", "Time saved", "Staff handling time: airtime and bills", "8", "minutes"),
  l("time_ussd_and_agent_banking", "Time saved", "Staff handling time: USSD and agent banking", "12", "minutes"),
  l("time_complaint", "Time saved", "Staff handling time: complaints", "20", "minutes"),
  l("time_fraud_and_scams", "Time saved", "Staff handling time: fraud and scams", "20", "minutes"),
  l("time_general_question", "Time saved", "Staff handling time: general questions", "6", "minutes"),
  l("time_handoff_summary", "Time saved", "Time a handoff summary saves on a case a person still handles", "5", "minutes"),
  l("time_staff_cost", "Time saved", "Cost of an hour of a support agent's time", "15", "$"),
];

/** Starting values for one market only (the Rules screen's per-market values). Sample values. */
export const SEED_OVERRIDES: { rule: string; market: "NG" | "UK" | "US"; value: string }[] = [
  { rule: "kyc_tiers_used", market: "NG", value: "on" },
  { rule: "kyc_approach", market: "NG", value: "Accounts have three tiers. Each tier unlocks higher limits as the customer adds more identity details, and they can move up in the app at any time" },
  { rule: "kyc_approach", market: "UK", value: "There are no numbered tiers. Identity is checked when the account opens, with extra checks for some customers or larger amounts. Higher limits are available on request after a review" },
  { rule: "kyc_approach", market: "US", value: "There are no numbered tiers. Identity is checked as required to open the account, with extra checks for some customers or activity. Higher limits are available on request after a review" },
];

/** The Guardrails' fixed rules: shown locked on the Rules screen, enforced in code, never editable. */
export const FIXED_RULES = [
  "Identity is checked before any account data is shared or any action is taken",
  "Alexis never asks for or uses passwords, one-time codes, full card numbers or API secret keys",
  "No tipping off: the reason for a review hold is never revealed or hinted at",
  "Every lookup, action, refusal and approval is written to the audit log",
  "Alexis always says it is an AI and offers a human",
];
