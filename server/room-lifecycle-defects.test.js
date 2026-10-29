// Regression checks for room lifecycle defects.
// Drives RoomManager / Room directly, the same objects the socket handlers call.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';

function setupStarted(humans = 3) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 's0', clientId: 'c0', nickname: 'P0' });
  manager.socketRoom.set('s0', room);
  for (let i = 1; i < humans; i += 1) {
    room.addOrReconnectPlayer({ socketId: `s${i}`, clientId: `c${i}`, nickname: `P${i}` });
    manager.socketRoom.set(`s${i}`, room);
  }
  assert.equal(room.startGame().success, true);
  return { manager, room, game: room.game };
}

// A parked debt whose creditor leaves must still resolve the debtor's roll,
// otherwise the debtor can neither roll again nor end the turn.
{
  const { manager, game } = setupStarted(3);
  const [debtor, creditor] = game.players;
  game.currentPlayerId = debtor.id;
  game.hasRolled = true;
  game.awaitingEndTurn = false;
  debtor.cash = 50;
  game.chargePlayer({ player: debtor, creditor, amount: 400, message: 'P0 owes P1 rent', turnOptions: {} });
  assert.equal(game.pendingPayment?.playerId, debtor.id, 'the debt is parked');
  assert.equal(manager.removeRoomSeat({ clientId: 'c1', socketId: 's1' }).success, true);
  assert.equal(game.pendingPayment, null, 'the debt dies with its creditor');
  assert.equal(game.currentPlayerId, debtor.id, 'the debtor keeps the turn');
  assert.equal(game.awaitingEndTurn, true, 'the debtor roll resolves once the debt is gone');
  // The partial tender left the debtor at $0, and a $0 seat must raise cash or go
  // bankrupt (deliberate rule); give it cash so only the wedge is under test.
  debtor.cash = 25;
  assert.equal(game.endTurn('s0').success, true, 'the debtor can end the turn');
}

// control: a debtor who has not rolled (an off-turn debt) is not marked as having landed.
{
  const { manager, game } = setupStarted(3);
  const [current, creditor, debtor] = game.players;
  game.currentPlayerId = current.id;
  game.hasRolled = false;
  game.awaitingEndTurn = false;
  debtor.cash = 10;
  game.chargePlayer({ player: debtor, creditor, amount: 300, message: 'P2 owes P1', turnOptions: {} });
  assert.equal(manager.removeRoomSeat({ clientId: 'c1', socketId: 's1' }).success, true);
  assert.equal(game.pendingPayment, null);
  assert.equal(game.awaitingEndTurn, false, 'an off-turn debtor does not resolve the current roll');
  assert.equal(game.hasRolled, false);
}

// The current seat leaves while it has rolled and only one other seat is
// connected (the third is in reconnect grace). The inheriting seat must get a
// fresh turn, not the leaver's roll state.
{
  const { manager, game } = setupStarted(3);
  const [leaver, inheritor, away] = game.players;
  game.currentPlayerId = leaver.id;
  game.hasRolled = true;
  game.awaitingEndTurn = true;
  away.disconnected = true;
  away.disconnectDeadline = Date.now() + 60_000;
  away.socketId = null;
  manager.socketRoom.delete('s2');
  assert.equal(manager.removeRoomSeat({ clientId: 'c0', socketId: 's0' }).success, true);
  assert.equal(game.started, true, 'the table waits on the seat in grace');
  assert.equal(game.currentPlayerId, inheritor.id);
  assert.equal(game.hasRolled, false, 'the inheriting seat has not rolled');
  assert.equal(game.awaitingEndTurn, false, 'the inheriting seat is not awaiting end-turn');
  assert.equal(manager.restoreConnection('c2', 's2b') !== null, true, 'the seat in grace reconnects');
  assert.equal(game.rollDice('s1').success, true, 'the inheriting seat can roll');
}

// A vote-kick block in one room must not stop account-seat recovery in another.
{
  const manager = new RoomManager();
  const roomA = manager.createRoom({ socketId: 'a-host', clientId: 'a-host-c', nickname: 'HostA' });
  manager.socketRoom.set('a-host', roomA);
  roomA.addOrReconnectPlayer({ socketId: 'a-v', clientId: 'a-v-c', nickname: 'Victim', accountId: 'acct-V' });
  manager.socketRoom.set('a-v', roomA);
  assert.equal(manager.removeRoomSeat({ clientId: 'a-v-c', socketId: 'a-v', reason: 'vote-kick', preventRejoin: true, room: roomA }).success, true);
  manager.socketRoom.delete('a-v');
  const roomB = manager.createRoom({ socketId: 'b-host', clientId: 'b-host-c', nickname: 'HostB' });
  manager.socketRoom.set('b-host', roomB);
  roomB.addOrReconnectPlayer({ socketId: 'b-v', clientId: 'b-v-c', nickname: 'Victim', accountId: 'acct-V' });
  manager.socketRoom.set('b-v', roomB);
  roomB.addOrReconnectPlayer({ socketId: 'b-3', clientId: 'b-3-c', nickname: 'Third' });
  assert.equal(roomB.startGame().success, true);
  const seat = roomB.game.getPlayerByClient('b-v-c');
  seat.disconnected = true;
  seat.socketId = null;
  seat.disconnectDeadline = Date.now() + 60_000;
  manager.socketRoom.delete('b-v');
  const recovered = manager.restoreConnection('b-v-c-fresh', 'b-v-2', 'acct-V');
  assert.equal(recovered, roomB, 'the kick in room A does not block recovery of the seat in room B');
  // The block still applies to the room that kicked the account.
  assert.equal(roomA.addOrReconnectPlayer({ socketId: 'a-v-2', clientId: 'a-v-c-2', nickname: 'Victim', accountId: 'acct-V' }).success, false);
}

// A lobby seat in disconnect grace still holds capacity, so the directory must
// not advertise it as an open seat.
{
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'h', clientId: 'hc', nickname: 'Host' });
  room.setRoomSetting('maxPlayers', 2);
  room.addOrReconnectPlayer({ socketId: 'g', clientId: 'gc', nickname: 'Guest' });
  assert.equal(room.getDirectorySummary().seats, 2);
  const guest = room.game.getPlayerByClient('gc');
  guest.disconnected = true;
  guest.socketId = null;
  guest.disconnectDeadline = Date.now() + 60_000;
  const listing = room.getDirectorySummary();
  assert.equal(listing.seats, listing.cap, 'the ghost seat still counts toward the advertised seats');
  assert.equal(room.addOrReconnectPlayer({ socketId: 'n', clientId: 'nc', nickname: 'Newcomer' }).success, false, 'and the room really is full');
}

// control: once a match is live the listing still counts connected seats only.
{
  const { room, game } = setupStarted(3);
  const away = game.players[2];
  away.disconnected = true;
  away.socketId = null;
  away.disconnectDeadline = Date.now() + 60_000;
  assert.equal(room.getDirectorySummary().seats, 2, 'a live match lists connected seats');
}

// Eliminated seats are revived for the rematch, so the post-game lobby
// must count them against capacity.
{
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'sa', clientId: 'ca', nickname: 'A' });
  ['b', 'c', 'd'].forEach(letter => room.addOrReconnectPlayer({ socketId: `s${letter}`, clientId: `c${letter}`, nickname: letter.toUpperCase() }));
  const capacity = room.settings.maxPlayers;
  assert.equal(room.game.players.length, capacity, 'the table is full');
  assert.equal(room.startGame().success, true);
  const [a, , , d] = room.game.players;
  room.game.currentPlayerId = a.id;
  room.game.declareBankruptcy(d.socketId);
  room.game.endGame(a);
  assert.equal(room.game.started, false);
  const joined = room.addOrReconnectPlayer({ socketId: 'se', clientId: 'ce', nickname: 'E' });
  assert.equal(joined.success, false, 'the post-game lobby is full while an eliminated seat is retained');
  assert.equal(joined.error, 'Room is full.');
  assert.equal(room.game.players.length, capacity);
  assert.equal(room.startGame().success, true);
  assert.equal(room.game.turnOrder.length, capacity, 'the rematch never exceeds maxPlayers');
}

// The estate cash settles the creditor's own parked debt. The creditor was
// gated on a debt it could not cover; the incoming estate cash may cover it
// now, and the table must not stay blocked behind a settled seat.
{
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'd9-estate', clientId: 'd9-estate', nickname: 'Estate' });
  ['creditor', 'debtor', 'quiet'].forEach(name => room.addOrReconnectPlayer({ socketId: `d9-${name}`, clientId: `d9-${name}`, nickname: name }));
  assert.equal(room.startGame().success, true);
  const game = room.game;
  const [estate, creditor, debtor] = game.players;
  creditor.cash = 50;
  game.chargePlayer({ player: creditor, creditor: debtor, amount: 400, message: 'Creditor owes Debtor', turnOptions: {} });
  assert.equal(game.pendingPayment?.playerId, creditor.id, 'the creditor has a parked debt');
  assert.equal(game.hasPendingDebt(creditor.id), true, 'and the parked debt gates the seat');
  estate.cash = 500;
  game.handleBankruptcy(estate, creditor);
  assert.equal(game.pendingPayment, null, "the estate cash settles the creditor's parked debt");
  assert.equal(game.hasPendingDebt(creditor.id), false, 'the creditor is no longer gated');
  assert.equal(creditor.cash, 150, 'the estate cash paid the parked debt');
  assert.equal(debtor.cash, 1900, 'the creditor of the parked debt is paid');
  assert.equal(game.started, true, 'the table is not held hostage by the gated seat');
}

console.log('rooms audit fixes: 8 scenarios passed');
