import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';

function fixture(settings = { rulesProfile: 'advanced', playerFinance: true }) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'owner', clientId: 'owner', nickname: 'Owner' });
  room.addOrReconnectPlayer({ socketId: 'investor', clientId: 'investor', nickname: 'Investor' });
  room.addOrReconnectPlayer({ socketId: 'other', clientId: 'other', nickname: 'Other' });
  for (const [key, value] of Object.entries(settings)) room.setRoomSetting(key, value);
  assert.equal(room.startGame().success, true);
  const game = room.game;
  const [owner, investor, other] = game.players;
  game.currentPlayerId = owner.id;
  const tile = game.getTile(1);
  tile.ownerId = owner.id;
  owner.properties.push(tile.index);
  return { manager, room, game, owner, investor, other, tile };
}
function propose(ctx, extra = {}) {
  return ctx.game.proposePlayerContract('investor', { toPlayerId: ctx.owner.id, kind: 'equity', amount: 80, propertyIndex: ctx.tile.index, equityShare: 25, ...extra });
}
function activate(ctx, extra = {}) {
  const offer = propose(ctx, extra);
  assert.equal(offer.success, true, offer.error);
  const result = ctx.game.respondPlayerContract('owner', true, 'accept', offer.contract.id);
  assert.equal(result.success, true, result.error);
  return result.contract;
}
const cases = [];
function check(name, fn) { cases.push([name, fn]); }
check('new rent shares have finite server-authored passive terms', () => {
  const ctx = fixture();
  const contract = activate(ctx, { rulesVersion: 99, rentShareVersion: 99 });
  assert.equal(contract.rulesVersion, 2);
  assert.equal(contract.rentShareVersion, 1);
  assert.equal(contract.durationRounds, 3);
  assert.equal(contract.expiresRound, ctx.game.roundNumber + 3);
  assert.equal(contract.permanent, false);
  assert.equal(contract.equityControl, 'passive');
});
check('new deprecated terms fail explicitly', () => {
  for (const extra of [{ kind: 'hybrid' }, { permanent: true }, { expiresRound: null }, { equityControl: 'shared' }, { equityControl: 'controlling' }, { durationRounds: 0 }, { durationRounds: 21 }]) {
    const ctx = fixture();
    const result = propose(ctx, extra);
    assert.equal(result.success, false, JSON.stringify(extra));
    assert.match(result.error, /rent share|temporary|passive|duration|hybrid/i);
  }
});
check('Standard with finance enabled supports new temporary rent shares', () => {
  const ctx = fixture({ rulesProfile: 'standard', playerFinance: true });
  const contract = activate(ctx);
  assert.equal(contract.rulesVersion, 2);
  assert.equal(contract.rentShareVersion, 1);
  assert.equal(contract.permanent, false);
  assert.equal(contract.equityControl, 'passive');
});
check('finance-off blocks new proposals and proposal replay on every profile', () => {
  for (const profile of ['standard', 'advanced']) {
    const ctx = fixture({ rulesProfile: profile, playerFinance: true });
    assert.equal(propose(ctx, { requestId: 'memo' }).success, true);
    ctx.game.settings.playerFinance = false;
    assert.equal(propose(ctx, { requestId: 'memo' }).success, false);
    assert.equal(ctx.game.proposePlayerContract('investor', { toPlayerId: ctx.owner.id, amount: 20 }).success, false);
    assert.equal(ctx.game.counterPlayerContract('owner', { amount: 90 }).success, false);
    assert.equal(ctx.game.adjustPlayerContract('investor', { amount: 90 }).success, false);
    assert.equal(ctx.game.respondPlayerContract('owner', true).success, false);
    assert.equal(ctx.game.respondPlayerContract('owner', false).success, true);
  }
});
check('acceptance replay cannot bypass finance-off or ended-game gates', () => {
  const ctx = fixture();
  const contract = activate(ctx);
  ctx.game.settings.playerFinance = false;
  assert.equal(ctx.game.respondPlayerContract('owner', true, 'accept', contract.id).success, false);
  ctx.game.settings.playerFinance = true;
  ctx.game.started = false;
  assert.equal(ctx.game.respondPlayerContract('owner', true, 'accept', contract.id).success, false);
});
check('legacy pending contracts cannot be accepted or negotiated but can decline', () => {
  const ctx = fixture();
  const offer = propose(ctx);
  delete offer.contract.rulesVersion;
  assert.equal(ctx.game.respondPlayerContract('owner', true).success, false);
  assert.equal(ctx.game.counterPlayerContract('owner', { amount: 90 }).success, false);
  assert.equal(ctx.game.adjustPlayerContract('investor', { amount: 90 }).success, false);
  assert.equal(ctx.game.respondPlayerContract('owner', false).success, true);
});
function legacyLoan(ctx) {
  const offer = ctx.game.proposePlayerContract('investor', { toPlayerId: ctx.owner.id, kind: 'loan', amount: 80, premiumRate: 10, durationRounds: 3, collateralTileIndices: [ctx.tile.index] });
  assert.equal(offer.success, true, offer.error);
  delete offer.contract.rulesVersion;
  return offer.contract;
}

for (const mode of ['counter', 'adjust']) {
  check(`legacy loan ${mode} rebuilds current validated terms without transferring cash`, () => {
    const ctx = fixture();
    const legacy = legacyLoan(ctx);
    const balance = [ctx.investor.cash, ctx.owner.cash];
    assert.equal(ctx.game.respondPlayerContract('owner', true, 'legacy-accept', legacy.id).success, false);
    ctx.tile.price += 10;
    const verb = mode === 'counter' ? 'counterPlayerContract' : 'adjustPlayerContract';
    const actor = mode === 'counter' ? 'owner' : 'investor';
    const result = ctx.game[verb](actor, { contractId: legacy.id, amount: 90, collateralCreditQuotes: [{ tileIndex: ctx.tile.index, value: 99999 }] });
    assert.equal(result.success, true, result.error);
    assert.equal(result.contract.kind, 'loan');
    assert.equal(result.contract.rulesVersion, 2);
    assert.notEqual(result.contract.id, legacy.id);
    assert.equal(result.contract.lastProposerId, mode === 'counter' ? ctx.owner.id : ctx.investor.id);
    assert.equal(result.contract.collateralCreditQuotes[0].value, ctx.tile.price);
    assert.deepEqual([ctx.investor.cash, ctx.owner.cash], balance);
    const recipient = mode === 'counter' ? 'investor' : 'owner';
    assert.equal(ctx.game.respondPlayerContract(actor, true, 'self', result.contract.id).success, false);
    assert.equal(ctx.game.respondPlayerContract(recipient, true, 'accept-new', result.contract.id).success, true);
    assert.deepEqual([ctx.investor.cash, ctx.owner.cash], [balance[0] - 90, balance[1] + 90]);
  });
}

check('legacy loan negotiation rejects unauthorized, stale, forged and invalid terms without changing the offer', () => {
  const ctx = fixture();
  const legacy = legacyLoan(ctx);
  const original = structuredClone(legacy);
  for (const [verb, actor, offer] of [
    ['counterPlayerContract', 'investor', { amount: 90 }],
    ['counterPlayerContract', 'other', { amount: 90 }],
    ['adjustPlayerContract', 'owner', { amount: 90 }],
    ['counterPlayerContract', 'owner', { contractId: 'old', amount: 90 }],
    ['counterPlayerContract', 'owner', { kind: 'equity', amount: 90 }],
    ['adjustPlayerContract', 'investor', { kind: 'hybrid', amount: 90 }],
    ['counterPlayerContract', 'owner', { amount: -1 }],
    ['counterPlayerContract', 'owner', { collateralTileIndices: [999] }]
  ]) {
    assert.equal(ctx.game[verb](actor, offer).success, false, `${verb} ${actor} ${JSON.stringify(offer)}`);
    assert.deepEqual(ctx.game.pendingPlayerContract, original);
  }
  ctx.game.settings.playerFinance = false;
  assert.equal(ctx.game.counterPlayerContract('owner', { amount: 90 }).success, false);
  ctx.game.settings.playerFinance = true;
  legacy.counterDepth = 2;
  assert.equal(ctx.game.counterPlayerContract('owner', { amount: 90 }).success, false);
  assert.equal(ctx.game.adjustPlayerContract('investor', { amount: 90 }).success, false);
});

check('legacy non-loans cannot be converted into loans by a forged negotiation', () => {
  for (const kind of ['equity', 'hybrid', 'equity-transfer']) {
    const ctx = fixture();
    const legacy = propose(ctx).contract;
    delete legacy.rulesVersion;
    legacy.kind = kind;
    const original = structuredClone(legacy);
    assert.equal(ctx.game.counterPlayerContract('owner', { kind: 'loan', amount: 90 }).success, false);
    assert.equal(ctx.game.adjustPlayerContract('investor', { kind: 'loan', amount: 90 }).success, false);
    assert.deepEqual(ctx.game.pendingPlayerContract, original);
  }
});

check('one investor, acceptance race validation, no resale', () => {
  const ctx = fixture();
  const contract = activate(ctx);
  assert.equal(propose(ctx).success, false);
  assert.equal(ctx.game.proposeEquityShareTransfer('investor', { fromPlayerId: ctx.investor.id, toPlayerId: ctx.other.id, contractId: contract.id, sharePct: 5, price: 10 }).success, false);
  const race = fixture();
  assert.equal(propose(race).success, true);
  race.tile.equityShares.push({ holderId: race.other.id, contractId: 'race', share: 5 });
  assert.equal(race.game.respondPlayerContract('owner', true).success, false);
});
check('new shares permit owner construction and building sales but lock deed actions', () => {
  const ctx = fixture();
  const group = ctx.game.getGroupTiles(ctx.tile.group);
  for (const tile of group) { tile.ownerId = ctx.owner.id; if (!ctx.owner.properties.includes(tile.index)) ctx.owner.properties.push(tile.index); }
  ctx.game.refreshPlayerGroups(ctx.owner);
  const contract = activate(ctx);
  assert.equal(ctx.game.canBuildOnTile(ctx.owner, ctx.tile), true);
  const ownerCash = ctx.owner.cash, investorCash = ctx.investor.cash;
  assert.equal(ctx.game.manageProperty('owner', { tileIndex: ctx.tile.index, action: 'build-house' }).success, true);
  assert.ok(ctx.owner.cash < ownerCash, 'the owner pays the construction cost');
  assert.equal(ctx.investor.cash, investorCash, 'the investor pays no construction cost');
  assert.equal(ctx.game.manageProperty('owner', { tileIndex: ctx.tile.index, action: 'sell-house' }).success, true);
  assert.equal(ctx.investor.cash, investorCash, 'the investor receives no building-sale proceeds');
  assert.equal(ctx.game.isTradeableTile(ctx.tile), false);
  assert.equal(ctx.game.canMortgageTile(ctx.owner, ctx.tile), false);
  assert.equal(ctx.game.manageProperty('owner', { tileIndex: ctx.tile.index, action: 'mortgage' }).success, false);
  assert.equal(ctx.game.proposeTrade('owner', { toPlayerId: ctx.other.id, givePropertyIndexes: [ctx.tile.index] }).success, false);
  assert.equal(ctx.game.proposePlayerContract('other', { toPlayerId: ctx.owner.id, kind: 'loan', amount: 20, collateralTileIndex: ctx.tile.index }).success, false);
  ctx.tile.houseCount = 1;
  assert.equal(ctx.game.canSellFromTile(ctx.owner, ctx.tile), true);
  ctx.tile.houseCount = 0;
  ctx.game.roundNumber = contract.expiresRound;
  ctx.game.processPlayerContracts();
  assert.equal(contract.status, 'expired');
  assert.equal(ctx.tile.equityShares.length, 0);
  assert.equal(ctx.game.isTradeableTile(ctx.tile), true);
});
check('new shares support airport and utility deeds including developed property', () => {
  for (const type of ['railroad', 'utility', 'property']) {
    const ctx = fixture();
    ctx.tile = ctx.game.tiles.find(tile => tile.type === type);
    ctx.tile.ownerId = ctx.owner.id;
    if (type === 'property') ctx.tile.houseCount = 2;
    activate(ctx);
  }
});
check('expiry is effective before round processing and carries no capital refund', () => {
  const ctx = fixture();
  const contract = activate(ctx, { durationRounds: 1 });
  const investorCash = ctx.investor.cash;
  ctx.game.roundNumber = contract.expiresRound;
  ctx.owner.cash += 100;
  ctx.game.settleEquityShares(ctx.tile, ctx.owner, 100, ctx.other);
  assert.equal(ctx.investor.cash, investorCash);
  ctx.game.processPlayerContracts();
  assert.equal(ctx.investor.cash, investorCash);
});
check('partial and deferred rent shares pay only collected cash exactly once', () => {
  const ctx = fixture();
  const contract = activate(ctx, { equityShare: 50 });
  ctx.other.cash = 4;
  const rent = ctx.game.calculateRent(ctx.tile);
  assert.equal(rent, 10);
  const investorCash = ctx.investor.cash;
  ctx.game.handleBuyableTile(ctx.other, ctx.tile, { allowExtraRoll: false });
  assert.equal(ctx.investor.cash, investorCash + 2);
  assert.equal(contract.rentCollected, 2);
  assert.equal(ctx.game.pendingPayment.amountRemaining, 6);
  ctx.other.cash = 6;
  ctx.game.trySettlePendingPayment();
  assert.equal(ctx.investor.cash, investorCash + 5);
  assert.equal(contract.rentCollected, 5);
  assert.equal(ctx.game.pendingPayment, null);
  ctx.game.trySettlePendingPayment();
  assert.equal(ctx.investor.cash, investorCash + 5, 'the parked hook cannot replay');
});
check('expiry ends unpaid future collections without refunding capital', () => {
  const ctx = fixture();
  const contract = activate(ctx, { equityShare: 50, durationRounds: 1 });
  ctx.other.cash = 0;
  const investorCash = ctx.investor.cash;
  ctx.game.handleBuyableTile(ctx.other, ctx.tile, { allowExtraRoll: false });
  assert.equal(ctx.investor.cash, investorCash);
  ctx.game.roundNumber = contract.expiresRound;
  ctx.other.cash = ctx.game.pendingPayment.amountRemaining;
  ctx.game.trySettlePendingPayment();
  assert.equal(ctx.investor.cash, investorCash);
  assert.equal(contract.status, 'expired');
});
check('new loan quotes ignore client fields, revalidate agreement and roll back atomically', () => {
  const ctx = fixture();
  const offer = ctx.game.proposePlayerContract('investor', {
    toPlayerId: ctx.owner.id, kind: 'loan', amount: 80, collateralTileIndex: ctx.tile.index,
    collateralCreditVersion: 999, collateralCreditQuotes: [{ tileIndex: ctx.tile.index, value: 99999 }]
  });
  assert.equal(offer.success, true);
  assert.equal(offer.contract.rulesVersion, 2);
  assert.equal(offer.contract.collateralCreditVersion, 1);
  assert.equal(offer.contract.collateralCreditQuotes[0].value, ctx.tile.price);
  const before = structuredClone(offer.contract);
  const ownerCash = ctx.owner.cash, investorCash = ctx.investor.cash;
  ctx.game.feedMessage = () => { throw new Error('injected activation failure'); };
  assert.equal(ctx.game.respondPlayerContract('owner', true).success, false);
  assert.deepEqual(offer.contract, before);
  assert.equal(ctx.owner.cash, ownerCash);
  assert.equal(ctx.investor.cash, investorCash);
  assert.equal(ctx.game.playerContracts.length, 0);
  ctx.game.feedMessage = () => {};
  ctx.tile.price += 1;
  assert.match(ctx.game.respondPlayerContract('owner', true).error, /quote changed/);
  assert.equal(ctx.owner.cash, ownerCash);
});
check('legacy active equity keeps terms and pays rent with finance disabled', () => {
  const ctx = fixture();
  const contract = activate(ctx);
  delete contract.rulesVersion;
  delete contract.rentShareVersion;
  contract.permanent = true;
  contract.expiresRound = null;
  ctx.game.settings.playerFinance = false;
  const before = structuredClone(contract);
  const cash = ctx.investor.cash;
  ctx.game.processPlayerContracts();
  assert.deepEqual(contract, before);
  ctx.game.settleEquityShares(ctx.tile, ctx.owner, 100, ctx.other);
  assert.equal(ctx.investor.cash, cash + 25);
  assert.equal(ctx.game.canBuildOnTile(ctx.owner, ctx.tile), false);
});
check('new shares end on either party exit without capital refund', () => {
  for (const departingSocket of ['owner', 'investor']) {
    const ctx = fixture();
    const contract = activate(ctx);
    const cash = ctx.investor.cash;
    assert.ok(ctx.manager.leaveRoomByClient(departingSocket, departingSocket, ctx.room));
    assert.equal(contract.status, 'terminated');
    assert.equal(ctx.tile.equityShares.length, 0);
    if (departingSocket === 'owner') assert.equal(ctx.investor.cash, cash);
    else assert.equal(ctx.investor.cash, 0, 'exit forfeits estate cash, without refunding the investment');
  }
});
check('new shares end on either party bankruptcy without capital refund', () => {
  for (const socketId of ['owner', 'investor']) {
    const ctx = fixture();
    const contract = activate(ctx);
    const cash = ctx.investor.cash;
    assert.equal(ctx.game.declareBankruptcy(socketId).success, true);
    assert.equal(contract.status, 'terminated');
    assert.equal(ctx.tile.equityShares.length, 0);
    if (socketId === 'owner') assert.equal(ctx.investor.cash, cash);
  }
});

check('airport rent shares exclude flight fees', () => {
  const ctx = fixture({ rulesProfile: 'advanced', playerFinance: true, flights: true });
  const airports = ctx.game.tiles.filter(tile => tile.type === 'railroad');
  ctx.tile = airports[1];
  ctx.tile.ownerId = ctx.owner.id;
  ctx.owner.properties.push(ctx.tile.index);
  activate(ctx, { equityShare: 50 });
  ctx.game.currentPlayerId = ctx.other.id;
  ctx.other.position = airports[0].index;
  ctx.game.hasRolled = false;
  const ownerCash = ctx.owner.cash, investorCash = ctx.investor.cash;
  const result = ctx.game.flyToAirport('other', ctx.tile.index);
  assert.equal(result.success, true, result.error);
  assert.ok(result.fare > 0);
  assert.equal(ctx.owner.cash, ownerCash + result.fare);
  assert.equal(ctx.investor.cash, investorCash, 'flight fees are not collected rent');
});

let failures = 0;
for (const [name, fn] of cases) {
  try { fn(); console.log(`PASS - ${name}`); }
  catch (error) { failures++; console.error(`FAIL - ${name}: ${error.stack}`); }
}
if (failures) process.exitCode = 1;
