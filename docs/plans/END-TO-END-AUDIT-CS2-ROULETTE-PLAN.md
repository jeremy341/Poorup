# Poorup End-to-End UX, Logic, and Roulette Audit

Audit date: 2026-09-10
Status: implementation pass completed. Core P0/P1/P2 fixes, the CS2-style
roulette reveal reel, regression tests, and browser evidence are now in the
working tree. Staged product decisions and production deployment work remain
explicitly marked below.

Implemented in this pass:

- conservation-safe margin, short, option, bankruptcy, and leave settlement;
- connected-seat winner handling, Metro semantic card refills, and season
  metric/reward projections;
- public-room direct join IDs with no public join-code exposure;
- per-socket session revocation, anonymous social limits, auth attempt limits,
  backup sidecar rotation, and forwarded-IP handling;
- server-projected deed costs/actions, truthful Deals counts, async request
  timeouts, modal stack ordering, keyboard/tab semantics, focus indicators,
  accessible face painting, and mobile surface sizing;
- a server-settled, deterministic, skippable, reduced-motion-safe roulette
  reveal reel with a custom pixel pointer SVG.

Remaining non-blocking follow-ups are the remote AI endpoint probe, edge/WAF
deployment configuration, and further bot/economy tuning; they are not hidden
behind the completed local test gates.

> **Superseded/current status (2026-09-12).** This 2026-09-10 implementation
> pass remains a dated evidence record. The current status for the market rows
> is the server Batch 1 report: margin now holds disclosed initial collateral,
> advanced explicit actions share the one-action quota, and option payouts use
> the bounded server reserve. The current status for purchase/timer/focus rows
> is the transaction-UI report. Use
> `docs/audit/fix-docs-parity-batch-2026-09-12.md` for documentation status;
> do not reopen the historical reproduction table as an untriaged queue.

## /goal

Audit Poorup from the browser surface through Socket.IO, GameState, economy,
bots, persistence, security, and QA. Confirm the name and behavior of the
roulette presentation requested by the team, classify every finding as a bug,
UX debt, feature gap, intentional behavior, or non-issue, rate the project,
and provide a staged implementation plan that preserves the Poorup UI system.

The plan was deliberately implementation-ready. It named the authoritative
boundary, affected files, tests, visual evidence, rollback conditions, and
release gates. The resolution ledger below records what was actually shipped
in this working-tree pass; it does not silently turn planned features into
bugs.

## Compiled execution prompt

Audit Poorup end to end and produce a verified Markdown remediation plan.
Identify and specify the CS2-style roulette case-opening carousel: a
server-settled horizontal reveal reel with tick sounds, deceleration, and a
deterministic final stop. Audit the entire frontend, UX, animation,
accessibility, duplicate/dead UI, Socket.IO server, game logic, economy, bots,
persistence, and security. Compare behavior with the current Poorup plans and
locked UI system. Reproduce issues where possible, trace each to a root cause,
classify it, and rate the project with evidence. Search current references and
relevant skills. Preserve Poorup tokens, pixel-art/SVG language, server
authority, modal/focus rules, reduced motion, and the no-slop standard. Add
the roulette requirements to the implementation plan. Do not change
production code during the audit.

## Executive verdict

The product has a strong, distinctive table identity and a healthy test
foundation. The confirmed money-conservation, lifecycle, privacy, ranking,
responsive, accessibility, and request-state defects from the original audit
were remediated in this pass and are covered by regression or browser checks.
The requested roulette effect is now a server-settled CS2-style reveal reel;
its animation is presentation-only and cannot change the already-settled
roulette result.

The remaining work is intentionally non-blocking follow-up: probing the remote
AI endpoint, configuring the production edge/WAF, and tuning the staged market
and bot roadmap. Those are operational or product-release decisions, not
unfixed local correctness bugs.

## What the requested effect is called

The clearest product name is **CS2-style case-opening roulette reveal reel**.
Other useful names are **scrolling reveal reel**, **roulette carousel**, or
**case-opening carousel**. There is no official Valve API name for the visual;
community implementations describe it as a roulette animation in a case
simulator and as a horizontal reel that scrolls, decelerates, and stops on a
preselected result. A simulator explicitly labels the feature “case opening
with roulette animation”:

- https://github.com/Rarmash/CS2-Simulator

An implementation study describes the important fairness property: determine
the result first, place that result on the reel, then animate to it; deriving
the result from the final pixel position makes the system biased and
non-replayable:

- https://dev.to/graysonwerner100commits/what-123-million-simulated-cs2-case-openings-taught-me-about-modeling-rng-7dh

Poorup should borrow the readable reel language, not loot-box monetization.
Poorup roulette remains fictional board cash, displays its odds, never accepts
real money, and never lets timing or stopping input change the server result.

## Scope and method

The audit used:

- repository and Markdown-plan review, with line-level source tracing;
- systematic reproduction of money, turn, directory, and card-deck paths;
- full server test suite, lint, syntax, dependency audit, and coverage;
- Playwright visual and interaction captures at 1920×1080, 1366×768,
  1024×768, and 390×844;
- DOM geometry checks for internal scrolling, overflow, focus, and hidden
  content;
- static duplicate-ID and handler scans;
- the locked Poorup design contract in .ulpi/design/DESIGN.md;
- the existing architecture, debugging, TDD, QA, security, accessibility,
  game-UI, responsive, SVG, pixel-art, motion, and anti-slop skills.

The online skills directory was checked through skills.sh and the local
find-skills workflow. No extra skill was installed: the existing local catalog
already covers the requested frontend, UX, animation, security, game, and
evaluation lenses, and installing a second overlapping set would add noise.

## Verification snapshot

| Check | Result | Meaning |
| --- | --- | --- |
| npm run lint | PASS | Server lint is clean. |
| npm run lint:client | PASS | Browser-module lint is clean. |
| npm test | PASS | All suites passed, including 1,000 bounded bot simulations. |
| npm audit --audit-level=high | PASS | Zero reported vulnerabilities. |
| JavaScript syntax scan | PASS | 159 server/public/QA files passed node --check. |
| npm run coverage | PASS | 89.97% statements, 77.51% branches, 87.34% functions, 89.97% lines (including the new audit suites). |
| npm run test:browser | PASS | Root-relative Playwright webServer configuration now starts the correct server. |
| Direct Playwright run against an isolated server | 34 PASS, 6 SKIP | Surface suite is healthy; skips are the intentional Metro/mobile geometry project filters. |
| Static ID scan | PASS | 335 static IDs, no duplicates. Dynamic modal IDs are populated when opened. |
| 1920 visual captures | PASS with polish notes | Home, game, rules, profile, achievements, rankings, social, deals, and activity render in the Poorup language. |
| Mobile geometry audit | PASS | Rankings/social/rules/achievements retain readable internal surfaces at 390px. |

Playwright was used for the visual pass because no CUA browser surface was
available in this environment. Authenticated deep social overlays and the
interactive face canvas still need a browser test fixture; they are tracked,
not silently treated as passed.

## Project rating

Scores are current-state scores, not aspirations.

| Area | Score | Reading |
| --- | ---: | --- |
| Product identity and visual consistency | 3.8 / 5 | Distinctive terminal/parlor language, disciplined tokens, and strong board hierarchy. |
| Core board and settlement correctness | 4.2 / 5 | Classic flows and advanced-market conservation now have regression coverage. |
| Economy and market safety | 3.8 / 5 | Margin, shorts, options, bankruptcy, and exit settlement are bounded; staged market features remain deliberately scoped. |
| Turn and room lifecycle | 4.0 / 5 | Connected-seat grace, survivor settlement, and leave paths are covered. |
| Information architecture | 3.8 / 5 | Holdings/Deals/Activity, truthful counts, and focused surfaces reduce rail overload. |
| Accessibility interaction model | 3.7 / 5 | Keyboard, focus, reduced-motion, face editing, and responsive semantics have coverage; deeper authenticated fixtures remain follow-up. |
| Responsive behavior | 3.8 / 5 | Desktop and mobile surface sizing pass the current browser geometry suite. |
| Motion craft | 3.8 / 5 | The deterministic reel, skip path, tick hooks, and reduced-motion result preserve Poorup’s stepped language. |
| Bot parity and decision quality | 3.5 / 5 | Shared legal candidates and richer market context are in place; remote provider health and deeper valuation remain follow-up. |
| Security and privacy | 3.8 / 5 | Session revocation, anonymous limits, trusted IP handling, public-room IDs, and backup checks are covered locally. |
| QA and operability | 4.0 / 5 | Lint, full tests, coverage, dependency audit, syntax scan, and Playwright are green; production edge gates remain deployment work. |
| Overall | **3.9 / 5** | Strong beta foundation; advanced economy can proceed behind the existing staged release gates. |

## Findings and classifications

Priority meanings:

- P0: money, authority, or irreversible-state corruption; block release.
- P1: can strand a match, expose private room data, materially mislead a
  player, or make an advertised flow unusable; fix before advanced beta.
- P2: meaningful UX, accessibility, data-quality, or maintainability debt.
- F: feature gap or explicit product decision, not a defect in shipped scope.

The tables below preserve the original reproduction evidence for traceability.
For current status, use the implementation header and the dated resolution
ledger at the end of this document; resolved rows are not an open bug queue.

### P0 and P1 findings

| ID | Area | Evidence and root cause | Classification | Required correction and proof |
| --- | --- | --- | --- | --- |
| F-01 | Margin money conservation | server/marketExpansion.js:56-75 opens margin without disclosed principal collateral. At :181-201, a maintenance breach adds liquidation value to cash, clears margin positions, and clears margin debt. A reproduction changed cash from 1498 to 1507 while deleting a 100-dollar margin balance. | **P0 bug** | Introduce a single market-settlement ledger. Liquidation must return only net proceeds, repay margin principal first, release reserved collateral once, and record realized P&L. Add conservation/property tests over price paths and bankruptcy. |
| F-02 | Expanded-market exit | server/bankruptcyApi.js:95+ liquidates only player.marketPositions. marginPositions, shortPositions, optionPositions, and reservedCash survive bankruptcy/seat release through server/rooms.js:762-776. | **P1 bug** | Replace the narrow helper with liquidateAllMarketPositions. Define order for margin, shorts, options, reserved cash, then existing debt/deeds. Test voluntary leave, bankruptcy, debt mode, disconnected cleanup, and no negative cash. |
| F-03 | Disconnected ghost turn | server/gameLogic.js:491-497 counts every non-bankrupt seat, while nextTurn at :747 checks that count before findNextTurnSeat skips disconnected players. A two-player reproduction stayed started with one connected player and no winner. | **P1 liveness bug** | Use a documented connected-active count for terminal checks, with a reconnect grace policy. Test non-current disconnect, current disconnect, all disconnect, reconnect before grace, and winner settlement. |
| F-04 | Voluntary non-current leave | server/rooms.js:754-760 removes a non-current seat without entering the shared end/award path. One survivor leaves game.started true. | **P1 liveness bug** | Route every started-seat removal through one lifecycle finalizer. Award the survivor, persist the match, and close the room state exactly once. |
| F-05 | Metro card refill | server/gameLogic.js:191-193 and :276-278 create variant decks with semantic tile IDs, but server/cardApi.js:55-59 refills from static decks and drops tileId. | **P1 board bug** | Refill from the active BoardRegistry deck factory. Exhaustive draw/refill tests must preserve semantic IDs and target moves for Standard-40 and Metro-52. |
| F-06 | Short forced buy-in | server/marketExpansion.js forceLiquidate calls coverShort; coverShort returns false when cash plus released collateral is insufficient, leaving the dangerous short open after its trigger. | **P1 economy bug** | Add a deterministic underfunded route: collateral seizure plus a bounded debt/default record, never an ignored failure. Test 1.5× trigger, partial collateral, bankruptcy, and replay. |
| F-07 | Option counterparty settlement | server/marketExpansion.js:147-178 stores a writer role on the same player and exerciseOption credits intrinsic value without debiting a writer or house reserve. A 100-to-200 quote exercise produced an unbacked positive cash delta. | **P1 economy/design bug** | Choose a house-underwritten reserve or explicit buyer/writer pairing. Lock collateral at open, debit the reserve/counterparty at exercise, and settle expiry once. Add cash-conservation tests and a visible collateral projection. |
| F-08 | Season reward source | server/seasonModule.js:248+ claimReward reads global REWARD_TRACK rather than season.rewardTrack. A persisted season revision can display one track and validate another. | **P1 data bug** | Resolve by season ID and revision from the immutable season record. Migrate old seasons, reject mismatched revisions safely, and test claims across a changed track. |
| F-09 | Season ranking metric projection | server/serverSocketSocial.js:463-470 and :475-486 map most season metrics (mythical, bankruptcies, auctions, rent, casino, market, playerloans, equity, patrol) to row.points. The client cycles all 15 metrics in clientSocialSurfaces.js:401. | **P1 ranking bug** | Create one metric registry used by SeasonStore, socket projections, and client labels. Every metric needs an explicit value, sort rule, empty state, and test fixture. |
| F-10 | Public room-code privacy | server/rooms.js:550-565 getDirectorySummary returns code for public rows. The UI masks it as OPEN TABLE, but DevTools still receives it. | **P1 privacy/API bug** | Return code:null for public rooms and use a room ID or single-use join token. Update join payloads, docs, and privacy tests. |
| F-11 | Logout revocation across tabs | server/socketHandlerSupport.js:31-42 resolves a cached socket account without checking revocation; server/serverSocketAccount.js:25-31 clears only the calling socket. A second socket still resolved the account after logout. | **P1 security bug** | Add a session epoch/revocation check or fan out invalidation to every account socket. Test logout, token rotation, two tabs, reconnect, and stale acknowledgements. |
| F-12 | Credential abuse limits | server/serverSocketAccount.js uses per-socket throttles for register/login. Rotating sockets bypasses the failed-attempt budget. | **P1 security/ops bug** | Add IP plus account/identifier buckets, exponential backoff, generic errors, and an audit metric. Keep the in-process socket limiter as a second layer. |
| F-13 | Bankruptcy action copy | public/clientGameModalsUi.js:244-270 labels a neutral close-and-instruction action “Liquidate & Pay”. It does not liquidate or pay; it only points the player to Holdings. | **P1 UI contract bug** | Rename to OPEN HOLDINGS or embed a real legal liquidation step. Keep the blocking debt state explicit and test keyboard, scrim, and stale-state behavior. |
| F-14 | Responsive information loss | public/styles.css:1787-1809 collapses the Rules book on mobile; :1959-1960 hides outer Rankings/Social overflow; achievements at 390px measured a 24px grid, Rules article 42.5px, Rankings list below the clipped stage, and Social context at 2px. | **P1 responsive/accessibility bug** | Give each view one intentional scroll owner, reserve readable minimum heights, stack panels at 390px, and keep the board/lobby safe area. Re-run keyboard and screenshots at all four target sizes. |
| F-15 | Night Shift reduced-motion fairness | public/clientNightShift.js:184-197 returns early for REDUCED_MOTION after setting pointer events. No miss/backstop timer runs, so targets never expire and the mode becomes easier. | **P1 a11y/gameplay bug** | Suppress movement but retain the same duration and miss outcome with a timer/backstop. Add reduced-motion parity tests and screen-reader status. |
| F-16 | Deed detail projection | public/clientDeedDetailUi.js:84-160 uses static RENT_TABLE house prices, mortgageValue, and unmortgageCost. It does not mirror event multipliers, turn/roll gates, supply, or server legality. | **P1 UI/server mismatch** | Return viewer-scoped legal actions, effective costs, and reasons from the server. Render those values; never enable an action the server will reject. |
| F-17 | Tile BUY over-promise | public/clientPopupUi.js:188-203 checks phase, turn, cash, and busy state but not pendingBuyTile or the server offer. An arbitrary unowned tile can render an enabled BUY button. | **P1 UI/server mismatch** | Require the matching pending offer in the projection and show the exact disabled reason otherwise. Test stale offer, auction, event, and reconnect states. |
| F-18 | Default browser QA command | qa/playwright.config.js webServer command is resolved relative to qa, so npm run test:browser searches for qa/server/server.js. The direct server-targeted run passed 33 tests and skipped 3 intentional Metro cases. | **P1 QA pipeline bug** | Resolve the command from repository root or use an explicit path. Add a CI smoke test that invokes the public npm script, not only the underlying Playwright command. |

### P2 findings, design decisions, and feature gaps

| ID | Area | Evidence and root cause | Classification | Plan |
| --- | --- | --- | --- | --- |
| F-19 | Bank loan obligation gate | server/loanLogic.js:117-140 checks facility, seat, event, turn, and cash, but not pending payment, purchase, auction, trade, contract, or sponsorship. A reproduction issued a loan during each open obligation. | **P2 rules-conflict bug** | Decide whether emergency credit is an explicit exception. The safer default is one shared blocking-obligation gate with an explanatory exception only for a debt cure. Add a matrix test and document it in Rules. |
| F-20 | Deals count projection | public/clientRailRender.js:345-347 and :504-512 omit incoming pendingTrade from the NEEDS YOU count in one header and omit due-debt totals in another. | **P2 UI bug** | Build one viewer-specific DealProjection and derive rows, counts, filters, and notifications from it. |
| F-21 | Option request idempotency | public/clientMarketUi.js:129-152 creates requestId for most actions, then replaces payload in the open-option branch without one. server/economyApi.js:381-394 caches by payload.requestId. | **P2 transaction bug** | Preserve requestId in every branch, bind it to action and semantic payload, and test retries/double-clicks. |
| F-22 | Async action timeout | clientMarketUi.js, clientCasinoUi.js, and clientWalletUi.js leave PROCESSING state until an acknowledgement. A lost acknowledgement can strand the modal. | **P2 UX/reliability bug** | Add a shared request controller with timeout, reconnect refresh, retry using the same idempotency key, aria-busy, and a clear recovery message. |
| F-23 | Modal stack order | public/clientSurfaces.js:57+ selects visible.at(-1) by DOM order, while clientKeyboard.js has a fixed Escape order. Nested Social/Profile/Deal surfaces can close the wrong layer. | **P2 UX/a11y bug** | Maintain an explicit open-order stack, one blocking modal at a time unless a nested stack is declared, and restore focus to the invoker. |
| F-24 | Keyboard shortcut guard | public/clientKeyboard.js:29-38 treats only INPUT/TEXTAREA as typing targets. SELECT, BUTTON, and contenteditable controls can trigger B/C/P/J, Space, or turn actions. | **P2 UX bug** | Guard interactive controls and let native activation win. Add keyboard tests for every shortcut and button/select combination. |
| F-25 | Incomplete tab semantics | Several role=tablist surfaces lack roving tabindex and Home/End/arrow behavior; player-history-scopes uses aria-pressed rather than aria-selected. | **P2 accessibility bug** | Share one tab controller or change non-tabs to toolbar/pressed semantics. Test focus order, selection, screen-reader names, and disabled tabs. |
| F-26 | Face editor input model | public/clientProfileBindings.js:280-358 supports mousedown/mouseover only. public/clientProfileRender.js:647-655 renders title-only swatches and span face cells. | **P2 accessibility bug** | Use pointer events, an accessible grid or labeled buttons, keyboard paint/erase, touch, palette names, and a live selected-color status. |
| F-27 | Native alert in profile cap | public/clientProfileBindings.js:228-231 uses alert for the profile limit. | **P2 accessibility/UX bug** | Replace with the existing Poorup notice/live region and a focused delete/manage action. |
| F-28 | Focus outline suppression | public/styles.css:1076 and :3079 set outline:none on focused event choices and dropdown options without an equivalent guaranteed indicator. | **P2 accessibility bug** | Keep a two-pixel tokenized outline or equivalent contrast-safe box shadow; verify forced colors and keyboard screenshots. |
| F-29 | HTTP forwarded-IP trust | server/httpRateLimiter.js uses the first raw x-forwarded-for value when trustProxy is true. A client can spoof it if the proxy chain is not configured exactly. | **P2 security bug** | Use the framework’s trusted req.ip/hop configuration and test direct, single-proxy, and multi-proxy requests. |
| F-30 | Backup sidecar rotation | server/backupStore.js:27-48 rotates .json files only; .sha256 sidecars remain indefinitely. | **P2 operations bug** | Rotate checksum pairs atomically, verify pair membership, and add retention/disk-pressure tests. |
| F-31 | Achievement atomicity | server/socketSocialApi.js:157-175 and server/serverSocketSocial.js:281-293 persist the unlock and account projection in separate operations. A second write failure leaves a permanently “created” unlock with no account record. | **P2 persistence bug** | Use an idempotent outbox/reconciliation record or transactional store operation. Add injected-failure and replay tests. |
| F-32 | Match-history merge | server/serverSocketSocial.js:415-418 prefers matchStore when it is non-empty, dropping additional accountStore records if the stores are partially migrated. | **P2 data bug** | Merge by matchId, apply the privacy projection once, sort by completedAt, and test partial migrations and duplicates. |
| F-33 | Stable opaque account IDs | server/summaryApi.js:84-107 and server/rooms.js:527-545 expose accountId in room snapshots. It is not a credential, but it is a cross-game stable identifier. | **P2 privacy policy gap** | Introduce viewer-scoped public IDs or omit the identifier for guests; document the social lookup policy and test all projections. |
| F-34 | Season window mismatch | server/serverSocketSocial.js:437 uses calendar-quarter start for legacy season scope, while SeasonStore uses immutable eight-week Monday seasons. | **P2 data consistency bug** | Route all season scope queries through SeasonStore and include seasonId/revision in the response. |
| F-35 | Advanced-market action quota | marketLogic guards basic orders with marketActionsThisTurn, while marketExpansion.expansionGuard does not increment or enforce it. | **P2 product decision** | Choose multi-action Finance Window explicitly or add a shared quota plus END FINANCE WINDOW. Align UI copy, bot candidates, and tests. |
| F-36 | Bot market context | server/botStrategicContext.js omits option premium/collateral/exercise fields; botFuturePlanner uses a placeholder opponent-1 for transfers; eventRentMultiplier recognizes only the standard Dark Blue group. | **P2 bot-quality gap** | Version a sanitized strategic context schema per board variant and test multi-player, Metro, option, and event valuation. |
| F-37 | AI provider health | server/botAdvisor.js health checks configuration but does not probe the endpoint/model. Fallback is safe, but the UI can claim a provider is healthy when it is not. | **P2 operations/UX gap** | Add a bounded startup/periodic probe with timeout and quota state; show AI/NO-AI fallback status without leaking keys. |
| F-38 | Roulette reveal reel | public/clientCasinoUi.js currently has a server-settled result line but no horizontal reel, tick schedule, skip control, or reduced-motion reveal. | **F feature gap / P1 casino scope** | Implement the CS2-style reel in the dedicated slice below. Do not alter casino odds or settlement. |
| F-39 | Multiple option visibility | public/clientMarketUi.js selects only the first open option per instrument even though marketState.options can contain multiple. | **F feature gap** | Render a compact position list and open a focused detail view; do not silently hide obligations. |
| F-40 | Wallet and item actions | clientWalletUi.js exposes capability-gated upgrade/item controls while server handlers are intentionally staged. | **F intentional staging** | Keep the controls disabled with an honest “COMING IN THIS RULESET” explanation until the authoritative handlers exist. |
| F-41 | Guest social empty state | Social guest feed and context panels leave large blank areas at desktop and lose context at 390px. | **P2 UX debt** | Give the empty state a concise explanation and a single sign-in action; preserve the three-column layout only where it has content. |
| F-42 | Bank details state | clientRailRender.js:120 recreates a details element on every rail render, resetting open state. | **P2 UX debt** | Persist open state by viewer/session or replace it with the shared collapsible pattern. |
| F-43 | Offer close naming | clientKeyboard.js calls the neutral close handler rejectOpenOffer; it does not send a decline, but the name invites future regressions. | **P2 maintainability debt** | Rename to closeOfferWithoutResponse and add a regression test that Escape/scrim leaves the offer pending. |
| F-44 | Deep-link state | Some social/rules surfaces render from query previews but do not consistently write or read the complete view state. | **P2 navigation debt** | Define a small URL state contract and test reload/back/forward without leaving an active round. |

### Confirmed not-current findings

These items were reported in older audit notes but are not current bugs after
the latest work:

- There are no static duplicate IDs: the current index has 335 unique IDs.
- MANAGE PORTFOLIO is no longer present in the current HTML.
- The Rooms opener bindings have live guarded markup and are wired in
  clientRoomsUi.js:534-535.
- Setup has a visible BACK control at public/index.html:683.
- The buildingMaintenance formatter is currently in
  clientGlobalEventRender.js:60-87, so it renders as a currency value rather
  than the old percentage mistake.
- Partial repayment inputs are present in the Deals rail and server paths.
- Closing a trade offer through scrim/Escape is neutral today; the misleading
  internal function name is tracked as F-43.
- Bot social/friend actions are intentionally not persistent bot capabilities;
  bots use table-talk candidates instead.
- Guest identity after a full tab restart remains unrecoverable by design.
- expired and due-for-equity enum values are harmless compatibility values.

## CS2-style roulette reveal reel plan

### Product contract

The roulette reel is presentation around an already-settled fictional-money
transaction. The server decides the pocket, color, payout, ledger entry, and
cash delta before the client starts motion. The client cannot sample random
numbers, choose a stop position, change the result, or delay the settlement.

The visual sequence is:

1. The player submits a valid bet with an idempotency key.
2. The server validates the table, obligation gate, odds, cash, and request key.
3. The server draws one pocket and commits the ledger/cash mutation.
4. The response includes a spin ID, result, balance, and an opaque reel seed
   generated after settlement.
5. The client builds a fixed-pointer strip containing red, black, and green
   pocket cards. The known result is placed at the target index and filler
   cards are generated deterministically from the seed.
6. The strip moves left under a stationary center pointer. Tick cadence is
   tied to card-boundary crossings, not arbitrary frame count.
7. The reel decelerates into the known target and pauses long enough to read the
   result. A compact ledger line then shows pocket, color, net, and balance.
8. SKIP, Escape, or a tab return completes the presentation immediately but
   never changes the already-settled result.

### Server response shape

Extend the existing place-casino-bet response without breaking current
clients:

    result: {
      transactionId,
      spinId,
      pocket,
      resultColor,
      choice,
      stake,
      net,
      balanceAfter,
      settledAt,
      presentation: {
        reelSeed,
        targetIndex,
        durationMs,
        revealDeadline
      }
    }

The seed is presentation-only and should be scoped to the spin ID. Replays
must be able to identify a settled spin, while the public summary exposes only
the outcome, not a private request token. A second request with the same
requestId returns the original response byte-for-byte.

### Client states

The casino surface has a small state machine:

- idle: odds, balance, stake, and SPIN THE WHEEL;
- submitting: disabled submit button, aria-busy, no duplicate request;
- settled-presenting: reel active, result is already in the ledger;
- settled: result and balance readable, SPIN AGAIN available when legal;
- skipped: same settled result without motion;
- stale/reconnected: show the settled result immediately and refresh the rail;
- error: actionable server message and a restored form;
- reduced motion: static result reveal with a short opacity/color transition.

The reel is a child of the existing Casino Desk modal, not a new top-level
navigation surface. Observers can receive a compact Activity entry; only the
bettor receives the full reel unless a future table setting explicitly enables
spectator reveals.

### Motion and sound

The animation purpose is state indication and anticipation for a rare
decision, so a longer 3.6–4.2 second reel is justified. Use the existing
Poorup stepped movement and token timing:

- transform and opacity only;
- fixed center pointer; no layout animation;
- deceleration uses an ease-out curve from the locked design tokens;
- default duration is 4.2 seconds, with a hard reveal deadline;
- SKIP is always visible and keyboard reachable;
- no animation starts until the server acknowledgement;
- tab visibility uses wall-clock elapsed time and resolves immediately after
  the deadline;
- reduced motion removes translation and keeps a readable result transition.

Ticks should be scheduled from the Web Audio clock or a small preloaded sprite,
with volume controlled by the existing global sound toggle. The pitch/spacing
may tighten early and widen near the target, but there is no sound when sound
is muted, the document is hidden, or the user has reduced-motion plus sound
disabled. A single reveal tone is optional and must not obscure the ledger.

Reference implementation guidance:

- requestAnimationFrame callbacks should use their timestamp rather than
  assuming a fixed frame rate:
  https://developer.mozilla.org/en-US/docs/Web/API/Window/requestAnimationFrame
- Web Audio scheduling should use an AudioContext/node timeline rather than
  creating an uncontrolled oscillator per tick:
  https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API

### Accessibility and trust

- The reel itself is aria-hidden; the result is announced in one live region:
  “Roulette settled on black 23. Net plus 10 dollars.”
- Provide a visible “Server settled before reveal” note and the exact odds.
- Keep a real CLOSE/SKIP button in the modal. Scrim/Escape dismisses only and
  never declines or reverses a bet.
- Trap focus inside the dialog, return focus to the spin trigger, and make
  the result readable at 200% zoom.
- Honor prefers-reduced-motion and avoid flashing/high-frequency color changes.
- Never expose hidden filler probabilities as if they were additional odds.
- Never make stopping the reel, clicking a card, or timing a key press affect
  the outcome.

The WAI-ARIA modal dialog pattern requires background inertness, focus inside
the dialog, Escape handling, and focus restoration:

- https://www.w3.org/WAI/ARIA/apg/patterns/dialog-modal/

Focus visibility and user-controlled motion are part of WCAG 2.2:

- https://www.w3.org/TR/WCAG22/

### Roulette tests

Server:

- result and cash settle before any presentation payload is returned;
- requestId retries return one ledger entry and one cash delta;
- all 37 pockets map to the correct color and payout;
- reel seed cannot change result, odds, or balance;
- a stale/dead socket can fetch the settled result without a second bet;
- no negative cash or loan-backed casino stake.

Client:

- deterministic seed places the known result at targetIndex;
- the same seed produces the same filler strip;
- SKIP, Escape, scrim, hidden tab, timeout, and reconnect all show the same
  settled result;
- sound and music toggles are respected;
- reduced-motion has no translation but retains the same reveal deadline;
- live region announces once, focus returns correctly, and no duplicate
  listeners accumulate.

Browser:

- 1920×1080 visual evidence of idle, presenting, settled, skipped, and reduced
  motion;
- 1366×768 and 1024×768 preserve the pointer and readable cards;
- 390×844 uses an internal reel viewport without page scroll capture;
- keyboard-only and screen-reader name checks pass.

## Remediation roadmap

### Phase 0 — stop money and authority corruption

1. Add conservation assertions around margin, shorts, options, and reserved
   cash.
2. Implement one market liquidation/settlement order used by bankruptcy,
   voluntary exit, disconnect cleanup, and forced maintenance.
3. Repair short buy-in and option counterparty accounting.
4. Add connected-active winner logic and the started-seat finalizer.
5. Fix Metro deck refill and season reward-track resolution.

Exit gate: all P0/P1 server tests pass; randomized bounded games show no cash
creation, stuck two-player games, open obligations after exit, or duplicate
settlements.

### Phase 1 — make projections truthful

1. Introduce DealProjection and MetricRegistry.
2. Use server-projected deed actions/costs and pending purchase offers.
3. Remove public room codes and rotate account-session revocation.
4. Decide and document the bank-loan obligation exception and advanced-market
   action quota.
5. Repair the Playwright npm command.

Exit gate: snapshot contracts, privacy tests, stale-action tests, and the
public browser command pass.

### Phase 2 — make every surface reachable

1. Give Rankings, Social, Rules, and Achievements one intentional scroll
   owner at each viewport.
2. Implement the explicit modal stack and shared request controller.
3. Repair keyboard shortcut guards, tab semantics, focus outlines, face
   editor input, and the profile cap notice.
4. Preserve details-open state and remove the misleading offer-close name.

Exit gate: keyboard and screen-reader Playwright tests pass at all target
sizes; no critical content is below a clipped or zero-height region.

### Phase 3 — ship the roulette reel

1. Add the backwards-compatible presentation payload and spin ID.
2. Implement a small standalone ReelPresenter module that accepts only the
   settled result and seed.
3. Add pixel-art pocket cards and a fixed pointer using existing SVG/pixel
   assets or a new token-compliant SVG mark.
4. Add boundary-timed tick audio through the existing sound control.
5. Add skip, tab-return, timeout, reduced-motion, live-region, and focus
   restoration behavior.
6. Capture the five casino states at 1920px and the mobile reel viewport.

Exit gate: deterministic result/animation tests, no-odds-change tests, visual
review, reduced-motion review, and accessibility checks pass.

### Phase 4 — bots and operational hardening

1. Version a sanitized bot strategic context for every board variant and
   market tier.
2. Add provider health/fallback state and parity tests proving AI and NO-AI
   see the same legal candidate IDs.
3. Add login/search/room/invite IP limits behind the edge and keep socket
   limits as defense in depth.
4. Rotate checksum sidecars, run restore drills, and require production
   allowed origins.
5. Merge match history from old and new stores and introduce public scoped
   IDs.

Exit gate: bot simulations, fake-provider failures, restore drill, CORS
handshake checks, and privacy review pass.

## Architecture guardrails

Keep one modular monolith and one GameState legality engine:

    RulesetRegistry
    BoardRegistry
    GameState
    ObligationGate
    MarketSettlementLedger
    DealProjection
    MetricRegistry
    SeasonModule
    CosmeticCatalog
    TelemetryModule
    ModalStack / RequestController
    ReelPresenter

Business rules stay server-side and pure where possible. The browser renders
viewer-scoped projections and sends small idempotent verbs. The ReelPresenter
must not import the RNG, cash, or ownership modules. The Season MetricRegistry
must not duplicate sort formulas in the client. New abstractions should be
extracted only where the current duplication is demonstrated (the rule of
three), not as a speculative framework.

Every new field is versioned by rulesetRevision, balanceRevision, boardVariant,
seasonId, and eventId where applicable. Every irreversible action has a
request ID, a server ledger entry, and a replay-safe response.

## Competitor and reference context

Poorup is not trying to beat a single direct clone. The useful comparison set
is:

| Reference | What it does well | Poorup opportunity |
| --- | --- | --- |
| Board Game Arena — https://en.boardgamearena.com/ | Broad online tabletop catalog, live/turn-based play, and clear table entry. | Keep Poorup’s faster parlor entry while making obligations and reconnect state more legible. |
| Official MONOPOLY by Marmalade — https://www.marmaladegamestudio.com/games/monopoly | Familiar licensed rules and polished board presentation. | Differentiate with server-verified finance, global events, bots, and a coherent terminal identity. |
| MONOPOLY GO — https://www.monopolygo.com/news/introducing-monopolygo-chat | Seasonal events, social chat, and recurring reward loops. | Borrow the clarity of social/event feedback without pay-to-win progression, real-money wagering, or loot-box pressure. |

The comparison supports the current product direction: a social board game
with a deeper, inspectable economy, not a casino or a cosmetic power ladder.

## Release and rollback gates

Do not expose advanced market or casino expansion if any of these remain:

- a conservation test can mint cash or erase debt;
- a bankruptcy/leave path leaves a short, option, margin, or reserved balance;
- a two-player disconnect can strand the match indefinitely;
- a public directory returns a private join code;
- a season metric displays points under another label;
- a target viewport clips the only usable Rankings, Rules, Social, or
  Achievements content;
- the roulette reel can change or conceal a server-settled result;
- reduced motion changes a game outcome or target expiry;
- the default browser QA command fails;
- production origin, backup, restore, or edge-limit checks are missing.

Rollback is capability-based: disable advanced market/casino/Metro flags and
return to Classic Standard-40. Never rewrite a started match digest or a
settled casino ledger. Keep the projection schema backward-compatible so an
older client can render the result line if it cannot render the reel.

## Follow-up records

This document is the current audit source of truth. Older audit documents that
describe resolved work should be treated as historical snapshots, not open
queues. After each remediation slice, append a dated resolution ledger here
with the commit, tests, screenshots, and rollback note.

### Resolution ledger — 2026-09-10 working-tree pass

| Slice | Status | Evidence |
| --- | --- | --- |
| Market conservation and lifecycle (F-01 through F-08, F-19) | DONE | market-settlement-audit, lifecycle-audit, marketExpansion, casino-bankruptcy, and full server suites. |
| Truthful projections, privacy, seasons, history (F-09 through F-11, F-16, F-17, F-32, F-34) | DONE | season-metrics, season-reward, summary-privacy, rooms integration, and browser suites. |
| Responsive/accessibility/modal work (F-13 through F-15, F-20, F-22 through F-28, F-41 through F-43) | DONE | 40 Playwright tests across 1920, 1366, 1024, and 390; keyboard/reduced-motion paths included. |
| Security/operations (F-12, F-29 through F-31) | DONE locally | auth/IP guards, sidecar rotation, revocation, and npm audit; edge/WAF deployment still belongs to production configuration. |
| Bot context and future valuation (F-36) | IMPROVED | market expansion fields, short debt, option terms, Metro premium group, and candidate appliers added; provider health remains a follow-up. |
| CS2-style roulette reveal reel (F-38) | DONE | server presentation payload, deterministic reel, pixel pointer SVG, skip/alignment test, and 1920 visual capture. |
| Intentional/staged items (F-39, F-40, F-44) | DOCUMENTED | multiple-option detail and provider probe remain staged; deep-link reader now supports Rules/Rankings/Social routes. |
