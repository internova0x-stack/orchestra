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
  proposed changes with their quotes, always waiting for approval. The upload panel explains the four
  steps, reads the file and sums up by area (big changes and conflicts flagged, rules not covered listed);
  Waiting for approval filters by document, area and market; Select all ticks the ordinary ones (each box
  can still be unticked), a bar at the bottom approves or declines them after a check; big changes are
  decided one by one and a conflict by picking the value the bank means. History shows the document, page
  and sentence. Checked: tests (`isBig`, Select all, conflicts) and the journey in a browser with a mocked
  AI reply; a real PDF still to try on the live site.
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

## The API page as one list of connections (Nov 23, Tomi: "build it and use it for the whole api page")

`app/developers/Integrations.tsx`: every connection in one list, grouped Needs attention / Active / Not active, with a
filter box and All / Connectors / Webhooks / API keys tabs: the Bank Connector (simulated or a real bank, from
Vercel's settings), the four CRM connectors, webhook endpoints and API keys. Each row shows what it is and its
state in one line, a coloured chip (Live, Sandbox, Simulated, On, Active, or the problem), a fix button when needed
(Reconnect, See errors, Set up, Retry, Connect, Go live, Turn on) and a ··· menu; selecting a row opens its settings
beside the list (for a connector: Off / Sandbox / Live, the two switches, team mapping, recent activity, setup
instructions, what it wrote into the sandbox). "+ API key" and "+ Webhook" add them there (secrets shown once).
Connector health (`crm_connectors.last_*`, `recent`; `noteHealth`, `healthOf` in lib/crm/service.ts): every call to a
CRM is recorded; the latest failing means Needs attention ("Sign-in failed" for 401/403, "Can't reach it", "Write-back
failing", or "Credentials missing" when live without them); Reconnect checks the credentials with a cheap read
(`ping`). Webhook endpoints can be turned off and on (kept, not deleted) and show "Deliveries failing" when the
latest delivery failed. The API reference (both APIs' endpoints, rules, examples, OpenAPI files) is below the list,
folded. Coloured letter tiles stand in for the products' logos. One new test.

## Sign-in and roles (Nov 23, Tomi: "build the roles and log in")

The console now has real accounts (`lib/auth.ts`): each member of the team signs in with their work email and
password at `/signin`, and has one role: Support agent, Supervisor, Operations admin, Compliance (read-only),
Management (read-only) or IT admin. What each role can see and do is one table (`PERMISSIONS`), checked by the
server on every console request; the screens hide what the role can't use (the sidebar shows only its screens,
read-only roles see no action buttons). The old "Signed in as" pickers are gone: actions are recorded under the
signed-in person. Approvals: recalls over the cap, large staff actions and bank freezes stay with supervisors; rule
changes go live from supervisors and operations admins. Passwords are scrypt-hashed; sessions are a random token in
an httpOnly cookie, stored only as a hash, ending after 12 hours idle or 7 days; five wrong passwords in 15 minutes
pause that email; changes must come from the console (Origin check); every sign-in, failure and account change is
in the activity log. First visit with no accounts: the sign-in page creates the first operations admin. Team page
(operations and IT admins): add people with a temporary password shown once (they choose their own at first
sign-in), change roles, switch accounts off (signs them out), reset passwords; the last admin can't be removed;
"Let the sample team sign in" gives the six invented sample accounts (one per role, @yourbank.example) one password
to try each role. Accounts survive Reset demo. The customer app and the integration APIs don't use these accounts.
Not built: single sign-on with the bank's identity provider, two-factor sign-in. One new test.

## Data entry (Nov 23, Tomi: "then 3")

With "Data entry" ticked for a connector (API page), Orchestra keeps the bank's CRM up to date about the conversations
it handles itself (`lib/crm/dataEntry.ts`, `crm_records`): a handoff opens a ticket in the team's group with the
handoff summary as case notes and the customer's contact details on file; later steps (decision, pick-up, move,
overdue, resolved) are added as internal notes and resolving closes the ticket; a conversation Alexis resolved alone
is recorded once as a solved ticket with case notes (Claude writes them from the transcript and activity log:
asked, found, done, outcome, references; a plain version from the log when the AI service is down). Handoff and
update events trigger it (alongside the webhooks); resolved conversations are picked up by the Inbox's refresh, a
few at a time, each claimed first so two refreshes never open two tickets. Listened tickets are skipped (they already
live in the helpdesk). Every write, and every failure, is in the activity log. One new test.

## CRM connectors (Nov 23, Tomi: "can we have 4 different connectors?")

One interface (`lib/crm/contract.ts`) and four connectors (`lib/crm/connectors.ts`), each written to its product's
published REST API: Zendesk (Support API v2, API token), Freshdesk (API v2, API key), Salesforce Service Cloud
(REST v60, connected app's client credentials), HubSpot Service Hub (CRM v3, private app token). Each reads a ticket
and its thread, writes back tags, priority, the team's group or queue and an internal note, posts a reply, and opens a
ticket. The helpdesk calls `POST /api/v1/connectors/{kind}/webhook` (an Orchestra API key; `?key=` where a header
can't be set) on ticket created or customer replied, with the ticket id in its own format; Orchestra reads the ticket,
runs listen mode and writes the result back (`lib/crm/service.ts`). API page, "CRM and helpdesk connectors": each one
Off, Sandbox or Live (Live needs the credentials in Vercel), write-back on or off, Orchestra's teams mapped to the
product's group, queue or owner ids, setup instructions with the webhook address and body, and in the sandbox a
"Send the test ticket" button with a list of exactly what Orchestra wrote. The sandbox (`lib/crm/sandbox.ts`) is a
stand-in for each product's API inside Orchestra, used by the tests too. Not yet checked against a real account of
any of the four: field names and limits should be confirmed in each product's current API reference before going
live. HubSpot's replies to customers go through its inbox, which the connector doesn't send to: a reply is recorded
on the ticket as a note to send. One new test covers all four.

Connecting from the API page (Nov 23, Tomi: "the bank doesn't have access to Vercel"): Connect opens a form for
the product's own details (Zendesk address, admin email, API token; Freshdesk address and API key; Salesforce
address and connected app's consumer key and secret; HubSpot private app token). "Test and connect" checks them
with the product (a cheap read) before anything turns on; they are then kept encrypted (`lib/crm/credentials.ts`,
AES-256-GCM, key `CREDENTIALS_KEY` or one derived from the database address) and never sent back, only the account
and the last 4. Step 2 shows the connector's own webhook address (a secret token at the end, so the helpdesk needs no
API key) with the product's three setup steps; the row says "Step 2 to do" until the first ticket arrives.
Disconnect forgets the details. Demos (the pretend product, mode 'sandbox') have their own Demos group with a
yellow tag and are never counted as Active. Vercel's variables still work for the Orchestra team's own test
accounts. Checked: tests (tidying the typed details, encryption, a refused and an accepted check against a fake
product, the webhook token, Disconnect) and the page in a browser. Checked against the official developer docs
(Nov 23): Zendesk's token auth, the API token menu (Apps and integrations → APIs → Zendesk API) and webhooks
connected to a trigger; `/users/me` also answers anonymous callers, so the check now requires a signed-in agent or
admin. Freshdesk's API key auth and where the key is (Profile settings, below Change password). Not checked:
Salesforce's pages need a browser to render. Findings that change the plan: Zendesk marks API tokens deprecated and
its Developer Terms require a global OAuth client ("Sign in with Zendesk", approved by Zendesk) for an app offered
to several Zendesk customers; tokens are allowed only for internal use. HubSpot stopped new legacy private apps on
Oct 26, 2026: new connections need an app on its new developer platform (OAuth). So typed tokens suit the pilot;
selling Orchestra to many banks needs OAuth apps registered with Zendesk and HubSpot. Setting `CREDENTIALS_KEY` in Vercel is recommended (changing it later means
reconnecting).

## Listen mode (Nov 23, Tomi: "build the listen mode first")

Orchestra listens to tickets and emails already in the bank's own helpdesk (`lib/listen.ts`,
`POST /api/v1/interactions`, source zendesk | freshdesk | salesforce | hubspot | email | other). For each new customer
message it matches the customer by the phone or email on file (Bank Connector `GET /users?email=&phone=`; a match,
never a verification), categorises it with Claude (structured output; keywords if the AI service is down), sets the
urgency, spots fraud signals (always the Fraud team, urgent), routes it by the routing rules, looks up the references
in the bank's records for the team (read-only, masked) and drafts a reply for the agent. It never replies to the
sender or acts on the account from a listened ticket. Results: the Inbox (channel "Helpdesk", status "Listening", the
analysis panel with the draft), the activity log, and the `interaction.analyzed` webhook so the helpdesk can tag,
assign and prioritise. Each message is stored once; secrets are masked. Rules screen, "Listen mode": on or off,
lookups, drafts. Billing: "Price per helpdesk ticket analysed" ($0.10 sample). Inbox: "Send a sample helpdesk ticket"
for testing. One new test.

## Proactive failure messages, CRM team replies, plan and usage (Nov 23, Tomi: "build #2, the crm team-reply api and the platform fee plus usage")

Proactive failure messages (`lib/proactive.ts`): the bank reports `card.declined` (with a reason code),
`transfer.returned` or `payment.failed_debited` through the Events API (with the customer's `user_id`), and Alexis
sends the customer the reason and the fix (to the phone on file and as an app notification), which opens a
conversation she started; replying carries on with her, still verifying identity before anything else. Rules screen,
"Proactive messages": on or off overall and per failure type, quiet hours (21:00 to 08:00 by default: held messages go
out when they end), a daily cap per customer (2) and the wording of each message. Fixed: never on a review hold, never
for suspected fraud or while a "not mine" dispute is open, once per failure. The Inbox marks these "Started by Alexis";
until the customer replies they're "Waiting on customer" (never resolved or billed). Customer app: the tester panel's
"Play the bank: a payment fails" buttons (Grace, Emeka, Chioma, Maya), the phone's notification with Reply.

CRM team replies (`lib/api/teamReply.ts`, `POST /api/v1/conversations/{id}/team-replies`): an agent working in a CRM
replies there and it reaches the customer through Orchestra, as if typed in the console (the conversation is taken
over in their name, masked, logged, `message.created`); `hand_back: true` returns it to Alexis; refused while someone
else handles it in the console.

Plan and usage (`lib/billing.ts`, `/billing`): platform fee plus usage. A monthly fee with resolved conversations
included, then a price per conversation Alexis resolves and a lower one per handoff (Rules screen, "Billing", sample
values: $1,500, 500 included, $0.80, $0.20). AI usage is recorded on every model call (`ai_usage`: Alexis, staff
mode, drafts, translations, policy uploads) and priced with sample per-token prices; the page shows the bill, the
staff cost saved against it, AI usage and cost per conversation, and (folded) Orchestra's margin. "The institution
pays its AI provider directly" moves the AI cost off Orchestra's side. Three new tests.

## Staff actions (Nov 23, Tomi: "build it now")

A member of the team who has taken a conversation over can take the same account actions as Alexis from the
Inbox's "Account actions" drawer: freeze, unfreeze (a supervisor can lift a bank freeze), card settings, replacement,
dispute, reversal, recall, bill refund, fee waiver, deferral request, unlock, reset link, payment confirmation
(`lib/staffActions.ts`, `POST /api/cases/{id}` action `staff_action`). The same tool code, checks and Bank Connector
calls run; the tool's own caps and per-customer counts don't, because the person is the review they ask for.
Instead the Rules screen's "Staff actions" settings apply: staff actions on or off, support agents allowed or not,
the amount an agent may act on alone ($2,000 / £1,500 / ₦1,000,000; above it a supervisor), and the amount above
which a second supervisor must approve ($10,000 / £8,000 / ₦5,000,000: the action waits in the Staff queue, the
requester can't approve it, then runs it). Fixed: the customer must be verified in the chat; the stronger check
applies as for Alexis (the staff member sends the one-time code to the phone on file and the customer types it in
their app); the customer's Yes/Cancel appears in their app and only their answer (button or typed yes/no) runs it.
Everything is logged under the staff member's name ("· by Bayo Martins, approved by…"), and the customer is told
"Bayo from the support team unfroze your card (reference CHG-4402)." Two new tests.

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

## Support email (Nov 23, Tomi: "email connections can be done now", "Forward and send")

A bank connects its support address on the API page (Channels → Support email) in three steps: forward the mailbox
to Orchestra's private inbound address (Gmail, Microsoft 365 and other steps shown; Google's forwarding confirmation
code appears on the page), add two DNS records so replies come from that address (DKIM TXT and the Return-Path
CNAME, with Check the records), then go live as Drafts first (each email waits for the team in Messages; Draft with
Alexis; the reply goes out by email) or Alexis replies (her answer is emailed; when she needs the identity check, a
confirmation or a code, the email carries a one-use link to a secure page valid 24 hours). Emails join their thread
by headers, else by sender and subject in the last 30 days; automatic replies, bounces and Orchestra's own emails are
never answered. The email service is Postmark (calls checked against its developer docs, Nov 23). Without Postmark's
keys in Vercel the channel runs in practice mode: you play the forwarded email on the API page and replies are
recorded, not sent. Checked: two new tests (the whole practice flow; Postmark's request shapes against a fake) and
the setup, Messages and the secure page in a browser. Not yet tried with a real Postmark account, a real mailbox or
real DNS. To go real: a Postmark account, POSTMARK_SERVER_TOKEN and POSTMARK_ACCOUNT_TOKEN in Vercel, and Postmark's
account approval before it sends to outside addresses.

## Checkout payments for a payment company (Nov 25, Tomi: "start with 1, 2, 3")

Someone who paid a merchant by Pay with Transfer, a dedicated virtual account or a card, and holds no account, can
now be helped. `check_payment_evidence` is their identity check: the amount, the date and one more detail (checkout
email, or the card's or sending account's last 4), all compared in code; it never says which detail was wrong and
ends after 3 misses. A match ties the conversation to that one payment. Then Alexis reads its status and next step
from the rules, checks a transfer at NIBSS by session ID (run by the payment company through the Bank Connector,
never by Orchestra), re-sends the merchant's "paid" notification (twice per payment), and refunds what the rules
allow (a late or short transfer in full, an over-payment's excess, a duplicate card charge) with the payer's yes,
under a cap, once. A review hold shows only as "review hold". New Bank Connector endpoints are in the OpenAPI file
and the reference server. Twelve sample payments cover each case; the customer app's picker lists their payers with
what's on their receipt. Checked: four new tests (the check, scope and re-send limit, refunds, review hold and NIBSS
status, the reference server). Not yet tried with the live model in a conversation.

## Website chat widget (Nov 25, Tomi: "build the chat widget")

A bank adds Alexis to its website, or to the web pages its app shows, by pasting one line. API page → Channels →
Website chat: the chat's title and colour, the websites it may run on, the line to copy, a Live switch, and an
optional signing secret so customers already signed in to the bank's site arrive verified (the bank's server signs a
short token; code for their developer is on the page). Browsers show the chat only on the listed websites. Each
visitor may start 10 conversations an hour (a rule). Conversations appear in Messages as "Website chat", with
take-over, hand-back and every check as in the app. `/try-widget` is a sample bank website to try it, as a guest or
signed in as a sample customer. Checked: four new tests (website list, tokens, settings, starting conversations and the
limit); in a browser, set up and go live, a chat on the sample page (with a stand-in for the model), signed in as Ada,
phone width, a listed outside website (chat opens) and an unlisted one (the browser refuses the frame), and the
Website chat label in Messages.

Option 2, your own chat (Tomi: "next"): API page → Channels → Your own chat gives the four steps (an API key, open a
conversation, send each message and show `needs`, team replies by webhook), JavaScript for the developer, and
"Test it as a customer" (`/try-your-chat`): a stand-in chat beside each request the bank's server would send and the
answer it gets, with the same call as curl. Checked in a browser with a stand-in for the model; the test route refuses
any conversation it didn't open.

## Verification sample screenshots (Nov 27)

Three more sample screenshots in the customer app's "Sample screenshots" list, for demoing verification: a rejected
driving licence (David: the record says the photo was blurry and what to send), a missing ownership document (Sam,
Harbour and Vine: payouts paused until it's uploaded), and a screenshot claiming "Verified" that David's record
contradicts (a screenshot is a claim; the record wins). Checked: they render; not yet tried with the live model.

## Global markets (Nov 27, Tomi: "the platform is meant for global banking")

- **Markets:** the Rules screen's Market list is now the United States, the United Kingdom, Canada, the European Union,
  the United Arab Emirates and Nigeria. Canada, the EU and the UAE start with sample values for how verification works
  and how long a pending transfer takes; refund caps exist in EUR, CAD and AED.
- **Any payment network:** the transfer check takes whatever reference the payer's bank shows (a payment reference,
  end-to-end ID, trace number, Interac reference, UETR or NIBSS session ID) and the bank or payment company checks it on
  its own network. The Bank Connector contract changed to match (`/transfer-status/{reference}`).
- **Sample payers in every market:** five more checkout payments: a UK transfer held at the sender's bank (Faster
  Payments), a US card failed but debited, an EU SEPA Instant transfer that went to another account, a Canadian Interac
  transfer C$5 short, and a UAE over-payment (Aani). New merchants in Canada, Germany and the UAE.
- **Which country's rules apply:** the records once the customer is verified; the merchant's country for someone who
  paid a merchant; before that, the country the bank's app or website passes when the chat opens, or what the customer
  says (Alexis asks only when a general answer depends on it, and never uses it for their account). The customer app has
  "Country the app passes" to try it; the widget takes `data-country`; the Channel API takes `country`.
- Checked: three new tests (markets, payers in every market, the country before and after the identity check) and the
  existing ones (126 pass); in a browser, the Rules screen's markets and the new payers in the customer app. Not yet
  tried in a full conversation with the live model. The live site needs **Reset demo** once for the new sample payments.

## Data protection (Nov 27, Tomi: "build 1 to 4")

1. **Only last 4 digits from the bank:** the Bank Connector contract now asks for the last 4 digits of a payout
   recipient's account and of a bill's phone, meter or account number; a full number never reaches Orchestra.
2. **What Alexis can see:** a Rules screen category with one switch per kind of data (balances, payouts, incoming
   payments, cards, fees, verification, restrictions, loans, merchant settlements, bills, checkout payments). Off: Alexis
   is refused before the bank is asked, says a person can help, and hands off.
3. **Retention and deleting a customer's data:** Data protection rules for how long conversations (365 days, open cases
   kept) and the activity log (2,555 days, about 7 years) are kept, sample values. Operations admins have "Delete data"
   in Messages: a preview, then every conversation of that verified customer (or just that one, if never verified) is
   deleted, the activity log keeps each step without its details, and the bank's own records are untouched.
4. **ID and card photos:** every photo a customer sends is checked by a small, fast AI model first; one that shows an ID
   document or a payment card is removed before Alexis or the team sees it and never stored, and the customer is told
   where to upload documents. If the check fails, the photo is removed too. Switch: "Remove photos of ID documents".
   New sample: "Photo of a driving licence (gets removed)".
Checked: six new tests (132 pass) and in a browser with a stand-in for the AI (photo removed and the notice shown, Delete
data's preview, the new rule categories). Not yet tried with the live AI: whether the real check recognises the sample
licence photo needs a try on the live site.

