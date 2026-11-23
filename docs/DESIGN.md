# Design system

> **Design system (Tomi, Nov 23).** The app now uses the design system in `docs/design-system/`
> (`DESIGN-SYSTEM.md`, `tokens.css`, `components.css`; the app loads copies from `app/design/`). Its tokens,
> type, spacing, radius and components win over the tokens and component styles further down this file.
> Decisions made when adopting it:
> - **Black stays the default.** The delivered system is light; the dark theme re-values the same tokens for
>   a black page (`:root:not([data-theme='light'])` in `app/globals.css`, our addition). Light is the system
>   exactly as delivered.
> - **Sidebar layout.** The console has the 240px sidebar (Inbox, Dashboard, Staff queue, Rules; Customer
>   app under "Testing") and a 60px top bar with the screen's title and Open customer app, the theme switch
>   and Reset demo. Below 900px the sidebar becomes a scrolling row across the top.
> - **Primary buttons are indigo** (brand-600), one per view, as the system says; everything else is outlined.
> - **Our additions, flagged:** success, warning and info badge colours (`--success-*`, `--warning-*`,
>   `--info-*`) in the danger badge's quiet style, to be replaced from screenshots that show them;
>   `--brand-text` (brand-600 on white, a lighter indigo on black for contrast); `--surface-page`.
> - The app's own class names stay; `app/globals.css` maps them onto the system's tokens and specs
>   (buttons = ds-btn, status chips = ds-badge, panels = ds-card, nav rows = ds-nav-item, panel tabs =
>   ds-tabs, inputs = ds-input, selects = ds-select, tables = ds-table, tags = ds-tag). Never a raw colour:
>   a missing value becomes a token.


Transcribed from `docs/source/8-Conversation-Design-System.pdf` (Nov 23, 2026). The 2-day demo only.
The look is Orchestra AI's own: never Nuvion's logo, colours or brand.

## Principles

1. **Show the work.** The activity panel is the product's proof: every lookup, refusal and action
   appears there as it happens.
2. **Calm and exact.** Plain surfaces, clear numbers, no decoration competing with the content.
3. **Facts get structure.** A payment's details go in a card, not a paragraph.
4. **Status is never colour alone.** Every status has a word and an icon as well as a colour.
5. **Honest about what it is.** The "Prototype - simulated data" banner is on every screen.

Two apps (Tomi, Nov 23): the **support console** the bank's team uses, which receives conversations, and a
separate **customer app** at `/customer` for playing the customer.

## App frame (every console screen)

| Region | Contents |
|---|---|
| Prototype banner | Full width at the very top, 32 px: "Prototype - simulated data". Always visible, never dismissible. |
| Top bar | 56 px. "Orchestra AI · Support console" left; tabs Inbox, Staff queue, Rules in the centre; right: "Open customer app ↗" (a new tab), theme switch (dark by default) and "Reset demo" (restores the sample data, and starts the customer app over in its tab). |
| Page area | The rest: page background, content in raised panels. |

## Screens

**Inbox** (the console's home). Counts across the top (conversations, open now, resolved by Alexis,
handed to a person, urgent and open, resolved without a person). Left list 400 px: every customer
conversation, newest activity first (status chip, urgency chip if handed off, business and person,
category, first message), with a search and Status, Category and Urgency filters; it updates live and
opens the newest conversation on arrival. Main area: the conversation live, chat 60% (customer left,
Alexis and the team right) beside "What Alexis is doing" 40% (the activity rows); a bar with the staff
sign-in, who is handling it, and Take over / Hand back to Alexis. While taken over, the person's reply
box sits under the chat and Alexis is paused. Below 1100 px the activity moves under the chat.

**Customer app** (`/customer`, no console frame). Its own Prototype banner; a phone frame (400 px wide,
full screen on a phone) with the support chat: Alexis's greeting and openers, cards and forms in the
replies, the message box and screenshots; when the team takes over, the header shows the person and a
notice says they joined, and again when Alexis is back. Beside it a "Playing the customer" panel: the
sample customer picker, the identity-check answers, Start a new conversation, and the text messages
sent to that customer's phone.

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

**Owner, Nov 23: the platform is black; indigo is the secondary colour, for highlights only.** Surfaces
and text are neutral black, white and grey; primary buttons are white on the dark theme and black on the
light one (`--primary`). Indigo (`--brand-*`) is kept for highlights: links, the "Alexis · AI" label, the
selected tab and row, the payout timeline, the handoff edge in the activity panel, the rule-saved flash,
the "AI" in the wordmark and the prototype banner. These tokens are a copy of `app/globals.css`.

```css
:root {
  /* Primary: black and white. Main buttons, the surfaces, the text. */
  --primary: #F4F4F5;        /* primary buttons (white on the black theme) */
  --primary-hover: #D4D4D8;
  --on-primary: #09090B;     /* text on a primary button */

  /* Secondary: indigo, for highlights only. */
  --brand-600: #6366F1;      /* highlight lines and dots: timeline, handoff edge, selected case */
  --brand-700: #4F46E5;
  --brand-accent: #A5B4FC;   /* links, the Alexis label, the selected tab's text */
  --brand-50: #1E1B4B;       /* tinted backgrounds: selected tab and row, rule-saved flash */

  --text-1: #F4F4F5;
  --text-2: #A1A1AA;
  --text-on-brand: #FFFFFF;

  --surface-page: #000000;
  --surface-panel: #0E0E10;
  --surface-sunk: #1A1A1D;
  --border: #27272A;
  --border-strong: #52525B;

  --ok: #4ADE80;  --ok-bg: #0F2A1A;
  --wait: #FBBF24; --wait-bg: #33260A;
  --stop: #F87171; --stop-bg: #361414;
  --info: #93C5FD; --info-bg: #13233F;

  --banner-bg: #4338CA; --banner-text: #FFFFFF; /* the prototype label stays a highlight */

  --font-ui: var(--font-inter), 'Inter', system-ui, sans-serif;
  --font-mono: var(--font-jetbrains), 'JetBrains Mono', ui-monospace, monospace;
  --size-xs: 12px; --size-sm: 14px; --size-md: 16px;
  --size-lg: 20px; --size-xl: 28px;
  --line: 1.5;

  --space-1: 4px; --space-2: 8px; --space-3: 12px;
  --space-4: 16px; --space-6: 24px; --space-8: 32px;
  --radius-sm: 6px; --radius-md: 10px; --radius-lg: 16px;
  --shadow-panel: 0 1px 2px rgba(0, 0, 0, 0.6);
  color-scheme: dark;
}

[data-theme='light'] {
  --primary: #09090B;
  --primary-hover: #27272A;
  --on-primary: #FFFFFF;
  --brand-600: #4F46E5;
  --brand-700: #4338CA;
  --brand-accent: #4338CA;
  --brand-50: #EEF0FF;
  --text-1: #09090B;
  --text-2: #52525B;
  --surface-page: #F4F4F5;
  --surface-panel: #FFFFFF;
  --surface-sunk: #F0F0F2;
  --border: #E4E4E7;
  --border-strong: #8A8A93;
  --ok: #166534;  --ok-bg: #E8F6EC;
  --wait: #B45309; --wait-bg: #FDF3E3;
  --stop: #B91C1C; --stop-bg: #FDECEC;
  --info: #1D4ED8; --info-bg: #E8EEFD;
  --banner-bg: #4338CA;
  --shadow-panel: 0 1px 2px rgba(9, 9, 11, 0.06);
  color-scheme: light;
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
