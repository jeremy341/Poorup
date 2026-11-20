# Poorup

Poorup is a browser-based, real-time multiplayer property game inspired by Monopoly. Players can join as guests, create or enter a room, trade and develop properties, and compete to be the last solvent player. The server owns game state and settlement; Socket.IO synchronizes the table.

**Live demo:** https://poorup.tech

**Portfolio:** https://jeremydarko.me

To test multiplayer: open two browser tabs (or share the link with a friend), enter different nicknames, and have one player create a room while the other joins with the room code.

## AI use: what was assisted and what I made

- **AI-assisted coding:** GPT/Codex helped debug issues and implement backend work, and contributed substantially to development of the in-game bots and House Brain. CodeScene was used for code-health analysis.
- **CodeScene hotspot refactors:** I wrote many of the original page-specific backends myself. CodeScene flagged some larger or more complex files as hotspots, and I used GPT/Codex to help refactor and split those existing implementations into smaller, focused files. Those modules are often refactorings of my original work, not separate features generated wholesale by AI.
- **Created by me:** I designed and implemented all of the UI and created all Poorup SVG assets.
- **Music:** I did not compose the soundtrack. It uses third-party, openly licensed, CC0, or public-domain tracks; sources and license terms are in [the audio credits](public/assets/audio/README.md).
- **Git history:** I rewrote the repository history and removed older commits to make the repo cleaner. The current log is not a complete development record.

Development-time AI assistance is separate from the bots available in-game: deterministic NO-AI and configured AI-advisor modes.

## Features

- **Two playable boards:** Standard-40 and Metro-52, with room-specific rules and host controls.
- **Property gameplay:** buy, rent, build, mortgage, trade, go to auction, and compete to be the last solvent player.
- **Rooms and live play:** public room discovery, private shareable room codes, guest entry, chat, reconnect support, and automatic cleanup when everyone leaves. The server owns game state and settlement; Socket.IO keeps clients synchronized.
- **Bots:** deterministic NO-AI bots and configurable AI-advisor bots, with difficulty settings. AI decisions use current game context and fall back to the deterministic brain if the configured provider fails.
- **Player finance:** off-turn player-to-player trade and financing offers, loans, property-equity and hybrid contracts, collateral, default consequences, and sponsored purchases where one player can fund another player's property in return for an agreed share.
- **Market and events:** an optional fictional-currency stock market with shared quotes, per-index price history, buy/sell orders, holdings, and personal profit/loss. Global events affect the shared market and can also change game rules; player orders change their own position, not the shared quote.
- **Casino:** an optional fictional-currency casino mode.
- **Parlor Patrol:** a Home mini-game playable locally as a guest. Signed-in runs use server-controlled targets and scoring for achievements and rankings. Existing legacy records remain visible on profiles, while the Patrol leaderboard uses only scores earned under the new server-controlled system.
- **Profiles and progression:** completed-match history and statistics, achievements, player designs, friends, and all-time, 30-day, and friends rankings.
- **In-game information:** a separate Activity/Log for room and game announcements, plus inactivity monitoring and a vote-kick flow. Turns do not have a fixed time limit.
- **Visual identity:** custom player designs, theme worlds with original Poorup SVG artwork, and an optional music player.
- **Persistence:** no database; account and match records use local JSON stores.

## Quick start

Requires Node.js 22 (see `engines` in `package.json`; CI and the Dockerfile use 22).

```bash
git clone https://github.com/jeremy341/Poorup.git
cd Poorup
npm ci
npm start
```

Open <http://localhost:8080> (set `PORT` to change it). A game needs at least two players: open two tabs, enter different nicknames, create a room in one and join with the room code in the other. The host starts from the lobby once seats are filled; bots can fill empty seats.

The server reads its configuration from the process environment only; it does not load `.env`. Local defaults are enough to play. Account and match data are written to `server/data/` (git-ignored); backups are only made when `POORUP_BACKUP_DIR` is set. [`.env.example`](.env.example) lists the server settings with comments (test and tooling variables are listed in [qa/README.md](qa/README.md)); the production values are explained in [docs/production-hardening.md](docs/production-hardening.md).

## Run the tests

| Command | What it runs |
| --- | --- |
| `npm test` | The `core` group: most of the unit and wire tests in `server/`, `public/` and `scripts/`, plus a short seeded bot-campaign run. The usual check before a commit; it takes about five minutes sequentially, or less with `POORUP_TEST_PARALLELISM=4`. |
| `npm run test:full` | Every group in `scripts/test-manifest.mjs`: `core` plus the audit, timers, account, inactivity and UI-surface groups. CI runs this in four shards. The same `POORUP_TEST_PARALLELISM=4` applies. |
| `npm run test:audit`, `test:account`, `test:inactivity` | One named group from the manifest. |
| `npm run lint` / `npm run lint:client` | ESLint for `server scripts qa` / for `public`. |
| `npm run test:browser` | Playwright browser specs in `qa/`. Starts `node server/server.js` on port 8080 unless `POORUP_QA_BASE_URL` points at a server you started yourself. First run: `npx playwright install chromium`. |
| `npm run coverage` | The full suite under c8 (server coverage). |

Every test file is a plain Node script that exits non-zero on failure, so any single one can be run directly, for example `node server/rooms.test.js`. A new test file must be added to a group in `scripts/test-manifest.mjs` or CI will not run it. More on the browser specs in [qa/README.md](qa/README.md).

## Repo map

| Path | What lives there |
| --- | --- |
| `server/` | The Node.js server: Express HTTP, Socket.IO handlers, game rules, bots, account and match stores, security and ops code. Tests sit beside the code as `*.test.js`. |
| `public/` | The static client: vanilla HTML, CSS and ES modules (no build step), plus SVG art, fonts and audio under `public/assets/`. Tests sit beside the code as `*.test.js`. |
| `qa/` | Playwright browser specs, the screenshot-capture tooling (`qa/visual-capture/`) and the socket load harness (`qa/load/`). |
| `scripts/` | Test runner and manifest, CI timing tools, deploy and rollback scripts for the host, and backup restore and data-purge tools. |
| `docs/` | Runbooks and reference docs; start at [docs/README.md](docs/README.md). |
| `design/` | The visual design system. |
| `bench/` | Bot-campaign parity baseline; see [bench/README.md](bench/README.md). |

Root files: `PRODUCT.md` (product intent), `AGENTS.md` (rules for coding agents), `Dockerfile` and `ecosystem.config.cjs` (container and PM2 runtime), `.github/` (CI, deploy and maintenance workflows), `.codescene/` and `codecov.yml` (code-health and coverage settings).

## Where to start reading

1. `server/server.js`: boots Express and Socket.IO, creates the stores and wires the socket handlers.
2. `server/gameLogic.js`: the `RoomManager` and the game rules it builds on (`game*.js`, `*Logic.js`, `*Rules.js` modules beside it).
3. `server/botLogic.js`: how bots decide; `server/botAdvisor.js` is the AI-advisor side.
4. `public/index.html` and `public/main.js`: the client shell and its entry module; the `client*.js` modules beside them each own one surface (board, lobby, trade, market, profile and so on).
5. `docs/security-audit.md` and `docs/security-headers.md` before changing anything that touches sessions, sockets or HTTP.

## How to play

Guest play requires no account. Roll, resolve the landed space, and complete any required purchase, auction, card, or payment before ending your turn. Build evenly across a color group, and use trades or mortgages to manage cash. The full rules are in the in-game **Rules** surface.

Players have unlimited turn time. A separate inactivity-removal clock and vote-kick flow operate during a game.

## Deployment

The Dockerfile builds a production image (`docker build -t poorup .`). The live host runs the release under PM2; see the runbooks listed in [docs/README.md](docs/README.md) (start with [the live runbook](docs/deployment/nest-live-runbook.md)) and [docs/production-hardening.md](docs/production-hardening.md).

## License

MIT, see [LICENSE](LICENSE).
