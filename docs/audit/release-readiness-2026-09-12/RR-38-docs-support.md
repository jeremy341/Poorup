# RR-38 — Player-Facing Docs & Support Surfaces

**Audit:** Release Readiness (40-agent) · Wave 4 · Mission RR-38 · 2026-09-12
**Mode:** READ-ONLY; main @ e64b174.
**Verdict:** No — a friend can join and roll dice unaided, but cannot self-serve the modern systems. Specifically broken by (a) stale live demo, (b) no in-game Rules/Help entry, (c) stale Instructions, (d) no FAQ/support/report path. The 19-chapter in-app Rules book is otherwise unusually accurate vs server logic (casino odds disclosed in the modal, bankruptcy, loans, market fee 2%, events, vacation pool all check out).

## Findings (15)

1. **[BLOCKER] README live demo (README.md:33)** — served build is older than the repo: fetched page title "Poorup — Multiplayer Board", no Rules surface, no Quick table, old "How to play" modal with +$2/+$10 auction steps — a friend clicking the advertised link learns an outdated game — redeploy main and re-verify the URL before sharing.
2. **[BLOCKER] Support surfaces** — zero bug-report path, contact, `.github/ISSUE_TEMPLATE`, FAQ, or Discord across the repo (only `workflows/ci.yml` + `copilot-instructions.md` in `.github`) — a player hitting a live-game bug can only DM the dev — add `bug_report.md` template + README "Support" section with the Issues URL.
3. **[MAJOR] Instructions.md** — 51 lines predating expansion: no auctions, casino, market, loans/contracts, global events, bots, rulesets, achievements, seasons; jail copy "wait out your turns" vs actual auto-pay $50 after 3 failed turns (server/gameLogic.js:617-627) — usable for the first two turns only, rate **3/10** — rewrite (or replace with a quickstart linking the in-app Rules book).
4. **[MAJOR] In-app Rules "Properties"** — claims "Owning every deed in a group activates the group's monopoly multiplier"; actual doubling requires `settings.doubleRent` (server/rentApi.js:54), which defaults false and has no lobby control anymore (grep `doubleRent` in `public/`: zero UI refs) — players overpay to complete sets for a bonus that never fires — fix copy or restore the toggle.
5. **[MAJOR] In-app Rules "Auctions"** — claims the server "advances to the next valid bidder" when the winner can't pay; actual behavior ends the auction with no winner and leaves the deed unsold (server/auctionApi.js:140-145, 183-187); no-bid outcome (unsold, auctionApi.js:163-167) also unstated — players expect a second-chance sale that never happens — correct the copy and state the no-bid outcome.
6. **[MAJOR] README game settings (README.md:60-69)** — lists Double rent / Even build / Mortgage toggles that no longer render in the lobby, and omits rulesets, board variant, max players, bots, casino, market, global events, bank loans, turn timer, bankruptcy mode — hosts can't trust the guide — regenerate from clientLobbyUi.js:511-550.
7. **[MAJOR] README operator section** — "no database" / "in-memory" vs docs/production-hardening.md (atomic JSON stores, `POORUP_*` env vars, backup drill) with no link, no deploy/env docs — operators can't run it safely — add an "Operations" pointer.
8. **[MAJOR] In-game rules access** — RULES exists only on home nav; game topnav has LOG/PANELS/RETIRE/SOCIAL but no Rules/Help and no shortcut (clientKeyboard.js) — a confused player mid-auction must leave the table (the older deployed build had a "?" How-to-play) — add Rules/"?" to game topnav.
9. **[MAJOR] docs/DEVELOPMENT_WORKFLOW.md** — says CI runs `test:full` but ci.yml runs `npm test` + coverage + wire + browser; "Codecov works with no token" vs ci.yml:33 sending `CODECOV_TOKEN`; Sentry claimed with no dependency/DSN; commands omit `test:browser`/`bot:balance`; branch table lacks `codex/*` — contributor/release confidence — sync doc to ci.yml.
10. **[MINOR] Error → help mapping** — auction rejections "Bid rejected." / "You cannot pass this auction." (clientAuctionUi.js:77,88) and market "Market position could not be updated." (clientMarketUi.js:219) are dead ends; rules book has no deep links — add a "See Rules →" affordance on those toasts.
11. **[MINOR] No FAQ / known-issues / glossary** — grep `docs/` finds none — repeat questions (mortgaged-trade rejection, loan collateral, auction no-bid) have no answer page — add a short FAQ + known-issues for release.
12. **[MINOR] Night Shift/Patrol** — only a "SHIFT+P · NIGHT SHIFT" hint and 9-word sr-only description (index.html:101-121); rules book has zero Patrol chapter; scoring/hearts/waves/account verification undocumented — add a chapter or HUD help.
13. **[MINOR] Quick table** — tooltip only "Create a default-rules room" (index.html:168); doesn't say it joins an open public table first, or that default = Classic 40 — add a one-line helper.
14. **[MINOR] Changelog & license** — no CHANGELOG.md (DEVLOG-7.md unlinked from README); README embeds MIT text but there is no LICENSE file and package.json has no license field — add CHANGELOG stub + LICENSE.
15. **[MINOR] Terminology drift (RR-26)** — rules use "Prison", lobby/Instructions/feed use "Jail"; home tagline "FOUR SEATS" vs Metro 52 up to six; rules ch.2 "board has forty spaces" vs selectable Metro 52; home "v2.4.1" vs package.json 0.0.0 — new players map two vocabularies — pick one term per concept and align copy.

## Minimal release doc checklist (5)
1. Rewrite `Instructions.md` as a 1-page quickstart, verified against current settings, linking the in-app Rules.
2. Fix the three wrong/incomplete rules chapters (Properties, Trades, Auctions) in `clientSocialSurfaces.js` and add the no-bid outcome.
3. Ship a FAQ/known-issues stub covering auction, contracts/loans, market, and mortgaged-trade rejections.
4. Add `.github/ISSUE_TEMPLATE/bug_report.md` + README "Support" section with the Issues link.
5. Refresh README (settings list + ops/env + pipeline), add LICENSE + CHANGELOG stub, and redeploy the live demo.

## Top 3 rule-explanation gaps
1. **Full-set rent multiplier** — promised by Rules; only applies when `doubleRent=true` (default false, no UI toggle) — server/rentApi.js:54.
2. **Auction resolution** — insolvent winner ends sale with no fallback (not "next valid bidder"), no-bid leaves deed unsold — server/auctionApi.js:140-145, 163-167.
3. **Trade eligibility** — mortgaged, loan-collateral, equity-locked, or improved deeds cannot be traded; rules never say it, only the error toast does — server/propertyRules.js:19-32.
