# Admin console redesign: shared contract

Status: implemented 2026-10-20 (backend + frontend), gaps closed the same day and verified against a real server on a spare port with a temporary data directory (screenshots at 1920x1080, 1366x768 and 1024x768, plus the admin Playwright specs on desktop and iPad). A never-written analytics rollup is an empty snapshot, not a 503 (see "Empty rollup"); `room-reconnects` and `bot-fallbacks` are real counters; the Release tab sends the release id and a drain deadline; the provider state badge follows the server's health.

Known gaps (true after this work):
- A rollup that has data but has been quiet for more than two hours is "stale", and every tab except Overview answers 503 for it (Overview still serves its live tiles). A server idle overnight therefore cannot open Match health or Economy until a match is recorded; the store cannot tell "quiet" from "write pipeline behind" because both are lag since the last event. Not changed here.
- `GET /admin/ai/providers` answers a bare 500 page when stored profiles exist but `POORUP_AI_CONFIG_KEY` is missing at boot; the panel shows its generic "UNAVAILABLE - RETRY" error for it.
- The reconnect and bot-fallback counters are since-process-start, in memory. A seat restored after a server restart (no grace timer survives it) is not counted.

Two owners work in parallel against this file: **backend** (`server/`) and **frontend** (`public/`, `qa/`). Neither edits the other's paths. Anything not stated here is the owner's call; anything that changes this contract must be reported, not silently changed.

Goal: turn `/admin/analytics` from a read-only analytics dashboard into an operator console. Remove dead plumbing, show the operational numbers that matter, expose server capabilities that today need a `curl`, and redesign the layout.

## Information architecture (frontend)

One row of four top tabs (a full-width tablist, roving tabindex). The route stays `/admin/analytics`; the selection lives in `?tab=`. Analytics holds three views behind a second, smaller tab row.

| Top tab | `tab` id | Content |
|---|---|---|
| Analytics | `status` / `matches` / `economy` | a one-line health verdict, the six KPI tiles, then one of three views: **Overview** (`status`, matches started per hour or day), **Match health** (`matches`, starts, completions, stalls, reconnect and AFK rate, bankruptcies, comebacks) and **Economy** (`economy`, feature adoption). The tiles stay above every view. |
| Rooms | `rooms` | live rooms table (hashed ids, no codes, no names), totals and the since-start reconnect count on one line, 15 second refresh while shown |
| Bots & AI | `bots` | one usage line (bot matches, AI decisions, fallbacks, fallback rate, sample, fallbacks since start), the active provider with its state badge, the inline profile editor, the provider roster, the provider change log |
| Release | `release` | maintenance / drain control: release id, drain deadline (minutes from now, or a date and time, up to 14 days), player message, confirm step, active release id and deadline with a live countdown while draining, release change log |

Legacy `?tab=overview` maps to `status`, `?tab=match-health` maps to `matches`, an old `?admin=provider` link (with no `tab`) maps to `bots`. Unknown tabs fall back to `status`.

Window control: a segmented control `1H · 24H · 7D · 30D` in the header (ranges `hour`, `day`, `week`, `month`); it is hidden on Rooms and Release, which are live state, not a window of history. The "Season" range, the filter panel, RESET and the dead filters (`seasonId`, `eventId`, `rulesetRevision`, `balanceRevision`, `provider`) leave the UI and the client query normalizer. There is no CSV export, and no data tables: the views are SVG charts (small multiples grouped by unit); each chart carries its own accessible data table for screen readers and keyboard users.

KPI tiles (all six, in this order): `online-now`, `error-rate`, `p95-action-latency`, `completion-rate`, `started`, `peak-24h`. Tiles show the number, a delta against the previous period when the server sends one, and the definition as a tooltip/`title`. No per-card "verified <timestamp>" or "comparison unavailable" lines; freshness is one chip in the header.

Empty rollup: a rollup that has recorded no match at all answers `200` with zeros (`started` is `0`, rates are `null`, the series is empty) and `dataQuality.empty: true`. The chip then reads "NOTHING TO MEASURE YET" (never STALE), the tiles show their zeros and dashes, and each view says "No matches in this window yet" (Overview) or "No completed matches in this window yet" (Match health, Economy) instead of drawing a chart of zeros. A window in which nothing started reads the same way. A rollup that failed to load, or has data but has gone quiet, still answers `503` and the view shows the error with Retry.

Layout rules (from the poorup-frontend skill): no document scroll, overflow inside deliberate keyboard-reachable surfaces, 1920x1080 first, then 1366x768, 1024x768, iPad landscape, 390x844. Pixel-parlor tokens only. No gradients, 3D or fabricated trends.

## Server API (backend)

All endpoints are admin-only, same guard as `/admin/ai/*` (`401` no session, `403` not an admin, `no-store` headers, same-origin check on writes, write rate limit). JSON, `{ success: boolean, ... }`. No room codes, nicknames, account ids, client ids or chat in any payload. Unknown values are `null`, never invented.

### `GET /admin/ops/status`

```
{ success: true, generatedAt: ISO,
  health: {
    state: 'healthy' | 'degraded' | 'down',
    checks: [ { id: 'backup'|'errors'|'restore'|'latency'|'storage', label, state: 'ok'|'warn'|'bad'|'unknown', detail } ],
    uptimeSeconds, sockets, rooms, activeRounds,
    backup: { configured, fresh, lastRunAt, failures },
    errorCount, restoreFailures, latencyP95Ms: number|null,
    roomReconnects: number|null, botFallbacks: number|null   // since the process started; null until the first event
  },
  maintenance: { mode: 'normal'|'draining'|'maintenance', message, releaseId, drainDeadline: ISO|null, activeRounds }
}
```

### `POST /admin/ops/maintenance`

Body `{ mode: 'normal'|'draining'|'maintenance', message?, releaseId?, deadline? }`. Uses the existing drain controller (same behavior as `/internal/maintenance`). Returns `{ success: true, maintenance }`, `409` for a drain asked of a table already in maintenance, or `400` with `{ success:false, error }`. Writes an audit entry.

Validation (the route refuses; the controller alone would quietly rewrite or ignore): `releaseId` is optional and, when given, a string of letters, digits, `.`, `_` and `-`, 1 to 80 characters; `deadline` (ISO text or epoch milliseconds, drain only) must be in the future and no more than 14 days ahead, because the controller arms it with `setTimeout`, which fires at once for a delay beyond about 24.8 days. A blank `releaseId`, `deadline` or `message` means "not given". Going from a drain to maintenance without a new `releaseId` keeps the drain's. The audit entry holds the mode only: never the message, release id or deadline.

### `GET /admin/ops/rooms`

```
{ success: true, generatedAt: ISO,
  totals: { rooms, lobby, playing, humans, bots },
  sinceStart: { reconnects: number|null },   // seats that came back inside their reconnect grace; null until the first
  rooms: [ { id: 'r-<6 hex, one-way hash of the room code>', phase: 'lobby'|'playing'|'finished',
             visibility: 'public'|'private', humans, bots, round: number|null,
             ageSeconds, idleSeconds, stalled: boolean } ]   // newest first, capped at 200
}
```

### `GET /admin/ops/bots?range=hour|day|week|month`

```
{ success: true, range, generatedAt: ISO,
  totals: { botMatches, decisions: number|null, fallbacks: number|null, fallbackRate: number|null, sampleSize },
  providers: [ { provider, botMode, matches, decisions: number|null, fallbacks: number|null, fallbackRate: number|null, sampleSize } ],
  sinceStart: { fallbacks: number|null },   // live counter since the process started; null until the first
  provider: { state, activeLabel: string|null, capPerBot: number|null }   // from the existing provider manager status
}
```
Only fields the rollup truly records may be non-null; the backend report must say which are recorded and which are not. `sinceStart.fallbacks` is a separate, live counter (it resets on restart); the windowed `fallbacks` above come from the rollup.

Live counters (`server/metricsRegistry.js`, read through `summarizeRuntimeMetrics`; an unobserved counter is `null`, shown as "not recorded yet", except `restore-failures`, which starts at zero):
- `bot-fallbacks`: one increment per recorded bot decision trace that the model was asked and the house engine answered instead, using `classifyBotDecision` in `server/socketRuntime.js` (the same rule as the rollup). Deliberate house policy (`BY_DESIGN_HOUSE_REASONS`: no-AI rooms, auction rules, phase resolution, shadow mode) never counts.
- `room-reconnects`: one increment when a seat that lost its socket and holds a pending disconnect timer comes back (restore-session, rejoin by code or room id, the create-room replay, an accepted invite, the account-seat reclaim). Counted where the timer is cleared (`clearDisconnectTimer` in `server/socketRuntime.js`), once per timer; leaving, rescheduling and room teardown never count.
- `restore-failures`: initialized to zero at boot; one increment when `restore-session` fails while a retained client seat or disconnected account seat exists. A routine request from a fresh tab with no seat does not count.

### `GET /admin/ops/audit`

```
{ success: true, entries: [ { at: ISO, area: 'provider'|'release', action: 'create'|'update'|'activate'|'delete'|'test'|'mode',
                              target: string,            // profile label, or the mode that was set
                              actor: 'admin-<8 hex pseudonym>', outcome: 'ok'|'failed' } ] }   // newest first, last 50
```
Entries never contain keys, URLs, messages or account ids. Persisted in the data directory when one is configured. Provider routes (`/admin/ai/*`) and the maintenance route write to the same log.

### Analytics (existing `GET /admin/analytics/balance`)

- `overview.kpis` carries the six KPI ids above in that order, each with `{ id, label, value, unit, definition, comparison?, numerator?, denominator? }`.
- `dataQuality` carries `{ fresh, stale, empty, lagSeconds, ... }`. `empty: true` means the rollup holds no bucket at all; it is then `fresh: true, stale: false` and every tab answers `200` (see "Empty rollup"). `loaded: false`, a stale rollup (data, but no event for over two hours) on any tab but Overview, or a query that returns nothing is `503 { error: 'Rollup unavailable.' }`.
- `range` accepts `hour`, `day`, `week`, `month` (and still tolerates `season` for old links, mapping it to `month`).
- The `manual-codescene-runs` metric leaves the allowlist.

### Provider roster (existing `GET /admin/ai/providers`)

Also carries `provider`: the advisor's own health (`healthy`, `unconfigured`, `quota-exhausted` or `open`, no secrets), so the state badge reads the server instead of guessing from a profile's last test. `POST /admin/ai/providers/:id/activate` answers with the same health in `status.provider`. The badge reads UNCONFIGURED with no active profile, READY / CREDITS EXHAUSTED / COOLDOWN / FALLBACK ACTIVE from the health, and UNCONFIGURED with a note when a profile is saved as active but the server reports it unusable (for example the config key was missing at boot). A live `bot-provider-status` push is kept across roster reads and drawn only once the roster has loaded and no change is in flight.

## Ownership

| Owner | Paths |
|---|---|
| Backend | `server/adminOps*.js` (new), `server/adminAudit*.js` (new), `server/server.js` (wiring only), `server/aiProviderRoutes.js`, `server/aiProviderConfig.js`, `server/analytics*.js`, `server/metricsRegistry.js`, their tests |
| Frontend | `public/index.html` (admin view only), `public/clientAnalytics*.js`, `public/clientAdmin*.js` (new and existing), `public/styles.css` (admin rules only), `qa/admin-*.spec.js`, tests beside those files |
| Integrator (main thread) | `scripts/test-manifest.mjs`, docs, cross-checks, final verification |

Neither owner touches `scripts/test-manifest.mjs`; both report the new test file names so the integrator registers them.
