// Bot decision support as a prototype mixin: socket impersonation for
// bot-driven actions and the pre-roll candidate ranking. The candidate
// arrays keep the original collector order; the final sort is stable, so
// ties keep this sequence. kind values are the contract consumed by
// botLogic's CANDIDATE_MAPPERS/CANDIDATE_RUNNERS tables.
import { MARKET_FEE_RATE } from './marketLogic.js';
import { JAIL_FINE } from './gameData.js';
import { monopolyGiveaway } from './botTradeValuation.js';
import { developmentStage } from './botDevelopmentForecast.js';
import { coalitionAgainst } from './botTableMind.js';
import { tableBrain } from './botTableBrain.js';

// Situation-aware table talk shared by both brains: trailing seats apply
// pressure, spoilers announce kingmaker intent, leaders stay quiet-ish.
// Falls back to the personality line when the table cannot be read.
function tableTalkFor(game, player) {
  const base = BOT_TABLE_TALK[player.personality] || BOT_TABLE_TALK.survivor;
  try {
    const brain = tableBrain(game, player.id);
    if (brain.kingmaker?.spoiler) return BOT_TABLE_TALK_SPOILER;
    if (brain.rank > 1) return BOT_TABLE_TALK_BEHIND[player.personality] || base;
  } catch {
    // Thin stubs: keep the pinned personality line.
  }
  return base;
}

// Jail stay beats exit when the table is developed (mid/late): the bot
// avoids hot rents while still collecting its own. Early boards pay to
// leave and keep buying.
export function jailStayBeatsExit(game, player) {
  if (!game || !player) return false;
  const stage = developmentStage(jailBoard(game, player));
  return stage === 'late' || (stage === 'mid' && Number(player.cash || 0) < 500);
}

function jailBoard(game, player) {
  return (game.tiles || []).map(tile => jailBoardTile(tile, player.id));
}

function jailBoardTile(tile, playerId) {
  return {
    group: tile?.group || null,
    ownerSeat: jailBoardSeat(tile, playerId),
    houseCount: tile?.houseCount || 0
  };
}

function jailBoardSeat(tile, playerId) {
  if (!tile?.ownerId) return 'bank';
  return tile.ownerId === playerId ? 'self' : 'opponent-1';
}

// Grudge-gated dealing: ledgers start empty, so normalize missing entries
// to 0 — a direct Number(undefined) comparison would lock out every seat.
function grudgedOut(grudges, id) {
  return Number((grudges || {})[id] || 0) >= 3;
}

// Opening-book helper: a complete set means ahead enough to speculate.
function holdsCompleteSet(game, player) {
  const groups = [...new Set((player?.properties || []).map(index => game.getTile(index)?.group).filter(Boolean))];
  return groups.some(group => {
    try {
      return game.hasFullSet(player.id, group) === true;
    } catch {
      return false;
    }
  });
}

const BOT_CANDIDATE_SOURCES = [
  { collect: (game, player) => game.botJailCandidates(player) },
  { collect: (game, player) => game.botBuildCandidates(player) },
  { collect: (game, player) => game.botMortgageCandidates(player) },
  { collect: (game, player) => game.botRepaymentCandidates(player) },
  { collect: (game, player) => game.botBankLoanRepaymentCandidates(player) },
  { collect: (game, player) => game.botLoanCandidate(player) },
  { collect: (game, player, options) => options.expanded ? game.botGroupTradeCandidates(player) : game.botGroupTradeCandidate(player) },
  { collect: (game, player) => game.botMarketCandidate(player) },
  { collect: (game, player) => game.botCasinoCandidate(player) }
];

// Personality-driven candidate values as data tables so the collectors stay
// branch-light while reproducing the original ternary ladders verbatim. The
// casino spec is only read after the collector's guard confirms the
// personality, so that entry is always defined there.
const BOT_CASINO_SPECS = {
  chaos: { color: 'green', stakeRate: 0.08, score: 18 },
  shark: { color: 'red', stakeRate: 0.03, score: 11 }
};

const BOT_TABLE_TALK = {
  builder: 'I am building the street one square at a time.',
  shark: 'The table is pricing risk incorrectly.',
  survivor: 'Cash first. The next rent bill is always closer than it looks.',
  speculator: 'The numbers are moving; I am watching the spread.',
  diplomat: 'There is probably a deal that leaves both wallets standing.',
  chaos: 'I have a plan. It is not the safe one.'
};

// Trailing lines: intent-tagged pressure keyed to table position. The
// diplomat line keeps a "deal" mention (pinned by candidate tests).
const BOT_TABLE_TALK_BEHIND = {
  builder: 'I am behind; selling me your spare deed gets my houses up.',
  shark: 'Someone is running away with this. Deal with me instead.',
  survivor: 'I need one safe deal to survive the next circuit.',
  speculator: 'The leader is overextended. Price your deeds accordingly.',
  diplomat: 'I need a deal to get back in this. Who is selling?',
  chaos: 'Crowning a leader is boring. Let us shake the board.'
};
const BOT_TABLE_TALK_SPOILER = 'I cannot win this one, but I choose who does. Make your case.';

const BOT_TRADE_ASKS = {
  shark: { requestCash: 40, score: 8 },
  diplomat: { requestCash: 0, score: 24 }
};
const BOT_TRADE_ASK_DEFAULT = { requestCash: 0, score: 8 };

function pendingPurchaseCandidate(game, player, offer) {
  if (offer?.playerId !== player.id) return null;
  const tile = game.getTile(offer.tileIndex);
  return {
    id: 'purchase:' + offer.tileIndex,
    kind: 'purchase',
    tileIndex: offer.tileIndex,
    price: Number(tile?.price) || 0,
    risk: Number(tile?.price || 0) / Math.max(1, Number(player.cash || 0)),
    score: 26
  };
}

function appendPostRollParityCandidates(game, player, options, candidates) {
  if (!options.parity) return;
  candidates.push(...game.botContractCandidates(player));
  candidates.push(...game.botRichTradeCandidates(player));
  candidates.push(...(options.expanded ? game.botGroupTradeCandidates(player) : game.botGroupTradeCandidate(player)));
  candidates.push(...game.botMarketCandidates(player));
  candidates.push(...game.botMarketExpansionCandidates(player));
  candidates.push(...game.botCasinoCandidate(player));
  candidates.push(...game.botSocialCandidates(player));
}

function appendParityCandidates(game, player, candidates) {
  candidates.push(...game.botSellCandidates(player));
  candidates.push(...game.botUnmortgageCandidates(player));
  candidates.push(...game.botContractCandidates(player));
  candidates.push(...game.botRichTradeCandidates(player));
  candidates.push(...game.botMarketCandidates(player).filter(candidate => candidate.side === 'sell'));
  candidates.push(...game.botMarketExpansionCandidates(player));
  candidates.push(...game.botSocialCandidates(player));
}

function appendPreRollCandidates(game, player, options, candidates) {
  if (player.inJail && options.parity) {
    candidates.push(...game.botJailCandidates(player));
    return;
  }
  for (const source of BOT_CANDIDATE_SOURCES) {
    candidates.push(...source.collect(game, player, options));
  }
  candidates.push(...game.botPendingTradeCancelCandidates(player));
  if (options.parity) appendParityCandidates(game, player, candidates);
}

function postRollCandidates(game, player, options) {
  const candidates = [];
  candidates.push(...game.botRepaymentCandidates(player));
  candidates.push(...game.botBankLoanRepaymentCandidates(player));
  candidates.push(...game.botMortgageCandidates(player));
  candidates.push(...game.botSellCandidates(player));
  candidates.push(...game.botUnmortgageCandidates(player));
  appendPostRollParityCandidates(game, player, options, candidates);
  candidates.push(...game.botPendingTradeCancelCandidates(player));
  const canEndTurn = player.bankrupt || Number(player.cash) > 0;
  if (!canEndTurn) {
    candidates.push({ id: 'bankruptcy:zero-cash', kind: 'bankruptcy', risk: 0, score: 2 });
  } else {
    if (game.settings.market) candidates.push({ id: 'end-finance-window', kind: 'end-finance-window', risk: 0, score: -49 });
    candidates.push({ id: 'end-turn', kind: 'end-turn', risk: 0, score: -50 });
  }
  return sortCandidates(candidates);
}

function sortCandidates(candidates) {
  return candidates.sort((a, b) => b.score - a.score || a.risk - b.risk);
}

// Candidate risk against a cash floor of 1, so collectors never divide by
// zero while keeping the original ternary-ladder values verbatim.
function riskAgainstCash(amount, cash) {
  return amount / Math.max(1, cash);
}

// Personality score ladders as tables: the original ternaries mapped one
// personality to a premium score and everyone else to a default.
const BOT_BUILD_SCORES = { builder: 30 };
const BOT_BUILD_SCORE_DEFAULT = 10;
const BOT_MORTGAGE_SCORES = { survivor: 24 };
const BOT_MORTGAGE_SCORE_DEFAULT = 8;
const BOT_LOAN_SCORES = { speculator: 18 };
const BOT_LOAN_SCORE_DEFAULT = -20;
const BOT_MARKET_SCORES = { speculator: 20 };
const BOT_MARKET_SCORE_DEFAULT = 4;

function finiteOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

// Trace serialisers split by section so each stays branch-light; together
// they rebuild the exact field order of the original trace record.
function traceIdentityFields(entry) {
  return {
    botId: entry.botId ? String(entry.botId).slice(0, 80) : null,
    gameId: entry.gameId ? String(entry.gameId).slice(0, 120) : null,
    ruleVersion: String(entry.ruleVersion || 'bot-policy-v1').slice(0, 32),
    sequence: Math.max(0, Math.floor(finiteOrZero(entry.decisionSequence))),
    phase: String(entry.phase || 'unknown').slice(0, 24),
    provider: String(entry.provider || 'deterministic').slice(0, 24),
    fallback: entry.fallback === true,
    success: entry.success !== false,
    fallbackReason: entry.fallbackReason ? String(entry.fallbackReason).slice(0, 40) : null
  };
}

function tracePolicyFields(entry, settings) {
  return {
    brain: String(entry.brain || settings.botBrain || 'ai').slice(0, 12),
    difficulty: String(entry.difficulty || settings.botDifficulty || 'table').slice(0, 12),
    planningHorizon: Math.max(0, Math.min(3, Math.floor(finiteOrZero(entry.planningHorizon)))),
    strategicScore: Number.isFinite(Number(entry.strategicScore)) ? Number(entry.strategicScore) : null
  };
}

function traceActionFields(entry) {
  return {
    actionId: entry.actionId ? String(entry.actionId).slice(0, 100) : null,
    confidence: Math.max(0, Math.min(1, finiteOrZero(entry.confidence))),
    reasonCode: entry.reasonCode ? String(entry.reasonCode).slice(0, 40) : 'unknown',
    latencyMs: Math.max(0, Math.floor(finiteOrZero(entry.latencyMs)))
  };
}

function traceShadowFields(entry) {
  return {
    candidateIds: Array.isArray(entry.candidateIds) ? entry.candidateIds.filter(id => typeof id === 'string').slice(0, 24).map(id => id.slice(0, 100)) : [],
    shadowActionId: entry.shadowActionId ? String(entry.shadowActionId).slice(0, 100) : null,
    shadowConfidence: entry.shadowConfidence == null ? null : Math.max(0, Math.min(1, finiteOrZero(entry.shadowConfidence))),
    shadowProvider: entry.shadowProvider ? String(entry.shadowProvider).slice(0, 24) : null,
    shadowAgreement: entry.shadowAgreement === true,
    shadowModel: entry.shadowModel ? String(entry.shadowModel).slice(0, 48) : null
  };
}

// Shared trade gating: the group and rich trade collectors both refuse the
// same table states before they start pairing deeds.
function canOfferTrade(game, player) {
  if (game.settings.trading === false) return false;
  if (game.pendingTrade) return false;
  if (game.pendingPlayerContract) return false;
  if (player?.isBot && Number(player.botDealActionsThisTurn) >= 1) return false;
  return true;
}

function tradeTiles(game, player) {
  return (player.properties || [])
    .map(index => game.getTile(index))
    .filter(tile => tile && game.isTradeableTile(tile) && tile.group);
}

// Bots may now deal with bots too (same veto applies); humans exploited
// isolated bot seats that never cooperated.
function tradePartners(game, player, table, grudges) {
  return game.activePlayers().filter(candidate => isTradePartner(player, table, grudges, candidate));
}

// No feeding a teaming pair, no deals with a grudge >= 3.
function isTradePartner(player, table, grudges, candidate) {
  if (candidate.id === player.id) return false;
  if (candidate.bankrupt) return false;
  if (candidate.disconnected) return false;
  if (table.teaming && table.pair.includes(candidate.id)) return false;
  return !grudgedOut(grudges, candidate.id);
}

function collectGroupTradeCandidates(ctx, partner, owned, out) {
  const { game } = ctx;
  const requested = tradeTiles(game, partner);
  for (const giveTile of owned) {
    for (const askTile of requested) {
      if (askTile.group !== giveTile.group) continue;
      const candidate = groupTradeCandidate(ctx, partner, giveTile, askTile);
      if (candidate) out.push(candidate);
    }
  }
}

// Never hand the partner a build-ready monopoly completer. Phase 1:
// skip the candidate (premium-priced counters arrive in phase 2).
function groupTradeCandidate(ctx, partner, giveTile, askTile) {
  const { game, ask } = ctx;
  const giveaway = monopolyGiveaway(game, [giveTile.index], partner.id);
  if (giveaway.givesMonopoly && giveaway.buildReady) return null;
  const state = groupTradeGroupState(ctx, partner, giveTile, askTile);
  return {
    id: 'trade:' + partner.id + ':' + askTile.index,
    kind: 'trade',
    toPlayerId: partner.id,
    givePropertyIndexes: [giveTile.index],
    requestPropertyIndexes: [askTile.index],
    giveCash: 0,
    requestCash: groupTradeRequestCash(giveTile, askTile, giveaway.givesMonopoly),
    risk: 0.2,
    score: groupTradeScore(ask, state)
  };
}

function groupTradeGroupState(ctx, partner, giveTile, askTile) {
  const { game, player } = ctx;
  const botOwnedBefore = game.getGroupTiles(giveTile.group).filter(tile => tile.ownerId === player.id).length;
  const botOwnedAfter = botOwnedBefore - 1 + (askTile.ownerId === partner.id ? 1 : 0);
  const targetCount = game.getGroupTiles(giveTile.group).length;
  return {
    completesGroup: botOwnedAfter >= targetCount,
    breaksGroup: botOwnedBefore >= targetCount && botOwnedAfter < targetCount
  };
}

// Cash-balanced ask: cover the face gap plus a full-face premium
// when handing over a (non-build-ready) completer. Replaces the
// flat 40/0 personality asks with priced asks.
function groupTradeRequestCash(giveTile, askTile, givesMonopoly) {
  const faceGap = Math.max(0, Math.floor(Number(askTile.price) || 0) - Math.floor(Number(giveTile.price) || 0));
  const completerPremium = givesMonopoly ? Math.floor(Number(giveTile.price) || 0) : 0;
  return faceGap + completerPremium;
}

function groupTradeScore(ask, state) {
  return ask.score + (state.completesGroup ? 28 : 0) - (state.breaksGroup ? 30 : 0);
}

function richTradeCandidate(game, partner, owned) {
  const requested = tradeTiles(game, partner).slice(0, 3);
  if (requested.length < 2) return [];
  return [{
    id: 'trade:rich:' + partner.id,
    kind: 'trade',
    rich: true,
    toPlayerId: partner.id,
    givePropertyIndexes: owned.slice(0, 2).map(tile => tile.index),
    requestPropertyIndexes: requested.slice(0, 2).map(tile => tile.index),
    giveCash: 0,
    requestCash: Math.max(0, Math.floor((requested[0].price + requested[1].price - owned[0].price - owned[1].price) * 0.2)),
    risk: 0.3,
    score: 18
  }];
}

function canProposeContracts(game, player) {
  if (!player) return false;
  if (player.id !== game.currentPlayerId) return false;
  if (game.pendingTrade) return false;
  if (game.pendingPlayerContract) return false;
  if (player.isBot && Number(player.botDealActionsThisTurn) >= 1) return false;
  return true;
}

function contractReserve(game) {
  return Math.max(180, Number(game.settings.startingCash || 1500) * 0.2);
}

function contractTargets(game, player, table, grudges) {
  return game.activePlayers()
    .filter(target => contractTargetEligible(target, player, table, grudges))
    .sort((a, b) => Number(a.cash || 0) - Number(b.cash || 0))
    .slice(0, 2);
}

function contractTargetEligible(target, player, table, grudges) {
  if (target.id === player.id) return false;
  if (target.bankrupt) return false;
  if (target.disconnected) return false;
  if (table.teaming && table.pair.includes(target.id)) return false;
  return !grudgedOut(grudges, target.id);
}

function collectContractCandidates(ctx, target, out) {
  const { game, lenderCash, reserve } = ctx;
  out.push(loanContractCandidate(target, lenderCash, reserve));
  const property = targetTradeableProperty(game, target);
  if (!property) return;
  out.push(equityContractCandidate(target, property, lenderCash, reserve));
  out.push(hybridContractCandidate(target, property, lenderCash, reserve));
}

function loanContractCandidate(target, lenderCash, reserve) {
  const amount = Math.min(300, Math.max(100, Math.floor(Math.max(0, lenderCash - reserve) / 3)));
  return {
    id: 'contract:loan:' + target.id,
    kind: 'contract-propose',
    offer: { toPlayerId: target.id, kind: 'loan', amount, premiumRate: 35, durationRounds: 3, collateralTileIndex: null },
    risk: amount / lenderCash,
    score: 10 + Math.max(0, 300 - Number(target.cash || 0)) / 100
  };
}

function equityContractCandidate(target, property, lenderCash, reserve) {
  const amount = Math.min(200, Math.max(50, Math.floor((lenderCash - reserve) / 5)));
  return {
    id: 'contract:equity:' + target.id + ':' + property.index,
    kind: 'contract-propose',
    offer: { toPlayerId: target.id, kind: 'equity', amount, premiumRate: 0, durationRounds: 10, propertyIndex: property.index, equityShare: 15, equityControl: 'passive', permanent: false },
    risk: 0.2,
    score: 8
  };
}

function hybridContractCandidate(target, property, lenderCash, reserve) {
  const amount = Math.min(200, Math.max(50, Math.floor((lenderCash - reserve) / 5)));
  return {
    id: 'contract:hybrid:' + target.id + ':' + property.index,
    kind: 'contract-propose',
    offer: { toPlayerId: target.id, kind: 'hybrid', amount, premiumRate: 25, durationRounds: 4, propertyIndex: property.index, conversionShare: 25 },
    risk: 0.3,
    score: 7
  };
}

function targetTradeableProperty(game, target) {
  return (target.properties || [])
    .map(index => game.getTile(index))
    .find(tile => tile && game.isTradeableTile(tile) && tile.type === 'property' && tile.houseCount === 0 && !tile.mortgaged);
}

function marketTradingOpen(game) {
  if (!game.settings.market) return false;
  if (game.activeEventEffects?.().tradingEnabled === false) return false;
  return true;
}

function marketActionAvailable(game, player) {
  if ((player.marketActionsThisTurn || 0) >= 1) return false;
  if (Number(game.consecutiveDoubles || 0) >= 2) return false;
  return true;
}

// Opening book laps 1-3: deeds only, unless already holding a complete
// set (ahead: speculation allowed).
function marketBuyOpeningBook(game, player) {
  if (Number(game.roundNumber || 99) > 3) return true;
  return holdsCompleteSet(game, player);
}

function marketBuyEligible(game, player) {
  if (!marketTradingOpen(game)) return false;
  if (!marketActionAvailable(game, player)) return false;
  return marketBuyOpeningBook(game, player);
}

function cheapestBuyQuoteId(quotes) {
  return Object.entries(quotes).sort(([, a], [, b]) => a - b)[0]?.[0];
}

function cheapestMarketInstrument(quotes) {
  return Object.entries(quotes || {}).sort(([, a], [, b]) => Number(a) - Number(b))[0]?.[0] || 'brazil';
}

function shortPositionInstrumentId(player, fallbackId) {
  return Object.entries(player.shortPositions || {}).find(([, position]) => Number(position?.quantity) > 0)?.[0] || fallbackId;
}

function openOptionId(player) {
  return player.optionPositions?.find(option => option.status === 'open')?.id;
}

const MARKET_EXPANSION_ENRICHERS = new Map([
  ['open-margin', (candidate, ctx) => ({ ...candidate, instrumentId: ctx.instrumentId, quantity: 1 })],
  ['reduce-margin', (candidate, ctx) => ({ ...candidate, amount: Math.min(200, Math.floor(ctx.player.cash || 0)) })],
  ['open-short', (candidate, ctx) => ({ ...candidate, instrumentId: ctx.instrumentId, quantity: 1 })],
  ['cover-short', (candidate, ctx) => ({ ...candidate, instrumentId: ctx.shortInstrumentId, quantity: 1 })],
  ['open-option', (candidate, ctx) => ({ ...candidate, instrumentId: ctx.instrumentId, quantity: 1, side: 'call', strike: Number(ctx.marketQuotes?.[ctx.instrumentId]) || 100, premium: 10, expiryRounds: 3 })],
  ['exercise-option', (candidate, ctx) => ({ ...candidate, optionId: ctx.openOptionId })]
]);

function enrichMarketExpansion(candidate, ctx) {
  const enrich = MARKET_EXPANSION_ENRICHERS.get(candidate.kind);
  if (!enrich) return candidate;
  return enrich(candidate, ctx);
}

function marketPositionQuantity(position) {
  return Math.max(0, Math.floor(Number(position?.quantity) || 0));
}

function marketSellWanted(game, player, profitable) {
  if (profitable) return true;
  const startingCash = Number(game.settings.startingCash || 1500);
  return Number(player.cash || 0) <= startingCash * 0.35;
}

function marketSellCandidate(game, player, id, position) {
  const quantity = marketPositionQuantity(position);
  if (!quantity) return null;
  const quote = Number(game.marketQuotes[id]) || 100;
  const average = Number(position.averageCost) || quote;
  const profitable = quote > average;
  if (!marketSellWanted(game, player, profitable)) return null;
  return { id: 'market:sell:' + id, kind: 'market', instrumentId: id, side: 'sell', quantity, risk: 0.1, score: profitable ? 15 : 8 };
}

function marketSellCandidates(game, player) {
  return Object.entries(player.marketPositions || {})
    .map(([id, position]) => marketSellCandidate(game, player, id, position))
    .filter(Boolean);
}

function belowSellThreshold(game, player) {
  return Number(player.cash || 0) < Number(game.settings.startingCash || 1500) * 0.5;
}

function sellableHouseTile(game, player, tile) {
  if (!tile) return false;
  if (!(tile.houseCount > 0)) return false;
  return game.canSellFromTile(player, tile);
}

function houseSellCandidate(game, player, tile, crisis) {
  const proceeds = Math.max(0, Math.floor(game.getPropertyHouseCost(tile) * game.buildingSaleMultiplier()));
  return { id: 'sell:' + tile.index, kind: 'sell', tileIndex: tile.index, proceeds, risk: 0.12, score: crisis ? 15 : 10 };
}

function houseSellCandidates(game, player, crisis) {
  return (player.properties || [])
    .map(index => game.getTile(index))
    .filter(tile => sellableHouseTile(game, player, tile))
    .map(tile => houseSellCandidate(game, player, tile, crisis));
}

function casinoStakesAllowed(game, player) {
  if (!game.settings.casino) return false;
  if ((player.casinoBetsThisRound || 0) >= 1) return false;
  if (player.personality !== 'chaos') return false;
  return true;
}

// EV-negative tables are chaos-only flavor, and only when cash-strong:
// broke bots must preserve every dollar for rent survival.
function casinoCashReady(game, player) {
  const startingCash = Number(game.settings.startingCash || 1500);
  if (Number(player.cash || 0) < startingCash * 0.35) return false;
  // Two doubles already: jail looms, keep cash liquid for the missed turn.
  if (Number(game.consecutiveDoubles || 0) >= 2) return false;
  return !game.hasLoanBackedCash?.(player);
}

function casinoEntryFee(game) {
  return Number(game.casinoLimits?.().entryFee) || 0;
}

function payToLeaveJail(game, player) {
  if (Number(player.jailTurns || 0) >= 2) return true;
  return !jailStayBeatsExit(game, player);
}

function jailFineChoice(player) {
  return { id: 'jail:fine', kind: 'jail-fine', risk: JAIL_FINE / Math.max(1, player.cash), score: player.jailTurns >= 2 ? 14 : 8 };
}

function jailFreeChoice(player) {
  return { id: 'jail:free', kind: 'jail-free', risk: 0.05, score: player.jailTurns >= 2 ? 16 : 7 };
}

function repayableContract(player, contract) {
  if (!contract) return false;
  if (!['loan', 'hybrid'].includes(contract.kind)) return false;
  if (!['active', 'due'].includes(contract.status)) return false;
  if (contract.toPlayerId !== player.id) return false;
  return Number(contract.remaining) > 0;
}

function repaymentPlan(contract, player) {
  const remaining = Math.max(0, Math.floor(Number(contract.remaining) || 0));
  const due = contract.status === 'due';
  const available = Math.max(0, Math.floor(Number(player.cash || 0) - (due ? 0 : 180)));
  return { remaining, due, amount: Math.min(remaining, available) };
}

function repaymentCandidate(contract, plan, player) {
  return {
    id: 'repay:' + contract.id,
    kind: 'repay',
    contractId: contract.id,
    amount: plan.amount,
    remaining: plan.remaining,
    risk: plan.due ? 0.05 : plan.amount / Math.max(1, player.cash),
    score: plan.due ? 32 : 11
  };
}

function collectRepaymentCandidate(player, contract, out) {
  if (!repayableContract(player, contract)) return;
  const plan = repaymentPlan(contract, player);
  if (plan.amount <= 0) return;
  out.push(repaymentCandidate(contract, plan, player));
}

function bankLoanRepayment(loan, player) {
  const remaining = Math.max(0, Math.floor(Number(loan.remaining) || 0));
  const reserve = loan.status === 'due' ? 0 : 180;
  const available = Math.max(0, Math.floor(Number(player.cash || 0) - reserve));
  return { remaining, amount: Math.min(remaining, available) };
}

function bankLoanRepayCandidate(player, loan, repayment) {
  const amount = repayment.amount;
  return {
    id: 'bank-repay:' + player.id + ':' + (player.bankLoanCount || loan.issuedRound || 0),
    kind: 'bank-repay',
    amount,
    remaining: repayment.remaining,
    issuedRound: loan.issuedRound || 0,
    dueRound: loan.dueRound || 0,
    loanCount: player.bankLoanCount || 0,
    risk: amount / Math.max(1, player.cash),
    score: loan.status === 'due' ? 34 : 13
  };
}

function activeBankLoan(loan) {
  if (!loan) return false;
  return ['active', 'due'].includes(loan.status);
}

function buildLimitReached(player, buildLimit) {
  if (!Number.isFinite(buildLimit)) return false;
  if (buildLimit <= 0) return false;
  return (player.buildActionsThisTurn || 0) >= buildLimit;
}

function tradeRoundElapsed(game, trade) {
  const createdRound = Math.max(0, Math.floor(Number(trade.createdRound) || 0));
  return Math.max(1, Math.floor(Number(game.roundNumber) || 1)) > createdRound;
}

function pendingTradeCancelCandidate(trade) {
  return {
    id: `cancel-trade:${trade.id}`,
    kind: 'cancel-trade',
    tradeId: trade.id,
    risk: 0.05,
    score: 4
  };
}

function explicitEndTurn(game, player) {
  if (Number(player.cash) > 0 || player.bankrupt) {
    return [{ id: 'end-turn', kind: 'end-turn', risk: 0, score: -50 }];
  }
  return [{ id: 'bankruptcy:zero-cash', kind: 'bankruptcy', risk: 0, score: 2 }];
}

const botApi = {
  recordBotDecisionTrace(entry = {}) {
    const trace = {
      ...traceIdentityFields(entry),
      ...tracePolicyFields(entry, this.settings),
      ...traceActionFields(entry),
      ...traceShadowFields(entry),
      recordedAt: new Date().toISOString()
    };
    this.botDecisionTrace = Array.isArray(this.botDecisionTrace) ? this.botDecisionTrace : [];
    this.botDecisionTrace.push(trace);
    if (this.botDecisionTrace.length > 200) this.botDecisionTrace.splice(0, this.botDecisionTrace.length - 200);
    return trace;
  },

  runBotAction(playerId, action) {
    const bot = this.getPlayerById(playerId);
    const rejection = this.botActionRejection(bot, action);
    if (rejection) return rejection;
    return this.actAsBotSocket(bot, action);
  },

  botActionRejection(bot, action) {
    if (!bot) return { success: false, error: 'Bot not found.' };
    if (!bot.isBot) return { success: false, error: 'Bot not found.' };
    if (bot.bankrupt || bot.disconnected) return { success: false, error: 'Bot is unavailable.' };
    if (typeof action !== 'function') return { success: false, error: 'Bot not found.' };
    return null;
  },

  // Bots act through the same socket-keyed methods humans do; the seat's
  // socketId is swapped to the bot actor key for the duration of the call.
  actAsBotSocket(bot, action) {
    const previousSocketId = bot.socketId;
    const actorId = `bot:${bot.id}`;
    bot.socketId = actorId;
    try {
      return action(actorId);
    } finally {
      bot.socketId = previousSocketId;
    }
  },

  // Roll is always available; the pre-roll table appends the remaining
  // candidate sources in their historical order, then the stable sort ranks
  // them by score desc, risk asc.
  getBotCandidates(player, options = {}) {
    if (!player?.isBot) return [];
    if (options.postRoll) return this.botPostRollCandidates(player, options);
    const candidates = [{ id: 'roll', kind: 'roll', risk: 0, score: 0 }];
    if (!this.hasRolled) appendPreRollCandidates(this, player, options, candidates);
    return sortCandidates(candidates);
  },

  // Once movement has resolved, humans may still use the finance rail before
  // ending their turn. Keep that same window available to both bot brains. A
  // pending purchase is the only table obligation that takes precedence over
  // the normal finance actions; otherwise candidates are legal post-roll
  // verbs and a low-priority explicit end-turn sentinel.
  botPostRollCandidates(player, options = {}) {
    if (!player?.isBot) return [];
    if (player.id !== this.currentPlayerId) return [];
    const offer = this.pendingPurchaseOffer;
    const purchase = pendingPurchaseCandidate(this, player, offer);
    if (purchase) return [purchase];
    // Another seat's offer: nothing for me to buy, but the turn still needs
    // an explicit end action instead of a no-op stall.
    if (offer) return explicitEndTurn(this, player);
    return postRollCandidates(this, player, options);
  },

  botPendingTradeCancelCandidates(player) {
    const trade = this.pendingTrade;
    if (!player?.isBot) return [];
    if (player.id !== this.currentPlayerId) return [];
    if (!trade || trade.fromPlayerId !== player.id) return [];
    if (!tradeRoundElapsed(this, trade)) return [];
    return [pendingTradeCancelCandidate(trade)];
  },

  botJailCandidates(player) {
    if (!player?.inJail) return [];
    // Late-stage sit-out: a developed board makes jail a rent-free shelter
    // that still collects. Roll for doubles instead of paying to leave.
    if (!payToLeaveJail(this, player)) return [];
    const choices = [];
    if (player.cash >= JAIL_FINE) choices.push(jailFineChoice(player));
    if (player.jailFreeCards > 0) choices.push(jailFreeChoice(player));
    return choices;
  },

  botSocialCandidates(player) {
    const sequence = Math.max(0, Math.floor(Number(this.botDecisionSequence) || 0));
    if (!player) return [];
    if (sequence === 0) return [];
    if (sequence % 6 !== 0) return [];
    return [{ id: 'chat:table-talk', kind: 'chat', text: tableTalkFor(this, player), risk: 0, score: 1 }];
  },

  botBankLoanRepaymentCandidates(player) {
    const loan = player?.bankLoan;
    if (!activeBankLoan(loan)) return [];
    if (player.id !== this.currentPlayerId) return [];
    const repayment = bankLoanRepayment(loan, player);
    if (repayment.amount <= 0) return [];
    return [bankLoanRepayCandidate(player, loan, repayment)];
  },

  botBuildCandidates(player) {
    const buildLimit = Number(this.activeEventEffects?.().buildingLimitPerTurn);
    if (buildLimitReached(player, buildLimit)) return [];
    return this.tiles
      .filter(tile => this.canBuildOnTile(player, tile))
      .map(tile => this.botBuildCandidateFor(tile, player));
  },

  botBuildCandidateFor(tile, player) {
    const cost = this.getPropertyHouseCost(tile);
    // Hotel reluctance: the 5th level returns 4 houses to the bank for
    // opponents to buy. Stay at 4 unless finishing (handled by threat
    // pressure in the planner, not here).
    const hotelMalus = Math.max(0, Math.min(5, Number(tile?.houseCount) || 0)) >= 4 ? 6 : 0;
    return {
      id: 'build:' + tile.index,
      kind: 'build',
      tileIndex: tile.index,
      cost,
      risk: riskAgainstCash(cost, player.cash),
      score: (BOT_BUILD_SCORES[player.personality] || BOT_BUILD_SCORE_DEFAULT) - hotelMalus
    };
  },

  botMortgageCandidates(player) {
    if (player.cash >= 180) return [];
    return this.tiles
      .filter(tile => this.canMortgageTile(player, tile))
      .map(tile => this.botMortgageCandidateFor(tile, player));
  },

  botSellCandidates(player) {
    if (!player) return [];
    if (player.id !== this.currentPlayerId) return [];
    const crisis = Boolean(this.globalEventActive?.('housing-bubble'));
    if (!crisis && !belowSellThreshold(this, player)) return [];
    return houseSellCandidates(this, player, crisis);
  },

  botUnmortgageCandidates(player) {
    if (!player || player.id !== this.currentPlayerId) return [];
    return (player.properties || [])
      .map(index => this.getTile(index))
      .filter(tile => tile && this.canUnmortgageTile(player, tile))
      .map(tile => {
        const multiplier = typeof this.propertyValueMultiplier === 'function' ? this.propertyValueMultiplier() : 1;
        const cost = Math.ceil(Math.floor((tile.price || 0) / 2) * 1.1 * multiplier);
        if (player.cash < cost + 180) return null;
        return { id: 'unmortgage:' + tile.index, kind: 'unmortgage', tileIndex: tile.index, cost, risk: cost / Math.max(1, player.cash), score: 9 };
      })
      .filter(Boolean);
  },

  botMortgageCandidateFor(tile, player) {
    const valueMultiplier = Number(this.activeEventEffects?.().propertyValueMultiplier);
    const multiplier = Number.isFinite(valueMultiplier) && valueMultiplier > 0 ? valueMultiplier : 1;
    return {
      id: 'mortgage:' + tile.index,
      kind: 'mortgage',
      tileIndex: tile.index,
      proceeds: Math.floor((tile.price || 0) / 2 * multiplier),
      risk: 0.25,
      score: BOT_MORTGAGE_SCORES[player.personality] || BOT_MORTGAGE_SCORE_DEFAULT
    };
  },

  botLoanCandidate(player) {
    const loan = this.getBankLoanOffer(player);
    if (!loan.available) return [];
    return [{
      id: 'loan:emergency',
      kind: 'loan',
      principal: loan.principal,
      totalDue: loan.totalDue,
      premium: loan.premium,
      dueRound: loan.dueRound,
      cureRound: loan.cureRound,
      collateralTileIndex: loan.collateralTileIndex,
      risk: loan.totalDue / loan.principal,
      score: BOT_LOAN_SCORES[player.personality] || BOT_LOAN_SCORE_DEFAULT
    }];
  },

  // Repay player loans proactively when the bot can do so without draining
  // its liquidity floor. Due contracts are settled first; active contracts
  // are paid down only when the remaining balance is comfortably affordable.
  botRepaymentCandidates(player) {
    const contracts = Array.isArray(this.playerContracts) ? this.playerContracts : [];
    const candidates = [];
    contracts.forEach(contract => collectRepaymentCandidate(player, contract, candidates));
    return candidates;
  },

  botGroupTradeCandidate(player) {
    return this.botGroupTradeCandidates(player).slice(0, 1);
  },

  botGroupTradeCandidates(player) {
    if (!canOfferTrade(this, player)) return [];
    const ctx = { game: this, player, ask: BOT_TRADE_ASKS[player.personality] || BOT_TRADE_ASK_DEFAULT };
    const owned = tradeTiles(this, player);
    const table = coalitionAgainst(this, player.id);
    const partners = tradePartners(this, player, table, player.grudge);
    const candidates = [];
    partners.forEach(partner => collectGroupTradeCandidates(ctx, partner, owned, candidates));
    return candidates.slice(0, 12);
  },

  botRichTradeCandidates(player) {
    if (!canOfferTrade(this, player)) return [];
    const owned = tradeTiles(this, player).slice(0, 3);
    if (owned.length < 2) return [];
    const table = coalitionAgainst(this, player.id);
    const partners = tradePartners(this, player, table, player.grudge);
    return partners.flatMap(partner => richTradeCandidate(this, partner, owned)).slice(0, 4);
  },

  botContractCandidates(player) {
    // The server rejects loan-backed contract cash (contractLogic.js guard),
    // so a loaned bot proposing contracts burns its deal counter on a
    // guaranteed rejection every turn; the casino and market collectors
    // already apply the same guard.
    if (this.hasLoanBackedCash?.(player)) return [];
    if (!canProposeContracts(this, player)) return [];
    const lenderCash = Number(player.cash || 0);
    const reserve = contractReserve(this);
    if (lenderCash <= reserve + 100) return [];
    const table = coalitionAgainst(this, player.id);
    const targets = contractTargets(this, player, table, player.grudge);
    const ctx = { game: this, lenderCash, reserve };
    const result = [];
    targets.forEach(target => collectContractCandidates(ctx, target, result));
    return result.slice(0, 8);
  },

  botMarketCandidates(player) {
    const buy = this.botMarketCandidate(player);
    if (!this.settings.market) return buy;
    if ((player.marketActionsThisTurn || 0) >= 1) return buy;
    const sells = marketSellCandidates(this, player);
    return [...buy, ...sells].slice(0, 8);
  },

  botMarketExpansionCandidates(player) {
    if (!this.settings.market) return [];
    if (typeof this.marketExpansionCandidates !== 'function') return [];
    const source = this.marketExpansionCandidates(player) || [];
    const instrumentId = cheapestMarketInstrument(this.marketQuotes);
    const ctx = {
      player,
      marketQuotes: this.marketQuotes,
      instrumentId,
      shortInstrumentId: shortPositionInstrumentId(player, instrumentId),
      openOptionId: openOptionId(player)
    };
    return source
      .map(candidate => enrichMarketExpansion(candidate, ctx))
      .filter(candidate => candidate.kind !== 'exercise-option' || candidate.optionId);
  },

  firstTradeableOwnedTile(player) {
    return player.properties.map(index => this.getTile(index)).find(tile => tile && this.isTradeableTile(tile));
  },

  botMarketCandidate(player) {
    if (!marketBuyEligible(this, player)) return [];
    const marketId = cheapestBuyQuoteId(this.marketQuotes);
    if (!marketId) return [];
    const quote = Number(this.marketQuotes[marketId]) || 100;
    const fee = Math.max(1, Math.ceil(quote * MARKET_FEE_RATE));
    if (player.cash < quote + fee) return [];
    if (this.hasLoanBackedCash?.(player)) return [];
    return [{
      id: 'market:' + marketId,
      kind: 'market',
      instrumentId: marketId,
      side: 'buy',
      quantity: 1,
      // Keep the historical quote-based risk telemetry stable; the fee is a
      // legality check above, not a personality-score signal.
      risk: riskAgainstCash(quote, player.cash),
      score: BOT_MARKET_SCORES[player.personality] || BOT_MARKET_SCORE_DEFAULT
    }];
  },

  botCasinoCandidate(player) {
    if (!casinoStakesAllowed(this, player)) return [];
    if (!casinoCashReady(this, player)) return [];
    const spec = BOT_CASINO_SPECS[player.personality] || BOT_CASINO_SPECS.chaos;
    const entryFee = casinoEntryFee(this);
    const stake = Math.min(20, Math.max(1, Math.floor(player.cash * spec.stakeRate)));
    if (player.cash < stake + entryFee) return [];
    return [{
      id: 'casino:red',
      kind: 'casino',
      color: spec.color,
      stake,
      risk: 0.55,
      score: spec.score
    }];
  }
};

export { botApi };
