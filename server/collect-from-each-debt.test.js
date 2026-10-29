// Cash a collect-from-each card brings in settles the collector's own parked debt, through the same settleCardRecipientDebt path the pay-each
// card uses (applyCard.test.js "payEach settles a recipient parked debt"). A short payer is still forgiven the shortfall.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';

const results = [];
function check(name, fn) {
  try {
    fn();
    results.push(true);
    console.log(`PASS - ${name}`);
  } catch (error) {
    results.push(false);
    console.log(`FAIL - ${name}: ${error.message}`);
  }
}

function trio() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 's-a', clientId: 'c-a', nickname: 'Ada' });
  room.addOrReconnectPlayer({ socketId: 's-b', clientId: 'c-b', nickname: 'Bob' });
  room.addOrReconnectPlayer({ socketId: 's-c', clientId: 'c-c', nickname: 'Cara' });
  const game = room.game;
  game.started = true;
  game.currentPlayerId = game.players[0].id;
  game.hasRolled = true;
  return { game, players: game.players };
}

const parkDebt = (game, debtor, creditor, amount) => {
  game.pendingPayment = {
    playerId: debtor.id,
    creditorId: creditor.id,
    amountRemaining: amount,
    reason: 'parked rent',
    equityTileIndex: null,
    equityOwnerId: null
  };
};

check('collectFromEach settles a collector parked debt from the collected cash', () => {
  const { game, players: [collector, payer, creditor] } = trio();
  collector.cash = 0;
  payer.cash = 1000;
  creditor.cash = 1000;
  parkDebt(game, collector, creditor, 80);
  game.applyCard(collector, { action: 'collectFromEach', amount: 50 }, {});
  // The collector takes $50 from each of the two others ($100), then the
  // parked $80 is paid to the creditor out of it.
  assert.equal(game.pendingPayment, null, 'the parked debt is settled');
  assert.equal(collector.cash, 20);
  assert.equal(payer.cash, 950);
  assert.equal(creditor.cash, 1000 - 50 + 80);
});

check('collectFromEach leaves a debt parked when the collected cash cannot cover it', () => {
  const { game, players: [collector, payer, creditor] } = trio();
  collector.cash = 0;
  payer.cash = 1000;
  creditor.cash = 1000;
  parkDebt(game, collector, creditor, 500);
  game.applyCard(collector, { action: 'collectFromEach', amount: 50 }, {});
  assert.equal(game.pendingPayment?.playerId, collector.id, 'the debt stays parked');
  assert.equal(collector.cash + creditor.cash + payer.cash, 3000 - 1000, 'no cash is created or lost');
});

check('collectFromEach does not settle a debt the collector does not owe', () => {
  const { game, players: [collector, debtor, creditor] } = trio();
  collector.cash = 0;
  debtor.cash = 1000;
  creditor.cash = 1000;
  parkDebt(game, debtor, creditor, 900);
  game.applyCard(collector, { action: 'collectFromEach', amount: 50 }, {});
  assert.equal(game.pendingPayment?.playerId, debtor.id);
  assert.equal(game.pendingPayment?.amountRemaining, 900);
  assert.equal(collector.cash, 100);
});

const failed = results.filter(r => !r).length;
console.log(`\ncollect-from-each debt tests: ${results.length - failed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
