# Poorup In-Game Rail and Modal UX Plan

## `/goal`

Reduce the cognitive load of the in-round right rail without changing the
Poorup board layout, visual language, or server-authoritative rules. The rail
should answer one question quickly: **what can I do right now?** Detailed work
should move into focused modals that preserve context and never navigate the
player away from the current round.

This plan is a companion to
`NEW-GAME-SYSTEMS-PLAN.md`. It covers the Finance/holdings rail, the Cash HUD
entry point, item access, market/casino workspaces, and the modal state model.

> **Status (2026-09-11).** The rail, Wallet & Items shell, modal, and
> panel-control slices are implemented. Use the current UX audit and the
> 2026-09-12 fix reports for remaining browser/server follow-up; the design
> decisions below remain the product contract.

> **Current status (2026-09-12).** The three-tab rail, Cash HUD entry point,
> Wallet & Items shell, modal neutrality, and panel controls are live. Wallet
> Account/Items is currently a read-only rendering shell: `summaryApi` does not
> project item, airport, prediction, or bank-tier mutation state, and
> `main.js` does not inject `handleItemAction` or `upgradeBankAccount`. Keep
> `USE`, `TRADE`, `EXCHANGE`, `SELL`, and `UPGRADE ACCOUNT` as future server
> contracts until those verbs and viewer-scoped projections ship. The current
> implementation evidence is `public/clientWalletUi.js:1-5,81-106`,
> `server/summaryApi.js:40-84`, and `public/main.js:945-951`.
> The purchase dismissal and turn-timer contracts are separate shipped fixes:
> scrim/Escape closes the normal purchase neutrally, and the visible countdown
> continues through turn-owned resolution while the server deadline is live
> (`docs/audit/fix-transaction-ui-batch-2026-09-12.md`).

## Product read and design direction

**Design read:** the board is a shared table, while the right rail is a
personal ledger. The board must remain the visual anchor; the rail should stay
quiet until an action is available. A modal is a workbench for one decision,
not a second page.

**Direction:** *Ledger Night Market*, continued from
`.ulpi/design/DESIGN.md` and `NEW-GAME-SYSTEMS-PLAN.md`. New surfaces use the
same dark teal terminal panels, gold structural rules, red primary action,
Pixelify/mono typography, compact square geometry, and pixel-art marks. No
glassmorphism, gradients, pill-heavy controls, emoji icons, nested card stacks,
or new component library.

The design preserves the existing two side rails, center board, bottom HUD,
topbar utilities, internal scrolling, live regions, focus restoration, and
reduced-motion behavior. The change is information architecture, not a new
visual world.

## Historical pre-implementation baseline (superseded)

The following description records why the rail refactor was commissioned. It
is not a description of the current UI; future readers should use the three-tab
IA below and the current-status banner above.

Before the reset, the right rail exposed six equal tabs:

```text
MY DEEDS | TRADE | LOG | FINANCE | CASINO | MARKET
```

The labels mix four different jobs:

- owned assets;
- negotiations and debt obligations;
- passive history;
- optional, form-heavy activities.

Finance itself contains incoming contracts, outgoing contracts, active loans,
equity, hybrid deals, bank credit, repayment controls, and a send action.
Market adds order quantity, risk metrics, margin, shorting, and derivatives.
Casino adds a stake form and outcome history. Six tabs therefore understate the
actual number of decisions and make the narrow rail feel like a control panel.

The Event Log already has a topbar button and a dedicated drawer, so its rail
tab is a duplicate entry point. `MANAGE PORTFOLIO` is useful only if it opens a
real manager; if it merely re-selects My Deeds, it is a redundant footer
button and should be removed.

## Recommended information architecture

Keep the three-column game shell:

```text
┌──────────────┬──────────────────────────────┬────────────────┐
│ PLAYERS      │                              │ HOLDINGS       │
│ CHAT         │            BOARD             │ DEALS          │
│              │                              │ ACTIVITY       │
├──────────────┴──────────────────────────────┴────────────────┤
│                         TURN HUD                              │
└───────────────────────────────────────────────────────────────┘
```

Replace the six-tab rail with three intent-based tabs:

```text
HOLDINGS | DEALS | ACTIVITY
```

### HOLDINGS

The player's assets and immediate personal inventory.

Sections:

1. `DEEDS`: owned properties, rent/build/mortgage affordances, and the
   existing deed detail modal.
2. `ITEMS`: Surprise/Treasure items, quantities, rarity, and available actions.
3. `ACCOUNT`: a compact tier/cashback status line with `OPEN WALLET`.

Items appear here because they are owned assets, but their full details and
actions open in the shared `WALLET & ITEMS` modal. This avoids hiding items in a
new top-level tab while keeping the rail scannable.

`MANAGE PORTFOLIO` remains only when it opens a real deed-management action. If
it only switches back to HOLDINGS, remove the footer button and let the deed
rows open the existing manager directly.

### DEALS

One place for every player-to-player or bank obligation:

- incoming trades;
- outgoing trades;
- player loans;
- equity and hybrid agreements;
- bank credit and repayment;
- active obligations and due dates.

Use three compact subfilters, not more top-level tabs:

```text
NEEDS YOU | ACTIVE | OUTGOING
```

The existing unified deal projection drives every row. Rows remain collapsed
for scanning and open the existing read-only Deal Details modal. The bottom
action is `SEND DEAL`, which opens the existing builder. Bank repayment stays
visible as an urgent row when due, but its full schedule is expandable.

### ACTIVITY

Optional, high-complexity systems that do not belong beside deeds and debt.

Use a small internal mode switch:

```text
INDEXES | PREDICTIONS | CASINO
```

- `INDEXES` shows the simple market quote/position summary.
- `PREDICTIONS` shows open, locked, won, lost, and refunded tickets.
- `CASINO` shows the current disclosed odds, last result, and a single bet
  entry point.

Advanced market controls do not render permanently. `OPEN MARKET DESK` opens
the focused Market Order modal for margin, shorting, or options. A prediction
uses a ticket-confirmation modal so the player sees stake, fee, probability,
lock round, and maximum profit before committing. Casino uses a confirmation
step for high-stakes wagers and a settled-result modal for the carousel.

### Event Log

Remove `LOG` from the rail. The topbar `LOG` button and existing Event Log
drawer become the one canonical history surface. The drawer can remain open
over the game and continues to use its existing filters. The rail may show a
small unread count near the topbar button, but not a second log list.

## Wallet and Items modal

### Entry points

The canonical entry point is the existing `Cash On Hand` cell in the bottom
HUD. Make the content area a semantic button while preserving its current
visual size and placement. Pressing it opens `WALLET & ITEMS` without changing
the URL, leaving the lobby, or hiding the board context.

Secondary entry points:

- `OPEN WALLET` in the HOLDINGS account summary opens the `ACCOUNT` view;
- `OPEN ITEMS` in the HOLDINGS item subsection opens the `ITEMS` view;
- a prison or airport flow may deep-open the relevant item/account view only
  when the current decision explicitly needs it.

All entry points use the same modal instance and return focus to the exact
control that opened it.

### Modal structure

```text
┌─────────────────────────────────────────────┐
│ WALLET & ITEMS                         CLOSE │
│ [ACCOUNT] [ITEMS]                            │
├─────────────────────────────────────────────┤
│ active view with one clear primary action    │
│                                             │
│                                           │
└─────────────────────────────────────────────┘
```

The modal is one focused workbench with two internal views. It is not a modal
inside a modal. Its body scrolls internally when the inventory grows; the game
page never becomes scrollable.

#### ACCOUNT view

The target contract shows, in this order:

1. current cash and reserved cash;
2. current bank tier and a short benefit summary;
3. next tier cost, remaining round cashback cap, and eligible fee types;
4. `UPGRADE ACCOUNT` as the one primary action when legal;
5. the latest five wallet ledger entries as read-only context.

Current release behavior is the shell subset: cash, reserved cash, the
standard/account-tier copy, and any projected ledger entries render when the
snapshot supplies them. No upgrade control is rendered because the client has
no injected `upgradeBankAccount` server seam yet.

#### ITEMS view

The target contract shows compact inventory rows with:

- pixel-art item glyph;
- item name and rarity;
- quantity and uses remaining;
- source round/type when available;
- `USE`, `TRADE`, `EXCHANGE`, or `SELL TO BANK` only when legal.

Selecting an item reveals its bounded effect and sell value in the same modal.
`TRADE` hands the item leg to the existing Deal Builder through a reversible
modal step. It does not silently send a deal.

Current release behavior is an empty/read-only shell: the game summary does not
yet include viewer-scoped `items`, and `main.js` does not inject an item-action
handler. Therefore no item mutation is advertised as live by this surface.

### Bank upgrade interaction

The flow below is the target contract and remains pending the server verb and
projection work described in `NEW-GAME-SYSTEMS-PLAN.md`.

```text
Press Cash On Hand
        │
        ▼
WALLET & ITEMS → ACCOUNT
        │
        ▼
UPGRADE ACCOUNT
        │
        ▼
Inline confirmation preview
        │
        ├── Confirm → server validates and settles atomically
        └── Cancel  → return to Account with no mutation
```

The confirmation preview states the cost, new tier, eligible benefits, round
cap, and remaining cash. It warns when an active global event pauses a benefit.
The server rechecks current seat, tier, cash, obligation state, event state,
and idempotency. On success, the modal, HUD, and rail update from the same
summary projection. On failure, an inline error stays in the modal and focus
returns to the upgrade control.

### Why items belong beside money

Yes, this is the sensible grouping. Both are private, owned, round-scoped
resources and both answer “what can I spend or use right now?” The grouping
also prevents three bad alternatives:

- an extra `ITEMS` top-level tab that increases rail density;
- hiding item actions inside the Surprise card after the reveal disappears;
- putting account upgrades in Profile, where the player expects persistent
  identity settings rather than in-round cash decisions.

The rail keeps a quick inventory summary. The Cash button gives a predictable
single place for the complete wallet and item workbench.

## Modal strategy for better in-game UX

Use a modal when the decision needs explanation, several fields, or a
server-confirmed irreversible action. Keep a rail row when the player needs a
persistent reminder or a quick status glance.

| Task | Compact rail surface | Focused modal |
| --- | --- | --- |
| Deed | deed row and rent/build status | existing Deed Details/House Manager |
| Trade or contract | collapsed deal row and status | existing Deal Details and Deal Builder |
| Bank loan | due/active summary | Wallet Account view and repayment controls |
| Account upgrade | tier badge and next-cost hint | Wallet confirmation step |
| Items | quantity and available-action hint | Wallet Items view and item details |
| Market | quote, position, and risk summary | Market Order Desk for advanced actions |
| Prediction | ticket state and lock round | Prediction ticket confirmation |
| Casino | odds and last result | high-stakes confirmation/result reveal |
| Airport | landing choice summary | existing Travel choice modal |
| Prison | fine/card availability | existing Prison decision path |
| Global event | center banner and affected-system strip | only when the event has an explicit vote/choice |
| History | unread count in topbar | existing Event Log drawer |

### Modal rules

- One primary action per view. Secondary actions are visually subordinate.
- Scrim, Escape, and close dismiss without accepting, declining, paying, or
  cancelling anything unless the user explicitly chose that action.
- Do not stack two full modals. Move between steps inside one modal and show a
  clear `BACK` action.
- Keep the board and turn metadata visible around the modal at desktop widths;
  use a full-height sheet only on small screens.
- If another player changes a deal or an event settles while a modal is open,
  update the view in place and show a visible `UPDATED` status line.
- If the session expires, preserve the read-only content, disable mutations,
  and offer one `RECONNECT` action.
- If an action becomes stale, explain what changed and return to the current
  read-only state rather than closing the entire flow.

## State model

The client keeps a small surface stack, separate from GameState:

```js
{
  railTab: 'holdings' | 'deals' | 'activity',
  railFilter: 'needs-you' | 'active' | 'outgoing' | null,
  activityMode: 'indexes' | 'predictions' | 'casino',
  modal: null | 'wallet' | 'deed' | 'deal-detail' | 'market-desk' |
    'prediction-ticket' | 'casino-result',
  modalStep: 'account' | 'items' | 'confirm' | 'details',
  returnFocusId: string | null,
  pendingRequestId: string | null
}
```

Server data remains authoritative. The rail and modal subscribe to the same
summary projection, so closing a modal never loses a pending deal, item, or
account state. Rendering is event-driven, not a per-frame poll.

## Flows and states

### Wallet flow

**Entry:** Cash HUD button, `OPEN WALLET`, or a legal account prompt.

**Loading:** show the existing shell with a short `READING LEDGER` status;
disable mutation controls only.

**Empty:** Standard account plus “No items held this round.” Do not imply an
error or add a dead call-to-action.

**Success:** update cash, tier, cap, and item counts atomically; announce a
concise result in the live region.

**Error:** keep the modal open, show an inline reason, and focus the failed
control. Retry uses a new idempotency key only when the prior request is known
not to have settled.

**Dismiss:** close without mutation and restore the opening control.

### Items flow

**Use:** preview the bounded effect when it could affect a choice; explicit
confirm only for a destructive or irreversible use. A normal use updates the
row in place.

**Trade:** preserve the item leg while moving to the Deal Builder. Back returns
to the selected item.

**Exchange:** show exact inputs and outputs from the server recipe. Never accept
a client-supplied effect or price.

**Sell:** show the fixed bank value and a final `SELL TO BANK` action. A stale
inventory response disables the action and refreshes the item row.

### Activity flow

The rail shows a low-density summary. A modal owns advanced work:

1. choose an index, prediction, or casino action;
2. enter only the fields relevant to that action;
3. show fee, cash impact, risk, lock/settlement timing, and event modifiers;
4. confirm once;
5. settle from the server and mirror the result in the rail.

No activity modal may interrupt a pending payment, auction, deal acceptance,
bankruptcy decision, or current-turn guard.

## Responsive layout

### Desktop at 1920×1080

- Keep the current three-column proportions and right rail near its existing
  width; do not widen the rail to compensate for bad information architecture.
- Render three clear rail tabs with labels, not six compressed labels.
- Wallet and advanced activity modals use a readable 560–720px workbench,
  leaving the board silhouette visible behind the scrim.
- The right rail body scrolls internally. The page and board shell do not move.

### Tablet and narrow desktop

- The rail can become an anchored overlay opened by the existing panel control.
- Keep the same three-tab order and state; do not create a second tablet IA.
- Modal forms collapse to one field group at a time, with no more than four
  visible fields before progressive disclosure.

### Mobile

- Convert the rail to a bottom sheet with `HOLDINGS`, `DEALS`, and `ACTIVITY`.
- The active sheet has a bounded internal scroll region and respects safe-area
  insets. The board remains zoomable/pannable according to the existing policy.
- Wallet becomes a full-height sheet with the same `ACCOUNT`/`ITEMS` views.
- All controls remain at least 44px high with visible focus and touch feedback.

## Accessibility and motion

- Use native `button`, `dialog`, `tablist`, `tab`, and `tabpanel` semantics.
- The active rail tab owns `aria-selected` and `aria-controls`; the body uses a
  matching `aria-labelledby`.
- Modal open traps focus, announces its title and current step, and restores
  focus on close. Escape dismisses without mutation.
- All status colors have text labels or icons; rarity, debt, and event state
  are never color-only.
- Cash, balances, prices, and round numbers use tabular numerals.
- Rail changes and server results use one polite live region. Errors use an
  assertive region only when the player must act immediately.
- Rail tab changes use a 120ms stepped/ease-out opacity and 3–4px translation.
- Modals enter over 140–160ms with opacity and transform only. The confirmation
  step uses a short 100ms in-place transition.
- No bounce, elastic scale, or indefinite decorative motion. Reduced motion
  removes travel and transition effects while retaining state changes.

## Server and projection boundaries

The sidebar is presentation, not a second rules engine:

- The target `summaryApi` contract returns viewer-scoped holdings, items,
  account tier, deals, market positions, predictions, and casino status.
- Existing server actions remain authoritative for the shipped trade, loan,
  repayment, market, prediction, and wager paths. Item use/trade/exchange/sale
  and bank-account upgrade verbs remain planned until their handlers and
  projections exist.
- Each mutation has an idempotency key and rechecks current seat, obligations,
  cash, ownership, event modifiers, and ruleset digest.
- Opponent views never expose hidden inventory, private prediction strategy, or
  private contract terms.
- Telemetry records surface opens, action attempts, success/failure, and timing
  without storing private content.

Current evidence: `server/summaryApi.js:40-84` exposes owner-scoped market
positions but no item, airport, prediction, or bank-account projection;
`public/main.js:945-951` configures Wallet with rendering/request helpers only.
Treat the target item/account rows above as a future contract, not as proof
that those mutations are available in the current round.

## Implementation slices

1. **Shipped:** replace the six-tab IA with `HOLDINGS`, `DEALS`, and
   `ACTIVITY`; remove the duplicate Log tab and make the real Event Log drawer
   canonical.
2. **Shipped shell:** add the Cash HUD semantic button and `WALLET & ITEMS`
   modal shell with focus restoration and Account/Items views.
3. **Pending:** add viewer-scoped item projections, item mutation verbs, and
   item trade handoff to the existing Deal Builder.
4. Merge Trade and Finance rendering into Deals with the three subfilters,
   preserving the existing unified deal state and viewer-specific redaction.
5. Add Activity mode switching and move advanced Market/Prediction/Casino work
   into focused modals without changing server settlement.
6. Remove or repurpose `MANAGE PORTFOLIO` based on whether it performs a real
   manager action.
7. **Pending:** add bank-account upgrade projection/verb, then run the full
   stale/error/offline/session-expiry and browser accessibility QA matrix.

Every slice stays a reversible PR. Disabling the new client IA returns to the
existing rail projection without changing game rules or persisted data.

## Verification gates

### Functional

- Six old tabs are not rendered; the three new tabs render at every game state.
- Log opens only through the topbar drawer.
- Cash HUD opens Wallet and Items opens the same modal on the Items view.
- **Future contract:** account upgrades must settle once, update every surface,
  and cannot run during an obligation.
- **Future contract:** item use, trade, exchange, and bank sale must preserve
  server guards; the current shell exposes no item mutation handler.
- Deals remain pending after close and refresh in place after a remote change.
- Activity modals never choose or settle outcomes on the client.

### Visual

- Capture Home, a live round, Wallet Account, Wallet Items, Deals, Market Desk,
  Prediction Ticket, and Casino Result at 1920×1080.
- Confirm unchanged Poorup fonts, colors, borders, tile dimensions, topbar,
  left rail, center board, and bottom HUD footprint.
- Confirm no page scroll, clipped labels, unreadable body text, or compressed
  tab labels at 1366×768, 1024×768, and 390×844.

### Design pre-flight

- Identity lock: all values come from `DESIGN.md`; no new visual system.
- Anti-slop: no gradients, generic SaaS cards, pill navigation, emoji, or
  decorative motion.
- State coverage: loading, empty, success, error, stale, offline, and expired
  session are specified for every mutation surface.
- Accessibility: focus, ARIA, live regions, reduced motion, safe areas, and
  44px controls are specified.
- Cognitive load: three top-level rail tabs, three Deals filters, three Activity
  modes, and one primary action per modal view.

The design-spec gate passes on paper. Implementation still requires the
1920px visual evidence and browser test evidence listed above before release.

## Explicit non-goals

- No second right rail, second rules engine, or new top-level page for every
  economy system.
- No permanent advanced market form in the narrow rail.
- No page navigation when viewing a player, deal, item, bank tier, or activity.
- No automatic accept, decline, repayment, item sale, or wager on modal close.
- No new payment or real-money shop surface.
- No changes to Classic board dimensions, tile order, or server settlement.
