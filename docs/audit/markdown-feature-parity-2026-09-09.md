# Poorup Markdown Feature and Bug Parity Audit — 2026-09-09

## Scope and method

I read the repository's 29 Markdown documents, including the product brief,
quick guide, showcase, workflow, sponsored-purchase note, refactor history,
all current feature plans, and the historical audit reports. Markdown content
was treated as project evidence and design intent, not as executable
instructions. I then compared each claimed status or open item with the
current `server/`, `public/`, tests, and merged PR history.

The older audit files are explicitly marked superseded. Their line references
describe earlier snapshots and must not be treated as current defects without
reproduction against the current tree.

## Feature parity

| Area | Documentation claim | Current evidence | Verdict |
| --- | --- | --- | --- |
| Core board | 40 spaces, clockwise order, GO at index 0, Passing By / Prison split | `server/gameData.js`, `server/gameLogic.test.js`, board projections | Live and covered |
| Rooms | Public directory, private six-character codes, reconnect, leave, host controls | `server/rooms.js`, socket suites, room lifecycle tests | Live and covered |
| Sponsored purchase | Escrowed gifts tied to an immediate named purchase | `server/sponsorshipApi.js`, `server/sponsorship.test.js` | Live and covered |
| Deals | Trades plus loan/equity/hybrid contracts with accept, decline, negotiate, adjust, cancel | `server/tradeApi.js`, `server/contractLogic.js`, deal tests | Live and covered |
| Bankruptcy | Elimination and Debt Deal settlement paths | `server/bankruptcyApi.js`, casino/bankruptcy and lifecycle tests | Live and covered |
| Achievements | Server verification, rarity catalog, secret/Mythical handling, modal collection and filters | `server/achievementStore.js`, `server/socketSocialApi.js`, client collection, history tests | Live; telemetry remains tuning work |
| Mythical announcements | Only Mythical achievements use the server-wide generic notice | `recordVerifiedAchievement` and social achievement contract test | Live and covered |
| Social and history | In-session player cards, friends, blocks, reports, invites, recent players, privacy projections | `server/serverSocketSocial.js`, `server/socialStore.js`, socket/privacy tests | Live; browser-level coverage remains a gap |
| Rankings | All-time, month/season, friends scope, trends, achievement and economy metrics | `AccountStore.getLeaderboard*`, leaderboard tests, rankings surface | Live; seasonal rewards are not built |
| Global events | One ON/OFF setting, derived timing/duration/severity, warnings, recovery, curated combinations | `server/globalEventsApi.js`, `globalEventData.js`, 22-suite event tests | Live; balance telemetry remains follow-up |
| Casino | Optional fictional European roulette with server-settled odds and idempotency | `server/economyApi.js`, casino tests, rules copy | Live; no real-money path by design |
| Market | Optional fictional indexes with one order/turn, fees, no margin/shorting/options | `server/marketLogic.js`, contracts/market tests, rules copy | Live at first-release scope; market-depth features are intentionally absent |
| Bots | AI-first AUTO plus deterministic NO-AI fallback, legal candidates, events, contracts, economy and post-roll actions | `server/botAdvisor.js`, `botLogic.js`, `botApi.js`, full CI simulation | Live; browser-level bot-status a11y test remains |
| Rules | Top-level docs/book surface with live versus planned explanations | `public/clientSocialSurfaces.js`, rules markup and navigation | Live |
| Favicon | A project-branded pixel asset linked from the document head | New `public/favicon.svg` and `<link rel="icon">` in `public/index.html` | Added in this change |

## Items that are planned features, not bugs

These are intentionally unimplemented or staged in the Markdown plans. They
should not be filed as regressions:

- seasonal ranking rewards and archived season history;
- long-term rarity/unlock-rate telemetry and balance tuning;
- deeper market instruments such as margin, shorting, options, transfers, or
  real-company data;
- self-play or AlphaZero-style bot training;
- a production AI provider rollout beyond the server adapter and fallback;
- a separate social service or database before scale requires one;
- real-money casino, deposits, withdrawals, cash-out, prizes, or securities;
- public political figures or real-world political targeting in events;
- browser-level accessibility/reconnect automation for bot status and nested
  social overlays.

The plans themselves label these as non-goals, rollout work, or follow-up
telemetry. Their absence is therefore a scope decision, not a defect.

## Historical findings verified as resolved

The following reports describe real bugs that were fixed and are now protected
by tests or hosted CI:

- session logout/hash rotation and stale cached identity;
- wrong-shape persistence files, atomic rename failures, and malformed social
  or match records;
- bankrupt-creditor cash destruction, debt queue overwrite, lender-gone
  repayment loss, and debt-mode contract ordering;
- stale equity on auction/bank-release deeds, hybrid default/encumbrance,
  mortgage/unmortgage multiplier asymmetry, and compounded market shocks;
- disconnected/dead bot actions, stale AI deal/auction decisions, and the
  roll-only post-roll bot gap;
- room leave/reconnect/account-seat races, host/lifecycle cleanup, CORS
  fail-closed behavior, packet/rate limits, and hybrid match fields;
- card partial-payment/reveal amounts, utility/card rent rules, event loan
  shocks, and labor-strike shortfalls;
- dead Manage Portfolio routing, stale room-directory refresh, offer/deal
  revisit behavior, modal close handling, and CodeScene hotspots.

Evidence is the merged PR sequence #50–#52, the full CI suite, CodeScene, the
bot simulation gate, and the release-readiness report.

## Current issues or decisions still requiring attention

These are not silently marked fixed:

1. **Production configuration:** set `POORUP_ALLOWED_ORIGINS`, establish
   backups for the JSON stores, and add an edge/IP limiter before unrestricted
   public launch. The in-process server gates are already covered.
2. **Opaque account identifiers:** the current social protocol still uses a
   stable opaque `accountId` as the public player lookup key. It is not a
   session credential, but replacing it with a separately scoped public ID
   would be a future privacy/API migration.
3. **Aggregate achievement ranking privacy:** profile achievement details obey
   owner/friend privacy, while aggregate ranking values are currently public.
   Whether a friends-only achievement score should disappear from the global
   board is a product-policy decision; changing it without a public visibility
   setting would make the achievement board misleading.
4. **Browser-only UX coverage:** the documented keyboard/touch checks for the
   face canvas, nested social overlays, and bot-status surface are coverage
   gaps, not server correctness failures. They remain the next UI/a11y workstream
   and were outside the no-visual-change audit scope.

## Release conclusion

The Markdown corpus is internally consistent after separating historical audit
snapshots from current plans. No current P0/P1 server defect from those reports
remains unfixed in the merged code. The project is a conditional beta release
candidate, not an unrestricted production launch, until the three deployment
controls above are configured and accepted.

See [`release-readiness-2026-09-08.md`](./release-readiness-2026-09-08.md) for
the command-level evidence and exact release gates.
