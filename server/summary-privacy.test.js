import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';

const manager = new RoomManager();
const room = manager.createRoom({ socketId: 'a', clientId: 'a', nickname: 'A' });
room.addOrReconnectPlayer({ socketId: 'b', clientId: 'b', nickname: 'B' });
room.game.players[0].accountId = 'acct-a';
room.game.players[1].accountId = 'acct-b';
const publicSummary = room.game.getGameSummary();
assert.equal(publicSummary.players.every(player => player.accountId === null), true);
assert.equal(publicSummary.players.every(player => typeof player.roomPlayerId === 'string'), true);
const owner = room.game.getGameSummary(room.game.players[0].id);
assert.equal(owner.players.find(player => player.id === room.game.players[0].id).accountId, 'acct-a');
const roomSummary = room.getRoomSummary();
assert.equal(roomSummary.players.every(player => player.accountId === null), true);

console.log('summary privacy audit: 1 passed, 0 failed');

// The deed manager uses the runtime quote, including complete-set and mortgage rules.
for (const index of [1, 3]) {
  room.game.getTile(index).ownerId = room.game.players[0].id;
  room.game.players[0].properties.push(index);
}
const rentTile = room.game.getTile(1);
assert.equal(room.game.getGameSummary().tiles.find(tile => tile.index === 1).currentRent, room.game.calculateRent(rentTile));
rentTile.mortgaged = true;
assert.equal(room.game.getGameSummary().tiles.find(tile => tile.index === 1).currentRent, 0);
rentTile.mortgaged = false;
for (const index of [1, 3]) room.game.getTile(index).ownerId = null;
room.game.players[0].properties = [];

// Endgame standings come from the same server placement policy used for
// account results; final net worth is public only after the game ends.
const game = room.game;
const [winner, tiedRival] = game.players;
game.players.push({ id: 'bankrupt', cash: 9000, bankrupt: true, properties: [] });
game.players.push({ id: 'ghost', cash: 50000, disconnected: true, properties: [] });
winner.cash = tiedRival.cash = 1200;
game.started = false;
game.roundNumber = 1;
game.lastWinner = { id: winner.id, nickname: winner.nickname };
const finalSummary = game.getGameSummary();
assert.equal(finalSummary.finalPlacements[winner.id], 1, 'crowned winner leads tied cash');
assert.ok(finalSummary.finalPlacements[tiedRival.id] > 1);
assert.ok(finalSummary.finalPlacements.bankrupt > finalSummary.finalPlacements[tiedRival.id]);
assert.ok(finalSummary.finalPlacements.ghost > finalSummary.finalPlacements.bankrupt);
assert.equal(Object.keys(finalSummary.finalPlacements).length, game.players.length);
assert.equal(Object.values(finalSummary.finalPlacements).every(Number.isInteger), true);
assert.equal(game.getGameSummary().players.some(player => Object.hasOwn(player, 'bankBalance')), false);
game.started = true;
assert.equal(game.getGameSummary().finalPlacements, null, 'in-progress rematch clears final standings');
assert.equal(game.getGameSummary().players.every(player => player.finalNetWorth === null), true,
  'in-progress summaries do not expose a final result score');

// Last standing is a solvency result, not a cash race. A positive-cash
// bankrupt seat remains in the standings with its explicit elimination state.
game.started = false;
winner.cash = 50;
tiedRival.cash = 9000;
tiedRival.bankrupt = true;
game.roundNumber = 2;
game.endGame(winner, { reason: 'last-standing' });
const lastStandingSummary = JSON.parse(JSON.stringify(game.getGameSummary()));
assert.equal(lastStandingSummary.finalPlacements[winner.id], 1);
assert.equal(lastStandingSummary.players.find(player => player.id === tiedRival.id).bankrupt, true);
assert.equal(lastStandingSummary.players.find(player => player.id === tiedRival.id).cash, 9000,
  'positive cash on an eliminated seat stays visible alongside elimination status');
assert.equal(lastStandingSummary.players.find(player => player.id === winner.id).finalNetWorth, 50);
