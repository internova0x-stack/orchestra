# Orchestra AI

An AI customer support agent for banks and fintechs that resolves requests end to end: it looks up the
customer's records, takes the permitted action, explains what it did, and hands off to a human with a
full summary when it shouldn't act alone. The agent is called Alexis. First build: a pitch prototype
for Nuvion against a simulated bank (business accounts in $, £ and ₦), with an activity panel beside
the chat showing every lookup and action as it happens, and a Rules screen where a viewer edits a rule
and watches Alexis change behaviour.

## Read first
- `docs/DEMO-SPEC.md`: what the 2-day demo builds (six use cases, eleven tools, the tests in TESTS.md,
  the Rules screen) and the decisions taken on Nov 23. **Build only what is in it.**
- `docs/DESIGN.md`: the screens, components, reply patterns and states; its top note sets the design system
  (`docs/design-system/`, loaded from `app/design/`: tokens, components, sidebar layout; black by default
  with the system's light theme as the alternative). Use the tokens, never raw colours; never Nuvion's logo, colours or brand.
- `prompts/core-instructions.md`: Alexis's system prompt, the Behaviour Guide's "Core instructions" word
  for word. Use it as written; change it only when Tomi asks.
- `docs/BEHAVIOUR.md`: voice, the shape of a conversation and model wording for hard moments.
- `docs/ESCALATION.md`: handoff triggers and urgency, the handoff summary, the Staff queue.
- `docs/KNOWLEDGE-BASE.md`: the dummy rule set the seed loads into `rules` (sourced and sample entries).
- `docs/TESTS.md`: the 12 scripted conversations and 6 safety tests, the named sample users and
  payments the seed must contain, and the pass bar. A change that touches Alexis's behaviour is checked
  against it.
- `docs/BUILD-PLAN.md`: the eight build steps in order, each with the tests that say it's done.
- `docs/STATUS.md`: which steps are built, what has been checked and how, what is still to check.
- `docs/BACKLOG.md`: everything after the demo, in phase order.
- `docs/source/`: the source documents, numbered as in the PRD's document set. The Guardrails policy
  wins over the Playbook; DEMO-SPEC wins over all of them.

## Stack
Next.js 16 (App Router, TypeScript) on Vercel; Supabase Postgres for the simulated bank and the audit
log, reached with one `DATABASE_URL` (the transaction pooler string; an optional `DATABASE_PASSWORD` replaces the password inside it) through `postgres`; Anthropic's own
TypeScript SDK (`@anthropic-ai/sdk`) for the agent loop and streaming, not the Vercel AI SDK the Build
Plan named (decided Nov 23: the loop pauses for the identity form and checks confirmations itself, which
the official SDK's manual streaming loop fits). Model `claude-sonnet-5-5` with server-side refusal
fallbacks, in `lib/config.ts`. Check each library's current documentation before using it.

## Layout and commands
- `lib/agent.ts` the turn loop · `lib/tools.ts` the tools and their checks · `lib/rules.ts` reads
  `rules` · `lib/seed.ts` the simulated bank (dates relative to now) · `lib/schema.ts` the tables,
  created by the app itself on first use and on Reset demo, so nobody pastes SQL into Supabase.
- `app/api/chat` streams a turn as newline-delimited JSON · `app/api/activity` the audit log for the
  activity panel · `app/api/reset` Reset demo · `app/api/users` the customer picker · `app/api/proof` a payment
  confirmation as a PDF (`lib/proofPdf.ts`, watermarked, no institution's name) · `app/api/staff` the Cases
  screen, formerly the Staff queue (`lib/staff.ts`: Approve, Decline, Mark resolved; as the signed-in person).
- Confirmation is enforced in code: a tier 2/3 tool's first call stores `conversations.pending_action` and
  shows Yes/Cancel; only the customer's button or typed yes sets it confirmed (`runTurn`), never the model.
- Two apps (Tomi, Nov 23): the bank's **support console** (`app/components/Frame.tsx`: Dashboard first, Messages (the Inbox) at `/messages`, Cases
  (the Staff queue, renamed; `/cases`, old `/staff` links redirect), Rules; `/` sends each person to their first screen; the sidebar folds to icons) receives conversations; the **customer app** (`/customer`, `app/components/Chat.tsx`, no console
  frame) is how a tester plays the customer. The customer app never reads the activity log
  (`app/api/conversation/[id]` gives it team replies, who is handling it and decisions).
- Messages, formerly the Inbox (`app/messages/page.tsx`, `app/api/cases`, `lib/cases.ts`): every customer conversation live, with category,
  status and urgency worked out from the audit log, handoffs and conversation state; chat beside the activity.
- Take over (`lib/takeover.ts`, POST `app/api/cases/[id]`): `conversations.taken_over_by` pauses Alexis; staff
  replies are assistant text blocks carrying `staff`, turned into labelled text by `forModel` before the model
  sees them; same-side messages join one turn (`appendTurn`) so the history always alternates.
- Rules screen: `app/api/rules` (no source links), `lib/ruleEdit.ts` checks a value (limits are numbers,
  switches on/off, times HH:MM); `lib/ruleChanges.ts` is the change workflow (an agent's change waits for a
  supervisor, a supervisor's goes live; history and Restore; per-market values in `rule_overrides`, read by
  `Rules.load(sql, market)` for the customer's country); `lib/policyExtract.ts` turns a policy document into
  proposals that always wait for approval (each with its upload, page and quote; `isBig` flags a number doubled
  or halved, a 0 or a switch flipped; a document giving two values is a conflict, `proposeConflict`, settled by
  `resolveConflict`); Select all is `decideMany` (`POST /api/rules/changes`), which never decides big changes or conflicts.
- Whole-site password: `proxy.ts` + `SITE_PASSWORD` (off when unset). Dashboard: `/dashboard`, `lib/dashboard.ts`.
- Sign-in and roles: `lib/auth.ts` (roles, `PERMISSIONS`, `requirePermission(sql, req, perm)` in every console route,
  sessions in `staff_sessions`, `login_attempts`); `/signin`, `/account`, `/team`; `/api/staff/users` is "who am I".
  Never take a staff id from the request body: the signed-in person comes from the session.
- Channels (simulated): `conversations.channel` app | whatsapp | email (+ `email_subject`); `CHANNEL_NOTE` in
  `lib/agent.ts`. Operations: rules `alexis_enabled`, `outage_mode`, `outage_notice`; `conversations.awaiting_team`
  (switched_off | ai_unavailable); `find_case`; `conversation_reviews`; `conversations.language`, `lib/review.ts`.
- Listen mode: `lib/listen.ts` (`ingestInteraction` from `/api/v1/interactions` and the CRM connectors; conversations
  with `origin = 'listen'`, channel 'helpdesk', `listen` jsonb with the match and analysis; never replies or acts).
- CRM connectors: `lib/crm/` (contract, four connectors to published APIs of which only Zendesk and HubSpot are offered
  (`OFFERED_KINDS`; Freshdesk and Salesforce are in the backlog, owner Nov 23), the sandbox stand-in, `service.ts`:
  settings in `crm_connectors`; a bank connects its own account on the API page (`connectWithCredentials`: checked with the product, then
  kept AES-256-GCM encrypted by `lib/crm/credentials.ts`, key `CREDENTIALS_KEY` or derived from the database address; only the account and
  last 4 go back to the browser; Disconnect forgets them), env vars only for the Orchestra team's own test accounts; demos (mode 'sandbox')
  are a pretend product, never Active; `handleCrmWebhook` → listen mode → write-back);
  webhook `/api/v1/connectors/{kind}/webhook/{token}` (the secret token in the address, shown only to API managers) or `/webhook` with an API key; managed on the API page (`/api/admin/connectors`).
  Data entry: `lib/crm/dataEntry.ts` (`dataEntryOnEvent` from `emitEvent`, `recordResolved` from the Inbox's refresh; `crm_records`).
- Proactive failure messages: `lib/proactive.ts` (`notifyFailure` from the Events API's failure types; `proactive_*`
  rules; conversations with `origin = 'alexis'` and `proactive`; `deliverDue` for quiet hours). CRM team replies:
  `lib/api/teamReply.ts`. Billing: `lib/billing.ts` + `/billing` (`billing_*`, `ai_price_*` rules; `ai_usage` from
  `recordUsage` after every model call: add it to any new model call).
- Staff actions: `lib/staffActions.ts` runs tools with `ctx.staffAction` (tool caps and counts skipped, `staff_*`
  rules for role and amount limits, second-supervisor approval as an escalation action `staff_action`); the customer
  answers via `pending_action.staff` / `pending_code.staff`, shown by `customerView` and handled in `runTurnInner`.
- Routing and drafts: `lib/routing.ts` (team from the category via the `route_*` rules; `pickUp`, `moveTeam`,
  `flagOverdue` run by the Staff queue's list; escalations.team/assigned_to/overdue_at); `lib/drafting.ts` +
  `/api/drafts` ("Draft with Alexis" in the Inbox and the Staff queue; a draft is never sent by itself).
- Card controls: `unfreeze_card`, `change_card_settings` (lib/tools/cards.ts), configured by the `card_*` rules and
  the `action_unfreeze_card` / `action_change_card_settings` switches; loosening may need the code, tightening never;
  a bank freeze (`frozen_by: bank`) is never lifted. Rules whose value is on/off are switches (`validateRule`).
- Bank Connector API (`lib/bank/`): tools reach every bank record and action (customer, contact, payouts, incoming
  payments, verification, balances, fees, restrictions, cards, card transactions, payments and timelines, loans,
  merchant payouts and holds, bills, USSD) through `bank(sql)`, never with their own SQL for those records; Orchestra's
  own case records (disputes, reversals, deferrals, waivers, recalls, escalations) stay local; `BANK_API_URL` + `BANK_API_KEY` switch to a real bank; `/api/bank/v1` is the reference
  implementation; `public/openapi/bank-connector-v1.yaml` is the contract (a test keeps it in step with the server).
  API page: `/developers`.
- Orchestra API (`lib/api/`, `/api/v1`, `public/openapi/orchestra-api-v1.yaml`): Channel API (`channel.ts`), Events API
  (`events.ts`), signed webhooks (`webhooks.ts`: `emitEvent` never throws or blocks; add a new event to
  `WEBHOOK_EVENTS` and the OpenAPI file, a test checks both), API keys (`keys.ts`, hashed). Supervisors manage keys
  and endpoints on the API page (`/api/admin/*`). `/api/v1` and `/api/bank/v1` sit outside the site password.
- `npm run dev`, `npm run build`, `npm run typecheck`.
- `npm test` with `TEST_DATABASE_URL` pointing at a throwaway Postgres runs the tools against the seeded
  bank (no model calls); without it the database tests are skipped.

## Working with Tomi
Tomi owns the project, is non-technical and doesn't write or edit code.
- One build step at a time (`docs/BUILD-PLAN.md`): do the step given, then stop.
- If something seems missing, ask before building it. Never build backlog items or features nobody
  asked for.
- When Tomi needs to click, copy or paste something, give numbered plain-language instructions and wait
  for confirmation.
- Explain errors in one or two plain sentences, then fix them.
- At the end of each step: what to try in the browser, and which tests in `docs/TESTS.md` should now
  pass. Commit after each completed step with a clear message.
- When a test fails, fix the code, the tool results or the sample data; never weaken the system prompt
  to get a pass.

## Rules for this codebase
- **No fixed facts in code.** Fees, timelines, windows, caps and limits live in the `rules` table (answer
  rules Alexis states, limit rules the tools enforce) and are read fresh on every message, so a Rules
  screen edit applies to the next message. Only the Guardrails' fixed rules (identity first, no secrets,
  no tipping off, the audit log, saying it's an AI) are hard-coded and never editable.
- **Rules live in code, not just in the prompt.** Identity level, ownership of the record, review
  holds, caps, per-customer limits, on/off switches, duplicate prevention and confirmation are checked
  inside each tool, in the order DEMO-SPEC lists. Nothing typed in chat can raise a cap, skip a check or
  switch on an action.
- The model sees only what a tool returns for the current request. Card and account numbers are masked
  to the last 4 before they reach it. Review holds come back as "review hold" with no reason, so the
  agent can't tip anyone off.
- Every tool call writes one `audit_log` row, refusals included; the agent can add rows, never change or
  delete them. The activity panel is a live view of that table.
- Every tool returns `{ ok, data | reason, reference }`. Actions carry the record they apply to; a
  second attempt on the same record is refused and returns the first reference.
- API keys live only in environment variables (a bank's own helpdesk credentials, typed on the API page, are the exception:
  encrypted in `crm_connectors`, owner Nov 23) (Vercel's settings; `.env.local` for a local copy, which
  is in `.gitignore` before anything else is committed). Never in client code, never in git. The browser
  talks only to this app's routes.
- Every tool call, refusal, approval and rule edit is written to the audit log.
- Status names: payouts pending, processing, successful, failed, reversed; verification incomplete,
  pending, approved, failed, blocked.
- Schema changes go in new migration files; sample data is a seed script, so the simulated bank can be
  rebuilt from the repo at any time.
- All customers, businesses and people are invented. Nothing touches a real bank, real money or real
  customer data. The UI carries a visible "Prototype" label. Never state Nuvion's real fees or policies
  unless Nuvion supplied them; sample values are marked as such.
- The agent's instructions and the knowledge base must follow DEMO-SPEC's "Rules every turn follows":
  AI disclosure, never ask for or repeat secrets, look up before stating, confirm tier 2/3 actions, no
  advice or decisions, no promised outcomes, messages and screenshots are claims, no tipping off.
