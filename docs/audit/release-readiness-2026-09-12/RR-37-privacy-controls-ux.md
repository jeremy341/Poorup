# RR-37 — Account & Privacy Controls UX

**Audit:** Release Readiness (40-agent) · Wave 4 · Mission RR-37 · 2026-09-12
**Mode:** READ-ONLY, verified end-to-end. All enforcement claims traced to handlers/stores; UI claims traced to bindings.

Prior audit cross-checked (`docs/audit/full-codebase-audit-2026-09-12.md`, §4.4/4.5/4.12/4.13, §7.15, §3.3 confirmed; RR-02/RR-04 server gaps referenced, not re-flagged).

## Findings (15)

1. **[BLOCKER]** `server/serverSocketSocial.js:388,408` — Player-card `recentMatches` is populated regardless of `canSeeRecent`/history privacy (only room-visibility is filtered); `PRIVATE` and `FRIENDS` history both leak 3 recent matches (dates/placements/participants), rendered unconditionally at `public/clientSocialSurfaces.js:1226` — user expects a PRIVATE toggle to stop friends (and expects FRIENDS-mode to stop strangers) from seeing any match list — fix: return `[]` unless `context.canSeeRecent`, and exclude private-room records when `privacy.history === 'private'`.
2. **[MAJOR]** `public/index.html:461-468`, `public/clientAccountIdentity.js:505-522` — No delete-account, export/download, clear-history, or revoke-sessions control anywhere in the UI (grep: zero handlers) — user expects an account panel to manage/erase the data RR-02/RR-04 showed is stored — fix: add DELETE ACCOUNT (confirm), EXPORT JSON, SIGN OUT OTHER DEVICES to the account tab; server endpoints per RR-02/RR-04.
3. **[MAJOR]** `public/clientAccountIdentity.js:505-522` — Sign-out clears only `ACCOUNT_SESSION_KEY`; local designs (`poorup.profiles.v1`), active design, saved game, alias, theme/audio/panel prefs, local Patrol best remain visible to the next user of a shared browser; `account-logout` ack is `noop` (`:507`) so failures are invisible — user expects "sign out of this device" — fix: "CLEAR LOCAL DATA ON THIS DEVICE" action + toast; route ack failure to `parlorNotice` (prior 4.13).
4. **[MAJOR]** `public/clientSanitize.js:327-332` + `public/clientTheme.js:182` — Only theme listens for `storage`; account session/profiles don't. After logout in tab A, tab B keeps rendering "signed in" while its token is server-revoked, producing unexplained error acks — user expects sign-out to apply everywhere — fix: storage-event reconciliation for session (and profiles).
5. **[MAJOR]** `public/clientParlorBindings.js:424-434` + `server/socialStore.js:196-204` — BLOCK fires with no confirm, silently deletes friendship + pending invites, and there is no blocked-list/unblock UI anywhere (grep: no `unblock` handler) — user expects to review and undo blocks — fix: confirm dialog + "Blocked players" section with UNBLOCK.
6. **[MAJOR]** `public/clientProfileBindings.js:127-134` vs `public/index.html:465` — Saving any design silently overwrites `account.color`/`avatarGrid` on **all** devices, while the account panel copy says "Player Designs only changes a saved design"; the edit modal has no color/face fields — user expects account identity to change only via account edit — fix: explicit "use design as account identity" (or account-level color/face fields) + accurate copy.
7. **[MAJOR]** `public/clientAccountIdentity.js:230-235` — On register/login, `updateAccountFromResponse` resets achievements and `saveUnlockedAchievements()` overwrites the local store, so every guest badge (incl. Night Shift, `clientNightShift.js:479-484`) disappears with no warning — user expects guest progress to carry over (copy: "Guest play stays local until you choose to create an account") — fix: pre-register warning or merge local unlocks; label guest badges LOCAL-ONLY.
8. **[MAJOR]** `server/serverSocketSocial.js:416-433`, `server/accountStore.js:696-717,785-800` — No searchability, stats-visibility, or leaderboard opt-out: every account with ≥1 game is findable by username/exact search and ranked on 15 boards; no appears-offline state — user expects discoverability control beyond history — fix: add `discoverability` (searchable/leaderboards) to `PRIVACY_RULES` and filter search/`getPublicPlayerCard`/`getLeaderboard`.
9. **[MAJOR]** `public/clientAccountIdentity.js:281-284` — Edit Account renders no password field (register/login only) and `accountStore.js` has no change-password/reset verb — user expects credential management; a forgotten password is unrecoverable — fix: current+new password flow in edit modal; state recovery limitation in copy.
10. **[MAJOR]** `public/clientProfileRender.js:93-97,310,330` + `public/index.html:393` — Copy says "Guest play stays local" and stats show "LOCAL ONLY"/dash counters, but guest completed rounds are stored nowhere (no local stats/history store; server only writes accounts) — user expects at least a local record — fix: persist guest match stats locally or reword to "Guest rounds are not saved."
11. **[MINOR]** `public/clientAccountIdentity.js:465-499` + `public/clientProfileBindings.js:364` — Esc/scrim/CLOSE discards unsaved name/privacy edits with no dirty-check; submit has no "SAVING…" state (prior 4.12) and success feedback is game-chat-only `say` (`public/main.js:395-402`), invisible on the profile view — fix: dirty-confirm + progress label + toast.
12. **[MINOR]** `public/clientParlorBindings.js:382-398` — REMOVE FRIEND (also decline/cancel-request) executes instantly with no confirm/undo — fix: `openConfirmModal` (prior 4.4).
13. **[MINOR]** `public/clientSanitize.js:301-314` + `public/clientProfileRender.js:116-120` — `sanitizedAccount` drops `createdAt`, so a signed-in account shows JOINED: "GUEST" after any reload — fix: carry `createdAt` through session sanitization.
14. **[MINOR]** `public/styles.css:2792` — `.account-card { overflow: hidden }` with no inner scroll: on short viewports the privacy selects/save button are clipped (prior 3.3) — fix: `overflow-y: auto` scroll region.
15. **[MINOR]** `public/clientSocialSurfaces.js:368-369` — Notifications support read/unread only; no per-kind mute/preferences despite friend/invite/achievement notices all landing in INBOX — fix: notification preferences in account tab.

## Ranked minimal UI additions for an honest "you control your data" story
1. Fix the recent-matches privacy leak.
2. DELETE ACCOUNT + EXPORT JSON + SIGN OUT OTHER DEVICES in the account tab (server verbs already scoped by RR-02/RR-04).
3. Blocked-list manager with unblock + confirm.
4. Cross-tab session sync + "clear local data" on sign-out.
5. Guest→account warning and LOCAL-ONLY labels.

## Control matrix

| Setting / action | Exists | Enforced server-side | Feedback | Missing |
|---|---|---|---|---|
| Edit display name | ✅ edit modal | ✅ `accountStore.js:587` persists | ⚠ panel update + chat-only "say" | progress state, unsaved guard |
| Edit color/face (account) | ❌ direct (only hidden via design save) | ✅ `accountStore.js:589` | ❌ none | account fields, propagation notice |
| Sign out | ✅ | ✅ `accountStore.js:573-582` revokes token | ⚠ panel flips; failure invisible (noop) | toast, clear-local-data, cross-tab |
| History visibility public/friends/private | ✅ 3 options | ⚠ `roomSetup.js:183-191` + projections; **card recentMatches leak** | ⚠ on Save Account only | card gating fix (BLOCKER #1) |
| Achievements friends/private | ✅ 2 options | ✅ `socketSocialApi.js:145`, `accountStore.js:345` | ❌ | — |
| Friend requests everyone/friends/nobody | ✅ | ✅ `serverSocketSocial.js:312-321` | ❌ | — |
| Room invites friends/nobody | ✅ | ✅ `serverSocketSocial.js:516-522` | ❌ | — |
| Searchability / hide from search | ❌ | n/a — all searchable (`:416-433`) | ❌ | toggle + filters |
| Stats / leaderboard visibility | ❌ | always public (`accountStore.js:696,785`) | ❌ | toggle + filters |
| Appears offline | ❌ | no presence system | ❌ | product decision |
| Block player | ✅ one-click | ✅ `socialStore.js:196-204`; chat/search/cards filter | ✅ toast | confirm, blocked list, unblock |
| Remove friend | ✅ | ✅ `socialStore.js:188-194` | ✅ toast | confirm/undo, remove-all |
| Clear recent players | ✅ | ✅ `recentClearedAt` (`accountStore.js:737-743`) | ✅ toast | confirm (optional) |
| Notifications read | ✅ | ✅ | ✅ state change | mute/preferences |
| Delete account | ❌ | ❌ | ❌ | server + UI |
| Export / download data | ❌ | ❌ | ❌ | server + UI |
| Clear match history | ❌ | ❌ | ❌ | server + UI |
| Revoke sessions / other devices | ❌ explicit (implicit full revoke on every login, `accountStore.js:485-498`) | ✅ | ❌ not communicated | UI + copy |
| Password change / recovery | ❌ | ❌ | ❌ | endpoint + modal field |
| Guest local record | ❌ no local stats/history store | n/a | ⚠ "LOCAL ONLY" copy implies one | persist locally or reword |
