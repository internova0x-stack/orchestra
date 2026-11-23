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
| - | Putting it online (Vercel) | Waiting on Tomi's Vercel and Anthropic setup |

## What has been checked, and how

- `npm test` (42 tests) runs every tool against a real Postgres with the seeded bank: each scripted test's
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
