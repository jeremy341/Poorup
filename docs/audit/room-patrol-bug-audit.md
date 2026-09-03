# Room/Patrol Bug Audit — 2026-09-03

**Method:** 8 parallel read-only scout agents + parent spot-verification of load-bearing quotes. Zero code/UI changes; this file is the only artifact.
**Stack ground truth:** Node + Express + Socket.IO (`server/server.js` 1430 lines, `server/gameLogic.js` 3379 lines, in-memory `Map` rooms — **no Supabase/DB/RLS exists in this repo**). Client is the single file `public/main.js` (8124 lines) + `public/index.html`. `state.live` is hardcoded `true` (`main.js:663`, zero writes) so every `!state.live` "offline" branch is dead code.

---

## Summary

| # | Bug | Severity | Confirmed | Root cause (file:line) | Status (2026-09-03) |
|---|-----|----------|-----------|------------------------|---------------------|
| 1 | Create/join errors invisible → silent bounce to home ("paste code → nothing happens") | critical | CONFIRMED | `main.js:6989-6994` (say→hidden chat), `main.js:7249` (modal closed pre-request) | FIXED (toast on ack, visible before home revert) |
| 2 | `suppressRoomUpdates` set by Night Shift, never restored → browser deaf to room forever | critical | CONFIRMED | set `main.js:2915`, never cleared in `stopNightShift` `main.js:2945-2961`, bail `main.js:984` | FIXED (snapshot/restore pattern; resume clears) |
| 3 | Every snapshot force-opens game view — yanks users off Profile/Rankings/Social | critical | CONFIRMED | `main.js:1076` (`showView("game")` in `applyServerState`) | FIXED (auto-show only while already in parlor flow) |
| 4 | No leave-room path at all: Home keeps seat, blocks GC, stalls table, resurrection on reload | high | CONFIRMED | `goHome` `main.js:7026-7056` emits nothing; no `leave-room` client or server (grep 0) | FIXED (new `leave-room` protocol both sides) |
| 5 | Public browse stale-by-design: fetched once on modal open, never pushed/refreshed | high | CONFIRMED | `main.js:3156-3161` vs `main.js:3115-3116`; no push `server.js:645-647` | FIXED (`rooms-updated` push + tab-click refresh + 5s loading timeout) |
| 6 | Stale-room code lockout: dead room reserves a private code ~11 min; re-create fails invisibly | high | CONFIRMED (code) | `server.js:666-668` + GC `server.js:97-119` + grace `server.js:43-45` | FIXED (instant reclaim when room has no connected humans) |
| 7 | Reconnect: `restore-session` ack swallowed by empty callback → "ONLINE" + frozen room after restart/GC | high | CONFIRMED | `main.js:1126`, `main.js:6873`; reject `server.js:643` | FIXED (shared handler: visible notice + status + re-join) |
| 8 | Zero icon/color/nickname uniqueness — all players default to CRIMSON; no grey-out anywhere | high | CONFIRMED | `gameLogic.js:743-763` (no guard), `main.js:4743-4755` (picker), `main.js:677` + `accountStore.js:38-40` (default collision) | FIXED server-side (guard + auto-assign free preset); picker grey-out DEFERRED-UI |
| 9 | Side-channel events ignore the mute — game modals pop over the homescreen, actionable | high | CONFIRMED | `main.js:1182-1214` ungated; popups `position:fixed` siblings `index.html:783-833`, `styles.css:1633` | FIXED at root (seat now released on Home; server stops delivering) |
| 10 | Two tabs of one browser profile share `clientId` → seat hijack, first tab errors | high (if test used one profile) | CONFIRMED | `main.js:664` + `gameLogic.js:3051-3053` | FIXED (per-tab `clientId` via sessionStorage; no legacy migration) |
| 11 | Night-shift heart row renders empty at start (label-dedupe skips first paint) → "hearts lost randomly" | medium | CONFIRMED | `main.js:2093-2096` vs `index.html:113` | FIXED (forced first paint) |
| 12 | Background-tab Night Shift: waves advance while hidden → spawn barrage drains all hearts on return | high | LIKELY (needs runtime) | `main.js:2643-2646`, `2697-2701`, `2779-2785` (re-defer without `document.hidden` re-test) | FIXED (spawn queue freezes while `document.hidden`; visibilitychange coordinator re-arms exactly one step on resume) |
| 13 | Orphan-host lobby: join-cleanup paths remove host without reassign → Start permanently dead | medium | LIKELY | `server.js:728-729` and `server.js:1370` (contrast correct `server.js:676`, `530`) | FIXED (`reassignHostIfNeeded` added to both drifted sites) |
| 14 | Bot-only rooms never GC and pollute public directory forever | medium | CONFIRMED | `server.js:98-119` (`hasConnected` includes bots, `gameLogic.js:466`) + `gameLogic.js:3351-3355` | FIXED (`hasConnectedHumans()` gates GC + browse) |
| 15 | Pasted long/ambiguous codes silently truncated to first 6 alphanumerics → wrong-room join | medium | CONFIRMED | `server.js:128` + `main.js:7252` | FIXED (inline warning when input exceeds 6 chars) |
| 16 | Joining a PUBLIC room mislabels client as private until first snapshot | medium | CONFIRMED | `main.js:6945`; ack `visibility` field never consumed (`main.js:6996`) | FIXED (ack `visibility` consumed; restore path too) |
| 17 | Custom avatars never reach other players during play (`avatarGrid` absent from `getGameSummary`) | medium | CONFIRMED | `gameLogic.js:2971-2993` vs `main.js:1014` | FIXED (field added to projection) |
| 18 | Auction deadlines on unsynchronized clocks; `serverTime` shipped but never read | medium | LIKELY | `main.js:1072`, `6045` vs `server.js:253` | FIXED (`state.serverTimeOffset` from snapshot; `serverNow()` at every auction deadline site) |
| 19 | Chat keyed by nickname — duplicate names cross-wire attribution/color | medium | CONFIRMED | `main.js:1184`, `server.js:1101` | FIXED (`senderId` authoritative; nickname fallback only) |
| 20 | Patrol run result errors swallowed; signed-in runs silently lose achievements | medium | CONFIRMED | `main.js:2812` (`if (response?.success === false) return;`) | FIXED (visible NIGHT SHIFT notice; `serverRunSubmitted` unlatched so retry can occur) |
| — | **Homescreen helicopter leaks hearts into game** (brief hypothesis) | — | **DISPROVEN** | `patrolState` has no hearts `main.js:1914`; all callbacks phase-guarded `main.js:1988/1990/2019`; server has zero heart code (grep `gameLogic.js` → 0) | N/A — disproven, nothing to fix |
| — | `Q-` quick-play code poisoning (brief hypothesis) | — | DEAD CODE | `main.js:7673` unreachable (`state.live` always true, `main.js:663`) | N/A — untouched by design |

## Fix Status — 2026-09-03 (non-UI phase)

17 of 20 fixable findings FIXED across `server/server.js`, `server/gameLogic.js`, `public/main.js` (Status column above). Verification: `node --check` all three files; unit suite `node server/gameLogic.test.js` = **8 suites / 126 assertions passed** (7 new contract suites); 3-socket live end-to-end smoke against the running server = **18/18 passed** covering: public create → `rooms-updated` push → join-by-pushed-code, color-collision auto-assign (`#d74438`→`#286ea1`), duplicate-icon rejection with exact error, `senderId` in chat, `leave-room` seat release + "left the room" broadcast + roster snapshot, instant stale-code reclaim (`ZZ9K2R` re-created seconds after leave), `restore-session` ack with private code, `maxPlayers=2` over-cap rejection.

**Mechanics shipped:** new `leave-room` client→server event + new `rooms-updated` debounced server→client push; `destroyRoom()` shared teardown reused by GC and stale-code reclaim; `Room.hasConnectedHumans()` gates GC, browse purity, and reclaim; appearance uniqueness (preset-order auto-assign on join + rejection on `set-player-appearance`, forwarded acks); `avatarGrid` in game summaries; `senderId` in chat; Night Shift mute snapshot/restore; `applyServerState` only auto-shows the game view when the user is already in the parlor flow; join/create/browse failures now surfaced via the existing toast stack before home revert; heart row forces its first paint; 6-char paste warning; ack `visibility` consumed.

**Open/deferred after phase 3:** only UI items remain — icon-picker grey-out / TAKEN-state visuals, error-toast styling, and popup-over-home layering polish → next (UI) prompt per `Next Steps` below.

## Fix Status — 2026-09-03 (phase 3: remaining non-UI)

The four deferred functional findings + two phase-2 verification gaps + AFK stall fixed. `#10` per-tab `clientId` via sessionStorage (no legacy migration) — two tabs can no longer hijack one seat (`main.js:664-666,896`). `#12` Night Shift spawn queue + wave timer freeze while `document.hidden`; `visibilitychange` coordinator re-arms exactly one staggered step on resume; heart-loss backstops cancelled while hidden (`main.js:2670-2674,2782-2832,3015-3053`). `#18` `state.serverTimeOffset` maintained from snapshot `serverTime`; `serverNow()` replaces local `Date.now()` at every auction deadline create/compare site (`main.js:675,990-991,1080,5922,6045,6061,6140,6250`). `#20` rejected `finish-patrol-run` now toasts the server error and unlatches `serverRunSubmitted` for retry (`main.js:2848-2874`). `syncServerAppearance` rejections surfaced via `parlorNotice` (phase-2 gap, `main.js:7057-7061`). Audit 7.5 transcript leak: `goHome` clears `state.messages`/`state.log` (`main.js:7179-7180`). Audit 7.1 residual: new server AFK turn-timeout watchdog — 15s tick, `TURN_AFK_TIMEOUT_MS` (default 180s, env-tunable), mirrors disconnect-grace cleanup semantics, `nextTurn()` advance + "ran out of time. Turn skipped." broadcast, no double-skip, disconnected seats left to the grace path (`server.js:44-48,602-650`). C7 audit: `leaveRoomForHome()` routes every mid-room path to Home through `goHome()` (6 sites: rankings/social/rules back, page-header ROOMS/PLAY, page-container closes, profile-editor/delete arms).

**Verification (phase 3):** `node --check` all changed files OK; unit suite re-run green (8/8); live server boot OK; night-shift block exercised in a `node:vm` virtual-clock harness — 18/18 assertions (hidden-window freeze + exactly-one resume step + normal wave advance; reject→toast→retry→success latch); AFK watchdog smoke at `TURN_AFK_TIMEOUT_MS=100`: exactly one skip per turn ownership 30.02s apart, correct system-message, turn order advanced A→B.

---

## Agent 1: Private Room Create → Join via Code

**Verdict:** The wire protocol is *sound* — client and server normalize codes identically and `getRoom` exact-matches uppercase Map keys. "Can't join" is a **failure-reporting** failure: every rejection renders into a chat panel inside the hidden game view + a 1px sr-only div while the client teleports the user home with zero visible feedback. The most likely real-world rejection is stale-code lockout after reload/server-restart.

| # | file:line | evidence | sev | conf |
|---|-----------|----------|-----|------|
| 1.1 | `main.js:6989-6994` | `if (response?.success === false) { say(response.error || "Room could not be entered."); state.phase = "home"; showView("home"); renderAll(); return; }` — `say()` → `state.messages` + `#system-announcer` (sr-only, `styles.css:176-179`); `#chat-body` lives inside `#view-game` (`index.html:523,592`) which was just hidden | high | CONFIRMED |
| 1.2 | `server.js:666-668` | `if (requestedRoomCode && roomManager.getRoom(requestedRoomCode)) return callback?.({ success: false, error: 'That private room code is already in use. Choose another.' });` — dead rooms hold codes until GC (`server.js:97-119`: 60s sweep, 10-min `emptySince` grace) | high | CONFIRMED |
| 1.3 | `main.js:6944` | `state.roomCode = requestedCode;` set optimistically *before* ack; on dup-code reject, creator briefly saw the code then invisible bounce | medium | CONFIRMED |
| 1.4 | `gameLogic.js:356-363, 3306-3311` | `createRoomCode()` has no collision loop; `rooms.set` would silently overwrite on a generated-code clash (astronomically rare) | low | CONFIRMED |
| 1.5 | `gameLogic.js:1175-1180` + `server.js:43` | lobby ghosts (`disconnected=false`, socket open) pass `canJoin` — room can hold more UI-visible seats than cap | low | CONFIRMED |
| 1.6 | `server.js:128` / `main.js:7252` / `gameLogic.js:3316` | case/whitespace symmetry verified — the "case sensitivity" suspect is ruled out | — | CONFIRMED non-issue |

**Trace:** `#rc-create-btn` (`main.js:7330-7356`) → `pendingRoomMeta {roomName,visibility,roomCode}` → `enterParlor()` (`main.js:6940`) → `create-room` (`main.js:6981-6987`) → `normalizeRoomCode` (`server.js:126-129`) → gates (`server.js:663-668`) → `RoomManager.createRoom` (`gameLogic.js:3306-3311`, ctor honors code `3038`) → `socket.join` + `emitRoomState` + ack with code (`server.js:689-692`) → creator's `#tn-room` (`main.js:3332-3339`). Joiner mirrors via `join-room` (`server.js:695-748`), `addOrReconnectPlayer` (`gameLogic.js:3050-3090`), ack private-only code (`server.js:747`).

**Repro (2-browser):** B pastes a nonexistent `ZZZZZZ` → modal closes, game view flashes, B lands on home with **no visible error** (compare: local typo `AB12` *does* show inline "ENTER A 6-CHARACTER ROOM CODE." — the gap is exactly the network path). A re-creates same code after closing/reloading tab (<11 min) → same invisible bounce.

---

## Agent 2: Public Room Browse

**Verdict:** Server half works — `listPublicRooms` includes lobby rooms (no started/full exclusion; `game.started` unreferenced). The breakage is client staleness: the directory is fetched **exactly once**, only when the modal opens; nothing pushes updates and re-clicking BROWSE inside an open modal re-renders the cached array. A room created after the other browser opened Browse is invisible indefinitely — reads as "browse is broken."

| # | file:line | evidence | sev | conf |
|---|-----------|----------|-----|------|
| 2.1 | `main.js:3156-3161` vs `3115-3116` | `if (tab === "browse") requestRoomsDirectory();` only in `openRoomsModal`; tab switch does `renderRoomsList()` (cache re-render) | high | CONFIRMED |
| 2.2 | `server.js:645-647` | `socket.on('list-rooms', ...)` reply-only; grep proves no server event ever pushes directory changes (`rooms-updated` absent) — unlike social, which has `social-update` | high | CONFIRMED |
| 2.3 | `main.js:6945` + `gameLogic.js:3256` | joining public room from browse → client sets `roomVisibility "private"` (shows raw code in nav) until first `update-state`; ack `visibility` (`server.js:747`) never read | medium | CONFIRMED |
| 2.4 | `main.js:3139-3153` | `roomsLoading` reset only in ack — dropped ack sticks panel on "CHECKING PUBLIC TABLES…" forever | medium | LIKELY |
| 2.5 | `main.js:7360-7370` | dead offline branch injects phantom directory row with `code:""` → `enterParlor("")` becomes a create | low | dead code |
| 2.6 | `gameLogic.js:3353` | disconnect-grace edge: all humans >10s throttled → room vanishes from browse while alive to 10-min GC | low | CONFIRMED |
| 2.7 | `main.js:3022-3027` | `r.code`/`r.name` interpolated into innerHTML unescaped (contained only by `normalizeRoomName` charset strip `server.js:131-133`) | low | CONFIRMED |

**Repro (2-browser):** B opens ROOMS→BROWSE (empty state). A creates a PUBLIC table. B re-clicks BROWSE tab, toggles ALL/OPEN/LIVE — list stays empty. Only closing the modal and reopening shows A's table.

**Fix locus (describe only):** debounced `io.emit('rooms-updated', listPublicRooms())` after create/join/start/disconnect/GC + refresh on in-modal tab click.

---

## Agent 3: Private Code Paste Flow

**Verdict:** Paste mechanics are correct both directions (`" abc123 \n"` joins fine — `input` filter `main.js:7252` + independent server re-normalize). The "no result" symptom is the same invisible-error sink as A1, aggravated because **the join modal — the owner of the only visible error slot `#join-form-error` — is closed before the request even goes out**. Suspected `Q-` bug: dead code.

| # | file:line | evidence | sev | conf |
|---|-----------|----------|-----|------|
| 3.1 | `main.js:7249-7250` | `closeRoomsModal(); enterParlor(code);` — network-phase errors can never land in `#join-form-error` (`index.html:274`) | high | CONFIRMED |
| 3.2 | `main.js:6989-6995` | all rejections ("Room not found." `server.js:713`; "Room is full."/"Game is already in progress." `gameLogic.js:3073-3080`) → `say()` → hidden surfaces → silent home bounce | high | CONFIRMED |
| 3.3 | `main.js:1231-1233` | `say()` dedupes identical consecutive system messages — repeat failed joins don't even re-announce to assistive tech | low | CONFIRMED |
| 3.4 | `server.js:128` + `main.js:7252` | silent truncate-to-6: paste `ABC1234` joins `ABC123`; `"ROOM ABC12"` → `ROOMAB` — wrong valid room, no warning | medium | CONFIRMED |
| 3.5 | `main.js:7668-7674` | `Q-` quick branch: `if (state.live)` short-circuits first; `state.live` hardcoded true (`main.js:663`, zero writes) → unreachable | low | CONFIRMED dead |
| 3.6 | `server.js:98-116` | late redemption: host sleeps/closes >10 min → GC'd; server restart → wiped (in-memory). Joiner hits invisible "Room not found" | medium | LIKELY |

**Repro:** per A1 §Repro; plus dual-room truncation misjoin (`ABC123`/`ABC124` both exist → paste 7+ chars).

---

## Agent 4: Realtime / 2-Browser Sync

**Verdict:** Transport is **not** the problem — connection, `socket.join(roomCode)` on all four entry paths (`server.js:634/689/743/1392`), viewer-scoped per-socket broadcast (`server.js:252-261`), full client↔server event symmetry (A8 matrix: zero one-sided events). The breakage is the client state layer + seat lifecycle: F1 view hijack, F2 swallowed reconnect, F3 no-leave ghost seats. If "2 browsers" was actually 2 windows of one profile, F6 explains everything.

| # | file:line | evidence | sev | conf |
|---|-----------|----------|-----|------|
| 4.1 F1 | `main.js:1076` | `showView("game"); renderAll();` at the tail of `applyServerState` — **every** snapshot switches the view, from any page; bot ticks (`server.js:265-389`) amplify | critical | CONFIRMED |
| 4.2 F2 | `main.js:1126` | `emitServer("restore-session", {}, () => {});` — server's `{success:false,'No active session found.'}` (`server.js:643`) discarded; status was already set "online" at `:1114` → frozen room, green dot | high | CONFIRMED |
| 4.3 F3 | `main.js:7026-7053` | `goHome()` emits nothing; player stays `!disconnected` → counted in `${state.players.filter(p=>p.online).length} ONLINE` (`main.js:3340-3342`), `canJoin` (`gameLogic.js:1175-1180`), blocks GC (`server.js:100`) | high | CONFIRMED |
| 4.4 F6 | `main.js:664` + `gameLogic.js:3051-3053` | one localStorage `poorup-client-id` per profile; tab 2 join re-points `existing.socketId`; tab 1 keeps receiving state as `viewer:null` and its actions fail `'Player not found.'` | high | CONFIRMED (code) |
| 4.5 F4 | `gameLogic.js:2971-2993` | `getGameSummary` player mapping enumerates color/cash/… but omits `avatarGrid`; client reads it at `main.js:1014` → custom faces never sync during play | medium | CONFIRMED |
| 4.6 F5 | `main.js:1072` + `6045` | auction `deadline: Number(game.auction.endsAt)` compared to local `Date.now()`; `serverTime` shipped every snapshot (`server.js:253`) and never read | medium | LIKELY |
| 4.7 F7 | `main.js:1184` | chat sender resolved by uppercased nickname — default aliases collide → misattribution | medium | CONFIRMED |
| 4.8 F8 | `main.js:1081-1085` | auction surface re-opened + `setInterval(tickAuction,60)` re-armed on every snapshot mid-auction | low | CONFIRMED |
| 4.9 F9 | `gameLogic.js:3133` + `1212` | `ensureBots` silently fills a solo human's room; peer's join then rejected "Room is full." | low | CONFIRMED |
| 4.10 F10 | `server.js:630-633/683-686/718-721` | the "broadcast to socket.id instead of roomCode" suspect is ruled out — all joins/leaves are correctly roomCode-keyed | — | CONFIRMED non-issue |

**Repros (2 profiles):** F1 — both in room, game running; B opens Profile; A rolls → B teleported to board. F2 — restart node while both in lobby → both "ONLINE", boards frozen, A's roll → dead-room error only in log drawer. F3 — B clicks brand-home → A still shows "2 ONLINE", C rejected "Room is full.". F6 — one browser, two windows, same code → both drive one token, first window errors.

---

## Agent 5: Default Icon Uniqueness (4 defaults)

**Verdict:** Requirement is unimplemented at **every layer** — broken by omission. No uniqueness guard in server mutation paths, no TAKEN/greyed state in the picker, and the default (index 0 = CRIMSON) collides on join by construction.

| # | file:line | evidence | sev | conf |
|---|-----------|----------|-----|------|
| 5.1 | `main.js:337-342` | the 4 defaults: CRIMSON `#d74438`, COBALT `#286ea1`, AMBER `#d9a62f`, VERDANT `#35a653` — icon == color (pixel face tinted by preset, `main.js:59,103-106`) | — | CONFIRMED |
| 5.2 | `gameLogic.js:743-763` | `setPlayerAppearance` — last-writer-wins, zero conflict check (only guard: nickname edit blocked post-start `:752`) | high | CONFIRMED |
| 5.3 | `server.js:649-694, 695-749, 766-781, 606-621, 1383-1389` | all four appearance entry points (create/join payload, `set-player-appearance`, `account-update` cascade, invite-join) accept duplicate color/avatarGrid unconditionally; `normalizeColor`/`normalizeAvatarGrid` are shape-only (`server.js:140-154`) | high | CONFIRMED |
| 5.4 | `main.js:4743-4755, 7705-7711` | `#su-grid` picker statuses are ACTIVE/THIS TABLE/AVAILABLE only — no disabled/TAKEN state; every member sees all 4 as available | medium | CONFIRMED |
| 5.5 | `main.js:677` + `accountStore.js:38-40` | `appearance: 0` default AND account color fallback `#d74438` → two fresh accounts join identical | high | CONFIRMED |
| 5.6 | `main.js:628-632` | the only collision logic (`buildPlayers` bot-collision filter) is inside dead `!state.live` | — | CONFIRMED dead |
| 5.7 | `gameLogic.js:3150-3157` | bots take fixed `colors[index % len]` — bot/human collisions by design | low | CONFIRMED |
| 5.8 | data for a guard exists | `getRoomSummary` players projection broadcasts `color/avatarGrid/nickname` (`gameLogic.js:3264-3281`) → client already knows every member's icon; `styles.css` has no `su-opt` taken/disabled rule (only username `.is-taken` `:2269`) | — | CONFIRMED |

**Repro (2-browser):** A and B join the same room without touching the picker → both CRIMSON, identical avatars, indistinguishable pieces (`main.js:3601-3618`), and the picker shows all four presets AVAILABLE to both.

---

## Agent 6: Patrol / Hearts / Helicopter Leak

**Verdict:** Brief hypothesis **false**. The homescreen helicopter cannot drain game hearts: `patrolState` has no hearts field (`main.js:1914`), all callbacks double-guard `state.phase === "home"` (`main.js:1988/1990/2019`), `showView` stops it on any non-home navigation (`main.js:6903-6923`), and the server owns zero heart logic (`gameLogic.js` grep → 0). **Exactly one heart decrement exists repo-wide: `main.js:2798`, Night Shift only.** The slice's real critical break is adjacent: `startNightShift` sets `suppressRoomUpdates = true` and **nothing restores it on exit** — one accidental Ctrl+P makes a browser permanently deaf to its room.

| # | file:line | evidence | sev | conf |
|---|-----------|----------|-----|------|
| 6.1 | `main.js:2915` → `2945-2961` → `984` | set-true in `startNightShift`; `stopNightShift` has no reset (grep writers: `:670,:984,:2915,:6943,:7047` only); `applyServerState` bails forever | **critical** | CONFIRMED |
| 6.2 | `main.js:6871-6874` | "Resume round" → `restore-session` with empty ack + no mute-clear → snapshot dropped at `:984`; dead no-op | high | CONFIRMED |
| 6.3 | `main.js:2093-2096` + `index.html:113` | paint skipped when `aria-label` equals initial — shipped label already reads "3 hearts remaining" → **heart row renders empty at shift start**; icons pop in at 2/3 after first miss ⇒ "hearts lost randomly/invisible" | medium | CONFIRMED |
| 6.4 | `main.js:2643-2646, 2697-2701, 2779-2785` | hidden-tab path defers spawns 500ms and advances waves without re-checking `document.hidden` → background ≈60s returns as a `min(6+wave·2,24)`-target barrage → mass `HELIPTER ESCAPED · hearts--` in seconds | high | LIKELY |
| 6.5 | `main.js:2812` | `finish-patrol-run` reject (`server.js:942-945`, >10.5-min run) swallowed; signed-in local fallback is guest-only (`main.js:2831`) → silently lost achievements | medium | CONFIRMED |
| 6.6 | `main.js:1188-1211` vs `:984` | mute-blind side channels: purchase/trade offers still pop over the arcade/homescreen (see 4.x/7.x) | medium | CONFIRMED |
| 6.7 | `main.js:1914, 1988, 2019`; `server.js:929-966` | the helicopter hypothesis, formally disproven (see verdict) | — | CONFIRMED |
| 6.8 | `main.js:7972, 8072` | Night Shift has no visible affordance — Ctrl+P only (P alone = profile editor) → accidental entry, then its heart counter reported as "the game's hearts" | low | HYPOTHESIS |

**Repro (2-browser, 6.1):** A+B in room. A: home → Ctrl+P → play → Escape/EXIT MODE. B starts game — **nothing happens on A**; A's "Resume round" dead; only re-joining by code (`enterParlor` clears mute at `:6943`) or F5 recovers.
**Repro (6.3):** reopen Night Shift — heart row empty until first escape, then appears at 2/3.

---

## Agent 7: Scene Transition & State Cleanup

**Verdict:** Transitions never release room state. `showView` (`main.js:6903-6923`) is the only central hook and manages just the two home systems (clock/helicopter/Night-Shift — teardown there is genuinely complete, `clearNightShiftTimers` `main.js:2101-2133`); `goHome` is client-side only (finding 4.3/F3's twin). The mute (`:984`) is asymmetric — `update-state` gated, side channels not — so live game modals paint over the homescreen (`index.html` popups are siblings of views; `styles.css:1633` `position:fixed`). No listener accumulation exists: `bindEvents()` once (`main.js:8121`), socket handlers once (`:1113-1216`); no rAF-loop leak (13 one-shot rAFs, none reschedule).

Timer inventory (all verified clean unless noted): home clock/helicopter/flight/status `main.js:1935/1989/2007/2012` — cleared `1939/1973-1975`, phase-guarded; Night Shift wave/tick/spawn/target timers `2776/2941/2698/2644…` — cleared `2101-2133`; `auctionTimer` `main.js:1084-1085` re-armed per snapshot (F8 churn); `turnTimerInterval` `:3807` self-guarded `:3814`; `botTimer` local branch dead via `state.live`; `clearPatrolEffect` `:2053` untracked but cosmetic. **Verdict: no classic timer leak — the leak is *state*, not callbacks.**

| # | file:line | evidence | sev | conf |
|---|-----------|----------|-----|------|
| 7.1 | `main.js:7026-7056` | `goHome()` zero `emitServer`; grep `leave-room` → 0 client & server → ghost seat, no GC (`server.js:100`), ghost starts game (`gameLogic.js:1212`), **no server turn timeout exists** (grep 0) → table freezes when turn reaches ghost; reload resurrects user into the room they left (`restore-session` → `showView("game")` `main.js:1076`) | critical | CONFIRMED |
| 7.2 | `main.js:984` + `7047` + `1113-1126` | mute is client-only & memory-only: server keeps broadcasting to a "present" player; reload un-mutes and yanks back in — Home is not a real state | high | CONFIRMED |
| 7.3 | `main.js:1182-1214`, `5837-5883`, `6511+` | `system-message`/`chat-message`/`purchase-offer`/`card-reveal`/`trade-offer`/`player-contract-offer` mute-blind → BUY/ACCEPT modals over home act on the abandoned table (`respond-trade` `:6526`, `purchase-property` `:5802`) | high | CONFIRMED |
| 7.4 | `main.js:6903-6923` | `showView` resets no `state.phase`, clears no game timers — view and phase decoupled; mitigations (`:3814,:5682,:2232`) block worst case | medium | LIKELY |
| 7.5 | `main.js:7026-7056` / `6940-6978` | `state.messages`, `roomCode`, `log`, `players` not reset on Home/re-entry → previous room's transcript + old code briefly shown in new room ("old messages leaked") | medium | CONFIRMED |
| 7.6 | `main.js:663` | `state.live` never false → local fallbacks (incl. `enterParlor` not clearing `botTimer` at `:6970`) are dead landmines | medium | CONFIRMED |
| 7.7 | `main.js:2074` vs `1926` | Night Shift HUD and home clock share `#home-local-time` (intended per design doc; churn benign) — coordinate with A6, do not double-fix | low | LIKELY |

**Repro:** 2-browser steps for 7.1/7.3 are in A4's repro list (shared mechanism). 7.5: Home → join a different code → top-nav + chat briefly show the old room.

---

## Agent 8: Full Codebase Cross-Check Map

**Verdict:** Event matrix fully symmetric (61 client-emittable events; 8 dead *server* endpoints never emitted: `get-self-profile` `server.js:1111`, `get-friends` `:1117`, `get-friend-requests` `:1124`, `get-notifications` `:1131`, `remove-friend` `:1178`, `get-recent-players` `:1265`, `get-leaderboard` `:1309`, `get-bank-loan-offer` `:1020` — LOW). Not a naming bug. Strongest map finds: the **leave-cleanup drift trio** and the **bot-room GC leak**.

**Feature map (grouped):**
- **Room create:** `main.js:7275, 7330-7356, 6940-6944, 6981-6987, 6988-7006` ↔ `server.js:649-693` (`normalizeRoomCode:126-129`, gates `:663-668`, reassign-correct leave `:671-678`) ↔ `gameLogic.js:3038, 356-363, 3306-3312`.
- **Room join:** `main.js:7230-7251, 7297-7300, 6942` ↔ `server.js:695-748` (⚠ lobby cleanup `:724-733` missing `reassignHostIfNeeded`) ↔ `gameLogic.js:3050-3079, 3314-3317`. Invite-accept twin: `server.js:1354-1406` (same gap `:1370`).
- **Browse:** `main.js:3140-3155, 3009-3054, 7303-7308` ↔ `server.js:645-647` ↔ `gameLogic.js:3351-3355, 3285-3296`.
- **Realtime lifecycle:** `server.js:199-266` (emit), `:574` (connection), `:1416-1424` (disconnect), `:511-552` (10s grace + reassign ✓), `:97-119` (GC 60s/10min — ⚠ bot leak), `:623-643` (restore-session). Client: `main.js:942, 964-975, 982+, 1113-1216, 7026-7056`.
- **Patrol/helicopter:** home `main.js:1909-2058`; Night Shift `main.js:2061-2976`; server token-only `server.js:925-966`; results `accountStore.js:421-433`.
- **Hearts:** single decrement `main.js:2798`; single reset `main.js:2921`; HUD `main.js:2091-2096`; markup `index.html:113`; styles `styles.css:562-564`; asset `assets/parlor-patrol/heart.svg`. No server hearts.
- **Icons/appearance:** presets `main.js:337-342`; faces `main.js:16-21`; default `main.js:677`; picker `main.js:4743-4755, 7705-7711`; sync `main.js:6925-6938`; server `server.js:766-781, 606-621`; logic `gameLogic.js:743-763`; fallback collision `accountStore.js:38-40`.

**Duplicate/parallel logic (drift risk):** 7 client code-validation sites vs 1 server normalizer; **3× copy-pasted leave cleanup with drift** (`server.js:671-678` ✓, `:724-733` ✗, `:1366-1377` ✗) — the orphan-host bug; 4 appearance entry points all converging on unguarded `setPlayerAppearance`; 2 achievement submit paths for Night Shift (guest-local vs server-verified); two unrelated patrol systems sharing art/readouts.

---

## Unresolved / Needs Runtime Repro

1. **Which rejection string fired for the user** — none are server-logged; confirm via devtools ack inspection or the reported repros above.
2. **Was the test 2 profiles or 2 windows of 1 profile?** (A4-F6 seat-hijack vs everything else.) Also confirm both accounts had *different* nicknames (chat cross-wire, A4-F7).
3. Was the dev server auto-restarting (nodemon) between create and join — every join would "room not found" invisibly.
4. Bot-room GC leak and orphan-host lobby start-deadness (A8 §2/§4) — CONFIRMED by code, need live timing.
5. Hidden-tab Night Shift spawn barrage (A6-F4) — static reading says yes; browser timer clamping may soften.
6. Stuck "CHECKING PUBLIC TABLES…" (A2-#5) — kill server mid-`list-rooms` and observe.
7. Whether `#auction-modal` (locked scrim) traps a muted/ homescreened player when re-opened by a stray snapshot (A7-#3).
8. Clock-skew magnitude on test machine for auction expiry (A4-F5).

## Next Steps for Fix Phase (DO NOT IMPLEMENT)

**Priority order, all described only:**

1. **Surface errors visibly (fixes the symptom behind A1/A2/A3 reports):** route create/join ack failures to a visible toast (a `#toast-stack` already exists, `index.html:14`, currently social-only) *before* reverting home; keep `#join-form-error` usable by delaying `closeRoomsModal()` until after the ack. Add a `rooms-updated` push + in-modal browse refresh + ack timeout for the loading state.
2. **Single mute-owner invariant (A6-F1/A4/A7):** make `suppressRoomUpdates` derivable from view state rather than imperative; `stopNightShift` must restore it (or Night Shift must not set it); gate *all* inbound handlers (side channels included) or make them phase-aware; "Resume round" and reconnect must clear it.
3. **Real leave protocol:** add `leave-room` client emit (`goHome`, modal close) + server handler (seat release, `reassignHostIfNeeded`, `socket.leave`, GC-eligible, "X left" broadcast); exclude ghost seats from `canJoin`/online counts; add server turn timeout; fix the 2 drifted cleanup sites (`server.js:728-729`, `:1370`) by consolidating the 3 copies into one helper; make GC ignore bots.
4. **View-hijack (A4-F1):** `applyServerState` should update data unconditionally but only switch views when appropriate (explicit user intent or game-phase transition), honoring current page.
5. **Icon uniqueness (A5):** compute TAKEN set from room members' colors (already in broadcasts) → disable/grey in `#su-grid`; server-side reject/auto-reassign on collision; offset the default so account fallback ≠ CRIMSON; enforce nickname uniqueness or key chat by playerId.
6. **Night Shift correctness (A6):** paint hearts on init (drop the aria-label dedupe or seed label empty); pause wave advancement while `document.hidden`; surface `finish-patrol-run` rejections; add a discoverable Night Shift affordance (currently Ctrl+P only).
7. **Hygiene:** consume `serverTime` for auction countdowns; add `avatarGrid` to `getGameSummary` players; trim-vs-truncate warning on pasted codes >6 chars; delete dead `!state.live` branches or make them real; add a client-visible retry/rejoin prompt when `restore-session` reports `No active session found.`

---

*All 8 slices returned evidence; every cited line was read from source this session (A1–A8 agents + parent spot-checks). No files other than this document were created or modified.*
