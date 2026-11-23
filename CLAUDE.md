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
- `docs/DESIGN.md`: the three screens, the CSS tokens (dark by default, indigo), components, reply
  patterns and states. Use the tokens, never raw colours; never Nuvion's logo, colours or brand.
- `docs/KNOWLEDGE-BASE.md`: the dummy rule set the seed loads into `rules` (sourced and sample entries).
- `docs/TESTS.md`: the 12 scripted conversations and 6 safety tests, the named sample users and
  payments the seed must contain, and the pass bar. A change that touches Alexis's behaviour is checked
  against it.
- `docs/BACKLOG.md`: everything after the demo, in phase order.
- `docs/source/`: the source documents, numbered as in the PRD's document set. The Guardrails policy
  wins over the Playbook; DEMO-SPEC wins over all of them.

## Stack
Next.js (App Router) on Vercel, Supabase (Postgres) for the simulated bank and the audit log, the
Anthropic API for the agent (tool use; the model id lives in one config constant).

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
- The Anthropic key and the Supabase service key are server-only environment variables (Vercel), never
  in code the browser can see. The browser talks only to this app's routes.
- Schema changes go in new migration files; sample data is a seed script, so the simulated bank can be
  rebuilt from the repo at any time.
- All customers, businesses and people are invented. Nothing touches a real bank, real money or real
  customer data. The UI carries a visible "Prototype" label. Never state Nuvion's real fees or policies
  unless Nuvion supplied them; sample values are marked as such.
- The agent's instructions and the knowledge base must follow DEMO-SPEC's "Rules every turn follows":
  AI disclosure, never ask for or repeat secrets, look up before stating, confirm tier 2/3 actions, no
  advice or decisions, no promised outcomes, messages and screenshots are claims, no tipping off.
