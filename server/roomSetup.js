// Pure input shaping for the room lifecycle handlers in server.js. Nothing
// here touches sockets, stores, or timers: each function maps plain payload
// and account values into the exact normalized shapes the handlers pass on,
// so the wire-visible behavior (check order, error strings, ack shapes) is
// pinned by server/rooms.test.js and the shapes themselves by
// server/roomSetup.test.js.

export function normalizeNickname(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 24);
}

export function normalizeRoomCode(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/[^a-zA-Z0-9]/g, '').toUpperCase().slice(0, 6);
}

export function normalizeRoomName(value) {
  if (typeof value !== 'string') return 'AFTER HOURS';
  return value.trim().replace(/[^a-zA-Z0-9 _-]/g, '').slice(0, 24) || 'AFTER HOURS';
}

export function normalizeVisibility(value) {
  return value === 'private' ? 'private' : 'public';
}

export function normalizeColor(value) {
  return typeof value === 'string' && /^#[0-9a-fA-F]{6}$/.test(value) ? value : '';
}

function normalizeAvatarCell(cell) {
  if (cell == null || cell === '') return null;
  return typeof cell === 'string' && /^#[0-9a-fA-F]{6}$/.test(cell) ? cell.toLowerCase() : null;
}

function normalizeAvatarRow(row) {
  if (!Array.isArray(row) || row.length !== 8) return null;
  return row.map(normalizeAvatarCell);
}

export function normalizeAvatarGrid(value) {
  if (!Array.isArray(value) || value.length !== 8) return null;
  const rows = value.map(normalizeAvatarRow);
  return rows.some(row => row === null) ? null : rows;
}

export function normalizeChatText(value) {
  if (typeof value !== 'string') return '';
  return value.trim().slice(0, 250);
}

function resolveNickname(account, payload) {
  return normalizeNickname(account?.displayName || payload?.nickname);
}

function resolveColor(account, payload) {
  return normalizeColor(account?.color || payload?.color);
}

function resolveAvatarGrid(account, payload) {
  return normalizeAvatarGrid(account?.avatarGrid || payload?.avatarGrid);
}

function resolveAccountId(account) {
  return account?.id || null;
}

// Shared identity shaping for create-room and join-room: account values win
// over raw payload values, exactly as the handlers used to inline it.
export function buildRoomParticipant(payload, account) {
  return {
    nickname: resolveNickname(account, payload),
    color: resolveColor(account, payload),
    avatarGrid: resolveAvatarGrid(account, payload),
    accountId: resolveAccountId(account)
  };
}

export function buildCreateRoomRequest(payload, account) {
  const participant = buildRoomParticipant(payload, account);
  const visibility = normalizeVisibility(payload?.visibility);
  return {
    ...participant,
    visibility,
    roomName: normalizeRoomName(payload?.roomName),
    requestedRoomCode: visibility === 'private' ? normalizeRoomCode(payload?.roomCode) : ''
  };
}

// Returns the exact rejection message for the first failing check, or null.
// Check order must stay: nickname, then private-code length.
export function validateCreateRoomRequest(request) {
  if (!request.nickname) {
    return 'Nickname is required.';
  }
  if (request.visibility === 'private' && request.requestedRoomCode.length !== 6) {
    return 'Private rooms need a unique 6-character invite code.';
  }
  return null;
}

// Returns the exact rejection message for the first failing check, or null.
// Check order must stay: room code, then nickname.
export function validateJoinRoomRequest({ roomCode, nickname }) {
  if (!roomCode) {
    return 'Room code is required.';
  }
  if (!nickname) {
    return 'Nickname is required.';
  }
  return null;
}

export function toRoomCreationOptions(request, clientId, socketId) {
  return {
    clientId,
    socketId,
    nickname: request.nickname,
    color: request.color || undefined,
    avatarGrid: request.avatarGrid,
    accountId: request.accountId,
    roomName: request.roomName,
    visibility: request.visibility,
    roomCode: request.requestedRoomCode || undefined
  };
}

export function toJoinPlayerInfo(participant, clientId, socketId) {
  return {
    clientId,
    socketId,
    nickname: participant.nickname,
    color: participant.color || undefined,
    avatarGrid: participant.avatarGrid,
    accountId: participant.accountId
  };
}

// Accepted friends (and the owner) may read another player's history.
function isOwnerOrAcceptedFriend(viewer, target, friendship) {
  return viewer?.id === target.id || friendship?.status === 'accepted';
}

function historyIsPublic(target) {
  return target.privacy?.history === 'public';
}

function historyIsPrivateToOutsiders(target) {
  return target.privacy?.history === 'private';
}

// Match-history privacy gates, evaluated in the order the handler needs:
// friend/self visibility, then the owner's explicit private setting.
export function matchHistoryPrivacyError(viewer, target, friendship) {
  const canSeePrivateHistory = isOwnerOrAcceptedFriend(viewer, target, friendship);
  if (!canSeePrivateHistory && !historyIsPublic(target)) {
    return { canSeePrivateHistory, error: 'Match history is visible to the owner and accepted friends.' };
  }
  if (viewer?.id !== target.id && historyIsPrivateToOutsiders(target)) {
    return { canSeePrivateHistory, error: 'This player keeps match history private.' };
  }
  return { canSeePrivateHistory, error: null };
}

// Viewer-scoped projection used for every history request that is not the
// owner reading their own records.
export function summarizeMatchHistoryRecordForViewer(record, viewerId, targetId) {
  return {
    matchId: record.matchId,
    completedAt: record.completedAt,
    roundCount: record.roundCount,
    roomVisibility: record.roomVisibility,
    participants: record.participants.map(participant => ({
      displayNameAtMatch: participant.displayNameAtMatch,
      finalPlacement: participant.finalPlacement,
      propertyCount: participant.propertyCount,
      bankrupt: participant.bankrupt,
      isViewedPlayer: participant.accountId === targetId,
      sharedWithViewer: Boolean(viewerId && record.participants.some(entry => entry.accountId === viewerId))
    })),
    globalEvents: record.globalEvents,
    eventCombinations: record.eventCombinations,
    tradesCompleted: record.tradesCompleted,
    auctionsCompleted: record.auctionsCompleted
  };
}

function matchRecordGlobalEvents(game) {
  const history = game.globalEventHistory || [];
  const titles = history.map(event => event.title);
  const current = game.globalEvent;
  if (current && !history.some(event => event.id === current.id)) {
    titles.push(current.title);
  }
  return titles.slice(0, 20);
}

function matchRecordEventCombinations(game) {
  const history = game.globalEventHistory || [];
  const combinations = history.filter(event => event.comboId).map(event => event.comboId);
  const current = game.globalEvent;
  if (current?.comboId && !history.some(event => event.comboId === current.comboId)) {
    combinations.push(current.comboId);
  }
  return combinations.slice(0, 10);
}

function matchRecordCasinoRows(players) {
  return players.map(player => ({
    accountId: player.accountId,
    bets: (player.casinoLedger || []).length,
    net: Number(player.casinoNet) || 0
  }));
}

function matchRecordMarketPositions(player) {
  return Object.fromEntries(Object.entries(player.marketPositions || {}).map(([instrumentId, position]) => [
    instrumentId,
    { quantity: Number(position.quantity) || 0, realizedPnl: Number(position.realizedPnl) || 0 }
  ]));
}

function matchRecordMarketRows(players) {
  return players.map(player => ({
    accountId: player.accountId,
    positions: matchRecordMarketPositions(player)
  }));
}

function matchRecordPlayerContracts(game) {
  return game.playerContracts.map(contract => ({
    id: contract.id,
    kind: contract.kind,
    fromPlayerId: contract.fromPlayerId,
    toPlayerId: contract.toPlayerId,
    fromAccountId: game.getPlayerById(contract.fromPlayerId)?.accountId || null,
    toAccountId: game.getPlayerById(contract.toPlayerId)?.accountId || null,
    amount: contract.amount,
    premiumRate: contract.premiumRate,
    equityShare: contract.equityShare,
    collateralTileIndex: contract.collateralTileIndex ?? null,
    status: contract.status
  }));
}

// Builds the exact matchMeta object emitRoomState passed to
// accountStore.recordGameResults when a finished room settles its stats.
export function buildMatchRecordOptions(room) {
  const game = room.game;
  return {
    gameId: `match_${room.roomCode}_${game.startedAt || Date.now()}`,
    durationSeconds: game.startedAt ? (Date.now() - game.startedAt) / 1000 : 0,
    roundCount: game.roundNumber,
    roomVisibility: room.visibility,
    globalEvents: matchRecordGlobalEvents(game),
    eventCombinations: matchRecordEventCombinations(game),
    tradesCompleted: game.tradesCompleted || 0,
    auctionsCompleted: game.auctionsCompleted || 0,
    casino: matchRecordCasinoRows(game.players),
    market: matchRecordMarketRows(game.players),
    playerContracts: matchRecordPlayerContracts(game)
  };
}
