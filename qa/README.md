# qa: browser specs and tooling

Playwright specs that drive the real client against a real server, plus the
screenshot-capture and load tools. (Unit and wire tests are not here: they sit
beside the code as `server/*.test.js` and `public/*.test.js`.)

## Run the browser specs

```bash
npx playwright install chromium     # first run only
npm run test:browser                # all specs, every viewport project
npx playwright test -c qa/playwright.config.js --project=desktop-1440x900 qa/theme.spec.js
```

By default Playwright starts `node server/server.js` itself on port 8080 (and
reuses a server already there). To use a server you started on another port:

```bash
PORT=8125 node server/server.js &
POORUP_QA_BASE_URL=http://127.0.0.1:8125 npx playwright test -c qa/playwright.config.js --project=desktop-1440x900 --reporter=line
```

`POORUP_QA_RETRIES` overrides the retry count (the config default is 1 in CI and 0 locally; the CI browser shards set it to 0). Every
spec runs once per project; a project is a viewport profile defined in
`qa/visual-capture/viewports.mjs` (desktop 1440x900 up to 4K, and landscape iPad
sizes). CI runs the `desktop-1920x1080` and `ipad-1194x834` projects in four
shards. Specs that only make sense at some sizes call `test.skip` on the project
name.

## What is in this folder

- `*.spec.js`: the specs, one file per surface or concern: pages and shared
  header (`poorup`, `shared-header`, `about`, `metadata`), lobby and rooms
  (`rooms-*`), the in-game board, HUD and modals (`turn-ui`, `in-game-ux`,
  `modal-*`, `close-controls`, `trade-builder-layout`, `deed-*`,
  `owned-deed-navigation`), finance and sponsorship (`finance-*`,
  `rent-share-rules`, `sponsored-purchase-presentation`), accounts and profiles
  (`account-*`, `client-account-auth-races`, `profile-history`), Parlor Patrol
  (`patrol-*`, `night-shift-*`), themes and music (`theme`, `music-box-reference`),
  maintenance and the admin console (`admin-*`, `analytics-console`,
  `maintenance-lockout`), and layout and accessibility contracts (`visual-contracts`,
  `responsive-a11y-contracts`, `board-layout-regression`, `ipad-*`, `release-surfaces`).
- `support/deed-harness.mjs`: shared fixtures for the deed specs (a finished
  game room, a client wired to it, screenshot helpers).
- `visual-capture/`: the viewport profiles, the surface catalog and the runner
  behind `npm run capture:ui` (screenshots of named surfaces into
  `qa-artifacts/`, git-ignored), plus the iPad modal fixture several specs load.
  The catalog (`catalog.mjs`) refers to specs by file name and exact test title,
  so renaming either breaks the capture plan; its `*.test.mjs` files run in
  `npm test`.
- `load/`: the opt-in Socket.IO capacity harness; see [load/README.md](load/README.md).
- `test-timings.json`: per-suite durations used to balance CI shards. Refresh
  with `npm run timings:refresh`.
- `playwright.config.js`: projects, retries and the auto-started server.

## Environment variables for tests and tooling

These are not server settings, so they are not in `.env.example`.

| Variable | Used by | Effect |
| --- | --- | --- |
| `POORUP_QA_BASE_URL`, `POORUP_QA_RETRIES` | `qa/playwright.config.js` | Server to test against; retry count. |
| `POORUP_TEST_PARALLELISM`, `POORUP_SUITE_TIMEOUT_MS`, `POORUP_TEST_TIMING_FILE` | `scripts/run-test-manifest.mjs` | Suites run at once (default 1); per-suite timeout (default 5 minutes); where to write suite timings. |
| `POORUP_BOT_SIMULATION_COUNT`, `POORUP_BOT_SIMULATION_START_INDEX` | `server/bot-simulation.test.js` | Number of seeded games and first game index (the runner sets these per shard). |
| `POORUP_BOT_EVAL_COUNT`, `_SEEDS`, `_STEP_LIMIT`, `POORUP_BOT_LIVE_AI`, `POORUP_BOT_LIVE_AI_MAX_CALLS` | `npm run bot:compare` (`server/botTournamentCli.js`) | Bot policy tournament size and seeds; live AI calls are off unless `POORUP_BOT_LIVE_AI=1` and a call cap is set. |
| `POORUP_TEST_RECONNECT_GRACE_MS` | `server/socketRuntime.js` | Shortens the seat-reconnect grace so lifecycle tests run quickly. |
| `POORUP_CAPTURE_GROUP`, `_SEED`, `_VIEWPORT`, `_VISUALS`, `POORUP_VISUAL_CAPTURE_DIR` | `npm run capture:ui` and the capture-aware specs | Which surfaces, viewport and room seed to capture, and where the screenshots go. Set by `scripts/capture-ui.mjs`; rarely by hand. |
| `POORUP_LOAD_ENV`, `_TARGET`, `_CLIENTS`, `_ALLOW_LOCAL` | `qa/load/poorup-socket-load.mjs` | See [load/README.md](load/README.md). |
| `POORUP_SHARED_ENV_FILE` | `ecosystem.config.cjs` | Host env file merged by PM2 (default `/srv/poorup/shared/poorup.env`). |

## Known overlap

Three pairs of specs exercise largely the same scenarios under identical or
near-identical test titles. They are the product of two merged histories, not
separate features, and merging each pair into one file is a pending cleanup:

| Pair | Difference |
| --- | --- |
| `audit-remediation.spec.js` and `modal-and-board-regressions.spec.js` | The desktop zoom check runs at 1440x900 and 1920x1080 in the first, at 1440x900 only in the second; the second waits for the setup screen before starting. |
| `modal-audit-fixes.spec.js` and `modal-regressions.spec.js` | Same tests; the first prefixes titles with `F01`..`F07`. |
| `modal-decision-fixes.spec.js` and `modal-decisions.spec.js` | Same tests; the first splits the helpers into smaller functions. |

Merge each pair into one file that keeps the superset of assertions.
