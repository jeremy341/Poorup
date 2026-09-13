# RR-03 — Legal & Compliance Surfaces: What Exists vs. Missing

**Audit:** Release Readiness (40-agent) · Wave 1 · Mission RR-03 · 2026-09-12
**Mode:** read-only
**Verdict:** NOT RELEASE-READY for legal/compliance. Technical core is solid, but the legal surface count is zero: no privacy notice, no terms, no contact, no retention/deletion story, no age/gambling disclaimer, and asset licenses are unshipped. The IP/telemetry/chat/AI data flows are modest and mostly de-identified, so the fix is documentation and UX, not architecture — cheap to close.

Evidence: repo-wide greps (`privacy|terms|legal|impressum|cookie`, `footer|contact|discord|github|mailto`), storage key inventory, `server/server.js` route table, account/match/social/telemetry store code, bot advisor code, asset folders. Prior 09-12 audit covered "privacy" only as data *projection* (leaderboard/summary scoping), not as legal policy; no overlap below.

**Important positives:** **zero cookies** are set anywhere (no `cookie-parser`, no `res.cookie`, no `document.cookie`); bot AI context is deliberately de-identified (`server/botStrategicContext.js:1-6` — seat labels only, no usernames/account IDs); CC0 music documented in `public/assets/audio/README.md`; account-level privacy toggles exist. None of this substitutes for the missing legal surfaces.

## Findings

- **[BLOCKER] `public/` + `server/server.js:70` — No privacy policy page, route, or link anywhere; `/privacy` falls through the SPA catch-all and returns the game — a hosted app that stores usernames, scrypt password hashes, session tokens, avatars, stats, match history, friendships and reports (and processes IPs in-memory for rate limiting when enabled, per `server/httpRateLimiter.js:13`) ships with no notice of what is collected or why — publish a /privacy document and link it in the footer/account UI before launch.**
- **[MAJOR] `public/index.html` — No Terms of Service / acceptable-use policy despite free-text chat (`server/socketRuntime.js:445`), player reporting (`server/serverSocketSocial.js:119`) and no moderation terms — operator has no contractual basis to suspend abuse or restrict content — add ToS/AUP and link it with the privacy page.**
- **[MAJOR] `server/accountStore.js` — No account deletion or data-export path anywhere (register/login/update/logout only); records persist in `server/data/accounts.json` indefinitely — GDPR/CCPA erasure requests cannot be fulfilled without hand-editing the store — add a delete-account flow or a documented erasure email process.**
- **[MAJOR] `server/accountStore.js:485-498` + stores — No documented retention: accounts unbounded, sessions persist across restarts with no expiry, matches capped at 500 (`matchStore.js:9`), social at 10k (`socialStore.js:38`), telemetry at 5k (`telemetryModule.js:11`) — users and regulators have no statement of how long data is kept — add a retention section to the policy and enforce session TTL.**
- **[MAJOR] `server/serverSocketAccount.js` + UI — No age gate, content rating, or minimum-age statement; no reference anywhere to minors/children — combined with casino, margin/shorting and all-in betting mechanics (fictional currency only) this is gambling-adjacent content aimed at an audience that includes teens — add an age/content statement and a "fictional currency, no real-money gambling" notice.**
- **[MAJOR] `README.md` (no contact) / `SHOWCASE.md:62` — No operator identity or support channel surfaced in UI or docs beyond a GitHub clone URL; player reports are stored but nothing routes them to a human — users cannot report abuse, request deletion, or contact the developer — add a Contact/Support footer (email or GitHub issues) and document report review.**
- **[MINOR] `public/clientSanitize.js:7-14`, `public/clientState.js:294` — localStorage (`poorup.profile.v1`, `poorup.account.session.v1`, theme/sound/music/achievements/save) and sessionStorage (`poorup-client-id`) are used with no disclosure — no consent banner is legally required (no analytics/ad cookies), but the policy must list these keys and the session token — add a storage section to the privacy policy.**
- **[MINOR] `server/botAdvisor.js:207-419` — DeepSeek receives serialized game state (board, cash bands, decisions) with no disclosure that an external AI provider processes gameplay, nor a link to its terms — undisclosed third-party processing is a policy gap even though no stable identifiers are sent — list DeepSeek as a subprocessor in the privacy policy.**
- **[MINOR] `public/assets/fonts/` + `public/styles.css:4-39` — OFL-licensed fonts (Pixelify Sans, Jersey 15, Silkscreen, IBM Plex) are redistributed with no license text or attribution file — OFL requires the license notice to accompany the font software — add `OFL.txt` per family and a credits entry.**
- **[MINOR] `docs/design/THEME-MUSIC-CURATION-2026-09-12.md:33,41` — CC-BY 3.0 candidate tracks record attribution only in a gitignored `qa-artifacts/…` README; if wired in without a credits page that attribution is lost — potential license violation for future music integration — keep an in-repo attribution manifest and a credits surface.**
- **[MINOR] `README.md:80` vs root/`package.json` — MIT text is embedded in the README but no `LICENSE` file exists and `package.json` has no `license` field (`"private": true`) — reuse terms are ambiguous for a public release — add a `LICENSE` file and the package field.**
- **[MINOR] `public/index.html` — No "not affiliated with Hasbro/Monopoly" disclaimer despite "inspired by Monopoly / Monopoly-style rules" positioning (`README.md:3,13`) — avoidable trademark exposure on a public release — add the disclaimer to the footer/ToS.**
- **[MINOR] `server/server.js:42-48` — No security.txt or vulnerability-disclosure contact — reporters have no non-public channel for vulnerabilities — add `/.well-known/security.txt` pointing at the same contact as support.**

## Minimal must-haves for launch

1. `/privacy` page + footer/account links (fix the SPA catch-all so the URL resolves).
2. Contact/operator identity + account-deletion/erasure request path.
3. ToS/AUP covering chat and reports.
4. Age/content statement + "fictional currency, no real-money gambling" disclaimer.
5. `LICENSE` file + font OFL texts + music attribution manifest.
