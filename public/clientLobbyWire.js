// LOBBY WIRE: bounded room-entry acks, snapshot-to-ack mapping and quick-table room choice.
const ROOM_ENTRY_ACK_TIMEOUT_MS = 4000;
const ROOM_ENTRY_ACK_RETRIES = 2;

export function sendRoomEntryWithRetries({
  emit,
  event,
  payload,
  onResponse,
  onTimeout,
  timeoutMs = ROOM_ENTRY_ACK_TIMEOUT_MS,
  maxRetries = ROOM_ENTRY_ACK_RETRIES,
  schedule = setTimeout,
  cancel = clearTimeout,
}) {
  let active = true;
  let retries = 0;
  let timer = null;

  const stopTimer = () => {
    if (timer !== null) cancel(timer);
    timer = null;
  };
  const finish = (response) => {
    if (!active) return;
    active = false;
    stopTimer();
    onResponse(response);
  };
  const send = () => {
    timer = schedule(() => {
      if (!active) return;
      timer = null;
      if (retries < maxRetries) {
        retries += 1;
        send();
        return;
      }
      active = false;
      onTimeout();
    }, timeoutMs);
    emit(event, payload, finish);
  };

  send();
  return {
    cancel() {
      if (!active) return;
      active = false;
      stopTimer();
    },
  };
}

export function roomEntryAckFromSnapshot(snapshot, clientId) {
  const room = snapshot?.room;
  const players = snapshotPlayers(snapshot);
  const player = players.find(candidate => candidate?.clientId === clientId);
  if (!room) return null;
  if (!player) return null;
  return {
    success: true,
    created: true,
    roomCode: roomCodeFromSnapshot(room),
    visibility: visibilityFromSnapshot(room),
    hostId: firstValue(room.hostId),
    playerId: firstValue(player.id, player.roomPlayerId),
    bots: players.filter(candidate => candidate?.isBot).length,
  };
}

function firstValue(...values) {
  return values.find(Boolean) || null;
}

function roomCodeFromSnapshot(room) {
  return Object.prototype.hasOwnProperty.call(room, "roomCode") ? room.roomCode : null;
}

function visibilityFromSnapshot(room) {
  return room.visibility === "public" ? "public" : "private";
}

function snapshotPlayers(snapshot) {
  const gamePlayers = snapshot?.game?.players;
  if (Array.isArray(gamePlayers)) return gamePlayers;
  return Array.isArray(snapshot?.room?.players) ? snapshot.room.players : [];
}

function isOpenQuickTableRoom(room) {
  const seats = Number(room?.seats);
  const cap = Number(room?.cap);
  const surface = `${room?.visibility || ""}:${room?.state || ""}`;
  const capacity = `${Number.isFinite(seats)}:${Number.isFinite(cap)}:${seats < cap}`;
  return surface === "public:open" && Boolean(room?.roomId) && capacity === "true:true:true";
}

/**
 * Pick open public tables so Quick Table fills an existing lobby first. This is
 * only a preference: join-room still checks every join on the server.
 */
export function chooseQuickTableRoom(rooms = []) {
  return (Array.isArray(rooms) ? rooms : [])
    .filter(isOpenQuickTableRoom)
    .sort((a, b) => {
      const openA = Number(a.cap) - Number(a.seats);
      const openB = Number(b.cap) - Number(b.seats);
      // Fill the table with the fewest free seats first, then use the stable
      // public id as a tie-breaker so two clients make the same choice.
      return openA - openB || String(a.roomId).localeCompare(String(b.roomId));
    });
}
