# Design system

Transcribed from `docs/source/8-Conversation-Design-System.pdf` (Nov 23, 2026). The 2-day demo only.
The look is Orchestra AI's own: never Nuvion's logo, colours or brand.

## Principles

1. **Show the work.** The activity panel is the product's proof: every lookup, refusal and action
   appears there as it happens.
2. **Calm and exact.** Plain surfaces, clear numbers, no decoration competing with the content.
3. **Facts get structure.** A payment's details go in a card, not a paragraph.
4. **Status is never colour alone.** Every status has a word and an icon as well as a colour.
5. **Honest about what it is.** The "Prototype - simulated data" banner is on every screen.

## App frame (every screen)

| Region | Contents |
|---|---|
| Prototype banner | Full width at the very top, 32 px: "Prototype - simulated data". Always visible, never dismissible. |
| Top bar | 56 px. "Orchestra AI" wordmark left; tabs Chat, Rules, Staff queue in the centre; right: theme switch (dark by default) and "Reset demo" (restores the sample data). |
| Page area | The rest: page background, content in raised panels. |

## Screens

**Chat with activity panel** (desktop: laptop or projector). Conversation 60%: header with Alexis's
name and "AI support assistant"; a customer picker, always visible, choosing which sample business user
is chatting; the message list; the message box with a send button. Activity 40%: title "What Alexis is
doing"; live activity rows, newest at the bottom; a small counter of lookups, actions and refusals for
this conversation. Below 900 px wide the activity panel moves under a tab beside the conversation.

**Rules.** Left rail 240 px: categories Payouts, Incoming payments, Proof of payment, Verification,
Fees and FX, Limits and approvals, Response targets. Main area: the chosen category's rules (name,
value, kind answer/limit, last changed); clicking a value edits it in place, Save and Cancel on that row
only. Footer: "Changes apply to Alexis's next message." Below it the Guardrails' fixed rules, greyed,
with a lock icon and "Fixed".

**Staff queue.** Left list 360 px: open cases newest first (urgency chip, business name, trigger, age).
Main area: the selected case's handoff summary as a labelled list; Approve, Decline and Mark resolved;
links to the transcript and activity log. Empty: "No open cases. Handoffs from Alexis will appear here."

## Tokens

Define once as CSS variables; use them everywhere. Dark is the default; light is the same variables
switched from the top bar.

```css
/* Dark theme: the default */
:root {
  /* Brand: indigo */
  --brand-600: #4F46E5;   /* primary buttons */
  --brand-700: #4338CA;   /* hover and pressed */
  --brand-accent: #A5B4FC; /* links, Alexis label, selected text */
  --brand-50:  #232654;   /* tinted backgrounds, selected rows */

  /* Text */
  --text-1: #ECEEF8;      /* main text */
  --text-2: #A3A8BF;      /* secondary text, labels */
  --text-on-brand: #FFFFFF;

  /* Surfaces */
  --surface-page:  #0E1020;
  --surface-panel: #171A2E;
  --surface-sunk:  #20243C; /* customer message bubble, code rows */
  --border:        #2C3150; /* dividers and panel edges */
  --border-strong: #6B7199; /* input and button outlines */

  /* Status: always paired with a word and an icon */
  --ok:   #4ADE80;  --ok-bg:   #12301F;
  --wait: #FBBF24;  --wait-bg: #3A2A0B;
  --stop: #F87171;  --stop-bg: #3D1717;
  --info: #93C5FD;  --info-bg: #172A4D;

  /* Prototype banner */
  --banner-bg: #4338CA;  --banner-text: #FFFFFF;

  /* Type */
  --font-ui:   'Inter', system-ui, sans-serif;
  --font-mono: 'JetBrains Mono', ui-monospace, monospace;
  --size-xs: 12px;  --size-sm: 14px;  --size-md: 16px;
  --size-lg: 20px;  --size-xl: 28px;
  --line: 1.5;

  /* Space and shape */
  --space-1: 4px;  --space-2: 8px;  --space-3: 12px;
  --space-4: 16px; --space-6: 24px; --space-8: 32px;
  --radius-sm: 6px;  --radius-md: 10px;  --radius-lg: 16px;
  --shadow-panel: 0 1px 2px rgba(0, 0, 0, 0.4);
}

/* Light theme: optional, switched from the top bar */
[data-theme='light'] {
  --brand-600: #4338CA;
  --brand-700: #3730A3;
  --brand-accent: #4338CA;
  --brand-50:  #EEF0FF;

  --text-1: #14162B;
  --text-2: #5B6072;

  --surface-page:  #F6F7FB;
  --surface-panel: #FFFFFF;
  --surface-sunk:  #F0F2F8;
  --border:        #E3E6EF;
  --border-strong: #8A90A6;

  --ok:   #166534;  --ok-bg:   #E8F6EC;
  --wait: #B45309;  --wait-bg: #FDF3E3;
  --stop: #B91C1C;  --stop-bg: #FDECEC;
  --info: #1D4ED8;  --info-bg: #E8EEFD;

  --banner-bg: #14162B;
  --shadow-panel: 0 1px 2px rgba(20, 22, 43, 0.06);
}
```

| Element | Font and size | Colour |
|---|---|---|
| Message text | UI, 16 px | Main text |
| Labels and timestamps | UI, 12 px | Secondary text |
| Amounts in cards | UI, 20 px, semi-bold, tabular numerals | Main text |
| References and tool names | Mono, 14 px | Main text |
| Page titles | UI, 28 px, semi-bold | Main text |

Amounts: tabular numerals, two decimal places, currency symbol in front.

## Components: conversation

| Component | Appearance | Behaviour |
|---|---|---|
| Alexis message | Raised panel with a border, left-aligned, 16 px radius, max 80% width. "Alexis · AI" label above the first message of each turn. | Text streams in as it is written. |
| Customer message | Sunk grey, right-aligned, same radius. | Enter sends; Shift+Enter new line. |
| Payment card | Inside an Alexis message. Top: amount, large. Then recipient or payer and route; a status chip, the date, the reference in mono. | Read-only; the reference has a copy button. |
| Status timeline | Inside a payout's card: a horizontal row of stages, dots with labels; completed filled, current ringed, failed marked with a cross. | Read-only. |
| Proof of payment card | Document-style: "Payment confirmation" title, the Knowledge Base's fields, a "Simulated document" watermark, Download. | Download saves a PDF with the same watermark. |
| Identity prompt | An Alexis message with a short form: the fields the check needs and Confirm. | Fields clear after submission; answers never echoed in the chat. |
| Confirmation prompt | An Alexis message stating the action and its consequence; primary "Yes, go ahead" and plain "Cancel". | Buttons disable once one is pressed. Typing "yes" also works. |
| Handoff card | Tinted info background: "Passed to the team", the reference in mono, when to expect a response. | Read-only. |
| Refusal note | A normal Alexis message; no red styling. Calm, not alarming. | None. |

## Status chips (icon + word + colour)

| Status | Colour | Icon |
|---|---|---|
| Successful, Approved | ok green | check |
| Pending, Processing, In review | wait amber | clock |
| Failed, Reversed, Blocked | stop red | cross |
| On hold, Needs approval | info blue | pause |
| Urgent, High, Normal (queue urgency) | stop red, wait amber, secondary grey | flag |

## Activity panel rows

Mono, one row per thing Alexis does, with a coloured left edge. A row expands to show what the tool was
asked and returned (account numbers masked). New rows slide in; the panel keeps the newest in view.

| Row type | Left edge | Example |
|---|---|---|
| Lookup | info blue | `get_transfer_status` · PO-88213 · found: processing |
| Action | ok green | `generate_proof_of_payment` · PO-88190 · created |
| Refusal by a tool | wait amber | `initiate_recall` · refused: above cap $10,000 |
| Handoff | brand indigo | `escalate_to_human` · ESC-1042 · high |
| Rule read | secondary grey | rule · SWIFT normal window · 3 business days |
| Human approval | ok green | approved by Supervisor · recall on PO-88213 |

## Components: Rules and Staff queue

| Component | Appearance | Behaviour |
|---|---|---|
| Rule row | Name, value, "answer" or "limit" tag, last changed. | Click the value to edit. A saved change flashes the row with the brand tint for one second. |
| Fixed rule row | Greyed, lock icon, "Fixed". | Not editable; a tooltip says why. |
| Queue row | Urgency chip, business name, trigger, age. Selected row has the brand tint. | Click to open the case. |
| Approve / Decline | Approve primary; Decline plain. | One confirmation click each, then written to the activity log. |

## Reply patterns

| Situation | Pattern |
|---|---|
| One payment | A short opening line, one payment card, one or two sentences on what happens next. The text doesn't repeat the card. |
| Several possible matches | A short line asking which, then up to three compact payment cards to click. |
| Steps for the customer | A numbered list of at most four steps. |
| A fee or conversion | One line with the figure, then a two-row breakdown: what was charged or converted, and the rate or rule behind it. |
| A handoff | Two or three sentences, then the handoff card. |
| A refusal | One sentence on what it can't do, one on why or what to do instead. No card. |

Replies: two to five short sentences plus at most one card (Agent Behaviour Guide).

## States

| State | What the viewer sees |
|---|---|
| Alexis is thinking | Three pulsing dots in an Alexis bubble. |
| A tool is running | The activity row appears at once with a spinner, then resolves to its result. |
| A tool was refused | The amber refusal row; Alexis's reply explains it in plain words. |
| Something broke | Alexis: "Something went wrong on my side and I couldn't complete that. I've passed it to the team." A red error row. Nothing half-done. |
| Empty conversation | A greeting from Alexis and three openers as buttons: "Where is my payout?", "A payment to us hasn't arrived", "I need proof of payment". |
| Demo reset | A brief confirmation; all three screens return to the starting sample data. |

Motion: new messages and activity rows fade and slide in over 150 ms; the rule-saved flash lasts one
second. Nothing else moves.

## Accessibility

Contrast at least 4.5:1 (both themes checked) · every status a word and an icon · everything by
keyboard (Tab between controls, Enter sends or confirms, Escape cancels an edit) · buttons and inputs at
least 40 px tall · new Alexis messages announced to screen readers, the activity panel announced
politely · the layout holds at 200% zoom.
