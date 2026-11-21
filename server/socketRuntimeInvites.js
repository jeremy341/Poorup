// Room-invite acceptance with all-or-nothing lobby roster rollback, and the contract-cancel request-id memo.

import { normalizeClientId, normalizeAvatarGrid } from './roomSetup.js';
import { normalizeRequestId } from './requestId.js';

export function createInvitesDomain(ctx) {
  const { io, roomManager, socialStore, social } = ctx;

  // Accept-branch of respond-room-invite: gate order, seat transfer, and ack
  // shape are pinned by server/rooms.test.js. Returns the ack payload so the
  // handler stays a validate, then delegate, then respond flow.
  function acceptRoomInvite(socket, account, invite, payload) {
    if (!invite) return { success: false, error: 'That room invite has expired.' };
    if (String(payload?.inviteId || '') !== String(invite.id || '')) return { success: false, error: 'That room invite is no longer valid.' };
    const expiresAt = Date.parse(invite.expiresAt || '');
    if (!Number.isFinite(expiresAt) || expiresAt <= Date.now()) {
      // Mark the stale record before doing any seat mutation, or an
      // invite that expired between lookup and acceptance could still join a
      // room even though the response returned an expiry error.
      socialStore.respondInvite(account.id, invite.id, true);
      return { success: false, error: 'That room invite has expired.' };
    }
    const room = invite.roomId
      ? roomManager.getRoomByPublicId(invite.roomId)
      : roomManager.getRoom(invite.roomCode);
    if (!room) return { success: false, error: 'That room no longer exists.' };
    if (invite.roomId && room.publicId !== invite.roomId) return { success: false, error: 'That room invite is no longer valid.' };
    if (room.game.started) return { success: false, error: 'That round has already started.' };
    const clientId = normalizeClientId(payload.clientId);
    if (!clientId) return { success: false, error: 'A client session is required to join.' };
    if (!ctx.canJoinRoom(socket, account, { reconnecting: Boolean(room.game.getPlayerByClient(clientId)) })) return ctx.lockoutRefusal(socket);
    // The same capacity rule join-room uses: every retained lobby seat counts.
    if (!room.lobbyHasFreeSeat()) return { success: false, error: 'That room is full.' };
    return joinRoomViaInvite(socket, account, room, payload);
  }

  function joinRoomViaInvite(socket, account, room, payload) {
    const clientId = normalizeClientId(payload.clientId);
    const existing = room.game.getPlayerByClient(clientId);
    if (existing?.socketId && existing.socketId !== socket.id && !existing.disconnected) {
      return { success: false, error: 'That seat is already in use.' };
    }
    const seatConflict = roomManager.identitySeatElsewhere(room, { clientId, accountId: account.id, socketId: socket.id });
    if (seatConflict) return { success: false, error: seatConflict };
    // The lobby as it is before the seat is staged: the seat that is about to
    // be added, the host seat it may take over and the bot roster it may
    // change. A refused invite gives all of it back.
    const rosterBefore = snapshotLobbyRoster(room);
    const socketRoomBefore = roomManager.socketRoom.get(socket.id) || null;
    let joined;
    try {
      joined = room.addOrReconnectPlayer({
        clientId,
        socketId: socket.id,
        nickname: account.displayName,
        color: account.color,
        avatarGrid: normalizeAvatarGrid(account.avatarGrid),
        accountId: account.id
      });
    } catch (error) {
      console.error('Invite seating failed for room', room.roomCode, error);
      restoreLobbyRoster(room, rosterBefore);
      return { success: false, error: 'That seat could not be prepared. Please try again.' };
    }
    if (!joined.success) {
      restoreLobbyRoster(room, rosterBefore);
      return { success: false, error: joined.error };
    }
    // Validate and consume the invite while the source room is still intact. If the record was declined or expired concurrently, or the store
    // failed, the staged target seat is rolled back and the source socket is untouched: a failed invite never leaves a live seat behind.
    let result;
    try {
      result = socialStore.respondInvite(account.id, payload.inviteId, true);
      if (!result.success) {
        restoreLobbyRoster(room, rosterBefore);
        return result;
      }
      ctx.detachSocketFromOtherRoom(socket, room);
      ctx.leaveAllGameRooms(socket);
      ctx.clearDisconnectTimer(clientId, room);
      roomManager.socketRoom.set(socket.id, room);
      socket.join(room.roomCode);
    } catch (error) {
      console.error('Invite acceptance failed for room', room.roomCode, error);
      restoreLobbyRoster(room, rosterBefore);
      if (socketRoomBefore) roomManager.socketRoom.set(socket.id, socketRoomBefore);
      else roomManager.socketRoom.delete(socket.id);
      return { success: false, error: 'That room invite could not be accepted. Please try again.' };
    }
    social.emitSocialUpdate(account.id);
    ctx.emitRoomState(room);
    io.in(room.roomCode).emit('system-message', { text: account.displayName + ' joined from a room invite.' });
    ctx.emitPendingInteractions(room, socket, joined.player);
    return { ...result, roomId: room.publicId, roomCode: room.visibility === 'private' ? room.roomCode : null, visibility: room.visibility };
  }

  // The lobby roster as it is right now: every seat with the fields a seat
  // carries, plus the host seat. An invite that fails gives all of it back.
  function snapshotLobbyRoster(room) {
    return {
      players: room.game.players.map(player => ({ player, props: { ...player } })),
      hostId: room.hostId
    };
  }

  function restoreLobbyRoster(room, snapshot) {
    const roster = room.game.players;
    roster.length = 0;
    snapshot.players.forEach(entry => {
      const player = entry.player;
      Object.keys(player).forEach(key => {
        if (!(key in entry.props)) delete player[key];
      });
      Object.assign(player, entry.props);
      roster.push(player);
    });
    room.hostId = snapshot.hostId;
    roster.forEach(player => { player.isHost = player.id === snapshot.hostId; });
  }

  function contractCancelKey(socket, payload) {
    const requestId = normalizeRequestId(payload?.requestId);
    if (!requestId) return null;
    return `${socket.id}:cancel:${requestId}`;
  }

  // The memo records which contract the cancel settled, as the contract
  // response memo does: a reused request id must not report a cancel for a
  // different contract that is still pending.
  function cachedContractCancel(room, socket, payload) {
    const key = contractCancelKey(socket, payload);
    if (!key) return null;
    if (!room.game.contractTransactions?.has(key)) return null;
    const memo = room.game.contractTransactions.get(key);
    // An evicted id answers with the map's terminal rejection.
    if (memo && memo.result === undefined && memo.error) return memo;
    const pendingId = room.game.pendingPlayerContract?.id || null;
    const named = payload?.contractId ? String(payload.contractId) : null;
    if (named ? named !== memo?.contractId : pendingId) return null;
    return memo?.result ?? null;
  }

  function cacheContractCancel(room, socket, payload, result, contractId = null) {
    const key = contractCancelKey(socket, payload);
    if (key) room.game.contractTransactions.set(key, { contractId: contractId ? String(contractId) : null, result });
  }

  Object.assign(ctx, {
    acceptRoomInvite,
    cachedContractCancel,
    cacheContractCancel
  });
}
