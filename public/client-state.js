function safeArray(arr) {
  return Array.isArray(arr) ? arr : [];
}

function playerJailed(player) {
  if (!player.jail) return false;
  return player.jail.turns > 0;
}

function mapPlayerIdentity(player, clientId) {
  return {
    id: player.clientId === clientId ? 'p1' : player.id,
    serverId: player.id,
    clientId: player.clientId,
    name: String(player.nickname || 'PLAYER').toUpperCase(),
    color: player.color || '#cfa75f',
    token: player.token || ''
  };
}

function mapPlayerFinance(player) {
  return {
    accountId: player.accountId || null,
    pos: Number(player.position) || 0,
    cash: Number(player.cash) || 0,
    properties: safeArray(player.properties),
    playerContractIds: safeArray(player.playerContractIds)
  };
}

function mapPlayerStatus(player, game) {
  return {
    bankrupt: Boolean(player.bankrupt),
    inDebt: Boolean(player.inDebt),
    online: player.online !== false,
    turn: player.id === game.currentPlayerId,
    jailed: playerJailed(player),
    moved: Boolean(player.justLanded)
  };
}

function mapPlayers(players, clientId, game) {
  return players.map(player => ({
    ...mapPlayerIdentity(player, clientId),
    ...mapPlayerFinance(player),
    ...mapPlayerStatus(player, game)
  }));
}

function resolveTurnOrder(players, turnOrder) {
  if (Array.isArray(turnOrder)) {
    if (turnOrder.length) return turnOrder;
  }
  return players.map(p => p.id);
}

function timerOffset(serverTime) {
  if (!Number.isFinite(serverTime)) return 0;
  if (serverTime <= 0) return 0;
  return serverTime - Date.now();
}

function roomMeta(room) {
  return {
    roomCode: Object.prototype.hasOwnProperty.call(room, 'roomCode') ? (room.roomCode || '') : undefined,
    roomVisibility: room.visibility === 'public' ? 'public' : 'private',
    hostId: room.hostId || null
  };
}

function gameMeta(game) {
  return {
    phase: game.phase || 'waiting',
    roundNumber: game.roundNumber || 0,
    currentPlayerId: game.currentPlayerId || null,
    pendingPayment: game.pendingPayment || null,
    pendingDebt: game.pendingPayment || null,
    serverTiles: safeArray(game.tiles)
  };
}

export function applyServerState(snapshot, clientId, previousState = {}) {
  if (!snapshot?.room || !snapshot?.game) return previousState;
  const state = { ...previousState };
  const { room, game } = snapshot;
  const rm = roomMeta(room);
  if (rm.roomCode !== undefined) state.roomCode = rm.roomCode;
  state.roomVisibility = rm.roomVisibility;
  state.hostId = rm.hostId;
  const gm = gameMeta(game);
  state.serverTiles = gm.serverTiles;
  state.phase = gm.phase;
  state.roundNumber = gm.roundNumber;
  state.currentPlayerId = gm.currentPlayerId;
  state.pendingPayment = gm.pendingPayment;
  state.pendingDebt = gm.pendingDebt;
  const offset = timerOffset(Number(snapshot.serverTime));
  if (offset) state.serverTimeOffset = offset;
  const remotePlayers = safeArray(game.players);
  state.players = mapPlayers(remotePlayers, clientId, game);
  state.turnOrder = resolveTurnOrder(remotePlayers, game.turnOrder);
  return state;
}