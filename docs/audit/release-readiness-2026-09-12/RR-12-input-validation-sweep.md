# RR-12 — Socket/HTTP Input Validation Sweep

**Audit:** Release Readiness (40-agent) · Wave 2 · Mission RR-12 · 2026-09-12
**Mode:** READ-ONLY audit complete. No files modified.
**Prior coverage:** master audit §8.5–8.14, R3 — some sinks covered (spriteFromGrid fill, room names, generic string settings). This is a systematic sweep of ALL inbound payloads — NEW gaps found and existing validation verified.

**Method:** enumerated all 83 registered socket events across `serverSocketAccount.js`, `serverSocketGame.js`, `serverSocketSocial.js` (all installed through `createSafeEmitter`, socketHandlerSupport.js:105), the raw `disconnect` handler (server.js:117), and the Express surface (server.js:37-80 — static + SPA fallback only, no JSON/body routes). Verified validators in roomSetup/roomSettings/rulesetRegistry and the game-verb mixins.

## Findings

1. [BLOCKER] `server/marketExpansion.js:241-242` (+ exercise `:306-325`) — `open-option` `strike`/`premium` — fully client-priced and exercisable in the same round: `strike = Math.max(10, floor(Number(payload.strike)||quote))`, `premium = Math.max(1, floor(Number(payload.premium)||...))`, and `exerciseOption` has no open-round guard. Prior audit 2.1 reproduced $45k instant payout / +$900 per cycle draining the 100k house reserve; still open. Fix: server-price premium, band strike to the live quote, and block same-round exercise (or require a quote tick).
2. [MAJOR] `server/rooms.js:735-750` (`findLiveRoomFor` :779-785) + `server/serverSocketAccount.js:192-201` — `restore-session` `clientId` — the direct-clientId path rebinds `player.socketId` with no `player.disconnected` check and skips the account check when no token is supplied. A leaked clientId takes over a **live connected seat**, not just the 10s grace window that audit 8.13 described. Fix: require a server-issued per-socket secret (or at minimum reject rebinding when `player.socketId` is live and the account doesn't match).
3. [MAJOR] `server/roomSettings.js:76-80,139` + `server/rooms.js:496-502` + `server/rulesetRegistry.js:141-144` — `set-setting`/ruleset-override `startingCash` — `floorSettingAtZero` only rejects non-finite; 1e308 passes, is applied to every seat at start (`PLAYER_STATE_DEFAULTS.cash`, gameLogic.js:54) and to `game.settings`. `totalCash()`, season/leaderboard aggregates and persisted stats turn into 1e308/Infinity; stats/achievements/rank integrity broken by a hostile host. Fix: clamp to a sane max (e.g., 0–1,000,000) in both normalizer and numeric override branches.
4. [MAJOR] `server/roomSettings.js:141` + `server/socketRuntime.js:330-349` — `set-setting` `turnTimer` — no upper bound; 1e308 makes `Date.now()+seconds*1000` Infinity and Node clamps `setTimeout(..., Infinity)` to ~1ms, so the AFK watchdog instantly expires every turn for the whole match (and `turnDeadline` serializes to null). Fix: clamp turnTimer to a bounded range (e.g., 0–300s).
5. [MAJOR] `server/cosmeticCatalog.js:66-71` (+ `:174-182`) — `claim-cosmetic` `claimKey` / `equip-cosmetic` `slot` — `ownedClaim` pushes client keys into `account.claims` with no cap (load-normalize caps at 300, runtime push doesn't), and `equip` writes arbitrary 40-char slot keys, so `equipped` grows unbounded; every call rewrites the whole cosmetics file synchronously. Authenticated 24 req/s → memory/disk/file-rewrite DoS. Fix: cap claims on push, whitelist slots to catalog item types, rate-limit claim/equip.
6. [MAJOR] `server/socialStore.js:79-84,196-204` + `server/serverSocketSocial.js:99` — `block-player` `otherAccountId` — only truthiness/self checks; arbitrary 100KB IDs (packet cap) are persisted as block records (10k cap) with a full JSON rewrite per call. Fix: verify `accountStore.getAccountById(otherId)` and trim/slice IDs.
7. [MINOR] `server/socialStore.js:206-213` — `report-player` `otherAccountId` — same unverified/unbounded ID persisted (reason is capped at 80). Fix: same existence/length check.
8. [MINOR] `server/propertyApi.js:173-175` — `manage-property` `action` — no enum check before `PROPERTY_ACTION_HANDLERS[action]`; `constructor`/`toString`/`__proto__` resolve inherited Object.prototype members, `this[handlerName](...)` throws TypeError. Only the safe emitter prevents a process crash; ack is the generic "could not process" rather than "Unknown property action". Fix: `hasOwnProperty` guard.
9. [MINOR] `server/roomSettings.js:486-494` — generic settings (`bankruptMode`, `bankLoanSeverity`, `rulesetRevision`) — strings are trimmed but uncapped, and non-string/non-boolean values are stored verbatim (objects, huge numbers), then echoed in every `update-state` room summary. Re-confirms audit 8.7 and adds type confusion. Fix: type + length cap (≤32) and reject objects.
10. [MINOR] `server/economyApi.js:91-103` + `server/contractLogic.js:71-86` — requestId idempotency — keys truncate to 100 chars (two distinct long IDs collide and the second call silently returns the first result) and the per-game maps have no prune/TTL (re-confirms 8.8). Fix: reject overlong IDs or hash them, and bound/evict the maps.
11. [MINOR] `server/serverSocketSocial.js:286-300` — `finish-patrol-run` `score` — still client-submitted; a 10-minute idle run caps at 100,000 (re-confirms 8.9). Fix: derive score server-side or bind runs to gameplay events.
12. [MINOR] `server/serverSocketAccount.js:118-122` + `server/accountStore.js:530-550` — `check-username` — unauthenticated, unthrottled exact availability oracle (re-confirms 8.10). Fix: per-IP throttle + generic response.
13. [MINOR] `server/serverSocketAccount.js:388-419` — `join-room` `roomCode` — no attempt bucket (only the generic 240/10s per socket, reset by reconnecting), so 6-char private codes are brute-forceable across fresh sockets. Fix: per-IP join-failure limiter like `authAttempts`.
14. [MINOR] `server/serverSocketSocial.js:366-370` — `get-public-player-card` — rate limit applies only when `viewer` is null; any signed-in account can enumerate cards at socket-rate. Fix: run `allowSocialAction(viewer.id,'player-card')` for signed-in callers too.

## Handler coverage

| Handler | Validated? | Worst unvalidated field |
|---|---|---|
| check-username | format only | username (no throttle) |
| account-register / login / restore | yes (shape + per-IP limit) | — |
| account-update | yes (name/color/grid/privacy) | — |
| account-logout | token type only | sessionToken length |
| restore-session | clientId format only | clientId (live-seat rebind, #2) |
| list-rooms | n/a | — |
| create-room | yes (normalizers downstream) | rulesetOverrides values (normalized later) |
| join-room | format yes, attempts no | roomCode (#13) |
| leave-room | yes (ownership) | — |
| set-player-appearance | yes | — |
| set-setting | per-key normalizers | startingCash/turnTimer (#3/#4); generic strings/objects (#9) |
| start-game | host check | — |
| purchase-property / decline-property | tile + pending-offer match | — |
| auction-bid | finite integer, >high, ≤cash | — |
| auction-pass / end-turn / roll-dice / pay-jail-fine / use-jail-free / declare-bankruptcy / get-bank-loan-offer / get-economy-snapshot | server state only | — |
| manage-property | tile/ownership yes; action no | action (#8) |
| propose/counter/adjust/cancel/respond-trade | partner, cash finite, 40-index cap, ownership | toPlayerId (existence checked) |
| propose/counter/adjust/respond-player-contract | kind enum, amount int, terms clamped, ownership | — |
| repay-player-contract | owner/kind + clamp | amount (clamped) |
| take-bank-loan / repay-bank-loan | requestId capped, amount finite | — |
| market-order / open-margin / reduce-margin / open-short / cover-short | enums + integer ranges | — |
| open-option | qty/side/role only | strike + premium (#1) |
| exercise-option / close-position | id slice + ownership | — |
| vote-global-event | choice enum | — |
| place-casino-bet | color enum, int 1–500 | — |
| sponsorship request/contribute/withdraw/accept/decline | amount >0 ≤need, owner | — |
| send-chat | 250 cap + cooldown | — |
| get-social-data/profile/friends/requests/notifications/recent/cosmetics | auth only | — |
| send-friend-request | target lookup + rate | username (normalized) |
| respond-friend-request / cancel-friend-request / mark-notification-read | match guard | — |
| remove-friend / block-player / report-player | self/pair only | otherAccountId (#6/#7) |
| get-public-player-card | target lookup | rate bypass for signed-in (#14) |
| search-players | 32-char query + rate | — |
| get-match-history | privacy gates | accountId (lookup-only) |
| get-leaderboard / snapshot / get-season | metric/scope enums | seasonId (Map-safe) |
| claim-season-reward | catalog + eligibility | rewardId (lookup-only) |
| claim-cosmetic / equip-cosmetic | catalog + flags | claimKey / slot (#5) |
| send/respond-room-invite | target, ownership, expiry | — |
| start/finish-patrol-run | token/socket/owner/plausibility | score (#11) |
| HTTP routes | n/a | none — static + SPA fallback, no body parser |

**Clean results:** no exploitable prototype pollution (`{...payload}` spreads are field-picked or filtered by `KNOWN_OVERRIDE_KEYS`; `set-setting` requires own-property keys); all `on()` handlers are wrapped by `createSafeEmitter` (sync + promise catch, payload normalization, rate limit); `disconnect` is the only raw listener and consumes no payload; `maxHttpBufferSize: 100000` caps packet size; money paths (auction, casino, trades, contracts, margin/short, sponsorship, repayments) all re-validate ranges/ownership server-side except the option pricer (#1).
