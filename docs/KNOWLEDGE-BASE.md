# The dummy rule set

Transcribed from `docs/source/6-Knowledge-Base.pdf` (Nov 23, 2026). The seed script loads every entry
below into the `rules` table. Orchestra AI ships with no fixed facts about fees, timelines or limits; a
business replaces all of these through the Rules screen.

Each rule: `category`, `name`, `value`, `kind` (answer | limit), `origin` (sourced | sample),
`source_url` (sourced only), `updated_by`, `updated_at`.

- **Answer rules** say what Alexis may say. Alexis looks them up (`search_knowledge_base`).
- **Limit rules** say what Alexis may do. The tools read them and enforce them in code.
- **Sourced** entries come from Nuvion's public docs (checked Nov 23, 2026): Alexis states them as the
  normal expectation, never a guarantee. **Sample** entries are invented: used only inside the
  simulated data, never presented as Nuvion's real fee, limit or policy; on screen they sit under the
  "Prototype - simulated data" label.

**Nuvion's name never appears (owner, Nov 23).** Rule values say "the platform", never "Nuvion". The
`source_url` column is stored but never shown on the Rules screen (a "Sourced" tag instead) and never
returned to the model by `search_knowledge_base`, so Alexis can't quote it.

Sources:
[intro](https://docs.nuvion.co/introduction) ·
[send a payout](https://docs.nuvion.co/guides/send-a-payout) ·
[accept a payment](https://docs.nuvion.co/guides/accept-a-payment.md) ·
[entities](https://docs.nuvion.co/core-concepts/entities.md) ·
[payout product page](https://www.nuvion.co/products/payout)

## Platform (sourced)

| Name | Value | Source |
|---|---|---|
| What it is | A global banking and cross-border payments platform built on regular currency and stablecoin rails | product page |
| Who it serves | Businesses, freelancers, creators, marketplaces and platforms | product page |
| Accounts | Multi-currency accounts that hold, receive and send balances | intro |
| Incoming payments | Bank transfers and other local payment methods are accepted, and funds settle into the customer's account | intro |
| Payouts | Money can be sent to bank accounts or wallets worldwide by wire, local bank rails and real-time payment networks | intro |
| Stablecoins | Customers can receive, hold and send stablecoins and move between regular currency and on-chain assets | intro |
| Payout destinations | Bank accounts, mobile money wallets, stablecoin addresses and other accounts on the platform | send a payout |

Out of scope for the demo: cards, stablecoin support, Earn, IPO applications and developer questions.
Alexis says it can't help with that here and offers a handoff.

## Payouts

Normal settlement by route (sourced, send a payout; a normal time, not a promise):

| Destination | Currency | Route | Normal settlement |
|---|---|---|---|
| United Kingdom | GBP | Faster Payments | Same day |
| United States | USD | ACH | Same or next day |
| United States | USD | Wire | Same day |
| United States | USD | RTP | Instant |
| Nigeria | NGN | NIP | Instant |
| Eurozone | EUR | SEPA | Same day |
| Canada | CAD | EFT | Same or next day |
| UAE | AED | Local transfer | Same or next day |
| Kenya, Ghana, Tanzania | KES, GHS, TZS | Mobile money | Instant |
| Anywhere | Any | SWIFT | 1 to 3 business days |
| Several networks | Stablecoin | Stablecoin transfer | Near-instant |
| Another account on the platform | Any | Internal transfer | Instant |

Payout statuses (sourced; the sample data uses these names):

| Status | Meaning | Alexis says |
|---|---|---|
| Pending | Created and waiting to be processed | "It has been created and is queued to go out." |
| Processing | Being carried out by the payment network | "It has left us and is with the payment network." |
| Successful | Delivered to the recipient | "It was delivered on [date]." |
| Failed | Could not be completed | "It did not go through." Then the reason, if the record has one. |
| Reversed | Reversed after completion | "It completed and was then reversed on [date]." |

Other sourced facts: a payout needs a registered recipient with payment details, and a description
passed to the recipient's statement where the route supports it · some routes have per-transfer
limits (e.g. Interac in Canada is capped at 25,000 CAD; larger amounts must be split) · a failed
payout can't be retried under the same reference; a new one is needed.

Sample:

| Name | Value |
|---|---|
| Stages inside Processing | Compliance check, sent to the payment route, with an intermediary bank |
| Reasons a payout fails or is returned | Account closed, name does not match the account, invalid account details, receiving bank rejected |
| SWIFT late after (limit rule) | More than 3 business days after it was sent |
| Recall | Can be requested for a payout sent in error; success depends on the receiving bank and is not guaranteed |
| Cut-off times | None set in the prototype |

## Incoming payments and proof of payment

Sourced (accept a payment): a customer is paid by sharing account details (bank details or a
stablecoin wallet address) that the payer sends to directly, or by a funding session the payer
completes · funding sessions run through a hosted bank-transfer checkout, a mobile money prompt on the
payer's phone, a hosted stablecoin checkout, or an Interac email · stablecoin payments arrive in USDC
and USDT.

Sample:

| Name | Value |
|---|---|
| Why a payment may not show | It arrived with a wrong or missing reference and is waiting to be matched; it is still in transit; or it was never sent |
| Unallocated payments | Held until matched to an account; staff credit it once the match is confirmed |
| What helps trace a missing payment | The payer's proof of payment: amount, date, sending bank, reference |
| Proof: when issued | Only for a payout with the status Successful |
| Proof: what it shows | Amount, currency, date, recipient name, masked account number, reference, payout route |
| Proof: payout pending or processing | A status note is offered: initiated on [date], current status |
| Proof: failed or reversed payout | No confirmation is issued |
| Bank-stamped documents or SWIFT copies | Requested through the team; Alexis hands off |

## Business verification

Statuses (sourced, entities; the sample data uses these names):

| Status | Meaning | Alexis says |
|---|---|---|
| Incomplete | Created, but required information or documents are missing | What is missing and how to submit it |
| Pending | Submitted and under review | That it is with the compliance team for review |
| Approved | Verification complete; accounts can be opened and money moved | That the account is fully verified |
| Failed | Verification did not pass | The recorded reason, and that a new application cannot simply be recreated |
| Blocked | The account cannot transact | No-tipping-off rule; hands off to the team |

What a business must provide (sourced): Certificate of Incorporation, Memorandum of Association and
proof of address for the business (tax verification document optional) · a government-issued ID and
proof of address for each officer · BVN and NIN for Nigerian nationals and residents; a Social Security
number for US nationals and residents · an individual needs a government-issued ID (passport, driver's
licence or national ID) and proof of address dated within the last 3 months · verification must be
complete before an account can hold or move money · full document details (issue and expiry dates) make
it faster. Alexis explains these but never collects documents or ID numbers in chat.

Sample: normal review time 2 business days · reasons verification fails: ownership document missing,
document unreadable, name or address does not match, document expired.

## Fees, limits and FX (all sample)

| Name | Value |
|---|---|
| Local payout fee | $1.00, £1.00 or ₦50 per payout |
| SWIFT payout fee | $15.00 per payout |
| Internal transfer | Free |
| Currency conversion | Rate shown at the time of conversion, with a 0.5% conversion fee |
| Monthly account fee | None |
| Recall cap before human approval (limit rule) | $10,000, £8,000 or ₦10,000,000 |

A fee question: the fee, what triggered it and the date, from the customer's own records. A conversion
question: rate applied, time, amounts in both currencies; no predictions or advice on when to convert.
"What are your fees?" in general: the sample values (a live version uses Nuvion's real schedule).

## Response targets (sample)

How soon a person on the support team picks up a case after Alexis hands it off: what the handoff
card's "when to expect a response" shows. Not Alexis's own reply time (that's seconds). Decided by the
owner on Nov 23. All are rules a business edits on the Rules screen, each value with its own unit
(minutes, hours, business hours, business days). Alexis states them as the team's target, never a
promise.

| Urgency | Target |
|---|---|
| Urgent | 1 hour |
| High | 4 business hours |
| Normal | 1 business day |

Business hours (sample, also a rule; the same calendar counts business days everywhere, including the
SWIFT late window): Monday to Friday, 09:00 to 17:00, Lagos time (WAT).

## Added during the build (Nov 23, sample)

Entries the code needs that the Knowledge Base didn't have, all marked sample and editable:
- **Other routes count as late after: 1 business day** (only SWIFT had a late rule).
- **Fixing a failed payout:** correct the recipient's details in the dashboard under Beneficiaries, where a
  second approver confirms changes, then send a new payout (from the Behaviour Guide's model wording).
- **How to submit documents:** through the platform's dashboard, under Verification; never in chat.
- **Not covered in this chat:** cards, stablecoin support, Earn, IPO applications and developer questions.
- **Business days, hours start, hours end:** Monday to Friday, 09:00 to 17:00 (Lagos time, fixed).
- Switches for recalls and proof of payment (on), recalls per customer (3 per 30 days) and failed
  identity checks per conversation (2) are limit rules too.

The Rules screen gets a **Platform** category for the platform facts, alongside the Design System's
seven.

## Not editable

The Guardrails' fixed rules are not rules in this table and can't be changed on the Rules screen:
identity before any account data, no secrets, no tipping off, the audit log, saying it's an AI.

## Optional: real values from Nuvion

None block the demo. Worth asking contacts for only if the pitch should run on real answers: payout fee
schedule by route and currency; FX pricing; account and payout limits; payout failure and return
reasons as their systems record them; how recalls and cancellations work and their time limits; how
incoming payments are matched and what happens to a wrong reference; whether they issue
proof-of-payment documents and in what form; normal verification review time and common rejection
reasons; their top support ticket types and which take longest to close.
