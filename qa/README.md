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

`POORUP_QA_RETRIES` overrides the retry count (CI uses 1, local runs 0). Every
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

## Known overlap

Three pairs of specs exercise largely the same scenarios under identical or
near-identical test titles. They are the product of two merged histories, not
separate features, and merging each pair into one file is a pending cleanup:

| Pair | Difference |
| --- | --- |
| `audit-remediation.spec.js` and `modal-and-board-regressions.spec.js` | The desktop zoom check runs at 1440x900 and 1920x1080 in the first, at 1440x900 only in the second; the second waits for the setup screen before starting. |
| `modal-audit-fixes.spec.js` and `modal-regressions.spec.js` | Same tests; the first prefixes titles with `F01`..`F07`. |
| `modal-decision-fixes.spec.js` and `modal-decisions.spec.js` | Same tests; the first splits the helpers into smaller functions. |

Merge by keeping the superset of assertions, not by deleting either file.
