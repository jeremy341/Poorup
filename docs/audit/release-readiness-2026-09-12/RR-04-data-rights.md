# RR-04 — User Data Rights Audit (Export / Retention / Minimization)

**Audit:** Release Readiness (40-agent) · Wave 1 · Mission RR-04 · 2026-09-12
**Mode:** read-only
**Verdict:** Conditional no-go for a hosted public release with optional accounts (especially EU/UK/CA/BR): the data set is small and well-minimized (no email/UA, chat transient, telemetry anonymous, secrets hashed), but there is no export, no deletion, no retention schedule, no privacy disclosure, and AI egress is silent. A private/invite-only friends beta without regulated users is technically shippable.

Prior-art note: session-token perpetual validity (full audit 8.2/8.14), guest `clientId` bearer (8.13), accountId exposure (END-TO-END F-33), backup checksum/rotation defects (7.6–7.9, 8.5) are already tracked and are not re-scored below.

## 1. Data inventory (per account)

| Data | Where | Bounds |
|---|---|---|
| id, username, displayName, color, 8×8 avatarGrid | `server/data/accounts.json` (gitignored, `.gitignore:11`) | none |
| passwordSalt + scrypt hash, sessionTokenHash | same file (`accountStore.js:451,496,515`) | sessions valid forever (8.2) |
| stats incl. patrolBest/patrolAceRuns, 15 economy counters | same file (`accountStore.js:399-404,667-679`) | none |
| history summaries (cash/properties) | same file (`accountStore.js:260`) | ≤50 |
| full matchHistory (contracts, casino, market, botDecisions ≤200, participants w/ displayNameAtMatch + avatarAtMatch) | same + `matches.json` + `participantFields.js:33-34,106-109` | ≤50/account, 500 global (`matchStore.js:9,207`) |
| achievements (id, timestamps, gameId, evidenceHash) | `accounts.json` + `achievements.json` (`achievementStore.js:31-39`) | ≤100/account |
| privacy prefs, recentClearedAt, createdAt | accounts.json | — |
| social graph, invites, reports, notifications | `social.json` (`socialStore.js:108-147`) | 10k arrays, 100 notices/account |
| season standings/claims | `seasons.json` (`seasonModule.js:104-120,296`) | 12 seasons, 5k rows, 64 claims |
| cosmetics/tokens | `cosmetics.json` (`cosmeticCatalog.js:106-124`) | 200 owned, 300 claims |
| telemetry (anonymous aggregates) | `telemetry.json` (`telemetryModule.js:43-55`) | 5k events, no accountId |
| in-memory only | sessions map, IP rate/auth buckets, chat relay, room+clientId, patrol run tokens | pruned on caps/GC |
| client-only | account bearer token, profile/designs, theme, sound/music, guest alias, save (board + **chat `messages`**), patrol/night-shift bests (`clientSanitize.js:9-14`, `clientGameSave.js:49-62`) | — |

Guests leave **no durable account**, but their `nickname`/`avatarGrid` are persisted inside every participant's match record (`roomSetup.js:312`, `participantFields.js:34,106`) with no deletion path. IPs are used only in-memory for rate limits (`httpRateLimiter.js:12-14`; `serverSocketAccount.js:78-97`); no UA, email, phone, or cookies are collected. Chat is relay-only, never persisted server-side (`serverSocketSocial.js:40-44`) — good.

## 2. Findings

1. **[BLOCKER]** `server/serverSocketAccount.js:118-145` + `server/accountStore.js:430-801` — no account deletion/erasure verb exists anywhere (grep across server/public confirms); id remains in achievements, seasons, cosmetics, social, matches, backups — GDPR/CCPA erasure requests cannot be honored once hosted — add authenticated delete flow with cascade (or pseudonymization) plus documented backup handling.
2. **[MAJOR]** `server/serverSocketSocial.js:52-56` — only `get-self-profile` (live socket view); no download/export endpoint or UI (`public/` has no Blob/download; `clientAccountIdentity.js:267-278` editor has no export) — Art. 15/20 requests need manual operator access — add JSON export endpoint/button or a published DSAR runbook.
3. **[MAJOR]** `serverStorePaths.js:16-25` + `server.js:83-97` + `backupStore.js:56-60` — when `POORUP_DATA_DIR` is unset, store paths are `undefined` (stores fall back to `server/data` defaults) so `backupJsonStores` filters everything out and `[].every(...)===true` reports success; backups silently protect nothing while `POORUP_BACKUP_DIR` appears configured — pass effective `store.filePath` values or fail loudly.
4. **[MAJOR]** `server/botAdvisor.js:210,335-374` — every AI bot table sends the live game state (own private loans/market/casino, opponents' cash bands, board, obligations) to `api.deepseek.com`; UI says only "AI Advisor" (`clientSocialSurfaces.js:908,935`) and there is no provider/transfer disclosure or non-host opt-out — transparency + cross-border transfer gap — name the provider and data scope in the privacy notice; offer no-AI default/opt-out.
5. **[MAJOR]** `server/accountStore.js:451,496` + `matchStore.js:9,207` — accounts, session hashes, private match records survive indefinitely; no lastSeen, inactivity policy, or age-based pruning — storage-limitation exposure for abandoned accounts — define and enforce a retention schedule (sessions TTL, inactive-account purge).
6. **[MAJOR]** `server/storeIO.js:49-51` + `backupStore.js:7,39-53` — all PII/credential material is plaintext JSON and plaintext backup copies (7 retained); backups keep an account's data after any future deletion — breach blast radius + erasure-infeasible-without-runbook — disk-level encryption and a documented backup purge/re-encryption procedure.
7. **[MAJOR]** `server/participantFields.js:33-34,106-109` + `roomSetup.js:312` — guest nickname/avatar persist in other accounts' history and `matches.json` with no consent artifact and no request path for non-account holders — "no account" promise leaves a de facto profile that cannot be corrected/erased — omit avatars for guests, or provide an anonymous deletion/redaction request path.
8. **[MINOR]** `server/socialStore.js:174-177,206-213,240-249,131,260` — declined requests, expired invites, reports, and old notifications retain account IDs until 10k/100 caps; no age pruning — minimization drift — prune terminal records older than N days on load/persist.
9. **[MINOR]** `server/telemetryModule.js:11,57-59,85` — 5k-event cap is count-only, no age bound, whole file rewritten per event and copied into backups (no account linkage — good) — document telemetry retention and prune by age.
10. **[MINOR]** `server/accountStore.js:584-593,731-743` — correction is partial: displayName/color/avatar/privacy only; username immutable, no password change/reset, no history/achievement deletion (only "clear recent players") — Art. 16 + support burden — add password change and history-clear endpoints, or document the limits.
11. **[MINOR]** `.ulpi/design/ACCOUNT-PROFILE.md:34` vs `server/accountStore.js:485-498` — "Expired sessions fail closed" is inaccurate (server has no session TTL; only logout/rotation invalidate); no privacy policy/terms/telemetry disclosure exists in-repo (grep found none) — docs/policy honesty — correct the claim and publish a privacy notice.
12. **[MINOR]** `public/clientGameSave.js:49-62` + `clientSanitize.js:329` — local save persists chat `messages` and board state; session bearer stays in localStorage after logout (8.2) — shared-device leakage — add "clear local data" and stop persisting chat.

## Minimal launch requirements

1. Ship account delete + export (or a tested, documented manual DSAR runbook covering guests' persisted match nicknames).
2. Publish a privacy notice: inventory, retention table, telemetry, DeepSeek provider/scope/transfer, AI opt-out.
3. Fix the backup path no-op and document backup retention + per-account purge.
4. Enforce retention: session TTL, inactive-account purge, terminal social-record pruning.
5. Encrypt at rest and stop persisting `sessionTokenHash` (pre-existing 8.14); add a clear-local-data action.
