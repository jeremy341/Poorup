// Candidate generation for staged-complexity market orders (margin, short, options) and short buy-in debt.
// The engine's advert list (marketExpansion.expansionCandidates) is what is legal in principle; this layer decides what a bot offers:
//   - no order the server would refuse right now (debt freeze, quota, pending obligation, loan-backed cash, empty borrow pool);
//   - a margin long or short only where expected value after fees, borrow fee and reserve clears the hurdle;
//   - a held short covered with what the seat can fund, a margin loan repaid in full when cash allows, and forced buy-in debt settled.
import { MARKET_FEE_RATE } from './marketLogic.js';
import {
  MARGIN_COLLATERAL_RATE,
  SHORT_COLLATERAL_RATE,
  complexityAllows,
  expansionGuard
} from './marketExpansion.js';
import { forecastLeveragedOpen } from './botMarketForecast.js';

// Cash a bot keeps after paying down forced buy-in debt (the static purchase reserve).
const SETTLE_RESERVE = 120;
const OPENING_ORDER_QUANTITY = 1;

const GUARDED_KINDS = {
  'open-margin': ['margin', 'open'],
  'reduce-margin': ['margin', 'manage'],
  'open-short': ['shorting', 'open'],
  'cover-short': ['shorting', 'manage'],
  'open-option': ['derivatives', 'open'],
  'exercise-option': ['derivatives', 'manage'],
  'close-position': ['derivatives', 'manage']
};

function wholeNumber(value) {
  const parsed = Math.floor(Number(value));
  return Number.isFinite(parsed) ? parsed : 0;
}

function forecastContext(game) {
  const event = game.globalEvent?.phase === 'active' ? game.globalEvent : null;
  const effects = game.activeEventEffects?.() || {};
  return {
    history: game.marketQuoteHistory,
    marketVolatility: effects.marketVolatility,
    activeEventId: event?.id || null,
    activeEventStartedRound: event?.startedRound,
    eventPriceMultiplier: effects.marketPriceMultiplier
  };
}

function orderFee(gross) {
  return Math.max(1, Math.ceil(gross * MARKET_FEE_RATE));
}

function integerQuotes(game) {
  return Object.entries(game.marketQuotes || {})
    .map(([id, raw]) => ({ id, quote: Number(raw) }))
    .filter(entry => Number.isInteger(entry.quote) && entry.quote > 0);
}

function borrowable(game, instrumentId) {
  const pool = game.marketShortInventory;
  if (!pool || pool[instrumentId] === undefined) return true;
  return wholeNumber(pool[instrumentId]) >= OPENING_ORDER_QUANTITY;
}

function openingCash(kind, quote) {
  const gross = quote * OPENING_ORDER_QUANTITY;
  if (kind === 'open-short') return Math.ceil(gross * SHORT_COLLATERAL_RATE);
  return orderFee(gross) + Math.ceil(gross * MARGIN_COLLATERAL_RATE);
}

// Best clearly-positive instrument for an opening order, or null.
function bestOpening(game, player, candidate) {
  const base = forecastContext(game);
  let best = null;
  integerQuotes(game).forEach(({ id, quote }) => {
    if (candidate.kind === 'open-short' && !borrowable(game, id)) return;
    if (wholeNumber(player.cash) < openingCash(candidate.kind, quote)) return;
    const evaluation = forecastLeveragedOpen({ kind: candidate.kind, instrumentId: id, quote, quantity: OPENING_ORDER_QUANTITY, ...base });
    if (!evaluation.supported || !evaluation.clear) return;
    if (!best || evaluation.expectedValue > best.evaluation.expectedValue) best = { id, evaluation };
  });
  if (!best) return null;
  const { evaluation } = best;
  return {
    ...candidate,
    instrumentId: best.id,
    quantity: OPENING_ORDER_QUANTITY,
    risk: evaluation.forecast.volatilityPercent,
    score: evaluation.expectedValue,
    expectedMarketPnl: evaluation.expectedValue,
    expectedMovePercent: evaluation.forecast.expectedMovePercent
  };
}

// The worst short the bot can afford to cover right now. An underwater
// unaffordable holding must not hide another position the seat can close.
function worstShort(game, player) {
  let worst = null;
  Object.entries(player.shortPositions || {}).forEach(([id, position]) => {
    if (!(Number(position?.quantity) > 0)) return;
    const candidate = coverableShort(game, player, id, position);
    if (candidate && (!worst || candidate.ratio > worst.ratio)) worst = candidate;
  });
  return worst;
}

// One held short the seat can fund to cover: its quote, ratio to entry and affordable quantity. Null when none is affordable.
function coverableShort(game, player, id, position) {
  const entry = Number(position.entryQuote) || 0;
  const quote = Math.max(10, Number(game.marketQuotes?.[id]) || entry || 100);
  const ratio = entry > 0 ? quote / entry : 1;
  const quantity = affordableCover(player, { position, quote });
  if (!quantity) return null;
  return { id, position, quote, ratio, quantity };
}

// Largest quantity of the short the seat can fund (marketExpansion.coverShort's own check).
function affordableCover(player, held) {
  const { position, quote } = held;
  const quantity = wholeNumber(position.quantity);
  for (let amount = quantity; amount >= 1; amount -= 1) {
    const gross = quote * amount;
    const release = Math.ceil((Number(position.collateral) / quantity) * amount);
    const feePortion = Math.ceil(Number(position.borrowFee || 0) * (amount / quantity));
    if (Math.max(0, Number(player.cash) || 0) + release >= gross + orderFee(gross) + feePortion) return amount;
  }
  return 0;
}

function coverCandidate(game, player, candidate) {
  const held = worstShort(game, player);
  if (!held) return null;
  return { ...candidate, instrumentId: held.id, quantity: held.quantity };
}

function reduceCandidate(player, candidate) {
  const amount = Math.min(wholeNumber(player.marginBalance), wholeNumber(player.cash));
  return amount >= 1 ? { ...candidate, amount } : null;
}

function cheapestInstrument(quotes) {
  return Object.entries(quotes || {}).sort(([, a], [, b]) => Number(a) - Number(b))[0]?.[0] || 'brazil';
}

function optionCandidate(game, player, candidate) {
  if (candidate.kind === 'open-option') {
    const instrumentId = cheapestInstrument(game.marketQuotes);
    return { ...candidate, instrumentId, quantity: 1, side: 'call', strike: Number(game.marketQuotes?.[instrumentId]) || 100, premium: 10, expiryRounds: 3 };
  }
  if (candidate.kind === 'exercise-option') {
    const optionId = player.optionPositions?.find(option => option.status === 'open')?.id;
    return optionId ? { ...candidate, optionId } : null;
  }
  return candidate;
}

function enrich(game, player, candidate) {
  if (candidate.kind === 'open-margin' || candidate.kind === 'open-short') return bestOpening(game, player, candidate);
  if (candidate.kind === 'cover-short') return coverCandidate(game, player, candidate);
  if (candidate.kind === 'reduce-margin') return reduceCandidate(player, candidate);
  return optionCandidate(game, player, candidate);
}

// Pay forced buy-in debt down to the reserve. The server's shortDefaultRejection
// has no turn gate (the debt must never be unreachable), so neither does this.
// The seat must be live at a started table, with the short market open and no payment or loan-backed cash pending.
function settleBlocked(game, player) {
  if (!game.started || player.bankrupt || player.disconnected) return true;
  if (!game.settings.market || !complexityAllows(game, 'shorting')) return true;
  return Boolean(game.pendingPayment || game.hasLoanBackedCash?.(player));
}

function settleCandidate(game, player) {
  const debt = wholeNumber(player.shortDefaultDebt);
  if (debt <= 0 || settleBlocked(game, player)) return null;
  const amount = Math.min(debt, wholeNumber(player.cash) - SETTLE_RESERVE);
  if (amount < 1) return null;
  return { id: 'market:settle-short-default', kind: 'settle-short-default', amount, risk: 0, score: 12 };
}

function guarded(game, player, candidate) {
  const rule = GUARDED_KINDS[candidate.kind];
  return !rule || !expansionGuard(game, player, rule[0], rule[1]);
}

export function marketExpansionCandidatesFor(game, player) {
  if (!game.settings.market) return [];
  if (typeof game.marketExpansionCandidates !== 'function') return [];
  const offered = (game.marketExpansionCandidates(player) || [])
    .filter(candidate => guarded(game, player, candidate))
    .map(candidate => enrich(game, player, candidate))
    .filter(Boolean);
  const settle = settleCandidate(game, player);
  return settle ? [...offered, settle] : offered;
}
