// Bot runtime checks, each pinning one behaviour at its public seam:
//   - payments skip properties in an open offer, fall through to the next rescue, and never freeze the table;
//   - sponsorships count only sponsors who can really fund them, and a bot buyer cancels when nobody can contribute;
//   - a bot never sponsors during an open trade, auction or contract; builds need house cash plus a reserve;
//   - AI provider: malformed 2xx bodies are refunded, timeouts cover the body read, rejected profiles never seed the advisor,
//     key rotation reaches the advisor, and per-game and process-wide AI budgets hold;
//   - a bot-created contract offer reaches the human recipient, and a blocked trade names the real blocker.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { AiAdvisor, DeterministicAdvisor, createBotAdvisor } from './botAdvisor.js';
import { allowPrivateEndpointsFromEnv, createAiProviderManager, createAiProviderStore } from './aiProviderConfig.js';
import { createRuntime } from './socketRuntime.js';
import { getBotChoiceCandidates } from './advisorLogic.js';
import { classifyBotTurnPhase, resolvePurchaseOffer, runBotTurn, selectBotTurnTarget } from './botLogic.js';
import { debtMortgageCandidates, debtSellCandidates } from './botCandidates.js';
import { isSponsorshipActor, sponsorshipBuyerShouldCancel, sponsorshipContributionAmount } from './sponsorshipLogic.js';

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

async function checkAsync(name, run) {
  try {
    await run();
    console.log(`PASS - ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`FAIL - ${name}: ${error.stack || error.message}`);
  }
}

let roomSerial = 0;
// One bot seat (index 0 in the bot roster) and one human seat, started game.
function botRoom({ bots = 1 } = {}) {
  roomSerial += 1;
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'host', clientId: 'host', nickname: 'Host', rulesProfile: 'advanced', roomCode: `B8R${roomSerial}` });
  room.addOrReconnectPlayer({ socketId: 'seat-0', clientId: 'seat-0', nickname: 'Seat0' });
  room.setRoomSetting('bots', bots);
  room.setRoomSetting('botDifficulty', 'table');
  assert.equal(room.startGame().success, true, 'the bot fixture starts');
  const game = room.game;
  const bot = game.players.find(player => player.isBot);
  const human = game.players.find(player => !player.isBot);
  return { room, game, bot, human };
}

function giveDeed(game, player, tile) {
  tile.ownerId = player.id;
  if (!player.properties.includes(tile.index)) player.properties.push(tile.index);
  return tile;
}

function freeDeeds(game, count) {
  return game.tiles.filter(tile => tile.group && tile.price > 0 && tile.ownerId == null).slice(0, count);
}

// The bot owes 300 it cannot pay. Its first deed sits in an open trade to the
// human, so the server refuses to mortgage or sell it (propertyOpenOfferRejection).
function debtWithOpenTrade() {
  const { room, game, bot, human } = botRoom();
  const [inTrade, free] = freeDeeds(game, 2).map(tile => giveDeed(game, bot, tile));
  bot.cash = 40;
  human.cash = 500;
  game.pendingPayment = { playerId: bot.id, creditorId: human.id, amountRemaining: 300, reason: 'b8 debt', equityTileIndex: null, equityOwnerId: null };
  game.pendingPaymentHooks = {};
  game.pendingPaymentTurnOptions = {};
  game.currentPlayerId = bot.id;
  game.hasRolled = true;
  game.awaitingEndTurn = false;
  const trade = room.runBotAction(bot.id, actor => room.proposeTrade(actor, {
    toPlayerId: human.id, giveCash: 0, requestCash: 0, givePropertyIndexes: [inTrade.index], requestPropertyIndexes: []
  }));
  assert.equal(trade.success, true, `the open trade is proposed: ${trade.error}`);
  assert.ok(game.propertyOpenOfferRejection(inTrade), 'the server refuses to manage a deed in an open trade');
  return { room, game, bot, human, inTrade, free };
}

// The rescue ladder must never offer a property the server will refuse.
check('debt mortgage and sale candidates skip properties in an open offer', () => {
  const { game, bot, inTrade, free } = debtWithOpenTrade();
  const mortgages = debtMortgageCandidates(game, bot).map(entry => entry.tile.index);
  assert.equal(mortgages.includes(inTrade.index), false, 'the deed in the open trade is not a mortgage candidate');
  assert.ok(mortgages.includes(free.index), 'an unencumbered deed stays a mortgage candidate');
  assert.equal(debtSellCandidates(game, bot).some(entry => entry.tile.index === inTrade.index), false);
  const choiceIds = getBotChoiceCandidates(game, bot, 'payment').map(candidate => candidate.id);
  assert.equal(choiceIds.includes(`debt:mortgage:${inTrade.index}`), false, 'the payment choice never names the blocked deed');
  assert.ok(choiceIds.includes('debt:bankruptcy'), 'bankruptcy stays the terminal rescue');
});

await checkAsync('a rejected advisor rescue falls through to the next rescue instead of freezing', async () => {
  const { room, game, bot, free } = debtWithOpenTrade();
  // Force the server to refuse the mortgage the advisor picked (stale state).
  const manage = room.manageProperty;
  room.manageProperty = function rejectMortgage(actor, payload) {
    if (payload.action === 'mortgage') return { success: false, error: 'stub rejection' };
    return manage.call(this, actor, payload);
  };
  const advisor = {
    supportsChoicePhase: () => true,
    chooseAction: async () => ({ actionId: `debt:mortgage:${free.index}`, provider: 'ai', fallback: false })
  };
  assert.equal(classifyBotTurnPhase(game, bot), 'payment');
  const result = await runBotTurn(room, bot, advisor);
  assert.notEqual(result?.success, false, 'the turn resolves instead of reporting a rejected rescue');
  assert.equal(bot.bankrupt, true, 'with every rescue refused the ladder ends in bankruptcy, not a stalled debt');
});

await checkAsync('the deterministic rescue ladder never selects the blocked deed', async () => {
  const { room, game, bot, inTrade } = debtWithOpenTrade();
  const result = await runBotTurn(room, bot, new DeterministicAdvisor());
  assert.notEqual(result?.botDecision?.actionId, `debt:mortgage:${inTrade.index}`);
  assert.equal(game.getTile(inTrade.index).mortgaged, false, 'the deed in the open trade is never mortgaged');
});

// A bot buyer short of a $200-class deed, with one cash-rich bot sponsor.
function sponsorRoom() {
  const { room, game, bot: buyer } = botRoom({ bots: 2 });
  const sponsor = game.players.find(player => player.isBot && player.id !== buyer.id);
  const humans = game.players.filter(player => !player.isBot);
  const tile = game.tiles.find(entry => entry.group && entry.price >= 100 && entry.ownerId == null);
  humans.forEach(human => { human.cash = 0; });
  buyer.cash = 20;
  sponsor.cash = 5000;
  game.currentPlayerId = buyer.id;
  game.hasRolled = true;
  game.awaitingEndTurn = false;
  game.pendingPurchaseOffer = { playerId: buyer.id, tileIndex: tile.index, price: tile.price };
  return { room, game, buyer, sponsor, humans, tile };
}

// A bot buyer requests sponsorship only from sponsors the server would
// let fund it now; a round-gated sponsor cannot give until the round advances.
check('a bot buyer does not open a request only a round-gated sponsor could fund', () => {
  const { room, game, buyer, sponsor } = sponsorRoom();
  sponsor.lastSponsorRound = game.roundNumber;
  resolvePurchaseOffer(room, buyer, { success: true, purchaseOffer: game.pendingPurchaseOffer });
  assert.equal(game.pendingSponsoredPurchase, null,
    'no sponsorship is opened on cash that the sponsor is barred from giving this round');
});

check('a bot buyer still opens a request a fundable sponsor can cover', () => {
  const { room, game, buyer } = sponsorRoom();
  resolvePurchaseOffer(room, buyer, { success: true, purchaseOffer: game.pendingPurchaseOffer });
  assert.ok(game.pendingSponsoredPurchase, 'a fundable sponsor keeps the request available');
  assert.equal(game.pendingSponsoredPurchase.buyerId, buyer.id);
});

// A request that no bot or cash-holding human can fund is cancelled at
// once, not after a round that can never pass while the request is open.
check('a bot buyer cancels a request nobody can contribute to at once', () => {
  const { room, game, buyer, sponsor } = sponsorRoom();
  assert.equal(room.runBotAction(buyer.id, actor => room.game.requestPurchaseSponsorship(actor)).success, true);
  const request = game.pendingSponsoredPurchase;
  assert.equal(sponsorshipBuyerShouldCancel(game, buyer, request), false, 'a fundable request waits for its sponsor');
  sponsor.lastSponsorRound = game.roundNumber;
  assert.equal(sponsorshipBuyerShouldCancel(game, buyer, request), true,
    'with no bot or cash-holding human able to give, the request is dead now, not after a round');
});

check('a bot buyer keeps waiting while a human with cash can still contribute', () => {
  const { room, game, buyer, sponsor, humans } = sponsorRoom();
  assert.equal(room.runBotAction(buyer.id, actor => room.game.requestPurchaseSponsorship(actor)).success, true);
  sponsor.lastSponsorRound = game.roundNumber;
  humans[0].cash = 300;
  assert.equal(sponsorshipBuyerShouldCancel(game, buyer, game.pendingSponsoredPurchase), false,
    'a human who can still fund the request keeps it open');
});

// The server refuses sponsor contributions while a trade, auction, or
// contract is open, so no bot may size, claim, or be woken for one.
check('a bot sponsor claims no contribution while a trade is open', () => {
  const { room, game, buyer, sponsor, humans } = sponsorRoom();
  assert.equal(room.runBotAction(buyer.id, actor => room.game.requestPurchaseSponsorship(actor)).success, true);
  assert.ok(sponsorshipContributionAmount(game, sponsor) > 0, 'the sponsor can fund the open request');
  game.pendingTrade = { id: 'b8-open-trade', fromPlayerId: humans[1].id, toPlayerId: humans[0].id, giveCash: 0, requestCash: 0, givePropertyIndexes: [], requestPropertyIndexes: [], counterDepth: 0 };
  assert.equal(sponsorshipContributionAmount(game, sponsor), 0, 'the trade blocks the sponsor contribution');
  assert.equal(isSponsorshipActor(game, sponsor), false, 'the sponsor does not claim the sponsorship seat');
  assert.notEqual(selectBotTurnTarget(game)?.id, sponsor.id, 'the sponsor is not woken to retry a rejected contribution');
  game.pendingTrade = null;
  assert.ok(sponsorshipContributionAmount(game, sponsor) > 0, 'the sponsor funds again once the table is clear');
});

// A bot holding a full colour group, post-roll, so house builds are offered.
function monopolyBuildRoom() {
  const { room, game, bot, human } = botRoom();
  const byGroup = new Map();
  for (const tile of game.tiles) {
    if (!tile.group || !(tile.price > 0)) continue;
    byGroup.set(tile.group, [...(byGroup.get(tile.group) || []), tile]);
  }
  const [group] = [...byGroup.values()].filter(tiles => tiles.length >= 2).sort((a, b) => a.length - b.length);
  for (const tile of group) giveDeed(game, bot, tile);
  game.currentPlayerId = bot.id;
  game.hasRolled = true;
  game.awaitingEndTurn = true;
  game.pendingPayment = null;
  return { room, game, bot, human, group };
}

function buildCandidateIds(game, bot) {
  return game.getBotCandidates(bot, { expanded: true, parity: true, postRoll: true })
    .filter(candidate => candidate.kind === 'build')
    .map(candidate => candidate.tileIndex);
}

// A house is offered only when the bot keeps a cash reserve
// after paying for it, and never on a deed named by an open offer.
check('build candidates need the house cost plus a reserve', () => {
  const { game, bot, group } = monopolyBuildRoom();
  const tile = group[0];
  const houseCost = game.getPropertyHouseCost(tile);
  bot.cash = houseCost + 179;
  assert.equal(buildCandidateIds(game, bot).includes(tile.index), false,
    'a build that leaves less than the reserve is not offered');
  bot.cash = houseCost + 180;
  assert.equal(buildCandidateIds(game, bot).includes(tile.index), true,
    'a build that leaves the reserve is offered');
});

check('build candidates skip a deed named by an open offer', () => {
  const { room, game, bot, human, group } = monopolyBuildRoom();
  bot.cash = 10_000;
  const tile = group[0];
  const trade = room.runBotAction(bot.id, actor => room.proposeTrade(actor, {
    toPlayerId: human.id, giveCash: 0, requestCash: 0, givePropertyIndexes: [tile.index], requestPropertyIndexes: []
  }));
  assert.equal(trade.success, true, `the open trade is proposed: ${trade.error}`);
  assert.equal(buildCandidateIds(game, bot).includes(tile.index), false,
    'the server refuses to build on a deed in an open trade, so no candidate names it');
});

await checkAsync('a refused build tries the next legal option instead of ending the turn', async () => {
  const { room, game, bot, group } = monopolyBuildRoom();
  bot.cash = 10_000;
  const [refused, accepted] = group;
  const manage = room.manageProperty;
  room.manageProperty = function rejectOneBuild(actor, payload) {
    if (payload.action === 'build-house' && payload.tileIndex === refused.index) return { success: false, error: 'stub rejection' };
    return manage.call(this, actor, payload);
  };
  const advisor = {
    supportsChoicePhase: () => false,
    chooseAction: async () => ({ actionId: `build:${refused.index}`, provider: 'ai', fallback: false })
  };
  const result = await runBotTurn(room, bot, advisor);
  assert.notEqual(result?.success, false, 'the refused build does not fail the turn');
  assert.equal(game.getTile(refused.index).houseCount || 0, 0, 'the refused build changes nothing');
  assert.equal(game.getTile(accepted.index).houseCount, 1, 'the next legal build is taken');
  assert.equal(game.awaitingEndTurn, true, 'the bot did not end its turn on a refused build');
});

// AI advisor seam

const advisorCandidates = [
  { id: 'roll', kind: 'roll', score: 0, risk: 0 },
  { id: 'build:1', kind: 'build', score: 30, risk: 0.2, cost: 100 }
];

// A 2xx body that is not JSON must not escape chooseAction; it is an
// invalid-response that counts as a failure and returns its budget.
await checkAsync('a malformed 2xx body is an invalid-response that returns its budget', async () => {
  let calls = 0;
  const advisor = new AiAdvisor({
    apiKey: 'test-key',
    maxDecisionsPerGame: 1,
    fetchImpl: async () => {
      calls += 1;
      return { ok: true, status: 200, json: async () => { throw new SyntaxError('Unexpected token < in JSON'); } };
    }
  });
  const decision = await advisor.chooseAction({ candidates: advisorCandidates, botBrain: 'ai', gameId: 'b8-f021', botId: 'bot-1', decisionSequence: 1 });
  assert.equal(decision.fallbackReason, 'invalid-response');
  assert.equal(decision.provider, 'deterministic');
  assert.equal(advisor.getHealth().lastFailure?.reason, 'invalid-response', 'the failure is registered for the circuit');
  // The single budget unit came back, so a later decision in the same game still reaches the provider.
  advisor.circuitOpenUntil = 0;
  advisor.failureStreak = 0;
  const retry = await advisor.chooseAction({ candidates: advisorCandidates, botBrain: 'ai', gameId: 'b8-f021', botId: 'bot-1', decisionSequence: 2 });
  assert.equal(retry.fallbackReason, 'invalid-response');
  assert.equal(calls, 2, 'the refunded unit lets the second decision call the provider');
});

// The provider timeout covers reading the body, so a stalled body is
// aborted and the decision falls back instead of hanging the bot turn.
await checkAsync('a provider that stalls the body is aborted at the timeout', async () => {
  const advisor = new AiAdvisor({
    apiKey: 'test-key',
    timeoutMs: 5,
    fetchImpl: async (_url, options) => ({
      ok: true,
      status: 200,
      json: () => new Promise((_resolve, reject) => {
        options.signal.addEventListener('abort', () => {
          const error = new Error('body stalled');
          error.name = 'AbortError';
          reject(error);
        }, { once: true });
      })
    })
  });
  const decision = await Promise.race([
    advisor.chooseAction({ candidates: advisorCandidates, botBrain: 'ai', gameId: 'b8-f022', botId: 'bot-1' }),
    new Promise(resolve => setTimeout(() => resolve({ fallbackReason: 'hung' }), 2000))
  ]);
  assert.equal(decision.fallbackReason, 'timeout', 'the timer stays armed until the body is consumed');
});

// An environment profile that does not validate never seeds the
// advisor, and the default transport fails closed rather than sending the key.
await checkAsync('an unvalidated production environment profile never reaches the provider', async () => {
  const realFetch = globalThis.fetch;
  let transportCalls = 0;
  globalThis.fetch = async () => { transportCalls += 1; return { ok: true, status: 200, json: async () => ({}) }; };
  try {
    const seeded = createBotAdvisor({
      NODE_ENV: 'production',
      POORUP_AI_API_KEY: 'live-key',
      POORUP_AI_BASE_URL: 'http://10.0.0.5/v1'
    });
    assert.equal(seeded.apiKey, '', 'an unvalidated env profile does not seed the advisor key');
    const decision = await seeded.chooseAction({ candidates: advisorCandidates, botBrain: 'ai', gameId: 'b8-f025', botId: 'bot-1' });
    assert.equal(decision.fallbackReason, 'missing-credentials');
    const bare = new AiAdvisor({ apiKey: 'live-key' });
    const failed = await bare.chooseAction({ candidates: advisorCandidates, botBrain: 'ai', gameId: 'b8-f025', botId: 'bot-1' });
    assert.equal(failed.fallbackReason, 'network', 'the default transport refuses to send');
    assert.equal(transportCalls, 0, 'no request leaves with the key through the unguarded transport');
  } finally {
    globalThis.fetch = realFetch;
  }
});

// Evicting old game budgets must not reset the budget of a live game.
await checkAsync('a live game keeps its AI budget when older game budgets are evicted', async () => {
  const advisor = new AiAdvisor({ apiKey: 'test-key', maxDecisionsPerGame: 1, fetchImpl: async () => ({ ok: false, status: 500, json: async () => ({}) }) });
  assert.equal(advisor.consumeGameBudget('live-game', 'bot-x'), true);
  for (let index = 0; index < 1100; index += 1) advisor.consumeGameBudget(`other-game-${index}`, 'bot-y');
  assert.equal(advisor.consumeGameBudget('live-game', 'bot-x'), false,
    'the live game still has its one decision spent after 1100 other games arrived');
});

// A process-wide rolling call cap bounds provider spend across games.
await checkAsync('a process-wide rolling call cap stops provider calls across games', async () => {
  let calls = 0;
  const advisor = new AiAdvisor({
    apiKey: 'test-key',
    maxCallsPerHour: 2,
    fetchImpl: async () => { calls += 1; return { ok: false, status: 500, json: async () => ({}) }; }
  });
  const reasons = [];
  for (const gameId of ['cap-a', 'cap-b', 'cap-c']) {
    advisor.circuitOpenUntil = 0;
    advisor.failureStreak = 0;
    reasons.push((await advisor.chooseAction({ candidates: advisorCandidates, botBrain: 'ai', gameId, botId: 'bot-1' })).fallbackReason);
  }
  assert.equal(calls, 2, 'only the first two provider calls leave in the rolling hour');
  assert.equal(reasons[2], 'process-budget', 'the third decision falls back without a provider call');
});

// Rotating the active provider's key reaches the advisor immediately,
// and the rotated key starts from an untested connection.
await checkAsync('rotating the active provider key re-applies it to the advisor only after a passing test', async () => {
  const applied = [];
  const advisor = { fetchImpl: async () => ({}), configureProvider: config => { applied.push(config); } };
  const store = createAiProviderStore({ masterKey: 'b8-master-key-0123456789abcdef' });
  store.upsert({ id: 'openai', label: 'OpenAI', baseUrl: 'https://api.openai.com/v1', model: 'gpt-test', apiKey: 'key-one', protocol: 'auto' });
  store.markTest('openai', { ok: true, protocol: 'chat', latencyMs: 1 });
  store.activate('openai');
  const passing = async () => ({ ok: true, status: 200, json: async () => ({ choices: [{ message: { content: '{"ok":true}' } }] }) });
  const manager = createAiProviderManager({ store, advisor, env: { NODE_ENV: 'test' }, fetchImpl: passing, requestImpl: passing, resolveHost: async () => [{ address: '8.8.8.8', family: 4 }] });
  assert.equal(applied.at(-1).apiKey, 'key-one');
  assert.throws(() => manager.upsert({ id: 'openai', apiKey: 'key-two' }), /connection test/, 'a bare upsert cannot rotate the active key');
  assert.equal(applied.at(-1).apiKey, 'key-one', 'the refused rotation never reaches the advisor');
  assert.equal((await manager.update({ id: 'openai', apiKey: 'key-two' })).test.ok, true);
  assert.equal(applied.at(-1).apiKey, 'key-two', 'the rotated key is the one the advisor now uses once it passes');
});

// The private-endpoint opt-in has one name; the old name still works
// and warns once.
check('the private-endpoint opt-in reads one name and warns once for the alias', () => {
  const warnings = [];
  const originalWarn = console.warn;
  console.warn = message => { warnings.push(String(message)); };
  try {
    assert.equal(allowPrivateEndpointsFromEnv({ POORUP_AI_ALLOW_PRIVATE: 'true' }), true);
    assert.equal(allowPrivateEndpointsFromEnv({}), false);
    assert.equal(allowPrivateEndpointsFromEnv({ POORUP_AI_ALLOW_PRIVATE_ENDPOINTS: 'true' }), true, 'the deprecated alias still enables the opt-in');
    assert.equal(allowPrivateEndpointsFromEnv({ POORUP_AI_ALLOW_PRIVATE_ENDPOINTS: 'true' }), true);
  } finally {
    console.warn = originalWarn;
  }
  assert.equal(warnings.length, 1, `the alias logs exactly once: ${JSON.stringify(warnings)}`);
  assert.match(warnings[0], /POORUP_AI_ALLOW_PRIVATE_ENDPOINTS is deprecated/);
});

// The documented default (a key with no base URL) still
// seeds the DeepSeek endpoint in production, so a valid env profile keeps working.
check('a valid production key with the default endpoint still seeds the advisor', () => {
  const seeded = createBotAdvisor({ NODE_ENV: 'production', POORUP_AI_API_KEY: 'live-key' });
  assert.equal(seeded.apiKey, 'live-key');
  assert.equal(seeded.endpoint, 'https://api.deepseek.com/chat/completions');
});

// A bot decision that never settles frees its turn lock
// through the watchdog, and the stale completion cannot free the lock a newer
// decision holds.
await checkAsync('a stalled bot decision is released by the watchdog and a stale finish cannot free the newer lock', async () => {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'wd-host', clientId: 'wd-host', nickname: 'Host', rulesProfile: 'advanced', roomCode: 'B8WATCH' });
  room.addOrReconnectPlayer({ socketId: 'wd-seat', clientId: 'wd-seat', nickname: 'Seat' });
  room.setRoomSetting('bots', 1);
  assert.equal(room.startGame().success, true);
  const bot = room.game.players.find(player => player.isBot);
  room.game.currentPlayerId = bot.id;
  room.game.hasRolled = false;
  room.game.awaitingEndTurn = false;
  const timers = [];
  const decisions = [];
  const stallingAdvisor = {
    chooseAction: () => new Promise(resolve => { decisions.push(resolve); })
  };
  const io = { emit() {}, on() {}, to() { return { emit() {} }; }, in() { return { emit() {} }; }, sockets: { sockets: new Map() } };
  const runtime = createRuntime({
    io,
    roomManager: manager,
    accountStore: {},
    socialStore: {},
    matchStore: {},
    achievementStore: {},
    telemetryStore: null,
    botAdvisor: stallingAdvisor,
    social: { chatLastSent: new Map(), patrolRuns: new Map(), socketsForAccount() { return []; } },
    maintenance: {},
    metrics: { setMetric() {} },
    authoritativeStore: {},
    pubsubAdapter: {},
    setTimeout(callback, delay) {
      const timer = { callback, delay, cleared: false, fired: false };
      timers.push(timer);
      return timer;
    },
    clearTimeout(timer) { if (timer) timer.cleared = true; },
    setInterval() { return { unref() {} }; },
    clearInterval() {}
  });
  const live = () => timers.filter(timer => !timer.cleared && !timer.fired);
  const fire = timer => { timer.fired = true; timer.callback(); };
  const turnTimers = () => live().filter(timer => timer.delay < 15_000);
  const watchdogs = () => live().filter(timer => timer.delay >= 15_000);
  const settle = async () => { for (let index = 0; index < 5; index += 1) await new Promise(resolve => setImmediate(resolve)); };

  runtime.scheduleBotTurn(room);
  assert.equal(turnTimers().length, 1, 'the bot turn is queued');
  fire(turnTimers()[0]);
  await settle();
  assert.equal(decisions.length, 1, 'the first decision is asked of the advisor');
  assert.equal(watchdogs().length, 1, 'a watchdog bounds the decision');
  assert.equal(turnTimers().length, 0, 'the decision lock keeps the next turn out while it runs');

  fire(watchdogs()[0]);
  await settle();
  assert.equal(turnTimers().length, 1, 'the watchdog releases the lock and queues the next turn');
  fire(turnTimers()[0]);
  await settle();
  assert.equal(decisions.length, 2, 'the next turn starts a second decision');
  assert.equal(watchdogs().length, 1, 'the second decision has its own watchdog');

  // The first decision finally answers. It must not free the second decision's lock.
  decisions[0](null);
  await settle();
  runtime.scheduleBotTurn(room);
  assert.equal(turnTimers().length, 0, 'a stale finish leaves the newer decision lock in place');
});

// A blocked trade proposal names the blocker that is really open.
check('a blocked trade proposal names the blocker that is open', () => {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'f090-host', clientId: 'f090-host', nickname: 'Host', rulesProfile: 'advanced', roomCode: 'B8F090' });
  room.addOrReconnectPlayer({ socketId: 'f090-seat', clientId: 'f090-seat', nickname: 'Seat' });
  assert.equal(room.startGame().success, true);
  const game = room.game;
  const proposer = game.getPlayerBySocket('f090-host');
  const other = game.players.find(player => player.id !== proposer.id);
  const offer = { toPlayerId: other.id, requestCash: 10 };
  const blockers = [
    ['auction', { auction: { active: true } }, 'Resolve the open auction before proposing a trade.'],
    ['purchase offer', { pendingPurchaseOffer: { playerId: proposer.id, tileIndex: 1 } }, 'Resolve the pending purchase offer before proposing a trade.'],
    ['sponsorship', { pendingSponsoredPurchase: { buyerId: proposer.id, tileIndex: 1 } }, 'Resolve the pending sponsored purchase before proposing a trade.'],
    ['contract', { pendingPlayerContract: { id: 'b8-contract', fromPlayerId: proposer.id, toPlayerId: other.id } }, 'Resolve the pending player contract before proposing a trade.'],
    ['trade', { pendingTrade: { id: 'b8-trade' } }, 'Another trade is already pending.']
  ];
  for (const [name, state, error] of blockers) {
    for (const key of ['auction', 'pendingPurchaseOffer', 'pendingSponsoredPurchase', 'pendingPlayerContract', 'pendingTrade']) game[key] = null;
    Object.assign(game, state);
    assert.deepEqual(game.proposeTrade('f090-host', offer), { success: false, error }, `the ${name} blocker is named`);
    assert.equal(game.pendingTrade?.id ?? null, state.pendingTrade?.id ?? null, `the ${name} proposal changes nothing`);
  }
});

// A contract a bot creates reaches its human recipient as an event, the
// same way a human's proposal does, not silently in the rail.
await checkAsync('a bot-created contract offer is sent to its human recipient', async () => {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'f089-host', clientId: 'f089-host', nickname: 'Host', rulesProfile: 'advanced', roomCode: 'B8F089' });
  room.addOrReconnectPlayer({ socketId: 'f089-seat', clientId: 'f089-seat', nickname: 'Seat' });
  room.setRoomSetting('bots', 1);
  assert.equal(room.startGame().success, true);
  const game = room.game;
  const bot = game.players.find(player => player.isBot);
  const humans = game.players.filter(player => !player.isBot);
  bot.cash = 2000;
  humans.forEach(human => { human.cash = 600; });
  game.currentPlayerId = bot.id;
  game.hasRolled = true;
  game.awaitingEndTurn = true;
  const sent = [];
  const io = {
    emit() {},
    on() {},
    to(target) { return { emit: (event, payload) => sent.push({ target, event, payload }) }; },
    in() { return { emit() {} }; },
    sockets: { sockets: new Map() }
  };
  const timers = [];
  const runtime = createRuntime({
    io,
    roomManager: manager,
    accountStore: {},
    socialStore: {},
    matchStore: {},
    achievementStore: {},
    telemetryStore: null,
    botAdvisor: { chooseAction: async context => ({ actionId: context.candidates.find(candidate => candidate.kind === 'contract-propose')?.id || 'end-turn', provider: 'ai', fallback: false }) },
    social: { chatLastSent: new Map(), patrolRuns: new Map(), socketsForAccount() { return []; } },
    maintenance: {},
    metrics: { setMetric() {} },
    authoritativeStore: {},
    pubsubAdapter: {},
    setTimeout(callback, delay) { const timer = { callback, delay }; timers.push(timer); return timer; },
    clearTimeout() {},
    setInterval() { return { unref() {} }; },
    clearInterval() {}
  });
  runtime.scheduleBotTurn(room);
  const turn = timers.find(timer => timer.delay < 15_000);
  assert.ok(turn, 'the bot turn is queued');
  turn.callback();
  for (let index = 0; index < 10; index += 1) await new Promise(resolve => setImmediate(resolve));
  const contract = game.pendingPlayerContract;
  assert.ok(contract, 'the bot proposed a contract');
  const recipient = game.getPlayerById(contract.toPlayerId);
  assert.equal(recipient.isBot, false, 'the contract is addressed to a human');
  const offers = sent.filter(entry => entry.event === 'player-contract-offer');
  assert.equal(offers.length, 1, 'exactly one contract offer event is sent');
  assert.equal(offers[0].target, recipient.socketId, 'the offer is sent to the human recipient');
  assert.equal(offers[0].payload.contract.id, contract.id);
});

// The env cap is read once at construction and documented beside the others.
check('the process-wide AI call cap is set from POORUP_AI_CALLS_PER_HOUR', () => {
  assert.equal(createBotAdvisor({ POORUP_AI_API_KEY: 'k', POORUP_AI_CALLS_PER_HOUR: '7' }).maxCallsPerHour, 7);
  assert.ok(createBotAdvisor({ POORUP_AI_API_KEY: 'k' }).maxCallsPerHour > 0, 'an unset cap still bounds spend');
});

if (failures.length) {
  console.error(`${failures.length} bot-runtime check(s) failed`);
  process.exitCode = 1;
} else {
  console.log('bot-runtime checks passed');
}
