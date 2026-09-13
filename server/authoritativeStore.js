// Provider-neutral authoritative room snapshot seam.
//
// The running game remains in-memory today, but every future multi-instance
// deployment needs a single compare-and-swap contract for room snapshots.
// This module supplies a deterministic in-memory adapter for tests and a
// crash-safe JSON adapter for one-process development. A PostgreSQL adapter can
// implement the same four methods without changing Socket.IO payloads.
import path from 'path';
import { loadJson, writeJson } from './storeIO.js';

const MAX_ROOM_ID = 120;
const MAX_SNAPSHOT_BYTES = 2_000_000;

function safeRoomId(roomId) {
  if (typeof roomId !== 'string') return '';
  const value = roomId.trim().slice(0, MAX_ROOM_ID);
  return value && /^[A-Za-z0-9:_-]+$/.test(value) ? value : '';
}

function safeVersion(version) {
  const value = Number(version);
  return Number.isSafeInteger(value) && value >= 0 ? value : null;
}

function cloneSnapshot(snapshot) {
  if (snapshot === undefined) return null;
  let serialized;
  try { serialized = JSON.stringify(snapshot); } catch { return null; }
  if (!serialized || serialized.length > MAX_SNAPSHOT_BYTES) return null;
  try { return JSON.parse(serialized); } catch { return null; }
}

function invalidResult(error) {
  return { success: false, error };
}

function createAdapter(readRows, persistRows = null) {
  const rows = readRows();

  function readRoom(roomId) {
    const id = safeRoomId(roomId);
    if (!id) return invalidResult('Room id is invalid.');
    const row = rows.get(id);
    if (!row) return { success: true, found: false, roomId: id, version: 0, snapshot: null };
    return { success: true, found: true, roomId: id, version: row.version, snapshot: cloneSnapshot(row.snapshot) };
  }

  function writeRoom(roomId, snapshot, version) {
    const id = safeRoomId(roomId);
    const nextVersion = safeVersion(version);
    const nextSnapshot = cloneSnapshot(snapshot);
    if (!id) return invalidResult('Room id is invalid.');
    if (nextVersion === null) return invalidResult('Room version must be a non-negative integer.');
    if (nextSnapshot === null) return invalidResult('Room snapshot must be JSON-serializable and bounded.');
    const current = rows.get(id);
    if (current && nextVersion <= current.version) {
      return { success: false, code: 'STALE_VERSION', roomId: id, version: current.version };
    }
    rows.set(id, { version: nextVersion, snapshot: nextSnapshot });
    try {
      persistRows?.(rows);
    } catch (error) {
      if (current) rows.set(id, current);
      else rows.delete(id);
      return { success: false, code: 'PERSIST_FAILED', error: error?.message || 'Room snapshot could not be persisted.' };
    }
    return { success: true, roomId: id, version: nextVersion };
  }

  function deleteRoom(roomId, version) {
    const id = safeRoomId(roomId);
    const expected = safeVersion(version);
    if (!id) return invalidResult('Room id is invalid.');
    if (expected === null) return invalidResult('Room version must be a non-negative integer.');
    const current = rows.get(id);
    if (!current) return { success: true, deleted: false, roomId: id, version: expected };
    if (expected !== current.version) return { success: false, code: 'STALE_VERSION', roomId: id, version: current.version };
    rows.delete(id);
    try {
      persistRows?.(rows);
    } catch (error) {
      rows.set(id, current);
      return { success: false, code: 'PERSIST_FAILED', error: error?.message || 'Room snapshot could not be persisted.' };
    }
    return { success: true, deleted: true, roomId: id, version: expected };
  }

  return { readRoom, writeRoom, deleteRoom, size: () => rows.size };
}

export function createMemoryAuthoritativeStore(initial = {}) {
  const rows = new Map();
  Object.entries(initial && typeof initial === 'object' ? initial : {}).forEach(([roomId, row]) => {
    const id = safeRoomId(roomId);
    const version = safeVersion(row?.version);
    const snapshot = cloneSnapshot(row?.snapshot);
    if (id && version !== null && snapshot !== null) rows.set(id, { version, snapshot });
  });
  return createAdapter(() => rows);
}

export function createJsonAuthoritativeStore(filePath) {
  const resolved = typeof filePath === 'string' && filePath.trim() ? path.resolve(filePath) : '';
  if (!resolved) return createMemoryAuthoritativeStore();
  const loaded = loadJson(resolved, value => value && typeof value === 'object' && !Array.isArray(value));
  const initial = loaded.value || {};
  return createAdapter(
    () => {
      const rows = new Map();
      Object.entries(initial).forEach(([roomId, row]) => {
        const id = safeRoomId(roomId);
        const version = safeVersion(row?.version);
        const snapshot = cloneSnapshot(row?.snapshot);
        if (id && version !== null && snapshot !== null) rows.set(id, { version, snapshot });
      });
      return rows;
    },
    rows => writeJson(resolved, Object.fromEntries(rows.entries()))
  );
}

export function createAuthoritativeStore({ filePath = '', initial = {} } = {}) {
  return filePath ? createJsonAuthoritativeStore(filePath) : createMemoryAuthoritativeStore(initial);
}

export { MAX_ROOM_ID, MAX_SNAPSHOT_BYTES, safeRoomId, safeVersion };
