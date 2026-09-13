import assert from "node:assert/strict";
import fs from "node:fs";

globalThis.window = { matchMedia: () => ({ matches: false }) };
const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.localStorage = storage;
globalThis.sessionStorage = storage;
globalThis.document = {
  querySelector: () => null,
  querySelectorAll: () => [],
  createElement: () => ({})
};

const lobbyModule = await import("./clientLobbyUi.js");
const { chooseQuickTableRoom, roomEntryAckFromSnapshot, sendRoomEntryWithRetries } = lobbyModule;
const source = fs.readFileSync(new URL("./clientLobbyUi.js", import.meta.url), "utf8");

const rooms = [
  { roomId: "live", visibility: "public", state: "live", seats: 1, cap: 4 },
  { roomId: "full", visibility: "public", state: "open", seats: 4, cap: 4 },
  { roomId: "private", visibility: "private", state: "open", seats: 1, cap: 4 },
  { roomId: "nearly", visibility: "public", state: "open", seats: 3, cap: 4 },
  { roomId: "fresh", visibility: "public", state: "open", seats: 1, cap: 4 },
];

const candidates = chooseQuickTableRoom(rooms);
assert.deepEqual(candidates.map(room => room.roomId), ["nearly", "fresh"]);
assert.equal(chooseQuickTableRoom([]).length, 0);
assert.equal(chooseQuickTableRoom([{ roomId: "bad", visibility: "public", state: "open", seats: 4, cap: 4 }]).length, 0);
assert.match(source, /host\.emitServer\("list-rooms"/);
assert.match(source, /QUICK_TABLE_MAX_RETRIES/);
assert.match(source, /quickTableFlow = true;[\s\S]*requestQuickTableDirectory\(\)/);
assert.match(source, /quickTableJoinCanRetry\(response\)/);

assert.equal(typeof sendRoomEntryWithRetries, "function");
const scheduled = [];
const cancelled = [];
const emitted = [];
let timedOut = 0;
const payload = { requestId: "stable-create-request", nickname: "Marlowe" };
sendRoomEntryWithRetries({
  event: "create-room",
  payload,
  emit(event, sentPayload) { emitted.push({ event, payload: sentPayload }); },
  schedule(fn) { scheduled.push(fn); return fn; },
  cancel(timer) { cancelled.push(timer); },
  timeoutMs: 1,
  maxRetries: 2,
  onResponse() {},
  onTimeout() { timedOut += 1; },
});
scheduled[0]();
scheduled[1]();
scheduled[2]();
assert.equal(emitted.length, 3, "initial request plus two bounded retries");
assert.ok(emitted.every(entry => entry.event === "create-room"));
assert.ok(emitted.every(entry => entry.payload === payload), "every retry preserves the semantic payload object");
assert.ok(emitted.every(entry => entry.payload.requestId === "stable-create-request"));
assert.equal(timedOut, 1, "bounded retries recover the pending UI through one timeout callback");

assert.equal(typeof roomEntryAckFromSnapshot, "function");
assert.deepEqual(roomEntryAckFromSnapshot({
  room: { roomCode: null, visibility: "public", hostId: "host-1", players: [] },
  game: {
    players: [
      { id: "host-1", clientId: "client-1", isBot: false },
      { id: "bot-1", isBot: true },
    ],
  },
}, "client-1"), {
  success: true,
  created: true,
  roomCode: null,
  visibility: "public",
  hostId: "host-1",
  playerId: "host-1",
  bots: 1,
});
assert.equal(roomEntryAckFromSnapshot({ room: {}, game: { players: [] } }, "client-1"), null);

console.log("quick table and room-entry reliability: 18 passed, 0 failed");
