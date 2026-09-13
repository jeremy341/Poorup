# RR-36 — Guest vs Account Data Map & Privacy Surface

**Audit:** Release Readiness (40-agent) · Wave 4 · Mission RR-36 · 2026-09-12
**Mode:** READ-ONLY. No files were modified.

**Bottom line:** The privacy surface is mostly viewer-scoped for live play, but three gaps remain material for release: **owner history leaking opponents' economy data (M1)**, **history privacy not suppressing player-card recent matches (M2)**, and **no deletion/expiry story at all (M4, M5, M8)**. The accountId promise in the social plan (M3) must be resolved before a policy is written, since anonymous search currently exposes stable IDs.

Prior context checked: `docs/audit/full-codebase-audit-2026-09-12.md` (§2.8 CONFIRMED, §8.13, §8.2), `docs/AUDIT-FULL-2026-09-08.md`, `docs/plans/friends-and-player-social-plan.md`, `docs/plans/match-history-and-in-session-social-plan.md`.

## 1. Feature-by-feature data map

Legend: **LS** = localStorage, **SS** = sessionStorage, **acct** = server/data/accounts.json, **soc** = social.json, **mch** = matches.json, **ach** = achievements.json, **sea** = seasons.json, **cos** = cosmetics.json, **tel** = telemetry.json.

| Feature | Data collected | Where stored | Retention / limits | Visible to whom | Deleted on logout? | Deleted on account deletion? |
|---|---|---|---|---|---|---|
| Guest identity / alias | nickname (server ≤24, client alias ≤12 upper), color, 8×8 avatar grid; clientId, socketId | Room memory only (`rooms.js` seat; `clientState.js:137`); alias in LS `poorup.guest.alias.v1`; after settlement `displayNameAtMatch` in acct+mch | Room: until leave or GC (empty-room grace 10 min, `socketRuntime.js:30-31,693-714`); clientId 10 s reconnect grace (`socketRuntime.js:21`); match name persists ≤500 records | Same room + chat; match nickname visible to history viewers; no account/social profile | Alias kept (by design); room seat ends with room | N/A (no account); cannot be targeted by a deletion request |
| Accounts (creds/stats) | username (lowercase 3–16), displayName (≤18), scrypt passwordHash+salt, sessionTokenHash, 17 stat counters, privacy prefs, createdAt, recentClearedAt, history[50], matchHistory[50], achievements[100] | acct; session token in LS `poorup.account.session.v1` | Unbounded accounts; history 50; achievements 100; sessions **never expire** (`accountStore.js:485-498,459-468`) | Self (creds never echoed); username/display subset public via search/leaderboards/cards | Server session revoked only; all data kept. LS session key removed (`clientAccountIdentity.js:505-522`) | **No delete path exists** |
| Avatars / pixel identity | color + 8×8 hex grid; `avatarAtMatch`; up to 4 saved profiles | acct; mch participant; LS `poorup.profiles.v1` (+ legacy `poorup.profile.v1`) | acct forever; mch 50/500; LS until manual delete | Room, cards, leaderboards, seasons, recent players | Kept (profiles are local) | Missing |
| Room membership / seats | clientId, socketId, nickname, color, avatar, cash/position/properties, room code/name/visibility/settings | Server memory (`RoomManager`); public directory summary in memory | Room GC 10 min after last connected human; disconnect grace 10 s | In-room players see cash/position/properties/avatars (public by design, `summaryApi.js:13-36`); directory shows seats/cap only, public code now null (`rooms.js:614-631`) | Logout does not alter seat | Room dies with GC |
| Chat | text ≤250, nickname, in-room playerId, bot flag | Server memory only (`serverSocketSocial.js:40-44`; feed capped 40); client LS `poorup.save.v1` keeps ≤80 feed/chat lines | No server history/no retention; client copy until leave (`clientLobbyUi.js:656`) | Room occupants | Client save cleared on leave/failed explicit resume | N/A |
| Trades / contracts | offer terms; contract id/kind/amounts/premium/collateral/equity/status; accountIds | Live game memory; match record `playerContracts` (20); client account snapshot | Memory until GC; records 50/500 | Live: own full, others id/kind/status only (`contractLogic.js:578-607`). **Record: every participant gets all counterparties' rows (M1)** | Server kept; client snapshot removed with session key | Missing |
| Casino / market | bets count, net, positions (qty/avgCost/realizedPnl), margin/short/option summaries; ledgers | Game memory (casino ledger 200 room/50 player; market ledger 300); match record `casino`/`market` rows keyed by accountId | Memory until GC; records 50/500; telemetry counters | Live: own full; opponents only public cash/position (`summaryApi.js:38-53`). **Record: all participants in every owner's history (M1)** | as above | Missing |
| Match history | matchId, completedAt, duration, rounds, roomVisibility, participants (displayNameAtMatch, avatarAtMatch, placement, endingCash, propertyCount, flags, unlocked achievements), events, combos, trade/auction counts, ruleset digest, bot decisions ≤200 | acct `matchHistory[50]` (owner) + mch global (500) + LS snapshot | 50/account, 500 global; **no time-based expiry** | Owner raw; accepted friends summary; public setting → summary to all; private-room records filtered for outsiders (`roomSetup.js:183-223`) | Client copy removed; server kept | Missing |
| Achievements | id + unlockedAt per account; evidence records (accountId, achievementId, gameId, evidenceHash) | acct, ach, LS `poorup.achievements.v1` | 100/account; evidence unbounded (≤100/account by definition) | Self + accepted friends (unless private); achievement count on cards; **MYTHICAL unlock broadcast server-wide with display name** (`socketSocialApi.js:192-223`) | Client map reset; server kept | Missing |
| Social (friends/blocks/reports/notifications) | friendships (requester/addressee/status/timestamps), blocks, reports (reporterId, reportedId, reason ≤80, status), notifications (kind/title ≤120/body ≤250/metadata/readAt) | soc | Arrays ≤10,000 each; notifications ≤100/account; **no expiry; reports have no reader/triage UI** | Self; reports not exposed to any client; notifications self-only; names discoverable via search | Kept | Missing |
| Invites | roomCode, roomName, visibility, senderId, recipientId, status, expiresAt (15 min) | soc (recipient projection omits roomCode, `socketSocialApi.js:99-101`) | 10k cap; expired rows persist forever | Recipient only; sender confirmed ack | Kept | Missing |
| Leaderboards / season | accountId, username, displayName, avatar, metric values, games/wins/achievements/mythical, **bankLoanRepayments/bankLoanDefaults**, trend; season standings incl. casinoNet/marketProfit/loan counts, claims | Computed from acct; sea for standings/claims | sea keeps 12 seasons, 1000 match ids/season, 5000 standings/claims; 8-week season; no opt-out of public stats | **Everyone, incl. anonymous** (`get-leaderboard`, `get-season`, `search-players`) | Kept | Missing |
| Patrol / night-shift scores | patrolBest, patrolAceRuns; night-shift best local; in-flight run tokens | acct stats; LS `poorup.parlor-patrol.best.v1`, `poorup.night-shift.best.v1`; tokens in memory (2,000 cap, 10 min TTL) | Stats forever; tokens pruned; client forever | Patrol best on public leaderboard; night-shift local only | Kept | Missing |
| Telemetry | event kind, coarse payload, season/ruleset versions, timestamp; **no accountId**; rejects `chat/message/text/hiddenCards/privateLoanTerms/opponentSecrets/password/sessionToken` | tel | 5,000 events FIFO; no PII keys | Ops only (summary API, no client endpoint) | Kept | Not user-linked |
| AI bot advisor (DeepSeek) | JSON context: seat labels, cash bands, own loan/contracts/positions, board, candidates, event; decision traces | Sent to `api.deepseek.com` when `DEEPSEEK_API_KEY` set; traces in match record (≤200) | 120 decisions/game, 4 s timeout, 30 s circuit; provider retention outside repo | Provider sees de-identified table state; room sees provider/fallback only; traces owner-only | n/a | n/a |
| IP / rate limiting | IP + counters, socket ids; auth attempts; anonymous search/card keys | In-memory only (`httpRateLimiter.js`, `serverSocketAccount.js:22-27`, `socketSocialApi.js:45-65`) | Pruned at 10k entries or window; never persisted/logged | Server only | n/a | n/a |

## 2. Privacy controls inventory (server enforcement verified)

| Control | UI | Values | Server enforcement | Verified gap |
|---|---|---|---|---|
| Match history | Account modal → edit (`clientAccountIdentity.js:276-279`) | public / friends / private | `matchHistoryPrivacyError` + `visibleHistoryRecord` (`roomSetup.js:183-192`; `serverSocketSocial.js:439-447`). Private blocks even accepted friends; public exposes public-room records only | **Player-card `recentMatches` ignores it entirely (`serverSocketSocial.js:408`)** |
| Achievements | same modal | friends / private | `publicAchievements` (`accountStore.js:344-348`) + `publicPlayerCard(includeAchievements)` (`socketSocialApi.js:142-154`) | Mythical broadcasts bypass privacy by design (`socketSocialApi.js:212-223`) |
| Friend requests | same modal | everyone / friends-of-friends / nobody | `friendRequestRejection` reads stored target privacy (`serverSocketSocial.js:312-321`); blocks enforced | OK |
| Room invites | same modal | friends / nobody | `roomInviteRejection` + accepted-friend requirement + block check (`serverSocketSocial.js:516-531`) | OK |
| Block | player card action | — | `socialStore.blockPlayer` removes friendship, cancels invites (`socialStore.js:196-204`); enforced in search, card view, friend/invite, room chat (`socketSocialApi.js:285-294`) | Blocked players remain in `recentPlayers` (M6) |
| Report | player card action | free reason ≤80 | stored only; no client reader | No triage tooling |
| Clear recent | Social surface button (`clientSocialSurfaces.js:365`) | — | `recentClearedAt` timestamp filters `recentPlayers` (`accountStore.js:731-743`; `socketSocialApi.js:137-140`) | Match records/other players' lists unaffected |
| Logout | profile | — | `accountStore.logout` (`accountStore.js:573-582`) revokes this token + all persisted hashes; other devices' in-memory tokens survive until restart (`issueSession` revokes on next login) | No client-data wipe beyond session key |

## 3. Leak checks (verified at HEAD)

- **Own match history → opponents' casino/market/contracts: STILL PRESENT.** The owner path returns raw records (`serverSocketSocial.js:450`); the raw snapshot is also returned by `register/login/restore/update/get-self-profile/account-sync` (`accountStore.js:375,686-689`) and persisted client-side (`clientSanitize.js:310`). Audit §2.8 remains unfixed. The UI even prints "economy results stay inside your private account record" (`clientProfileRender.js:451`) — the record is private, its contents are not the owner's alone.
- **Opponent cash/positions elsewhere:** live summaries now viewer-scope `accountId`, `marketPositions`, bank-loan detail (`summaryApi.js:38-53,141-151`; pinned by `summary-privacy-audit.test.js`). Cash/position/properties remain table-public by game design. `pendingTrade` full offer is broadcast to all seats (`summaryApi.js:79`).
- **displayNameAtMatch history:** stored in every match record forever (subject to the 500 record cap) and returned in other viewers' history/summaries and player-card recent matches. Renames/blocks do not scrub or filter historical nicknames.
- **Notifications content:** self-only via authenticated `get-notifications`; bodies include other players' display names and `metadata.accountId` (stable ID). Never deleted; no user delete.
- **Anonymous discovery:** `search-players` accepts unauthenticated callers (IP rate-limited) and returns `id, username, displayName, color, avatarGrid` (`serverSocketSocial.js:139-145,416-437`); `get-public-player-card` accepts any `accountId` anonymously and (per M2) leaks recent matches.

## 4. Guest lifecycle
- **Created:** no server account. Seat carries nickname/color/avatar/`clientId`/`socketId`; `clientId` lives only in sessionStorage (per-tab, survives reload; dies with tab).
- **Disconnect:** 10 s grace (`socketRuntime.js:21,600-630`) → seat marked disconnected, kept in a started game. `restore-session` re-binds by `clientId`; for guests this clientId is an unauthenticated bearer for the seat within the window (audit §8.13, `serverSocketAccount.js:192-201`).
- **Room residue:** empty rooms (no connected humans; bots/ghosts don't count) are destroyed 10 min after the last human leaves (`socketRuntime.js:30-31,693-714`). Everything (chat, board, seat) is memory-only.
- **Durable residue:** on settlement, all guests appear in the match record as `participants` with `accountId:null` and `displayNameAtMatch`, plus full gameplay stats; matches.json keeps the newest 500 globally. Guests never enter `accounts.json`, seasons, achievements, or social stores (all require accountId).
- **Client residue:** alias, guest achievements map, local patrol/night-shift bests, saved game and chat lines remain until the user clears site data; guest achievements are local-only (`clientAccountIdentity.js:201-215`). Guests cannot invoke social features; chat is allowed.

## 5. Client storage map

| Key | Store | Content | Sensitivity | Cleared when |
|---|---|---|---|---|
| `poorup.account.session.v1` | LS | sessionToken + account snapshot incl. raw `matchHistory[50]` (opponents' casino/market/contracts), stats, privacy | **HIGH** (bearer + third-party economy) | Explicit logout; overwritten on login |
| `poorup-client-id` | SS | guest/seat bearer id | MED | Tab close |
| `poorup.guest.alias.v1` | LS | guest nickname | LOW | User edit; kept on logout |
| `poorup.profiles.v1` / `poorup.profile.v1` | LS | ≤4 avatars/designs | LOW–MED | Manual profile delete; not logout |
| `poorup.active-design.v1` | LS | selected design | LOW | Never auto |
| `poorup.achievements.v1` | LS | achievement ids+timestamps (guest or cached account) | LOW | Reset on logout, repopulated on login |
| `poorup.save.v1` | LS | live board + owners + ≤80 feed/chat messages + names/cash | MED | `clearSave` on leave/failed explicit resume |
| `poorup.parlor-patrol.best.v1`, `poorup.night-shift.best.v1` | LS | local bests | LOW | Never auto |
| `poorup.theme.id.v2`, `poorup-panel-visibility-v1`, sound/music, ruleset preset | LS | UI prefs | LOW | Never auto |

## 6. Third-party flows
- **DeepSeek** (only outbound call; `botAdvisor.js:207-419`): used only when `DEEPSEEK_API_KEY` present and bot brain = ai/auto. Prompt contains `botState`, board, seat-labeled opponents (`opponent-1…6`, cash **band**, property count, jail/bankrupt/disconnected — `botStrategicContext.js:189-203`), contracts without counterparty identity (`:59-76`). **No nicknames, accountIds, clientIds, or chat text** — system prompt explicitly treats chat as untrusted (`botAdvisor.js:370`). Remaining data flow governed by DeepSeek's own retention (not in repo).
- **Fonts/audio/images:** all self-hosted under `public/assets` (`styles.css:4-38`); no Google Fonts.
- **CDNs/analytics:** none. CSP `default-src 'self'` blocks external script/connect (`server.js:47`); dependency set is express + socket.io only.

## 7. Mismatches (12)

1. **[H]** `server/serverSocketSocial.js:450` + `server/accountStore.js:375` — *Promise:* "economy results stay inside your private account record" (`clientProfileRender.js:451`) / audit §2.8 fix expected — *Reality:* every participant's own history contains all opponents' casino net/bets, market positions/PnL, and contract terms, returned on login/profile and persisted to localStorage — *Fix:* project `casino`/`market`/`playerContracts` rows to the record owner before returning owner history and before embedding in `publicAccount`.
2. **[H]** `server/serverSocketSocial.js:408` — *Promise:* match history "PRIVATE" (`accountStore.js:804`) means hidden — *Reality:* `get-public-player-card` always returns up to 5 public-room match summaries (participants, names, placement) for any accountId, even anonymous viewers; client renders them (`clientSocialSurfaces.js:1226-1231`) — *Fix:* return `recentMatches: []` when `!canSeeRecent`.
3. **[H]** `docs/plans/friends-and-player-social-plan.md:221` vs `server/serverSocketSocial.js:436`, `server/accountStore.js:326-333`, `server/serverSocketSocial.js:189` — *Promise:* "Never expose … stable account ids to clients" — *Reality:* accountId returned by anonymous search, leaderboards, seasons, recent players, player cards — *Fix:* remove IDs from public projections or rewrite the promise/policy to declare them public (and consider per-viewer handles).
4. **[H]** `server/accountStore.js:573-582` (no delete handler anywhere) — *Promise:* account creation ("Your identity is saved", `clientAccountIdentity.js:327`) implies an account lifecycle — *Reality:* no deletion/export; acct/soc/mch/ach/sea/cos retain everything forever, and `backupStore.js:27-37` keeps 7 rotations — *Fix:* implement delete with cascade purge + backup/tombstone policy, or publish "no deletion" as the retention statement.
5. **[M]** `server/matchStore.js:9` + `docs/plans/match-history-and-in-session-social-plan.md:128-129` — *Promise:* "90 days for guest-visible summaries" — *Reality:* no time-based retention; only global 500-record and 50/account caps; guest nicknames/gameplay survive indefinitely within the cap — *Fix:* implement date pruning or correct the doc.
6. **[M]** `server/socketSocialApi.js:106-131` + `docs/plans/friends-and-player-social-plan.md:218` — *Promise:* blocking hides the player (from search/actions) — *Reality:* blocked accounts are unfiltered in `recentPlayers` (and their historical display names remain in history) — *Fix:* filter `areBlocked` in `recentPlayers` and history participant names.
7. **[M]** `server/accountStore.js:320-334` vs `public/clientSocialSurfaces.js:1252` — *Promise:* "Private cash, loans, and hidden records stay hidden" — *Reality:* every leaderboard row exposes `bankLoanRepayments`/`bankLoanDefaults`, and season rows expose `casinoNet`/`marketProfit`/loan counts to all viewers — *Fix:* metric-scope those fields or amend copy/policy.
8. **[M]** `server/accountStore.js:485-498,459-468` + `clientSanitize.js:316-340` — *Promise:* implicit (sign-in = "your account is yours") — *Reality:* non-expiring bearer token in plaintext localStorage; logout doesn't kill other devices' live sessions until restart/next login (audit §8.2) — *Fix:* token TTL/rotation + revoke-all-sessions option.
9. **[M]** `server/serverSocketSocial.js:192-223` + `docs/plans/friends-and-player-social-plan.md:213` — *Promise:* "Achievement announcements: Room only / Friends / Private" — *Reality:* no announcement control exists (only card visibility friends/private), and MYTHICAL unlocks are broadcast server-wide with display name regardless of the privacy setting — *Fix:* add the control or document the mythical exception in-product.
10. **[M]** `server/serverSocketAccount.js:192-201` (audit §8.13) — *Promise:* session recovery is account-bound — *Reality:* a guest seat is reclaimable by anyone holding the sessionStorage `clientId` during the 10 s grace — *Fix:* bind restore to a per-socket secret + account token for guests (or disable guest grace restore).
11. **[L]** `SHOWCASE.md:3` vs `PRODUCT.md:31`, `public/index.html:196` — *Promise:* "no downloads, no accounts" — *Reality:* optional accounts with credentials/stats are a shipped feature (guest play is still available) — *Fix:* update showcase copy.
12. **[L]** `server/accountStore.js:803-808` vs `docs/plans/friends-and-player-social-plan.md:210-211` — *Promise:* invites "Friends / Friends of friends / Nobody" — *Reality:* only friends/nobody implemented (achievements likewise friends/private) — *Fix:* align doc with implementation.

## 8. Privacy-policy prerequisite checklist (facts a policy must state)
- Identity model: guest play requires **no account and no email**; optional account stores username, display name, password *hash* (scrypt+salt), pixel avatar/color, stats, privacy settings.
- Account-visible identifiers: username, display name, color/avatar, opaque accountId, and stat counters are **public** across search, player cards, leaderboards, and seasons; mythical unlocks broadcast display name server-wide.
- Gameplay records: up to 50 matches per account and 500 server-wide include participants, placements, timestamps, exact ending cash/property counts, events, ruleset, bot decisions — and currently all participants' casino/market/contract rows (must be disclosed as-is until M1 is fixed).
- Guest data: nicknames and gameplay stats in completed match records; no account linkage; no self-service access or deletion for guests.
- Chat: transient (broadcast only), not stored server-side; may be retained locally in the device's game save (≤80 lines) until leaving the room.
- Social data: friendships, blocks, invites (15-min expiry rows persist), reports (reason + reporter, never shown to the reported player), notifications.
- Leaderboard/season data: stats incl. loan repay/default counts and economy metrics are published to all users.
- Client storage: bearer session token + full profile snapshot (including raw match history) in localStorage; per-tab seat id in sessionStorage; design/preference keys; all survive until explicit logout/site-data clearing; logout does not delete server data.
- Retention: count-capped stores (matches 500, history 50, notifications 100, telemetry 5,000, seasons 12, backups 7 rotations) with **no time-based expiry, no account deletion path, and non-expiring sessions** — state this plainly.
- User controls actually provided: history/achievements/friend-request/invite privacy, block, report, clear-recent, logout; their exact scopes and gaps (M2, M6).
- AI feature: when enabled, de-identified game state goes to DeepSeek (no names/IDs/chat); otherwise no outbound third parties; self-hosted fonts; no analytics/CDN/cookies.
- Abuse data: IP addresses processed transiently in memory for rate limiting only — not persisted or logged.
- Public-room data: directory exposes room name, seats, settings; private codes shared only with participants.
- No age gate / no email contact channel; state eligibility, controller contact, change-notification, and how to submit a data request (manually fulfilled via the operator table below).

## 9. Operator support playbook inputs

| User key | Where to look / touch | Notes |
|---|---|---|
| `accountId` (`acct_…`) | acct: `accounts[].id` (+ `sessionTokenHash`, `username`); soc: `friendships[].requesterId/addresseeId`, `blocks[]`, `invites[]`, `reports[]`, `notifications.<accountId>`; mch: `participants[].accountId`, `casino[]/market[]`, `playerContracts[].from/toAccountId`; ach: `records[].accountId`; sea: `standings.<accountId>`, `claims.<accountId>`; cos: top-level key | Manual edits require server restart (stores are loaded once). Delete request ⇒ scrub all 6 files; note backups dir (`POORUP_BACKUP_DIR`, 7 rotations) and `POORUP_DATA_DIR` copy |
| `clientId` (`client-…`) | Server **memory only** (room seats); never persisted | Disappears with room GC; cannot be looked up across restarts |
| Session token | acct `sessionTokenHash` (sha256) + in-memory `AccountStore.sessions/sessionHashes`; client LS `poorup.account.session.v1` | Logout revokes token + all persisted hashes; other devices' in-memory sessions live until restart/login |
| Username | acct top-level key (normalized lowercase) | `accounts.json` is an array; key by `username` field |
| Guest nickname | mch `participants[].displayNameAtMatch`; room memory | No owner key — search by nickname string; no deletion mechanism keyed to a guest |
| Notification / invite / report / block | soc arrays + `notifications` map | Invite rows persist after expiry; reports have no status workflow/tool |
| Match record | mch `matchId`; owner copies in acct `matchHistory[]` | 500/50 caps; rebuild of an account's history requires editing both stores |
| Season claim/cosmetic | sea `claims.<accountId>`, cos `<accountId>.{tokens,owned,equipped,claims}` | Claims capped 64/account (sea) and 300/account (cos) |
| Client-side request | Ask user to sign out and clear site data, or provide them the above exports | Only `poorup.account.session.v1` is removed by logout; remaining keys listed in §5 |
