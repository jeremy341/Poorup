import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';

const manager = new RoomManager();
const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A' });
room.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B' });
room.setRoomSetting('market', true);
assert.equal(room.startGame().success, true);
const game = room.game;
const [a, b] = game.players;
assert.equal(game.tradeMarket('socket-a', 'brazil', 'buy', 1, 'private-a').success, true);
game.currentPlayerId = b.id;
b.marketActionsThisTurn = 0;
assert.equal(game.tradeMarket('socket-b', 'japan', 'buy', 2, 'private-b').success, true);

const aTrades = game.economySnapshot(a.id).market.personalTrades;
const bTrades = game.economySnapshot(b.id).market.personalTrades;
assert.equal(aTrades.length, 1);
assert.equal(aTrades[0].instrumentId, 'brazil');
assert.deepEqual(Object.keys(aTrades[0]).sort(), ['fee', 'instrumentId', 'quantity', 'quote', 'roundNumber', 'side']);
assert.equal(bTrades.length, 1);
assert.equal(bTrades[0].instrumentId, 'japan');
assert.equal(game.summaryEconomy().market.personalTrades, undefined);

game.marketLedger = Array.from({ length: 140 }, (_, index) => ({
  playerId: a.id,
  roundNumber: 139 - index,
  instrumentId: 'brazil',
  side: index % 2 ? 'sell' : 'buy',
  quantity: 1,
  quote: 100 + index,
  fee: 2,
}));
const recentTrades = game.economySnapshot(a.id).market.personalTrades;
assert.equal(recentTrades.length, 128);
assert.equal(recentTrades[0].roundNumber, 139);
assert.equal(recentTrades.at(-1).roundNumber, 12);
console.log('market viewer projection: private trade snapshots stay seat-scoped');
