# Client/legal follow-up report

## Scope

Follow-up implementation for the client/legal review findings in `task-client-review-report.md`. The parent-owned `server/server.js` route mounting and other integration work were not changed.

## Implemented

- Added 24px footer-link hit areas using negative block margins; Home ticker geometry remains effectively unchanged at desktop and mobile widths.
- Propagated opener elements through rail trade, deed, deal-detail, financing, and trade-negotiation surfaces. Nested deal editors retain the original opener for close restoration.
- Made cross-tab sign-out clear account-derived profiles, drafts, achievements, social state, selected-player state, and the signed-in player projection. It also resets audio state/buttons and removes any guest save recreated by a live render while preserving unrelated-origin storage keys.
- Added deduplicated audio live-state handling for ready, blocked, media error, stalled, and ended states. Gesture retries are bounded and successful retry restores the canonical “Turn parlor music off” label.
- Reset game-over/turn guards on a fresh `started` transition so rematches with round number 1 are handled as new games.
- Re-normalized client and server metadata renderer inputs so invalid supplied origins cannot emit caller-provided canonical or social URLs.

## Regression coverage

Red phase: the new footer/modal/audio/rematch source contracts and invalid precomputed-origin assertions failed before the follow-up implementation. The cross-tab, surface-focus, and rematch tests then passed against the implemented seams.

Focused unit tests:

```text
node public/clientLegalFollowups.test.js
node public/clientCrossTabSignout.test.js
node public/clientStateSync.test.js
node public/clientSurfaceFocus.test.js
node public/clientDocumentMeta.test.js
node server/metadata.test.js
```

All passed. All `public/*.test.js` files passed.

Browser checks:

```text
npx playwright test -c qa/playwright.config.js qa/legal-links.spec.js qa/client-legal-followups.spec.js --project=mobile-390 --project=desktop-1920 --grep "usable hit target|music retry|music ended"
```

6 passed across mobile-390 and desktop-1920. The browser fixture verifies 24px legal targets, bounded retry announcements, distinct media error/stalled/ended copy, and ready-state label restoration.

Lint and diff checks:

```text
npm run lint:client -- --quiet
npm run lint -- --quiet
git diff --check
```

All passed with exit code 0.

## Remaining parent gate

The review’s P1 server wiring finding remains intentionally pending: `server/legalRoutes.js` and `server/metadata.js` are available, but mounting them in `server/server.js` is parent-owned integration work outside this lane.
