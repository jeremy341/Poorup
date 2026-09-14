# Documentation manifest and parity report

Date: 2026-09-14
Scope: release-plan Task 1 and Task 10 only
Source baseline recorded by the release contract: `151b480`

## Delivered

- Added `docs/feature-status.json` as the canonical source-backed status
  manifest. It records 21 uniquely identified surfaces with `active`,
  `complete`, `planned`, `reference`, or `deferred` status, an owner surface,
  and repository-relative evidence paths.
- Added `server/docsFeatureStatus.test.js`. It fails when the manifest is
  missing, the source commit drifts, timestamps are invalid, IDs duplicate,
  statuses are unsupported, or an evidence path disappears.
- Added `server/docs-parity.test.js` with a bounded current-document scope. It
  protects account wording, capacity naming, profile/session claims, theme
  dimensions, Night Shift asset mounting, branch-plan provenance, current
  feature names, and manifest pointers. Historical audits are not scanned for
  stale phrases and remain preserved.
- Reconciled the current README, showcase, quick guide, account/profile and
  home/profile design references, theme and Night Shift design references,
  refactor roadmap, in-game UX plan, branch/operations plan, and production
  hardening runbook.
- Kept legal/support copy, account deletion/export/retention, analytics
  disclosure/retention, canonical preview origin/artwork, and horizontal
  persistence as explicit owner-gated `planned`/`deferred` work. No operator
  identity, legal promise, pricing, credential, or deployment fact was added.

## TDD evidence

1. `node server/docsFeatureStatus.test.js` was run before creating the
   manifest and failed with `docs/feature-status.json must exist`.
2. `node server/docsFeatureStatus.test.js` passed after the manifest was added
   (`21 features`).
3. `node server/docs-parity.test.js` was run before reconciliation and failed
   on the stale README account claim.
4. `node server/docs-parity.test.js` passed after the current docs were
   reconciled.

## Verification

- `node server/docsFeatureStatus.test.js` — pass (21 features)
- `node server/docs-parity.test.js` — pass
- `npx eslint server/docsFeatureStatus.test.js server/docs-parity.test.js` —
  pass
- `git diff --check` over the documentation slice — pass (line-ending
  normalization warnings only)

`package.json` was intentionally not changed because it already had unrelated
pending edits in the shared worktree. The parent integration lane can add the
two standalone tests to its chosen release script with an explicit package
diff.
