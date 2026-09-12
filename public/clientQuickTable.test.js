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

const { chooseQuickTableRoom } = await import("./clientLobbyUi.js");
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
console.log("quick table selection and race contract: 7 passed, 0 failed");
