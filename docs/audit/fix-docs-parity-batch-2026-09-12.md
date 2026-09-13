# Documentation parity fix batch — 2026-09-12

## Scope and status

This batch implements the documentation-only portion of the approved Markdown
parity audit. It preserves every document, updates stale status/contract text,
and adds one standalone machine-readable manifest. No `server/`, `public/`, or
QA production code was edited by this batch; the source and test references
below describe the adjacent 2026-09-12 server and transaction-UI fixes already
present in the shared working tree.

Source audit: `docs/audit/agent-md-parity-brainstorm-2026-09-11.md`.
Implementation evidence: `docs/audit/fix-server-batch-2026-09-12.md` and
`docs/audit/fix-transaction-ui-batch-2026-09-12.md`.

## Changed documents and evidence

| Document | Current-status/parity change | Evidence or canonical decision |
| --- | --- | --- |
| `.ulpi/design/QUICKPLAY-BOTS-TRADING-SOCIAL-PLAN.md` | Quick Table is explicitly a target, not a shipped auto-join; live behavior is create-new public Standard-40. The superseded Profile `FRIENDS` tab proposal is retained as history; Social hub is canonical. | `public/clientLobbyUi.js:805-818,607-617`; `docs/plans/friends-and-player-social-plan.md:8-20`; no directory/race test exists yet. |
| `.ulpi/design/RULESETS-SEASONS-MARKET-PLAN.md` | Added current transition/acknowledgement/market status; corrected `rulesetOverrides` schema; marked `marketComplexity` live and documented 25% margin collateral plus the shared one-action quota. | `server/rooms.js:118-131,276-310,442-449`; `server/marketExpansion.js:81-153`; `server/rulesetRegistry.test.js`; `server/marketExpansion.test.js`. |
| `.ulpi/design/FINANCE-RAIL-UX-PLAN.md` | Relabeled six-tab text as a superseded baseline; identified Wallet/Items as a read-only shell pending projections/verbs; retained target mutation contract; recorded neutral dismissal and timer fixes. | `public/index.html:729-775`; `public/clientWalletUi.js:1-5,81-128`; `server/summaryApi.js:40-84`; `public/main.js:945-951`; transaction-UI report. |
| `docs/plans/IN-GAME-UX-IMPLEMENTATION-PLAN.md` | Added current status and implementation evidence; relabeled old six-tab/display-only/FOCUS evidence as historical; recorded `PANELS` as the sole visibility menu; split Wallet shell from pending mutations and portrait-mobile follow-up. | `public/index.html:572-591,729-775`; `public/clientPanelMenu.js`; `public/clientTransactionUi.test.js`; `public/clientUxContracts.test.js`. |
| `.ulpi/design/NEW-GAME-SYSTEMS-PLAN.md` | Added an explicit unreleased status for Items, Predictions, Airport Travel, Bank Accounts, and Lawyer Card; target UI/API wording now says pending projections/verbs. | `server/summaryApi.js:55-84`; `public/main.js:945-951`; no item or bank-account handlers are registered. |
| `docs/plans/casino-market-global-events-plan.md` | Reconciled basic-market history with the live staged `MARGIN`/`SHORTING`/`DERIVATIVES` contract; documented 25% margin collateral and one explicit action per turn; clarified `LIVE` versus `PLANNED` Rules copy. | `server/marketExpansion.js:4-14,81-123,137-216`; `server/economyApi.js:350-476`; `server/marketExpansion.test.js`. |
| `.ulpi/design/THEME-FIVE-VISUAL-BRAINSTORM.md` | Replaced the stale all-assets `320×180` statement with the mixed master contract: scene/cloud/petals and Light pedestrians `640×360`, compact props `320×180`. | `public/assets/themes/**`; `public/themeAssetAudit.test.js:27-34`; `public/clientThemeRender.js:28-47`. |
| `docs/design/figma-theme-worlds-2026-09-11.md` | Added a current-status banner making the Figma `640×360` world masters and mixed runtime dimensions explicit. | Figma handoff layer table and `public/themeAssetAudit.test.js`. |
| `.ulpi/design/NIGHT-SHIFT-MICROGAME-PLAN.md` | Corrected entry chord to `SHIFT+P` primary; retained `CTRL+P` only as browser-dependent compatibility. | `public/index.html:100-105`; `public/clientKeyboard.js:62-80`; `public/assets/parlor-patrol/README.md:11`. |
| `docs/plans/global-leaderboards-plan.md` | Updated status to include seasonal claims; added `THIS SEASON` and `30 DAYS` scopes and the current 15-metric registry; marked the old first-release/future-rewards wording shipped. | `public/clientSocialSurfaces.js:541-560,603-627,698-707`; `server/serverSocketSocial.js:171-209`; leaderboard/season tests. |
| `docs/plans/friends-and-player-social-plan.md` | Added an explicit IA banner: top-level `SOCIAL` owns relationships; Profile has no Friends tab. | `public/index.html:33-50,375-382`; current Social surface. |
| `docs/audit/agent-codebase-bugs-2026-09-11.md` | Added a superseded banner and marked all six pre-fix findings resolved by Server Batch 1, including rejected host-setting acknowledgements. | `docs/audit/fix-server-batch-2026-09-12.md`; current server tests. |
| `docs/audit/agent-ux-review-2026-09-11.md` | Added a resolution ledger for P1-1..P1-6 and P2-2..P2-4; retained open mobile/touch/heading/event-copy findings as follow-up. | `docs/audit/fix-transaction-ui-batch-2026-09-12.md`; `public/clientTransactionUi.test.js`. |
| `docs/audit/agent-ui-review-2026-09-11.md` | Clarified that `FOCUS` is intentionally absent and replaced by `PANELS`; kept viewport findings as dated evidence. | `public/index.html:575-591`; `public/clientPanelMenu.js`. |
| `docs/audit/agent-md-parity-brainstorm-2026-09-11.md` | Added a superseded/current-status banner and current bottom line so resolved rows do not reopen; recorded Global Events warning/tier mismatch as a separate deferred decision. | Both 2026-09-12 fix reports; current source/test references in the audit. |
| `docs/audit/markdown-feature-parity-2026-09-11-theme-reset.md` | Added a superseded banner and reclassified the reset inventory as historical provenance; linked the current parity audit/report. | Current parity audit and this report. |
| `docs/plans/END-TO-END-AUDIT-CS2-ROULETTE-PLAN.md` | Added a superseded/current-status banner to distinguish its dated resolution table from the newer server/transaction evidence, including market rows. | `docs/audit/fix-server-batch-2026-09-12.md`; `docs/audit/fix-transaction-ui-batch-2026-09-12.md`. |
| `SHOWCASE.md` | Aligned the live-demo URL with `README.md` and removed stale Render free-tier spin-down instructions. | Canonical URL: `https://poorup.jeremy-d.hackclub.app/`. |
| `docs/audit/docs-parity-manifest-2026-09-12.json` | Added a standalone 12-entry manifest covering status, owner, server verbs, client entry points, tests, docs, evidence, and residuals for the audited surfaces. | Validated with the JSON parse command below; intentionally not wired into `package.json`. |

## Classified residual feature gaps

> **Follow-up update (2026-09-12).** Quick Table's P1 residual was resolved
> after this report by the lobby flow in `public/clientLobbyUi.js` and its
> `public/clientQuickTable.test.js` contract. The historical findings below
> remain useful for the other staged features; they are not a claim that
> Quick Table is still incomplete.

### Open product/code gaps (documented, not changed here)

1. ~~**Quick Table auto-join (P1).**~~ **Resolved in follow-up.** The live
   button now ranks the public directory, joins a compatible open room, retries
   a raced join twice, and falls back to `create-room`; see
   `public/clientQuickTable.test.js`.
2. **Wallet/Items mutations (P1/feature staging).** The modal and Holdings
   entry points are present, but the summary has no item/airport/prediction/
   bank-account projection and `main.js` injects no item or bank-upgrade action
   handler. `USE`, `TRADE`, `EXCHANGE`, `SELL`, and `UPGRADE ACCOUNT` remain
   target verbs, not available gameplay.
3. **Global Events warning/tier sequencing (P2).** The current implementation
   derives limited duration branches and can enter voting directly for events
   with choices, while the plan specifies event tiers and a warning before every
   negative event. This needs a product decision plus code/tests; it is outside
   this docs-only batch.
4. **Portrait/mobile game composition (P1 UX follow-up).** The transaction batch
   did not alter the layout/style scope; board/action ordering and compact mobile
   recovery remain open in the UX audit.
5. **Remaining UX/a11y follow-up (P2).** Touch face painting, page-level H1
   hierarchy, long event-summary wrapping, ambient pause, and visual target-size
   polish remain open where the dated audits say so.

### Resolved in adjacent 2026-09-12 implementation batches

The documentation now points to evidence for ruleset transitions, rejected
setting acknowledgements, contract relay delivery, `payEach` shortfall debt,
market collateral/quota, annotated match-history persistence, neutral purchase
dismissal, timer-through-resolution, hidden-dropdown focus, auction focus,
loan-copy/repayment parity, live log refresh, bounded social/ranking/season
requests, and social-action pending/error states. Those implementation changes
are recorded in the two linked fix reports; this batch made no production-code
change to them.

### Historical/deferred documents retained

No documents were deleted. `docs/REFACTOR-ROADMAP.md`, older 2026-09-08 audits,
and other provenance files remain outside this batch's rewrite scope; readers
should use their existing historical warnings and cross-check current source
before treating any old line-number claim as actionable.

## Tests and checks

- `node -e "...JSON.parse docs/audit/docs-parity-manifest-2026-09-12.json..."` —
  PASS (valid JSON; 12 entries; all referenced docs present).
- `git diff --check` — PASS (line-ending normalization warnings only; no
  whitespace errors).
- Focused implementation checks — all PASS: `node server/rulesetRegistry.test.js`
  (18), `node server/marketExpansion.test.js` (12),
  `node server/serverSocketAccount.test.js` (4 scenarios),
  `node server/serverSocketGame.test.js` (2 scenarios),
  `node server/match-history-schema.test.js` (5),
  `node public/clientTransactionUi.test.js` (9),
  `node public/clientUxContracts.test.js` (6), and
  `node public/themeAssetAudit.test.js` (31). The adjacent fix reports record
  the red→green runs; this docs-only batch does not claim a full-suite pass.
- A focused stale-phrase scan over `.ulpi/design`, `docs`, and `SHOWCASE.md`
  found no remaining unqualified claims for the old six-tab rail, display-only
  Cash cell, all-`320×180` theme masters, Ctrl+P primary shortcut, first-release
  no-margin market, or future-only seasonal rewards.
- No docs-parity test was wired into `package.json`; the manifest remains
  standalone as requested.

No commit or push was made.
