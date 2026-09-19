# Poorup release-gate checklist — 2026-09-17

This checklist is evidence for the current working tree on
`admin-analytics-dashboard-plan`. It is not a merge or deployment approval.

## Verified on the current tree

- [x] Confirmed server/game regressions have focused tests and pass in the full suite.
- [x] Payment, negative-cash, `$0` turn-end, creditor transfer, neutral release,
      human Spectator, bot bankruptcy, rematch, and end-game projections pass.
- [x] Account export, session revocation, recovery-email verification, deletion
      grace period, purge/anonymization, backup redaction, and retention seams pass.
- [x] Privacy page is factual and noindex; no Terms-of-Service route is asserted.
- [x] Maintenance drain, health/readiness, backup integrity, rate limits, and
      fail-closed persistence checks pass.
- [x] Rules/docs parity and active-theme SVG audit pass.
- [x] Verified obsolete legacy-theme SVGs and two unchanged superseded music docs
      are marked deleted; modified/provenance candidates remain preserved.
- [x] `npm run test:full --silent` exits 0 outside the Windows sandbox.
- [x] `npm run lint -- --quiet` and `npm run lint:client -- --quiet` exit 0.
- [x] `npm audit --omit=dev --audit-level=moderate` reports 0 vulnerabilities.
- [x] `git diff --check` reports no whitespace errors.
- [x] Full Playwright matrix exits 0: 409 passed, 47 documented skips.
- [x] 284 shipped JS/MJS files pass `node --check`.
- [x] Ten-thousand-game balance runner reports 0 invariant stalls; bounded games
      remain separate from completed games in the report.
- [x] Deterministic 1920×1080 release screenshots were inspected at native resolution.
- [x] Theme-switch audio explicitly invokes the incoming media load; the regression
      test covers the actual Spring source path.
- [x] `clientMusicPlayer.test.js` is part of the normal `npm test` command, so the
      audio regression cannot silently fall outside the release gate.

## Open gates requiring external facts or an owner decision

- [ ] Run an authenticated CodeScene delta on the final candidate SHA. The local
      wrapper fails closed without `CS_ACCESS_TOKEN`; no token is stored in the repo.
- [ ] Update `docs/feature-status.json` to the final implementation SHA after an
      authorized candidate commit exists.
- [ ] Supply production mail, cookie, backup, canonical-origin, operator, and
      analytics-key configuration before enabling public accounts.
- [ ] Run randomized-start, multi-ruleset/board, and human-involved balance slices
      before changing any numeric economy values.
- [ ] Obtain explicit approval before deleting any remaining ambiguous Markdown,
      SVG, audio, license, or provenance file.
- [ ] Promotion, merge, push, deployment, and public-release decisions remain outside
      this working-tree verification pass.

## Evidence locations

- `docs/audit/release-hardening-balance-ui-audit-2026-09-16.md`
- `docs/audit/account-release-readiness-2026-09-17.md`
- `docs/audit/balance-campaign-2026-09-17.md`
- `docs/audit/obsolete-artifacts-2026-09-17.md`
- `docs/DEVELOPMENT_WORKFLOW-CODESCENE.md`
