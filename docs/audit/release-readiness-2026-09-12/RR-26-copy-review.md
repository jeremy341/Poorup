# RR-26 — Copy & Microcopy Review

**Audit:** Release Readiness (40-agent) · Wave 3 · Mission RR-26 · 2026-09-12
**Skill:** copywriting (voice/clarity judgment). PRODUCT.md brand voice: "direct, playful, competitive, concise. No invented claims, fake social proof, or mock statistics."
**Mode:** READ-ONLY.

Inventory sampled: home/title, rooms+lobby settings, setup, HUD/roll/jail, auction, buy/pass, trade/financing/deals, deed, sponsorship, bankruptcy/game-over, wallet/market/casino, social/rankings/season/rules, profile/account, toasts/feed/errors (117 `feedMessage` + ~287 error strings). Cross-ref: `docs/audit/full-codebase-audit-2026-09-12.md` (4.3/4.11 still open at HEAD). No typos found by dictionary scan; no TODO/Lorem/example/test leftovers except items below. No files modified.

## Findings (15)

1. **[BLOCKER] `public/clientAuctionUi.js:190`** — `` bidEl.textContent = `${a.bid}` `` (initial markup `$0`, line 133) — "HIGH BID" loses `$` and thousands separator after first render ("1500"); same card hardcodes "EACH BID RESETS THE 5s CLOCK" (line 164) from `AUCTION_MS` — use `` `$${a.bid.toLocaleString()}` `` and derive the seconds copy from `AUCTION_MS`.
2. **[BLOCKER] `public/index.html:141-142`** — "…Last wallet standing keeps the table. Usually around twelve minutes, sometimes a vendetta." — unsupported playtime statistic violates PRODUCT.md "no invented claims/mock statistics" — drop duration: "Last wallet standing keeps the table. Quick enough for a weeknight, long enough for a grudge."
3. **[MAJOR] `public/index.html:717,720`** — adjacent buttons "PAY $50 TO LEAVE JAIL" and "USE GET OUT OF PRISON CARD" (also `clientPopupUi.js:51` "Move directly to Prison"; `gameLogic.js:595` "sent to Jail") — Jail/Prison split on one screen and in feed/rules — canonicalize on JAIL: "GET OUT OF JAIL CARD", "Move directly to Jail."
4. **[MAJOR] `public/clientPopupUi.js:25,116` + `public/clientDeedDetailUi.js:137`** — "RAILROAD DEED", "1 RAIL", "Railroad rent scales with how many railroads you hold." — board tiles, rules ch.06, and achievements say "Airport(s)" (`clientSocialSurfaces.js:832`, `achievementStore.js:55`) — display as "AIRPORT DEED", "1 AIRPORT", "Airport rent scales…".
5. **[MAJOR] `server/tileApi.js:89,151,164` + `public/clientLobbyUi.js:525`** — "took a breather at Free Parking", "paid $X in tax into Vacation cash", "Taxes fill free parking" vs HUD "Vacation Pool" — one mechanic, three names (Free Parking / Vacation cash / Vacation Pool) — standardize "Vacation Pool".
6. **[MAJOR] `public/clientAccountIdentity.js:377,386,401,405,410,429`** — "[OK] Username is available.", "[X] That username is already taken.", "[·] Checking…", "[!] Enter a username…" — debug-style bracket markers in the signup flow — remove markers; rely on `.is-available/.is-taken` styling ("Username is available." / "That username is already taken.").
7. **[MAJOR] `public/clientSocialSurfaces.js:617` + `:233`** — "SIGN IN TO TRACK" is shown to signed-in players who have no row (carry-over of audit 4.11), and empty social search returns `""` (carry-over of 4.3; rankings search already says "NO EXACT USERNAME MATCH.", line 696) — use "UNRANKED · FINISH A VERIFIED ROUND" and render "NO EXACT USERNAME MATCH." in social search.
8. **[MAJOR] `public/clientSocialSurfaces.js:360,701,1219`** — invite row shows `EXPIRES 2026-09-13T12:57` (raw ISO slice), season header `2026-09-13 → …`, match rows `2026-09-13` — machine timestamps shown to players — render localized ("EXPIRES SEP 13 · 12:57", "SEP 13, 2026").
9. **[MAJOR] `public/clientGameModalsUi.js:236`** — game-over button "Back to Lobby" calls `goHome()` (`clientLobbyUi.js:843-884`), which leaves the room and returns to the home screen — label misdescribes the action and hides seat loss — relabel "Leave Table" (or actually return to the lobby).
10. **[MAJOR] `public/clientLobbyUi.js:520,522` + `public/index.html:262` + `public/clientTopNavRender.js:104`** — "Reserve CPU seats for Solo Dev Mode.", "…when credits or service are unavailable.", "enable every optional system in the host rail.", tag shows "STANDARD-40" — internal/dev jargon and raw enum keys in player-facing setup — "Reserve CPU seats for solo play.", "The house brain takes over automatically when the online service is unavailable.", "in the host settings", "STANDARD 40 · 2–4".
11. **[MAJOR] `server/bankruptcyApi.js:79` + `server/gameLogic.js:711`** — "advanced market positions were settled (open-margin, cover-short, buy-option)." and "stepped on the 41st movement. The ledger skipped a line." — raw internal action keys / cryptic easter-egg read like bugs — humanize ("…positions were closed."; "stepped onto the 41st tile — the ledger skipped a line.").
12. **[MAJOR] `public/index.html:137` + `public/clientSocialSurfaces.js:790`** — "FOUR SEATS · ONE BANK · NO REFUNDS" and rules "for two to four players" contradict Metro 52 "2–6" (`clientLobbyUi.js:517`) — "TWO TO SIX SEATS…" / "for two to six players, depending on the board."
13. **[MINOR] `server/socketRuntime.js:668`, `server/bankruptcyLogic.js:82-83`, `server/rooms.js:918` vs `serverSocketGame.js:136`, `tradeApi.js:227`, `sponsorshipApi.js:130`** — "was cancelled due to turn timeout" / "due to disconnect" vs "canceled" spelling everywhere else — fix grammar and standardize on "canceled": "A pending trade was canceled because the turn timed out."
14. **[MINOR] `server/socketHandlerSupport.js:136`, `server/marketLogic.js:20`, `server/propertyApi.js:101`, `server/auctionApi.js:52`** — "The server could not process that request.", "Market/Property access is unavailable right now.", "You cannot bid right now." — no cause or next step, and generic cases hide specific reasons the server already knows — surface the specific reason ("Market orders are available during your turn." / "The parlor hiccuped — try again.").
15. **[MINOR] `public/index.html:99-100` + `public/clientNightShift.js:76-77`** — Night Shift reuses elements whose aria-labels stay "Local time" and "Parlor Patrol score" while showing countdown/score (audit 3.13 still open), and the only hint "SHIFT+P · NIGHT SHIFT" is `aria-hidden` (index.html:101) — update labels on mode switch ("Night Shift countdown/score") and expose the shortcut to AT.

## Top 10 copy improvements (ranked by user impact)
1. Auction bid: `$${a.bid.toLocaleString()}`; drive "resets the clock" text from `AUCTION_MS`.
2. Drop "Usually around twelve minutes" from the title-screen pitch (brand-commitment violation).
3. Unify JAIL: "USE GET OUT OF JAIL CARD"; popup "Move directly to Jail."
4. Rename railroad copy to Airports: "AIRPORT DEED", "1 AIRPORT", "Airport rent scales…".
5. Standardize "Vacation Pool" in lobby, HUD, and all feed lines.
6. Remove `[OK]/[X]/[!]/[·]` markers from username status.
7. Show "UNRANKED · FINISH A VERIFIED ROUND" instead of "SIGN IN TO TRACK"; add "NO EXACT USERNAME MATCH." to social search.
8. Localize dates: "EXPIRES SEP 13 · 12:57" (invites), "SEP 13, 2026" (season/history).
9. Game-over "Back to Lobby" → "Leave Table" (matches `goHome()`).
10. Rewrite bot setup: "Reserve CPU seats for solo play." / "The house brain takes over automatically when the online service is unavailable."

## Terminology glossary (canonical)

| Concept | Canonical | Ban / context |
|---|---|---|
| Lobby entity | **room** ("Room is full.", room code) | "table" for the lobby; "lobby" for a room |
| In-play group | **table** ("left the table", "table obligation") | "room" mid-game |
| Brand shell | **parlor** (site chrome only: Parlor Chat, Enter Parlor) | "parlor" as a synonym for table/room |
| One played session | **round** (Start Round, ROUND OVER, LAST N ROUNDS) | "game/match" in live play copy |
| Server record | **match** (season/match history) | "game" in stat labels |
| Ownership asset | **deed** (DEEDS, BUY DEED, mortgage) | "property" for the card |
| Board space | **property** (build rules, color group) | mixed "deed" in rules prose |
| Currency | **cash** (`CASH ON HAND`, "Loan-backed cash") | "money" except casino disclosure "fictional board…" |
| Bot seat | **bot** / **CPU seat** in labels ("Bots", "CPU seat" description) | "Solo Dev Mode", "AI credits or service" |
| Reserved slot | **seat** (open seat, CPU seat) | "slot" |
| Corner penalty | **Jail** + **Get Out of Jail card** | "Prison" |
| Transit tile | **Airport** | "railroad"/"rail" |
| Pool | **Vacation Pool** | "Free Parking", "Vacation cash" |
| Minigame | **Night Shift** (mode), **Parlor Patrol** (brand) | "patrol" for the mode |
| Typography | ALL CAPS for structural labels/status; sentence case for helper text; buttons verb-first (START ROUND, BUY DEED); status nouns only on disabled buttons | mixed "Create & Host Table" vs "Create Room"; "guest alias" vs "Display Name" |

Also standardize "canceled" (US) repo-wide and fix "due to <noun>" feed grammar.
