# Poorup

Poorup is a multiplayer board game inspired by Monopoly, playable entirely in the browser with no downloads or accounts required. Players join a shared room using a room code, buy and trade properties, build houses and hotels, and try to bankrupt each other. The game runs in real time using WebSockets.

I built this project to get hands-on experience with real-time web development, server-side game logic, and managing shared state across multiple clients. I also wanted something I could actually play with friends online well even though Richup.io is still the better alternative.

## Overview

- Real-time multiplayer using Socket.IO
- Custom game board with properties, airports, tax squares, and surprise cards
- Full Monopoly-style rules: buying, renting, building, mortgaging, trading, and going to prison
- Auction system for declined properties
- Room-based lobby with host controls and configurable game settings
- Reconnect support — disconnected players can rejoin and resume their turn
- Runs on a plain Node.js server with no database

## How to run

```bash
npm install
npm start
```

Then open `http://localhost:8080` in your browser.

**Live demo:** https://poorup.jeremy-d.hackclub.app/

For Instructions see [Instructions.md](Instructions.md).

| Layer | Technology |
|---|---|
| Server | Node.js, Express |
| Real-time | Socket.IO |
| Frontend | Vanilla HTML, CSS, JavaScript |
| State | In-memory game state managed server-side |

## Project structure

```
server/
  server.js       — Socket.IO event handlers, room lifecycle, disconnect logic
  gameLogic.js    — Game state, rules engine, player actions

public/
  index.html      — Single-page app shell
  style.css       — All styling
  gameClient.js   — Client-side socket logic and UI rendering
```

## Game settings

The host can configure the following before starting:

- Starting cash amount
- Double rent when owning a full color set
- Vacation cash (fines and bank payments accumulate on Vacation)
- Auction for declined properties
- Even build rule (houses must be built evenly across a color set)
- Mortgage toggle

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
