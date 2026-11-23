# Build plan

From `docs/source/10-Build-Plan-and-Handover.pdf` (Nov 23, 2026), adapted to this repo: the source
documents are already here as `docs/DEMO-SPEC.md`, `DESIGN.md`, `KNOWLEDGE-BASE.md`, `TESTS.md` and the
PDFs in `docs/source/`, so the plan's "save nine Markdown files into docs/" setup step isn't needed.

Eight steps, done in order. Don't start a step until the one before passes its check. Commit after
each completed step. Test numbers are from `docs/TESTS.md`.

## Day 1: three use cases working and demoable

**Step 1: foundation and payout tracing** (the biggest; most of the morning)
1. Set up the Next.js app and connect it to the Supabase project; walk Tomi through copying the keys.
2. Create the demo tables and seed them: the sample users and payment references in TESTS.md and the
   dummy rule set from KNOWLEDGE-BASE.md.
3. Tools with all their checks: `verify_identity`, `search_knowledge_base`, `escalate_to_human`,
   `get_transfer_status`.
4. The agent loop, with "Core instructions" from the Agent Behaviour Guide (doc 5) as the system prompt.
5. The app frame and the Chat screen with the activity panel (DESIGN.md): dark theme, prototype banner,
   customer picker, payment card with status chip, Reset demo.

Done when tests 1, 2 and 3 pass, the activity panel shows each lookup as it happens, and Reset demo works.

**Step 2: proof of payment.** `generate_proof_of_payment` with its checks; the proof-of-payment card with
the "Simulated document" watermark and a PDF download. A confirmation only for a successful payout;
otherwise a status note. Done when tests 8 and 9 pass and the PDF carries the watermark and a masked
account number.

**Step 3: incoming payment not credited.** `find_incoming_payment`, searching credited and unallocated
payments; on a confirmed unallocated match Alexis hands off for crediting and doesn't credit it. Done
when tests 6 and 7 pass and test 6 produces a handoff with a reference.

**End of day 1:** re-run tests 1, 2, 3, 6, 7, 8 and 9. If there's time, start step 4 (the most persuasive
scene for a compliance-minded audience).

## Day 2

**Step 4: review hold and the safety behaviours.** `get_account_restrictions` (a review hold returns only
"review hold"; the reason never reaches the model). Then make sure Alexis handles a manipulation
attempt, a pasted secret key (also masked in the stored transcript) and two failed identity checks,
**by fixing the code or the tool results, not by weakening the system prompt**. Done when test 11 and
S1, S3, S4, S5 pass on two runs each.

**Step 5: recall, roles and the Staff queue.** `initiate_recall` with its checks (payment rights, cap
read from `rules`, customer confirmation, no duplicate recall on the same payout); above the cap it's
prepared and escalated for approval. The Staff queue screen (Escalation Playbook, doc 7, and DESIGN.md):
case list, case view with the handoff summary, Approve, Decline, Mark resolved. Approving runs the
prepared recall, records the approver, and shows the outcome in the conversation and the activity
panel. Done when tests 4 and 5 pass and approving shows "approved by Supervisor" in the activity panel.

**Step 6: the Rules screen.** Categories on the left, rules table with in-place editing, the saved
flash, the fixed Guardrails rules locked. Edits go to the audit log and apply to Alexis's next message.
Done when S6 passes and Reset demo restores the original cap.

**Step 7: verification, fees and the bank-details refusal.** `get_kyc_status` and the verification flow;
`get_balance` and `get_fees` (with the conversion's rate, time and amounts); Alexis refuses a chat
request to change a supplier's bank details with the invoice-fraud warning, and no tool can change a
beneficiary. Done when tests 10 and 12 and S2 pass.

**Step 8: full test run and polish, no new features.** The Tone and screen checks against DESIGN.md;
every screen has an empty, a loading and an error state. Done when all six safety tests and at least 11
of 12 conversations pass on two runs each, and every tone and screen check is ticked.

**If day 2 runs short,** cut in this order: the light theme, then step 7's verification flow, then step
7's fees flow. Never cut steps 4, 5 or 6: they're the scenes that make the pitch.

## Putting it online

Push to the private GitHub repo, import it into Vercel, add the environment variables there; check that
no API key is in the code or in git first. Done when the link opens the app and test 1 passes on it. No
password protection for the demo, so share the link only with people in the pitch. Before the pitch:
Reset demo and run the seven-step pitch order (TESTS.md) once on the live version; keep a second copy
open as a backup in case the venue's internet is poor.

## When something goes wrong

| What Tomi sees | What to do |
|---|---|
| An error in Claude Code or the browser | Paste it: "I got this error. Explain it in plain language and fix it." |
| A test fails | Give the test number, what Alexis did and what "Alexis must" says. One failure at a time. |
| Alexis says something the records don't support | Show the tool results for that turn. The fix is usually in the tool's result or the sample data, not the system prompt. |
| Claude Code starts building something not in the demo | "Stop. That is backlog. Stay within the 2-day demo in CLAUDE.md." |
| A fix breaks something that worked | Go back to the last commit where that step passed and try a different fix. |
| A step takes far longer than expected | "What is the simplest version of this step that still passes its tests?" |
| Replies are slow | Check that replies stream and each turn makes only the lookups it needs. |

After any fix, re-run that step's tests and the six safety tests.
