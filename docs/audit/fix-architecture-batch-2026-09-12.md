# Architecture simplification batch — 2026-09-12

## Scope and status

This batch addresses the server-side match-history duplication identified in
`docs/audit/agent-complexity-review-2026-09-11.md`. It is an incremental
compatibility refactor: MatchStore remains the newer full-record source,
AccountStore history remains a bounded migration fallback, and the existing
privacy/projection seams remain in their current layers. No rules engine,
database migration, public wire name, or client UI was changed. No commit or
push was made.

## Finding addressed

### Duplicate match-history merge implementations (P1)

Before this batch, `server/socketSocialApi.js` and
`server/serverSocketSocial.js` each independently merged AccountStore history
with MatchStore records. Both happened to use the same behavior, but a future
field or precedence change could easily land in only one reader.

The new `server/matchHistoryAdapter.js:1-29` is a small, pure read adapter:

- reads up to the existing 50-record MatchStore window and the legacy account
  snapshot;
- ignores records without a `matchId`;
- applies legacy records first and lets the newer MatchStore record win on a
  duplicate ID;
- returns records newest-first using the prior `completedAt` ordering; and
- does not mutate either source.

Both readers now call the adapter (`server/socketSocialApi.js:133-135` and
`server/serverSocketSocial.js:439-442`). The handler still applies
viewer-specific private-history filtering, and the existing non-owner
projection still runs after that filter. The adapter is therefore a named
compatibility boundary, not a second source of truth or a new event bus.

`package.json` includes `server/matchHistoryAdapter.test.js` in the normal
server test sequence so the shared contract cannot silently become test-only.

## Characterization and red → green evidence

The public socket seam was exercised before extraction with a fake runtime that
returned one legacy-only record, one duplicate, one newer stored record, and a
private record. The pre-refactor handler produced the expected wire-visible
behavior: stored duplicate wins, records are newest-first, and the private
record is hidden from an anonymous viewer.

The adapter contract was then added to the same focused test. The first run
failed before production implementation with:

```text
Error [ERR_MODULE_NOT_FOUND]: Cannot find module '.../server/matchHistoryAdapter.js'
```

After the smallest implementation, the same test passed through both reader
seams (`server/matchHistoryAdapter.test.js:104-158`):

```text
node server/matchHistoryAdapter.test.js
match history adapter characterization: 11 passed, 0 failed
```

The test covers merge precedence/order, public projection, private-history
filtering, the MatchStore limit, and the recent-player reader's use of the
same stored-over-legacy winner. Assertions are outcome-based; they do not
mock or inspect private adapter state.

## Verification

Focused checks after the final changes:

- `node server/matchHistoryAdapter.test.js` — PASS (11 assertions).
- `node server/boardRegistry.test.js` — PASS (12 assertions).
- `node server/match-history-schema.test.js` — PASS (5 assertions).
- `node server/social-achievement.test.js` — PASS (1 scenario).
- `node server/room-host-lifecycle.test.js` — PASS (6 scenarios).
- `node server/serverSocketAccount.test.js` — PASS (4 scenarios).
- `node server/serverSocketGame.test.js` — PASS (2 scenarios).
- `npx eslint server/matchHistoryAdapter.js server/matchHistoryAdapter.test.js
  server/socketSocialApi.js server/serverSocketSocial.js` — PASS (no errors or
  warnings).
- `git diff --check` — PASS; the repository reports only existing
  LF-to-CRLF normalization warnings and no whitespace errors.

`node server/rooms.test.js` was attempted as the higher-fidelity history wire
regression, but this managed sandbox rejects its child-process startup with
`Error: spawn EPERM` before the server launches. No full-suite pass is claimed
for that environment limitation.

## Architecture decision and bounded migration plan

The simplest sufficient topology remains the existing single-process modular
monolith. A pure in-process adapter is preferable to a broker, event log, or
new service because the read path needs immediate, strongly consistent
read-your-writes behavior and the product still has one local writer. The
adapter keeps the boundary explicit without introducing distributed failure
modes.

The long-term canonical source remains MatchStore's full record. The current
AccountStore match-history payload is intentionally retained as a compatibility
reader until existing JSON data has been reconciled. The next bounded steps
are:

1. Add a one-time backfill/reconciliation utility that reports MatchStore IDs
   missing from account snapshots and records any field-level mismatches.
2. Add a compact per-account match-ID/time index to AccountStore only if the
   measured MatchStore scan needs it; do not duplicate full match payloads.
3. Observe fallback reads for a declared sunset window and verify that the
   backfill plus new writes cover all accounts.
4. Remove the AccountStore fallback and the compatibility adapter only after
   the reconciliation report is clean and rollback data is retained.

Until those checks exist, neither source is deleted and no public history
payload is changed. Board-manifest consolidation, GameState/Room cycle
removal, scheduler consolidation, and client module splits remain separate
follow-up batches because they require their own characterization seams and
would expand this change's risk.

