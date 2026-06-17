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

## Tech stack

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
