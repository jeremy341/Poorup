# Deep audit — 10-agent pass (2026-09-08)

Method: ten parallel read-only audits with disjoint scopes, then direct re-reads of every CRASH / AUTH / MONEY claim before publishing. No code changed.
Legend: **[V]** = verifier read the exact lines this session. **[R]** = agent-reported with exact file:line, not independently re-read — confirm before acting.
Follows `docs/AUDIT-2026-09-08.md`; items fixed since are not relisted.

## P0 — fix first

- **[V] Logged-out session tokens still authenticate** — `server/accountStore.js` `logout` deletes the live token from `sessions` and nulls `account.sessionTokenHash` but never deletes the hash from `sessionHashes`. `sessionAccount` (`:418-427`) falls back to `sessionHashes.get(hash)` → hit → **re-animates the session** and returns the account. Any logged-out token works indefinitely (process lifetime). Same root cause in `issueSession` (`:429`): only the currently-stored hash is deleted, older hashes linger and re-animate. Fix: delete hash entries on logout/rotation, not just the live token.
- **[V] Auctioned deeds keep live equity shares + deed arrays dupe** — `server/auctionApi.js` `transferAuctionDeed` resets owner/mortgage/houses but never terminates `equityShares` (compare `gameLogic.js:390` used everywhere else): the new owner pays the old owner's equity holders real money. And `attachDeedToOwner` (`gameLogic.js:417`) plus `transferAuctionDeed` both `push(tile.index)` with no dedupe check — re-entrant settles duplicate the deed and inflate counts.
- **[V] Counter/negotiate bypasses table obligations** — `server/contractLogic.js` counter/adjust use `contractProposalRejectionWithoutTurn` (pair-active + funding only); the `tableObligationOpen` check that `proposePlayerContract` enforces is absent. Low blast radius (same two parties) but breaks the mutual-exclusion invariant.
- **[V] Disconnected bots act, including bankruptcy** — `server/botApi.js:108-126` rejects only non-bots; `actAsBotSocket` swaps `socketId` so liveness checks pass. `bankruptcyRefusal` (`server/bankruptcyLogic.js:62-67`) omits `disconnected`. A dead bot seat can act and self-bankrupt.
- **[V] Converted hybrids double-count in stats** — `server/accountStore.js:88-89`: `loanLike` matches any hybrid, `equityLike` matches converted hybrids → converted notes count in both `playerLoansGiven` and `equityDeals`.
- **[V] Match writer drops hybrid fields** — `server/roomSetup.js` `matchRecordPlayerContracts` emits 11 fields without `propertyIndex/conversionShare/equityControl`, so the matchStore preservation work never receives them; history hybrids are hollow.
- **[V] `accountId` broadcast to all viewers** — `server/summaryApi.js:87` sends stable cross-game identity to the whole table while sibling fields are self-scoped. Privacy leak; scope it like the rest.

## P1 — verified wrong behavior

- **[V] Market crash modifier compounds per tick** — `server/marketLogic.js:54` multiplies live quotes by the event modifier every round (`0.65^7` → floor, `1.15^7` → explode). Needs a product call: one-shot shock vs ongoing pressure.
- **[V] Unmortgage ignores event multipliers** — mortgage pays `floor(price/2) × propertyValueMultiplier`, unmortgage charges `ceil(floor(price/2) × 1.1)` (`server/propertyApi.js:280-297`). Under a 0.8x bubble you get 0.4× out and pay 0.55× back. Asymmetric by accident, not design.
- **[V] Manage path takes raw tile index** — `server/propertyApi.js:129-130` `getTile(tileIndex)` with `===`; string indexes miss where purchase coerces (`Number()`). Same class as the fixed purchase path.
- **[V] No local house-count cap** — `server/propertyApi.js:248` `houseCount+1` unchecked; overflow breaks `buildingRepairCost` and the rent clamp. Cap at 5 where built.
- **[V] Mortgaged siblings count toward rent ladders** — `server/rentApi.js:67,78` count mortgaged utilities/railroads toward 4x/10x. A mortgaged deed should not boost rent.
- **[V] Utility card ignores dice rules** — `server/cardApi.js:207` uses `multiplier||10`, skipping the `>=2?10:4` rule and energy-crisis multipliers in `rentApi.js:25,28,64`.
- **[V] Card collect mismatch** — `server/cardApi.js:136` adds `0` on missing amount while the reveal reports `200` (`:95`); move cards skip Start salary (`:169-176`); pay paths swallow pending/bankrupt outcomes (`:143,192`).
- **[V] Negotiation lists the wrong side's deeds** — `negotiationOwnedPropertyOptions` filters `owners==="p1"` always. Builder correctly uses recipient deeds, so countering equity/hybrid offers lists YOUR deeds for a stake in THEIR property → guaranteed server rejection or wrong terms.
- **[V] Loan preview disagrees twice** — modal uses `Math.round`, negotiation uses `Math.ceil` (server uses ceil), so the same premium can show three values across surfaces. Off-by-one lies.
- **[V] Preview cap vs send raw** — preview clamps amount to tile price, SEND transmits raw. For loans ( unrelated to tile price) the preview is fiction.
- **[V] Equity offers display meaningless premium/term** — offer block always prints `% PREMIUM · N ROUNDS`; premium never applies to equity.
- **[V] Client rent data wrong three ways** — group tables disagree with tile defs AND server (`cyan base 14` vs Kumasi `16` everywhere authoritative); utility ladder shows flat 12/24/48/72 vs dice×(10|4); `rentFor` ignores monopoly-double, mortgage-zero, and events. Deed cards/popups show figures the server never charges. Core numbers — fix the data, not the views.
- **[V] Deeds ladder phantom sets** — `countOwnedGroup` matches `undefined===undefined`, so unowned railroads count as a held set and highlight ladder rows.
- **[V] Deed-detail offers what server refuses** — build/mortgage buttons ignore turn/roll/debt/auction/trade gates; mortgage offered with houses standing. Server rejects gracefully, but every such button is a lie.
- **[V] Popup BUY over-promises** — shown whenever unowned + affordable + your turn, with no pending-offer check; server requires a matching open offer. Downgrade to honest disabled state with reason.
- **[V] NEED YOU count misses responder trades** — header counts offer + due debts; incoming trades render but never increment N. Count only `toPlayerId===me` trades (proposer-side ones correctly excluded).
- **[V] Bank `<details>` amnesia** — rail rebuilds `innerHTML` every render with no `open` memory; an opened bank section collapses on any chat/turn tick.
- **[V] Offer popup has no Decline** — Accept/Negotiate only; scrim/Escape just closes while the single-slot server offer stays pending, blocking all future trades. Workaround (deal view) exists; the popup needs the button.
- **[V] Face canvas is mouse-only** — `clientProfileBindings.js:353` binds mouse events only. Mobile/keyboard users cannot paint. Biggest a11y gap in the pass.
- **[V] Toast close unreachable by keyboard/SR** (`clientSocialSurfaces.js:94`); **no skip link** (`index.html:1-13`); **trade modal never restores focus** (both open sites; negotiation does); **log-drawer key path drops focus**; **native `alert()`** on profile cap (`clientProfileBindings.js:228`); **home alias form has no submit button** (Enter works, mouse users get nothing).
- **[V] `topNav` turn tag unguarded** — `state.players[state.turnIndex].name` throws on empty/OOB roster. Edge-reachable only, guard it.

## P2 — agent-reported, confirm before acting [R]

- Rooms/sockets: lobby-switch bypasses lifecycle (`socketRuntime.js:218`); invite-join never clears grace timer (`:694-720`); seat mutated before invite commit (`:702-714`); private-code steal during grace (`serverSocketAccount.js:142-144`); no-host dead-end (`socketRuntime.js:185-195`); turn-timer dual mechanisms without idempotency (`:629-659`); auction finish without identity guard (`:505-515`); contract-cancel idempotency keyed on socket id (`serverSocketGame.js:88-89`) + no counterparty relay on cancel (`:107-115`); counter-contract relay notifies wrong seat (`:47` — verify, high value if true); stale socket auth trust (`socketHandlerSupport.js:31-42`); guest clientId bearer (`serverSocketAccount.js:84-92` — pre-existing design, unguessable ids, low); social search enumeration + missing rate limits (`serverSocketSocial.js:133-139,95-101`, `socketSocialApi.js:230-246` clean-run misses).
- Economy/cards: market buy cash-vs-loan precedence + hand-built-player crash (`economyApi.js:220-226`, `marketLogic.js:85-95`); rent zero-multiplier handling (`rentApi.js:28-30`); global building-maintenance partial-pay (`globalEventsApi.js:392-411`).
- Stores/bots: achievements visibility always-`[]` (`accountStore.js:304` vs `:713`); windowed patrol copies lifetime (`:680`); participant live-vs-record drift (`participantFields.js:34-35,72,97`); social invite expiry/validation (`socialStore.js:231,240`); match positions unclamped + `averageCost` dropped (`matchStore.js:65`, `roomSetup.js:228`); bot jail path skips parity candidates (`botApi.js:134`); all-bot tables can't deal (`botApi.js:299`); advisor double-count (`botAdvisor.js:99`); achievement scope flip (`achievementStore.js:88`); `shuffleArray` in-place aliasing (`gameData.js:108` — single caller, likely harmless).
- Client shell: setup-wrap always-"visible" poisoning focus tracking (`index.html:644` + `clientSurfaces.js:36-40`); bankruptcy-modal Escape falling through to game shortcuts (`clientKeyboard.js:114-137` + Escape-order vs paint-order mismatches); setup-Escape forcing goHome (`:194-195`); gameOver swallowing all Escape (`:148-151`); shortcut guards missing SELECT (`:29-33`); night-shift reduced-motion hole (`clientNightShift.js:198-201`); auction broke/pass-silent/bid-$ gaps (`clientAuctionUi.js:185-189,155-158,53-54`); resume/save staleness (`clientGameSave.js:46-64,117-123` — authoritative-restore by design, loader is button-flag only); `showView` never closing surfaces + raw classList desyncs (`main.js:565-585,550-558`); rooms directory failure wiping cache + late-response race (`clientRoomsUi.js:227,204`); login skipping seat sync (`clientAccountIdentity.js:226`); invalid-save silence + alias rule bypass + setup-return dead path (`clientProfileBindings.js:150,86`, `clientHomeEntryBindings.js:51`); quick-table settings leak + bot preview cash (`clientLobbyUi.js:722,407`); profile-delete UI refresh gap.
- Copy batch: em dashes (`gameData.js:74+`, `clientBoardData.js:90+`, `clientDeedDetailUi.js:100`, `clientGameModalsUi.js:77,256,286`, `clientPopupUi.js:151,153,174,259`, `clientRoomsUi.js:209`, `clientSurfaces.js:120`); case splits (sentence vs Title vs CAPS across rail/modals/cards/social); numerals vs spelled-out; vague CLOSE/OK/Cancel/Accept; errors without next steps (`tradeApi.js:69,138,169`, `contractLogic.js:231,265,359`, `auctionApi.js:49,84`, `clientDealUi.js:105`, `clientTradeUi.js:325`, `clientRailEvents.js:88`); raw vs grouped currency.
- Mobile/visual: sub-44px targets (`styles.css:1423,1330,1073,2750`, market/BUY-SELL/VIEW/picker buttons); 360px squeeze (market rows, contract rows, rights grid); ellipsis without `title` fallbacks; modal width jumps; hardcoded colors bypassing vars; static inline styles; shared z-70 modal stacking.

## Corrections — claims refuted or downgraded on re-read
- "EXPLOIT: anon hijacks seats" and "disconnected-seat hijack": pre-existing bearer-token design, not new holes; exploitation needs an unguessable clientId. The account check only *added* auth. Not actionable.
- New-tab-in-grace rejection: correct tab-isolation behavior, not a bug.
- Space double-roll: `preventDefault` + server stage guards cover it.
- Casino stake clamp, bank-action refresh, profiles `.name`: present/working, not bugs.
- Redacted VIEW and gone-contract paths degrade gracefully (notice + picker); papercuts at most.
- `consecutiveDoubles` leak, `_advancingRound` stuck flag, crisis-buys crash, summary auction crash, transferMoney negatives, startAuction null-tile: refuted (resets/finally/inits/guards present; transferMoney is dead code, not wrong code).
- `resumeGame`/loader, decline visibility, casino result, timers, persistence, socket parity: verified fine, no action.
- Build/sell "bypass": turn + own-debt gates exist; only cross-obligation overlap remains — low.
- esc() quote gap: no single-quoted attr contexts found; hardening note, not a hole.
- HUD `cur` crash: unreachable in practice (empty roster mid-playing can't occur); guard anyway, low.
- Rent tile-vs-table: kept as data bug above; server defs are the tiebreak source.
- Rental `collect 0 vs 200`, vacation/jail shared tile, `[[0]]`-generic, room-code overwrite, no-host, lobby bypass: kept in P2 as reported.

## Suggested order
1. Session logout hash cleanup (auth) + auction equity/dupe (money).
2. Counter obligations + dead-bot guards + stats double-count + match writer fields.
3. Offer Decline + canvas input + NEEDS count + bank memory (biggest user-facing).
4. Copy batch + 44px/mobile pass (mechanical, one PR).
