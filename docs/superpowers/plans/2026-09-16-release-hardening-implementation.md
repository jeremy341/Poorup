# Poorup Release-Hardening Implementation Plan

**Date:** 2026-09-16
**Status:** Approved for implementation planning; source changes have not started.
**Base:** current `admin-analytics-dashboard-plan` working tree; preserve all existing
uncommitted work until an explicit scope review.
**Companion audit:** `docs/audit/release-hardening-balance-ui-audit-2026-09-16.md`

## 1. Objective and boundaries

Make Poorup ready for a controlled beta and establish the evidence needed for a public
release. Fix source-backed correctness and UX bugs, define the bankruptcy/spectator
contract, bring Rules and documentation into parity, run a real balance campaign, and
produce a reviewable screenshot bundle.

This plan does **not** authorize a merge, push, deployment, legal-policy approval,
numeric balance tuning, or deletion of ambiguous files. It does not replace the Poorup
layout, fonts, board dimensions, game rules, Socket.IO contracts, or existing design
system. UI work stays additive and uses the existing shell.

## 2. Locked product decisions

These decisions were confirmed during the one-question-at-a-time planning interview:

1. A debt owed to a solvent player transfers the bankrupt player's eligible assets to
   that creditor, preserving the current economic rule.
2. A bank/friendly surrender releases eligible assets neutrally to the bank.
3. Negative cash is allowed only while an authoritative `pendingPayment` is open.
4. During an open payment, only legal rescue actions are enabled. `END TURN` is blocked.
5. After complete payment, `cash >= 0` allows the turn to end. Exactly `$0` is valid.
6. Human elimination enters a read-only Spectator state automatically.
7. A spectator's token disappears from the board. The sidebar keeps a greyed icon,
   username, and grey `SPECTATING` line until `LEAVE TABLE`.
8. Leaving removes live presence but not match-history participation or end-game rank.
9. Bots may declare bankruptcy through the same authoritative settlement path but never
   receive an interactive spectator mode.
10. Risk-aware close confirmation applies to destructive/required decisions only.
11. Field-inspection modals reuse the owned-Deed modal shell with field-specific data and
    allowed actions.
12. Uncertain documentation/assets are archived or listed for approval; only clearly
    dead files may later be deleted.
13. Numeric balance tuning waits for measured evidence and owner approval.

## 3. Workstream order and dependencies

```text
Inventory + source-of-truth map
        ↓
Server lifecycle/invariants ──┐
Snapshot/action correctness ──┼─→ bankruptcy/spectator contract
                              │             ↓
                        modal + Rules parity
                              ↓
                  balance campaign and analysis
                              ↓
          screenshot/asset/docs cleanup evidence
                              ↓
                         final release gate
```

No downstream visual or documentation claim is marked complete until the authoritative
server behavior and its tests are green.

## 4. Phase 0 — workspace and evidence freeze

### 4.1 Read-only inventory

- Record branch, merge base, HEAD, dirty paths, deleted paths and untracked paths.
- Store a machine-readable list of all Markdown/README files and SVG/audio assets.
- Build a source graph from JS imports, HTML references, CSS `url()` values, Playwright
  fixtures, tests, docs links and deployment manifests.
- Snapshot current test/lint/audit results without modifying the tree.
- Mark historical reports with their source commit; do not treat old line numbers as
  current evidence.

### 4.2 Deliverables

- `docs/audit/release-hardening-balance-ui-audit-2026-09-16.md` (the companion audit).
- A generated inventory artifact for the implementation branch (path and checksum only;
  no private data).
- A proposed deletion/archive list. The list is reviewed before any destructive action.

## 5. Phase 1 — documentation and feature parity

### 5.1 Source of truth

Define precedence:

1. Server contracts and tests.
2. Client state/render contracts and browser tests.
3. `docs/feature-status.json` with the final evidence SHA.
4. Rules page and operator runbooks.
5. Historical audits, plans and devlogs as provenance.

### 5.2 Mechanical checks

- Verify every documented file, event, setting, route, asset and script reference.
- Detect references to removed Legal/Music-Box/theme files in docs and tests.
- Compare every Rules `LIVE`/`PLANNED` label to an implementation and test.
- Flag contradictory numbers: board sizes, player limits, payouts, timers, loan tiers,
  bot modes and feature defaults.
- Add a docs-parity test that fails on unknown runtime claims and stale source commits.

### 5.3 Rules update

After server contracts land, update the live Rules chapters for:

- payment rescue and the `$0` turn-end boundary;
- bankruptcy settlement (creditor transfer vs bank-neutral release);
- human Spectator and `LEAVE TABLE` behavior;
- bot bankruptcy without spectator controls;
- field modal actions and airport travel availability;
- Global Event warning/active/recovery lifecycle;
- AI-provider failure and deterministic fallback;
- any feature that remains planned rather than live.

Keep historical wording in dated documents, but add a `SUPERSEDED` banner and link to
the current source-backed entry.

## 6. Phase 2 — server correctness and lifecycle

Use test-first changes. Each task begins with a failing focused test, then the smallest
implementation, then the relevant regression suites.

### 6.1 Cross-room seat detach

**Files:** `server/socketRuntime.js`, room lifecycle helpers, corresponding tests.
**Behavior:** one idempotent path handles detach, reconnect grace, expiry, obligations,
current-turn ownership and room cleanup. It must work during a payment, auction, trade,
event vote, normal turn and room switch.
**Tests:** old room never stalls; expiry settles/advances once; reconnect before expiry
restores the seat; duplicate detach is harmless; the new room is unaffected.

### 6.2 Snapshot-safe rendering support

**Files:** `public/clientTopNavRender.js`, `public/clientHudRender.js`, `public/main.js`,
client state-sync tests.
**Behavior:** partial snapshots render an explicit unavailable state instead of throwing;
one panel failure does not prevent debt, auction, winner or accessibility sync.
**Tests:** empty players, missing turn, missing settings, stale room, delayed economy,
and malformed optional fields.

### 6.3 Durable idempotency

**Files:** `server/accountStore.js`, `server/seasonModule.js`, match/telemetry tests.
**Behavior:** history display limits remain bounded, but dedupe is durable by account and
match ID. Account stats, seasons, rewards, telemetry and match history all ignore a replay
of an old completed match.
**Tests:** replay the first record after 50/1,000+ later matches; concurrent duplicate
settlements; process restart; legacy record migration.

### 6.4 Season deltas and fair-trade schema

**Files:** `server/seasonModule.js`, `server/participantFields.js`, result builders and
tests.
**Behavior:** mastery and points consume one normalized match delta; `fairTrades` is
recorded consistently; bot-only, AFK-only, preview and duplicate records remain excluded.
**Tests:** repeated identical matches grow linearly; missing fields fail closed; migration
does not double count.

### 6.5 Validation and adapter fixes

- Bound direct known string settings to the approved enums.
- Apply `matchHistoryAdapter` limits after legacy/stored merge.
- Make multi-seat account recovery deterministic by explicit room hint or recency.
- Remove duplicated event/motion constants only when characterization tests identify the
  authoritative source.

## 7. Phase 3 — payment, bankruptcy and Spectator implementation

### 7.1 Authoritative state contract

Add only the smallest fields necessary to project presence and lifecycle. Prefer a
server-derived `spectating`/presence state over a client-only flag. Maintain compatibility
with existing snapshots and Socket.IO event names unless a migration is explicitly tested.

The legal transition is:

```text
SOLVENT
  → PAYMENT_OPEN (may have negative temporary cash)
  → RESCUE_ACTIONS*
  → PAYMENT_SETTLED (amountRemaining=0, cash>=0)
  → TURN_CAN_END
  → BANKRUPT → SPECTATING → LEAVE_TABLE
```

### 7.2 Settlement order

Characterize and test this order before refactoring:

1. lock the payment/request version;
2. settle queued/sponsored obligations;
3. liquidate market positions;
4. sweep available cash to a valid creditor;
5. settle loans, hybrids, equity and default claims;
6. transfer eligible deeds to a solvent creditor or release them neutrally to the bank;
7. clear buildings, mortgages and equity references that no longer have an owner;
8. remove the player from active turn order;
9. publish one lifecycle snapshot and one announcement;
10. enter Spectator or end the game deterministically.

The implementation must not mint cash, pay a bankrupt creditor, duplicate deeds, leave
equity shares attached to neutral deeds, or settle the same request twice.

### 7.3 Human Spectator UI

**Board:** hide the bankrupt human token and make it non-selectable.
**Sidebar:** preserve row, desaturate/grey the icon, keep username readable, add grey
`SPECTATING` under it, and remove action affordances.
**Shell:** show a persistent read-only banner and `LEAVE TABLE`.
**Allowed:** board/log/chat/public standings/global-event read access.
**Forbidden:** roll, resolve, buy, build, mortgage, trade, loan, casino, market, auction,
or private-decision controls.
**Leave:** remove live presence, run host/capacity cleanup and preserve match history.

### 7.4 Bot bankruptcy

Preserve the existing order: legal liquidation → emergency financing → bankruptcy. Add
tests for deterministic bot, AI provider response selecting bankruptcy, provider fallback,
both bankruptcy settlement modes if still present during migration, repeated timer ticks,
and no bot action after it is marked bankrupt.

## 8. Phase 4 — risk-aware close confirmation

### 8.1 Modal registry

Add a single modal metadata registry to the existing surface controller. Each surface
declares whether closing is neutral or potentially loses a decision.

**Confirm:** bankruptcy, required purchase/auction, Global Event vote, unsent trade/loan/
equity/hybrid offer, and any future irreversible action.
**No confirm:** Deed/field details, Airport information, Rules, Log, Wallet read-only
view, completed result, and already-settled card.
**Browser exit:** native `beforeunload` only while an unresolved required decision exists.

### 8.2 Interaction contract

- Close, Escape, backdrop and browser exit use one decision function.
- Copy names the consequence and offers `KEEP OPEN` / `CLOSE WITHOUT ACTION`.
- The server remains authoritative; dismissing a modal never silently declines.
- Focus returns to the opener, or to the closest surviving control after bankruptcy.
- Reduced motion and forced colors preserve the warning semantics.

## 9. Phase 5 — Deed-modal shell for all fields

### 9.1 Shared component

Extract a presentational shell from the working owned-Deed modal without changing its
layout contract:

- accent rail;
- icon and field kind;
- kicker/title;
- status rows (owner, price, rent, state);
- contextual body copy;
- footer action group;
- close/focus semantics.

### 9.2 Field adapters

Implement read-only adapters for unowned deeds, opponent deeds, airports, utilities,
taxes, cards, Vacation and neutral corners. Actions are server-projected and absent when
illegal. Add tests for every field kind, bankrupt/spectator viewer, mortgage state,
global-event modifier and stale snapshot.

## 10. Phase 6 — balance campaign and recommendations

### 10.1 Instrumentation and fixture

Extend the existing simulation harness with deterministic seeds and a separate statistics
output. Never use production account IDs or private names. Include rule revision, board
variant, bot brain/personality/difficulty, feature switches and seed in each record.

### 10.2 Required runs

- seat/order fairness;
- Classic, After Hours and representative Custom settings;
- 40-space and supported Metro variants;
- human-involved and bot-only matches;
- debt/creditor and bank-neutral bankruptcy;
- airport/utility, auction, market/casino and Global Event slices;
- short deterministic campaign (at least 10,000 games) plus a long-run stability run.

### 10.3 Output

Produce median/P90 duration, bankruptcy timing, win share, placement, monopoly rate,
auction price ratio, feature adoption, event recovery, rescue success, fallback rate,
negative-cash duration, comeback rate and confidence intervals. Suppress low sample sizes.
Label all associations as correlations; do not claim that an airport or event causes a
win from observational data alone.

Numeric tuning is a separate, owner-approved change after this report.

## 11. Phase 7 — screenshot and visual QA bundle

### 11.1 Deterministic fixtures

Add Playwright fixture routes or controlled state builders for:

- plane/airport modal;
- Global Event warning, vote, active and recovery;
- bankruptcy decision;
- human Spectator sidebar/board;
- bot bankruptcy;
- end-game ranking and rematch;
- own, unowned and opponent Deed/field modals;
- normal Home, Lobby, Rules and admin surfaces.

Fixtures must not expose private account IDs or depend on live random rooms.

### 11.2 Viewports and checks

- 1920×1080: mandatory native-resolution inspection for every fixture;
- 1366×768 and 1024×768 landscape;
- iPad landscape (configured 1024/1194-style projects);
- 390×844 for critical decision flows;
- keyboard-only, screen-reader semantics, 200% zoom, reduced motion and forced colors;
- no page overflow, no focus loss, no UI occlusion and stable modal layering.

Capture before/after only when the state is deterministic. Record screenshot path, fixture
seed/state and viewport in the QA report.

## 12. Phase 8 — docs and asset cleanup

### 12.1 Documentation

- Add current-status banners and evidence links to superseded audits.
- Move uncertain historical plans into `docs/archive/` only after link checks.
- Keep legal/music/theme provenance and license records.
- Update `docs/feature-status.json` only after implementation SHA is known.

### 12.2 SVG/audio/static assets

- Remove only files proven unreachable by the source graph and tests.
- Quarantine unknown-rights or oversized files before deletion.
- Preserve original sources and attribution in a non-runtime reference location.
- Verify `express.static`/cache policy and no broken references after each batch.

The deletion proposal is an approval gate, not an automatic implementation step.

## 13. Verification and release gate

Run on the exact candidate SHA:

```text
npm run test:full --silent
npm run lint -- --quiet
npm run lint:client -- --quiet
npm audit --omit=dev --audit-level=moderate
git diff --check
npm run test:browser -- --project=chromium
```

Also run the balance campaign, multi-client reconnect suite, asset/doc parity scan,
visual screenshot review, maintenance-drain/backup smoke tests, and CodeScene if the
owner supplies a valid token. Record actual outputs; never infer pass status.

### Beta gate

Core game, payment/bankruptcy/spectator lifecycle, P1 bugs, Rules parity, screenshots,
backups, maintenance drain and critical accessibility checks must pass. Public account
policy may remain disabled.

### Public release gate

In addition: approved effective legal copy, account deletion/export/session policy,
licensing/attribution, preview origin/artwork, persistence adapter/load evidence for the
target population, security headers/rate limits, and a clean PR/CodeScene review.

## 14. Work allocation for future sub-agents

When execution starts, use at most five isolated Luna agents (medium by default, UI agent
can use the owner-approved higher effort) with disjoint ownership:

1. Server lifecycle/invariants and tests.
2. Client state, modal, payment and Spectator UI.
3. Rules/docs parity and asset graph.
4. Balance harness and analytics report.
5. Visual/accessibility/browser QA and final integration review.

The primary agent coordinates merges, resolves conflicts, owns the release checklist and
does not allow parallel edits to the same files. Agents may not delete files or change
game rules without a test and decision record.

## 15. User-input gates

No additional input is needed for the source-backed bug fixes, tests, deterministic
fixtures, docs status banners, or the initial balance measurement.

The following remain explicit approval gates:

- any numeric balance/tuning change;
- effective legal copy, operator identity, age/region policy and retention periods;
- account deletion/export/session policy;
- canonical public origin and preview artwork;
- deleting or permanently removing an ambiguous MD/SVG/audio asset;
- switching persistence/topology or enabling a paid production service;
- promoting to public account release or merging/pushing/deploying.

## 16. Definition of done

- Every P1/P2 source-backed bug has a regression test and a passing implementation.
- Negative-cash and `$0` turn-end semantics are explicit and server-authoritative.
- Human Spectator, bot bankruptcy, creditor transfer and bank-neutral release are visible,
  deterministic and covered by tests.
- Risk-aware close confirmation is consistent and does not punish harmless inspection.
- Field modals use the Deed-modal shell with truthful actions.
- Rules, feature manifest and docs agree with current code.
- Balance report is statistically honest and numeric tuning is separately approved.
- Required screenshots are inspected at 1920×1080 and responsive/a11y checks pass.
- Asset/MD deletion list is reviewed; no user work is lost.
- Final commands and outputs are recorded on the exact candidate SHA.

This plan is ready for an execution pass. It intentionally stops before implementation,
deletion, merge, push or deployment.

## Execution note — 2026-09-17

The first slice of this plan has been implemented in the current working tree with
test-first changes: lifecycle detach, durable result/season dedupe, per-match mastery,
trade evidence, unified bankruptcy/spectator projection, safe snapshot locks, risk-aware
close handling, field-modal shell alignment, event/auction pending feedback, economy
staleness, Rules copy, and deterministic release screenshots. The remaining gates in this
document (full candidate-SHA verification, balance campaign evidence, asset/deletion
approval, and release/merge actions) are intentionally still open.

## Verification closeout — 2026-09-17

The execution pass now has reproducible evidence:

- Full automated server/client/audit suite: passed.
- Server and client ESLint: passed.
- Full Playwright matrix: 391 passed, 47 planned skips, 0 failed.
- Balance campaign: a corrected 10,000 fixed-seed run produced 9,862 completions within the
  2,000-step bound, 138 bounded games, and 0 invariant stalls; the earlier 2,500-game run
  produced 2,471 completions and 0 invariant stalls. The report is intentionally treated as
  measurement only, not authorization to tune rules (seat-0 winner share 0.9676; Global
  Event action adoption 0.6298). Feature adoption is derived from actions taken, not merely
  enabled room flags. Every record carries a fixed seed, balance revision, ruleset revision,
  board variant, bot mode/difficulty, and personality list; the aggregate exposes bounded
  game count without retaining player or account identifiers.
- Impeccable detector ran once and reported 126 primary-pattern findings plus 6 advisories;
  those findings still require human prioritization rather than global suppression.
- CodeScene could not authenticate because no `CS_ACCESS_TOKEN` is present in this session;
  hosted delta and PR review remain explicit release blockers.

The branch remains uncommitted and unmerged. Ambiguous asset/Markdown deletions remain
unapplied pending source-graph confirmation and owner approval.
