# Poorup

Poorup is a multiplayer board game inspired by Monopoly, playable entirely in the browser with no downloads; accounts remain optional, so no account is required to join a room. Players join a shared room using a room code, buy and trade properties, build houses and hotels, and try to bankrupt each other. The game runs in real time using WebSockets.

I built this project to get hands-on experience with real-time web development, server-side game logic and managing shared state across multiple clients.

From an engineering perspective, Poorup is a real-time multiplayer systems project: the game rules, room state, reconnect flow and persistence boundaries are handled on the server.

**Live demo:** https://poorup.jeremy-d.hackclub.app/

To test multiplayer: open two browser tabs (or share the link with a friend), enter different nicknames, and have one player create a room while the other joins with the room code.

## Overview

- Real-time multiplayer using Socket.IO
- Standard-40 and Metro-52 board variants with properties, airports, tax squares, and surprise cards
- Full Monopoly-style rules: buying, renting, building, mortgaging, trading, and going to prison
- Host-selectable Classic, After Hours, and Custom rulesets
- Optional server-settled Casino and fictional Market add-ons
- Server-backed friends, recent players, match history, achievements, seasons, and multi-scope rankings
- Rare round-scaled Global Events with curated combinations
- Server-controlled deterministic CPU seats (bots) with selectable personalities
- Player-to-player loan and property-equity contracts with collateral, repayment, and default rules
- Auction system for declined properties
- Room-based lobby with host controls and configurable game settings
- Reconnect support — disconnected players can rejoin and resume their turn
- In-game chat and automatic room cleanup when everyone leaves
- Optional Profile account rights: owner-safe export, verified recovery email,
  session revocation, and a 30-day deletion grace period
- Runs on a plain Node.js server with no database

## How to run

```bash
git clone https://github.com/jeremy341/Poorup.git
cd Poorup
npm install
npm start
```

Then open `http://localhost:8080` in your browser (two tabs for a local multiplayer test). A full game needs at least two players; the host starts from the lobby once seats are filled.

For how contributions flow (branches, PRs, CI, reviews), see [docs/DEVELOPMENT_WORKFLOW.md](docs/DEVELOPMENT_WORKFLOW.md).

For the current source-backed status of live, completed, planned, deferred, and
reference surfaces, see [docs/feature-status.json](docs/feature-status.json).

Full gameplay rules live in the in-game **Rules** surface. Quick guide:

| Layer | Technology |
|---|---|
| Server | Node.js, Express |
| Real-time | Socket.IO |
| Frontend | Vanilla HTML, CSS, JavaScript |
| State | In-memory game state managed server-side |

## How to play

Guest play is the default: no account is required to create or join a room.
Optional accounts add a durable identity and server-backed history.

**Goal:** bankrupt the other players by buying properties, charging rent, trading smartly, and managing cash.

**A turn:** roll → move → resolve the space (buy, rent, tax, cards, jail, or other specials) → end turn when every required decision is complete.

**Properties and rent:** owning a full color set strengthens the group; houses and hotels raise rent; mortgaged deeds collect no normal rent until redeemed.

**Trading:** trades can include cash and properties; both players must agree.

**Jail:** roll doubles, pay the fine, or wait out turns when the rules allow.

**Bankruptcy:** low cash is not elimination — mortgage, sell, trade, or declare bankruptcy only when no legal rescue remains.

**Optional systems:** auctions; contracts (player loans and property-equity); Casino and Market (fictional currency, staged complexity); Global Events; bots; social and seasons (friends, match history, achievements, cosmetics, rankings, seasonal rewards where available).

**Setup:** the host configures board variant (Standard-40 up to four seats, Metro-52 up to six), ruleset preset (`CLASSIC`, `AFTER HOURS`, or `CUSTOM`), starting cash, turn timer, CPU seats, auctions, mortgage rules, and other house rules before the round starts.

## Project structure

```
server/
  server.js       — HTTP/Socket.IO wiring and route policy
  rooms.js        — Room lifecycle, seats, settings, and projections
  gameLogic.js    — Authoritative game state and player actions
  *Api.js/modules — Focused market, contract, season, social, and maintenance seams
  sessionStore.js   — server-side cookie sessions and expiry policy
  accountRecovery.js / accountDeletion.js — recovery and deletion lifecycle

public/
  index.html      — Single-page app shell
  styles.css      — Supplied pixel-parlor design system and responsive layout
  main.js         — Client-side interactions, rendering, and Socket.IO bridge
  assets/         — Protected SVG references and local fonts
```

Account data controls live only in Profile. The factual [Privacy & Account
Data](/privacy) page describes guest play, retention, export, recovery, and
deletion behavior; no Terms-of-Service route is claimed by the app.

## Game settings

The host can configure the following before starting:

- Board variant: Standard-40 (up to four seats) or Metro-52 (up to six)
- Ruleset preset, Custom base, and resettable house-rule overrides
- Starting cash amount
- CPU seats and selectable bot personality
- Bot brain and difficulty mode
- Trading, No Rent In Jail, bankruptcy mode, and loan severity
- Double rent when owning a full color set
- Double GO payout and per-turn timer
- Vacation cash (fines and bank payments accumulate on Vacation)
- Auction for declined properties
- Even build rule (houses must be built evenly across a color set)
- Mortgage toggle
- House and hotel supply limits
- Bank loans, fictional-currency casino, market complexity, and global events

## What I learned

- How to design and manage real-time shared game state across multiple clients
- Handling edge cases in multiplayer: disconnects mid-turn, disconnects during an active auction, host leaving, reconnects
- Structuring a server-side rules engine that is the single source of truth while keeping the client purely for rendering
- Memory management on long-running Node.js servers (room garbage collection, clearing timers on disconnect)
- Building a complete UI  with vanilla CSS including responsive layouts, modals, animations, and accessibility but also need AI for help
- The importance of separating game logic from networking code to keep things testable and maintainable if not causing many bugs

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
