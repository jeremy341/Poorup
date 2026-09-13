import assert from "node:assert/strict";
import { RoomManager } from "./gameLogic.js";

const manager = new RoomManager();
const room = manager.createRoom({
  socketId: "public-host-socket",
  clientId: "public-host-client",
  nickname: "Public Host",
  visibility: "public",
});

const host = room.game.players[0];
assert.ok(host, "public room must seat its creator");
assert.equal(room.hostId, host.id, "the creator owns the host seat");
assert.equal(host.isHost, true, "the creator is marked as host");
assert.equal(room.game.players.some((player) => player.isBot), false, "creating a room must not add bots");
assert.equal(room.getRoomSummary().hostId, host.id, "room summary keeps the authoritative host id");

// A full human table must never grow past capacity when the host configured
// bots before the last human joined.
room.setRoomSetting('bots', 1);
for (let index = 0; index < 3; index += 1) {
  const result = room.addOrReconnectPlayer({
    socketId: `human-${index}`,
    clientId: `human-${index}`,
    nickname: `Human ${index}`,
  });
  assert.equal(result.success, true);
}
room.ensureBots();
assert.equal(room.game.players.filter((player) => !player.isBot && !player.disconnected && !player.bankrupt).length, 4);
assert.equal(room.game.players.filter((player) => player.isBot).length, 0, 'bots must yield to seated humans');

const second = manager.createRoom({
  socketId: "other-socket",
  clientId: "other-client",
  nickname: "Other Host",
  visibility: "public",
});
assert.notEqual(second.hostId, room.hostId, "each public room keeps its own host");

console.log("room host lifecycle tests: 8 passed");
