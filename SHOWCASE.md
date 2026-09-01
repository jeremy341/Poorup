# Poorup

Poorup is a real-time multiplayer board game inspired by Monopoly, playable entirely in the browser — no downloads, no accounts. Players join a shared room with a code, buy properties, build houses and hotels, trade with each other, and try to bankrupt everyone else. Everything runs live over WebSockets.

🌐 **Live demo:** [poorup.onrender.com](https://poorup.onrender.com)
🖥️ **Also runs locally** — see instructions below.

---

## What did I make?

A full multiplayer board game running on a Node.js server with Socket.IO for real-time communication. The client is pure HTML, CSS, and JavaScript — no frameworks. The server is the single source of truth for all game state; the client only renders what the server tells it.

Features include:

- Room-based lobbies with a shareable room code
- Full Monopoly-style rules: buying, renting, building houses and hotels, mortgaging, and trading
- Live auctions with a countdown timer when a property is declined
- Configurable game rules per room (double rent, vacation cash, even build, auction, mortgage, randomized turn order, no rent in jail)
- Reconnect support — if you disconnect mid-turn, you can rejoin and resume
- In-game chat
- Automatic room cleanup when everyone leaves

---

## What was challenging?

**Shared mutable state across multiple clients.** Every player action — rolling dice, buying a property, placing a bid — has to be validated server-side, broadcast to everyone, and reflected correctly on each client without race conditions or desync. Getting that right, especially during edge cases, took a lot of iteration.

**Edge cases in disconnects.** A player disconnecting mid-auction is a different problem than disconnecting on their turn, which is different from the host disconnecting entirely. Each case needed its own handling: timers need to be cleared, pending actions need to be resolved, and remaining players need to stay in a valid game state.

**Auctions.** The real-time countdown that all players see simultaneously, stays in sync, and correctly handles bids arriving close to the deadline was probably the trickiest single feature to get feeling right.

**Building a complete game UI with vanilla CSS.** No component library, no utility framework — every modal, toggle, property card, and animation is hand-written. Honestly needed a lot of AI help here.

---

## What am I proud of?

The architecture. The game logic lives entirely in `gameLogic.js` and has no knowledge of sockets or HTTP. The server in `server.js` wires events to logic calls and broadcasts the results. That separation made the codebase much easier to reason about and debug than it would have been otherwise.

Also proud of the reconnect system. Most quick multiplayer prototypes just boot you if you disconnect. Poorup tracks your player ID server-side and lets you pick back up where you left off, which makes the game actually playable over real network conditions.

---

## How to test it

### Option 1 — Play online (Render)

Go to **[poorup.onrender.com](https://poorup.onrender.com)**.

> ⚠️ Render's free tier spins down after inactivity. The first load may take ~30 seconds to wake up.

To test multiplayer: open two browser tabs (or share the link with a friend), enter different nicknames, and have one player create a room while the other joins with the room code.

### Option 2 — Run locally

```bash
git clone https://github.com/jeremy341/Poorup.git
cd Poorup
npm install
npm start
```

Then open [http://localhost:8080](http://localhost:8080) in two separate tabs or browser windows.

To simulate a full game you only need two players. The host can start the game from the lobby once at least two players have joined.
