import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

globalThis.window = { matchMedia: () => ({ matches: false }) };
globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };

const { applyServerState, isStartedTransition, serverPlayerView, syncActionLockFromSnapshot, syncRoom } = await import("./clientStateSync.js");
const { state } = await import("./clientState.js");

assert.equal(isStartedTransition({ started: true, roundNumber: 1 }, { gameStarted: false, phase: "lobby" }), true);
assert.equal(isStartedTransition({ started: true, roundNumber: 1 }, { gameStarted: true, phase: "lobby" }), true);
assert.equal(isStartedTransition({ started: true, roundNumber: 1 }, { gameStarted: true, phase: "playing" }), false);
assert.equal(isStartedTransition({ started: false, roundNumber: 1 }, { gameStarted: true, phase: "playing" }), false);

const inactiveView = serverPlayerView({
  id: "remote-1",
  nickname: "JUNO",
  presence: { state: "inactive", inactiveSince: 10_000, inactiveUntil: 190_000, reason: "hidden", accountId: "private-account" },
});
assert.deepEqual(inactiveView.presence, { state: "inactive", inactiveSince: 10_000, inactiveUntil: 190_000 });
const defaultPresenceView = serverPlayerView({ id: "remote-2", nickname: "PIP" });
assert.deepEqual(defaultPresenceView.presence, { state: "active", inactiveSince: null, inactiveUntil: null });
const botPresenceView = serverPlayerView({ id: "bot-1", isBot: true, presence: { state: "inactive", inactiveSince: 1, inactiveUntil: 2 } });
assert.equal(botPresenceView.presence, null);

syncRoom({ voteKick: {
  voteId: "vote-1",
  targetPlayerId: "seat-target",
  openedAt: 10_000,
  expiresAt: 40_000,
  eligibleCount: 2,
  yesCount: 1,
  noCount: 0,
  requiredYes: 2,
  status: "open",
  electorate: ["seat-one", "seat-two"],
  ballots: { "seat-one": "yes" },
  accountId: "private-account",
}});
assert.deepEqual(state.voteKick, {
  voteId: "vote-1",
  targetPlayerId: "seat-target",
  openedAt: 10_000,
  expiresAt: 40_000,
  eligibleCount: 2,
  yesCount: 1,
  noCount: 0,
  requiredYes: 2,
  status: "open",
});
syncRoom({ voteKick: null });
assert.equal(state.voteKick, null);

state.busy = true;
state.rolling = true;
state.pendingAction = { kind: "roll", requestId: "test-roll" };
syncActionLockFromSnapshot();
assert.equal(state.busy, true);
assert.equal(state.rolling, true);
state.pendingAction = null;
syncActionLockFromSnapshot();
assert.equal(state.busy, false);
assert.equal(state.rolling, false);

globalThis.requestAnimationFrame = callback => callback();
state.clientId = "local-client";
state.phase = "playing";
state.gameStarted = true;
state.boardVariant = "standard-40";
state.previousTurnKey = "";
state.lastTurnDeadline = 0;
state.pendingAction = null;
state.players = [{ id: "p1", serverId: "server-player", clientId: "local-client", pos: 0 }];
const walkResolvers = [];
let choiceModalOpens = 0;
let auctionSurfaceOpens = 0;
let cardRevealOpens = 0;
let bankruptcyModalOpens = 0;
const host = {
  setConnectionStatus() {},
  gameViewVisible: () => true,
  showView() {},
  renderAll() {},
  startPieceWalk: () => new Promise(resolve => walkResolvers.push(resolve)),
  openAuctionSurface: () => { auctionSurfaceOpens += 1; },
  closeAuctionSurface() {},
  retireButton: () => null,
  bankruptcyHidden: () => true,
  hideBankruptcyModal() {},
  openBankruptcyModal() { bankruptcyModalOpens += 1; },
  showGameOver() {},
  startTurnCountdown() {},
  placePiecesSoon() {}
};
const landingSnapshot = {
  room: { roomCode: "LAND1", visibility: "private", settings: { boardVariant: "standard-40" } },
  game: {
    started: true,
    currentPlayerId: "server-player",
    roundNumber: 1,
    hasRolled: true,
    awaitingEndTurn: true,
    lastDice: [6, 6],
    turnOrder: ["server-player"],
    players: [{ id: "server-player", clientId: "local-client", nickname: "LOCAL", color: "#cfa75f", position: 12 }],
    tiles: [],
    feed: [],
    pendingPurchaseOffer: { playerId: "server-player", tileIndex: 12, price: 200 },
    pendingPayment: null
  }
};
applyServerState(landingSnapshot, host);
assert.equal(walkResolvers.length, 1, "the landing snapshot schedules the pawn movement");
const listeners = new Map();
const fakeSocket = { on: (event, handler) => listeners.set(event, handler) };
const { configureSocketListeners } = await import("./clientSocketListeners.js");
const { TILES } = await import("./clientBoardData.js");
configureSocketListeners(fakeSocket, {
  openChoiceModal: () => { choiceModalOpens += 1; },
  openCardReveal: () => { cardRevealOpens += 1; }
});
listeners.get("purchase-offer")({ tileIndex: 12, name: "BOARDWALK", price: 200, canAfford: true });
assert.equal(choiceModalOpens, 0, "purchase UI stays hidden until the pawn reaches the landing tile");
walkResolvers.shift()();
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(choiceModalOpens, 1, "the current purchase prompt opens after movement completes");

const auctionSnapshot = {
  ...landingSnapshot,
  game: {
    ...landingSnapshot.game,
    players: [{ ...landingSnapshot.game.players[0], position: 15 }],
    pendingPurchaseOffer: null,
    auction: { active: true, tileIndex: 15, highestBid: 0, highestBidderId: null, endsAt: Date.now() + 5000, passedPlayerIds: [] }
  }
};
applyServerState(auctionSnapshot, host);
assert.equal(auctionSurfaceOpens, 1, "automatic auctions stay visible because their server countdown begins at landing");
const revealTile = TILES.find(tile => tile.kind === "chance" || tile.kind === "chest");
listeners.get("card-reveal")({ tileIndex: revealTile.i, text: "A movement card resolved." });
assert.equal(cardRevealOpens, 0, "card-reveal UI stays hidden until the pawn reaches the landing tile");
walkResolvers.shift()();
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(auctionSurfaceOpens, 1, "the automatic auction remains open while the pawn animation completes");
assert.equal(cardRevealOpens, 1, "the card reveal opens after movement completes");

const debtSnapshot = {
  ...landingSnapshot,
  game: {
    ...landingSnapshot.game,
    players: [{ ...landingSnapshot.game.players[0], position: 18 }],
    pendingPurchaseOffer: null,
    pendingPayment: { playerId: "server-player", amountRemaining: 50, creditorId: null, reason: "Rent is due." }
  }
};
applyServerState(debtSnapshot, host);
assert.equal(bankruptcyModalOpens, 0, "the debt prompt waits for the pawn to finish its landing movement");
walkResolvers.shift()();
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(bankruptcyModalOpens, 1, "the debt prompt opens after movement completes");

console.log("client state sync and landing-prompt tests: passed");
const syncSource = readFileSync(new URL("./clientStateSync.js", import.meta.url), "utf8");
assert.doesNotMatch(syncSource, /state\.turnDeadline\s*=/);
assert.doesNotMatch(syncSource, /maybeStartCountdown|startTurnCountdown/);

console.log("client state sync, rematch transition, and landing-prompt tests: passed");
