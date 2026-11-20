// Expected landing value for the future planner: where each seat's pawn can land this turn and the next few (dice,
// jail, movement cards), with the rent, tax and pass-Start cash each landing implies.
import { calculateRentFromFacts, rentFactsFromSnapshot } from './botRentForecast.js';
import { finiteNumber, nonNegativeWhole } from './numberUtils.js';
import { DICE_PAIRS, DICE_TOTALS, ALLOWED_ROLLOUT_BUDGETS, boardSignature, expectedCardDelta, landingRent, passStartValue, tileOwner } from './botPlannerBoard.js';

function landingRentRisk({ snapshot, board, tile, diceTotal, ownerInJail = false }) {
  const rent = landingRent(snapshot, board, tile, diceTotal);
  const owner = tileOwner(tile);
  const canCollectRent = !tile.mortgaged;
  const selfCollects = owner === 'self' && canCollectRent && !selfRentBlocked(snapshot, ownerInJail);
  const opponentCollects = owner.startsWith('opponent') && canCollectRent && !opponentIsJailed(snapshot, owner);
  return {
    rent: selfCollects ? rent : 0,
    risk: opponentCollects ? rent : 0
  };
}

function selfRentBlocked(snapshot, ownerInJail) {
  return Boolean(ownerInJail && snapshot.rulesDigest?.noRentWhileInPrison);
}

function opponentIsJailed(snapshot, ownerSeat) {
  return Boolean(snapshot.rulesDigest?.noRentWhileInPrison
    && snapshot.opponents?.find(opponent => opponent.seat === ownerSeat)?.inJail);
}

function landingTaxRisk(snapshot, tile) {
  if (tile.type !== 'tax') return 0;
  return finiteNumber(tile.price || tile.amount) * finiteNumber(snapshot.rulesDigest?.globalEvents?.activeEffects?.taxMultiplier, 1);
}

function nearestCardDestination(board, position, type) {
  for (let offset = 1; offset <= board.length; offset += 1) {
    const tile = board.find(entry => entry.index === (position + offset) % board.length);
    if (tile?.type === type) return tile.index;
  }
  return null;
}

function movementCardKey(tile) {
  if (tile?.type === 'chance') return 'surprise';
  if (tile?.type === 'chest') return 'treasure';
  return null;
}

function moveToCardDestination({ snapshot, card }) {
  if (card.tileId) return snapshot.board.find(entry => entry.tileId === card.tileId)?.index ?? null;
  return Number(card.tileIndex);
}

function startCardDestination({ snapshot, card }) {
  if (card.tileIndex != null) return card.tileIndex;
  if (card.action === 'goToJail') return snapshot.rulesDigest?.jailTileIndex;
  return snapshot.rulesDigest?.startTileIndex;
}

function moveBackCardDestination({ landing, boardLength, card }) {
  return (landing - nonNegativeWhole(card.steps) + boardLength) % boardLength;
}

function railroadCardsGrounded(snapshot) {
  if (snapshot.activeEvent?.phase === 'active' && snapshot.activeEvent?.id === 'airport-strike') return true;
  const effects = snapshot.rulesDigest?.globalEvents?.activeEffects || {};
  return Boolean(effects.airportCardsBlocked);
}

function nearestRailroadCard(context) {
  const grounded = railroadCardsGrounded(context.snapshot);
  const landing = grounded
    ? context.landing
    : nearestCardDestination(context.snapshot.board, context.landing, 'railroad');
  const card = grounded ? { ...context.card, grounded: true } : context.card;
  return { landing, card };
}

function nearestUtilityCard(context) {
  return { landing: nearestCardDestination(context.snapshot.board, context.landing, 'utility'), card: context.card };
}

const MOVEMENT_CARD_RESOLVERS = {
  moveTo: context => ({ landing: moveToCardDestination(context), card: context.card }),
  collectStart: context => ({ landing: startCardDestination(context), card: context.card }),
  goToJail: context => ({ landing: startCardDestination(context), card: context.card }),
  moveBack: context => ({ landing: moveBackCardDestination(context), card: context.card }),
  nearestRailroad: nearestRailroadCard,
  nearestUtility: nearestUtilityCard,
};

function resolveMovementCard(context) {
  const resolve = MOVEMENT_CARD_RESOLVERS[context.card.action];
  if (!resolve) return null;
  const result = resolve(context);
  if (!Number.isInteger(result.landing)) return null;
  if (!context.snapshot.board.some(entry => entry.index === result.landing)) return null;
  return result;
}

function resolvedMovementCardOutcomes({ snapshot, landing, boardLength, movements, count }) {
  const context = { snapshot, landing, boardLength };
  const outcomes = [];
  let movementCount = 0;
  movements.forEach(card => {
    const cardCount = Math.max(0, nonNegativeWhole(card.count));
    const resolved = resolveMovementCard({ ...context, card });
    if (!resolved) return;
    movementCount += cardCount;
    outcomes.push({ landing: resolved.landing, probability: cardCount / count, card: resolved.card });
  });
  return { outcomes, movementCount };
}

function completeMovementCardOutcomes(outcomes, landing, movementCount, count) {
  if (movementCount < count) outcomes.push({ landing, probability: (count - movementCount) / count, card: null });
  if (outcomes.length) return outcomes;
  return [{ landing, probability: 1, card: null }];
}

function movementCardOutcomes(snapshot, tile, landing, boardLength) {
  const key = movementCardKey(tile);
  if (!key) return [{ landing, probability: 1, card: null }];
  const cards = snapshot.rulesDigest?.cards || {};
  const count = Math.max(0, finiteNumber(cards[`${key}Count`]));
  if (!count) return [{ landing, probability: 1, card: null }];
  const movements = cards[`${key}Movement`] || [];
  const result = resolvedMovementCardOutcomes({ snapshot, landing, boardLength, movements, count });
  return completeMovementCardOutcomes(result.outcomes, landing, result.movementCount, count);
}

function canCollectMovementRent(snapshot, tile, card) {
  if (!tile) return false;
  if (card?.grounded) return false;
  const owner = tileOwner(tile);
  if (owner === 'bank') return false;
  if (tile.mortgaged) return false;
  return !(owner.startsWith('opponent') && opponentIsJailed(snapshot, owner));
}

function movementCardRentFacts({ snapshot, state, tile, move, card }) {
  const facts = rentFactsFromSnapshot({ ...snapshot, board: state.board }, tile, move);
  if (card?.action !== 'nearestUtility') return facts;
  return {
    ...facts,
    tile: { ...tile, type: 'other', rent: move * nonNegativeWhole(card.multiplier || 10) },
    hasFullSet: false,
    doubleRent: false,
  };
}

// A double-rent railroad card stacks its multiplier on the table rent first;
// the event factors and the rent cap then apply once. This is the order
// cardApi.cardRentAmount uses, so the forecast and the charge agree.
function railroadCardRent(snapshot, board, tile, move, card) {
  const facts = rentFactsFromSnapshot({ ...snapshot, board }, tile, move);
  const tableRent = calculateRentFromFacts({ ...facts, eventFactors: [], rentCap: null }) * nonNegativeWhole(card.multiplier || 2);
  return calculateRentFromFacts({ ...facts, tile: { type: 'other', rent: tableRent }, hasFullSet: false, doubleRent: false });
}

function movementCardRent({ snapshot, state, tile, move, card }) {
  if (!canCollectMovementRent(snapshot, tile, card)) return 0;
  const owner = tileOwner(tile);
  if (owner !== 'self') return 0;
  if (state.inJail && snapshot.rulesDigest?.noRentWhileInPrison) return 0;
  if (card?.action === 'nearestRailroad') return railroadCardRent(snapshot, state.board, tile, move, card);
  return calculateRentFromFacts(movementCardRentFacts({ snapshot, state, tile, move, card }));
}

function directLandingOutcome({ snapshot, state, position, move, probability, boardLength, landing, tile }) {
  const baseRentRisk = tile ? landingRentRisk({ snapshot, board: state.board, tile, diceTotal: move, ownerInJail: state.inJail }) : { rent: 0, risk: 0 };
  return {
    landing,
    probability,
    rent: baseRentRisk.rent * probability,
    risk: (baseRentRisk.risk + (tile ? landingTaxRisk(snapshot, tile) : 0)) * probability,
    cardDelta: (tile ? expectedCardDelta(snapshot, tile) : 0) * probability,
    cashFlow: passStartValue(snapshot, position, move, boardLength) * probability,
    inJail: false,
    jailTurns: 0
  };
}

function isCardTile(tile) {
  return Boolean(tile && ['chance', 'chest'].includes(tile.type));
}

function isOpponentRentRiskDestination(snapshot, destination) {
  if (!destination) return 0;
  if (!destination.ownerSeat?.startsWith('opponent')) return 0;
  if (opponentIsJailed(snapshot, destination.ownerSeat)) return 0;
  if (destination.mortgaged) return 0;
  return 1;
}

function nearestUtilityCardRisk({ snapshot, state, destination, move, card }) {
  const facts = rentFactsFromSnapshot({ ...snapshot, board: state.board }, destination, move);
  const utilityFacts = {
    ...facts,
    tile: { ...destination, type: 'other', rent: move * nonNegativeWhole(card.multiplier || 10) },
    hasFullSet: false,
    doubleRent: false,
  };
  return calculateRentFromFacts(utilityFacts);
}

function movementCardLandingRentRisk(context) {
  const { snapshot, state, destination, move, card } = context;
  if (!isOpponentRentRiskDestination(snapshot, destination)) return 0;
  if (card.action === 'nearestRailroad') return railroadCardRent(snapshot, state.board, destination, move, card);
  if (card.action === 'nearestUtility') return nearestUtilityCardRisk(context);
  return landingRent(snapshot, state.board, destination, move);
}

function cardPassStartCash(snapshot, originLanding, outcome) {
  const startPassingActions = ['moveTo', 'nearestRailroad', 'nearestUtility'];
  if (!startPassingActions.includes(outcome.card.action)) return 0;
  if (outcome.landing >= originLanding) return 0;
  const base = finiteNumber(snapshot.rulesDigest?.passStartCash, 200);
  const startIndex = finiteNumber(snapshot.rulesDigest?.startTileIndex);
  if (outcome.landing === startIndex && snapshot.rulesDigest?.doubleGo) return base * 2;
  return base;
}

function movementCardLandingOutcome({ snapshot, state, move, probability, landing, direct, outcome }) {
  const destination = state.board.find(entry => entry.index === outcome.landing);
  if (!outcome.card) {
    return {
      ...direct,
      landing: outcome.landing,
      probability: probability * outcome.probability,
      rent: 0,
      risk: 0,
      cardDelta: direct.cardDelta * outcome.probability,
      cashFlow: direct.cashFlow * outcome.probability,
    };
  }
  const rent = movementCardRent({ snapshot, state, tile: destination, move, card: outcome.card });
  const risk = movementCardLandingRentRisk({ snapshot, state, destination, move, card: outcome.card });
  const sentToJail = outcome.card.action === 'goToJail';
  const cardCash = cardPassStartCash(snapshot, landing, outcome);
  return {
    ...direct,
    landing: outcome.landing,
    probability: probability * outcome.probability,
    rent: rent * probability * outcome.probability,
    risk: (risk + (destination ? landingTaxRisk(snapshot, destination) : 0)) * probability * outcome.probability,
    cardDelta: direct.cardDelta * outcome.probability,
    cashFlow: direct.cashFlow * outcome.probability + cardCash * probability * outcome.probability,
    inJail: sentToJail,
    jailTurns: 0
  };
}

function landingOutcome({ snapshot, state, position, move, probability, boardLength }) {
  const landing = (position + move) % boardLength;
  const tile = state.board.find(entry => entry.index === landing);
  const direct = directLandingOutcome({ snapshot, state, position, move, probability, boardLength, landing, tile });
  if (!isCardTile(tile)) return [direct];
  return movementCardOutcomes(snapshot, tile, landing, boardLength).map(outcome => movementCardLandingOutcome({
    snapshot, state, move, probability, landing, direct, outcome,
  }));
}

function seedHash(seed) {
  const text = String(seed ?? 'poorup');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function scenarioUnit(seed, index) {
  let value = (seedHash(seed) + Math.imul(index + 1, 0x9e3779b1)) >>> 0;
  value ^= value << 13;
  value ^= value >>> 17;
  value ^= value << 5;
  return (value >>> 0) / 0x100000000;
}

function sampledDiceRolls(actorState, budget, seed, lockTurns) {
  const counts = new Map();
  for (let sample = 0; sample < budget; sample += 1) {
    const stratifiedPoint = (sample + scenarioUnit(seed, sample)) / budget;
    const pair = DICE_PAIRS[Math.min(DICE_PAIRS.length - 1, Math.floor(stratifiedPoint * DICE_PAIRS.length))];
    const isDouble = pair.first === pair.second;
    const move = actorState.inJail && actorState.jailTurns < lockTurns && !isDouble
      ? null
      : pair.first + pair.second;
    const trackDouble = actorState.inJail && actorState.jailTurns >= lockTurns;
    const key = `${move ?? 'jail'}:${trackDouble && isDouble ? 1 : 0}`;
    const previous = counts.get(key) || { move, isDouble: trackDouble && isDouble, count: 0 };
    previous.count += 1;
    counts.set(key, previous);
  }
  return [...counts.values()].map(outcome => ({ move: outcome.move, isDouble: outcome.isDouble, probability: outcome.count / budget }));
}

function diceRolls(actorState, { rolloutBudget = 0, seed = 'poorup', lockTurns = 2 } = {}) {
  if (ALLOWED_ROLLOUT_BUDGETS.has(rolloutBudget)) return sampledDiceRolls(actorState, rolloutBudget, seed, lockTurns);
  if (!actorState.inJail) return DICE_TOTALS.map(([move, probability]) => ({ move, probability, isDouble: false }));
  if (actorState.jailTurns < lockTurns) return [
    // Every double escapes (2,4,...,12); hand-listing three of them dropped
    // (1,1), (3,3) and (5,5) and left the escape mass at 1/12 instead of 1/6.
    ...DICE_PAIRS.filter(pair => pair.first === pair.second)
      .map(pair => ({ move: pair.first + pair.second, probability: 1 / 36, isDouble: true })),
    { move: null, probability: 5 / 6, isDouble: false }
  ];
  return DICE_PAIRS.map(pair => ({ move: pair.first + pair.second, probability: 1 / 36, isDouble: pair.first === pair.second }));
}

function initialActorPositions(state) {
  const key = `${state.position}:${state.inJail ? 1 : 0}:${state.jailTurns}`;
  return new Map([[key, { position: state.position, inJail: state.inJail, jailTurns: state.jailTurns, probability: 1 }]]);
}

function jailedNoMoveOutcome(actorState, moveProbability) {
  return {
    position: actorState.position,
    inJail: true,
    jailTurns: actorState.jailTurns + 1,
    probability: actorState.probability * moveProbability,
    rent: 0,
    risk: 0,
    cardDelta: 0,
    cashFlow: 0,
  };
}

// The engine charges the fine on the turn that reaches the jail limit (JAIL_MAX_TURNS), and only when the seat can pay it.
// A seat that cannot pay stays in jail. The digest carries both numbers, so the forecast reads them rather than assuming.
function jailMaxTurns(snapshot) {
  const turns = nonNegativeWhole(snapshot?.rulesDigest?.jailMaxTurns);
  return turns > 0 ? turns : 3;
}

// The turn before the limit: a seat is still locked in and cannot move.
function jailLockTurns(snapshot) {
  return Math.max(1, jailMaxTurns(snapshot) - 1);
}

function jailFineForRoll(snapshot, actorState, isDouble) {
  if (!actorState.inJail) return 0;
  if (isDouble) return 0;
  if (actorState.jailTurns + 1 < jailMaxTurns(snapshot)) return 0;
  return finiteNumber(snapshot.rulesDigest?.jailFine, 50);
}

function actorRollLandingOutcomes(context, actorState, roll) {
  const { snapshot, state, boardLength } = context;
  const { move, probability, isDouble } = roll;
  if (move == null) return [jailedNoMoveOutcome(actorState, probability)];
  const weight = actorState.probability * probability;
  const fine = jailFineForRoll(snapshot, actorState, isDouble);
  const projectionState = { ...state, inJail: false };
  if (fine > 0) {
    // The seat only leaves jail when it can pay the fine. A seat that
    // cannot stays in jail and keeps its turn there, so the roll buys no
    // movement and no rent.
    if (state.cash < fine) return [jailedNoMoveOutcome(actorState, probability)];
    return landingOutcome({ snapshot, state: projectionState, position: actorState.position, move, probability: weight, boardLength })
      .map(outcome => ({ ...outcome, position: outcome.landing, fine: fine * weight }));
  }
  return landingOutcome({ snapshot, state: projectionState, position: actorState.position, move, probability: weight, boardLength })
    .map(outcome => ({ ...outcome, position: outcome.landing }));
}

function actorTurnOutcomes(context, actorState) {
  const { options, turn, snapshot } = context;
  const seed = `${options.seed}:self:${turn}:${actorState.position}:${actorState.jailTurns}`;
  const rolls = diceRolls(actorState, { rolloutBudget: options.rolloutBudget, seed, lockTurns: jailLockTurns(snapshot) });
  return rolls.flatMap(roll => actorRollLandingOutcomes(context, actorState, roll));
}

function expandLandingTurn(context) {
  const outcomes = [];
  context.positions.forEach(actorState => outcomes.push(...actorTurnOutcomes(context, actorState)));
  return outcomes;
}

function accumulateLandingTotals(totals, outcomes) {
  outcomes.forEach(outcome => Object.keys(totals).forEach(key => { totals[key] += outcome[key] || 0; }));
}

function mergeLandingPositions(outcomes) {
  const next = new Map();
  outcomes.forEach(outcome => {
    const key = `${outcome.position}:${outcome.inJail ? 1 : 0}:${outcome.jailTurns}`;
    const prior = next.get(key);
    const position = { position: outcome.position, inJail: outcome.inJail, jailTurns: outcome.jailTurns };
    next.set(key, prior ? { ...prior, probability: prior.probability + outcome.probability } : { ...position, probability: outcome.probability });
  });
  return next;
}

// The dice projection reads only the board, the pawn and the jail state. Candidates
// that leave those alone (market orders, loans, repayments, proposals, standing
// still) share one enumeration per snapshot, so no caller pays for its own copy.
const LANDING_CACHE = new WeakMap();

function landingCacheKey(state, horizon, options) {
  return [boardSignature(state), state.position, state.inJail ? 1 : 0, state.jailTurns, state.jailFreeCards, horizon, options.seed, options.rolloutBudget].join('~');
}

export function expectedLandingValue(snapshot, state, horizon, options = {}) {
  let cache = LANDING_CACHE.get(snapshot);
  if (!cache) { cache = new Map(); LANDING_CACHE.set(snapshot, cache); }
  const key = landingCacheKey(state, horizon, options);
  const hit = cache.get(key);
  if (hit) {
    Object.assign(state, hit);
    return;
  }
  computeLandingValue(snapshot, state, horizon, options);
  cache.set(key, {
    expectedRisk: state.expectedRisk,
    expectedCardDelta: state.expectedCardDelta,
    expectedCashFlow: state.expectedCashFlow,
    expectedRent: state.expectedRent,
    expectedFine: state.expectedFine
  });
}

function computeLandingValue(snapshot, state, horizon, options = {}) {
  const boardLength = Math.max(1, (snapshot.board || []).length || 40);
  const totals = { rent: 0, risk: 0, cardDelta: 0, cashFlow: 0, fine: 0 };
  let positions = initialActorPositions(state);
  for (let turn = 0; turn < horizon; turn += 1) {
    const context = { snapshot, state, options, positions, boardLength, turn };
    const outcomes = expandLandingTurn(context);
    accumulateLandingTotals(totals, outcomes);
    positions = mergeLandingPositions(outcomes);
  }
  state.expectedRisk = totals.risk;
  state.expectedCardDelta = totals.cardDelta;
  state.expectedCashFlow = totals.cashFlow;
  state.expectedFine = totals.fine;
  state.expectedRent = expectedOpponentRent({ snapshot, state, horizon, boardLength, options });
}

function opponentStartPositions(opponent) {
  const position = finiteNumber(opponent.position);
  const inJail = opponent.inJail === true;
  const jailTurns = nonNegativeWhole(opponent.jailTurns);
  const key = `${position}:${inJail ? 1 : 0}:${jailTurns}`;
  return new Map([[key, { position, inJail, jailTurns, probability: 1 }]]);
}

function storeOpponentPosition(next, outcome) {
  const key = `${outcome.position}:${outcome.inJail ? 1 : 0}:${outcome.jailTurns}`;
  const prior = next.get(key);
  if (prior) {
    next.set(key, { ...prior, probability: prior.probability + outcome.probability });
    return;
  }
  next.set(key, { ...outcome });
}

function opponentJailOutcome(actorState, moveProbability) {
  return {
    position: actorState.position,
    inJail: true,
    jailTurns: actorState.jailTurns + 1,
    probability: actorState.probability * moveProbability,
  };
}

function opponentRollProjection(context, actorState, roll) {
  if (roll.move == null) return { rent: 0, outcomes: [opponentJailOutcome(actorState, roll.probability)] };
  const landings = landingOutcome({
    snapshot: context.snapshot,
    state: context.state,
    position: actorState.position,
    move: roll.move,
    probability: actorState.probability * roll.probability,
    boardLength: context.boardLength,
  });
  return {
    rent: landings.reduce((sum, outcome) => sum + outcome.rent, 0),
    outcomes: landings.map(outcome => ({
      position: outcome.landing,
      inJail: outcome.inJail,
      jailTurns: outcome.jailTurns,
      probability: outcome.probability,
    })),
  };
}

function opponentTurnSeed(context, actorState) {
  const { options, opponentIndex, turn } = context;
  return `${options.seed}:opponent:${opponentIndex}:${turn}:${actorState.position}:${actorState.jailTurns}`;
}

function projectOpponentTurn(context) {
  const next = new Map();
  let rent = 0;
  context.positions.forEach(actorState => {
    const seed = opponentTurnSeed(context, actorState);
    const rolls = diceRolls(actorState, { rolloutBudget: context.options.rolloutBudget, seed });
    rolls.forEach(roll => {
      const projection = opponentRollProjection(context, actorState, roll);
      rent += projection.rent;
      projection.outcomes.forEach(outcome => storeOpponentPosition(next, outcome));
    });
  });
  return { positions: next, rent };
}

function opponentRentOverHorizon(context) {
  let positions = opponentStartPositions(context.opponent);
  let rent = 0;
  for (let turn = 0; turn < context.horizon; turn += 1) {
    const turnProjection = projectOpponentTurn({ ...context, turn, positions });
    rent += turnProjection.rent;
    positions = turnProjection.positions;
  }
  return rent;
}

// A seat that is bankrupt or disconnected is out of the game: it does not
// move, it never pays rent and it does not scale the table's rent. The
// canonical live seats are gameLogic.activePlayers.
export function liveOpponents(snapshot) {
  return (snapshot.opponents || []).filter(opponent => opponent && !opponent.bankrupt && !opponent.disconnected);
}

export function expectedOpponentRent({ snapshot, state, horizon, boardLength, options = {} }) {
  return liveOpponents(snapshot).reduce((total, opponent, opponentIndex) => total + opponentRentOverHorizon({
    snapshot,
    state,
    horizon,
    boardLength,
    options,
    opponent,
    opponentIndex,
  }), 0);
}
