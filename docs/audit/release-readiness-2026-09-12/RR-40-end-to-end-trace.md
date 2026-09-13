# RR-40 — End-to-End Journey Trace (static analysis)

**Audit:** Release Readiness (40-agent) · Wave 4 · Mission RR-40 · 2026-09-12
**Mode:** READ-ONLY.
**Verdict:** **Qualified yes for the happy path, no as a blanket release claim.** Two friends with a shared link, one Create/Quick Table room, desktop, server running: boot → alias → join → roll/buy/trade/rent → bankruptcy/win completes today on the strength of the settlement suites and the fixes `d37b265`/FSB/FTU. But "without the developer" breaks as soon as anything departs from the script: a rematch strands non-hosts, a duplicated tab/crash steals or flaps the seat, any uncaught timer throw exits the process and destroys every live room (no drain, no health endpoint), and opt-in systems (debt mode, contracts, market) contain reproduced money/lifecycle defects. Nothing found is a guaranteed day-one break for a single default session; several are guaranteed on the second session.

Inputs cited: **FCA** = `docs/audit/full-codebase-audit-2026-09-12.md`; **RR** = release-readiness prior; **PM** = `pre-merge-review-2026-09-12.md`; **FSB/FTU** = fix-server/fix-transaction batches. Default room settings (`server/roomSettings.js:8-38`): auction on, casino/market/globalEvents off, bankruptMode `elim`, 10s disconnect grace (`socketRuntime.js:21`).

## 1–3. Boot → alias → room entry → lobby

| Step | What happens | What can fail | Verdict |
|---|---|---|---|
| 1. Link → shell | `index.html:9` loads socket.io, `:919` module `main.js`; `main.js:253` `io()`, connect → `restore-session` (`clientSocketListeners.js:49`). Server: Express + Socket.IO, prod CORS fails closed without `POORUP_ALLOWED_ORIGINS` (RR R1). | Misconfigured deploy → socket refused; UI shows CONNECTING/`Live connection unavailable` (`main.js:285`), no recovery guidance. | **RISK** (deploy-dependent) |
| 2. Alias → Quick Table/Create/Join | Guest alias mandatory (`clientProfileRender.js:641`), inline on title screen; Quick Table races directory → join with 2 retries → fallback create (`clientLobbyUi.js:685-726`). | Alias OK. Two-client fill race is source-tested, not E2E-proven (PM P2; browser matrix since run). Fallback covers it. | **OK** |
| 3. Setup → lobby → start | `su-start` → lobby (`clientLobbyUi.js:1065`); host-only `start-game` (`serverSocketAccount.js:468-483`), ≥2 players (`gameLogic.js:530`); setting acks now structured (FSB §1). | Host offline >10s → `reassignHostIfNeeded` can pick a **bot** (`socketRuntime.js:264`), bots never leave, room permanently unstartable (FCA R3 §8.2, reproduced). | **RISK** (bots >0) |

**Most likely stuck:** host browser sleeps with bots seated; on return nobody can press Start (FCA R3 §8.2).

## 4. Core turn cycle

| Sub-step | What happens | What can fail | Verdict |
|---|---|---|---|
| Roll | `rollTurnRejection` blocks roll with open offer/auction/debt (`gameLogic.js:561-573`); ack timeout 8s (`main.js:586`). | Every snapshot clears `busy/rolling` (`clientStateSync.js:413-414`) → double-roll on doubles (FCA R3 §2.9). | **RISK** |
| Move animation | `scheduleWalks` from server position diff (`clientStateSync.js:408-425`). | Full `renderAll()` each snapshot rebuilds the board mid-walk (FCA R1 §7.1 / R3 §6-7 systemic rebuild). | **RISK** (cosmetic) |
| Tile outcome | Server-authoritative: property, tax, cards (`cardApi.js`), jail/vacation/corners. Double-GO card fixed (FCA "verified fixed"). | `collectFromEach` shortfall has no debt path (FCA R2 §8.14); AFK timeout clears the debtor's `pendingPayment` → debt erased (`socketRuntime.js:676-688`, FCA R2 §8.6). | **RISK** |
| Buy/pass → auction | Offer modal; neutral dismissal fixed (FTU). Decline starts auction by default. | Auction late-bid accepted past `endsAt` (`auctionApi.js:72-77`); bot bid extends deadline without rescheduling finish (`socketRuntime.js:582-598`) → countdown ≠ close, "no valid winner" (FCA R3 §2.3/§2.4). | **RISK** |
| Build/mortgage → end turn | Server guards, pending-flow blockers (`gameLogic.js:1063-1083`). | Core paths are settlement-audited and test-pinned. | **OK** |

**Most likely stuck:** auction UI shows 5s left while the sale already closed, or a winning bidder gets "Auction ended without a valid winner" (`auctionApi.js:140-144`).

## 5. Adversarial turns

| System | Verdict | Evidence |
|---|---|---|
| Auction declare→bids→winner→pay | **RISK** | Above; also loan repayment during auction can drop the leader below bid (FCA R2 §8.10). Default-on in Create Room, off in Quick Table (`clientLobbyUi.js:1081`). |
| Trade propose→counter→accept | **OK/RISK** | Server-authoritative with atomic acceptance (`tradeApi.js`); stale `state.offers` entries can present obsolete terms (FCA R1 §2.4). Assets swap correctly. |
| Player contracts | **RISK** (opt-in) | Hybrid-note dilution lets borrower keep everything (FCA R2 §8.1); unsecured defaults extinguish lender money (FCA R2 §8.4); bots auto-offer these. |
| Market (opt-in) | **RISK** | Option strike/same-round exercise drains house (FCA R2 §2.1); loan-backed cash bypass (R2 §8.8); dead short debt locks actions (R2 §8.7); double-submit class (R3 §2.2). |
| Casino (opt-in) | **OK/RISK** | Server RNG crypto, money conserved; no human per-round bet cap (FCA R2 §8.11). |
| Global events (opt-in) | **OK/RISK** | Vote/settlement server-side; post-end votes/mutations accepted (FCA R3 §2.8), targeting excludes disconnected incorrectly (R2 §8.12). |

**Most likely stuck:** a late "winning" bid never wins, or a market/casino action fires twice (fresh requestId per click, R3 §2.2) — both opt-in.

## 6. Interruptions

| Interruption | Behavior | Verdict |
|---|---|---|
| Brief reconnect (<10s) | Timer cancelled on `restore-session`; seat + obligations intact (`socketRuntime.js:600-608`, `reconnect.test.js`; hardened in `2e50bbc`). | **OK** |
| Reconnect >10s | `expireDisconnectedSeat` disconnects seat, cancels its obligations, skips turn, revokes auction lead; later restore reattaches (`socketRuntime.js:610-630`). | **OK** |
| Server restart | No SIGTERM/SIGINT drain; all in-memory rooms/timers die; reconnects get "No active session found" (FCA R3 §8.1/§1.15). Client shows a notice; explicit "Resume round" clears the local save (`clientGameSave.js:85-110`). | **BROKEN** (game unrecoverable) |
| Second tab | Normal tab gets fresh clientId → safe. Duplicated tab shares sessionStorage clientId → `restoreConnection` reassigns a **live** seat; two sockets can flap it (FCA R3 §2.1, reproduced; `rooms.js:735-748`). | **RISK** |
| Host leaves | Human host reassigned (`socketRuntime.js:261-271`); with only bots left, bot can become host → frozen lobby (R3 §8.2). Leave confirmation added (`clientLobbyUi.js:890-902`, fixes R1 §4.1). | **RISK** |

**Most likely stuck:** Ctrl-duplicated tab or crash-restore overlap silently steals control; the other tab keeps rendering but every action is rejected.

## 7–8. Game end and post-game

| Step | What happens | What can fail | Verdict |
|---|---|---|---|
| Bankruptcy | Elim mode transfers/retires assets; winner = last connected solvent (`gameLogic.js:1095-1114`, `bankruptcyApi.js:33-44`). | Debt-mode (`bankruptMode:'debt'`, custom) never calls `concludeBankruptRound` → game can never end, both seats stuck in debt (FCA R2 §8.3, `bankruptcyApi.js:46-62`). | **RISK** (opt-in) / **BROKEN** in debt mode |
| Stats/history/achievements | `recordRoomStats` on `lastWinner`, try/catch retry, idempotent match update, MatchStore + achievements (FSB §5; `socketRuntime.js:151-191`). | If no connected solvent player, `lastWinner` null → nothing recorded. Store write failures silently skip (R3 §1.14). | **OK** |
| Game-over UI | `showGameOver` ranking by cash+assets (`clientGameModalsUi.js:207-250`). | — | **OK** |
| Rematch | Host `start-game` → `resetForNewGame` (`gameLogic.js:526-539`). Non-host clients never clear `state.gameOver` on the new snapshot (`clientStateSync.js:365-368`, `applyServerState` never resets it) → **stale "X WINS" modal stays open**; their Rematch click errors, "Back to Lobby" leaves the room. | | **BROKEN** |
| Return/leave | `goHome` emits `leave-room`, forfeits assets, GC-able seat (`clientLobbyUi.js:843-884`). | Leave ack discarded → ghost seat possible (FCA R3 §1.13). | **RISK** |

**Most likely stuck:** after host hits Rematch, every other player is trapped behind the old winner modal.

## Final verdict paragraph
**Qualified yes for the happy path, no as a blanket release claim.** Two friends with a shared link, one Create/Quick Table room, desktop, server running: boot → alias → join → roll/buy/trade/rent → bankruptcy/win completes today. But "without the developer" breaks as soon as anything departs from the script: a rematch strands non-hosts, a duplicated tab/crash steals or flaps the seat, any uncaught timer throw exits the process and destroys every live room (no drain, no health endpoint), and opt-in systems (debt mode, contracts, market) contain reproduced money/lifecycle defects. Nothing found is a guaranteed day-one break for a single default session; several are guaranteed on the second session.

## Top 3 visible risks
1. Stale game-over modal after rematch blocks all non-host players (`clientStateSync.js:365-368`; no close/reset on new snapshot).
2. Live-seat hijack via replayed `restore-session`/duplicated tab — two sockets flap one seat (FCA R3 §2.1, reproduced; `rooms.js:735-748`).
3. Auction deadline/close mismatch — countdown lies or winner voided (FCA R3 §2.3-§2.4; `auctionApi.js:72-77`).

## Top 3 invisible-to-them risks
1. Unguarded timer seams escalate one game-logic throw to `process.exit(1)` for all rooms (`socketRuntime.js:693-721` + `server.js:133-136`), and deploys have no SIGTERM drain (FCA R3 §1.1/§8.1).
2. Transient auth failure permanently wipes stored sessions (`clientSocketListeners.js:52-61`; FCA R3 §1.2) — surfaces as unexplained logout.
3. Silent money/fairness drift: AFK timeout erases debts (`socketRuntime.js:676-688`), unsecured contract defaults extinguish lender money (FCA R2 §8.4), debt-mode can never end (FCA R2 §8.3); zero client error observability (FCA R3 §1.6/§5.1) means none of it is diagnosable in the field.
