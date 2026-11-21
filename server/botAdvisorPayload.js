// Builds the privacy-scrubbed, allowlisted context snapshot and candidate list that is sent to the AI provider.
import { normalizeRolloutBudget, planningHorizon, rankCandidates } from './botFuturePlanner.js';
import { BOT_CONTEXT_VERSION } from './botStrategicContext.js';
import { DIFFICULTY_CONFIG, normalizeDifficulty } from './botAdvisorDifficulty.js';
import { actionKindFromId, candidateEvaluation, shortlistAdvisorCandidates } from './botAdvisorShortlist.js';

const PROVIDER_CONTEXT_FIELDS = new Set(['contextVersion', 'ruleVersion', 'phase', 'roundNumber', 'botDifficulty', 'planningHorizon', 'botState', 'turn', 'recentDecisions', 'decisionMemory', 'board', 'opponentSummaries', 'table', 'obligations', 'rulesDigest', 'activeEvent', 'event', 'marketQuotes', 'marketQuoteHistory', 'candidates', 'candidateCoverage']);
// Identifier keys are private (playerId, tile_id); the id test is case-sensitive so
// money fields that merely end in the letters "id" (highestBid, paid) reach the model.
const PRIVATE_PROVIDER_ID_KEYS = /^id$|[a-z0-9]Ids?$|_ids?$/;
const PRIVATE_PROVIDER_KEYS = /^(?:.*(?:credential|token|secret|apikey|accesskey|privatekey|authorization)|text|reasoning|rationale)$/i;

function sanitizeProviderValue(value) {
  if (Array.isArray(value)) return value.map(sanitizeProviderValue);
  if (!value || typeof value !== 'object') return value;
  return Object.fromEntries(Object.entries(value)
    .filter(([key]) => ['actionId', 'choiceId'].includes(key) || !(PRIVATE_PROVIDER_ID_KEYS.test(key) || PRIVATE_PROVIDER_KEYS.test(key)))
    .map(([key, entry]) => [key, sanitizeProviderValue(entry)]));
}

const PROVIDER_CANDIDATE_FIELDS = ['kind', 'score', 'risk', 'cost', 'stake', 'amount', 'minimumAmount', 'maximumAmount', 'totalDue', 'remaining', 'premiumRate', 'durationRounds', 'expectedRent', 'expectedRisk', 'expectedCashFlow', 'expectedMarketEdge', 'expectedMarketPnl', 'expectedMovePercent', 'fee', 'projectedLiquidity', 'futureScore', 'estimatedNetWorthDelta', 'planningHorizon', 'projectionStatus', 'policyVersion', 'rolloutBudget', 'tileIndex', 'propertyIndex', 'collateralTileIndex', 'houseCount', 'choiceId', 'side', 'quantity', 'color', 'permanent'];
const PROVIDER_OFFER_FIELDS = ['kind', 'amount', 'premiumRate', 'durationRounds', 'propertyIndex', 'collateralTileIndex', 'equityShare', 'equityControl', 'conversionShare', 'permanent'];
const PROVIDER_STRING_FIELDS = new Set(['choiceId', 'side', 'color', 'projectionStatus', 'policyVersion']);

function validProviderScalar(value) {
  if (typeof value === 'number') return Number.isFinite(value);
  return typeof value === 'boolean';
}

function providerKindString(key, value) {
  if (key !== 'kind') return false;
  if (typeof value !== 'string') return false;
  return /^[a-z0-9-]{1,40}$/i.test(value);
}

function providerNamedString(key, value) {
  if (!PROVIDER_STRING_FIELDS.has(key)) return false;
  if (typeof value !== 'string') return false;
  return /^[a-z0-9_-]{1,40}$/i.test(value);
}

function providerCandidateField(key, value) {
  if (validProviderScalar(value)) return { include: true, value };
  if (providerKindString(key, value)) return { include: true, value };
  if (providerNamedString(key, value)) return { include: true, value };
  return { include: false };
}

function copyProviderCandidateFields(candidate, dto) {
  PROVIDER_CANDIDATE_FIELDS.forEach(key => {
    const field = providerCandidateField(key, candidate?.[key]);
    if (field.include) dto[key] = field.value;
  });
}

function addProviderChoiceKind(dto, choiceKind) {
  if (/^[a-z-]{1,32}$/i.test(choiceKind)) dto.choice = choiceKind;
}

function addProviderChoiceTile(dto, choiceKind, choiceIndex) {
  if (!/^(?:mortgage|sell)$/.test(choiceKind)) return;
  if (!/^\d+$/.test(choiceIndex || '')) return;
  dto.tileIndex = Number(choiceIndex);
}

function addProviderPlainChoiceId(dto, candidate, choiceIndex) {
  if (choiceIndex) return;
  if (/^[a-z0-9_-]{1,40}$/i.test(candidate.choiceId)) dto.choiceId = candidate.choiceId;
}

function addProviderChoiceFields(candidate, dto) {
  if (candidate?.kind !== 'choice') return;
  if (typeof candidate.choiceId !== 'string') return;
  const [choiceKind, choiceIndex] = candidate.choiceId.split(':');
  addProviderChoiceKind(dto, choiceKind);
  addProviderChoiceTile(dto, choiceKind, choiceIndex);
  addProviderPlainChoiceId(dto, candidate, choiceIndex);
}

function providerOffer(candidate) {
  if (!candidate?.offer || typeof candidate.offer !== 'object') return null;
  const offer = {};
  PROVIDER_OFFER_FIELDS.forEach(key => {
    const value = candidate.offer[key];
    if (validProviderScalar(value)) offer[key] = value;
    else if (typeof value === 'string' && /^[a-z0-9_-]{1,32}$/i.test(value)) offer[key] = value;
  });
  return Object.keys(offer).length ? offer : null;
}

function providerCandidate(candidate, actionId) {
  const dto = { actionId };
  copyProviderCandidateFields(candidate, dto);
  if (candidate?.kind === 'auction-bid' && candidate.parameterRanges?.amount) {
    const range = candidate.parameterRanges.amount;
    if (range.type === 'integer' && Number.isInteger(range.minimum) && Number.isInteger(range.maximum) && range.minimum <= range.maximum) {
      dto.parameterRanges = { amount: { type: 'integer', minimum: range.minimum, maximum: range.maximum } };
    }
    const options = Array.isArray(candidate.amountOptions) ? candidate.amountOptions.filter(Number.isInteger) : [];
    if (options.length) dto.amountOptions = options;
  }
  addProviderChoiceFields(candidate, dto);
  const offer = providerOffer(candidate);
  if (offer) dto.offer = offer;
  return dto;
}

function addBoardIndex(indexes, value) {
  const index = Number(value);
  if (Number.isInteger(index)) indexes.add(index);
}

// A payment choice names its tile in the choice id (mortgage:5, sell:9): the
// candidates carry no tile of their own, so the board of that phase is read
// from the choice.
function paymentChoiceTileIndex(candidate) {
  const fromChoice = /^(?:mortgage|sell):(\d+)$/.exec(String(candidate?.choiceId || ''));
  if (fromChoice) return Number(fromChoice[1]);
  const fromId = /^debt:(?:mortgage|sell):(\d+)$/.exec(String(candidate?.id || ''));
  return fromId ? Number(fromId[1]) : undefined;
}

function paymentBoardIndexes(candidates) {
  const indexes = new Set();
  candidates.forEach(candidate => {
    addBoardIndex(indexes, candidate.tileIndex ?? candidate.propertyIndex);
    addBoardIndex(indexes, paymentChoiceTileIndex(candidate));
  });
  return indexes;
}

function tradeBoardIndexes(context) {
  const indexes = new Set();
  const trade = context.obligations?.trade || {};
  [...(trade.givePropertyIndexes || []), ...(trade.requestPropertyIndexes || [])].forEach(value => addBoardIndex(indexes, value));
  return indexes;
}

function contractBoardIndexes(context) {
  const indexes = new Set();
  addBoardIndex(indexes, context.obligations?.contract?.propertyIndex);
  addBoardIndex(indexes, context.obligations?.contract?.collateralTileIndex);
  return indexes;
}

function phaseBoardIndexes(context, phase, candidates) {
  if (phase === 'auction') return new Set([Number(context.obligations?.auction?.tileIndex)]);
  if (phase === 'payment') return paymentBoardIndexes(candidates);
  if (phase === 'trade') return tradeBoardIndexes(context);
  if (phase === 'contract') return contractBoardIndexes(context);
  return new Set();
}

function phaseBoard(context, phase, candidates) {
  const board = Array.isArray(context.board) ? context.board : [];
  if (phase === 'pre-roll' || phase === 'post-roll') return board.slice(0, 64);
  const indexes = phaseBoardIndexes(context, phase, candidates);
  return board.filter(tile => indexes.has(Number(tile.index))).slice(0, 16);
}

function scrubDecisionHistory(context) {
  const recentDecisions = (Array.isArray(context.recentDecisions) ? context.recentDecisions : []).slice(-6).map(entry => ({
    sequence: entry.sequence,
    phase: entry.phase,
    actionKind: actionKindFromId(entry.actionId),
    fallback: entry.fallback === true,
    success: entry.success !== false,
    strategicScore: entry.strategicScore,
    reasonCode: entry.reasonCode
  }));
  const decisionMemory = context.decisionMemory || { decisions: 0, successes: 0, failures: 0, actionRates: [], phaseRates: [] };
  return {
    recentDecisions,
    decisionMemory: {
      decisions: decisionMemory.decisions || 0,
      successes: decisionMemory.successes || 0,
      failures: decisionMemory.failures || 0,
      actionRates: (decisionMemory.actionRates || []).slice(-8).map(entry => ({
        actionKind: actionKindFromId(entry.actionId),
        attempts: entry.attempts,
        successes: entry.successes
      })),
      phaseRates: (decisionMemory.phaseRates || []).slice(-8).map(entry => ({ phase: entry.phase, attempts: entry.attempts, successes: entry.successes }))
    }
  };
}

// Option-ID bias (Zheng et al., ICLR 2024): the shortlist is best-first, so a model that echoes the first
// option looked like good play. The order the model sees is a seeded shuffle (per room and decision), and
// the token maps back to the real candidate. The position of every answer is counted.
function hashSeed(text) {
  let hash = 2166136261;
  for (const char of String(text)) {
    hash ^= char.codePointAt(0);
    hash = Math.imul(hash, 16777619);
  }
  return hash >>> 0;
}

function seededUnitDraws(seed) {
  let state = hashSeed(seed);
  return () => {
    state = (state + 0x6D2B79F5) >>> 0;
    let mixed = Math.imul(state ^ (state >>> 15), 1 | state);
    mixed = (mixed + Math.imul(mixed ^ (mixed >>> 7), 61 | mixed)) ^ mixed;
    return ((mixed ^ (mixed >>> 14)) >>> 0) / 4294967296;
  };
}

function presentationOrder(items, seed) {
  const order = [...items];
  const nextDraw = seededUnitDraws(seed);
  for (let index = order.length - 1; index > 0; index -= 1) {
    const swap = Math.floor(nextDraw() * (index + 1));
    [order[index], order[swap]] = [order[swap], order[index]];
  }
  return order;
}

function presentationSeed(context) {
  return `${context.gameId || 'poorup'}:${context.decisionSequence || 0}:${context.phase || 'pre-roll'}:option-order`;
}

// The planner's evaluation of every candidate, computed once per candidate list and board.
const plannerEvaluationCache = new WeakMap();
export function plannerEvaluations(context, candidates) {
  if (!(context?.contextVersion && Array.isArray(context.board) && context.board.length)) return null;
  const difficulty = normalizeDifficulty(context.botDifficulty);
  const seed = `${context.gameId || 'poorup'}:${context.decisionSequence || 0}`;
  const rolloutBudget = normalizeRolloutBudget(context.rolloutBudget, DIFFICULTY_CONFIG[difficulty].rolloutBudget);
  const signature = `${difficulty}|${seed}|${rolloutBudget}`;
  const cached = plannerEvaluationCache.get(candidates);
  if (cached?.signature === signature && cached.board === context.board) return cached.evaluations;
  const evaluations = new Map(rankCandidates(context, candidates, { difficulty, seed, rolloutBudget }).map(entry => [entry.candidate.id, entry.evaluation]));
  plannerEvaluationCache.set(candidates, { signature, board: context.board, evaluations });
  return evaluations;
}

// Passing and ending the turn are the stand-still baseline the planner scores against.
const PASS_KINDS = new Set(['roll', 'end-turn', 'end-finance-window']);
// An option must clear standing still by this much (net-worth dollars) to be worth a
// paid model call; exact enumeration leaves no sampling noise, so it is a small margin.
const STAND_STILL_MARGIN = 1;

// True when the decision has no real choice to put to a model: one candidate, or a
// pass next to options the planner fully projects at or below standing still.
export function nothingBeatsPassing(context) {
  const candidates = Array.isArray(context.candidates) ? context.candidates : [];
  if (candidates.length <= 1) return candidates.length === 1;
  const others = candidates.filter(candidate => !PASS_KINDS.has(candidate.kind));
  if (others.length === candidates.length) return false;
  if (!others.length) return true;
  const evaluations = plannerEvaluations(context, candidates);
  if (!evaluations) return false;
  const projected = candidate => ['projected', 'neutral'].includes(evaluations.get(candidate.id)?.projectionStatus);
  const scoreOf = candidate => Number(evaluations.get(candidate.id)?.score) || 0;
  const standStill = Math.max(...candidates.filter(candidate => PASS_KINDS.has(candidate.kind)).map(scoreOf));
  return others.every(candidate => projected(candidate) && scoreOf(candidate) <= standStill + STAND_STILL_MARGIN);
}

export function serializeAdvisorContext(context = {}) {
  const evaluations = plannerEvaluations(context, context.candidates || []) || new Map();
  const shortlist = shortlistAdvisorCandidates(context.candidates || [], evaluations, { phase: context.phase, maxCandidates: 32 });
  const presented = presentationOrder(shortlist.candidates, presentationSeed(context));
  const tokenToCandidate = new Map();
  const candidateDtos = presented.map((candidate, index) => {
    const token = `act-${String(index + 1).padStart(2, '0')}`;
    tokenToCandidate.set(token, candidate);
    const evaluation = candidateEvaluation(candidate, evaluations);
    const annotated = evaluation?.projectionStatus !== 'projected' && evaluation ? {
      ...candidate,
      projectionStatus: evaluation.projectionStatus,
      policyVersion: evaluation.policyVersion,
      planningHorizon: evaluation.horizon,
      rolloutBudget: evaluation.rolloutBudget
    } : evaluation ? {
      ...candidate,
      projectionStatus: evaluation.projectionStatus,
      policyVersion: evaluation.policyVersion,
      planningHorizon: evaluation.horizon,
      futureScore: evaluation.score,
      estimatedNetWorthDelta: evaluation.estimatedNetWorthDelta,
      rolloutBudget: evaluation.rolloutBudget,
      expectedRent: evaluation.expectedRent,
      expectedRisk: evaluation.expectedRisk,
      expectedCashFlow: evaluation.expectedCashFlow,
      expectedMarketEdge: evaluation.expectedMarketEdge,
      projectedLiquidity: evaluation.liquidity
    } : candidate;
    return providerCandidate(annotated, token);
  });
  const summarizedHistory = scrubDecisionHistory(context);
  const phase = String(context.phase || 'pre-roll').slice(0, 24);
  const raw = {
    contextVersion: BOT_CONTEXT_VERSION,
    ruleVersion: String(context.ruleVersion || 'bot-policy-v1').slice(0, 32),
    phase,
    roundNumber: Math.max(0, Math.floor(Number(context.roundNumber) || 0)),
    botDifficulty: normalizeDifficulty(context.botDifficulty),
    planningHorizon: planningHorizon(context.botDifficulty),
    botState: context.botState || {},
    turn: context.turn || {},
    ...summarizedHistory,
    board: phaseBoard(context, phase, shortlist.candidates),
    opponentSummaries: Array.isArray(context.opponents) ? context.opponents.slice(0, 6) : Array.isArray(context.opponentSummaries) ? context.opponentSummaries.slice(0, 6) : [],
    table: context.table && typeof context.table === 'object' ? context.table : null,
    obligations: context.obligations || {},
    rulesDigest: context.rulesDigest || {},
    activeEvent: context.activeEvent || null,
    event: context.event ? { phase: context.event.phase, roundsRemaining: context.event.roundsRemaining, effects: context.event.effects } : null,
    marketQuotes: context.marketQuotes || {},
    marketQuoteHistory: (Array.isArray(context.marketQuoteHistory) ? context.marketQuoteHistory : []).slice(-12).map(point => ({
      round: point.round,
      quotes: point.quotes,
      event: typeof point.eventId === 'string' ? point.eventId : null
    })),
    candidates: candidateDtos,
    candidateCoverage: { totalCount: shortlist.totalCount, sentCount: shortlist.candidates.length, omittedCount: shortlist.omittedCount, omittedByKind: shortlist.omittedByKind, phase },
    strategicSummary: {
      expectedRentIncome: Math.max(0, ...[...evaluations.values()].map(value => Number(value.expectedRent) || 0)),
      rentExposure: Math.max(0, ...[...evaluations.values()].map(value => Number(value.expectedRisk) || 0)),
      candidateCount: shortlist.totalCount
    }
  };
  const safe = sanitizeProviderValue(raw);
  const allowlisted = Object.fromEntries(Object.entries(safe).filter(([key]) => PROVIDER_CONTEXT_FIELDS.has(key) || key === 'strategicSummary'));
  const plannerBestPosition = presented.indexOf(shortlist.candidates[0]) + 1;
  return { snapshot: allowlisted, tokenToCandidate, shortlist, presentation: { count: presented.length, plannerBestPosition } };
}
