// Regression suite for B-18 (docs/research/ECONOMY-AUDIT-2026-10-01.md):
// equity rent income scored as zero.
//
// settleEquityPayout booked the holder's payout as raw cash and on the
// per-contract ledger, so a part-sold deed never reached the player-level rent
// facts that season scoring, the leaderboard and the rent-reaper achievement
// all read. A 100% equity landlord scored 0 rent for income they actually
// received, while the deed owner was scored the full rent even though the
// share was drained out of their cash afterwards.
//
// Rent is now credited to whoever keeps the money: the holder goes through
// creditRentTo (cash + rentCollected + the payer sets + the round max) and the
// owner's own rentCollected is reduced by the payout it gave away.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';

function makeRoom() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A' });
  room.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B' });
  assert.equal(room.startGame().success, true);
  return room;
}

// A room where `owner` holds tile 1 and `lender` has bought `sharePct` of its
// equity. Returns the live handles the assertions need.
function equityRoom(sharePct) {
  const room = makeRoom();
  const game = room.game;
  const [lender, owner] = game.players;
  const tile = game.getTile(1);
  tile.ownerId = owner.id;
  owner.properties.push(tile.index);
  game.currentPlayerId = lender.id;
  const proposal = room.proposePlayerContract('socket-a', {
    toPlayerId: owner.id, kind: 'equity', amount: 100, equityShare: sharePct, propertyIndex: tile.index, permanent: true
  });
  assert.equal(proposal.success, true, `equity proposal for ${sharePct}% must succeed`);
  assert.equal(room.respondPlayerContract('socket-b', true).success, true);
  const contract = game.playerContracts.find(entry => entry.kind === 'equity');
  assert.ok(contract, 'an equity contract exists');
  return { room, game, lender, owner, tile, contract };
}

// --- the defect itself ------------------------------------------------------

test('B-18 the equity holder scores the rent it receives', () => {
  const ctx = equityRoom(50);
  const baseRent = ctx.game.calculateRent(ctx.tile);
  const share = Math.floor(baseRent * 0.5);
  assert.ok(share > 0, 'precondition: this tile yields a share worth scoring');

  ctx.game.handleBuyableTile(ctx.lender, ctx.tile, { allowExtraRoll: false });

  assert.equal(ctx.lender.rentCollected, share,
    'the holder scored zero rent for real cash it received (B-18)');
  assert.equal(ctx.owner.rentCollected, baseRent - share,
    'the owner is scored only on the rent it kept, not the rent it gave away');
});

test('B-18 a fully-sold deed scores the holder and leaves the owner nothing', () => {
  const ctx = equityRoom(100);
  const baseRent = ctx.game.calculateRent(ctx.tile);

  ctx.game.handleBuyableTile(ctx.lender, ctx.tile, { allowExtraRoll: false });

  assert.equal(ctx.lender.rentCollected, baseRent, 'a 100% share scores the whole rent');
  assert.equal(ctx.owner.rentCollected, 0, 'the owner keeps none of it, so it scores none of it');
});

test('B-18 the per-contract ledger still accrues the payout', () => {
  const ctx = equityRoom(50);
  const baseRent = ctx.game.calculateRent(ctx.tile);
  ctx.game.handleBuyableTile(ctx.lender, ctx.tile, { allowExtraRoll: false });
  // gameLogic.test.js pins this exact assertion; the contract-level total must
  // survive the switch to player-level scoring.
  assert.equal(ctx.contract.rentCollected, Math.floor(baseRent * 0.5));
});

// --- conservation -----------------------------------------------------------

test('B-18 player rent totals still add up to the rent charged', () => {
  const ctx = equityRoom(50);
  const baseRent = ctx.game.calculateRent(ctx.tile);
  ctx.game.handleBuyableTile(ctx.lender, ctx.tile, { allowExtraRoll: false });
  assert.equal(ctx.owner.rentCollected + ctx.lender.rentCollected, baseRent,
    'attribution moved, it did not create or destroy rent');
});

test('B-18 scoring the holder did not change the cash that moved', () => {
  const ctx = equityRoom(50);
  const baseRent = ctx.game.calculateRent(ctx.tile);
  const share = Math.floor(baseRent * 0.5);
  const lenderBefore = ctx.lender.cash;
  const ownerBefore = ctx.owner.cash;

  ctx.game.handleBuyableTile(ctx.lender, ctx.tile, { allowExtraRoll: false });

  // Exactly the economics gameLogic.test.js already pinned.
  assert.equal(ctx.lender.cash, lenderBefore - baseRent + share);
  assert.equal(ctx.owner.cash, ownerBefore + baseRent - share);
});

// --- the achievements / leaderboard consumers -------------------------------

test('B-18 equity rent counts toward the payer sets and the rent-reaper max', () => {
  const ctx = equityRoom(50);
  ctx.game.handleBuyableTile(ctx.lender, ctx.tile, { allowExtraRoll: false });
  // achievementStore.js gates 'rent-reaper' on maxRentPayersInRound >= 3, which
  // only creditRentTo writes. Equity income must reach it.
  assert.equal(ctx.lender.rentPayerIds.has(ctx.lender.id), true,
    'the holder records who paid them');
  assert.ok(ctx.lender.maxRentPayersInRound >= 1,
    'the holder earns a round participation count from equity rent');
});

// --- B-21 carry-forward still holds, and stays consistent -------------------

test('B-18 a short owner carries the share without driving rent scoring negative', () => {
  const ctx = equityRoom(100);
  const baseRent = ctx.game.calculateRent(ctx.tile);
  // Starve the owner so the share cannot be paid in full: this is the B-21 path.
  ctx.owner.cash = 3;
  const owed = Math.floor(baseRent * 1);
  assert.ok(owed > 3, 'precondition: the owner cannot cover the whole share');

  ctx.game.handleBuyableTile(ctx.lender, ctx.tile, { allowExtraRoll: false });

  assert.equal(ctx.owner.rentCollected, 0, 'a clamped payout leaves the owner scoring nothing, never a negative');
  assert.ok(ctx.lender.rentCollected >= 0, 'the holder total is never negative');
  assert.ok(Number.isInteger(ctx.lender.rentCollected), 'rent scoring stays integer');
});

test('B-18 a later full payment settles the carry and balances the books', () => {
  const ctx = equityRoom(100);
  const owed = 100;
  // Drive the share settlement directly with a broke owner. Going through
  // handleBuyableTile would credit the owner the rent first, and at a 100%
  // share they could then always cover it - which is why the B-21 regression
  // exercises this path directly too.
  ctx.owner.cash = 0;
  ctx.game.settleEquityShares(ctx.tile, ctx.owner, owed, ctx.lender);
  assert.equal(ctx.contract.unpaidRentShare, owed, 'precondition: the unpaid remainder is carried on the contract');
  assert.equal(ctx.owner.rentCollected, 0, 'a clamped payout leaves the owner scoring nothing, never a negative');

  // Fund the owner and settle again. The carried amount is paid out of this
  // collection and the owner's rent total must still land on zero, because a
  // 100% share leaves them nothing across both settlements.
  ctx.owner.cash = 5000;
  ctx.owner.rentCollected = owed; // the owner's own rent credit for this collection
  ctx.game.settleEquityShares(ctx.tile, ctx.owner, owed, ctx.lender);

  assert.equal(ctx.contract.unpaidRentShare, 0, 'the carry is cleared once the owner can pay');
  assert.equal(ctx.owner.rentCollected, 0, 'the owner never scores rent they gave away, across the carry');
  assert.equal(ctx.lender.rentCollected, owed * 2, 'the holder scored both settlements in full');
});

// --- controls ---------------------------------------------------------------

test('B-18 a tile with no equity share is untouched', () => {
  const room = makeRoom();
  const game = room.game;
  const [payer, owner] = game.players;
  const tile = game.getTile(1);
  tile.ownerId = owner.id;
  owner.properties.push(tile.index);
  const baseRent = game.calculateRent(tile);

  game.handleBuyableTile(payer, tile, { allowExtraRoll: false });

  assert.equal(owner.rentCollected, baseRent, 'an unencumbered deed still scores its owner the full rent');
  assert.equal(payer.rentCollected || 0, 0, 'the payer still scores no rent');
});

test('B-18 a direct settle with no identified payer still books the holder', () => {
  const ctx = equityRoom(50);
  const baseRent = ctx.game.calculateRent(ctx.tile);
  // The internal entry point used where no payer is tracked: cash must move and
  // the holder must still be scored, just without the payer bookkeeping.
  ctx.game.settleEquityShares(ctx.tile, ctx.owner, baseRent, null);
  assert.equal(ctx.lender.rentCollected, Math.floor(baseRent * 0.5),
    'the no-payer fallback must not silently score the holder at zero again');
  assert.equal(ctx.owner.rentCollected, 0);
});