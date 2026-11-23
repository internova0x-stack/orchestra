# Build status

Where the 2-day demo stands against `docs/BUILD-PLAN.md`. Update this file when a step changes.

| Step | What | Status |
|---|---|---|
| 1 | Foundation and payout tracing (tests 1, 2, 3) | Built |
| 2 | Proof of payment (tests 8, 9) | Built |
| 3 | Incoming payment not credited (tests 6, 7) | Built |
| 4 | Review hold and safety behaviours (test 11, S1, S3, S4, S5) | Built |
| 5 | Recall, roles and the Staff queue (tests 4, 5) | Built |
| 6 | The Rules screen (S6) | Built |
| 7 | Verification, fees and the bank-details refusal (tests 10, 12, S2) | Built |
| 8 | Full test run and polish | Polish done; **the full run with the real model is still to do** |
| - | Putting it online (Vercel) | Live at https://orchestra-plum.vercel.app (Nov 23); database connected. Vercel holds `DATABASE_URL`, `DATABASE_PASSWORD` (the password alone, which overrides the one inside the string) and `ANTHROPIC_API_KEY`, each for Production and Preview |

## After step 8 (Nov 23)

- Supabase connections are encrypted (`ssl: "require"` unless the database is local).
- First-time setup runs once per server process, under a database lock, so two first visitors can't seed
  twice.
- Several matching payments show as compact cards the customer clicks to choose (Design System).
- Two failed identity checks flag the case for staff in code (Guardrails), not only by Alexis's choice.

## The remaining use cases (Nov 23, after the demo)

Every use case in the PRD is now built, one commit each, with tools, checks in code, prompt sections in
`prompts/extended-scope.md` and tests: 4 account access (with the one-time code), 1 cards, 2 transactions
and disputes, 12 debited but no value, 5 and 15 fee waivers and limits, 9 and 11 transaction IDs and
root-cause tracing, 10 complaints with screenshots, 7 loans, 8 merchant payouts, 17 proactive updates,
18 claim drafting, 19 staff mode, 13 wrong recipient and personal accounts, 14 airtime, data and bills
(`get_bill_payment_status`, `refund_bill_payment` with the stronger check and a cap), 16 USSD and agent
banking (`get_ussd_session`; cash at an agent always goes to a person). `npm test` runs 77 tests.
Not built because they aren't use cases: the hours-saved dashboard and the Operations phase (backlog).

## Console and customer app (Nov 23, Tomi: the platform is what banks use, receiving messages)

The main app is now the bank's **support console**: Inbox (every conversation, live: chat and Alexis's
activity side by side, counts and filters; the Cases screen became it), Staff queue and Rules. The chat is
a separate **customer app** at `/customer` in a phone frame, with a "Playing the customer" panel for
testers. **Take over** (Tomi: "Watch and take over"): a signed-in member of the team takes a conversation
over (`lib/takeover.ts`): anything waiting on the customer (identity form, code, Yes/Cancel) is closed,
Alexis is paused, the customer's messages wait for the person, their replies reach the customer app, and
Hand back returns it to Alexis, who reads the team's replies as labelled text. Each step is in the audit
log under the person's name. Checked by tests and a browser run against a stand-in AI service.

## The Cases screen (Nov 23, Tomi: "Every conversation")

A Cases tab lists every customer conversation, not only handoffs (`lib/cases.ts`, `app/cases`,
`app/api/cases`). Each shows the customer, a category (the first area Alexis looked into; a complaint or
fraud handoff overrides it; a handoff with no lookups takes its reason's area), a status (In progress,
Waiting on customer, Resolved by Alexis after 15 idle minutes, Handed off, Needs approval, Resolved by
staff), the urgency of any handoff, and opens the full chat history and activity log, with links to the
Staff queue for handoffs. Filters by status, category and urgency, a search, and counts at the top (all
worked out from the data already stored: no new tables).

## Backlog items 2 to 6 (Nov 23, Tomi: "Build 2, 3, 4, 5 should be email and whatsapp, and 6")

- **Password** (whole site, one password): `SITE_PASSWORD` in Vercel; `proxy.ts` sends anyone without the
  cookie to `/login`; the cookie holds a hash, 30 days. Without the setting the site stays open.
- **Hours-saved dashboard** (`/dashboard`, `lib/dashboard.ts`): time and cost saved by category and day,
  from sample handling times on the Rules screen (Time saved); reviews and conversations waiting for the team.
- **Rules management** (`lib/ruleChanges.ts`, `lib/policyExtract.ts`): sign-in on the Rules screen; a
  support agent's change waits for a supervisor, a supervisor's goes live; history with Restore; values per
  market (Nigeria, UK, United States; `rule_overrides`, read for the customer's country); "Past
  conversations" lists where Alexis used a rule; a policy document (PDF or text) is read by Claude into
  proposed changes with their quotes, always waiting for approval.
- **Email and WhatsApp, simulated**: the customer app's Channel switcher; Alexis writes in each channel's
  style; the Inbox labels and filters by channel; an email's subject is kept.
- **Operations**: Alexis's on/off switch and outage mode with its notice (Rules › Operations; a bar across
  the console, a notice in the customer app, a line in Alexis's session note); conversations wait for the
  team when Alexis is off or the AI service is down ("Waiting for the team"); `find_case` picks up a case by
  its reference (the customer's own only); conversation review (Good / Needs work, filter, dashboard);
  languages (English, French, Nigerian Pidgin; Tomi, Nov 23) with a "Translate to English" for the team. Voice notes left out (Tomi).
- New rules reach an existing database on deploy (missing ones are added; edited values are kept).
- **KYC tiers per country** (Nov 23; explaining, not enforcing): rules `kyc_tiers_used` (on for Nigeria),
  `kyc_approach` (how verification and limits work, per country) and `tier_currency`, with starting values per
  market in `SEED_OVERRIDES`. `get_account_limits` and `get_kyc_status` follow the customer's country: tiers,
  limits and what's needed to move up where tiers are used; how verification works where they aren't.
  Upgrades and tier disputes go to a person. Figures are sample values until Nuvion supplies its own.

## Orchestra API, step 2 of 2 (Nov 23)

For systems that call Orchestra, under `/api/v1` with an API key (`lib/api/`; `public/openapi/orchestra-api-v1.yaml`):
- **Channel API**: open a conversation (`verified_user_id` for a customer the bank's app signed in; channel, language,
  external_ref), send the customer's message or their identity answers, Yes/Cancel or code, and get Alexis's reply with
  any form under `needs`; read the conversation. Same turn, checks, take-over and audit log as the customer app.
- **Events API**: recall, reversal, dispute and verification status changes, applied once per event id; Alexis's
  proactive updates follow.
- **Webhooks**: case.created, case.updated, conversation.taken_over / handed_back, conversation.reviewed,
  message.created, customer.notified; signed (Orchestra-Signature, HMAC-SHA256), public https addresses only, sent
  after the response, kept with their status, up to 5 attempts, retry and test from the console.
- **Keys and endpoints**: the API page (supervisors only) creates and revokes keys (shown once, stored as a hash) and
  adds or removes webhook endpoints (secret shown once). Configuration survives Reset demo.
Checked by tests (keys, signatures, events once, signed-in conversation, docs in step) and a local end-to-end run.

## Bank Connector API, step 1 of 2 (Nov 23, Tomi: "build something systems can connect to")

Orchestra reads a bank's core records and asks it to act through one published contract
(`lib/bank/contract.ts`, `public/openapi/bank-connector-v1.yaml`, the console's API page). `bank(sql)` picks the
bank: any implementation over HTTPS when `BANK_API_URL` and `BANK_API_KEY` are set (`lib/bank/http.ts`: bearer key,
10 s timeout, one retry on reads, Idempotency-Key on actions), otherwise the simulated bank (`lib/bank/simulated.ts`).
The simulated bank also serves the contract at `/api/bank/v1` (needs `BANK_API_KEY`; outside the site password).
Through it: the identity check, the verified customer's profile, payouts, incoming payments, verification,
balances, fees, restrictions and recalls (a supervisor's approval submits an over-cap recall). A test runs the tools
over HTTP against the reference server and checks every answer matches. Step 2: the Orchestra API (channels, events,
webhooks, keys).

Extended to every area (Nov 23, Tomi: "extend the bank connector to other areas"): contact details and the
online-access unlock, cards (freeze, replace) and card transactions, payments with their stage-by-stage timeline
(looking up another holder's payment id says only `elsewhere`), loans, merchant payouts and holds, bill payments
(refund), USSD and agent sessions, and the goodwill fee refund. 25 endpoints in all. No tool reads the bank's
tables directly any more; the proactive-updates job reads holds, contact details and verification through it too.
Orchestra's own case records (disputes, reversal and deferral requests, waivers, recalls, escalations, claim drafts)
stay in its database; where a check spans both (a dispute matching a payment), Orchestra matches its record with the
bank's transaction. An action the bank refuses (`accepted: false`) becomes a handoff. The HTTP test now also covers
cards, transactions, payments, timelines, loans, payouts, holds, bills, USSD and limits, and the freeze, unlock and
bill-refund actions.

## Smart routing and drafted replies (Nov 23, Tomi: "3 build")

Routing (`lib/routing.ts`): every handoff is routed to a team from its category, by the institution's routing
rules on the Rules screen ("Team for: Cards" → Cards team, and so on, one per category; edit to rename or merge
teams). The Staff queue shows each case's team, who has it and its response target, filters by team and by
Mine / Nobody on it / Overdue, and has Pick up and Move to. A case that passes its response target with nobody on it
is flagged overdue (logged, `case.updated` webhook with `overdue: true`) and, while "Raise a case's urgency…" is on,
goes up one urgency step; overdue cases sort first. `case.created` webhooks carry the team and category, so a CRM or
helpdesk can drop the ticket in the right queue.

Drafted replies (`lib/drafting.ts`, `POST /api/drafts`): "Draft with Alexis" in the Inbox's reply box (after taking
over) and in the Staff queue's new "Reply to customer" tab. Alexis drafts from the conversation, the handoff summaries
and the team's decisions, in the customer's language and the channel's style, with the review-hold wording when a
case is held. It only fills the box: the person edits and sends. Sending from the Staff queue takes the conversation
over first, so the customer sees it came from a person. Each draft is in the activity log. Two new tests (a stand-in
replaces the model in the drafting test).

## Card controls (Nov 23, Tomi: "build 1 but give configuration ability where applicable")

Alexis can unfreeze a card the customer froze (`unfreeze_card`) and change its settings (`change_card_settings`:
online, international and contactless payments on or off, the daily limit); `get_card` now shows the settings and
who froze it. Each institution configures it on the Rules screen, per market if it wants: the switches "Card
unfreezing switched on" and "Card settings changes switched on" (off: Alexis hands off), whether unfreezing needs
the one-time code (on), whether an open "not mine" dispute keeps the card frozen (on), whether switching a setting
on needs the code (off), whether Alexis may change the limit at all (on), whether raising it needs the code (on),
and the highest daily limit she may set ($10,000, £8,000, ₦1,000,000). Making a card safer (switching off,
lowering) never needs the code. A freeze the bank placed is never lifted or worked around. Both go to the bank
through the connector (`POST /cards/{id}/unfreeze`, `/settings`; 27 endpoints). Planted: Grace's online payment
was declined because online payments are off on her card; Emeka hit his ₦200,000 daily limit. Two new tests.

## First runs with the real model (Nov 23)

The live site's first real turns failed after any tool call: the session context (time, identity) was
rebuilt inside the top-level system prompt, which invalidates Claude's earlier thinking blocks (a 400,
"bound to a different conversation"). Fixed: the system prompt is frozen and each turn's session facts are
appended as a `role: "system"` message kept in the history; requests also send
`thinking.block_binding.prefix_mismatch_behavior: "drop_block"`. Errors now show their reason in the
console's activity log. Checked on the live site: a screenshot, the identity check, lookups, a handoff and
a follow-up turn.

## What has been checked, and how

- `npm test` (43 tests) runs every tool against a real Postgres with the seeded bank: each scripted test's
  data and expected tool behaviour, every check (identity, ownership, review hold, role, cap, limit,
  duplicates, confirmation), secret masking, rule edits, the Staff queue's approve/decline, and
  business-day arithmetic on every day of the week. No model calls.
- The whole app was driven in a browser against a scripted stand-in for the Anthropic API (tests 1, 4
  with the Staff queue approval, 8 with the PDF, 11, S3, S4), checking the screens, the activity panel
  and what the app sends to the API (no identity answers, no secrets, no review-hold reasons).
- **Not yet checked:** how real Claude behaves on the 12 conversations and 6 safety tests (tone, wording,
  choosing the right tools, holding the no-tipping-off line under pressure, refusing the manipulation
  attempt). That is the Test Plan's run, twice per test, on the live link.

## Decisions taken during the build (all in DEMO-SPEC or KNOWLEDGE-BASE)

- Anthropic's own TypeScript SDK instead of the Vercel AI SDK; one `DATABASE_URL` instead of Supabase keys;
  the app creates and seeds its own tables.
- Identity facts: date of birth plus the business's registration number (Harbour and Vine has no payouts).
- Over-cap recalls ask for the customer's yes before they're prepared, then go to the Staff queue.
- A few sample rules the code needed (other routes' late window, how to submit documents, fixing a failed
  payout, out-of-scope topics, business hours), all editable.
