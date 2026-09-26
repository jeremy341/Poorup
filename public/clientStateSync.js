/* ============================================================
   SERVER STATE SYNC: the snapshot pipeline. applyServerState walks
   one server snapshot through per-section syncers in the exact order
   the original monolith ran them. Anything that renders, queries the
   DOM, or owns timers lives behind `host` callbacks in main.js.
   ============================================================ */
import { state } from "./clientState.js";
import { TILE_COUNT, setBoardVariant } from "./clientBoardData.js";

export const AUCTION_MS = 5000;
let movementRevision = 0;
let movementCompletion = Promise.resolve();
let debtSurfaceRevision = 0;
let winnerSurfaceRevision = 0;

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

// Defense in depth: the server hex-normalizes avatar cells, but sprite
// fills interpolate raw — keep only #rrggbb-or-null cells on ingest so a
// compromised snapshot can never inject markup into SVG fills.
function sanitizeAvatarGrid(grid) {
  if (!Array.isArray(grid)) return null;
  const clean = grid.map(row => Array.isArray(row)
    ? row.map(cell => (typeof cell === "string" && /^#[0-9a-f]{6}$/i.test(cell) ? cell.toLowerCase() : null))
    : null);
  return clean.some(row => row === null) ? null : clean;
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

function hexColor(value, fallback) {
  return /^#[0-9a-f]{6}$/i.test(String(value)) ? String(value).toLowerCase() : fallback;
}

function localServerId() {
  // Never assume sort order: spectators, placeholders, and duplicate-tab
  // clientIds can all leave someone else at index 0.
  const self = state.players.find((candidate) => candidate.clientId === state.clientId);
  return self?.serverId || null;
}

function syncClock(snapshot) {
  const serverTime = Number(snapshot.serverTime);
  if (Number.isFinite(serverTime) && serverTime > 0) state.serverTimeOffset = serverTime - Date.now();
}

function voteKickView(vote) {
  if (!vote || typeof vote !== "object") return null;
  const status = ["open", "active", "passed", "failed", "expired"].includes(vote.status) ? vote.status : null;
  if (!status || typeof vote.voteId !== "string" || typeof vote.targetPlayerId !== "string") return null;
  const count = value => Number.isFinite(value) && value >= 0 ? Math.floor(value) : 0;
  const timestamp = value => Number.isFinite(value) && value >= 0 ? value : null;
  return {
    voteId: vote.voteId,
    targetPlayerId: vote.targetPlayerId,
    openedAt: timestamp(vote.openedAt),
    expiresAt: timestamp(vote.expiresAt),
    eligibleCount: count(vote.eligibleCount),
    yesCount: count(vote.yesCount),
    noCount: count(vote.noCount),
    requiredYes: count(vote.requiredYes),
    status,
  };
}

function previousPositionsOf() {
  return new Map(state.players.map((player) => [player.id, num(player.pos)]));
}

export function syncRoom(room, game = null) {
  const nextVariant = room?.board?.variant || room?.ruleset?.boardVariant || room?.settings?.boardVariant || game?.boardVariant || "standard-40";
  const changed = state.boardVariant !== nextVariant;
  if (Object.prototype.hasOwnProperty.call(room, "roomCode")) state.roomCode = orDefault(room.roomCode, "");
  state.roomVisibility = orDefault(room.visibility === "public" ? "public" : null, "private");
  state.hostId = room.hostId || null;
  state.boardVariant = nextVariant;
  state.ruleset = room.ruleset || null;
  state.voteKick = voteKickView(room.voteKick);
  return changed;
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

export function serverPlayerView(player) {
  return {
    id: clientPlayerId(player),
    serverId: player.id,
    clientId: player.clientId,
    accountId: orNull(player.accountId),
    accountLinked: player.accountLinked === true,
    roomPlayerId: player.roomPlayerId || player.id,
    name: String(orDefault(player.nickname, "PLAYER")).toUpperCase(),
    color: hexColor(player.color, "#cfa75f"),
    textColor: hexColor(player.textColor ?? player.color, "#e8d3ab"),
    cash: num(player.cash),
    pos: num(player.position),
    online: !player.disconnected,
    presence: player.isBot ? null : {
      state: player.presence?.state === "inactive" ? "inactive" : "active",
      inactiveSince: Number.isFinite(player.presence?.inactiveSince) ? player.presence.inactiveSince : null,
      inactiveUntil: Number.isFinite(player.presence?.inactiveUntil) ? player.presence.inactiveUntil : null,
    },
    bankrupt: Boolean(player.bankrupt),
    spectating: Boolean(player.spectating),
    inDebt: Boolean(player.inDebt),
    bot: Boolean(player.isBot),
    jailFree: num(player.jailFreeCards),
    bankLoan: orNull(player.bankLoan),
    bankLoanOffer: orNull(player.bankLoanOffer),
    bankAccountTier: Number(player.bankAccountTier) || 1,
    bankAccount: orNull(player.bankAccount),
    bankAccountUpgrade: orNull(player.bankAccountUpgrade),
    reservedCash: num(player.reservedCash),
    items: player.items && typeof player.items === "object" ? player.items : {},
    casinoNet: num(player.casinoNet),
    marketPositions: orDefault(player.marketPositions, {}),
    isHost: Boolean(player.isHost),
    avatarGrid: sanitizeAvatarGrid(player.avatarGrid),
    personality: orNull(player.personality),
    botBrain: orNull(player.botBrain),
    botDifficulty: orNull(player.botDifficulty),
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

export function isStartedTransition(game, previousState = state) {
  return Boolean(game?.started) && (!previousState.gameStarted || previousState.phase !== "playing");
}

function syncRoundFlags(game) {
  const nextRoundNumber = num(game.roundNumber);
  const nextGameStarted = Boolean(game.started);
  const startedTransition = isStartedTransition(game);
  if (nextRoundNumber !== state.roundNumber || startedTransition) {
    state.gameOver = null;
  }
  state.gameStarted = nextGameStarted;
  state.dice = diceOf(game);
  state.roundNumber = nextRoundNumber;
  state.globalEvent = orNull(game.globalEvent);
  state.playerContracts = orDefault(game.playerContracts, { pending: null, active: [] });
  state.pendingTrade = orNull(game.pendingTrade);
  const pendingTradeId = state.pendingTrade?.id || null;
  // Race grace: an offer that just arrived via socket may precede the
  // snapshot carrying it. Keep fresh arrivals 15s instead of wiping the
  // inbox (and the open modal) out from under them.
  const now = Date.now();
  state.offers = pendingTradeId
    ? (state.offers || []).filter(offer => offer?.id === pendingTradeId)
    : (state.offers || []).filter(offer => now - (Number(offer?.receivedAt) || 0) < 15000);
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
  const contractDepth = Math.max(0, Math.floor(Number(pending.counterDepth) || 0));
  const responderId = contractDepth % 2 === 0 ? pending.toPlayerId : pending.fromPlayerId;
  if (responderId === localServerId()) {
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
  const effective = room.ruleset?.effectiveSettings || {};
  state.settings = {
    ...state.settings,
    ...incoming,
    ...effective,
    vacationPool: nullish(effective.vacationCash, nullish(incoming.vacationCash, state.settings.vacationPool)),
    noRentInJail: nullish(effective.noRentWhileInPrison, nullish(incoming.noRentWhileInPrison, state.settings.noRentInJail)),
    rulesetPreset: room.ruleset?.preset || incoming.rulesetPreset || state.settings.rulesetPreset,
    rulesetBase: room.ruleset?.base || incoming.rulesetBase || state.settings.rulesetBase,
    rulesetOverrides: room.ruleset?.overrides || incoming.rulesetOverrides || state.settings.rulesetOverrides,
    boardVariant: room.ruleset?.boardVariant || incoming.boardVariant || state.settings.boardVariant,
    marketComplexity: effective.marketComplexity || incoming.marketComplexity || state.settings.marketComplexity,
  };
}

function passedEntry(serverId) {
  return [findLocalPlayerId(serverId), true];
}

function passedEntries(passedPlayerIds) {
  return arrayOr(passedPlayerIds).map(passedEntry).filter(([id]) => id);
}

function auctionView(auction) {
  const endsAt = Number(auction.endsAt);
  return {
    tileIndex: Number(auction.tileIndex),
    bid: num(auction.highestBid),
    leaderId: findLocalPlayerId(auction.highestBidderId),
    // Never fabricate a deadline: without a server endsAt the UI shows
    // SYNCING instead of counting down a phantom window.
    deadline: Number.isFinite(endsAt) && endsAt > 0 ? endsAt : null,
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

export function afterPieceMovement(callback) {
  const revision = movementRevision;
  return movementCompletion.then(() => {
    if (revision !== movementRevision) return afterPieceMovement(callback);
    return callback();
  });
}

function scheduleWalks(movementPlans, host) {
  if (!movementPlans.length) return;
  const plans = movementPlans;
  const startedAt = typeof performance !== "undefined" && typeof performance.now === "function" ? performance.now() : Date.now();
  movementRevision += 1;
  let completeBatch;
  const scheduledWalks = new Promise(resolve => { completeBatch = resolve; });
  movementCompletion = Promise.all([movementCompletion, scheduledWalks]).then(() => undefined);
  const start = () => {
    const walks = plans.map(({ player, from, to }) => {
      try {
        return Promise.resolve(host.startPieceWalk(player.id, from, to, { startedAt }));
      } catch {
        return Promise.resolve();
      }
    });
    Promise.allSettled(walks).then(completeBatch);
  };
  if (typeof document !== "undefined" && document.hidden) start();
  else requestAnimationFrame(start);
}

let auctionSnoozeUntil = 0;

export function snoozeAuctionSurface(durationMs = 8000) {
  auctionSnoozeUntil = Date.now() + Math.max(0, durationMs);
}

function syncAuctionSurface(host) {
  if (state.auction) {
    // A manual close snoozes re-rendering so the surface stops fighting
    // the player; a new auction tile still breaks through immediately.
    if (Date.now() < auctionSnoozeUntil && state.auctionSnoozedTile === state.auction.tileIndex) return;
    state.auctionSnoozedTile = state.auction.tileIndex;
    host.openAuctionSurface();
    return;
  }
  state.auctionSnoozedTile = null;
  host.closeAuctionSurface();
}

function retireAllowed() {
  if (state.phase !== "playing") return false;
  const me = state.players[0];
  if (!me) return false;
  if (me.spectating) return true;
  if (me.bankrupt) return false;
  if (me.inDebt) return false;
  return me.online !== false;
}

function syncRetireButton(host) {
  const retireBtn = host.retireButton();
  if (!retireBtn) return;
  const label = retireBtn.querySelector(".t-label");
  const me = state.players[0];
  if (label) label.textContent = me?.spectating ? "LEAVE TABLE" : me?.inDebt ? "BANKRUPT" : "RETIRE";
  retireBtn.title = me?.spectating ? "Leave the table" : me?.inDebt ? "Resolve bankruptcy" : "Retire from the table";
  retireBtn.disabled = !retireAllowed();
}

function syncDebtModal(game, host) {
  const revision = ++debtSurfaceRevision;
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
  afterPieceMovement(() => {
    if (revision !== debtSurfaceRevision || state.pendingDebt !== debt || !host.bankruptcyHidden()) return;
    host.openBankruptcyModal(meIndex, num(debt.amountRemaining), debt.creditorId, orDefault(debt.reason, "This payment is due."));
  });
}

function syncWinner(game, host) {
  const revision = ++winnerSurfaceRevision;
  if (!game.lastWinner) return;
  if (state.gameOver) return;
  const winnerId = game.lastWinner.id;
  afterPieceMovement(() => {
    if (revision !== winnerSurfaceRevision || state.gameOver || game.lastWinner?.id !== winnerId) return;
    host.showGameOver(orDefault(game.lastWinner.nickname, "The winner"), winnerId);
  });
}

function snapshotIsPlayable(snapshot) {
  if (!snapshot) return false;
  if (!snapshot.room) return false;
  return Boolean(snapshot.game);
}

export function syncActionLockFromSnapshot() {
  // Preserve the local lock while an action is awaiting its acknowledgement;
  // a snapshot can arrive before the server callback and must not re-enable a
  // roll or end-turn control prematurely.
  if (state.pendingAction) return;
  state.busy = false;
  state.rolling = false;
}

export function applyServerState(snapshot, host) {
  if (!snapshotIsPlayable(snapshot)) return;
  syncClock(snapshot);
  if (state.suppressRoomUpdates) return;
  const previousPositions = previousPositionsOf();
  host.setConnectionStatus("online");
  const { room, game } = snapshot;
  const boardChanged = syncRoom(room, game);
  if (boardChanged) {
    setBoardVariant(state.boardVariant);
    host.rebuildBoard?.();
  }
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
  state.turnStage = turnStageOf(game);
  syncActionLockFromSnapshot();
  syncLog(game);
  syncRoomSettings(room);
  state.pendingBuyTile = nullish(game.pendingPurchaseOffer?.tileIndex, null);
  state.sponsorship = game.pendingSponsoredPurchase || null;
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
  host.placePiecesSoon();
}
