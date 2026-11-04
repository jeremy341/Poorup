import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

globalThis.window = { matchMedia: () => ({ matches: false }) };
globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };

const { applyServerState, isStartedTransition, markContractOfferAnnounced, serverPlayerView, snoozeAuctionSurface, syncActionLockFromSnapshot, syncRoom } = await import("./clientStateSync.js");
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
assert.equal(serverPlayerView({ id: "final-seat", finalNetWorth: 2450 }).finalNetWorth, 2450,
  "the final result score survives the server-to-client player projection");
assert.equal(serverPlayerView({ id: "live-seat", finalNetWorth: null }).finalNetWorth, null,
  "in-progress snapshots do not invent a final score");

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
  summary: "",
});
syncRoom({ voteKick: { voteId: "vote-2", targetPlayerId: "seat-target", status: "closed", summary: "Juno left; vote closed." } });
assert.equal(state.voteKick?.status, "closed", "a closed vote is kept, not dropped as unknown");
assert.equal(state.voteKick.summary, "Juno left; vote closed.");
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

// The client auction view is truthful about being live, so the close
// confirmation and the beforeunload guard (which read `.active`) work.
const liveAuction = (startedAt, endsAt) => ({
  ...auctionSnapshot,
  game: { ...auctionSnapshot.game, auction: { ...auctionSnapshot.game.auction, startedAt, endsAt } },
});
applyServerState(liveAuction(1000, Date.now() + 5000), host);
assert.equal(state.auction.active, true, "a snapshot auction is marked active on the client view");
assert.equal(typeof state.auction.id, "string", "the client auction view carries a stable id");
applyServerState({ ...auctionSnapshot, game: { ...auctionSnapshot.game, auction: { ...auctionSnapshot.game.auction, active: false } } }, host);
assert.equal(state.auction.active, false, "a finished auction is not reported as live");

// The dismissal snooze is keyed to the auction id, not a timer.
applyServerState(liveAuction(1000, Date.now() + 5000), host);
snoozeAuctionSurface();
const opensAtSnooze = auctionSurfaceOpens;
const realNow = Date.now;
Date.now = () => realNow() + 20_000; // bidding keeps going well past the 8 s window
applyServerState(liveAuction(1000, Date.now() + 5000), host);
assert.equal(auctionSurfaceOpens, opensAtSnooze, "a dismissed auction is not reopened (no focus steal) while it is still the same auction");
applyServerState(liveAuction(2000, Date.now() + 5000), host);
assert.equal(auctionSurfaceOpens, opensAtSnooze + 1, "a new auction on the same tile breaks through the snooze");
Date.now = realNow;

// An offer created by a bot sends no socket event, so the snapshot must
// raise one polite notice (and only one) for a contract waiting on the local seat.
{
  const contractNotices = [];
  const noticeHost = { ...host, noticeContractOffer: (offer, name) => contractNotices.push({ id: offer.id, name }) };
  const contractGame = pending => ({
    ...landingSnapshot.game,
    pendingPurchaseOffer: null,
    turnOrder: ["server-player", "bot-9"],
    players: [
      { id: "server-player", clientId: "local-client", nickname: "LOCAL", color: "#cfa75f", position: 12 },
      { id: "bot-9", nickname: "BOTTY", isBot: true, color: "#8aa", position: 3 },
    ],
    playerContracts: { pending, active: [] },
  });
  const offer = { id: "contract-1", fromPlayerId: "bot-9", toPlayerId: "server-player", counterDepth: 0, kind: "loan" };
  const contractSnapshot = pending => ({ room: { ...landingSnapshot.room, roomCode: "CTR1" }, game: contractGame(pending) });
  applyServerState(contractSnapshot(null), noticeHost);
  applyServerState(contractSnapshot(offer), noticeHost);
  applyServerState(contractSnapshot(offer), noticeHost);
  assert.deepEqual(contractNotices, [{ id: "contract-1", name: "BOTTY" }], "one notice per incoming offer");
  applyServerState(contractSnapshot({ ...offer, counterDepth: 1 }), noticeHost);
  assert.equal(contractNotices.length, 1, "an offer we sent back is not an incoming notice");
  applyServerState(contractSnapshot({ ...offer, counterDepth: 2 }), noticeHost);
  assert.equal(contractNotices.length, 2, "a counter that returns to us is announced again");
  markContractOfferAnnounced({ ...offer, id: "contract-2", counterDepth: 0 });
  applyServerState(contractSnapshot({ ...offer, id: "contract-2" }), noticeHost);
  assert.equal(contractNotices.length, 2, "an offer already announced by the socket event stays quiet");
}

console.log("client state sync and landing-prompt tests: passed");
const syncSource = readFileSync(new URL("./clientStateSync.js", import.meta.url), "utf8");
assert.doesNotMatch(syncSource, /state\.turnDeadline\s*=/);
assert.doesNotMatch(syncSource, /maybeStartCountdown|startTurnCountdown/);

const projectedTrade = { enabled: true, reason: null };
applyServerState({
  room: { ...landingSnapshot.room, roomCode: "SALE1" },
  game: {
    ...landingSnapshot.game,
    players: [{ ...landingSnapshot.game.players[0], position: 0 }],
    tiles: [{ index: 1, name: "BOARDWALK", type: "property", ownerId: "server-player", price: 60, houseCount: 0, mortgaged: false, propertyActions: { tradeDeed: projectedTrade } }],
  },
}, host);
assert.deepEqual(state.serverTiles[0].propertyActions.tradeDeed, projectedTrade, "viewer-scoped trade eligibility survives the client snapshot sync unchanged");
const { tradeDeedActionHTML } = await import("./clientDeedDetailUi.js");
assert.match(tradeDeedActionHTML({ mine: true, action: state.serverTiles[0].propertyActions.tradeDeed }), />SELL DEED</,
  "deed manager renders a trade action from the synchronized authoritative projection");

console.log("client state sync, rematch transition, and landing-prompt tests: passed");

// Cached or older server data cannot reintroduce the retired supply settings.
const legacySupplySnapshot = {
  room: {
    ...landingSnapshot.room,
    settings: { houseLimit: 1, hotelLimit: 0, startingCash: 2500 },
    ruleset: {
      boardVariant: 'standard-40',
      effectiveSettings: { houseLimit: 2, hotelLimit: 1, startingCash: 2500 },
      overrides: [{ key: 'houseLimit', value: 2 }, { key: 'hotelLimit', value: 1 }, { key: 'startingCash', value: 2500 }],
    },
  },
  game: landingSnapshot.game,
};
state.settings.houseLimit = 1;
state.settings.hotelLimit = 0;
applyServerState(legacySupplySnapshot, host);
assert.equal(Object.hasOwn(state.settings, 'houseLimit'), false);
assert.equal(Object.hasOwn(state.settings, 'hotelLimit'), false);
assert.equal(state.settings.startingCash, 2500);
assert.deepEqual(state.settings.rulesetOverrides, [{ key: 'startingCash', value: 2500 }]);
assert.equal(Object.hasOwn(state.ruleset.effectiveSettings, 'houseLimit'), false);
assert.deepEqual(state.ruleset.overrides, [{ key: 'startingCash', value: 2500 }]);
assert.equal(legacySupplySnapshot.room.ruleset.overrides.length, 3, 'normalization does not mutate the incoming record');
legacySupplySnapshot.room.ruleset.overrides = { houseLimit: 0, hotelLimit: 'unlimited', evenBuild: false };
legacySupplySnapshot.room.ruleset.effectiveSettings.evenBuild = false;
applyServerState(legacySupplySnapshot, host);
assert.deepEqual(state.ruleset.overrides, [{ key: 'evenBuild', value: false }]);
assert.deepEqual(state.settings.rulesetOverrides, [{ key: 'evenBuild', value: false }]);
assert.equal(state.settings.evenBuild, false);
assert.equal(Object.hasOwn(legacySupplySnapshot.room.ruleset.overrides, 'houseLimit'), true);

applyServerState({
  room: { ...landingSnapshot.room, settings: { rulesProfile: "advanced", playerFinance: true, casino: true }, ruleset: { effectiveSettings: { rulesProfile: "standard", playerFinance: false, casino: false } } },
  game: landingSnapshot.game,
}, host);
assert.equal(state.settings.rulesProfile, "standard", "server effective profile overrides the configured profile");
assert.equal(state.settings.playerFinance, false, "server effective finance flag wins over an optimistic/configured flag");
assert.equal(state.settings.casino, false);
console.log("PASS effective rules profile and module settings own the client snapshot");
