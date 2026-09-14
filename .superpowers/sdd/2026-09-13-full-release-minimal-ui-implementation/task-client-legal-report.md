# Client, legal, and metadata workstream report

Base source: `151b480` (development branch).

Workstream commit: `7018994` (`feat: add legal metadata and client recovery shell`).

## Scope completed

- Replaced only the Home ticker's no-account-required segment with three compact anchors to `/legal#privacy`, `/legal#terms`, and `/legal#support`; the account-entry signal remains unchanged.
- Added a static, JavaScript-free legal shell for Privacy, Terms, Support, and Licenses plus a route module that serves `/legal`, canonical documents, `/legal/*` aliases, and an allow-listed `/acceptable-use` redirect. Legal copy, operator identity, and dates remain explicit copy-injection slots.
- Added client and server metadata helpers with fail-closed no-origin behavior, private-route noindex defaults, canonical/social tags only when an approved origin exists, and fixed 1200x630 preview dimensions without creating the gated image.
- Added the per-view title/live-announcement helper, local-storage ownership clearing, cross-tab sign-out reconciliation, stale restore classification, modal trigger propagation, popup overscroll containment, reduced-motion auction timer behavior, room-code paste feedback, semantic input attributes, and audio gesture/error state.
- Added hidden, disabled-by-default account data-rights controls. No destructive account endpoint or server route was exposed.

## Verification evidence

Focused red phase:

- Missing `clientDocumentMeta.js`, `legalRoutes.js`, and `metadata.js` produced the expected module-not-found failures.
- The interaction regression fixture first failed on the missing explicit session-invalidation classifier and new-round game-over reset; both then passed after the minimal implementation.

Focused green tests:

```text
node public/clientDocumentMeta.test.js
node public/clientInteractionRegression.test.js
node server/legalRoutes.test.js
node server/metadata.test.js
```

All four passed. All existing `public/*.test.js` files passed (client suite: 12 test files, 91 reported checks where applicable).

Lint:

```text
npm run lint:client
npm run lint -- --quiet
```

Both passed with exit code 0.

Browser evidence:

- `qa/legal-links.spec.js` and `qa/metadata.spec.js`: 6 passed at desktop-1920 and mobile-390.
- 2 JavaScript-disabled legal-document checks remain blocked until the parent mounts `server/legalRoutes.js` in `server.js`; the expected failure was `/privacy` resolving to the current fallback shell.
- Existing `qa/poorup.spec.js` at desktop-1920 and mobile-390: 21 passed, 9 intentional project skips.

Impeccable mechanical detector:

```text
node C:\Users\jerem\.codex\skills\impeccable\scripts\detect.mjs --json public/index.html public/styles.css public/legal/privacy.html public/legal/terms.html public/legal/support.html public/legal/licenses.html public/clientDocumentMeta.js
```

The detector ran once and returned no regex findings, but reported degraded parser dependencies (`htmlparser2`, `css-select`, `css-tree`, and `domutils` unavailable). It is not treated as a clean computed-style audit.

## Pre-commit file hashes

```text
public/index.html 061069d259b45691ff2385386b4e1e760c9e21df
public/styles.css 8f62e907b4197139992ea0978e51a451d7b9ab93
public/clientSurfaces.js 5a503904a7801191d67fd2878b400f548dc4e5cc
public/clientStateSync.js 9d42aa9d5b089e03decf6c7d5316770d90608ac0
public/clientHomeEntryBindings.js 35b595a07a261cd6497d5e8c7663f458fe91e9d4
public/clientSocketListeners.js 52c3619e106c2edf9c429b14191ba0cdcb04ad8c
public/clientSanitize.js e824f3ffedbe5062ed17e4e9bff360bd3a94e9c6
public/clientAccountIdentity.js 314bb11c3a724220fcaa842d67e07ff2aa5d0466
public/main.js 97814fbecb43c969f60e49b31f1a279d548edf34
public/clientDocumentMeta.js 70adeca93d4ab1377d48c5bcfe8a887107d3a92f
public/clientDocumentMeta.test.js ed947a8b63ce4a70f67e267cd8e9d73c19aa6351
public/clientInteractionRegression.test.js 002eae56d336c1b74e94e2aab3ad2c7d2df17ad
public/legal/privacy.html ff8001aa6aebf5a3bcf915cfd8785a86eca15703
public/legal/terms.html 115c02250930e6f9188c7d4bf2c99ab9f74700c3
public/legal/support.html 95ae39d8cb96aa91c13f012643467ccca6399da4
public/legal/licenses.html 48d6585ce4a2a3409a0cc2c71846e07fb4203c80
server/legalRoutes.js 8a679535859502324874108d3f0adb08cf16489f
server/legalRoutes.test.js 8e2b224e5a44aca515ff1bfe4d758846d82d4e9f
server/metadata.js 11841d62786d1694e048a2c7ae093cf1bdcb1429
server/metadata.test.js 259a8063c9500fdfe581d7b6a96c3355aec9b862
qa/legal-links.spec.js 9b71a194fe2b0d0029807e4a553a5001b0a38c08
qa/metadata.spec.js df2bca933b9fd1695152f7416de0deed4bc4e8e9
```

## Blocked owner gates

- Gate 13: approved legal notice, terms, support/operator identity, and last-updated values are not supplied. The pages intentionally retain copy-injection hooks.
- Gate 14: canonical production origin, index policy, social description, and approved 1200x630 artwork are not supplied. No OG image was created.
- Gate 12: account deletion/export/revoke policy is not approved. Controls remain hidden and disabled, and no mutation endpoint is exposed.
- Parent integration: mount `createLegalRouter` and `createMetadataRouter` in `server.js` after review. `server.js` was intentionally not edited in this workstream.
