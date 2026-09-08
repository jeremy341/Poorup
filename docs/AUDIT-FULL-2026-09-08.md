# Full audit — 8-agent pass (2026-09-08)

Method: eight parallel read-only audits with disjoint scopes (server core, money/deeds,
contracts/economy, auth/sockets/stores, bots, client board/state, client rail/trade/popup,
client shell/a11y). Every finding was traced end-to-end in code by its agent; unprovable
leads were dropped. No code changed. Supersedes the [R]-only sections of
`docs/AUDIT-DEEP-2026-09-08.md`; items already fixed are not relisted.
Skills applied: review-agent (defect-first, demonstrable-from-code bar), systematic-debugging
(root-cause tracing before reporting), accessibility (WCAG 2.2 AA lens), web-design-guidelines.

## P0 — fix first

**Auth / privacy**
- Logged-out tokens still authenticate (`server/accountStore.js:517`, `418-427`, `429-442`).
  `logout` deletes the live token but never the `sessionHashes` entry; `sessionAccount`
  falls back to the hash and re-animates the session. Re-login leaves old + new tokens
  valid simultaneously. No `account-delete` handler purges hashes either.
- Stable `accountId`/username broadcast (`server/rooms.js:403`, `server/summaryApi.js:87`,
  `server/serverSocketSocial.js:133-139,166-173`). Every seat's `accountId` goes to all
  viewers; leaderboard and player search expose identity to unauthenticated sockets.
  Violates `docs/plans/global-leaderboards-plan.md:144`.
- Cached `socket.data.accountId` trusted without token (`server/socketHandlerSupport.js:31`).
  Omitting `sessionToken` keeps other sockets for the account authed forever, even after
  logout elsewhere.
- Valid-JSON wrong-shape store wiped without quarantine (`server/accountStore.js:398`,
  `server/socialStore.js:119-133`, `server/storeIO.js:15-31`). Object-instead-of-array
  loads as empty; next `persist()` overwrites the original with no `.corrupt-` sibling.
  Silent total data loss, distinct from the quarantined corrupt path tests pin.

**Money destruction / misdirection**
- In-flight rent destroyed when creditor suicides mid-debt (`server/gameLogic.js:850-860`).
  Debtor pays, `creditRentTo` early-returns on bankrupt creditor, cash vanishes. Forgive
  or escrow instead.
- Mortgage/unmortgage multiplier asymmetry mints cash (`server/propertyApi.js:280,297`).
  Mortgage pays `floor(price/2)*multiplier`, unmortgage charges `floor(price/2)*1.1`
  ignoring it. At 2x: net `+0.9*half` per cycle, repeatable.
- Auction transfer leaves equity live (`server/auctionApi.js:194-203`). No
  `terminateTileEquityShares`, unlike trade/bankruptcy paths. Winner pays old holders
  on every future rent.
- Bank-release leaves equity live on unowned deeds (`server/bankruptcyApi.js:213-218`).
  `releasePropertyTile` clears owner/houses/mortgage but not shares; purchase and auction
  paths don't check `tradeableTileUnencumbered`. Root cause feeding the above.
- Debt-mode forfeits before contract settle (`server/bankruptcyApi.js:44-60`,
  `bankruptcyLogic.js:177-185`). Collateral deed moves to the rent creditor first, then
  `seizeCollateralForLender` skips (debtor no longer holds it). Elimination order is
  correct; debt order is backwards.
- Player-loan repay destroys cash when lender gone (`server/contractLogic.js:421`).
  `settleLoanRepayment` debits borrower, credits `if(lender)` — lender removed via
  `removePlayerByClient` with no contract cleanup. Payment deleted.
- Active hybrid wiped on bankruptcy instead of defaulting (`server/bankruptcyApi.js:138`).
  Hybrid only gets `terminateEquityContract`; lender principal funded at accept vanishes
  with no `defaulted` status, no seizure, no stats. Route through the loan-default leg
  like `convertHybridContract` fallback does.
- Market modifier compounds per tick (`server/marketLogic.js:54`). `0.65^6` floors every
  quote to 10; `1.15^6` explodes them. Apply once at activation, not per-tick product.
- Hybrid conversion target tradeable/mortgageable mid-contract
  (`server/propertyRules.js:112`, `server/gameLogic.js:337-344`). `isPlayerContractCollateral`
  only matches `kind==='loan'`, so the borrower sells/mortgages the conversion target,
  conversion fails at cure, lender gets bare `defaulted` while borrower keeps
  principal + sale proceeds.
- Dead bots act via socket swap (`server/botApi.js:108-126`, `server/botLogic.js:111-113`).
  `botActionRejection` checks bot-ness only; `actAsBotSocket` makes liveness checks pass.
  Dead bots can roll, pay jail fines, build, repay, end turn, pass auctions, and declare
  bankruptcy. Sibling gaps: `rollTurnRejection`, `payJailFine`, `jailFreeRejection`,
  build/sell, `repayContract`, bank-loan repay, `endTurn`, `auctionPassRejection` all omit
  bankrupt/disconnected checks their neighbors enforce.

**Client lies about money / crashes**
- Utility rent static lie (`public/clientBoardData.js:34`, `clientDeedRules.js:52` vs
  `server/rentApi.js:61-65`). Client shows $12/$24; server charges dice x (4|10).
- Per-tile rents collapsed to group base (`public/clientBoardData.js:25-32` vs
  `server/gameData.js:30-63`, `server/rentApi.js:48-53`). Kumasi, Tokyo, Amsterdam,
  Toronto, Zurich, Marina Bay ladders wrong at nearly every level (hotel $4000 vs $6250
  on Marina Bay). Compute `tile.rent * multiplier` per tile.
- Monopoly doubling never displayed (`public/clientDeedRules.js:49-55` vs
  `server/rentApi.js:54-56`). Full set unimproved shows base; server charges 2x.
- Event rent modifiers unmirrored (`public/clientDeedRules.js:49-55` vs
  `server/rentApi.js:14-31`). Strike shows $200 railroad, server charges $0.
- Unowned railroads/utilities counted as a held set (`public/clientDeedsRender.js:75-77`).
  `undefined===undefined` → vacant deed shows $200 NOW + highlighted ladder.
- HUD + topnav crash on empty roster (`public/clientHudRender.js:262,272-280`,
  `public/clientTopNavRender.js:106-110`). `cur.name` / `players[turnIndex].name` with no
  guard aborts the whole paint.
- Trade popup strands single-slot pending (`public/clientGameModalsUi.js:152-155`,
  `clientSocketListeners.js:234-240`, `server/tradeApi.js:34-36`). Accept/Negotiate only;
  scrim/Escape silently closes; server `pendingTrade` blocks all future trades. Scrim-
  dismissed bot offers have no rail revisit (rail never surfaces `state.offers[]`).
- Negotiation pickers list the wrong side's deeds (`public/clientTradeUi.js:759-761`).
  Always `owners==="p1"`; server requires borrower/recipient deeds. Lender-side
  counter/adjust of equity/hybrid/loan is impossible (fallback sends wrong index).
- Face canvas mouse-only (`public/clientProfileBindings.js:280-285,287-292,355-356`,
  `public/index.html:422`). No tabindex/role, no pointer/keyboard path.
- No skip link (`public/index.html:10`). Zero `skip` matches in scope.

## P1 — wrong behavior, fix next

**Server flow (agent 1)**
- `announceWaitingForSeat` blames current, not the disconnected next
  (`server/gameLogic.js:751-756`).
- `endGame` crowns disconnected ghost (`server/gameLogic.js:1004`). Fallback picks
  offline winner; require connected or `winner=null`.
- Voluntary leave burns creditor debt + cash to void (`server/rooms.js:595-604`).
  Hardcoded `null` creditor vs `bankruptcyApi.js:31-40` sweep; resolve
  `outstandingDebtFor` like `declareBankruptcy`.
- `pendingPaymentQueue` orphaned on leave (`server/rooms.js:625-632`). Stale entries
  gate casino/market/mortgage on ghost debt until something triggers a clear.
- Auction-lead quit keeps ghost floor vs disconnect reset (`server/rooms.js:698-704` vs
  `socketRuntime.js:553-560`). One rule for both; test at
  `audit-rooms-settle.test.js:179-186` enshrines the inconsistency.
- `houseLimit`/`hotelLimit` settings dead (`server/roomSettings.js:19-20`). Never read
  by `canBuildOnTile`/build action.
- `trading:false` blocks bots, not humans (`server/roomSettings.js:13`). No guard in
  `TRADE_PROPOSAL_GUARDS`.
- `getTile` strict miss vs purchase coerce (`server/gameLogic.js:268-270`,
  `server/propertyApi.js:129-130`). String index manageable nowhere, purchasable.
- Reconnect nickname bypasses started gate (`server/rooms.js:186-190` vs
  `appearanceApi.js:145-149`).
- Same account seats twice via fresh `clientId` (`server/rooms.js:244-255`). No
  account-duplicate check on the join path (restore path is pinned, join is not).
- `endTurn` silently cancels open sponsorship (`server/gameLogic.js:982-991`). Escrowed
  contributors cancelled without buyer resolve; gate like purchase offers.
- Match writer drops hybrid fields (`server/roomSetup.js:242-256`). History hybrids
  hollow downstream.

**Money/deeds (agent 2)**
- Swept cash lands on dead seat while deeds do not (`server/bankruptcyApi.js:103-108`
  vs `207-211`). `sweepCashToCreditor` has no bankrupt/disconnected guard;
  `totalCash()` excludes them, so the invariant breaks.
- Mortgaged siblings inflate rent ladders (`server/rentApi.js:54-58,67-79`).
  Mortgage one of two utilities, land on the other: 10x instead of 4x. Railroads same.
- Every deed-array assignment pushes without dedupe (`server/gameLogic.js:417-421`,
  `server/auctionApi.js:198`, `server/propertyApi.js:69`). Duplicates propagate through
  the forfeit loop, inflating group/collateral logic.
- Test enshrines sequestered bankrupt cash (`server/casino-bankruptcy.test.js:614`).
  Asserts liquidated cash stays on the removed seat.

**Contracts/economy (agent 3)**
- Counter/adjust skip table-obligation exclusivity (`server/contractLogic.js:239-297`).
  Propose checks 6 fields; counter/adjust check pair-active + funding only.
- Accept skips loan-backed recheck (`server/contractLogic.js:314`). Lender borrows from
  the bank after proposal, then borrower accepts loan-backed cash.
- Server ceil vs client round preview (`server/contractLogic.js:121`,
  `public/clientTradeUi.js:412,429-430`). $1 understatement on fractional premiums.
- Card rent shortfall drops equity remainder (`server/cardApi.js:192`). No hooks, unlike
  tile rent; remainder never splits to holders.
- Utility card ignores dice ladder/events/cap (`server/cardApi.js:206`). Single utility
  overcharges 10x vs 4x; ignores crisis/combo/cap. Railroad card uses `calculateRent`,
  asymmetric.
- Labor-strike maintenance shortfall forgiven (`server/globalEventsApi.js:392`). Broke
  developed owners escape; tax/rent shortfalls open debt instead.
- Sponsorship skips loan-backed + obligation gates (`server/sponsorshipApi.js:25-46`).
  Bank-loan cash sponsors deeds atop open contracts/trades/payments.
- Converted hybrid double-counts loan+equity (`server/accountStore.js:87-88,189,192`).
  Test at `hybrid-contract-achievements.test.js:51-54` enshrines it, and `:15-16` uses
  an impossible hybrid+collateral fixture.
- Move-card reveal hides salary+rent (`server/cardApi.js:76,101-106`). Shows neutral
  while awarding $200 + charging rent.
- Converted note keeps debt framing (`server/contractLogic.js:508`). Rail shows
  `$X REMAINING · DUE RY` for equity.

**Auth/sockets/stores (agent 4)**
- Invite-accept mutates seats before commit, never clears grace timer
  (`server/socketRuntime.js:694-720`). Failed invites leave orphan seats + membership.
- Private-code reclaim destroys grace-period room (`server/serverSocketAccount.js:136-147`).
  Reusing a code after victim disconnect deletes their room; restore can never succeed.
- Login/register per-socket limit, bypassable by reconnect (`server/server.js:31-34`).
  No per-account/IP bucket for credential stuffing, unlike social actions.
- Anonymous search unlimited; `report-player` unlimited
  (`server/serverSocketSocial.js:117-139`). Unauthenticated 3-char username enumeration.
- Expired invites stay listed pending (`server/socialStore.js:69-71,215-223`). 15-min
  expiry enforced only on click.
- Public leaderboard counts private/friends-only achievements
  (`server/accountStore.js:257-293`). `leaderboard.test.js` goldens enshrine the leak.
- Match annotation claims already-owned achievements; unlock/write not atomic
  (`server/socketRuntime.js:104-116`). Crash between the two persists skew.
- Stored market positions inner shape unsanitized (`server/matchStore.js:62-67`).
  Arbitrary types flow into window stats, unlike casino/contract entries.

**Bots (agent 5)**
- Post-roll actions invisible to bots (`server/botApi.js:131-151`). Humans can
  mortgage/market/casino/loan/contract/trade post-roll; bots return `[{roll}]`. Tests
  at `trades.test.js:750-754`, `botLogic.test.js:467` pin it.
- Jail parity branch starves normal actions (`server/botApi.js:134-136`). Jailed bots
  never build/manage/trade/market; humans do.
- All-bot basic trades impossible; sponsorship seeks only bot cash
  (`server/botApi.js:299`, `server/botLogic.js:242-246`). Early all-bot tables have zero
  1-for-1 proposals.
- Personality bonus double-counts collector premium (`server/botAdvisor.js:90-103`).
  Builder build 50 vs 10 (5x); planner cannot overcome.
- Planner no-op for contract/sell/unmortgage/bank-repay/jail (`server/botFuturePlanner.js:145-160`).
  Strategic rank of those lines is hash noise.
- Market evaluation always uses $100 (`server/botFuturePlanner.js:109-129`,
  `server/botStrategicContext.js:322-365`). Snapshot carries no quotes; bots buy tops.
- Rent projection linearizes hotel 125x to 3.25x (`server/botFuturePlanner.js:193-194`).
  Hotels undervalued ~38x; monopoly double ignored.
- Planner ignores parked debt (`server/botFuturePlanner.js:295-322`). Builds while
  owing larger debt; `Math.max(0,…)` floors hide insolvency.
- Opponent model is opponent-1; counts dead/jailed/mortgaged rent
  (`server/botFuturePlanner.js:139-143,193-201`). Multi-opponent trades score 0; risk
  overestimated.
- Contract accept omits disconnected lender; equity omits lender
  (`server/botLogic.js:68-74`). Test at `botLogic.test.js:95` pins equity-null-accept.
- Group completion paid twice, 80+90 (`server/botFuturePlanner.js:252,302-309`).
- Expert rollout dilutes base by /9 (`server/botAdvisor.js:73-87`). 30-point gaps
  compress to noise.
- Sim fingerprint omits obligations/votes; stall gate blind
  (`server/bot-simulation.test.js:22-40,108-113`). Vote-heavy games false-stall.
- Balance runner can hang; wrong entrypoint (`server/bot-balance-runner.js:6-15`).
  No timeout; bypasses `npm test` ordering.

**Client trade/rail/popup (agent 7)**
- Builder preview caps to deed price, SEND sends raw (`public/clientTradeUi.js:376-383`
  vs `304-313`). $500 requested on $220 deed previews $220, server accepts $500.
- Repayment schedule selector is dead (`public/clientTradeUi.js:47,262-269,480,997`).
  No server field; UPFRONT/CHECKPOINTS/MATURITY do nothing.
- Equity preview uses static base rent (`public/clientTradeUi.js:344-348,390-406`).
  Ignores houses, monopoly double, all events.
- Offer blocks + deal terms show premium%/rounds on equity
  (`public/clientRailRender.js:324-327`, `public/clientDealUi.js:41-49`). Premium never
  applies; FOREVER shown as raw rounds.
- NEED-YOU count ignores responder trades (`public/clientRailRender.js:416-425,557-563`).
  Zone labels NEED YOU while header reads 0.
- Every rail rebuild collapses bank `<details>` and wipes typed amounts
  (`public/clientRailRender.js:221-228,286-290,50-53,394-395`).
- SEND gating omits turn/obligation/loan-backed; recipients include dead seats;
  deeds include encumbered ones (`public/clientTradeUi.js:255-260,1189,1315-1360`).
- Popup BUY enabled for any unowned deed (`public/clientPopupUi.js:177-200`).
  Server requires open-offer match; only the landed tile ever succeeds.
- Auction passed/leader buttons stay enabled; stale formatting; no winner feedback
  (`public/clientAuctionUi.js:50-54,155-183`).
- Lobby settings leak between rooms; stale preview seats/cash
  (`public/clientLobbyUi.js:330-333,400-425,449-486,524-528`).

**Client shell functional (agent 8)**
- Toast dismiss pointer-only + hidden from AT (`public/clientSocialSurfaces.js:91-98`,
  `public/index.html:14`). `tabIndex=-1`, `aria-hidden`, 18px target.
- Stacked-surface Escape uses fixed gate order, not topmost
  (`public/clientKeyboard.js:114-137`, `public/clientSurfaces.js:97-108`). Closes the
  wrong modal.
- `closeAllSurfaces` discards return focus (`public/clientSurfaces.js:174-185`).
  Focus drops to body.
- Log-drawer key path never moves focus; drawer outside surface controller
  (`public/clientLogDrawer.js:67-75`, `public/clientSurfaces.js:11-15`).
- Global shortcuts fire from SELECTs/buttons and while drawer open
  (`public/clientKeyboard.js:29-38,203-239`).
- Swatch buttons have no accessible name (`public/clientProfileRender.js:645-653`).
- Home alias form has no submit control (`public/index.html:173-177`).
- Signed-in achievement unlocks silently no-op locally
  (`public/clientAccountIdentity.js:201-215`). Guests get feedback; signed-in get none.
- Drawer filters convey state by class only (`public/clientLogDrawer.js:30-34`).
- Profile cap uses blocking `alert()` (`public/clientProfileBindings.js:226-232`).
  Buttons already disable; the alert is redundant + focus-stealing.
- `data-sprite="logo"` has no definition; `icons.svg` unused
  (`public/index.html:20`, `public/icons.svg:2-23`).

**Accessibility (agent 8, WCAG 2.2)**
- Focus lost on several closes: night-shift stop, helicopter hide, mass-close
  (`public/clientNightShift.js:627-644`, `public/clientHomeAmbient.js:64-73`).
- `:focus-visible` incomplete + two `outline:none` overrides
  (`public/styles.css:122-127,1074,2858-2859`). Selects/tabs/options invisible focus.
- Chat + turn status have no live region (`public/index.html:593-595,555,685,692`).
  Only system/error announcers speak.
- Errors `role=alert` but not tied to inputs (`public/index.html:176,275`,
  `public/clientAccountIdentity.js:268,308,358`). No `aria-describedby`/`aria-invalid`
  wiring except username.
- `role=tab` widgets lack arrow-key pattern except profile tabs
  (`public/index.html:435`, `public/clientProfileBindings.js:200-219`).

## P2 — edge cases, papercuts, hygiene

- Restart resurrects disconnected ghosts; `seatIsIdle(null)` stalls on stale turnOrder;
  avatar wire/direct validator split; `participantFields` live-vs-record drift (agent 1).
- Auction overwrite + no finish identity + stale-bid stall + leaderless floor blocks
  rebids (agents 1+2: `server/auctionApi.js:27-36,122-147`, `rooms.js:698-704`).
- `payEach` split order-dependent; `move` never pays salary + strike copy overreaches
  during shutdown; tests enshrine `bogus→loan` sanitizer fallback (agent 3).
- Orphaned lifecycle fields: contract rounds, `rentCollected`, `averageCost`,
  `crisisMarketBuys`, `buyerCash` written, never read (agent 3).
- Repay preview schedule/cap/base fictions; pending deal view omits drafted
  remaining/due-round; rooms failure wipes directory + late-response race;
  `data-finance-open` mode param dead (agent 7).
- Three avatar validators diverge + raw grid stored; color/avatar change allowed
  mid-game; bot palette 3-cycle vs 4 presets + full-table duplicate fallback; dual
  AFK/turn timers with no idempotency; contract-cancel dedupe keyed by ephemeral
  socket.id, never pruned; social rate buckets unbounded; one blocked pair mutes
  sender to entire room; friend requests never expire (agent 4).
- Floating-point trade bar (`440*1.1` rejects fair); single-step planner traps
  mortgage-then-build; bots never adjust/cancel/withdraw/decline (agent 5).
- Group/kind vocabulary parity is display-safe today; dead utility ladder rows;
  `esc()` missing `'` (safe today — no single-quoted attrs) + unvalidated server color
  into `style`; synced-but-unstored fields (`globalEventHistory`, `properties`,
  `casinoNet` always 0) (agent 6).
- Stale save resurrects wrong-room Resume affordance; deed-detail assumes
  player+tile exist; house-cost event multiplier not shown + build enabled when server
  rejects; mortgage figures + gating unmirrored (agent 6).
- Guest alias duplicates; reduced-motion night shift never misses (free win);
  `logo` sprite; contrast risks in muted/placeholder tokens; time-limited arcade has no
  pause/extend; session-timeout warning absent; log-drawer semantics; focus-not-obscured
  offsets (agent 8).

## Tests enshrining wrong behavior (fix alongside code)

- `audit-rooms-settle.test.js:179-186` — quit-keeps-floor vs disconnect-resets.
- `casino-bankruptcy.test.js:614` — liquidated cash stays on removed seat.
- `hybrid-contract-achievements.test.js:46-54` — converted double-count; `:15-16`
  impossible hybrid+collateral fixture.
- `leaderboard.test.js:16-17,30-35,62-65` — private achievements in public goldens.
- `match-history-schema.test.js:34-36` — annotation claims unowned unlocks.
- `audit-cards-match.test.js:181` — `bogus→loan` fallback pinned.
- `trades.test.js:750-754`, `botLogic.test.js:467` — bots roll-only post-roll pinned.
- `botLogic.test.js:95` — equity accept with null lender pinned.
- `botLogic.test.js:70-75` — floating-point bar pinned as spec.

## Verified-clear (do not "fix")

- Anytime-trading has no turn guard by documented design (`tradeApi.js:20-23` + test).
  Counter off-turn is intentional as a response path.
- Guest `clientId` bearer, new-tab-in-grace rejection, grace `socketId` double-checks:
  pre-existing design, unguessable ids, declared correct.
- Auction charge-before-transfer ordering, purchase/build/unmortgage affordability,
  trade same-deed/coercion/cash revalidation, loan grace/default single-charge,
  NaN guards (`Number.isFinite` throughout), pending-payment queue exactness,
  mortgage encumbrance gates: all verified correct.
- `transferMoney` is dead code, not wrong code. `resumeGame` ignores bytes by design
  (server-authoritative; save is a button flag only).
- Store atomic write + quarantine of *parse* failures, CORS fail-closed, per-socket
  limiter, handler registration, safe-emitter isolation: verified correct.
- Socket/event-name parity both directions verified (14 client listeners ↔ server
  emits; all client emits have handlers; 8 registered-but-unemitted are
  snapshot/summary paths).
- Contract responder parity (depth math matches both sides), even-build mirror,
  railroad table, jail fine, sprite sets, board price defs: verified correct.
- Random ranges inclusive-correct; Fisher-Yates correct; seeded planner/advisor
  deterministic; runner divisions guarded.
- Dialogs have roles; inputs have labels; audio toggles labelled; virgin states
  render; no keyboard trap; forced-colors fallback present.

## Suggested fix order

1. Session logout/hash purge + cached-id trust (auth hole, small).
2. Equity clearing on auction/bank-release + debt-mode order + hybrid default leg
   (money integrity, one theme).
3. Mortgage/unmortgage multiplier symmetry + in-flight rent on creditor death +
   lender-gone repay guard (money integrity).
4. Market per-tick compounding — needs a product call (one-shot shock vs pressure).
5. Trade popup Decline + negotiation deed side + NEED-YOU count + bank memory
   (biggest user-facing cluster).
6. Client rent truthfulness (utilities, per-tile, doubling, events, phantom sets) —
   consider a single server-computed `rentDue` per tile instead of reimplementing.
7. Bot liveness gate (one check in `botActionRejection` covers most) + jail/post-roll
   candidate unions.
8. Privacy scoping (`accountId`, leaderboard, search) + store shape quarantine.
9. Stats double-count + match writer fields + enshrined-test corrections.
10. A11y cluster: skip link, canvas input, focus restore, Escape order, live regions,
    focus-visible, error tying.
11. Copy batch (premium on equity, dead schedule, BUY gating, stale settings) +
    44px/mobile pass.
