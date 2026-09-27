import assert from 'node:assert/strict';
import { GAME_ACTION_CATALOG, registerGameSocketHandlers } from './serverSocketGame.js';
import { candidateAction } from './botLogic.js';

const bot = { id: 'coverage-bot', cash: 10_000, personality: 'speculator' };
const coverage = new Map([
  ['purchase-property', { candidateKind: 'purchase' }],
  ['decline-property', { policy: 'decline-to-auction' }],
  ['auction-bid', { policy: 'decideBotAuction' }],
  ['auction-pass', { policy: 'decideBotAuction' }],
  ['end-turn', { candidateKind: 'end-turn' }],
  ['manage-property:build-house', { candidateKind: 'build' }],
  ['manage-property:sell-house', { candidateKind: 'sell' }],
  ['manage-property:mortgage', { candidateKind: 'mortgage' }],
  ['manage-property:unmortgage', { candidateKind: 'unmortgage' }],
  ['propose-trade', { candidateKind: 'trade' }],
  ['counter-trade', { policy: 'trade-choice-phase' }],
  ['adjust-trade', { exclusion: 'human-only offer editing' }],
  ['cancel-trade', { exclusion: 'human-only offer cancellation' }],
  ['respond-trade', { policy: 'trade-choice-phase' }],
  ['propose-player-contract', { candidateKind: 'contract-propose' }],
  ['counter-player-contract', { policy: 'contract-choice-phase' }],
  ['adjust-player-contract', { exclusion: 'human-only offer editing' }],
  ['respond-player-contract', { policy: 'contract-choice-phase' }],
  ['repay-player-contract', { candidateKind: 'repay' }],
  ['pay-jail-fine', { candidateKind: 'jail-fine' }],
  ['use-jail-free', { candidateKind: 'jail-free' }],
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
  ['cancel-player-contract', { exclusion: 'human-only cancellation' }],
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
  'debt-rescue', 'vote-choice-phase', 'sponsorship-choice-phase'
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
console.log(`bot candidate coverage: ${coverage.size} action variants across ${GAME_ACTION_CATALOG.length} socket events`);
