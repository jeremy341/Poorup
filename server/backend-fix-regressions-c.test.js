// Regression suite for the sponsorship/economy defect repairs B-08, B-10, and
// B-22. Each check pins one audited defect and the corrected behavior:
//   B-08 a loan-backed bot must never be scheduled or counted as a funder,
//        because the server rejects the contribution it is scheduled for;
//   B-10 the short-default settlement path shares the market guard ladder, but
//        stays a forced obligation (off-turn, quota-exempt) by design;
//   B-22 an overfunded escrow returns the exact excess; the rounding dust is
//        absorbed by the sponsors, never gifted to the buyer.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { findPendingCounterpart } from './botCandidates.js';
import {
  isSponsorshipActor,
  runSponsorshipPhase,
  sponsorshipBuyerShouldCancel,
  sponsorshipContributionAmount
} from './sponsorshipLogic.js';

const failures = [];
function check(name, run) {
  try {
    run();
    console.log(`PASS - ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`FAIL - ${name}: ${error.stack || error.message}`);
  }
}

function seats(count, options = {}) {
  const manager = new RoomManager();
  const { maxPlayers, ...hostInfo } = options;
  const room = manager.createRoom({
    socketId: 'a', clientId: 'a', nickname: 'A',
    ...(maxPlayers > 4 ? { boardVariant: 'metro-52' } : {}),
    ...hostInfo
  });
  if (maxPlayers > 4) room.setRoomSetting('maxPlayers', maxPlayers);
  for (let index = 1; index < count; index += 1) {
    room.addOrReconnectPlayer({ socketId: String.fromCharCode(97 + index), clientId: String.fromCharCode(97 + index), nickname: String.fromCharCode(65 + index) });
  }
  assert.equal(room.startGame().success, true);
  assert.equal(room.game.players.length, count, `the fixture must seat ${count} players`);
  room.game.currentPlayerId = room.game.players[0].id;
  return room;
}

// A bot-only table with an open sponsored purchase: one short buyer bot, one
// cash-rich sponsor bot, and a purchase offer the buyer cannot fund alone.
function botSponsorshipRoom(options = {}) {
  const room = seats(2, { rulesetPreset: 'after-hours', ...options });
  const game = room.game;
  const [buyer, sponsor] = game.players;
  buyer.isBot = true;
  sponsor.isBot = true;
  buyer.cash = 20;
  sponsor.cash = 900;
  game.currentPlayerId = buyer.id;
  game.hasRolled = true;
  const tile = game.getTile(1);
  game.pendingPurchaseOffer = { playerId: buyer.id, tileIndex: tile.index, price: tile.price };
  assert.equal(game.requestPurchaseSponsorship('a').success, true);
  return { room, game, buyer, sponsor, sponsorship: game.pendingSponsoredPurchase };
}

check('a loan-backed bot is never scheduled or counted as a sponsorship funder (B-08)', () => {
  const { room, game, buyer, sponsor, sponsorship } = botSponsorshipRoom();
  sponsor.bankLoan = { status: 'active', remaining: 300, collateralTileIndex: null };

  // The server rejects this bot's contribution (sponsorshipApi.js:112), so it
  // must never be handed one: no amount, no actor seat, no turn target.
  assert.equal(sponsorshipContributionAmount(game, sponsor), 0,
    'a loan-backed bot must not be sized as a funder');
  assert.equal(isSponsorshipActor(game, sponsor), false,
    'a loan-backed bot must not claim the sponsorship actor seat');
  assert.equal(findPendingCounterpart(game)?.id, buyer.id,
    'the tainted bot must never be scheduled as the sponsorship counterpart; the buyer takes the seat to cancel');

  // Running the phase must no-op instead of burning a guaranteed rejection.
  const phase = runSponsorshipPhase(room, sponsor, game);
  assert.equal(phase.success, true);
  assert.equal(phase.noEmit, true);
  assert.equal(sponsor.cash, 900, 'no cash may move');
  assert.deepEqual(sponsorship.contributions, []);
  assert.equal(sponsor.lastSponsorRound, undefined,
    'a rejected attempt must not be treated as a settled sponsorship round');

  // The tainted bot no longer counts as a live funder, so the dead-request
  // cancellation can fire once a full round has passed.
  game.roundNumber = sponsorship.createdRound + 2;
  assert.equal(sponsorshipBuyerShouldCancel(game, buyer, sponsorship), true,
    'a request only a loan-backed bot could fund is dead and must be cancellable');

  // Clearing the loan restores the funder on the same state.
  sponsor.bankLoan = null;
  assert.ok(sponsorshipContributionAmount(game, sponsor) > 0);
  assert.equal(isSponsorshipActor(game, sponsor), true);
  assert.equal(findPendingCounterpart(game)?.id, sponsor.id);
  assert.equal(sponsorshipBuyerShouldCancel(game, buyer, sponsorship), false,
    'a fundable request is never dead');
});

check('short buy-in debt settlement shares the market guard ladder (B-10)', () => {
  const room = seats(2, { rulesetPreset: 'after-hours', marketComplexity: 'shorting' });
  const game = room.game;
  const player = game.players[0];
  player.shortDefaultDebt = 200;
  player.cash = 600;
  game.settings.marketComplexity = 'shorting';

  player.bankLoan = { status: 'active', remaining: 300, collateralTileIndex: null };
  assert.deepEqual(room.settleShortDefault('a', 200, 'b10-loan'), {
    success: false, error: 'Loan-backed cash cannot fund margin, short, or option positions.'
  });
  assert.equal(player.cash, 600, 'a rejected settlement must not debit cash');
  assert.equal(player.shortDefaultDebt, 200, 'a rejected settlement must not retire debt');
  player.bankLoan = null;

  game.settings.market = false;
  assert.deepEqual(room.settleShortDefault('a', 200, 'b10-market-off'), {
    success: false, error: 'Market access is off for this room.'
  });
  game.settings.market = true;

  game.settings.marketComplexity = 'basic';
  assert.deepEqual(room.settleShortDefault('a', 200, 'b10-complexity'), {
    success: false, error: 'Market complexity SHORTING is not enabled.'
  });
  game.settings.marketComplexity = 'shorting';

  // Table obligations still block: the pinned pendingPayment guard is shared.
  game.pendingPayment = { playerId: player.id, creditorId: null, amountRemaining: 10, reason: 'rent' };
  assert.deepEqual(room.settleShortDefault('a', 10, 'b10-pending'), {
    success: false, error: 'Resolve the table obligation before trading.'
  });
  assert.equal(player.shortDefaultDebt, 200);
  game.pendingPayment = null;
});

check('short buy-in debt stays a forced obligation: off-turn, quota-exempt, tradeable in bank-run (B-10 intent)', () => {
  // marketExpansion.js:419-421 documents this path as reachable "on a later
  // turn or before opening another market position", so neither the turn gate
  // nor the per-turn market quota may apply to it.
  const room = seats(2, { rulesetPreset: 'after-hours', marketComplexity: 'shorting' });
  const game = room.game;
  const [player, other] = game.players;
  player.shortDefaultDebt = 200;
  player.cash = 600;
  player.marketActionsThisTurn = 1;
  game.currentPlayerId = other.id;
  game.globalEvent = {
    id: 'bank-run', phase: 'active',
    effects: { bankActionsBlocked: true, tradingEnabled: false, casinoMaxBet: 250 }
  };

  const settled = room.settleShortDefault('a', 200, 'b10-forced');
  assert.equal(settled.success, true);
  assert.equal(settled.paid, 200);
  assert.equal(settled.remaining, 0);
  assert.equal(player.cash, 400);
  assert.equal(player.shortDefaultDebt, 0);
  assert.equal(player.marketActionsThisTurn, 1,
    'debt settlement must not consume the per-turn market quota');
  assert.deepEqual(room.settleShortDefault('a', 50, 'b10-no-debt'), {
    success: false, error: 'There is no short buy-in debt to settle.'
  });
});

check('an overfunded escrow returns the exact excess instead of gifting the buyer the dust (B-22)', () => {
  const room = seats(4, { rulesetPreset: 'after-hours' });
  const game = room.game;
  const [buyer, first, second, third] = game.players;
  const tile = game.getTile(1);
  tile.price = 260;
  buyer.cash = 20;
  [first, second, third].forEach(sponsor => { sponsor.cash = 1000; });
  game.currentPlayerId = buyer.id;
  game.hasRolled = true;
  game.pendingPurchaseOffer = { playerId: buyer.id, tileIndex: tile.index, price: tile.price };
  assert.equal(game.requestPurchaseSponsorship('a').success, true);

  // Pro-rata shares of a $10 excess are 3.3 / 3.3 / 3.4: flooring every one
  // of them loses a dollar that the buyer used to receive.
  const contributions = [[first, 33], [second, 33], [third, 34]];
  contributions.forEach(([sponsor, amount], index) => {
    assert.equal(game.contributeToSponsoredPurchase(String.fromCharCode(98 + index), { amount }).success, true);
    assert.equal(sponsor.cash, 1000 - amount);
  });
  buyer.cash = 170;
  const accepted = game.acceptSponsoredPurchase('a');
  assert.equal(accepted.success, true);
  assert.equal(accepted.contributionTotal, 100);

  const excess = 100 - (260 - 170);
  assert.equal(excess, 10);
  const refunded = contributions.map(([sponsor, amount]) => sponsor.cash - (1000 - amount));
  assert.equal(refunded.reduce((sum, share) => sum + share, 0), excess,
    'the escrow excess must be refunded in full, with no rounding created or destroyed');
  assert.equal(buyer.cash, 0, 'the buyer must receive none of the excess, not even rounding dust');
  assert.deepEqual(refunded, [3, 3, 4], 'largest-remainder shares: the sponsors absorb the rounding');
});

check('overfunded escrow conservation holds for every contributor split (B-22)', () => {
  for (const shares of [[1, 1], [3, 4], [10, 10, 10], [1, 2, 3, 4], [7, 11, 13], [50, 25, 25], [2, 2, 2, 2, 1]]) {
    const room = seats(shares.length + 1, { rulesetPreset: 'after-hours', maxPlayers: shares.length + 1 });
    const game = room.game;
    const [buyer, ...sponsors] = game.players;
    const tile = game.getTile(1);
    tile.price = 500;
    buyer.cash = 0;
    sponsors.forEach(sponsor => { sponsor.cash = 1000; });
    game.currentPlayerId = buyer.id;
    game.hasRolled = true;
    game.pendingPurchaseOffer = { playerId: buyer.id, tileIndex: tile.index, price: tile.price };
    assert.equal(game.requestPurchaseSponsorship('a').success, true);
    shares.forEach((amount, index) => {
      assert.equal(game.contributeToSponsoredPurchase(String.fromCharCode(98 + index), { amount }).success, true);
    });
    const total = shares.reduce((sum, amount) => sum + amount, 0);
    // The buyer earns enough mid-escrow to overfund the escrow; the excess can
    // never exceed the escrow total itself (the need floors at zero).
    const excess = Math.min(7, total);
    buyer.cash = 500 - total + excess;
    assert.equal(game.acceptSponsoredPurchase('a').success, true);
    const refunded = sponsors.reduce((sum, sponsor, index) => sum + (sponsor.cash - (1000 - shares[index])), 0);
    assert.equal(refunded, excess, `shares ${shares.join('/')} must refund the full excess`);
    assert.equal(buyer.cash, 0, `shares ${shares.join('/')} must leave the buyer with nothing`);
  }
});

if (failures.length) {
  console.error(`\nbackend audit regressions (C): ${failures.length} failed`);
  process.exitCode = 1;
} else {
  console.log('backend audit regressions (C): all passed');
}
