# Transaction UI fix batch — 2026-09-12

## Scope

Implemented the approved Batch 2 client transaction/UI fixes from the
2026-09-11 UX and codebase audits. The work stays on the vanilla client and
preserves existing Poorup surface IDs, modal stack behavior, and server socket
payload contracts. No server files, `public/styles.css`, or `public/index.html`
were changed by this batch.

## Findings fixed

- Normal purchase Escape and backdrop dismissal are now neutral. They close the
  card while retaining the pending purchase; only the visible PASS action emits
  `decline-property`.
- The shared focus trap excludes disabled controls and descendants of native
  `[hidden]`, `.is-hidden`, and `aria-hidden="true"` containers, preventing
  closed dropdown options from entering Tab order.
- Auction snapshots reuse the existing card shell for the same tile, patch live
  values in place, preserve a focused bid/pass control, and announce meaningful
  bid/leader changes through a polite live region.
- Player-loan previews now derive collateral copy from the selected collateral:
  `UNSECURED LOAN` has no deed claim, while `SECURED LOAN · <deed>` is shown only
  for an eligible selected deed. Active contract title/copy and negotiation
  preview use the same distinction.
- Modal repayment now sends a positive amount clamped to the displayed
  remaining balance and reports the authoritative settled amount in chat and a
  modal status region.
- The turn timer remains visible for the human player through resolution and
  End Turn states while the server deadline is live. A decisecond visual timer
  is paired with once-per-second polite screen-reader updates.
- Open Event Log content refreshes during `renderAll()` without forcing a reader
  away from a non-bottom scroll position; a live “NEW ENTRIES AVAILABLE” status
  appears when appropriate.
- Social, ranking, and season requests now have request IDs, bounded 8-second
  timeouts, actionable retry states, and stale-snapshot copy. Search responses
  are race-safe and show a bounded loading/error state.
- Social/friend/invite/history/read/block/report controls now prevent duplicate
  clicks, expose `aria-busy="true"` with `PROCESSING…`, time out visibly, recover
  from failures, and refresh successful mutations from an authoritative social
  snapshot.

## Red–green evidence

Following the requested TDD loop, `public/clientTransactionUi.test.js` was grown
one behavior at a time. Each new assertion was run before its corresponding
implementation and failed (0/1 for the new slice), then the minimal behavior
change was applied and the focused test returned green. The final focused run
contains 9 passing assertions:

```text
node public/clientTransactionUi.test.js
client transaction UI tests: 9 passed, 0 failed
```

The test covers purchase dismissal, hidden focus filtering, auction shell/live
status, secured/unsecured loan copy, bounded repayment/status, timer behavior,
live log refresh, bounded social/rankings/season requests, and pending/stale
social actions.

## Changed files

- `public/clientGameModalsUi.js`
- `public/clientKeyboard.js`
- `public/clientSurfaces.js`
- `public/clientAuctionUi.js`
- `public/clientTradeUi.js`
- `public/clientHudRender.js`
- `public/clientLogDrawer.js`
- `public/clientSocialSurfaces.js`
- `public/clientParlorBindings.js`
- `public/main.js` — invokes the log renderer during an open-surface snapshot
  refresh.
- `public/clientTransactionUi.test.js`

## Verification

```text
npm run lint:client                         PASS (0 errors, 0 warnings)
node public/clientTransactionUi.test.js    PASS (9/9)
node public/clientUxContracts.test.js      PASS (6/6)
node public/clientTheme.test.js            PASS (6/6)
git diff --check                            PASS
impeccable detect --json <changed targets>  PASS (no findings: [])
```

Per the task handoff, the full server/integration suite and browser/device
matrix were intentionally not run in this focused client turn.

## Intentionally deferred

- Portrait-mobile board/action ordering and sticky action bar (P1-7) requires
  layout/style changes and is outside this batch’s allowed `styles.css` scope.
- Touch multi-cell profile painting (P2-1) belongs to the profile bindings and
  was not part of the assigned transactional surfaces.
- Long global-event banner wrapping (P2-6) requires `styles.css`/event-surface
  scope.
- Server findings in `agent-codebase-bugs-2026-09-11.md` remain owned by the
  server batch; no server implementation was changed here.
- Browser two-client timing/focus verification remains a follow-up because the
  focused Node client contracts do not provide a real DOM/socket runtime.
