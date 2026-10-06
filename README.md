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

- Standard-40 and Metro-52 boards; buying, renting, building, mortgages, auctions, and trading
- Guest rooms with reconnect support and server-authoritative multiplayer state
- Deterministic NO-AI and configurable AI-advisor bot modes
- Player loans and property-equity contracts with collateral and default rules
- Optional Market, Casino, and Global Events; Market and Casino use fictional game currency
- Profiles with match history, achievements, seasons, friends, and rankings
- No database: persistent account and match records use local JSON stores

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
