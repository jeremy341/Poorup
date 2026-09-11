# Poorup Markdown and README Parity Audit — 2026-09-11

## Scope and baseline

This audit inventories every repository `README*` and `*.md` file visible on
the reset branch. The branch is based on `1398823`, the last commit before the
theme system. The current implementation therefore has the original Poorup
visual baseline and no theme selector or theme asset directory.

The previous seasonal branch is preserved at
`codex/seasonal-theme-ui-before-reset` and is not used as current product
evidence. No document was deleted during this audit.

## Classification rules

- **Active** — describes a current user flow, contract, workflow, or release
  requirement and should be kept current.
- **Completed** — the described implementation exists; keep as a dated record
  until a changelog replaces it.
- **Stale** — contains historical line numbers, pre-refactor claims, or a
  status that no longer matches the current tree; rewrite or stamp it.
- **Reference** — useful history, licensing, product context, or design
  rationale that should not drive implementation by itself.
- **Delete candidate** — has no current owner, no historical value, and no
  unique information after the audit. Deletion requires explicit approval.

## Inventory

| File | Category | Current-code evidence | Action |
| --- | --- | --- | --- |
| `README.md` | Active | Describes the Node/Socket.IO app, room flow, economy, social, bots, and the `public/` layout. | Keep; update only when public behavior changes. |
| `PRODUCT.md` | Active | Product purpose, constraints, accessibility, and server-authority principles match the current app. | Keep as product source of truth. |
| `SHOWCASE.md` | Active | Current feature and local/live run overview. | Keep; refresh feature bullets when releases change. |
| `Instructions.md` | Active | Quick guide for turns, properties, trades, jail, setup, and winning. | Keep; add only player-visible rules. |
| `docs/DEVELOPMENT_WORKFLOW.md` | Active | Branch, PR, test, review, and agent workflow used by this repository. | Keep; update commands when CI changes. |
| `docs/production-hardening.md` | Active | Production CORS, persistence, backups, rate limiting, and migration requirements. | Keep as deployment checklist. |
| `docs/REFACTOR-ROADMAP.md` | Stale | Contains old CodeScene scores and line-count claims even though later extraction PRs landed. | Rewrite measurements or mark every old row historical. |
| `docs/AUDIT-2026-09-08.md` | Reference | Dated audit with verified and agent-reported findings. | Keep as history; never treat unverified rows as live bugs. |
| `docs/AUDIT-DEEP-2026-09-08.md` | Reference | Dated deep audit preceding later fixes. | Keep as history; link to current audit. |
| `docs/AUDIT-FULL-2026-09-08.md` | Reference | Superseded full audit and resolution notes. | Keep as historical evidence. |
| `docs/audit/poorup-audit-2026-09-08.md` | Reference | Older UI/logic/dead-UI audit with resolved statuses. | Keep; stamp as historical. |
| `docs/audit/release-readiness-2026-09-08.md` | Reference | Release audit for an earlier branch and commit set. | Keep; add a superseded banner. |
| `docs/audit/room-patrol-bug-audit.md` | Stale | Contains pre-fix line numbers and a “DO NOT IMPLEMENT” section from an older monolith. | Rewrite as a resolution ledger or archive. |
| `docs/audit/expansion-completion-2026-09-09.md` | Completed | Records rulesets, Metro, seasons, cosmetics, telemetry, market, bots, and QA evidence. | Keep as completion record; verify future revisions. |
| `docs/audit/expansion-implementation.md` | Completed | Records the modular expansion contracts and skill application. | Keep as implementation record. |
| `docs/audit/markdown-feature-parity-2026-09-09.md` | Stale | Refers to 29 pre-existing files and retired documents that are not in this branch. | Supersede with this audit. |
| `docs/plans/achievement-announcements-ui-plan.md` | Completed | Server mythical channel, collection modal, rarity filters, and announcement flow exist in `public/` and `server/`. | Keep as feature record. |
| `docs/plans/achievements-plan.md` | Completed | Achievement catalog, rarity, profile collection, and predicates are implemented. | Keep; move future tuning to backlog. |
| `docs/plans/ai-bots-plan.md` | Active | AI-first `AUTO` mode and no-AI fallback exist; provider health and browser status coverage remain follow-ups. | Keep; update rollout/evaluation status. |
| `docs/plans/no-ai-bots-plan.md` | Active | Deterministic bot, legal candidate path, personalities, and fallback exist; balance evaluation remains. | Keep beside AI plan. |
| `docs/plans/casino-market-global-events-plan.md` | Active | Optional casino, market, and global-event contracts exist; balance/depth work remains. | Keep as active economy plan. |
| `docs/plans/global-events-plan.md` | Active | Single ON/OFF control and server-derived rarity, duration, severity, and combinations exist. | Keep; add telemetry results later. |
| `docs/plans/global-leaderboards-plan.md` | Active | Multi-scope standings exist; seasonal reward work is still a follow-up. | Keep; update reward status. |
| `docs/plans/friends-and-player-social-plan.md` | Active | Social hub, privacy projection, relationship actions, and in-room cards exist; scale/abuse coverage remains. | Keep as social contract. |
| `docs/plans/match-history-and-in-session-social-plan.md` | Active | Match records, privacy gates, and in-session overlays exist; browser interaction coverage remains. | Keep; add current browser evidence. |
| `docs/plans/deal-negotiation-plan.md` | Completed | Shared pending-deal surface, role-specific actions, counters, and cancellation exist. | Keep as contract history. |
| `docs/plans/IN-GAME-UX-IMPLEMENTATION-PLAN.md` | Stale | Its opening gate says production code is not changed, but the rail/modal implementation is present. | Stamp as implemented and link a current UX audit. |
| `docs/plans/IPAD-LANDSCAPE-UI-UX-AUDIT.md` | Active | Landscape slice is implemented; real-Safari follow-up is explicitly outstanding. | Keep and track Safari verification. |
| `docs/plans/END-TO-END-AUDIT-CS2-ROULETTE-PLAN.md` | Completed | CS2-style reel, server settlement, privacy, and core QA are recorded as implemented. | Keep as dated audit; track external probes separately. |
| `docs/sponsored-purchase.md` | Completed | Sponsorship escrow flow is implemented in `server/sponsorshipApi.js` and client surfaces. | Keep; status is no longer “planned”. |
| `public/assets/audio/README.md` | Reference | Contains the source, license, download date, and checksum for the audio asset. | Keep for attribution and reproducibility. |
| `public/assets/parlor-patrol/README.md` | Reference | Documents original patrol SVGs, controls, timing, and asset behavior. | Keep for asset maintenance. |

## Preliminary deletion list

There are no safe current-tree deletions. The three old theme documents are
absent from this reset branch but remain recoverable in the backup branch:

1. `.ulpi/design/THEME-SYSTEM-VISUAL-BRAINSTORM.md` — old six-theme art
   direction; archive or delete only after the replacement five-theme spec is
   accepted.
2. `docs/superpowers/plans/2026-09-10-poorup-theme-system-implementation.md` —
   completed implementation plan for the removed theme system.
3. `docs/superpowers/plans/2026-09-11-poorup-seasonal-theme-ui.md` — seasonal
   UI-skin plan that no longer describes the reset branch.

These are deletion/archive candidates, not an automatic deletion instruction.
The backup branch is the recovery source. `README.md`, product/workflow docs,
license files, active feature plans, and completed audit records are not
deletion candidates.

## Findings to carry into implementation

1. Rewrite `docs/REFACTOR-ROADMAP.md` measurements after the next CodeScene run.
2. Stamp older audits as historical so fixed findings are not reopened by
   stale line numbers.
3. Update `docs/plans/IN-GAME-UX-IMPLEMENTATION-PLAN.md` to completed status.
4. Keep the five-theme brainstorm as a new design artifact rather than
   reusing the removed six-theme contract.
5. Run this parity check whenever a feature PR changes a documented socket,
   server rule, or user-visible surface.

## Audit status

The reset and client UX regression slices are implemented on this branch. The
document deletion decision remains intentionally gated on explicit approval.
