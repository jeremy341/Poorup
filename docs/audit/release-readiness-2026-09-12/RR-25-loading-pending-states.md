# RR-25 — Loading, Pending & Progress States Inventory

**Audit:** Release Readiness (40-agent) · Wave 3 · Mission RR-25 · 2026-09-12
**Mode:** READ-ONLY. Mission: every async action must show state (idle → working → success/failure).

## Prior-flag status (verify only, not counted as findings)

| Prior item | Current state |
|---|---|
| Deed ack silent swallow (R1 §4.5) | Error now surfaces via `say`; **in-flight pending still absent** |
| Trade accept pending (R1 §4.6) | **Fixed** — PROCESSING + reject rollback; **no timeout** |
| Auction bid pending (R1 §4.17) | **Still open** — no pending/disable |
| Sponsorship pending (R1 §4.16) | **Still open** — no pending; errors now surface |
| Account submit label (R1 §4.12) | **Still open** — disabled only, no label; no timeout |
| Trade send closes pre-ack (R3 §3.7), buyTile pre-ack clear (R3 §3.17), vote no pending (R3 §4.18), actions live while reconnecting (R3 §4.8) | All still present (input, not re-reported) |
| Snapshot clobber of DOM pending + `busy/rolling` reset (R3 §2.2/§2.9) | Still present; **note as input** — `renderMarketDeskIfOpen` / `renderCasinoDeskIfOpen` / `renderWalletModalIfOpen` rebuild open modals before the ack arrives, so PROCESSING labels never paint and buttons re-enable mid-flight. |

## Findings (new/uncovered, 15)

1. `[MAJOR] public/clientGameModalsUi.js:141` — Trade offer Accept — PROCESSING placeholder has no timeout; offer is de-listed from state.offers at :146 before the ack, so a dropped ack leaves the modal stuck on PROCESSING with no offer to restore — route through emitWithTimeout and restore from snapshot.
2. `[MAJOR] public/clientAccountIdentity.js:481` — Account create/sign-in/update (and the username check at :394-415) — submit only flips disabled, no PROCESSING label, no timeout; a lost ack leaves the form permanently disabled (username check can sit on "Checking…" forever) — shared markPending + emitWithTimeout + restore on timeout.
3. `[MAJOR] public/clientDealUi.js:109` — Deal-detail accept/decline/cancel — no pending, no disable, no timeout; the same trade-accept action has PROCESSING in the offer modal but not here — reuse the pending helper + emitWithTimeout.
4. `[MAJOR] public/clientDeedDetailUi.js:20` — Build/sell/mortgage on a deed — no in-flight guard; every snapshot re-render re-enables the buttons, so a fast double-click can buy/sell two houses — disable + PROCESSING until ack or snapshot confirms.
5. `[MAJOR] public/main.js:646` — Start round (host) — no busy guard, no label, no timeout; double-click emits twice and failure is chat-only — busy flag + 8s timeout + button state.
6. `[MAJOR] public/clientTradeUi.js:316` — Contract propose/counter/adjust and in-modal repay (:929, :954) — no pending/timeout anywhere; the rail repay path (clientRailEvents.js:95) has both, so the same repayment is inconsistent across surfaces — route all through markPending + emitWithTimeout.
7. `[MAJOR] public/clientCosmetics.js:11` — Collection load — "LOADING COLLECTION…" has no timeout or retry (stuck forever on a dropped ack); claim/equip at :136 has no pending/guard/timeout — add timeout + retry + pending button.
8. `[MAJOR] public/clientNightShift.js:599` — Patrol run verification — start-patrol-run failure is silently ignored, and finish-patrol-run no-ops when no runToken (submitNightShiftRun:465) with zero feedback; the signed-in player sees a local best but the run never verified — surface "run not verified" and skip local best claims.
9. `[MINOR] public/main.js:838` — Pay jail fine / use Get-Out card — no busy guard or timeout; double-click double-emits and failure is chat-only — busy + timeout.
10. `[MINOR] public/clientParlorBindings.js:136` — Claim season reward — no pending/disable/timeout; rapid clicks re-emit and only a toast confirms — markPending + timeout.
11. `[MINOR] public/clientSocialSurfaces.js:1073` — Player card account fetch — no pending/stale/error indicator; a failed or slow get-public-player-card silently shows the seat-only profile with no retry — loading flag + error copy + retry.
12. `[MINOR] public/clientGameSave.js:117` — Resume round — no pending label and no ack timeout; a dropped ack leaves a dead-looking SAVE FOUND button — pending + timeout + notice.
13. `[MINOR] public/main.js:448` — Economy snapshot (Activity/Wallet/market quotes) — no loading or stale indicator; the rail silently rebuilds later — loading flag + stale-while-revalidate like rankings.
14. `[MINOR] public/main.js:463 + public/index.html:127` — First music load — the 12.0 MB pondering-the-cosmos.mp3 buffers with no indicator; toggle reads ON while silent and play() rejection is swallowed (prior 4.10) — waiting/canplay state + smaller asset.
15. `[MINOR] public/clientAccountIdentity.js:507 + public/clientLobbyUi.js:846` — Remaining silent acks — account-logout (noop) and leave-room (empty ack) failures stay invisible; patrol start joins this class in #8 — surface via parlorNotice.

## Notes
**Boot:** static home shell paints immediately with "CONNECTING." labels; interactivity waits on 762 KB of JS across 52 module requests (no bundler), so controls are inert during the JS waterfall but the page never looks blank. No boot skeleton exists; acceptable.
**Modal data:** rankings/social/season/match-history have loading + stale-while-revalidate + 8s timeouts; cosmetics lacks timeout; economy/player-card fetch have neither.
**Multi-step:** auction countdown, night-shift wave/hearts, casino reel (aria-busy + skip), contract preview (aria-live) and room entry ("Connecting…") are legible; trade send and deed actions are not.
**A11y:** `aria-busy` exists only in the 6 pending helpers + casino reel + username check; absent on every surface in #3-#15. Detail deferred to RR-30.

## Pending-coverage matrix
Legend: Y = explicit state, ~ = implicit/weak (snapshot-only or chat-only), N = none.

| Action | Pending | Success | Failure |
|---|---|---|---|
| roll-dice | Y (Rolling…, busy, 8s) | ~ snapshot | Y (timeout + chat) |
| end-turn | Y (busy, 8s) | ~ snapshot | Y |
| purchase-property (choice/rail) | N | ~ snapshot | Y chat |
| decline/pass property | N | ~ snapshot | Y chat |
| auction-bid / auction-pass | N | ~ snapshot bid/leader | Y chat |
| manage-property (build/sell/mortgage) | N | ~ modal re-render | Y chat |
| start-game | N | ~ phase change | Y chat |
| pay-jail-fine / use-jail-free | N | ~ snapshot | Y chat |
| vote-global-event | N | ~ snapshot chip | Y chat |
| declare-bankruptcy | N | ~ modal closes | Y chat |
| propose/counter/adjust-trade | N (closes pre-ack) | ~ chat | Y chat (offer lost) |
| respond-trade (offer modal) | Y no timeout | Y modal closes | Y restore + chat |
| respond/cancel trade (deal detail) | N | ~ modal closes | Y chat |
| propose/counter/adjust-player-contract | N | ~ chat | Y chat |
| respond/cancel-player-contract | N | ~ modal closes | Y chat |
| repay-player-contract (rail) | Y + 8s | Y rail + chat | Y |
| repay-player-contract (modal) | N | ~ chat/status | Y chat |
| take/repay-bank-loan | Y + 8s | Y economy refresh | Y |
| market order/margin/short/option | Y + 8s (wiped by rebuild) | ~ desk re-render | Y chat |
| place-casino-bet | Y + 8s (wiped by rebuild) | Y reel | Y chat |
| sponsorship request/contribute/withdraw/accept/decline | N | ~ update event | Y chat |
| account create/login/update | ~ disabled only, no timeout | Y close + chat | Y form/alert |
| check-username | ~ aria-busy, no timeout | Y status | Y status |
| account-restore | N | ~ UI update | N (silent clear) |
| restore-session (connect / resume) | N | ~ view | ~ toast explicit / N background |
| create-room / join-room | Y "Connecting…" + retries | Y setup/lobby | Y toast + bounce home |
| list-rooms / quick-table | Y + 5s | Y list/join | Y toast + retry |
| get-social-data | Y + stale + 8s | Y | Y + try again |
| search-players (social/rankings) | Y + 8s | Y results | Y text |
| friend/invite/notification/clear ops | Y + 8s | Y toast | Y toast |
| get-match-history | Y + 8s | Y history view | Y toast |
| claim-season-reward | N | Y toast | Y toast |
| leaderboard / season | Y + stale + 8s | Y | Y + retry |
| get-cosmetics | Y no timeout | Y grid | ~ locked copy, no retry |
| claim/equip-cosmetic | N | ~ re-render | Y toast |
| get-economy-snapshot | N | ~ numbers | N |
| get-public-player-card | N | ~ profile update | N |
| set-setting | N (optimistic) | Y snapshot | Y rollback + toast |
| set-player-appearance | N | Y | Y toast + chat |
| send-chat | N | Y echo | Y chat |
| leave-room | N | N (view) | N (noop) |
| finish-patrol-run | Y (guard) | Y HUD/best | Y notice |
| start-patrol-run | N | ~ HUD | N (silent) |
| copy room code | ~ flash/announcer | Y | Y "COPY FAILED" |
| music toggle | N | ~ audio (after 12 MB buffer) | N (swallowed) |
| wallet upgrade / item actions | dead seam (never wired) | — | — |
