import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { runBotTurn, selectBotTurnTarget } from './botLogic.js';
import { borrowerAcceptsContract } from './botContractPolicy.js';
import { counterContractOffer } from './botCandidates.js';
import { buildBotStrategicContext } from './botStrategicContext.js';
import { groupBuildPlan } from './botDevelopmentForecast.js';

function fixture(profile = 'standard', playerFinance) {
  const room = new RoomManager().createRoom({ socketId: 'b', clientId: 'b', nickname: 'Bot', rulesProfile: profile, playerFinance, isBot: true });
  room.setRoomSetting('bots', 2);
  room.startGame();
  const game = room.game;
  const bot = game.getCurrentPlayer();
  const owner = game.players.find(player => player.id !== bot.id);
  const tile = game.getTile(1);
  tile.ownerId = owner.id;
  owner.properties.push(tile.index);
  return { room, game, bot, owner, tile };
}

test('bot finance proposals obey the finance choice and contain only finite passive new products', () => {
  const standard = fixture();
  assert.deepEqual(standard.game.botContractCandidates(standard.bot), []);
  const custom = fixture('standard', true);
  assert.ok(custom.game.botContractCandidates(custom.bot).some(candidate => candidate.offer.kind === 'equity'));
  assert.equal(buildBotStrategicContext(custom.game, custom.bot).rulesDigest.playerFinance, true);
  const { game, bot } = fixture('advanced');
  const candidates = game.botContractCandidates(bot);
  assert.ok(candidates.some(candidate => candidate.offer.kind === 'equity'));
  for (const { offer } of candidates) {
    assert.ok(['loan', 'equity'].includes(offer.kind));
    if (offer.kind === 'equity') {
      assert.equal(offer.equityControl, 'passive');
      assert.equal(offer.permanent, false);
      assert.equal(offer.durationRounds, 3);
    }
  }
  game.settings.playerFinance = false;
  assert.deepEqual(game.botContractCandidates(bot), []);
});

test('disabled finance declines new offers/counters but retains legacy repayment candidates', () => {
  const { game, bot, owner } = fixture();
  const offer = { id: 'loan', fromPlayerId: owner.id, toPlayerId: bot.id, rulesVersion: 2, kind: 'loan', amount: 100, totalDue: 100, premiumRate: 0, durationRounds: 3 };
  assert.equal(borrowerAcceptsContract(offer, bot, { lender: owner, game }), false);
  game.pendingPlayerContract = offer;
  assert.equal(counterContractOffer(game, bot), null);
  game.pendingPlayerContract = null;
  game.playerContracts.push({ ...offer, rulesVersion: undefined, status: 'due', remaining: 100 });
  assert.ok(game.botRepaymentCandidates(bot).some(candidate => candidate.contractId === offer.id));
});

test('Standard bot acceptance follows the finance flag and disabled counters stay gated', () => {
  const { game, bot, owner } = fixture('standard', true);
  const offer = { id: 'custom-loan', fromPlayerId: owner.id, toPlayerId: bot.id, rulesVersion: 2, kind: 'loan', amount: 100, totalDue: 100, premiumRate: 0, durationRounds: 3 };
  assert.equal(borrowerAcceptsContract(offer, bot, { lender: owner, game }), true);
  game.settings.playerFinance = false;
  assert.equal(borrowerAcceptsContract(offer, bot, { lender: owner, game }), false);
  game.pendingPlayerContract = offer;
  assert.equal(counterContractOffer(game, bot), null);
});

test('bot context distinguishes rent-share construction from legacy share freezes', () => {
  const { game, owner, tile } = fixture('advanced');
  const other = game.getTile(3);
  other.ownerId = owner.id;
  owner.properties.push(other.index);
  const contract = { id: 'share', kind: 'equity', rulesVersion: 2, rentShareVersion: 1, status: 'active', propertyIndex: tile.index, fromPlayerId: game.getCurrentPlayer().id, toPlayerId: owner.id, expiresRound: 4 };
  game.playerContracts.push(contract);
  tile.equityShares.push({ contractId: contract.id, holderId: contract.fromPlayerId, share: 15 });
  let context = buildBotStrategicContext(game, owner);
  assert.equal(context.rulesDigest.rulesProfile, 'advanced');
  assert.equal(context.rulesDigest.playerFinance, true);
  assert.equal(context.board.find(entry => entry.index === tile.index).constructionBlocked, false);
  assert.ok(groupBuildPlan(context.board, tile.group, () => 50));
  delete contract.rentShareVersion;
  context = buildBotStrategicContext(game, owner);
  assert.equal(context.board.find(entry => entry.index === tile.index).constructionBlocked, true);
  assert.equal(groupBuildPlan(context.board, tile.group, () => 50), null);
});



function threeSeatFinanceFixture() {
  const room = new RoomManager().createRoom({ socketId: 'privacy-a', clientId: 'privacy-a', nickname: 'A', rulesProfile: 'advanced' });
  room.addOrReconnectPlayer({ socketId: 'privacy-b', clientId: 'privacy-b', nickname: 'B' });
  room.setRoomSetting('bots', 1);
  assert.equal(room.startGame().success, true);
  const game = room.game;
  const [lender, borrower] = game.players.filter(player => !player.isBot);
  const bot = game.players.find(player => player.isBot);
  const deed = game.getTile(1);
  deed.ownerId = borrower.id;
  borrower.properties.push(deed.index);
  const proposed = room.proposePlayerContract('privacy-a', {
    toPlayerId: borrower.id, kind: 'loan', amount: 237, premiumRate: 17, durationRounds: 7, collateralTileIndices: [deed.index]
  });
  assert.equal(proposed.success, true);
  game.currentPlayerId = bot.id;
  return { room, game, lender, borrower, bot, deed };
}

test('an unrelated current bot advisor sees only the public pending contract envelope', async () => {
  const { room, game, lender, borrower, bot } = threeSeatFinanceFixture();
  const offer = game.pendingPlayerContract;
  const publicPending = game.getGameSummary(bot.id).playerContracts.pending;
  const privateKeys = ['amount', 'premiumRate', 'durationRounds', 'propertyIndex', 'collateralTileIndex', 'collateralTileIndices', 'collateralQuotes', 'equityShare', 'equityControl', 'conversionShare', 'expiresRound', 'rulesVersion', 'rentShareVersion'];
  for (const key of privateKeys) assert.equal(Object.hasOwn(publicPending, key), false, `public summary omits ${key}`);
  for (const participant of [lender, borrower]) {
    assert.equal(game.getGameSummary(participant.id).playerContracts.pending.amount, offer.amount);
    assert.equal(buildBotStrategicContext(game, participant).obligations.contract.durationRounds, offer.durationRounds);
  }
  const selected = selectBotTurnTarget(game);
  assert.equal(selected, bot, 'a human respondent leaves the unrelated current bot eligible');
  let observed;
  await runBotTurn(room, selected, { chooseAction: async context => {
    observed = context;
    return { actionId: 'roll', provider: 'deterministic', fallback: false };
  } });
  assert.ok(observed, 'the actual advisor seam was called without network access');
  assert.equal(observed.obligations.contract.role, 'other');
  assert.equal(observed.obligations.contract.kind, publicPending.kind);
  for (const key of privateKeys) assert.equal(Object.hasOwn(observed.obligations.contract, key), false, `advisor omits ${key}`);
  assert.equal(observed.obligations.contract.status, publicPending.status);
  assert.equal(game.pendingPlayerContract, offer, 'observing another pair does not resolve their offer');
});

test('unrelated trade and sponsorship context respects their existing public summary fields', () => {
  const { game, lender, borrower, bot, deed } = threeSeatFinanceFixture();
  game.pendingPlayerContract = null;
  game.pendingTrade = { id: 'public-trade', fromPlayerId: lender.id, toPlayerId: borrower.id, giveCash: 91, requestCash: 27, givePropertyIndexes: [], requestPropertyIndexes: [deed.index], counterDepth: 1 };
  const summaryTrade = game.getGameSummary(bot.id).pendingTrade;
  const trade = buildBotStrategicContext(game, bot).obligations.trade;
  assert.equal(trade.role, 'other');
  assert.equal(trade.giveCash, summaryTrade.requestCash);
  assert.equal(trade.requestCash, summaryTrade.giveCash);
  assert.deepEqual(trade.givePropertyIndexes, summaryTrade.requestPropertyIndexes);
  game.pendingSponsoredPurchase = { buyerId: borrower.id, tileIndex: deed.index, price: deed.price, contributions: [{ sponsorId: lender.id, amount: 39 }] };
  const sponsorship = buildBotStrategicContext(game, bot).obligations.sponsorship;
  assert.equal(sponsorship.tileIndex, deed.index);
  assert.equal(sponsorship.totalContributed, 39);
  assert.equal(sponsorship.contributionCount, 1);
});
