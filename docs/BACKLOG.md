# Backlog

Everything after the 2-day demo (`docs/DEMO-SPEC.md`), in the PRD's phase order. Full detail is in
`docs/source/`.

## Added Nov 23

- **Stronger identity check (one-time code)**: `send_one_time_code` (tier 0, session only) sends a
  simulated code to the contact on file and marks the session stronger-verified. Once it lands, every
  tier 3 tool and all of account access and recovery require it. Rules: the code only goes to contact
  details already on file, never to a number or address given in chat; the agent never asks the
  customer to read back a code the bank didn't just send for this purpose. Left out of the first demo
  (owner, Nov 23); the demo runs `initiate_recall` on the standard check plus payment rights.

- **Staff actions panel** (Tomi, Nov 23: "put it on a backlog"): today staff can only look things up, draft
  and reply, approve or decline a prepared recall, and resolve cases; account actions happen in the bank's own
  back office. Planned: an Actions panel beside the conversation (Inbox once taken over, Staff queue) with the same
  actions as Alexis (freeze, unfreeze, card settings, replacement, recall, reversal, bill refund, fee waiver,
  unlock, reset link, dispute, deferral request) plus ones she can't take (a supervisor lifting a bank freeze).
  Same tool code, checks and Bank Connector calls; identity from the chat's check or the agent recording
  "verified another way"; the customer's Yes/Cancel still required for tier 2/3; who may do what set on the Rules
  screen (agent limit, supervisor above it, second supervisor above a higher one); every action in the audit log
  under the staff member's name, sent to webhooks, and shown to the customer ("Ife from the support team unfroze
  your card ending 7710").
- **Proactive failure messages** (explained Nov 23, not yet requested): message the customer when a payment
  fails, with the reason and the fix; new Events API types (card declined, transfer returned); per-institution
  failure types, channels, quiet hours, daily cap and approved wording; never for review holds or fraud.
- **CRM team replies**: an API for a reply typed in the CRM to reach the customer through Orchestra.
- **AI cost per conversation** on the dashboard, from the model's usage figures.

## Built on Nov 23 (after the demo)

Items 2, 4 (hours-saved dashboard), 5 and 8 below, and channels as simulated email and WhatsApp (item 6):
see `docs/STATUS.md`. Still open from this list: Nuvion's real rules (1), real WhatsApp and email
connections, voice notes (left out by Tomi), and the country packs' content.

## After the demo (Build Plan order, Nov 23)

The order that follows best from a successful pitch; detail in the phases below.

1. Replace the dummy rule set with Nuvion's real rules (the list at the end of KNOWLEDGE-BASE.md).
2. Password protection for the live link.
3. Cards and card disputes.
4. Staff time savers: proactive updates, claim and evidence drafting, staff mode with support agent and
   supervisor roles.
5. Rules from an uploaded policy document, with approval and version history.
6. More channels: in-app, then WhatsApp.
7. The retail bank pack: loans, failed ATM and POS reversals, airtime and bills, USSD, with the Nigeria
   market rules.
8. Operations: outage mode, resuming a case by reference, fallback when the AI service is down, the
   hours-saved dashboard.

## Phases (PRD)

1. **Core retail use cases 1-4**: cards (`get_card`, `freeze_card`, `order_replacement`), transactions
   and disputes (`list_transactions`, `open_dispute`), transfers (`get_transfer_status`,
   `initiate_recall`), account access (`verify_identity`, `send_reset_link`, `unlock_account`).
2. **Use cases 5, 6, 12, 15 (retail)**: `get_balance`, `get_fees`, `waive_fee`, `get_kyc_status`,
   `explain_rejection`, `find_payments`, `get_reversal_status`, `request_reversal`,
   `get_account_limits`, `get_account_restrictions`; `log_complaint`; 20 planted retail cases.
3. **Payment tracing, loans, merchants**: use cases 9, 10 (screenshot upload), 11 (timeline root-cause:
   authorized-not-captured → merchant's integration; captured-not-settled → processor/acquirer;
   settled-no-payout → platform or bank hold; declined → card issuer; conflicting timeline → escalate),
   then 7 (loans) and 8 (merchant payouts). Tables `payment_events`, `loans`, `merchants`, `payouts`,
   `holds`.
4. **Staff time savers**: 17 proactive updates (`watch_case`, `send_status_update`), 18 claim drafting
   (`draft_claim_pack`), 19 staff mode (`summarise_case`, `draft_reply`, `draft_case_notes`); roles
   support agent and supervisor; the hours-saved dashboard (`handling_times`, placeholder minutes).
5. **Configuration**: the Rules screen's basic edit-in-place is in the demo (Knowledge Base, Nov 23).
   Later: upload a policy document and have rules extracted for review; approval before a change goes
   live; version history with rollback; separate rule sets per market; test a change against saved
   conversations before publishing; the off switch for the agent or any single action.
6. **Nigeria completion**: use cases 13, 14 and 16 are built (Nov 23); still to do: the market pack (local transfer types, KYC tiers,
   fees, CBN complaint rules).
7. **Channels**: in-app chat in a phone frame, then WhatsApp.
8. **Operations**: outage mode, case continuity by reference, fallback when the AI is down,
   conversation review, extra languages, voice notes.

Retail caps (Guardrails): fee waiver $35/£25/₦2,000; dispute $500/£400/₦250,000; recall and reversal
$1,000/£800/₦500,000; bill refund $100/£80/₦50,000. Per-customer: 1 goodwill waiver per 12 months,
3 disputes per 90 days, 3 recalls/reversals per 30 days, 2 replacement cards per 12 months, 3 reset
links per 24 hours, failed identity checks 2 per conversation and 5 per 24 hours (then flagged).

## Still to verify (Guardrails)

Nigeria: whether the 72-hour POS/web rule (CBN 2020) was replaced; current complaint timelines under
the revised CBN Consumer Protection Regulations; the tipping-off offence's wording and penalties. UK and
US market packs in full. Whether the demo caps suit a bank-executive audience. Legal review before any
live use.
