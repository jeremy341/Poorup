# Admin console

The operator console lives at `/admin/analytics` (the route name is historical).
It is a single-page view in the normal client (`public/clientAdminConsole.js`,
`public/clientAdminOps.js`, `public/clientAnalyticsPage.js`) backed by admin-only
JSON endpoints on the server. Admin accounts are listed in
`POORUP_ADMIN_ACCOUNT_IDS`.

## Tabs

The selected tab is kept in the URL as `?tab=`. Unknown values fall back to
`status`.

| Tab | `tab` id | What it shows |
| --- | --- | --- |
| Analytics | `status`, `matches`, `economy` | A health verdict and six KPI tiles, then Overview (matches started), Match health (starts, completions, stalls, reconnect and AFK rate) or Economy (feature adoption). A `1H / 24H / 7D / 30D` window control applies to these views and to Bots. |
| Rooms | `rooms` | Live rooms table and totals; refreshes every 15 seconds while shown. |
| Bots & AI | `bots` | Bot and AI-decision usage, the active provider and its state, the provider profile editor and the provider change log. |
| Release | `release` | Maintenance and drain control: release id, drain deadline, player message, and the release change log. |

## Endpoints

All are admin-only: no session is `401`, a non-admin is `403`, every answer is
`no-store`, writes need a same-origin request and share the write rate limit
(see [rate-limits.md](rate-limits.md)). Bodies are JSON shaped `{ success, ... }`.
The exact response shapes are pinned by `server/adminOpsRoutes.test.js`.

| Endpoint | Purpose |
| --- | --- |
| `GET /admin/ops/status` | Health checks (backup, errors, restore, latency, storage), uptime, sockets, rooms, and the maintenance state. |
| `POST /admin/ops/maintenance` | Set `normal`, `draining` or `maintenance` through the same controller as `/internal/maintenance`. A `releaseId` allows letters, digits, `.`, `_`, `-` (1 to 80 characters). A `deadline` must be in the future and at most 14 days ahead, because it is armed with `setTimeout`. |
| `POST /admin/ops/lockout` | Turn the public "under maintenance" panel on or off (`reopen: true` returns to normal). |
| `GET /admin/ops/rooms` | Live rooms: a one-way hashed id, phase, visibility, human and bot counts, age, idle time, stalled flag. Newest first, capped at 200. |
| `GET /admin/ops/bots?range=hour\|day\|week\|month` | Bot matches, AI decisions, fallbacks and fallback rate from the rollup, plus the live provider state. |
| `GET /admin/ops/audit` | The newest audit entries (default 50, up to 500). |
| `GET /admin/analytics/balance` | The analytics rollup (KPIs, series, `dataQuality`). Also `summary` and `drilldown` beside it. |
| `/admin/ai/*` | AI provider profiles: list, create, edit, test, activate, delete (`server/aiProviderRoutes.js`). |

Privacy rule: no payload carries room codes, nicknames, account ids, client ids
or chat. Unknown numbers are `null`, never invented. Audit entries hold a
pseudonymous actor and the action only, never keys, URLs, messages or account
ids; the maintenance entry records the mode alone.

## Live counters

Counters in `server/metricsRegistry.js` are read through `summarizeRuntimeMetrics`.
An unobserved counter is `null` ("not recorded yet"); `restore-failures` starts
at zero.

- `bot-fallbacks`: a bot decision the AI was asked for but the house engine
  answered instead (rule in `classifyBotDecision`, `server/socketRuntime.js`).
  Deliberate house policy (no-AI rooms, auction rules, phase resolution, shadow
  mode) never counts.
- `room-reconnects`: a seat that lost its socket and came back inside its grace
  period, counted where the disconnect timer is cleared (`clearDisconnectTimer`).
- `restore-failures`: `restore-session` failed while a retained seat existed.

## Known gaps

- A rollup that has data but has been quiet for over two hours is "stale", and
  every analytics view except Overview answers `503` for it. A server idle
  overnight cannot open Match health or Economy until a match is recorded,
  because the store cannot tell "quiet" from "write pipeline behind".
- The reconnect and bot-fallback counters are since process start and held in
  memory. A seat restored after a server restart is not counted.
- A rollup that has recorded nothing at all is not an error: it answers `200`
  with zeros and `dataQuality.empty: true`, and the views say there is nothing
  to measure yet.
