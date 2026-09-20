# Account and Release Readiness Audit — 2026-09-17

## Scope

This record covers the account-rights slice implemented on the current working
tree: server-side session primitives, owner-safe export, recovery-email token
flows, 30-day account deactivation, retention orchestration, privacy-safe
projections, and the constrained Profile UI. It does not claim that production
mail, canonical hosting, backups, or operator ownership are configured.

## Implemented and verified

- `server/sessionStore.js` stores only hashed server-side session records,
  enforces 30-day idle and 90-day absolute expiry, supports independent
  devices, revocation, cookie flags, and one-time legacy exchange. New client
  snapshots no longer persist bearer tokens in `localStorage`.
- `server/accountExport.js` emits an allow-listed JSON document. Password
  verifiers, session material, durable account IDs, raw chat, and private deal
  terms are excluded.
- `server/mailAdapter.js` is provider-neutral, bounded, retry-limited, and
  returns redacted failure codes when configuration is absent.
- `server/accountRecovery.js` uses hashed single-use 30-minute verification and
  reset tokens; reset requests are enumeration-resistant.
- `server/accountDeletion.js` enforces password + `DELETE ACCOUNT`, blocks
  seated accounts, marks a 30-day restricted state, supports cancellation, and
  performs an idempotent linked-store purge/anonymization pass.
- `server/retentionJob.js` runs due deletion and retention work through an
  unref'd daily timer plus an operator-callable `runOnce` seam.
- Backup anonymization rewrites only checksum-verified JSON generations and
  refreshes their sidecars before a deleted account can be forgotten from the
  rolling backup set.
- AccountStore and linked stores now expose deactivation, password, purge, or
  anonymization seams. Public leaderboards/search omit deactivated accounts;
  existing social references use `ACCOUNT DEACTIVATED`.
- `/privacy` is a factual, noindex Privacy & Account Data document. No Terms of
  Service route is created.
- Profile-only Data Rights controls cover export, other-session revocation,
  recovery-email setup, deletion, cancellation, pending state, and lifecycle
  announcements without changing the game layout.

## Focused evidence

The following focused tests pass in the working tree:

```text
server/sessionStore.test.js
server/accountExport.test.js
server/mailAdapter.test.js
server/accountRecovery.test.js
server/accountDeletion.test.js
server/retentionJob.test.js
server/accountStore-rights.test.js
server/accountLifecycleStores.test.js
server/accountRightsSocket.test.js
public/clientAccountRights.test.js
```

Server/client lint and JavaScript syntax checks pass for the changed modules.
The full suite must be rerun outside the restricted Windows process-spawn
environment because suites that launch a child server currently return
`spawn EPERM` in the sandbox.

## Remaining release gates

1. Supply the production mail endpoint, key, sender, and verified domain.
2. Supply canonical HTTPS origin, production cookie secret, backup directory,
   monitoring destination, and operator/Privacy owner.
3. Replace the legacy localStorage session with the cookie bootstrap in the
   browser fixture, then verify cross-device and cross-tab behavior.
4. Add browser fixtures for signed-in Profile, pending deletion, cancellation,
   export download, recovery verification, Privacy, forced colors, reduced
   motion, and 200% zoom.
5. Run CodeScene with an authenticated token and resolve any new Important
   findings; local CLI authentication is not available in this environment.
6. Build a verified source graph before deleting any Markdown or SVG. The
   historical plans, audit evidence, design provenance, licenses, and active
   implementation records remain intentionally preserved.

## Release decision

The account-rights code is suitable for controlled staging once the focused and
full suites pass in a process-spawn-capable environment. It is not a public
account-release approval until the owner/deployment gates above are supplied and
the browser cookie, mail, backup, and deletion-drill evidence is recorded.

## Fresh verification — 2026-09-17

- `npm run test:full --silent`: PASS (all server, client, audit, docs, and
  account-rights tests).
- `npm run lint -- --quiet`: PASS.
- `npm run lint:client -- --quiet`: PASS.
- `npm audit --omit=dev --audit-level=moderate`: PASS; 0 vulnerabilities.
- `npm run test:browser --silent`: PASS; 409 passed, 47 documented skips across
  desktop, tablet, iPad landscape, and mobile projects.
- Focused Privacy/Profile Browser QA: PASS; 18 passed.
- `npm run test:account --silent`: PASS; account, backup-redaction, retention,
  session-cookie, recovery, deletion, and client-storage contracts pass.
- Final post-change Browser matrix: PASS; 409 passed, 47 documented skips.
- 1920×1080 Privacy and Home captures were inspected at native resolution:
  `qa-artifacts/release-surfaces-2026-09-17/privacy-1920.png` and
  `qa-artifacts/release-surfaces-2026-09-17/home-account-rights-1920.png`.
- Impeccable detector ran once on changed UI files. It reported existing
  Poorup-wide low-contrast/size/glow/marquee advisories; those are recorded,
  not globally suppressed or claimed as clean.
- CodeScene CLI remains blocked without a supplied PAT; no CodeScene pass is
  claimed.
- Obsolete-artifact cleanup removed 30 unreferenced legacy-theme SVGs and two
  unchanged superseded music documents. Four user-modified candidates remain
  preserved and are listed in the deletion record.
- Post-cleanup `npm run test:browser --silent`: PASS; 409 passed, 47 documented
  skips. The release-surface screenshot fixture was made deterministic by
  isolating its synthetic Global Event state from live socket snapshots.
- Post-cleanup `node server/docs-parity.test.js` and
  `node public/themeAssetAudit.test.js`: PASS; no references or missing active
  theme assets after the legacy SVG removal.
