# Ruleset expansion implementation record

This slice follows the locked Poorup design contract in
`.ulpi/design/DESIGN.md`: dark teal terminal surfaces, gold rule lines, red
actions, compact spacing, pixel-art/SVG marks, native controls, live regions,
focus restoration, and reduced-motion behavior. Classic Standard 40 remains
the compatibility path; new surfaces are additive.

## Delivered contracts

- `RulesetRegistry` resolves Classic, After Hours, and Custom into one frozen
  effective-settings map and stable digest.
- `BoardRegistry` preserves Standard 40 and adds semantic Metro 52 tiles,
  coordinates, cards, capacities, and corner metadata. Grand 64 is schema-only.
- Room summaries, reconnect snapshots, match records, bot context, and Rules
  expose the same preset/board/revision metadata.
- SeasonStore verifies completed match eligibility, scores an immutable
  eight-week season, and supports idempotent reward claims.
- CosmeticStore owns Parlor Tokens, catalog inventory, claims, and equip state;
  no cosmetic value enters gameplay cash or legality.
- TelemetryStore keeps a bounded, versioned, privacy-safe aggregate stream.
- Market Complexity adds server-authoritative margin, finite-inventory shorting,
  deterministic buy-ins, and collateralized option actions to Finance.
- Atomic checksummed JSON backups and an optional process-level IP limiter back
  the existing CORS/socket limits. Production headers are set without exposing
  framework fingerprints.
- Playwright covers 1920×1080, 1366×768, 1024×768, and 390×844 navigation,
  presets, Rules, Rankings, Collection, reduced-motion anchors, and live bot
  status semantics.
- Home `ENTRY`, `SYNC`, and `LOBBIES` signals are native controls: account
  identity and connection state are live, while the lobby count is refreshed
  from the server directory and protected against stale responses.
- Rankings uses one primary ledger stage with arrow/keyboard metric navigation,
  a compact season context rail, and claimed-reward status. Collection covers
  all planned cosmetic categories and provides an in-place item detail view.
- Quick Table remembers the last selected Classic/After Hours preset, and
  Custom tables expose their base preset explicitly.
- AI/NO-AI market candidates include option close and an explicit finance-window
  exit, using the same server-authoritative runner path.

## Skill application notes

The find-skills pass confirmed the local catalog already covered the needed
frontend, motion, accessibility, testing, and architecture work, so no extra
skill package was installed. 
Architecture and code-review guidance kept the implementation as a modular
monolith with pure registries and server-authoritative writes. Systematic
debugging and TDD were applied through focused registry, market, season,
cosmetic, telemetry, backup, and rate-limit tests before the full suite.
QA-agent/evaluator guidance informed bounded contracts, deterministic candidate
lists, idempotency, and privacy filters. Security guidance informed strict
CORS, CSP/security headers, proxy-aware IP handling, input allowlists, and
atomic restore paths. Frontend, game UI/UX, accessibility, mobile, design
taste, impeccable, SVG, pixel-art, and motion guidance kept the new controls
inside the existing Poorup visual language and safe interaction patterns.
