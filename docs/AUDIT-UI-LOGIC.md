# Full UI + Logic Audit (historical snapshot)

_Original date: 2026-09-07. Method: five parallel read-only audits (server logic, client modals, socket parity, rail/state-sync, appearance+hybrid edges)._

> **Status: SUPERSEDED.** This snapshot was captured before the latest modular
> socket/client changes and PRs #40–#44. Do not use the findings below as the
> current release checklist. Several server crashes, field mismatches, and
> contract-guard findings were fixed afterward. The current verification is
> `npm test`, `npm run lint`, coverage, and the live PR workflow.

## Resolution ledger (2026-09-07)

- Fixed: utility-card rent now uses the normalized minimum dice total.
- Fixed: friends-only achievements are hidden from outsider player cards.
- Fixed: partial bank/player-contract repayment controls are wired to server amounts.
- Fixed: hybrid contracts contribute to loan/equity stats and achievements.
- Fixed: the setup close, bankruptcy close, rooms opener bindings, confirmation listener, and log-drawer focus seams.
- Fixed: the PR workflow now runs the full test command and checks every public JS module.

The remaining historical notes are retained below for traceability only.

_Severity: CRASH (throws) > WRONG-BEHAVIOR (runs, wrong result) > DEAD-END/UNWIRED/DEAD-BUTTON (UI unusable) > FIELD-MISMATCH/INFO-GAP > INCONSISTENCY > NOTE._

---

## CRASH

- `server/contractLogic.js:369-378` — `recordHybridConversion` derefs `lender.id` with no guard. `hybridConversionEligible` checks borrower + property + cap but never lender. A lender removed via `removePlayerByClient` (splices, `server/gameLogic.js:234-239`) before the cure+1 tick throws TypeError; the null-safe feed line runs after the crash. Borrower-null IS covered (falls back to `handlePlayerLoanDefault`, null-safe).
- `server/contractLogic.js:221` — `recordEquityShare` derefs `getTile()` result unguarded. Null-safe siblings exist (`expireEquityContract`, `terminateEquityContract`, `settleEquityShares` all guard). Same shape as above, older.
- `server/auctionApi.js:161-177` — `completeAuctionSale` transfers the deed (ownerId, properties push, auctionWins) BEFORE `chargePlayer`. If charging opens debt settlement, the seat already holds the deed. Winner eligibility (`:149-153`) checks bankrupt/disconnected only, never cash — compare `acceptPurchaseOffer` (`server/propertyApi.js:40`), which deducts cash before transfer and checks cash first.

## WRONG-BEHAVIOR (server)

- `server/gameLogic.js:860` — `settlePendingEquityShares` replays only equity on remainder; generic `hooks.onPaid` (tax to vacation pool, `server/tileApi.js:157`) fires on full-pay (`:772`) and partial (`:783`) but is dropped on remainder. Remainder of vacation-tax never reaches the pool.
- `server/cardApi.js:112` — `cardRentPayable` checks existence/self/mortgaged only. Tile rent (`server/tileApi.js:214`) also blocks bankrupt owner + jailed owner with `noRentWhileInPrison`. A `nearestTileCard` (`:170`) can credit a bankrupt/jailed creditor via `creditRentTo` (`server/gameLogic.js:809`, no bankrupt check).
- `server/rooms.js:169-178` — reconnect applies a colliding face unchecked when color is omitted/invalid: `refreshReconnectColor` early-returns, so `resolveFreeAppearanceColor` never runs, then `refreshReconnectAvatarGrid` sets any array blindly. `setPlayerAppearance` would reject the same identity.
- `public/clientRailRender.js:330-338` + `server/contractLogic.js:452-456` — third-party contract rows render garbage zeros. Non-party contracts are redacted to id/kind/status/names, but `contractRowDetailHTML` reads `remaining/dueRound/conversionShare/equityShare` → `$0 REMAINING · DUE R0 · CONVERTS 0%` / `0% EQUITY` on every non-party row.
- `public/clientRailRender.js:364-366` + `public/clientRailEvents.js:147-156` + `server/contractLogic.js:66` — rail hybrid form has no `conversionShare` input and the payload never sets it; server defaults `Number(...)||25`. Rail hybrids are always 25%, unsettable. Rail equity also drops `equityControl` → silent `passive`; `permanent: "on"` works only by truthiness accident.
- `server/cardApi.js:198` — `cardRentAmount` utility uses raw `lastDice` sum (0 pre-roll) vs `diceTotal` (`server/rentApi.js:72`) floored at 2.

## DEAD-END / UNWIRED / DEAD-BUTTON (UI completeness)

- `public/clientTradeUi.js:471` — financing CONTRACT surface: OPEN OFFER button sets `data-finance-surface="offer"` which nothing reads (handler `:541` only reads `data-financing-surface`). Click does nothing.
- `public/clientTradeUi.js:471` — BUYOUT · FINANCE RAIL button `disabled` forever, no id/listener.
- `public/clientTradeUi.js:474` — TRANSFER · FINANCE RAIL button `disabled` forever, no id/listener.
- `public/clientTradeUi.js:477` — DEFAULT surface PAY OUTSTANDING / TAKE COLLATERAL / BANK AUCTION all `disabled`, static placeholder copy, no send path.
- `public/index.html:755` — MANAGE PORTFOLIO button dead: class-only `rr-manage`, zero listeners in `public/*.js`.
- `public/clientRoomsUi.js:439` — openers bound to `#browse-rooms-btn/#open-rooms-btn/#create-room-btn`, which have no markup; `index.html:153` only has `#open-create-btn/#open-join-btn`.
- `public/clientGameModalsUi.js:280` — Declare Bankruptcy never closes its modal (`bankruptPlayer:195` emits, no `closeSurface`); sibling liquidate (`:275`) and retire-confirm (`:306`) both close.
- `public/clientTradeUi.js:143` — solo table gets an empty Counterparty picker: `financingRecipients()` returns `[]` → empty listbox; `openFinancingModal:617` has no solo guard, unlike `openTradeModal:782`.
- `public/clientRailRender.js:345-349` vs `server/contractLogic.js:281-287` — rail shows REPAY for any loan/hybrid where `toPlayerId` matches, no status check; server requires active/due. Converted hybrids are live and listed, so the button always fails with 'That loan is not available to repay.'
- `public/clientRailEvents.js:117` — `data-buy` handler dead in rail: `railDeedRowHTML` never passes `action`, so `deedActionHTML` returns `""`. Handler exists, nothing renders the trigger.
- `public/clientSocialSurfaces.js:902` — BOT/self player card dead-ends: `canSocial=false` disables friend/invite/history/block/report, yet still opened via BOT `VIEW` row (`:162`).

## FIELD-MISMATCH / INFO-GAP (client↔server)

- `public/clientRailEvents.js:103` vs `server/loanLogic.js:200-201` — `repay-bank-loan` sends `{requestId}` only; server reads `{amount, requestId}` (defaults full payoff). Partial bank repay impossible from UI.
- `public/clientRailEvents.js:66` vs `server/contractLogic.js:289-295` — `repay-player-contract` sends `{contractId,requestId}`; server reads `{contractId,amount,requestId}` (defaults remaining). Partial player-loan repay impossible from UI.
- `public/clientRailRender.js:365` vs `server/contractLogic.js:151,161` — rail form never sends `conversionShare`/`equityControl` (see WRONG-BEHAVIOR above); financing modal sends both correctly.
- `public/clientRailRender.js:365` vs `server/contractLogic.js:114,141,160` — rail form always sends `propertyIndex` (ignored for loan), `collateralTileIndex` (ignored for equity/hybrid), `equityShare` (ignored for loan). Harmless but misleading inputs.
- `public/clientRailRender.js:313-316` vs `:323-328` — incoming offer block shows kind/amount/premium/duration only; conversion share + target deed hidden. Borrower accepts blind to default terms.
- `server/contractLogic.js:384-395` — conversion leaves `remaining/totalDue/dueRound` intact and the rail reuses the debt-framed detail: a converted row reads `$X REMAINING · DUE RY` though the debt leg is over and it now earns as equity.
- `public/clientRailEvents.js:89-96` vs `server/serverSocketGame.js:50` — market-order ack `{order,economy}`: client merges `economy` only, ignores `order`.
- `public/clientRailEvents.js:182-189` vs `server/serverSocketGame.js:129` — casino ack `{result,economy}`: client merges `economy` only; pocket/resultColor/net never rendered.
- `server/contractLogic.js:257-261` — decline returns `{accepted:false}` with no contract, relay skipped, `onPlayerContractUpdate` never fires. Proposer learns of declines via state snapshot only.
- `public/clientRailRender.js:167` vs `server/summaryApi.js:63-86` — render reads `state.players[0].marketPositions`, but `summaryPlayerEntry` never sends it (pinned absent). Sync falls back to `{}`, so quantities read 0 and SELL is always disabled from this path; live positions land at `state.economy.market.positions`, which render never reads. **Market SELL may be broken from the rail.**
- `public/main.js:430` vs `public/clientStateSync.js:95-118` — `playerStatusLabel` reads `p.personality`; `serverPlayerView` never maps it. Always `undefined`, masked by `||"survivor"` (wrong label for non-survivor CPUs).
- `public/clientRailRender.js:68-72` vs `server/loanLogic.js:116-126` — render reads `loan.collateralName||"NONE"`, but `issueLoan` stores `collateralTileIndex` without `collateralName`. Active bank loans always show NONE.

## INCONSISTENCY (guard/flow parity)

- `server/tradeApi.js:23` — proposal blocks only `pendingTrade||pendingPlayerContract`. Five-field gates exist elsewhere (`TABLE_OBLIGATION_FIELDS`, `tableObligationPending`, market guards). Trades can be proposed during `pendingPayment`/auction/`pendingPurchaseOffer`. No turn guard either (contracts, market, bank loans all have one). Accept-side (`:58`) checks both sides' cash but proposal (`:42`) checks only the proposer's — unpayable `requestCash` passes proposal, fails on accept.
- `server/contractLogic.js:214` — `lenderCanStillFund` checks lender liveness, never borrower liveness. A bankrupt/disconnected responder still activates a contract. Trade settlement checks both sides.
- Obligation cleanup disagrees per path: `clearQuitObligations` skips `pendingPayment`/auction; `markPlayerBankrupt` clears only debtor payment; `handleDebtSettlement` clears none; `clearPendingSeatObligations` (`server/rooms.js:489`) skips auction; `endGame` (`server/gameLogic.js:934`) leaves `pendingPlayerContract`/`pendingPayment`. Creditor-leave never clears `pendingPayment` (shape is `playerId/creditorId`, but `involvesPlayer` checks `from/toPlayerId`; cancel table covers trade/contract only).
- Auction lead revoke parity: `revokeAuctionLead` (`server/rooms.js:519`) nulls bidder but keeps bid vs `revokeAuctionLeadIfLeader` (`server/socketRuntime.js:384`) resets both. Stale bid blocks rebids (`auctionPriceRejection`); neither prunes `participants`, so `recordAuctionPass` minority-count can stall to timer.
- Reconnect parity: `Room.reconnectPlayer` (`:153-161`) restores nickname/color/grid/accountId; `RoomManager.restoreConnection` (`:406-415`) touches only `socketId`/`disconnected`, dropping appearance changes on that path.
- Bot seating: `ensureBots` (`server/rooms.js:266`) cycles 3 hard colors with no identity resolution (humans get `resolveFreeAppearanceColor` everywhere else). Bots can duplicate a human icon; also bypasses `canJoin` (humans-only count).
- `server/propertyApi.js:113-118` — `propertyActionRejection` returns null for mortgage/unmortgage, bypassing turn/rolled/pending gates that build/sell get; `manageProperty:90` has no bankrupt/disconnected/pending/auction/trade/contract check anywhere (casino, market, contracts all gate).
- `server/propertyApi.js:27,68` — purchase-offer accept/decline check offer-match + cash only: no bankrupt/disconnected/turn. A bankrupt offered seat can still accept. `getTile` uses `===`, so a string `tileIndex` misses where trade coerces with `Number()`.
- `server/loanLogic.js:90-95` — `takeBankLoan` facility path has no bankrupt/disconnected/`inDebt` guard (repay path checks turn; issue path checks neither turn nor liveness). `!player` returns misleading 'Bank lending is disabled.'
- `server/gameLogic.js:841` — `pendingPayerCanSettle` checks bankrupt only, not disconnected (trade/casino/market settlement check both).
- `server/gameLogic.js:899` — `pendingFlowRejection` blocks end-turn on auction/offer/payment only, not `pendingTrade`/`pendingPlayerContract`. `nextTurn:681` clears only `pendingPurchaseOffer`.
- `public/clientLobbyUi.js:216-225` vs `:232-236` — customs never show TAKEN while presets check taken-identities: client shows AVAILABLE for a custom face the server rejects. Exact AVAILABLE-but-rejected break (also: pre-snapshot local `buildPlayers` seats lack `clientId`, so self + preview bots pollute the taken set and grey presets before server data arrives).
- `server/appearanceApi.js:90-92` vs `server/accountStore.js:104-112` — appearance payloads accept ANY array (no 8x8/hex validation, no size cap); only the account path sanitizes. Malformed grids get distinct non-`generic` signatures and render blank; unbounded grids are signed/stringified per snapshot.
- `public/clientSprites.js:123-125` — all-null 8x8 grid (`emptyFaceGrid`) is a distinct identity from `generic` yet renders as an empty SVG. It may share a color with a generic seat while showing nothing.
- `server/matchStore.js:77` vs `server/roomSetup.js:231-243` — `sanitizeContractEntry` collapses `hybrid→loan` and drops `conversionShare/propertyIndex/equityControl`; lifetime stats match hybrids against neither loan nor equity predicates (invisible); achievements never fire on hybrids; repaid hybrids are wrongly eligible for `silent-partner` (never set collateral); history UI mislabels hybrids as loans; `collateral-damage` can never fire on hybrid fallback-defaults.

## NOTES (verified, no action or already understood)

- Socket parity is otherwise clean: all 53 client emits have server handlers, all 14 server relays have client listeners, no orphans either direction. 8 registered-but-unemitted social handlers (`get-bank-loan-offer`, `get-self-profile`, `get-friends`, `get-friend-requests`, `get-notifications`, `remove-friend`, `get-recent-players`, bare `get-leaderboard`) are covered by snapshot/summary paths not direct emits.
- Rail dispatch is otherwise clean: all rendered `data-*` actions have handlers; `data-deed-open` binds via `bindDeedDetail`, not the rail table, by design. Market quantity clamp and casino field mapping match both sides.
- Empty states all guarded (deeds/trade/log/contracts/others/market). `client-state.js` legacy `applyServerState` is test-only dead code, live path is `clientStateSync.js`.
- `public/clientRailEvents.js:100` — bank-action ignores `disabled` (native disabled buttons don't fire; cosmetic only).
- Double-submit: every SEND attaches `requestId` and the server memoizes; two limits — default-host `createRequestId: noop` yields no dedupe, and no button disables while pending (second propose dies noisily on the pending guard, second accept on consumed pending).
- `expired` status unreachable for hybrids by design (no `expiresRound` drafted); paid/defaulted/terminated vanish from rail while converted stays — intentional asymmetry, no history surface for any kind.
- Modal extras harmless: loan `propertyIndex` sent but unread; equity `premiumRate: 0` stored but unused.
- `due` for `equity` is a dead status (consumed in status lists, never produced — only loans go active→due).
- `cardRentAmount` utility uses raw dice sum (0 pre-roll) vs floored `diceTotal`.
- Three wordings for one gate (`contractLogic.js:53` vs `economyApi.js:97` vs `marketLogic.js:23`) prevent client-side branching on errors.
- `public/clientKeyboard.js:137` card-Escape gate inverted vs scrim (Escape blocked while scrim still closes); `clientSurfaces.js:220` confirm-scrim listener accumulates per open; `clientLogDrawer.js:59` drawer close drops focus; `clientAccountIdentity.js:175` return-focus ordering vs `openSurface`; setup overlay has no visible close (Escape→goHome only); `clientRoomsUi.js:267` `#mini-grid` handler reads a missing element (guarded, dead).
