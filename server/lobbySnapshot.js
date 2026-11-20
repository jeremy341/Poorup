// Validation of a persisted lobby snapshot (see roomStore.js). Restore never trusts the file: anything malformed is dropped.
import { isValidAvatarGrid } from './appearanceApi.js';
import { normalizeClientId } from './roomSetup.js';

// Lobby snapshots (see roomStore.js): only an unstarted table is rebuilt from plain JSON. A started GameState owns Sets, bounded replay maps,
// presentation objects and timers that live in socketRuntime closures, so it is never persisted and does not survive a restart.
export const LOBBY_SNAPSHOT_SCHEMA = 1;
const LOBBY_SNAPSHOT_MAX_SEATS = 12;
const LOBBY_SNAPSHOT_MAX_KICKS = 200;
const LOBBY_ROOM_CODE = /^[A-Z0-9]{4,12}$/;
const LOBBY_PUBLIC_ID = /^room_[A-Za-z0-9-]{8,80}$/;

export function plainJson(value) {
  return JSON.parse(JSON.stringify(value));
}

function snapshotString(value, max) {
  return typeof value === 'string' ? value.slice(0, max) : '';
}

function snapshotStringList(value, max) {
  if (!Array.isArray(value)) return [];
  return value.filter(item => typeof item === 'string' && item && item.length <= 120).slice(0, max);
}

function validLobbySeat(seat) {
  if (!seat || typeof seat !== 'object') return null;
  const id = snapshotString(seat.id, 80);
  const clientId = normalizeClientId(seat.clientId);
  if (!id || !clientId) return null;
  const avatarGrid = isValidAvatarGrid(seat.avatarGrid) ? seat.avatarGrid : null;
  return {
    id,
    clientId,
    nickname: snapshotString(seat.nickname, 60),
    color: seat.color,
    avatarGrid,
    accountId: snapshotString(seat.accountId, 120) || null
  };
}

// Returns a normalized snapshot, or null for anything that is not a well-formed lobby. Restore never trusts the file.
export function validLobbySnapshot(snapshot) {
  if (!snapshot || typeof snapshot !== 'object') return null;
  if (snapshot.schema !== LOBBY_SNAPSHOT_SCHEMA || snapshot.kind !== 'lobby') return null;
  const roomCode = snapshotString(snapshot.roomCode, 12).toUpperCase();
  const publicId = snapshotString(snapshot.publicId, 90);
  if (!LOBBY_ROOM_CODE.test(roomCode) || !LOBBY_PUBLIC_ID.test(publicId)) return null;
  if (!snapshot.settings || typeof snapshot.settings !== 'object' || Array.isArray(snapshot.settings)) return null;
  if (!Array.isArray(snapshot.players)) return null;
  const seats = snapshot.players.slice(0, LOBBY_SNAPSHOT_MAX_SEATS).map(validLobbySeat).filter(Boolean);
  const clientIds = new Set(seats.map(seat => seat.clientId));
  if (!seats.length || clientIds.size !== seats.length) return null;
  return {
    roomCode,
    publicId,
    roomName: snapshotString(snapshot.roomName, 60) || 'AFTER HOURS',
    // An unknown visibility restores as the safer private table.
    visibility: snapshot.visibility === 'public' ? 'public' : 'private',
    hostId: snapshotString(snapshot.hostId, 80),
    settings: plainJson(snapshot.settings),
    kickedClientIds: snapshotStringList(snapshot.kickedClientIds, LOBBY_SNAPSHOT_MAX_KICKS),
    kickedAccountIds: snapshotStringList(snapshot.kickedAccountIds, LOBBY_SNAPSHOT_MAX_KICKS),
    seats
  };
}
