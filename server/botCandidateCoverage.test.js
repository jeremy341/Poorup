import assert from 'node:assert/strict';
import { GAME_ACTION_CATALOG, registerGameSocketHandlers } from './serverSocketGame.js';
import { candidateAction, CANDIDATE_RUNNERS, getBotChoiceCandidates, runPaymentChoice } from './botLogic.js';
import { RoomManager } from './gameLogic.js';

const bot = { id: 'coverage-bot', cash: 10_000, personality: 'speculator' };
const coverage = new Map([
  ['purchase-property', { candidateKind: 'purchase' }],
  ['decline-property', { policy: 'decline-to-auction' }],
  ['auction-bid', { policy: 'decideBotAuction' }],
  ['end-turn', { candidateKind: 'end-turn' }],
  ['manage-property:build-house', { candidateKind: 'build' }],
  ['manage-property:sell-house', { candidateKind: 'sell' }],
  ['manage-property:mortgage', { candidateKind: 'mortgage' }],
  ['manage-property:unmortgage', { candidateKind: 'unmortgage' }],
  ['propose-trade', { candidateKind: 'trade' }],
  ['counter-trade', { policy: 'trade-choice-phase' }],
  ['adjust-trade', { exclusion: 'human-only offer editing' }],
  ['cancel-trade', { candidateKind: 'cancel-trade' }],
  ['respond-trade', { policy: 'trade-choice-phase' }],
  ['propose-player-contract', { candidateKind: 'contract-propose' }],
  ['counter-player-contract', { policy: 'contract-choice-phase' }],
  ['adjust-player-contract', { exclusion: 'human-only offer editing' }],
  ['respond-player-contract', { policy: 'contract-choice-phase' }],
  ['repay-player-contract', { candidateKind: 'repay' }],
  ['pay-jail-fine', { candidateKind: 'jail-fine' }],
  ['use-jail-free', { candidateKind: 'jail-free' }],
  ['use-item', { candidateKind: 'item-use' }],
  ['sell-item', { policy: 'item-payment-rescue' }],
  ['take-bank-loan', { candidateKind: 'loan' }],
  ['repay-bank-loan', { candidateKind: 'bank-repay' }],
  ['market-order', { candidateKind: 'market' }],
  ['open-margin', { candidateKind: 'open-margin' }],
  ['reduce-margin', { candidateKind: 'reduce-margin' }],
  ['open-short', { candidateKind: 'open-short' }],
  ['cover-short', { candidateKind: 'cover-short' }],
  ['settle-short-default', { policy: 'debt-rescue' }],
  ['open-option', { candidateKind: 'open-option' }],
  ['exercise-option', { candidateKind: 'exercise-option' }],
  ['close-position', { candidateKind: 'close-position' }],
  ['vote-global-event', { policy: 'vote-choice-phase' }],
  ['declare-bankruptcy', { candidateKind: 'bankruptcy' }],
  ['roll-dice', { candidateKind: 'roll' }],
  ['fly-to-airport', { exclusion: 'human-only airport flights' }],
  ['upgrade-bank-account', { exclusion: 'human-only bank account upgrades' }],
  ['set-airport-fees', { exclusion: 'human-only airport fee editing' }],
  ['cancel-player-contract', { exclusion: 'human-only cancellation' }],
  ['player-presence', { exclusion: 'human-only presence reporting' }],
  ['propose-equity-share-transfer', { exclusion: 'human-only equity transfer' }],
  ['room-votekick-start', { exclusion: 'human-only room vote kick' }],
  ['room-votekick-cast', { exclusion: 'human-only room vote kick' }],
  ['get-bank-loan-offer', { exclusion: 'read-only offer query' }],
  ['get-economy-snapshot', { exclusion: 'read-only snapshot query' }],
  ['place-casino-bet', { candidateKind: 'casino' }],
  ['request-sponsored-purchase', { policy: 'sponsorship-choice-phase' }],
  ['contribute-sponsored-purchase', { policy: 'sponsorship-choice-phase' }],
  ['withdraw-sponsored-purchase', { exclusion: 'human-only contribution management' }],
  ['accept-sponsored-purchase', { policy: 'sponsorship-choice-phase' }],
  ['decline-sponsored-purchase', { policy: 'sponsorship-choice-phase' }]
]);

const testedPolicies = new Set([
  'decline-to-auction', 'decideBotAuction', 'trade-choice-phase', 'contract-choice-phase',
  'debt-rescue', 'vote-choice-phase', 'sponsorship-choice-phase', 'item-payment-rescue'
]);

const registeredEvents = [];
registerGameSocketHandlers((event, _handler) => registeredEvents.push(event), { id: 'coverage-socket' }, {});
assert.deepEqual(
  [...registeredEvents].sort(),
  GAME_ACTION_CATALOG.map(action => action.event).sort(),
  'the catalog covers every generic, direct, and dynamically registered game socket event'
);

const catalogVariants = GAME_ACTION_CATALOG.flatMap(action => action.variants?.length
  ? action.variants.map(variant => `${action.event}:${variant.action}`)
  : [action.event]);
assert.deepEqual([...coverage.keys()].sort(), [...catalogVariants].sort(), 'coverage has exactly one row per catalog action variant');

for (const action of GAME_ACTION_CATALOG) {
  const variants = action.variants?.length ? action.variants : [null];
  for (const variant of variants) {
    const key = variant ? `${action.event}:${variant.action}` : action.event;
    const row = coverage.get(key);
    assert.ok(row, `${key} (${action.registration}/${action.surface}) needs a bot coverage row`);
    if (variant) assert.equal(row.candidateKind, variant.candidateKind, `${key} maps to the catalog's expected candidate kind`);
    const mapped = Number(Boolean(row.candidateKind)) + Number(Boolean(row.policy)) + Number(Boolean(row.exclusion));
    assert.equal(mapped, 1, `${key} must have exactly one handling or exclusion mapping`);
    if (row.candidateKind) {
      const mappedType = candidateAction({ kind: row.candidateKind, cost: 0, totalDue: 0 }, bot).type;
      assert.ok(mappedType !== 'roll' || row.candidateKind === 'roll', `${key} candidate kind must map to a tested room action`);
    }
    if (row.policy) assert.ok(testedPolicies.has(row.policy), `${key} policy must be named in the tested server policy catalog`);
    if (row.exclusion) assert.match(row.exclusion, /human-only|read-only/);
  }
}

assert.equal(new Set(GAME_ACTION_CATALOG.map(action => action.event)).size, GAME_ACTION_CATALOG.length, 'catalog action events are unique');

// Item coverage exercises the same candidates and Room action seam as live bots.
{
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'item-bot', clientId: 'item-bot', nickname: 'Bot', rulesetOverrides: [{ key: 'itemRewards', value: true }] });
  room.addOrReconnectPlayer({ socketId: 'item-other', clientId: 'item-other', nickname: 'Other' });
  assert.equal(room.startGame().success, true);
  const game = room.game, [actor] = game.players;
  actor.isBot = true;
  game.currentPlayerId = actor.id;
  const bond = game.grantItem(actor, 'parlor-bond', 'treasure');
  game.roundNumber = bond.maturesRound;
  const redeem = game.botItemCandidates(actor)[0];
  assert.equal(candidateAction(redeem, actor).type, 'item-use');
  assert.equal(CANDIDATE_RUNNERS['item-use'](room, actor, redeem).cashReceived, 100);
  const keepsake = game.grantItem(actor, 'silver-keepsake', 'surprise');
  actor.cash = 0;
  game.chargePlayer({ player: actor, amount: 70 });
  const sell = getBotChoiceCandidates(game, actor, 'payment')[0];
  assert.equal(sell.itemId, keepsake.itemId);
  assert.equal(sell.itemAction, 'sell');
  assert.equal(runPaymentChoice(room, actor, game, sell).cashReceived, 75);
  assert.equal(game.pendingPayment, null);
}
console.log(`bot candidate coverage: ${coverage.size} action variants across ${GAME_ACTION_CATALOG.length} socket events`);
