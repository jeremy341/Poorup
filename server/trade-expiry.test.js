// An unanswered trade offer lapses so it stops blocking the table.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';

const manager = new RoomManager();
const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A' });
room.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B' });
assert.equal(room.startGame().success, true);
const game = room.game;
const [a, b] = game.players;

assert.equal(game.expireStaleTrade(Date.now(), 120_000), false, 'nothing to expire without a pending trade');
game.pendingTrade = { id: 't1', fromPlayerId: a.id, fromPlayerName: a.nickname, toPlayerId: b.id, toPlayerName: b.nickname, giveCash: 10, requestCash: 0, givePropertyIndexes: [], requestPropertyIndexes: [], createdAt: 1_000 };
assert.equal(game.expireStaleTrade(1_000 + 119_999, 120_000), false, 'a fresh offer stays');
assert.ok(game.pendingTrade, 'the offer is still pending');
assert.equal(game.expireStaleTrade(1_000 + 120_000, 120_000), true, 'an offer past the window expires');
assert.equal(game.pendingTrade, null, 'the table is free for other trades again');
game.pendingTrade = { id: 't2', fromPlayerId: a.id, toPlayerId: b.id };
assert.equal(game.expireStaleTrade(Date.now() + 1e9, 120_000), false, 'an offer without a timestamp is left alone');

console.log('trade expiry: 5 passed');
