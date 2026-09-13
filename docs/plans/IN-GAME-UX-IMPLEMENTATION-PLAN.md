# Poorup In-Game UX Implementation Plan

## `/goal`

Implement the UX audit without replacing the Poorup visual system or creating a
second game shell:

- consolidate the right rail into `HOLDINGS`, `DEALS`, and `ACTIVITY`;
- remove the duplicate Log rail tab and make the topbar drawer canonical;
- make the Cash HUD cell an accessible Wallet entry point;
- add one `WALLET & ITEMS` modal with `ACCOUNT` and `ITEMS` views;
- move advanced Market, Predictions, and Casino work into focused modals;
- preserve persistent summaries, urgent obligations, and current-turn context;
- add safe, explicit panel visibility controls;
- preserve server authority, modal neutrality, focus restoration, reduced motion,
  responsive behavior, and the locked Poorup UI system;
- update browser QA and verify at the supported viewports.

> **Status (2026-09-11).** The three-tab rail, Cash HUD/Wallet & Items shell,
> modal, and panel-control slices are implemented. Wallet item/account
> mutations remain future server work. Treat this file as the implementation
> contract and use the current UX audit and 2026-09-12 fix reports for remaining
> work; the original pre-implementation gate below is historical.

> **Current status (2026-09-12).** Purchase scrim/Escape dismissal is neutral,
> the turn countdown remains visible through turn-owned resolution while the
> server deadline is live, and the shared focus trap excludes native `[hidden]`
> descendants. The old `FOCUS` control is retired; `PANELS` is the single
> explicit visibility menu. Evidence: `docs/audit/fix-transaction-ui-batch-2026-09-12.md`,
> `public/index.html:572-591`, `public/clientTransactionUi.test.js`, and
> `public/clientUxContracts.test.js`.

## Non-negotiable product constraints

Poorup remains a retro-futuristic terminal/parlor board game. Reuse
`.ulpi/design/DESIGN.md`, `PRODUCT.md`, existing native controls, surfaces,
rails, modal controller, live regions, and pixel-art/SVG assets.

Do not introduce:

- a new component library or frontend framework;
- a second rules engine, client-side settlement path, or duplicated deal state;
- glassmorphism, gradients, pill-heavy SaaS navigation, emoji controls, or
  decorative motion without a gameplay purpose;
- a new top-level page for Wallet, Items, Market, Casino, or bank tiers;
- automatic acceptance, decline, payment, sale, wager, or cancellation on
  modal close;
- a new match-cash shop or paid gameplay entitlement.

The board, tile dimensions, room flow, topbar, left rail, center field, and
bottom HUD footprint remain recognizable and stable.

## Historical pre-implementation evidence (superseded)

The following evidence explains why the refactor was commissioned. It describes
the pre-implementation baseline, not the current client; use the current-status
banner and the live notes below for current behavior.

The pre-reset game rail rendered six equal tabs in
`public/index.html:770` through `public/index.html:775`: My Deeds, Trade, Log,
Finance, Casino, and Market. This combines assets, obligations, history, and
optional activities in one narrow navigation model.

Finance renders both the player-contract projection and bank-credit surface in
`public/clientRailRender.js:111` and `public/clientRailRender.js:582`.

Market renders order quantity, risk metrics, margin, shorting, options, and
advanced actions directly in the rail in `public/clientRailRender.js:206`.

The Event Log already has a topbar trigger at `public/index.html:579` and a
dedicated drawer at `public/index.html:889`, so the rail Log tab is duplicate.

The pre-reset Cash On Hand HUD cell at `public/index.html:729` was display-only.

The pre-reset `FOCUS` control hid both rails while `PANELS` only toggled the
left rail, which created an asymmetric recovery path on narrow screens.

The pre-reset shared surface controller did not include `#log-drawer` in
`SURFACE_SELECTORS`, so the drawer did not inherit the same inert-background and
keyboard-trap contract as other blocking surfaces.

## Current implementation evidence (2026-09-12)

- The live rail has three tabs — `HOLDINGS`, `DEALS`, and `ACTIVITY` — at
  `public/index.html:770-775`; the topbar `LOG` button opens the canonical
  drawer.
- The Cash On Hand HUD cell is an interactive button at
  `public/index.html:729-734` and opens the Wallet & Items shell.
- `PANELS` owns reversible Players/Chat/Right Rail visibility and HUD density;
  there is no separate `FOCUS` action (`public/index.html:575-591`,
  `public/clientPanelMenu.js:1-151`).
- Wallet currently renders cash/account/item shell data only. Item actions and
  bank-account upgrades remain unavailable until viewer-scoped projections and
  server verbs are added; see `.ulpi/design/FINANCE-RAIL-UX-PLAN.md`.

## Design read and quality bar

**Design read:** the board is a shared table; the right rail is a personal
ledger; a modal is a focused workbench for one decision. The rail should answer
“what can I do right now?” in one glance, while the board remains the visual
anchor.

**Direction:** *Ledger Night Market*, continued from the existing Poorup system.
The signature is a single ledger hierarchy: status at the edge, one focused
decision in the center, and a server-confirmed result returned to the ledger.

**Design dials:** `DESIGN_VARIANCE 4`, `MOTION_INTENSITY 3`,
`VISUAL_DENSITY 5`. This is an in-round operate surface, so clarity and
controlled density outrank novelty.

**DFII:** Impact 4, context fit 5, implementation feasibility 5, performance
5, consistency risk 1. Score: **18/20**. The proposal is a restrained
information-architecture change, not a visual replacement.

## Target information architecture

```text
TOPBAR: room · turn · log · panels · social · sound · music
LEFT:   players · parlor chat
CENTER: global event banner · board · turn HUD
RIGHT:  HOLDINGS | DEALS | ACTIVITY
BOTTOM: current-turn HUD, including interactive Cash On Hand
```

### `HOLDINGS`

Persistent owned resources:

- `DEEDS`: owned properties, houses, mortgage state, and deed detail entry;
- `ITEMS`: item glyph, name, rarity, quantity, and legal-action hint;
- `ACCOUNT`: compact bank-tier/cashback summary and `OPEN WALLET`.

The rail never becomes a full inventory editor. Selecting an item opens the
Wallet modal on `ITEMS`.

### `DEALS`

One unified place for:

- incoming and outgoing trades;
- player loans, equity, and hybrid agreements;
- bank credit and partial repayments;
- active obligations, due rounds, and stale-state notices.

Use three subfilters:

```text
NEEDS YOU | ACTIVE | OUTGOING
```

Rows remain collapsed and open the existing read-only Deal Details modal. The
one rail primary action is `SEND DEAL`, which opens the existing builder.

### `ACTIVITY`

Optional systems use a second-level mode switch:

```text
INDEXES | PREDICTIONS | CASINO
```

Only summaries live in the rail. Advanced work opens a focused modal:

- Market Order Desk for margin, shorting, and options;
- Prediction Ticket for stake, odds, fee, lock round, and maximum profit;
- Casino Bet/Result surface for high-stakes confirmation and settled result.

### `LOG`

Remove the rail tab. The topbar Log button is the only entry point. Add an
unread count, `aria-expanded`, `aria-controls`, and a managed drawer state.

## Wallet and Items modal

The Cash On Hand cell becomes a semantic button without changing its visual
footprint. It opens one modal:

```text
WALLET & ITEMS
[ ACCOUNT ] [ ITEMS ]
```

Entry points:

- Cash HUD button opens `ACCOUNT`;
- Holdings `OPEN WALLET` opens `ACCOUNT`;
- Holdings `OPEN ITEMS` opens `ITEMS`;
- a prison or airport prompt may deep-open `ITEMS` only when a current choice
  needs an item.

### Account view

Order of information:

1. cash on hand and reserved cash;
2. current bank account tier;
3. next tier, cost, eligible benefits, and round cap;
4. one `UPGRADE ACCOUNT` action when legal;
5. five recent wallet ledger entries.

Upgrade confirmation is an in-place modal step, not a nested dialog. It shows
cost, new tier, remaining cash, benefits, cap, and any active event pause. The
server rechecks current seat, cash, tier, obligation state, event state, and
idempotency.

### Items view

Each row shows item glyph, name, rarity, quantity, uses remaining, source, and
only the actions currently legal: `USE`, `TRADE`, `EXCHANGE`, or `SELL TO BANK`.
Selecting a row reveals its bounded effect and bank value in the same modal.
Trading hands a prefilled item leg to the existing Deal Builder and provides a
clear `BACK` step. Closing never sells or trades the item.

## Modal and drawer state model

Use one client-only surface state object. It describes presentation, never
authoritative game rules:

```js
{
  railTab: 'holdings' | 'deals' | 'activity',
  dealsFilter: 'needs-you' | 'active' | 'outgoing',
  activityMode: 'indexes' | 'predictions' | 'casino',
  modal: null | 'wallet' | 'deal-detail' | 'deed' | 'market-desk' |
    'prediction-ticket' | 'casino-result',
  modalStep: 'account' | 'items' | 'details' | 'confirm',
  returnFocusId: string | null,
  pendingRequestId: string | null,
  panelVisibility: {
    players: true,
    chat: true,
    rightRail: true,
    hud: 'full' | 'compact'
  }
}
```

The existing `state` object remains the source for live data. The rail, HUD,
drawer, and modals subscribe to the same snapshot. Do not copy or reconcile
separate deal, item, account, market, or cash stores in the client.

## Modal taxonomy

| Surface | Pattern | Reason |
| --- | --- | --- |
| Current turn, cash, deed ownership | Static HUD/rail | Repeated scanning |
| Deeds | Static rows + existing deed modal | Quick status, detailed action on demand |
| Deals | Collapsed persistent rows + existing detail/builder | Pending work must remain visible |
| Wallet/Items | Focused modal | Private resources and multi-step actions |
| Market summary | Activity rail | Low-density awareness |
| Margin/short/options | Market Desk modal | Multiple fields and risk disclosure |
| Predictions | Ticket confirmation modal | Fee, odds, lock, and payout clarity |
| Casino | Activity summary + confirmation/result modal | Risk and settlement transparency |
| Airport travel | Existing landing modal | Contextual decision |
| Prison | Existing HUD/modal decision | Mandatory current-turn choice |
| Global events | Center banner | Shared context; modal only for explicit votes |
| Event history | Topbar drawer | Browseable secondary information |

One blocking modal is allowed at a time. Steps change inside the same surface;
they do not create modal-on-modal stacks.

## Panel visibility model

Repurpose the existing `PANELS` control into an explicit visibility menu:

```text
PLAYERS     ON/OFF
CHAT        ON/OFF
RIGHT RAIL  ON/OFF
HUD         COMPACT/FULL
```

Rules:

- current turn, roll/action control, required payment, auction, bankruptcy,
  and active global-event warning are never hidden;
- hidden rails leave a small edge handle/status strip with counts such as
  `2 DEALS NEED YOU`;
- the preference is user-controlled and stored per device/session;
- no panel auto-hides because of inactivity;
- There is no separate `FOCUS BOARD` action in the current shell; `PANELS` is
  the single explicit visibility control. Preserve this decision unless the
  panel IA is intentionally revisited.
- desktop exposes the same control path as tablet/mobile;
- on mobile the right rail becomes a bounded bottom sheet with the same three
  tabs and internal scrolling.

## Async and server-authority rules

Every mutation must:

1. enter a visible pending state immediately;
2. disable only the submitted control, not the entire modal;
3. use an idempotency key;
4. render success from the next authoritative snapshot;
5. render errors inline with a recovery action;
6. remain open when the request is stale, rejected, or timed out.

The UI must never decide market outcomes, casino outcomes, item effects,
ownership, cash, or account tier. Existing Socket.IO actions and guards remain
the contract.

## Motion plan

Motion is sparse and purposeful:

- rail tab state: 120ms, opacity plus 3px transform, strong ease-out;
- modal enter/exit: 160–200ms, opacity plus transform only;
- drawer: existing slide direction, up to 300ms for ordinary UI;
- pending result: no layout jump; replace the action label with
  `PROCESSING…`;
- wallet step transition: 100ms in-place opacity change;
- no bounce, elastic scale, keyframe restart on rapid actions, or decorative
  loops;
- keyboard-opened panels switch instantly when appropriate;
- reduced motion removes travel and keeps a gentle opacity/state change;
- all motion is interruptible and never drives game rules.

Existing Poorup motion tokens are extended only when a current token is absent.
No new SVG animation is needed. Existing pixel-art glyphs are reused; a new
Wallet/Activity mark is created only if the current sprite sheet has no suitable
semantic mark, using a crisp 16×16 or 24×24 grid and the locked palette.

## Accessibility contract

- native `button`, `dialog`, `tablist`, `tab`, `tabpanel`, `form`, and `label`;
- active tab has `aria-selected`, `aria-controls`, and a matching panel label;
- Wallet, Market Desk, Prediction Ticket, and Casino Result trap focus while
  open and restore focus to the triggering control;
- Log drawer receives the same treatment and has `aria-expanded`/`aria-controls`
  on its trigger;
- status updates use one polite live region; urgent payment/auction errors use
  an assertive region only when action is required;
- status never relies on color alone;
- cash, prices, stakes, balances, and round numbers use tabular numerals;
- all action targets are at least 44px high where possible;
- 200% zoom, forced colors, keyboard-only navigation, and reduced motion are
  tested;
- internal rail/modal scrolling uses `overscroll-behavior: contain` and never
  turns the full game page into a scroll trap.

## Implementation slices

### Slice 1: Log ownership and surface semantics — shipped

Files: `public/index.html`, `public/clientLogDrawer.js`,
`public/clientSurfaces.js`, `public/clientKeyboard.js`, `public/main.js`.

- remove the rail Log tab;
- add drawer `role="dialog"`, labelled heading, `aria-modal`, and trigger state;
- include the drawer in the shared surface/focus model;
- preserve topbar `L` shortcut and neutral close behavior;
- add live unread count without duplicating log content.

Tests: drawer open/close, Escape, focus restoration, Tab containment, filter
state, and no rail Log tab.

### Slice 2: Three-tab rail skeleton — shipped

Files: `public/index.html`, `public/clientRailRender.js`, `public/main.js`,
`public/styles.css`, `public/clientState.js`.

- replace six tabs with `HOLDINGS`, `DEALS`, `ACTIVITY`;
- normalize rail state and labels;
- merge Trade/Finance into Deals without changing server payloads;
- remove redundant footer manager behavior unless it opens a real manager;
- add Deals filters and counts.

Tests: tab selection, keyboard order, empty states, pending deal persistence,
and old server snapshots.

### Slice 3: Wallet and Items — shell shipped; mutations pending

Files: `public/index.html`, `public/clientHudRender.js`,
`public/clientRailRender.js`, `public/clientRailEvents.js`, new or existing
modal module, `public/styles.css`.

- turn Cash On Hand into a semantic button with the same visual footprint;
- implement `WALLET & ITEMS` Account/Items views;
- wire bank upgrade to a server action and confirmation path;
- render item summaries and legal actions from viewer-scoped data;
- preserve item trade handoff to Deal Builder.

The current build stops at the shell: no item projection/action handler or
bank-account upgrade server seam is wired yet. Keep these as the next
implementation slice rather than describing them as live behavior.

Tests: keyboard entry, modal neutrality, upgrade pending/error/success, item
use/trade/exchange/sale guard behavior, stale snapshots, and focus restoration.

### Slice 4: Activity workspaces — staged Market/Casino shipped; future work remains

Files: `public/clientRailRender.js`, `public/clientRailEvents.js`, existing
market/casino/deal modules, `public/styles.css`, `public/index.html` only when
new modal shells are required.

- add `INDEXES`, `PREDICTIONS`, and `CASINO` mode controls;
- keep quote/odds/ticket summaries in the rail;
- move advanced Market actions into Market Desk;
- add Prediction Ticket confirmation and Casino high-stakes/result surfaces;
- keep server settlement and existing ruleset gates untouched.

Tests: no client-selected outcomes, pending state, duplicate-submit prevention,
stale/timeout recovery, and event modifier disclosure.

### Slice 5: Panel visibility and responsive behavior — desktop controls shipped; mobile follow-up

Files: `public/main.js`, `public/clientState.js`, `public/index.html`,
`public/styles.css`, `public/clientKeyboard.js`.

- **Shipped:** replace the one-sided Panels toggle with explicit Players, Chat,
  Right Rail, and HUD-density controls.
- **Follow-up:** expose the mobile recovery path, compact hidden-rail handles,
  and a bounded bottom sheet without page scrolling.

Tests: focus board, open panels, keyboard navigation, safe-area behavior,
mobile sheet scroll, and state restoration after reload/reconnect.

### Slice 6: QA and polish

- run client lint and browser tests at 1920×1080, 1366×768, 1024×768, and
  390×844;
- capture live round, Wallet Account, Wallet Items, Deals, Activity, Market
  Desk, Log drawer, and panel menu at 1920px;
- run accessibility checks, forced colors, 200% zoom, and reduced motion;
- run the Impeccable detector once over changed UI files;
- review motion against the Emil Kowalski checklist;
- record rollback notes and update the relevant Rules-book copy if labels change.

## Test seams

Use existing public seams rather than implementation-coupled tests:

- `renderRightRail()` output and click dispatch for rail behavior;
- shared surface open/close and keyboard behavior;
- server acknowledgements for bank/item/market/casino actions;
- browser-visible labels, roles, focus, and scroll regions;
- authoritative state snapshots for remote updates and stale actions.

Add tests vertically, one slice at a time. Do not write a speculative bulk test
suite against private helper functions.

## Rollback and migration

- client rail state accepts legacy `deeds`, `trade`, `finance`, `casino`, and
  `market` values during one compatibility window, mapping them to the new
  tabs without changing server state;
- the old server actions remain valid and no data migration is required;
- a feature flag can return the old renderer if browser QA finds a blocking
  regression;
- closing the new modal never clears pending deals, item inventory, or cash;
- removing the client feature flag leaves authoritative game data untouched.

## Acceptance criteria

- The right rail presents three intent-based tabs, never six compressed tabs.
- The Log tab is gone; the topbar drawer is canonical and keyboard-safe.
- Cash On Hand opens Wallet and Items without leaving the round.
- **Future contract:** bank upgrades and item actions must have one clear modal
  path and neutral dismiss; the current Wallet shell has no mutation seam.
- Deals stay visible after modal close and refresh in place after remote changes.
- Activity summaries remain readable; the staged Market/Casino actions use
  focused modals. Prediction and any new activity mutation remains subject to
  its server contract.
- Panel hiding is explicit, reversible, and never hides a required decision.
- Classic game rules, board geometry, tile order, server settlement, and social
  surfaces remain unchanged.
- No new third-party package is needed.
- Client lint, existing server tests, browser QA, accessibility checks, and
  1920px visual evidence pass.

## Skill checkpoints

| Skill | Application in this implementation |
| --- | --- |
| `frontend-design-ui-ux` | Lock the incumbent Poorup visual language and document flows/states before UI edits. |
| `frontend-design` | Preserve a distinctive retro-terminal composition and avoid generic component layouts. |
| `design-taste-frontend` | Apply the existing retro-futurist direction with restrained density, not a template dashboard. |
| `impeccable` | Run context, craft-floor checks, responsive/layout audit, and detector after UI edits. |
| `game-ui-ux` | Use anchored rails, a screen/modal stack, event-driven HUD updates, and safe-area rules. |
| `accessibility` | Verify semantic controls, focus, live regions, contrast, zoom, and reduced motion. |
| `web-design-guidelines` | Check labels, button semantics, explicit transitions, stateful navigation, and drawer containment. |
| `animate` | Animate only purposeful modal/drawer/state transitions with explicit curves and durations. |
| `emilkowal-animations` | Use interruptible transform/opacity motion, no bounce defaults, and reduced-motion variants. |
| `svg-design` | Reuse the icon system; create a new glyph only when semantic coverage is missing. |
| `pixel-art-sprites` | Keep any new glyph crisp, grid-aligned, limited-palette, and readable at 1×. |
| `systematic-debugging` | Trace each UX defect to its source before changing behavior; verify one hypothesis per slice. |
| `tdd` | Test each public interaction seam red-green-refactor, not private implementation details. |
| `qa-agent-testing` | Add regression coverage for focus, stale actions, async states, and multi-surface interactions. |
| `agentic-eval` / `llm-evaluation` | Preserve identical legal candidate context for AI/NO-AI and evaluate status/fallback messaging. |
| `security-best-practices` | Keep server authority, idempotency, redaction, and no-secret client state boundaries. |
| `code-architecture-review` | Keep the modular monolith and avoid duplicated rail/modal state or runtime sprawl. |

## Planning gate result

The implementation plan is complete. The proposed architecture is a small
client information-architecture change layered onto the existing server and
surface controllers. It keeps Poorup's UI system, uses modals selectively, and
has explicit state, accessibility, QA, and rollback boundaries.

The delivered 2026-09-12 shell covers the three-tab rail, canonical Log drawer,
Cash HUD/Wallet entry, neutral purchase dismissal, and explicit `PANELS`
controls. Item mutations, bank-account upgrades, and portrait-mobile layout
remain separate follow-up slices; they are not implied by the shell status.
