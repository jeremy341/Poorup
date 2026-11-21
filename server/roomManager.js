// The room registry: creates, finds, restores and releases tables, and answers "which seat does this client or socket hold?".
// The tables themselves are rooms.js; the seats are roomSeat.js. Wired to sockets by socketRuntime.js and the serverSocket* modules.
import { randomInt } from './random.js';
import { resolveFreeAppearanceColor } from './appearanceApi.js';
import { releaseSeat } from './seatRelease.js';
import { validLobbySnapshot } from './lobbySnapshot.js';
import { normalizeClientId } from './roomSetup.js';
import { Room } from './rooms.js';
import { ensureRoomHost, LOBBY_ABSENT_SEAT_MS, Player } from './roomSeat.js';

const SEAT_INACTIVE_ERROR = 'That room seat is no longer active.';

function createRoomCode() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += alphabet.charAt(randomInt(0, alphabet.length - 1));
  }
  return code;
}

function identityConflictInRoom(room, identity) {
  for (const player of room.game.players) {
    const conflict = identityConflictForPlayer(player, identity);
    if (conflict) return conflict;
  }
  return null;
}

// A client match on a live seat already bound to this socket is the same tab, not a conflict; the account check is then skipped.
function identityConflictForPlayer(player, { clientId, accountId, socketId }) {
  if (clientId && player.clientId === clientId) {
    if (!player.disconnected && socketId && player.socketId === socketId) return null;
    return player.disconnected
      ? 'That seat is still held by another room. Restore it or wait for it to expire.'
      : 'That seat is already in use.';
  }
  if (accountId && player.accountId === accountId && !player.bankrupt
    && (player.disconnected || player.socketId !== socketId)) {
    return 'This account is already seated in another room.';
  }
  return null;
}

function seatAccountAllowsReconnect(player, accountId) {
  if (!player.accountId) return true;
  return player.accountId === accountId;
}

// The seat a returning client holds is the one it dropped most recently. The ordering key is the actual first drop of the current
// absence: a lobby seat's grace restarts forever, so its deadline cannot tell a fresh drop from a ghost.
function seatDropTime(player) {
  const droppedAt = Number(player?.disconnectedAt) || 0;
  if (droppedAt > 0) return droppedAt;
  return Number(player?.disconnectDeadline) || 0;
}

function droppedMoreRecently(candidate, current) {
  if (!current) return true;
  return seatDropTime(candidate) > seatDropTime(current);
}

export class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.socketRoom = new Map();
    this.roomDestroyer = null;
  }

  setRoomDestroyer(destroyer) {
    this.roomDestroyer = typeof destroyer === 'function' ? destroyer : null;
  }

  createRoom(hostInfo) {
    const player = new Player({ ...hostInfo, isHost: true });
    // Requested codes must never silently overwrite a live room entry.
    let roomCode = hostInfo.roomCode || this.reserveRoomCode();
    if (this.rooms.has(roomCode)) roomCode = this.reserveRoomCode();
    const room = new Room(player, {
      roomName: hostInfo.roomName,
      visibility: hostInfo.visibility,
      roomCode,
      rulesetOverrides: hostInfo.rulesetOverrides,
      rulesProfile: hostInfo.rulesProfile,
      playerFinance: hostInfo.playerFinance,
      boardVariant: hostInfo.boardVariant,
      marketComplexity: hostInfo.marketComplexity
    });
    room.releaseExpiredSeat = expiredPlayer => this.releaseSeat(room.game, expiredPlayer);
    player.color = resolveFreeAppearanceColor(room.game.players, player.color, player, player.avatarGrid);
    this.rooms.set(room.roomCode, room);
    this.socketRoom.set(hostInfo.socketId, room);
    return room;
  }

  // Rebuilds one persisted lobby (Room#toLobbySnapshot). Every seat comes back disconnected: the clientId is the bearer key, so a returning
  // player re-enters through the normal restoreConnection path with a live socket, and a seat nobody returns to ages out through the
  // existing empty-room GC. Returns the room, or null when the snapshot is malformed, its code is taken or an identity already sits elsewhere.
  restoreLobby(snapshot, { now = Date.now(), graceMs = LOBBY_ABSENT_SEAT_MS } = {}) {
    const data = validLobbySnapshot(snapshot);
    if (!data || this.rooms.has(data.roomCode)) return null;
    const seats = data.seats.map(seat => {
      const player = new Player({ clientId: seat.clientId, socketId: null, nickname: seat.nickname, color: seat.color, avatarGrid: seat.avatarGrid, accountId: seat.accountId });
      player.id = seat.id;
      return player;
    });
    if (seats.some(seat => this.identitySeatElsewhere(null, { clientId: seat.clientId, accountId: seat.accountId }))) return null;
    const host = seats.find(seat => seat.id === data.hostId) || seats[0];
    const { settings } = data;
    const room = new Room(host, {
      roomName: data.roomName,
      visibility: data.visibility,
      roomCode: data.roomCode,
      rulesetOverrides: settings.rulesetOverrides,
      boardVariant: settings.boardVariant,
      marketComplexity: settings.marketComplexity,
      rulesProfile: settings.rulesProfile,
      playerFinance: settings.playerFinance
    });
    // refreshRuleset() is the trusted restoration seam: it re-resolves the ruleset from the stored settings and syncs them to the game.
    room.settings = { ...room.settings, ...settings };
    room.refreshRuleset();
    room.game.boardVariant = room.ruleset.boardVariant;
    room.publicId = data.publicId;
    room.kickedClientIds = new Set(data.kickedClientIds);
    room.kickedAccountIds = new Set(data.kickedAccountIds);
    seats.filter(seat => seat !== host).forEach(seat => room.game.addPlayer(seat));
    // addPlayer resets the per-seat baseline (including connection state), so presence is written after it.
    seats.forEach(seat => {
      seat.isHost = seat === host;
      seat.socketId = null;
      seat.disconnected = true;
      seat.disconnectedAt = now;
      seat.disconnectDeadline = now + graceMs;
    });
    room.hostId = host.id;
    room.ensureBots();
    room.releaseExpiredSeat = expiredPlayer => this.releaseSeat(room.game, expiredPlayer);
    this.rooms.set(room.roomCode, room);
    return room;
  }

  // Generated codes must never silently overwrite an existing room entry.
  reserveRoomCode() {
    let roomCode;
    do {
      roomCode = createRoomCode();
    } while (this.rooms.has(roomCode));
    return roomCode;
  }

  getRoom(roomCode) {
    if (!roomCode) return null;
    return this.rooms.get(String(roomCode).toUpperCase()) || null;
  }

  getRoomByPublicId(publicId) {
    if (!publicId) return null;
    return [...this.rooms.values()].find(room => room.publicId === String(publicId).trim()) || null;
  }

  getRoomBySocket(socketId) {
    return this.socketRoom.get(socketId) || null;
  }

  restoreConnection(clientId, socketId, accountId = null, onAccountSeatReclaimed = null) {
    const safeId = normalizeClientId(clientId);
    if (!safeId) return null;
    const room = this.findRestoreRoomFor(safeId, socketId);
    if (!room) return this.restoreAccountSeat(accountId, safeId, socketId, onAccountSeatReclaimed);
    return this.restoreRoomSeat(room, safeId, socketId, accountId);
  }

  restoreRoomSeat(room, safeId, socketId, accountId) {
    if (room.isSeatBlocked(safeId, accountId)) return null;
    const mappedRoom = this.socketRoom.get(socketId);
    if (mappedRoom && mappedRoom !== room) return null;
    const player = room.game.getPlayerByClient(safeId);
    if (!player) return null;
    if (accountId && player.accountId !== accountId) return null;
    if (player.disconnected) return this.restoreDisconnectedSeat(player, room, socketId, accountId);
    return this.restoreLiveSeat(player, room, socketId);
  }

  restoreLiveSeat(player, room, socketId) {
    // Same-socket restores are idempotent; another live socket must never
    // overwrite the seat's bearer socket or its socket-room index.
    if (player.socketId !== socketId) return null;
    this.socketRoom.set(socketId, room);
    return room;
  }

  restoreDisconnectedSeat(player, room, socketId, accountId) {
    if (!seatAccountAllowsReconnect(player, accountId)) return null;
    if (this.identitySeatElsewhere(room, { accountId, socketId })) return null;
    player.socketId = socketId;
    player.disconnected = false;
    player.disconnectDeadline = 0;
    player.disconnectedAt = 0;
    player.presence = { state: 'active', inactiveSince: null, inactiveUntil: null };
    this.socketRoom.set(socketId, room);
    ensureRoomHost(room);
    return room;
  }

  // Tab-restart recovery: a reopened tab has a fresh clientId (sessionStorage dies with the tab), so clientId matching cannot find the seat.
  // The account session survives in localStorage, so a disconnected seat owned by the same account is reclaimed under the new clientId.
  // Connected seats never match: a live tab keeps its seat and the newcomer is rejected, preserving one seat per tab.
  restoreAccountSeat(accountId, clientId, socketId, onAccountSeatReclaimed = null) {
    if (!accountId) return null;
    if (!clientId) return null;
    if (this.socketRoom.has(socketId)) return null;
    if (this.accountHasConnectedSeat(accountId)) return null;
    const seat = this.findDisconnectedAccountSeat(accountId);
    if (!seat) return null;
    const { room, player } = seat;
    // A kick only blocks the room that issued it, not seats at other tables.
    if (room.isSeatBlocked(clientId, accountId)) return null;
    const previousClientId = player.clientId;
    if (typeof onAccountSeatReclaimed === 'function') onAccountSeatReclaimed(previousClientId, room);
    player.clientId = clientId;
    player.socketId = socketId;
    player.disconnected = false;
    player.disconnectDeadline = 0;
    player.disconnectedAt = 0;
    player.presence = { state: 'active', inactiveSince: null, inactiveUntil: null };
    this.socketRoom.set(socketId, room);
    ensureRoomHost(room);
    return room;
  }

  accountHasConnectedSeat(accountId) {
    return [...this.rooms.values()].some(roomItem => roomItem.game.players
      .some(player => player.accountId === accountId && !player.bankrupt && !player.disconnected));
  }

  findDisconnectedAccountSeat(accountId) {
    let best = null;
    for (const room of this.rooms.values()) {
      const player = room.game.players.find(candidate => candidate.accountId === accountId);
      if (!player?.disconnected) continue;
      // The registry order is not the user's history: the account reclaim
      // must not take the oldest disconnected seat, but the one it dropped
      // last (the same seat the socket restore path picks).
      if (!droppedMoreRecently(player, best?.player)) continue;
      best = { room, player };
    }
    return best;
  }

  findLiveRoomFor(clientId) {
    return [...this.rooms.values()].find(roomItem => {
      const player = roomItem.game.getPlayerByClient(clientId);
      if (!player) return false;
      return !player.disconnected;
    });
  }

  // A clientId can hold seats in two rooms (a started seat in grace plus the lobby it moved to). Restore the room this socket already maps
  // to, then a live seat, then the seat dropped last. The ordering key is the actual first drop: a lobby seat's grace restarts forever,
  // so its deadline cannot tell a fresh drop from a ghost.
  findRestoreRoomFor(clientId, socketId) {
    const mapped = this.socketRoom.get(socketId);
    if (mapped && mapped.game.getPlayerByClient(clientId)) return mapped;
    const live = this.findLiveRoomFor(clientId);
    if (live) return live;
    let best = null;
    let bestPlayer = null;
    for (const roomItem of this.rooms.values()) {
      const player = roomItem.game.getPlayerByClient(clientId);
      if (!player) continue;
      if (!droppedMoreRecently(player, bestPlayer)) continue;
      best = roomItem;
      bestPlayer = player;
    }
    return best;
  }

  disconnectPlayer(socketId) {
    const room = this.getRoomBySocket(socketId);
    if (!room) return null;
    this.socketRoom.delete(socketId);
    return room;
  }

  getRoomByClient(clientId) {
    if (!clientId) return null;
    return [...this.rooms.values()].find(roomItem => roomItem.game.getPlayerByClient(clientId)) || null;
  }

  // One seat per identity across the registry: a clientId keys its grace timer and leave/restore lookups, and an account plays one table at a time,
  // so a second seat under either identity is refused. A live seat held by the joining socket itself may move rooms; the caller detaches it.
  identitySeatElsewhere(room, { clientId = '', accountId = null, socketId = null } = {}) {
    for (const other of this.rooms.values()) {
      if (other === room) continue;
      const conflict = identityConflictInRoom(other, { clientId, accountId, socketId });
      if (conflict) return conflict;
    }
    return null;
  }

  // Every live seat bound to a socket, whichever room the socket is mapped to.
  liveSeatsOnSocket(socketId) {
    const seats = [];
    for (const room of this.rooms.values()) {
      room.game.players.forEach(player => {
        if (socketId && player.socketId === socketId && !player.disconnected) seats.push({ room, player });
      });
    }
    return seats;
  }

  listPublicRooms() {
    return [...this.rooms.values()]
      .filter(room => room.visibility === 'public' && room.hasConnectedHumans())
      .map(room => room.getDirectorySummary());
  }

  leaveRoomByClient(clientId, socketId, room = this.getRoomByClient(clientId)) {
    if (!room) return null;
    const player = room.game.getPlayerByClient(clientId);
    if (!player) return null;
    const released = this.releaseSeat(room.game, player);
    if (released?.success === false) return released;
    // Unmap only a socket that is mapped to the room being released. A socket
    // seated in another room keeps its mapping and its live seat there.
    if (socketId && this.socketRoom.get(socketId) === room) {
      this.socketRoom.delete(socketId);
    }
    if (room.game.players.length === 0) {
      if (this.roomDestroyer) this.roomDestroyer(room);
      else this.rooms.delete(room.roomCode);
    }
    return room;
  }

  removeRoomSeat({ clientId, socketId, reason = 'leave', preventRejoin = false, room: targetRoom = null } = {}) {
    const seat = this.roomSeatTarget(clientId, socketId, targetRoom);
    if (seat.error) return { success: false, error: seat.error };
    const { room, player } = seat;
    const wasHost = room.hostId === player.id;
    const releasedRoom = this.leaveRoomByClient(player.clientId, socketId || player.socketId, room);
    if (!releasedRoom) return { success: false, error: SEAT_INACTIVE_ERROR };
    if (releasedRoom.success === false) return releasedRoom;
    if (preventRejoin) this.blockSeatRejoin(room, player);
    if (wasHost) ensureRoomHost(releasedRoom);
    return { success: true, room: releasedRoom, player, reason };
  }

  // An expiring seat names its own room, so a clientId that also holds a seat
  // in another room cannot resolve to the other room's seat.
  roomSeatTarget(clientId, socketId, targetRoom = null) {
    const room = targetRoom || this.getRoomByClient(clientId);
    const player = room?.game.getPlayerByClient(clientId);
    if (!room || !player) return { error: SEAT_INACTIVE_ERROR };
    if (socketId && !this.seatMatchesSocket(player, socketId)) return { error: SEAT_INACTIVE_ERROR };
    return { room, player };
  }

  seatMatchesSocket(player, socketId) {
    if (!player.socketId) return true;
    return player.socketId === socketId;
  }

  // Blocks the removed seat's clientId and accountId only. A guest who returns
  // with a fresh clientId is not blocked: the room keeps no client address to
  // match on.
  blockSeatRejoin(room, player) {
    room.kickedClientIds.add(player.clientId);
    if (player.accountId) room.kickedAccountIds.add(player.accountId);
  }

  // A real leave releases the seat in the lobby AND mid-game, so the room can drain to empty and the GC can reclaim it.
  releaseSeat(game, player) {
    return releaseSeat(game, player);
  }
}
