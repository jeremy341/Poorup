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
const difficultyOnlyBotView = serverPlayerView({ id: "bot-2", isBot: true, botBrain: "no-ai", botDifficulty: "expert", personality: "chaos" });
assert.equal(difficultyOnlyBotView.botBrain, "no-ai");
assert.equal(difficultyOnlyBotView.botDifficulty, "expert");
assert.equal("personality" in difficultyOnlyBotView, false);

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
const movementVisualTrace = [];
const activeWalks = new Set();
let renderedPlayerPosition = 0;
let choiceModalOpens = 0;
let auctionSurfaceOpens = 0;
let cardRevealOpens = 0;
let bankruptcyModalOpens = 0;
const retireLabel = { textContent: "" };
const retireButton = { disabled: true, title: "", querySelector: () => retireLabel };
const diceRollTotals = [];
const host = {
  setConnectionStatus() {},
  gameViewVisible: () => true,
  showView() {},
  renderAll() {
    if (!activeWalks.has("p1")) renderedPlayerPosition = state.players[0]?.pos ?? renderedPlayerPosition;
    movementVisualTrace.push({ phase: "render", position: renderedPlayerPosition });
  },
  startPieceWalk(playerId, from, to) {
    activeWalks.add(playerId);
    renderedPlayerPosition = from;
    movementVisualTrace.push({ phase: "walk-start", position: renderedPlayerPosition });
    return new Promise(resolve => walkResolvers.push(() => {
      activeWalks.delete(playerId);
      renderedPlayerPosition = to;
      resolve();
    }));
  },
  openAuctionSurface: () => { auctionSurfaceOpens += 1; },
  closeAuctionSurface() {},
  retireButton: () => retireButton,
  bankruptcyHidden: () => true,
  hideBankruptcyModal() {},
  openBankruptcyModal() { bankruptcyModalOpens += 1; },
  showGameOver() {},
  startTurnCountdown() {},
  placePiecesSoon() {},
  announceDiceRoll(total) { diceRollTotals.push(total); }
};
const landingSnapshot = {
  room: { roomCode: "LAND1", visibility: "private", settings: { boardVariant: "standard-40" } },
  game: {
    started: true,
    currentPlayerId: "server-player",
    roundNumber: 1,
    hasRolled: true,
    diceRollSequence: 0,
    awaitingEndTurn: true,
    lastDice: [0, 0],
    turnOrder: ["server-player"],
    players: [{ id: "server-player", clientId: "local-client", nickname: "LOCAL", color: "#cfa75f", position: 12 }],
    tiles: [],
    feed: [],
    pendingPurchaseOffer: { playerId: "server-player", tileIndex: 12, price: 200 },
    pendingPayment: null
  }
};
movementVisualTrace.length = 0;
applyServerState(landingSnapshot, host);
assert.deepEqual(movementVisualTrace, [
  { phase: "walk-start", position: 0 },
  { phase: "render", position: 0 },
], "the normal snapshot render keeps the pawn at its origin until the walk owns its position");
assert.deepEqual(diceRollTotals, [], "the first game snapshot is only a baseline");
applyServerState({
  ...landingSnapshot,
  game: { ...landingSnapshot.game, diceRollSequence: 1, lastDice: [6, 6] },
}, host);
assert.deepEqual(diceRollTotals, [12], "a new server roll sequence announces the total once");
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
await new Promise(resolve => setTimeout(resolve, 220));
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
await new Promise(resolve => setTimeout(resolve, 220));
assert.equal(auctionSurfaceOpens, 1, "the automatic auction remains open while the pawn animation completes");
assert.equal(cardRevealOpens, 1, "the card reveal opens after movement completes");

const debtSnapshot = {
  ...landingSnapshot,
  game: {
    ...landingSnapshot.game,
    players: [{ ...landingSnapshot.game.players[0], position: 18, inDebt: true }],
    pendingPurchaseOffer: null,
    pendingPayment: { playerId: "server-player", amountRemaining: 50, creditorId: null, reason: "Rent is due." }
  }
};

state.activityRoomCode = "LAND1";
state.activityNotices = [{ id: "notice-1", text: "A lifecycle notice", timestamp: 300 }];
applyServerState({
  ...debtSnapshot,
  game: { ...debtSnapshot.game, feed: ["Latest game event", "Earlier game event"] }
}, host);
assert.deepEqual(state.log.slice(0, 3), ["A lifecycle notice", "Latest game event", "Earlier game event"], "Activity combines transient notices and the latest feed newest-first");
applyServerState({ ...debtSnapshot, room: { ...debtSnapshot.room, roomCode: "LAND2" } }, host);
assert.deepEqual(state.activityNotices, [], "Activity notices are cleared when the room changes");

applyServerState(debtSnapshot, host);
assert.equal(bankruptcyModalOpens, 0, "the debt prompt waits for the pawn to finish its landing movement");
walkResolvers.shift()();
await new Promise(resolve => setTimeout(resolve, 220));
assert.equal(bankruptcyModalOpens, 1, "the debt prompt opens after movement completes");

state.debtRescueDismissed = true;
applyServerState(debtSnapshot, host);
assert.equal(bankruptcyModalOpens, 1, "snapshots leave rescue tools accessible after dismissal");
assert.equal(retireButton.disabled, false, "a debtor can return to the debt dialog after dismissing it");
assert.equal(retireLabel.textContent, "BANKRUPT");
assert.equal(retireButton.title, "Resolve bankruptcy");

const nextRollSnapshot = {
  ...debtSnapshot,
  game: { ...debtSnapshot.game, players: [{ ...debtSnapshot.game.players[0], inDebt: false }], pendingPayment: null, diceRollSequence: 2, lastDice: [4, 5] },
};
applyServerState(nextRollSnapshot, host);
applyServerState(nextRollSnapshot, host);
assert.deepEqual(diceRollTotals, [12, 9], "a new sequence announces once and a replayed snapshot stays quiet");
assert.equal(state.debtRescueDismissed, false, "settlement clears the previous debt dismissal");
assert.equal(retireLabel.textContent, "RETIRE");

console.log("client state sync and landing-prompt tests: passed");
const syncSource = readFileSync(new URL("./clientStateSync.js", import.meta.url), "utf8");
assert.doesNotMatch(syncSource, /state\.turnDeadline\s*=/);
assert.doesNotMatch(syncSource, /maybeStartCountdown|startTurnCountdown/);

console.log("client state sync, rematch transition, and landing-prompt tests: passed");
