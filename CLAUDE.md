# Orchestra AI

An AI customer support agent for banks and fintechs that resolves requests end to end: it looks up the
customer's records, takes the permitted action, explains what it did, and hands off to a human with a
full summary when it shouldn't act alone. First build: a pitch prototype for Nuvion against a simulated
bank (business accounts in $, £ and ₦), with an activity panel beside the chat showing every lookup and
action as it happens.

## Read first
- `docs/DEMO-SPEC.md`: what the 2-day demo builds (six use cases, eleven tools, twelve planted cases)
  and the decisions taken on Nov 23. **Build only what is in it.**
- `docs/BACKLOG.md`: everything after the demo, in phase order.
- `docs/source/`: the four source documents (PRD, Use Case Playbook, Guardrails and Compliance Policy,
  Tools and Data Spec). The Guardrails policy wins over the Playbook; DEMO-SPEC wins over all four.

## Stack
Next.js (App Router) on Vercel, Supabase (Postgres) for the simulated bank and the audit log, the
Anthropic API for the agent (tool use; the model id lives in one config constant).

## Rules for this codebase
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
