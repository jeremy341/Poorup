import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';

function fixture(doubleGo) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'double-a', clientId: 'double-a', nickname: 'A' });
  room.addOrReconnectPlayer({ socketId: 'double-b', clientId: 'double-b', nickname: 'B' });
  room.setRoomSetting('doubleGo', doubleGo);
  assert.equal(room.startGame().success, true);
  const game = room.game;
  const player = game.players[0];
  player.cash = 1000;
  game.currentPlayerId = player.id;
  game.hasRolled = true;
  return { game, player };
}

const normal = fixture(false);
normal.game.movePlayer(normal.player, 40);
assert.equal(normal.player.cash, 1200);

const boosted = fixture(true);
boosted.game.movePlayer(boosted.player, 40);
assert.equal(boosted.player.cash, 1400);

const pass = fixture(true);
pass.player.position = 38;
pass.game.movePlayer(pass.player, 3);
assert.equal(pass.player.cash, 1200);

console.log('double GO: 3 passed, 0 failed');
