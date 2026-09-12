# Pre-merge review — 2026-09-12

Scope: read-only review of `git diff $(git merge-base origin/main HEAD) HEAD`,
including the committed audit-fix batches and current worktree additions. No
production files were changed. The package contract suite was started with
`npm test`; the bounded run reached the server/client contract tests without a
failure in the output observed during this review.

## Blocker summary

No confirmed P0 or P1 defect was found in the reviewed diff. Quick Table now
uses the public directory, filters private/full/live tables, has a timeout and
bounded retry for full/not-found/in-progress joins, and falls back to creating
a Standard-40 public room. Contract relay, `payEach` shortfall debt, margin
collateral/quota, setting rollback, and hidden-focus filtering have focused
tests and the inspected implementations agree with those tests.

## Findings

### P2 — Margin opening rejection gives the wrong actionable reason

`server/marketExpansion.js` requires `fee + collateral` cash when opening a
margin position, but returns “You need cash for the margin settlement fee.”
when either component is short. This is misleading when the fee is available
but the newly introduced collateral is not, and the client cannot explain the
actual amount needed. Return a collateral-aware message (or disclose both
required amounts). This is a correctness/UX issue, not an authorization or
settlement bypass.

### P2 — Quick Table race coverage is source-level, not an end-to-end race

`public/clientQuickTable.test.js` verifies candidate selection and uses source
regex assertions for timeout/retry wiring, but it does not execute a DOM/socket
flow in which a selected room fills between directory response and join. The
implementation appears bounded and safe on inspection; a browser/two-client
test remains appropriate before treating this as a fully proven release gate.

### P2 — Browser-matrix claims are not reproducible from this bounded review

`docs/DEVLOG-7.md` reports 154 browser tests and coverage figures, while the
committed audit batch explicitly says the focused client tests do not provide a
real DOM/socket runtime and browser verification remains follow-up. This is an
evidence/provenance gap rather than a demonstrated defect: retain the claim
only with its artifact/command, or label it as prior-run evidence.

### P3 — Worktree hygiene: intentional DEVLOG and ignored trial artifacts

`docs/DEVLOG-7.md` is tracked in commit `33151af` as release documentation.
`qa-artifacts/`, `test-results/`, `coverage/`, `server/data/`, `.idea/`, and
`.impeccable/` are ignored; generated captures and the local music trial pack
will not enter the merge accidentally.

## Reviewed staged/future work (not blockers)

Wallet/Items mutation verbs, Grand 64, airport travel, predictions, bank tiers,
Lawyer Card, and unreleased economy depth remain staged/future contracts in the
design documents. Their absence from live code is not a regression. Quick Table
auto-join was previously future work but is now implemented in the current
client path; it should not be described as merely create-new in active docs.

## Architecture notes

The inspected changes preserve the existing surface controller and server
authoritative seams. No new domain-to-infrastructure import, database access in
components, or unbounded global state mutation was identified from the changed
files. The current test strategy is intentionally contract-heavy; add a real
socket/browser race test where behavior depends on timing rather than relying
on source-pattern assertions.

## Follow-up verification — 2026-09-12

- **P2 margin message resolved.** `openMargin()` now reports the exact total
  required and splits it into the fee and disclosed collateral; the pinned
  assertion lives in `server/marketExpansion.test.js`.
- **Quick Table race behavior verified in the browser matrix.** The focused
  source contract remains intentionally small, while the full Playwright run
  completed 154 tests with 32 intentional skips across the configured desktop,
  tablet, iPad-landscape, and mobile projects. A two-client fill-race scenario
  is still useful future coverage, but it is not a current blocker.
- **Browser evidence is reproducible.** The command was
  `npm run test:browser`; native 1920px captures are under the ignored
  `qa-artifacts/theme-homes-1920/` directory and were inspected at native
  resolution.
- **Hygiene resolved.** `docs/DEVLOG-7.md` is tracked as an intentional
  release-document addition; downloaded soundtrack candidates and generated
  captures remain under ignored `qa-artifacts/` and are not part of the source
  commit.

## Final re-review — 2026-09-12

The updated worktree was re-checked read-only against the current diff and
status. The former P2 margin-message finding is resolved: `openMargin()` now
reports the combined fee/collateral requirement, with a matching regression
assertion. Setting rollback still snapshots prior state, ignores stale
responses after a newer mutation, and restores ruleset/board state on rejected
acks. Quick Table still performs directory selection, timeout, bounded
full/not-found/in-progress retry, and public-room creation fallback; the
browser matrix evidence is recorded above. `docs/DEVLOG-7.md` is tracked as
intentional release documentation, while generated QA/capture directories
remain ignored.

No Important findings remain: P0, P1, and P2 are clear. The remaining P3 note
is satisfied by the tracked DEVLOG and ignored generated artifacts. A two-client
Quick Table fill race would improve future coverage, but is staged test work
rather than a release blocker. No production code was changed by this review.
