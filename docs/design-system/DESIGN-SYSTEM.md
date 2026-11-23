# Dashboard Design System

A calm, dense admin interface: white surfaces, slate ink, one indigo accent.

This system was extracted from 16 screenshots of the Stripe Dashboard (Home, Balances, Transactions, Customers, Settings, Checkout, Billing overview, Treasury, Payments analytics, plus the account menu, notifications panel and assistant panel). Use it as a reference for building your own product in the same style. It contains no logos, icons or fonts copied from the source.

## How to use this (for Claude Code)

- Import `tokens.css` first, then `components.css`, and load Inter (400, 500, 600, 700).
- Wrap UI in an element with class `ds`. Use the `ds-*` classes from `components.css`, or build new components from the `--token` variables.
- Never hard-code a colour, radius, spacing or font size: use a token. If a needed value has no token, add one to `tokens.css` rather than inlining it.
- States marked "assumed" below were not visible in the source screenshots; treat them as defaults that may be changed.

## How the values were obtained

| Kind | Method | Confidence |
|---|---|---|
| Colours | Sampled pixel-by-pixel from the screenshots | Exact for what was captured |
| Layout widths, control heights, row heights | Measured on the 2x screenshots and halved, then snapped to the nearest 4px step | Within 1–2px |
| Font sizes, weights, line heights | Estimated from glyph heights | Within 1px; weights are a judgement |
| Radii, shadows | Read by eye | Approximate |
| Hover, focus, checked, on-toggle, row-hover | Mostly not visible in still images | Assumed; each is flagged in its component note |

For exact numbers, inspect the live page in browser dev tools and correct the token; everything downstream follows the tokens.

## Visual foundations

**Colour.** The page is surface-0 white. Almost everything else is a slate neutral: ink-900 for text, ink-700 for secondary text, ink-600 for icons, border and border-subtle for lines, surface-100 for any quiet fill (search, banners, grey cards, hover). brand-600 is the single accent and it always means "interactive or current": primary buttons, links, the active nav row, the selected tab, unread dots. Red (danger-700 on danger-050) appears only in status badges. The five chart colours are used only for data.

- Body text: ink-900 on surface-0 or surface-100.
- Secondary text: ink-700. Placeholder and axis text: ink-500, the lightest text that passes 4.5:1 on white.
- ink-400 fails contrast on purpose; keep it for disabled controls only.
- Never fill a large area with brand-600. The biggest brand surface is a button; tinted areas use brand-050.

**Typography.** One family, Inter (the screenshots show Inter or a near-identical grotesque), in four weights: 400 body, 500 badges, 600 labels and controls, 700 headings. The base is `body` 14/20. Headings step 16 → 20 → 28, with `display` 48/56 reserved for a hero panel. Table headers and helper text are 12/16. IDs and keys use the `mono` style at 13/20. Sentence case everywhere, including buttons and headings; no all-caps.

**Spacing.** A 4px grid. space-2 (8px) between sibling controls, space-4 (16px) inside cards and banners, space-6 (24px) between tabs and between sidebar groups, space-8 (32px) between page sections, space-10 (40px) as the page gutter.

**Shape.** Small radii: radius-sm 4px on badges and checkboxes, radius-md 6px on buttons and nav rows, radius-lg 8px on inputs, chips, cards and popovers, radius-xl 12px on hero panels, radius-full on filter pills and toggles. Structure comes from 1px borders and grey fills. Shadows are reserved for things that float: shadow-popover on menus, popovers and side panels.

**Icons.** 16px, outline style, 1.5px stroke, rounded joins, drawn in ink-600 (brand-500 when active). The component previews use simple stand-in glyphs; for a real build pick one open outline set (for example Lucide or Phosphor at 16px) and use it throughout.

## Page layout

Measured on a 1440px-wide viewport.

| Region | Size | Notes |
|---|---|---|
| Sidebar | sidebar-width 240px, full height | White, 1px border-subtle on its right edge, space-4 inset |
| Top bar | topbar-height 60px | Search (search-width 360px) on the left; help, notifications, settings icons and a 20px brand-600 "create" disc on the right, 24px apart |
| Content | Fluid, space-10 gutter each side (starts at x=280) | No max width captured |
| Right rail | About 240px | Recommendations, upcoming items; space-12 from the main column |
| Side panels | panel-width 448px (notifications), about 345px (assistant) | Overlay or push the content from the right |

A standard page stacks: breadcrumb (optional, brand-600 links with a chevron separator) → title row (`h1` left, buttons right) → tabs → banner → toolbar (chips, search, filter) → table or card grid → pagination. Sections inside a page start with an `h2`.

## Content fundamentals

- Sentence case. "Add customer", "Create checkout", "Save changes".
- Buttons are verb + noun. Links that leave the page say where they go ("View docs", "Set up payouts").
- Descriptions are one plain sentence ending in a full stop: "Manage who on your team receives emails."
- Empty states name what is missing and the next step: "No payments matching this selection. Select another date range and try again."
- Money is shown with currency symbol and two decimals ("US$0.00", "$1,800.00 USD"); dates as "3 Aug 2026, 19:55"; ranges as "1 – 5 of 5 results".
- British spelling in the source ("catalogue", "Customise", "authorised"). Keep to one spelling convention.

## Components

| Component | Covers |
|---|---|
| Button | Primary, secondary, small, large, icon, round, disabled, action pills, shortcut hint |
| Chip | View chips, filter pills, add-filter pills, tags, segmented view switch |
| Badge | Status badges, unread dot |
| Tabs | Brand tabs, neutral tabs, counted tab cards |
| Sidebar | Navigation column, expandable groups, account dropdown menu |
| Popover | Coachmark popover, notifications panel |
| Input | Global search, toolbar search, select triggers, checkbox, toggle, read-only mono values |
| Table | Data table, toolbar, pagination |
| Card | Chart card, grey card, recommendation card, legend, settings link tile |
| Banner | Tip banner, dashed and filled empty states |

All component classes live in `components.css` and use only token variables, so changing a token restyles everything.

## Token reference

### Colour

| Token | Value | Use |
|---|---|---|
| `--brand-600` | `#4f3bf3` | Primary action fill, links, active nav and tab text, selected outlines, unread dots. White text on it passes 4.5:1. |
| `--brand-500` | `#655df6` | Active-state icons (sidebar, settings tiles, top-bar gear) and the focus border on inputs. |
| `--brand-300` | `#a79df9` | Disabled primary button fill. Decorative only; white label on it is below 4.5:1 (allowed for disabled). |
| `--brand-100` | `#dfd9f8` | Border of brand-tinted cards (recommendation card). |
| `--brand-075` | `#eeecfb` | Fill of small brand pills such as the 1% reward tag; text is brand-600. |
| `--brand-050` | `#f7f5fc` | Active sidebar row background and brand-tinted card background. Text on it: brand-600 or ink-900. |
| `--on-brand` | `#ffffff` | Text and icons on brand-600. |
| `--ink-900` | `#1e2c42` | Headings, body text, table cell text, selected chip outline and selected neutral tab underline. |
| `--ink-800` | `#2b394f` | Labels on secondary (outlined) buttons and select triggers. |
| `--ink-700` | `#404e67` | Secondary text: table headers, inactive tabs, sidebar section labels, banner text, hero subtitle, timestamps. |
| `--ink-600` | `#536078` | Default icon colour (sidebar, top bar, menus) and text in neutral tags. |
| `--ink-500` | `#69768f` | Placeholder text, chart axis labels, disclaimers. Lowest text colour that still passes 4.5:1 on white. |
| `--ink-400` | `#959ca7` | Disabled text and disabled pager arrows. About 2.9:1 on white: use only for disabled states. |
| `--ink-300` | `#98a4b8` | Dashed chart baselines and quiet glyphs inside neutral icon buttons. Not for text. |
| `--border-strong` | `#bdc8d8` | Dashed empty-state outlines and the outline of a selected/hovered chart card. |
| `--border` | `#d6dee8` | Default 1px border on buttons, selects, pills, panels, popovers and tab baselines. |
| `--border-subtle` | `#edf1f5` | Table row dividers, borders of quiet inputs and chips, segmented-control track, off toggle track. |
| `--surface-0` | `#ffffff` | Page, sidebar, table, popover and outlined-button background. |
| `--surface-50` | `#fafbfc` | Disabled action chip background. |
| `--surface-100` | `#f5f7fa` | Search field, info banners, grey cards, icon tiles, hover rows, kbd hints, empty states, hero panel. |
| `--danger-700` | `#b02a40` | Text in Failed / Blocked badges on danger-050 (passes 4.5:1). |
| `--danger-200` | `#f5d4dc` | Border of danger badges. |
| `--danger-050` | `#fcf4f6` | Fill of danger badges. |
| `--negative-700` | `#a33f1a` | Negative delta text beside metrics (-100.0%). |
| `--chart-1` | `#9268f6` | First data series and the default single chart line. |
| `--chart-2` | `#2254b5` | Second data series. |
| `--chart-3` | `#479fbe` | Third data series. |
| `--chart-4` | `#dd702c` | Fourth data series. |
| `--chart-5` | `#a4233f` | Fifth data series. |

### Type styles

| Class | Size / line height | Weight | Use |
|---|---|---|---|
| `.display` | 48px / 56px | 700 | Hero headline inside feature panels. One per page at most. |
| `.lead` | 20px / 28px | 400 | Hero supporting sentence, in ink-700. |
| `.h1` | 28px / 36px | 700 | Page title. |
| `.h2` | 20px / 28px | 700 | Section heading inside a page. |
| `.h3` | 16px / 24px | 700 | Group heading, card title, settings link title (link titles use brand-600). |
| `.metric-lg` | 24px / 32px | 700 | Headline figure inside a chart card. |
| `.metric` | 20px / 28px | 400 | Summary figure on overview rows. |
| `.body` | 14px / 20px | 400 | Default text: paragraphs, table cells, sidebar rows, menu items. |
| `.body-strong` | 14px / 20px | 600 | Button, chip and tab labels; bold table cell (customer name); card labels. |
| `.small` | 12px / 16px | 400 | Pagination text, axis labels, timestamps, section labels in the sidebar. |
| `.small-strong` | 12px / 16px | 600 | Table column headers; badge text uses weight 500 at this size. |
| `.mono` | 13px / 20px | 400 | IDs, keys and copyable links. |

### Spacing

| Token | Value | Use |
|---|---|---|
| `--space-0.5` | `2px` | Hairline gaps: badge vertical padding. |
| `--space-1` | `4px` | Icon-to-label gap in small buttons; gap between stacked chips. |
| `--space-2` | `8px` | Button horizontal padding, gap between adjacent buttons and chips. |
| `--space-3` | `12px` | Icon-to-label gap in sidebar rows; input horizontal padding. |
| `--space-4` | `16px` | Sidebar inset, card inner padding (compact), table cell horizontal padding. |
| `--space-5` | `20px` | Gap between page title row and tabs. |
| `--space-6` | `24px` | Gap between tabs, card padding (default), gap between sidebar groups. |
| `--space-8` | `32px` | Gap between page sections. |
| `--space-10` | `40px` | Page gutter left and right of the content column. |
| `--space-12` | `48px` | Gap between major page blocks (e.g. settings groups). |
| `--space-16` | `64px` | Hero panel inner padding. |

### Radius

| Token | Value | Use |
|---|---|---|
| `--radius-sm` | `4px` | Badges, checkboxes, kbd hints, legend swatches. |
| `--radius-md` | `6px` | Buttons, selects, sidebar rows, icon tiles. |
| `--radius-lg` | `8px` | Search field, chips, banners, cards, popovers, inputs. |
| `--radius-xl` | `12px` | Hero panels and large feature cards. |
| `--radius-full` | `999px` | Filter pills, round icon buttons, toggle, suggestion chips. |

### Sizes

| Token | Value | Use |
|---|---|---|
| `--sidebar-width` | `240px` | Fixed left navigation column. |
| `--topbar-height` | `60px` | Top bar holding search and global actions. |
| `--search-width` | `360px` | Global search field width. |
| `--control-sm` | `24px` | Small buttons (card actions), filter pills. |
| `--control-md` | `28px` | Default buttons, selects, sidebar rows. |
| `--control-lg` | `36px` | View chips, toolbar inputs, filter button, global search. |
| `--control-xl` | `40px` | Large hero buttons. |
| `--table-header-height` | `36px` | Table header row. |
| `--table-row-height` | `44px` | Table body row. |
| `--icon-size` | `16px` | Default icon box. |
| `--icon-tile` | `32px` | Square icon tile on settings links. |
| `--panel-width` | `448px` | Right-hand notifications panel. |
| `--menu-width` | `288px` | Account dropdown menu. |

### Shadow

| Token | Value | Use |
|---|---|---|
| `--shadow-popover` | `0 0 0 1px #d6dee8, 0 8px 24px rgba(30, 44, 66, 0.12)` | Menus, popovers, coachmarks and the notifications panel. Estimated from the screenshots. |
| `--shadow-sticky` | `0 4px 12px rgba(30, 44, 66, 0.08)` | Soft shadow under the sticky sidebar header once the list scrolls. Estimated. |

## Component specifications

### Button

Buttons trigger actions; one primary (brand-600) button per view, everything else outlined.

**Classes** `ds-btn` (outlined, default) · `ds-btn--primary` · `ds-btn--sm` (control-sm, card actions) · `ds-btn--lg` (control-xl, hero only) · `ds-btn--icon` (square, needs `aria-label`) · `ds-btn--round` (20px global "create" disc) · `ds-action` (borderless grey pill used in the balances action row) · `ds-kbd` (shortcut hint inside a button).

| Variant | Height | Fill | Border | Label |
|---|---|---|---|---|
| Primary | control-md 28px | brand-600 | none | on-brand, 14/600 |
| Secondary | control-md 28px | surface-0 | 1px border | ink-800, 14/600 |
| Small | control-sm 24px | surface-0 | 1px border | ink-800, 13/600 |
| Large | control-xl 40px | either | as above | 16/600 |
| Disabled primary | — | brand-300 | none | on-brand |
| Disabled secondary | — | surface-0 | border-subtle | ink-400 |

- Radius radius-md; horizontal padding space-2 (space-4 on large); icon-to-label gap 6px; icons 16px in ink-700.
- Leading icon for "create/add" verbs (plus), trailing icon for "leaves the page" (arrow).
- Buttons sit in a row with a space-2 gap, right-aligned in the page title row.
- Hover on secondary is surface-100. Hover and focus colours were not visible in the screenshots; the brand-500 hover and 2px brand-500 focus ring are this system's own additions.

Example markup:

```html
<div class="ds-row"><button class="ds-btn ds-btn--primary"><svg><!-- 16px icon --></svg> Create checkout</button><button class="ds-btn"><svg><!-- 16px icon --></svg> Add customer <span class="ds-kbd">N</span></button><button class="ds-btn">View docs <svg><!-- 16px icon --></svg></button><button class="ds-btn ds-btn--icon" aria-label="Export"><svg><!-- 16px icon --></svg></button><button class="ds-btn ds-btn--primary ds-btn--round" aria-label="Create"><svg><!-- 16px icon --></svg></button></div>
<div class="ds-row"><button class="ds-btn ds-btn--primary" disabled>Save changes</button><button class="ds-btn" disabled>Pay out funds</button><button class="ds-btn ds-btn--sm"><svg><!-- 16px icon --></svg> Review sessions</button><button class="ds-btn ds-btn--sm">Edit</button></div>
<div class="ds-row"><button class="ds-btn ds-btn--primary ds-btn--lg">Get started</button><button class="ds-btn ds-btn--lg">View docs</button></div>
<div class="ds-row"><button class="ds-action"><svg><!-- 16px icon --></svg> Add funds</button><button class="ds-action">Create card</button><button class="ds-action" disabled><svg><!-- 16px icon --></svg> Transfer</button><button class="ds-action" disabled>Send</button></div>
```

### Chip

Chips switch between saved views of a list; pills hold an applied or addable filter; tags label a thing.

- `ds-chip` — view chip above a table. control-lg (36px), radius-lg, 14/600 ink-900, 1px border-subtle. Selected (`aria-pressed="true"`) swaps to a 2px ink-900 outline; no fill change. Gap space-2. A trailing "···" chip holds overflow views.
- `ds-pill` — applied filter. control-sm (24px), radius-full, 12/600. The label is ink-700, the chosen value (`<b>`) is brand-600 after a 1px divider. `ds-pill--add` uses a dashed border and a plus-circle icon for filters not yet applied.
- `ds-tag` — 20px, radius-sm, 12/400 ink-600, 1px border (e.g. "Preview" beside a page title). `ds-tag--brand` is the filled brand-075 pill with brand-600 text.
- `ds-segmented` — two-option view switch (grid/list): border-subtle track, surface-0 thumb with a 1px border ring.

Example markup:

```html
<div class="ds-row"><button class="ds-chip" aria-pressed="true">All</button><button class="ds-chip">Succeeded</button><button class="ds-chip">Refunded</button><button class="ds-chip">Disputed</button><button class="ds-chip" aria-label="More">···</button></div>
<div class="ds-row"><button class="ds-pill">Date range <b>Last 7 days</b><svg><!-- 16px icon --></svg></button><button class="ds-pill"><svg><!-- 16px icon --></svg> Compare <b>Previous period</b><svg><!-- 16px icon --></svg></button><button class="ds-pill ds-pill--add"><svg><!-- 16px icon --></svg> Card type</button><button class="ds-pill ds-pill--add"><svg><!-- 16px icon --></svg> More filters</button></div>
<div class="ds-row"><span class="ds-tag">Preview</span><span class="ds-tag ds-tag--brand">1%</span><span class="ds-tag">Recommendation</span><span class="ds-segmented"><button aria-pressed="true" aria-label="Grid"><svg><!-- 16px icon --></svg></button><button aria-label="List"><svg><!-- 16px icon --></svg></button></span></div>
```

### Badge

Badges show the status of a record inside a table cell.

- 20px tall, radius-sm, padding 0 6px, text 12/500, 1px border.
- `ds-badge--danger`: danger-050 fill, danger-200 border, danger-700 text. Seen for Failed and Blocked.
- `ds-badge` (neutral): surface-100 fill, border, ink-700 text.
- `ds-dot`: 6px brand-600 disc marking an unread notification or a new recommendation.
- Only the danger badge appeared in the screenshots. Success, warning and info badges were not captured, so they are not defined here; add them from a screenshot that shows them rather than inventing colours.

Example markup:

```html
<div class="ds-row"><span class="ds-badge ds-badge--danger">Failed</span><span class="ds-badge ds-badge--danger">Blocked</span><span class="ds-badge">Draft</span><span class="ds-dot" title="Unread"></span></div>
```

### Tabs

Tabs split one page into sibling views directly under the page title.

- `ds-tabs` — row with a space-6 gap on a 1px border baseline. Each `ds-tab` is 14/600; inactive ink-700; selected brand-600 with a 2px brand-600 underline sitting on the baseline. Space-3 between label and underline.
- `ds-tabs--neutral` — same, but the selected tab is ink-900 with an ink-900 underline. Both treatments appear in the screenshots (Transactions uses neutral, Checkout and Billing use brand). Pick one per product and keep it; brand is the more common.
- `ds-tabcards` — counted tabs inside a panel (notifications): equal-width cards, radius-md, label 12/600 over a 14/400 count. Selected card has a 2px brand-600 outline and brand-600 text.

Example markup:

```html
<div class="ds-tabs" role="tablist"><button class="ds-tab" role="tab">Performance</button><button class="ds-tab" role="tab" aria-selected="true">Checkouts</button><button class="ds-tab" role="tab">Payment links</button><button class="ds-tab" role="tab">Logic</button></div>
<div class="ds-tabs ds-tabs--neutral" role="tablist"><button class="ds-tab" role="tab" aria-selected="true">Payments</button><button class="ds-tab" role="tab">Payouts</button><button class="ds-tab" role="tab">Top-ups</button><button class="ds-tab" role="tab">All activity</button></div>
<div class="ds-tabcards" role="tablist" style="max-width:400px"><button class="ds-tabcard" role="tab" aria-selected="true">All<span>3</span></button><button class="ds-tabcard" role="tab">Action required<span>0</span></button><button class="ds-tabcard" role="tab">Updates<span>3</span></button></div>
```

### Sidebar

The sidebar is the fixed left column for product navigation; the account menu drops from its header.

**Sidebar** (`ds-sidebar`, sidebar-width 240px, surface-0, 1px border-subtle on the right)
- Header (`ds-workspace`): 24px avatar tile (radius-md, surface-100, initial in ink-700) + truncated name 14/600 + chevron. When open the whole header takes a surface-100 fill.
- Groups: an unlabeled primary group, then labeled groups (`ds-nav-label`, 12/400 ink-700). space-6 between groups.
- Row (`ds-nav-item`): control-md 28px on a 30px pitch, radius-md, 16px icon in ink-600, space-3 gap, label 14/400 ink-900. Hover: surface-100. Current (`aria-current="page"`): label brand-600 at weight 600, icon brand-500, brand-050 fill.
- Expandable rows carry a trailing 12px chevron (down closed, up open). Children (`ds-nav-sub`) have no icon and align with the parent label (36px left padding).
- When the list scrolls, the header stays put with shadow-sticky below it.

**Account menu** (`ds-menu`, menu-width 288px, radius-lg, shadow-popover)
- Centered header: 32px avatar tile and the full name in 16/700.
- Items (`ds-menu-item`): 36px tall, space-4 side padding, icon ink-600, label 14/400. Items that open a submenu end with a right chevron. Groups are separated by a 1px border rule.

Example markup:

```html
<div style="display:flex;gap:32px;align-items:flex-start">
<nav class="ds-sidebar">
<div class="ds-workspace"><span class="ds-avatar">I</span> Internova Techn… <svg><!-- 16px icon --></svg></div>
<ul class="ds-nav"><li><a class="ds-nav-item" aria-current="page"><svg><!-- 16px icon --></svg> Home</a></li><li><a class="ds-nav-item"><svg><!-- 16px icon --></svg> Transactions</a></li><li><a class="ds-nav-item"><svg><!-- 16px icon --></svg> Customers</a></li></ul>
<p class="ds-nav-label">Shortcuts</p>
<ul class="ds-nav"><li><a class="ds-nav-item"><svg><!-- 16px icon --></svg> Checkout</a></li><li><a class="ds-nav-item"><svg><!-- 16px icon --></svg> Billing overview</a></li></ul>
<p class="ds-nav-label">Products</p>
<ul class="ds-nav" style="margin:0"><li><a class="ds-nav-item"><svg><!-- 16px icon --></svg> Treasury <svg><!-- 16px icon --></svg></a></li><li><a class="ds-nav-item ds-nav-sub">Overview</a></li><li><a class="ds-nav-item ds-nav-sub" aria-current="page">Cards</a></li><li><a class="ds-nav-item"><svg><!-- 16px icon --></svg> Reporting <svg><!-- 16px icon --></svg></a></li></ul>
</nav>
<div class="ds-menu">
<div style="display:flex;flex-direction:column;align-items:center;gap:8px;padding:12px 16px"><span class="ds-avatar" style="width:32px;height:32px">IT</span><b style="font:700 16px/24px var(--font-sans)">Internova Technologies Inc</b></div>
<div class="ds-menu-item"><svg><!-- 16px icon --></svg> Settings</div><div class="ds-menu-item"><svg><!-- 16px icon --></svg> Switch to sandbox <svg><!-- 16px icon --></svg></div><div class="ds-menu-item"><svg><!-- 16px icon --></svg> Create <svg><!-- 16px icon --></svg></div><hr><div class="ds-menu-item"><svg><!-- 16px icon --></svg> Oluwatomi Walker</div><div class="ds-menu-item"><svg><!-- 16px icon --></svg> Sign out</div>
</div></div>
```

### Popover

A popover is a small floating note anchored to a control, used to announce a change in place.

- `ds-popover`: surface-0, radius-lg, shadow-popover, padding space-4, about 280px wide. A small pointer on the anchored side is optional.
- Title 14/700 ink-900; body 14/400 ink-700; a 16px dismiss "x" top-right in ink-900.
- The right-hand notifications panel uses the same surface and shadow at panel-width 448px: a 20/700 title, counted tabs (see Tabs), then items separated by 1px border-subtle rules, each with a 14/600 title, 14/400 body and a brand-600 unread dot on the right.

Example markup:

```html
<div class="ds-popover"><button class="ds-close" aria-label="Dismiss"><svg><!-- 16px icon --></svg></button><h4>Payment Links is now in Checkout</h4><p>Create and manage all your checkouts in one place.</p></div>
```

### Input

Form controls: search fields, select triggers, checkboxes, toggles and read-only values.

- `ds-input ds-input--filled` — global search. control-lg 36px, search-width 360px, radius-lg, surface-100 fill, no border, 16px search icon in ink-700, placeholder ink-500.
- `ds-input` — toolbar search above a table. Same size, surface-0 with a 1px border-subtle; stretches to fill the row, with the Filter button (a `ds-chip`) to its right. Focus: border brand-500 (seen on the assistant chat input).
- `ds-select` — select trigger. control-md 28px, radius-md, 1px border, label 14/600 ink-800, trailing up/down chevron pair (12px, ink-700). A single down chevron is used when the control sits inline in a sentence ("Compared to …").
- `ds-check` — 16px, radius-sm, 1px border with a faint inner top shadow. The checked state was not captured; brand-600 with a white tick is this system's assumption.
- `ds-toggle` — 36×20px, radius-full. Off: border-subtle track with a white 16px thumb. On (assumed, not captured): brand-600 track.
- `ds-field-label` 14/600 above a value; read-only IDs and links use `ds-mono` 13/20 with a copy icon after the value.

Example markup:

```html
<div class="ds-input ds-input--filled" style="width:360px"><svg><!-- 16px icon --></svg><input placeholder="Search"></div>
<div class="ds-row" style="flex-wrap:nowrap"><div class="ds-input" style="flex:1"><svg><!-- 16px icon --></svg><input placeholder="Search by name, email, etc."></div><button class="ds-chip"><svg><!-- 16px icon --></svg>&nbsp; Filter</button></div>
<div class="ds-row"><button class="ds-select">Last 3 months <svg><!-- 16px icon --></svg></button><button class="ds-select">Weekly <svg><!-- 16px icon --></svg></button><button class="ds-select" style="width:240px">Default <svg><!-- 16px icon --></svg></button><input type="checkbox" class="ds-check" aria-label="Select row"><input type="checkbox" class="ds-check" checked aria-label="Select row"><input type="checkbox" class="ds-toggle" aria-label="Off"><input type="checkbox" class="ds-toggle" checked aria-label="On"></div>
<div><span class="ds-field-label">Portal ID</span><span class="ds-mono">bpc_1TBuDUDP4AHRJpjORJPmTaXm</span></div>
```

### Table

Tables list records; one row per record, the whole row clickable.

- No outer border, no zebra striping, no vertical rules: only 1px border-subtle under the header and under each row.
- Header: table-header-height 36px, 12/600 ink-700, left-aligned (right-aligned over numeric columns).
- Rows: table-row-height 44px, 14/400 ink-900. The identifying column is weight 600 (`strong`: customer name, or `num`: amount, right-aligned). The currency code follows the amount in ink-700 (`cur`). Empty cells show an em dash. Columns that overflow fade out at the right edge.
- First column is a 16px checkbox (44px wide cell); the header checkbox selects all.
- Status is a Badge. Dates read "3 Aug 2026, 19:55".
- Toolbar above: view chips, then search input + Filter button + column-settings icon button, each control-lg.
- Footer (`ds-pager`): two 12px chevrons (ink-400 when disabled) then "1 – 3 of 3 results" in 12/400 ink-700. Card lists instead use the count on the left and Previous / Next secondary buttons on the right.
- Row hover (surface-100) is assumed; it was not captured.

Example markup:

```html
<div><table class="ds-table"><thead><tr><th><input type="checkbox" class="ds-check" aria-label="Select all"></th><th style="text-align:right">Amount</th><th></th><th>Status</th><th>Date</th><th>Description</th><th>Customer name</th></tr></thead>
<tbody><tr><td><input type="checkbox" class="ds-check" aria-label="Select"></td><td class="num">$1,800.00</td><td class="cur">USD</td><td><span class="ds-badge ds-badge--danger">Failed</span></td><td>3 Aug 2026, 19:55</td><td>Subscription creation</td><td>Thera Behavioral Health</td></tr>
<tr><td><input type="checkbox" class="ds-check" aria-label="Select"></td><td class="num">$1,800.00</td><td class="cur">USD</td><td><span class="ds-badge ds-badge--danger">Blocked</span></td><td>3 Aug 2026, 19:14</td><td>Subscription creation</td><td>Thera Behavioral Health</td></tr>
<tr><td><input type="checkbox" class="ds-check" aria-label="Select"></td><td class="num">$188.00</td><td class="cur">USD</td><td><span class="ds-badge ds-badge--danger">Failed</span></td><td>7 Jul 2026, 04:18</td><td>Subscription creation</td><td>Cruxlab Health Services</td></tr></tbody></table>
<div class="ds-pager"><button disabled aria-label="Previous"><svg><!-- 16px icon --></svg></button><button disabled aria-label="Next"><svg><!-- 16px icon --></svg></button><span>1 – 3 of 3 results</span></div></div>
<div class="ds-row" style="justify-content:space-between"><span class="ds-muted" style="font-size:12px">1–1 of 1 active</span><span class="ds-row"><button class="ds-btn" disabled>Previous</button><button class="ds-btn" disabled>Next</button></span></div>
```

### Card

Cards group a metric, a chart, a recommendation or a link into one bounded block.

- `ds-card` — surface-0, 1px border-subtle, radius-lg, padding space-4. Hover or selected: border-strong. Chart cards sit in a two-column grid with a space-4 gap.
- Chart card: title 14/600, an expand arrow top-right (a surface-100 disc appears behind it on hover), figure in metric-lg 24/700, then the chart. Lines are 2px chart-1; the comparison baseline is dashed ink-300; axis labels 12/400 ink-500.
- `ds-card--grey` — borderless surface-100 block for settings groups, API-key panels and summary metrics. Label 14/400, figure in metric 20/400, negative change in negative-700.
- `ds-card--brand` — recommendation: brand-050 fill, brand-100 border, 14/600 title, 14/400 body, optional brand-600 dot.
- `ds-legend` — status breakdown: 12px square swatch (2px radius) + label + bold count right-aligned, 36px rows with border-subtle rules. Series order is chart-1 to chart-5. Adjacent series differ in lightness as well as hue, but always pair the swatch with its label.
- `ds-tile` — settings link: 32px icon tile (surface-100, radius-md, icon brand-500), title 16/700 brand-600, description 14/400 ink-900. Three columns on wide pages, two when a side panel is open. Hover fills the tile surface-100.

Example markup:

```html
<div style="display:grid;grid-template-columns:1fr 1fr;gap:16px">
<div class="ds-card ds-card--selected"><div class="ds-card-head"><p class="ds-card-title">New trials</p><svg><!-- 16px icon --></svg></div><p class="ds-metric-lg">0</p><div class="ds-chartline"></div><div class="ds-axis"><span>17 Nov</span><span>19 Nov</span><span>21 Nov</span><span>23 Nov</span></div></div>
<div class="ds-stack"><div class="ds-card ds-card--brand"><p class="ds-card-title">Add upsells</p><span>Let customers upgrade to longer-term plans during checkout.</span></div>
<div class="ds-card ds-card--grey"><span class="ds-muted">Gross volume</span><p class="ds-metric">US$0.00</p><span class="ds-delta-neg">-100.0%</span></div></div>
<ul class="ds-legend"><li><i style="background:var(--chart-1)"></i>Posted<b>0</b></li><li><i style="background:var(--chart-2)"></i>Processing<b>0</b></li><li><i style="background:var(--chart-3)"></i>Cancelled<b>0</b></li><li><i style="background:var(--chart-4)"></i>Failed<b>0</b></li><li><i style="background:var(--chart-5)"></i>Scheduled<b>0</b></li></ul>
<div><a class="ds-tile"><span class="ds-tile-icon"><svg><!-- 16px icon --></svg></span><span><h3>Personal details</h3><p>Contact information, password, authentication methods and your active sessions.</p></span></a><a class="ds-tile"><span class="ds-tile-icon"><svg><!-- 16px icon --></svg></span><span><h3>Developers</h3><p>API policies, Workbench and more</p></span></a></div>
</div>
```

### Banner

Banners carry a dismissible tip above page content; empty states stand in for missing data.

- `ds-banner` — full content width, surface-100, radius-lg, about 60px tall, padding space-4. A 16px lightbulb icon, one sentence in 14/400 ink-700, a brand-600 text link right-aligned, then a dismiss "x" in ink-900. No border, no coloured variants were captured.
- `ds-empty` — 1px dashed border-strong outline, radius-lg, centered 14/400 ink-700 text, optionally under a 28px search glyph. Used for empty charts and empty lists ("No checkout drafts").
- `ds-empty--filled` — filtered table with no matches: a surface-100 bar with "No results" in 14/600 and a secondary "Clear all" button on the right.
- Copy pattern: say what is missing, then the one thing to try. No illustration, no exclamation marks.

Example markup:

```html
<div class="ds-banner"><svg><!-- 16px icon --></svg><span>Pay recipients in 160+ countries by local transfer, debit card or crypto with Global Payouts.</span><a class="ds-link">Set up payouts</a><button aria-label="Dismiss"><svg><!-- 16px icon --></svg></button></div>
<div class="ds-empty ds-empty--filled"><span>No results</span><button class="ds-btn">Clear all</button></div>
<div class="ds-empty"><svg><!-- 16px icon --></svg><span>No payments matching this selection.<br>Select another date range and try again.</span></div>
```

## Not captured

These did not appear in the screenshots and are deliberately left undefined: dark theme; success, warning and info colours; modals and dialogs; toasts; text areas, radio buttons and date pickers; form validation errors; tooltips; loading and skeleton states; mobile breakpoints. Send screenshots of any of these and they can be added the same way.
