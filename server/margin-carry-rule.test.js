// Pins the financing rule for margin and shorts. Margin debt and short borrow fees carry zero time cost: the margin balance stays at its opening value while the quote holds,
// maintenance moves only with the quote, and a short's borrow fee is one charge, collected and prorated when the short is covered. No round step accrues interest.
// The owner approved this economics, so a per-round charge needs a deliberate rule change and an updated suite.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { forceLiquidate } from './marketExpansion.js';

function marketRoom(complexity) {
  const room = new RoomManager().createRoom({ rulesProfile: 'advanced', socketId: 'a', clientId: 'a', nickname: 'A', rulesetOverrides: { bankLoans: true, casino: true, market: true, globalEvents: true }, marketComplexity: complexity });
  room.addOrReconnectPlayer({ socketId: 'b', clientId: 'b', nickname: 'B' });
  room.setRoomSetting('market', true);
  room.setRoomSetting('marketComplexity', complexity);
  assert.equal(room.startGame().success, true);
  room.game.currentPlayerId = room.game.players[0].id;
  return room;
}

// Margin: ten one-unit opens at a quote of 100, then twenty round checks with
// the quote held. Round checks run the forced-liquidation pass that every round
// step runs, so any per-round charge would move the balance or the cash.
{
  const room = marketRoom('margin');
  const game = room.game;
  const player = game.players[0];
  for (let index = 0; index < 10; index += 1) {
    player.marketActionsThisTurn = 0;
    game.marketQuotes.brazil = 100;
    assert.equal(room.openMargin('a', 'brazil', 1, `f37-open-${index}`).success, true);
  }
  assert.equal(player.marginBalance, 1000);
  assert.equal(player.marginMaintenance, 250);
  assert.equal(player.marginCollateral, 250);
  assert.equal(player.cash, 1230);

  for (let round = 0; round < 20; round += 1) {
    game.marketQuotes.brazil = 100;
    assert.deepEqual(forceLiquidate(game, player, {}), [], 'a held quote triggers no margin action');
  }
  assert.equal(player.marginBalance, 1000, 'margin debt does not accrue while the quote holds');
  assert.equal(player.marginMaintenance, 250, 'maintenance does not accrue with time');
  assert.equal(player.cash, 1230, 'no carrying cost is charged per round');

  // Positive control: the same pass does act once the quote falls, so the
  // checks above are not vacuous.
  game.marketQuotes.brazil = 50;
  const actions = forceLiquidate(game, player, {});
  assert.ok(actions.includes('margin-liquidation'), 'a quote drop reaches margin liquidation');
}

// Shorts: one borrow fee at open (1% of 1000 gross = 10), no fee on later
// rounds, and the fee is collected only when the short is covered.
{
  const room = marketRoom('shorting');
  const game = room.game;
  const player = game.players[0];
  game.marketQuotes.brazil = 100;
  assert.equal(room.openShort('a', 'brazil', 10, 'f37-short-open').success, true);
  assert.equal(player.shortPositions.brazil.borrowFee, 10);
  const cashAtOpen = player.cash;

  for (let round = 0; round < 20; round += 1) {
    game.marketQuotes.brazil = 100;
    forceLiquidate(game, player, game.marketShortInventory || {});
  }
  assert.equal(player.shortPositions.brazil.borrowFee, 10, 'the borrow fee does not accrue with time');
  assert.equal(player.cash, cashAtOpen, 'no short carrying cost is charged per round');

  // Cover at the same quote: the borrow fee (10) is collected with the $20 cover fee, and the $20 trade fee taken at open is part of the P&L,
  // so realized P&L is exactly -50: the seat received $980 at the open and paid $1,030 to buy the units back.
  player.marketActionsThisTurn = 0;
  game.marketQuotes.brazil = 100;
  const cover = room.coverShort('a', 'brazil', 10, 'f37-short-cover');
  assert.equal(cover.success, true);
  assert.equal(cover.realizedPnl, -50);
  assert.equal(player.shortPositions.brazil, undefined);
}

console.log('margin carry rule: margin and short financing pinned at zero time cost');
