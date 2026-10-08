# Poorup

Poorup is a browser-based, real-time multiplayer property game inspired by Monopoly. Players can join as guests, create or enter a room, trade and develop properties, and compete to be the last solvent player. The server owns game state and settlement; Socket.IO synchronizes the table.

**Live demo:** https://poorup.jeremy-d.hackclub.app/

To test multiplayer: open two browser tabs (or share the link with a friend), enter different nicknames, and have one player create a room while the other joins with the room code.

## AI use: what was assisted and what I made

- **AI-assisted coding:** GPT/Codex helped debug issues and implement backend work, and contributed substantially to development of the in-game bots and House Brain. CodeScene was used for code-health analysis.
- **CodeScene hotspot refactors:** I wrote many of the original page-specific backends myself. CodeScene flagged some larger or more complex files as hotspots, and I used GPT/Codex to help refactor and split those existing implementations into smaller, focused files. Those modules are often refactorings of my original work, not separate features generated wholesale by AI.
- **Created by me:** I designed and implemented all of the UI and created all Poorup SVG assets.
- **Music:** I did not compose the soundtrack. It uses third-party, openly licensed, CC0, or public-domain tracks; sources and license terms are in [the audio credits](public/assets/audio/README.md).
- **Git history:** I intentionally rewrote the repository history and removed older commits to make the repo cleaner. The current log is not a complete development record.

Development-time AI assistance is separate from the bots available in-game: deterministic NO-AI and configured AI-advisor modes.

## Features

- **Two playable boards:** Standard-40 and Metro-52, with room-specific rules and host controls.
- **Property gameplay:** buy, rent, build, mortgage, trade, go to auction, and compete to be the last solvent player.
- **Rooms and live play:** public room discovery, private shareable room codes, guest entry, chat, reconnect support, and automatic cleanup when everyone leaves. The server owns game state and settlement; Socket.IO keeps clients synchronized.
- **Bots:** deterministic NO-AI bots and configurable AI-advisor bots, with difficulty settings. AI decisions use current game context and fall back to the deterministic brain if the configured provider fails.
- **Player finance:** off-turn player-to-player trade and financing offers, loans, property-equity and hybrid contracts, collateral, default consequences, and sponsored purchases where one player can fund another player's property in return for an agreed share.
- **Market and events:** an optional fictional-currency stock market with shared quotes, per-index price history, buy/sell orders, holdings, and personal profit/loss. Global events affect the shared market and can also change game rules; player orders change their own position, not the shared quote.
- **Casino:** an optional fictional-currency casino mode.
- **Profiles and progression:** completed-match history and statistics, achievements, player designs, friends, and all-time, 30-day, and friends rankings.
- **In-game information:** a separate Activity/Log for room and game announcements, plus inactivity monitoring and a vote-kick flow. Turns do not have a fixed time limit.
- **Visual identity:** custom player designs, theme worlds with original Poorup SVG artwork, and an optional music player.
- **Persistence:** no database; account and match records use local JSON stores.

## Known issues

- **Parlor Patrol is currently broken and does not work reliably.** Treat it as unavailable until it is fixed; the rest of the game can be played without it.

## How to run

```bash
git clone https://github.com/jeremy341/Poorup.git
cd Poorup
npm install
npm start
```

Then open `http://localhost:8080` in your browser (two tabs for a local multiplayer test). A full game needs at least two players; the host starts from the lobby once seats are filled.

For how contributions flow (branches, PRs, CI, reviews), see [docs/DEVELOPMENT_WORKFLOW.md](docs/DEVELOPMENT_WORKFLOW.md).

Read the complete rules in the in-game **Rules** surface. Poorup uses Node.js,
Express, Socket.IO, and a vanilla HTML/CSS/JavaScript client.

## How to play

Guest play requires no account. Roll, resolve the landed space, and complete any
required purchase, auction, card, or payment before ending your turn. Build
evenly across a color group, and use trades or mortgages to manage cash.

See [Privacy & Account Data](/privacy) for account, retention, export, and
deletion details.

Players have unlimited turn time. A separate inactivity-removal clock and
vote-kick flow operate during a game.

MIT License

Copyright (c) 2026 jeremy341

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
