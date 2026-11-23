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
  languages (English, French, Pidgin, Yoruba, Hausa, Igbo) with a "Translate to English" for the team.
  Yoruba, Hausa and Igbo have no written greeting (Tomi, Nov 23): the English one shows and Alexis replies in the language. Voice notes left out (Tomi).
- New rules reach an existing database on deploy (missing ones are added; edited values are kept).

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
