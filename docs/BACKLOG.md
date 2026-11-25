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
- **"Sign in with Zendesk / HubSpot" (OAuth) for the CRM connectors** (owner, Nov 23): needed before
  Orchestra is offered to more than one bank. Zendesk's Developer Terms require a global OAuth client
  for an app used by several Zendesk customers (customers may not share API tokens with a vendor, and
  API tokens are marked deprecated); HubSpot stopped new legacy private apps on Oct 26, 2026, so new
  connections need an app on its new developer platform. Work: register Orchestra with each (Zendesk
  reviews and approves a global OAuth client; HubSpot app via its developer platform), a Connect button
  that opens the product's sign-in window, store the refresh token encrypted like today's details, renew
  access tokens, and where the API allows it create the webhook automatically so step 2 disappears.
  Today's typed-token connect stays for the pilot. Connect as a dedicated staff account (Tomi, Nov 23: a
  friend's fintech agent works this way): the bank creates an "Alexis (AI)" agent user with its own role,
  Orchestra signs in as that user through the API (never by driving the CRM's screens), tickets reach
  her through the CRM's own routing, her replies and notes appear under her name, and handing off is
  reassigning the ticket to a person or queue with her summary as an internal note. Costs the bank a seat.
- **WhatsApp, connected directly** (owner, Nov 23): today a bank's own system relays WhatsApp messages
  through the Channel API. Directly: connect a WhatsApp Business number on the API page (Meta's Cloud
  API, or a provider such as Twilio or Infobip), receive messages on Orchestra's own webhook, send
  replies and templates for messages outside the 24-hour window, and show forms (identity check,
  Yes/Cancel, codes) as WhatsApp buttons or a secure link. Needs a Meta business verification per bank.
- **App chat, ready-made** (owner, Nov 23): a chat widget or mobile SDK a bank drops into its app
  instead of building the screen on the Channel API: sign-in handed over from the app, forms shown
  natively, push notifications for replies.
- **All four CRM connectors: Zendesk, HubSpot, Freshdesk, Salesforce** (owner, Nov 23: Freshdesk and
  Salesforce moved to the backlog, then Zendesk and HubSpot too). Zendesk and HubSpot come back with
  "Sign in with…" above; the typed-details connect, step 2's webhook address and the demos are built and
  tested, ready for when one is offered again. The code stays
  (`lib/crm/connectors.ts`, tested against the stand-in) but they aren't offered: `OFFERED_KINDS` in
  `lib/crm/contract.ts` is empty, so the API page doesn't show them, their webhooks
  answer 404 and data entry skips them. To bring one back: add it to `OFFERED_KINDS` after checking it.
  Freshdesk: its API key sign-in and where the key is were confirmed in its docs (Nov 23); its docs also
  list OAuth scopes, so "Sign in with Freshdesk" through Freshworks' developer platform is possible;
  check Freshworks' marketplace terms before offering it to many banks. Salesforce: not verified (its
  docs load from help.salesforce.com, which this workspace can't reach); check whether a bank admin's
  connected app is still the way, or External Client Apps, and plan "Sign in with Salesforce" with
  Orchestra's own app for many banks (AppExchange review if listed).

- **Tell the team when a case arrives** (Tomi, Nov 25): today a new case shows only on the Cases screen,
  or reaches the company's own tools if they set up the "case created" webhook. Add a simple option:
  email the routed team (or a chosen address) when a case opens, at least for high urgency, and again
  when one goes overdue. Settings on the Rules screen (which urgencies, which address per team). Send
  through the support email provider (Postmark); the email carries the summary's headline and a link to
  the case, never account numbers or other customer details beyond what the team's role may see.
- **Team members** (Tomi, Nov 25): today a team is only a name in the `route_*` rules; accounts have a role but no
  team, so every agent sees and can pick up every team's cases. Add a team field (one or more teams) to each
  account on the Team page, choosing from the teams the routing rules name. Each person's Cases screen opens on
  their own teams' cases first (the others stay visible and movable); team emails (the item above) go to the
  team's members unless a team address is set. Roles and permissions don't change.

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
