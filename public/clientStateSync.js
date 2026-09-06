/* ============================================================
   SERVER STATE SYNC: the snapshot pipeline. applyServerState walks
   one server snapshot through per-section syncers in the exact order
   the original monolith ran them. Anything that renders, queries the
   DOM, or owns timers lives behind `host` callbacks in main.js.
   ============================================================ */
import { state } from "./clientState.js";
import { TILE_COUNT } from "./clientBoardData.js";

export const AUCTION_MS = 5000;

function serverNow() {
  return Date.now() + (state.serverTimeOffset || 0);
}

function num(value) {
  return Number(value) || 0;
}

function orNum(value, fallbackValue) {
  const numeric = Number(value);
  if (numeric) return numeric;
  return fallbackValue;
}

function orDefault(value, fallbackValue) {
  if (value) return value;
  return fallbackValue;
}

function nullish(value, fallbackValue) {
  return value ?? fallbackValue;
}

function arrayOr(value) {
  if (Array.isArray(value)) return value;
  return [];
}

function gridOrNull(grid) {
  if (Array.isArray(grid)) return grid;
  return null;
}

function clientPlayerId(player) {
  if (player.clientId === state.clientId) return "p1";
  return player.id;
}

function findLocalPlayerId(serverId) {
  const player = state.players.find((candidate) => candidate.serverId === serverId);
  if (player) return player.id;
  return null;
}

function localServerId() {
  return state.players[0]?.serverId;
}

function syncClock(snapshot) {
  const serverTime = Number(snapshot.serverTime);
  if (Number.isFinite(serverTime) && serverTime > 0) state.serverTimeOffset = serverTime - Date.now();
}

function previousPositionsOf() {
  return new Map(state.players.map((player) => [player.id, num(player.pos)]));
}

function visibilityOf(room) {
  if (room.visibility === "public") return "public";
  return "private";
}

function syncRoom(room) {
  if (Object.prototype.hasOwnProperty.call(room, "roomCode")) state.roomCode = orDefault(room.roomCode, "");
  state.roomVisibility = orDefault(room.visibility === "public" ? "public" : null, "private");
  state.hostId = room.hostId || null;
}

function syncServerTiles(game) {
  state.serverTiles = arrayOr(game.tiles);
}

function remotePlayersOf(game, room) {
  if (Array.isArray(game.players)) return game.players;
  return room.players || [];
}

function turnOrderOf(game, remotePlayers) {
  const declared = arrayOr(game.turnOrder);
  if (declared.length) return declared;
  return remotePlayers.map((player) => player.id);
}

function serverPlayerView(player) {
  return {
    id: clientPlayerId(player),
    serverId: player.id,
    clientId: player.clientId,
    accountId: orNull(player.accountId),
    name: String(orDefault(player.nickname, "PLAYER")).toUpperCase(),
    color: orDefault(player.color, "#cfa75f"),
    textColor: orDefault(player.color, "#e8d3ab"),
    cash: num(player.cash),
    pos: num(player.position),
    online: !player.disconnected,
    bankrupt: Boolean(player.bankrupt),
    inDebt: Boolean(player.inDebt),
    bot: Boolean(player.isBot),
    jailFree: num(player.jailFreeCards),
    bankLoan: orNull(player.bankLoan),
    bankLoanOffer: orNull(player.bankLoanOffer),
    casinoNet: num(player.casinoNet),
    marketPositions: orDefault(player.marketPositions, {}),
    isHost: Boolean(player.isHost),
    avatarGrid: gridOrNull(player.avatarGrid),
    personality: orNull(player.personality),
  };
}

function orNull(value) {
  return value || null;
}

function byLocalThenTurnOrder(a, b, turnOrder) {
  if (a.clientId === state.clientId) return -1;
  if (b.clientId === state.clientId) return 1;
  return turnOrder.indexOf(a.serverId) - turnOrder.indexOf(b.serverId);
}

function syncPlayers(remotePlayers, turnOrder) {
  const views = remotePlayers.map(serverPlayerView);
  views.sort((a, b) => byLocalThenTurnOrder(a, b, turnOrder));
  state.players = views;
}

function syncTurnPointer(game) {
  state.turnIndex = Math.max(0, state.players.findIndex((player) => player.serverId === game.currentPlayerId));
}

function syncRoundFlags(game) {
  state.dice = diceOf(game);
  state.roundNumber = num(game.roundNumber);
  state.globalEvent = orNull(game.globalEvent);
  state.playerContracts = orDefault(game.playerContracts, { pending: null, active: [] });
}

function diceOf(game) {
  if (Array.isArray(game.lastDice)) return game.lastDice;
  return [0, 0];
}

function syncContractOffer() {
  const pending = state.playerContracts.pending;
  if (!pending) {
    state.playerContractOffer = null;
    return;
  }
  if (pending.toPlayerId === localServerId()) {
    state.playerContractOffer = pending;
    return;
  }
  state.playerContractOffer = null;
}

function syncEconomy(game) {
  const incoming = game.economy || {};
  state.economy = {
    ...state.economy,
    ...incoming,
    casino: { ...state.economy.casino, ...(incoming.casino || {}) },
    market: { ...state.economy.market, ...(incoming.market || {}) },
  };
}

function assignOwner(tile) {
  if (!tile.ownerId) return;
  const owner = state.players.find((player) => player.serverId === tile.ownerId);
  if (owner) state.owners[tile.index] = owner.id;
}

function syncDeedLayers() {
  state.houses = Object.fromEntries(state.serverTiles.map((tile) => [tile.index, num(tile.houseCount)]));
  state.mortgaged = Object.fromEntries(state.serverTiles.filter((tile) => tile.mortgaged).map((tile) => [tile.index, true]));
  state.owners = {};
  state.serverTiles.forEach(assignOwner);
}

function syncJail(remotePlayers) {
  const rows = remotePlayers.filter((player) => player.inJail).map((player) => [clientPlayerId(player), orNum(player.jailTurns, 1)]);
  state.jail = Object.fromEntries(rows);
}

function phaseOf(game) {
  if (game.started) return "playing";
  if (state.phase === "setup") return "setup";
  return "lobby";
}

function wrapsWithinTwelve(from, to) {
  return (to - from + TILE_COUNT) % TILE_COUNT <= 12;
}

function movementPlanFor(player, previousPositions) {
  const plan = { player, from: previousPositions.get(player.id), to: num(player.pos) };
  if (plan.from == null) return null;
  if (plan.from === plan.to) return null;
  if (!wrapsWithinTwelve(plan.from, plan.to)) return null;
  return plan;
}

function movementPlansFrom(previousPositions) {
  if (state.phase !== "playing") return [];
  return state.players
    .map((player) => movementPlanFor(player, previousPositions))
    .filter((plan) => plan);
}

function rollFlag(game) {
  if (game.hasRolled) return "rolled";
  return "roll";
}

function extraFlag(game) {
  if (game.extraRollPending) return "extra";
  return "normal";
}

function turnKeyOf(game) {
  const mover = orDefault(game.currentPlayerId, "none");
  return `${mover}:${rollFlag(game)}:${extraFlag(game)}`;
}

function turnStageOf(game) {
  if (game.awaitingEndTurn) return "end";
  if (game.hasRolled && !game.extraRollPending) return "end";
  return "roll";
}

function feedLine(entry) {
  if (typeof entry === "string") return entry;
  return entry.text;
}

function syncLog(game) {
  state.log = arrayOr(game.feed).map(feedLine).filter(Boolean).slice(0, 40);
}

function syncRoomSettings(room) {
  const incoming = room.settings || {};
  state.settings = {
    ...state.settings,
    ...incoming,
    vacationPool: nullish(incoming.vacationCash, state.settings.vacationPool),
    noRentInJail: nullish(incoming.noRentWhileInPrison, state.settings.noRentInJail),
  };
}

function passedEntry(serverId) {
  return [findLocalPlayerId(serverId), true];
}

function passedEntries(passedPlayerIds) {
  return arrayOr(passedPlayerIds).map(passedEntry).filter(([id]) => id);
}

function auctionView(auction) {
  return {
    tileIndex: Number(auction.tileIndex),
    bid: num(auction.highestBid),
    leaderId: findLocalPlayerId(auction.highestBidderId),
    deadline: orNum(auction.endsAt, serverNow() + AUCTION_MS),
    caps: {},
    passed: Object.fromEntries(passedEntries(auction.passedPlayerIds)),
  };
}

function syncAuction(game) {
  if (!game.auction) {
    state.auction = null;
    return;
  }
  state.auction = auctionView(game.auction);
}

function syncView(host) {
  if (state.phase === "home") return;
  if (!host.gameViewVisible()) return;
  host.showView("game");
}

function scheduleWalks(movementPlans, host) {
  if (!movementPlans.length) return;
  const plans = movementPlans;
  requestAnimationFrame(() => plans.forEach(({ player, from, to }) => host.startPieceWalk(player.id, from, to)));
}

function syncAuctionSurface(host) {
  if (state.auction) {
    host.openAuctionSurface();
    return;
  }
  host.closeAuctionSurface();
}

function retireAllowed() {
  if (state.phase !== "playing") return false;
  const me = state.players[0];
  if (!me) return false;
  if (me.bankrupt) return false;
  if (me.inDebt) return false;
  return me.online !== false;
}

function syncRetireButton(host) {
  const retireBtn = host.retireButton();
  if (!retireBtn) return;
  retireBtn.disabled = !retireAllowed();
}

function syncDebtModal(game, host) {
  const debt = game.pendingPayment;
  state.pendingDebt = debt || null;
  syncRetireButton(host);
  if (!debt) {
    host.hideBankruptcyModal();
    return;
  }
  const meServerId = localServerId();
  if (debt.playerId !== meServerId) return;
  if (!host.bankruptcyHidden()) return;
  const meIndex = state.players.findIndex((player) => player.serverId === meServerId);
  if (meIndex < 0) return;
  host.openBankruptcyModal(meIndex, num(debt.amountRemaining), debt.creditorId, orDefault(debt.reason, "This payment is due."));
}

function syncWinner(game, host) {
  if (!game.lastWinner) return;
  if (state.gameOver) return;
  host.showGameOver(orDefault(game.lastWinner.nickname, "The winner"), game.lastWinner.id);
}

function maybeStartCountdown(turnChanged, host) {
  if (!turnChanged) return;
  if (state.phase !== "playing") return;
  if (state.turnIndex !== 0) return;
  host.startTurnCountdown();
}

function snapshotIsPlayable(snapshot) {
  if (!snapshot) return false;
  if (!snapshot.room) return false;
  return Boolean(snapshot.game);
}

export function applyServerState(snapshot, host) {
  if (!snapshotIsPlayable(snapshot)) return;
  syncClock(snapshot);
  if (state.suppressRoomUpdates) return;
  const previousPositions = previousPositionsOf();
  host.setConnectionStatus("online");
  const { room, game } = snapshot;
  syncRoom(room);
  syncServerTiles(game);
  const remotePlayers = remotePlayersOf(game, room);
  const turnOrder = turnOrderOf(game, remotePlayers);
  syncPlayers(remotePlayers, turnOrder);
  syncTurnPointer(game);
  syncRoundFlags(game);
  syncContractOffer();
  syncEconomy(game);
  state.pool = num(game.vacationPool);
  syncDeedLayers();
  syncJail(remotePlayers);
  state.phase = phaseOf(game);
  const movementPlans = movementPlansFrom(previousPositions);
  const turnKey = turnKeyOf(game);
  const turnChanged = state.previousTurnKey !== turnKey;
  state.previousTurnKey = turnKey;
  state.turnStage = turnStageOf(game);
  state.busy = false;
  state.rolling = false;
  syncLog(game);
  syncRoomSettings(room);
  state.pendingBuyTile = nullish(game.pendingPurchaseOffer?.tileIndex, null);
  syncAuction(game);
  // Snapshots update data unconditionally but must not hijack the page —
  // only re-assert the game view while the player is mid-room-session and
  // the parlor is the surface actually on screen (A4-F1).
  syncView(host);
  host.renderAll();
  scheduleWalks(movementPlans, host);
  syncAuctionSurface(host);
  syncDebtModal(game, host);
  syncWinner(game, host);
  maybeStartCountdown(turnChanged, host);
  host.placePiecesSoon();
}
