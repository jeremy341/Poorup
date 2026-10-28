// Bot decision support as a prototype mixin: socket impersonation for bot-driven actions and the pre-roll
// candidate ranking. Collector order is kept and the final sort is stable, so ties keep this sequence.
// kind values are the contract consumed by botLogic's CANDIDATE_MAPPERS and CANDIDATE_RUNNERS tables.
import { playerFinanceEnabled } from './financeRules.js';
import { settlementDiscount } from './loanLogic.js';
import { forecastMarketOrder } from './botMarketForecast.js';
import { marketExpansionCandidatesFor } from './botMarketCandidates.js';
import { JAIL_FINE } from './gameData.js';
import { unmortgageCostFor } from './propertyRules.js';
import {
  deedValue, monopolyRequirement, portfolioValue, tradeSetChanges, vetoTrade, TRADE_MIN_NET_GAIN
} from './botTradeValuation.js';
import { developmentStage, groupGainToThree } from './botDevelopmentForecast.js';
import { coalitionAgainst, tradePairKey, tradePairCoolingOff } from './botTableMind.js';
import { tableBrain } from './botTableBrain.js';
import { seatOf } from './botStrategicContext.js';
// Loan-contract candidates are scored against the gate that decides them, so
// the willingness factor has to be the same number the responder applies
// rather than a second copy that drifts.
import { CONTRACT_REPAY_RATIO, contractReserve, tableObligationOpen } from './botContractPolicy.js';

// Situation-aware table talk shared by both brains.
function tableTalkFor(game, player) {
  const base = 'I am watching the next rent risk and keeping my options open.';
  try {
    const brain = tableBrain(game, player.id);
    if (brain.kingmaker?.spoiler) return BOT_TABLE_TALK_SPOILER;
    if (brain.rank > 1) return BOT_TABLE_TALK_BEHIND;
  } catch {
    // Thin fixtures retain the neutral line.
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
  return (game.tiles || []).map(tile => jailBoardTile(game, player, tile));
}

// Each opponent keeps their own seat label, so two rivals holding one colour
// group between them are not read as a single owner's monopoly.
function jailBoardTile(game, player, tile) {
  return {
    group: tile?.group || null,
    ownerSeat: seatOf(game, player, tile?.ownerId),
    houseCount: tile?.houseCount || 0
  };
}

// Grudge-gated dealing: ledgers start empty, so normalize missing entries
// to 0, since a direct Number(undefined) comparison would lock out every seat.
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

const BOT_TABLE_TALK_BEHIND = 'I am behind; a fair deal could still change the table.';
const BOT_TABLE_TALK_SPOILER = 'I cannot win this one, but I choose who does. Make your case.';
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
  candidates.push(...game.botItemCandidates(player));
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
  candidates.push(...game.botItemCandidates(player));
  candidates.push(...game.botRepaymentCandidates(player));
  candidates.push(...game.botBankLoanRepaymentCandidates(player));
  candidates.push(...game.botMortgageCandidates(player));
  candidates.push(...game.botSellCandidates(player));
  candidates.push(...game.botUnmortgageCandidates(player));
  candidates.push(...game.botBuildCandidates(player));
  appendPostRollParityCandidates(game, player, options, candidates);
  candidates.push(...game.botPendingTradeCancelCandidates(player));
  const canEndTurn = player.bankrupt || Number(player.cash) > 0;
  if (!canEndTurn) {
    candidates.push(...game.botItemSaleCandidates(player));
    // Broke with the roll done: a loan on offer keeps the bot in the game, so it is
    // tried before the terminal bankruptcy (score 2).
    candidates.push(...game.botLoanCandidate(player).map(loan => ({ ...loan, score: ZERO_CASH_LOAN_SCORE })));
    candidates.push({ id: 'bankruptcy:zero-cash', kind: 'bankruptcy', risk: 0, score: 2 });
  } else {
    if (game.settings.market) candidates.push({ id: 'end-finance-window', kind: 'end-finance-window', risk: 0, score: -49 });
    candidates.push({ id: 'end-turn', kind: 'end-turn', risk: 0, score: -50 });
  }
  return sortCandidates(candidates, buildValueIndex(game, player, candidates));
}

// Every build candidate shares one score, so a cost-over-cash tie-break would build the cheapest monopoly first.
// Equal-score builds rank by the traffic-weighted rent their monopoly is worth (botDevelopmentForecast.groupGainToThree),
// with cost as the final stable tie-break. Non-build kinds carry no value, so their order is untouched.
function buildValueIndex(game, player, candidates) {
  const index = new Map();
  const seats = new Map((game.players || []).map((entry, position) => [
    entry.id,
    entry.id === player.id ? 'self' : `opponent-${position}`
  ]));
  const groupValue = group => {
    const board = (game.getGroupTiles(group) || []).map(tile => ({ ...tile, ownerSeat: seats.get(tile.ownerId) || 'bank' }));
    return groupGainToThree(board, group)?.gainPerCircuit || 0;
  };
  candidates.forEach(candidate => {
    if (candidate.kind !== 'build' || index.has(candidate.id)) return;
    const group = game.getTile(candidate.tileIndex)?.group;
    index.set(candidate.id, group ? groupValue(group) : 0);
  });
  return index;
}

function sortCandidates(candidates, buildValues = new Map()) {
  const developmentValue = candidate => Number(buildValues.get(candidate.id) || 0);
  return candidates.sort((a, b) => b.score - a.score
    || developmentValue(b) - developmentValue(a)
    || a.risk - b.risk);
}

// Candidate risk against a cash floor of 1, so collectors never divide by
// zero while keeping the original ternary-ladder values verbatim.
function riskAgainstCash(amount, cash) {
  return amount / Math.max(1, cash);
}

const BOT_BUILD_SCORE = 10;
const BOT_MORTGAGE_SCORE = 8;
const BOT_LOAN_SCORE = -12;
const ZERO_CASH_LOAN_SCORE = 3;
// A build keeps the same liquidity floor the mortgage and unmortgage triggers use.
const BOT_BUILD_RESERVE_CASH = 180;

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

// Shared trade gating: the group and rich trade collectors refuse the same table states before pairing deeds.
// The engine refuses a proposal while an auction, purchase offer, sponsored purchase or trade is open
// (tradeApi.js), so the bot must not offer one either.
function canOfferTrade(game, player) {
  if (game.settings.trading === false) return false;
  if (tableObligationOpen(game)) return false;
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

// Bots may deal with bots too (same veto applies); otherwise humans could
// exploit isolated bot seats that never cooperate.
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

// Seat label the planner projects against: opponents are numbered in table order
// with the deciding bot left out, exactly as the strategic snapshot labels them.
// Without it every trade would be projected against opponent-1.
function partnerSeatLabel(game, player, partner) {
  const opponents = (game.players || []).filter(candidate => candidate.id !== player.id);
  const index = opponents.findIndex(candidate => candidate.id === partner.id);
  return index < 0 ? undefined : `opponent-${index + 1}`;
}

// Group trades exist to finish or concentrate colour sets. Same-group 1-for-1 swaps change nothing for either seat,
// so each ask is a deed of a group the bot already holds a stake in, paid for with a deed from a group the bot
// is not building, or with cash.
function groupOwnedBy(game, playerId, group) {
  return (game.getGroupTiles(group) || []).filter(tile => tile.ownerId === playerId).length;
}

// Deeds the bot can part with for `askTile`: other groups only, and never a group
// it holds all of (or all but one of: that is a set in the making).
function giveCandidates(game, player, owned, askTile) {
  return owned.filter(tile => {
    if (tile.group === askTile.group) return false;
    const total = (game.getGroupTiles(tile.group) || []).length;
    return groupOwnedBy(game, player.id, tile.group) <= total - 2;
  });
}

function collectGroupTradeCandidates(ctx, partner, owned, out) {
  const { game } = ctx;
  const found = tradeTiles(game, partner).flatMap(askTile => groupAskCandidates(ctx, partner, owned, askTile));
  found.sort((a, b) => b.score - a.score || b.strategicValue - a.strategicValue);
  out.push(...found.slice(0, 4));
}

// Priced offers for one deed the partner holds, one per give-side option (a single tradeable deed, or cash alone).
function groupAskCandidates(ctx, partner, owned, askTile) {
  const { game, player } = ctx;
  const held = groupOwnedBy(game, player.id, askTile.group);
  if (!held) return [];
  const completer = held === (game.getGroupTiles(askTile.group) || []).length - 1;
  const gives = giveCandidates(game, player, owned, askTile).map(tile => [tile]);
  // Cash alone can buy the last deed of a set; it never buys a partial stake.
  if (completer) gives.push([]);
  return gives
    .map(giveTiles => groupTradeCandidate(ctx, partner, giveTiles, askTile))
    .filter(Boolean);
}

// One priced offer, or null: no cooled-off repeat, no value-neutral swap, no set
// handed over below the monopoly premium (priceTradeTerms enforces all three).
function groupTradeCandidate(ctx, partner, giveTiles, askTile) {
  const { game, ask, player } = ctx;
  const giveIndexes = giveTiles.map(tile => tile.index);
  const terms = offerTerms(game, player, partner, giveIndexes, [askTile.index]);
  if (!terms) return null;
  const sets = tradeSetChanges(game, player.id, giveIndexes, [askTile.index]);
  return {
    // The give tile is part of the id: two same-group give tiles for one ask are
    // distinct offers, and a shared id made the second unaddressable.
    id: 'trade:' + partner.id + ':' + askTile.index + ':' + (giveIndexes.length ? giveIndexes.join('-') : 'cash'),
    kind: 'trade',
    toPlayerId: partner.id,
    toPlayerSeat: partnerSeatLabel(game, player, partner),
    givePropertyIndexes: giveIndexes,
    requestPropertyIndexes: [askTile.index],
    giveCash: terms.giveCash,
    requestCash: terms.requestCash,
    risk: 0.2,
    score: groupTradeScore(ask, { completesGroup: sets.completes.length > 0, breaksGroup: sets.breaks.length > 0 }),
    strategicValue: terms.botGain,
    partnerGain: terms.partnerGain
  };
}

function groupTradeScore(ask, state) {
  return ask.score + (state.completesGroup ? 28 : 0) - (state.breaksGroup ? 30 : 0);
}

// Pricing plus the offer-level gates shared by group and rich trades.
function offerTerms(game, player, partner, giveIndexes, requestIndexes) {
  if (tradePairCoolingOff(player, tradePairKey(partner.id, giveIndexes, requestIndexes), game.roundNumber)) return null;
  const terms = priceTradeTerms(game, player, partner, giveIndexes, requestIndexes);
  if (!terms) return null;
  // The same veto either seat will apply on receipt, checked on the final terms.
  const trade = {
    fromPlayerId: player.id,
    toPlayerId: partner.id,
    givePropertyIndexes: giveIndexes,
    requestPropertyIndexes: requestIndexes,
    giveCash: terms.giveCash,
    requestCash: terms.requestCash
  };
  if (vetoTrade(game, trade, player.id).vetoed || vetoTrade(game, trade, partner.id).vetoed) return null;
  return terms;
}

function tradeMargin(game, requestIndexes) {
  const face = requestIndexes.reduce((sum, index) => sum + deedValue(game, game.getTile(index)), 0);
  return Math.max(TRADE_MIN_NET_GAIN, Math.ceil(face / 10));
}

// Prices one swap between the bot and a partner. Both seats use the same portfolio model, and the partner
// is paid for its loss plus a margin. The cash is then pushed so neither seat hands the other a colour set
// below the monopoly premium. Returns null when the swap is value-neutral, breaks a set either seat holds, or cannot be paid.
function priceTradeTerms(game, player, partner, giveIndexes, requestIndexes) {
  if (!giveIndexes.length && !requestIndexes.length) return null;
  if (tradeSetChanges(game, player.id, giveIndexes, requestIndexes).breaks.length) return null;
  if (tradeSetChanges(game, partner.id, requestIndexes, giveIndexes).breaks.length) return null;
  const botNext = [...new Set([...(player.properties || []).filter(index => !giveIndexes.includes(index)), ...requestIndexes])];
  const partnerNext = [...new Set([...(partner.properties || []).filter(index => !requestIndexes.includes(index)), ...giveIndexes])];
  const botDelta = tradePortfolioValue(game, player.id, botNext) - tradePortfolioValue(game, player.id, player.properties || []);
  const partnerDelta = tradePortfolioValue(game, partner.id, partnerNext) - tradePortfolioValue(game, partner.id, partner.properties || []);
  if (botDelta + partnerDelta < 2 * TRADE_MIN_NET_GAIN) return null;
  // Positive = the partner pays the bot, negative = the bot pays the partner. A seat
  // that hands over a finishing deed bounds the cash from its side.
  const handsSet = monopolyRequirement(game, giveIndexes, requestIndexes, partner.id);
  const takesSet = monopolyRequirement(game, requestIndexes, giveIndexes, player.id);
  const floor = handsSet.givesMonopoly ? handsSet.needCash : -Infinity;
  const ceiling = takesSet.givesMonopoly ? -takesSet.needCash : Infinity;
  if (floor > ceiling) return null;
  // The partner is paid its own loss plus a margin (a tenth of the deeds it hands over, or half the surplus if smaller).
  // It is not paid for the build value the bot gains from a finished set: splitting that evenly priced every
  // completer beyond any bank balance.
  const partnerShare = Math.min(Math.floor((botDelta + partnerDelta) / 2), tradeMargin(game, requestIndexes));
  const net = Math.max(floor, Math.min(ceiling, partnerDelta - partnerShare));
  const giveCash = Math.max(0, -net);
  const requestCash = Math.max(0, net);
  if (requestCash > Number(partner.cash || 0)) return null;
  if (giveCash > 0 && giveCash > Number(player.cash || 0) - contractReserve(game)) return null;
  const botGain = botDelta + net;
  const partnerGain = partnerDelta - net;
  if (botGain < TRADE_MIN_NET_GAIN || partnerGain < 0) return null;
  return { giveCash, requestCash, botGain, partnerGain };
}

function tradePairs(tiles) {
  const pairs = [];
  for (let i = 0; i < tiles.length; i += 1) {
    for (let j = i + 1; j < tiles.length; j += 1) pairs.push([tiles[i].index, tiles[j].index]);
  }
  return pairs;
}

// Two-for-two offers: the best priced pair of the first three deeds each side.
function richTradeCandidate(game, player, partner, owned) {
  const requested = tradeTiles(game, partner).slice(0, 3);
  if (requested.length < 2) return [];
  let best = null;
  for (const giveIndexes of tradePairs(owned)) {
    for (const requestIndexes of tradePairs(requested)) {
      const terms = offerTerms(game, player, partner, giveIndexes, requestIndexes);
      if (terms && (!best || terms.botGain > best.terms.botGain)) best = { giveIndexes, requestIndexes, terms };
    }
  }
  if (!best) return [];
  const { terms } = best;
  return [{
    id: 'trade:rich:' + partner.id,
    kind: 'trade',
    rich: true,
    toPlayerId: partner.id,
    toPlayerSeat: partnerSeatLabel(game, player, partner),
    givePropertyIndexes: best.giveIndexes,
    requestPropertyIndexes: best.requestIndexes,
    giveCash: terms.giveCash,
    requestCash: terms.requestCash,
    risk: 0.3,
    score: Math.max(8, Math.min(24, 16 + Math.floor(Math.min(terms.botGain, terms.partnerGain) / 100))),
    strategicValue: terms.botGain,
    partnerGain: terms.partnerGain
  }];
}

// The portfolio model both trade paths price with: deeds, progress credit, and the build value of a finished set.
// Proposals are one step more generous than acceptance (portfolioDeedValue in botTradeValuation.js). The spread is
// harmless: the monopoly premium clamps cash both ways, and every proposal clears the partner's own acceptance bar.
const tradePortfolioValue = portfolioValue;

// The engine refuses a contract proposal while another table obligation is
// open (contractLogic.js), so the bot must not offer one either.
function canProposeContracts(game, player) {
  if (!playerFinanceEnabled(game)) return false;
  if (!player) return false;
  if (player.id !== game.currentPlayerId) return false;
  if (tableObligationOpen(game)) return false;
  if (game.pendingTrade) return false;
  if (game.pendingPlayerContract) return false;
  if (player.isBot && Number(player.botDealActionsThisTurn) >= 1) return false;
  return true;
}

function contractTargets(game, player, table, grudges) {
  return game.activePlayers()
    .filter(target => contractTargetEligible(target, player, table, grudges))
    .sort((a, b) => Number(b.cash || 0) - Number(a.cash || 0));
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
  const loan = loanContractCandidate(target, lenderCash, reserve);
  if (loan) out.push(loan);
  const property = targetTradeableProperty(game, target);
  if (!property) return;
  out.push(equityContractCandidate(target, property, lenderCash, reserve));
}

// Scoring the neediest borrower would reward the one seat that must decline: a $300 loan priced at $405 needs roughly $507 of cash to clear the accept gate.
// A needy borrower burns the lender's one deal action on a sure rejection. A loan the borrower cannot service is not offered (rent-share offers still reach that seat),
// and survivors rank by acceptance headroom, so a comfortable borrower outranks a bare-margin one.
const LOAN_PREMIUM_RATE = 35;
const LOAN_CONTRACT_BASE_SCORE = 10;
const LOAN_CONTRACT_HEADROOM_SCORE = 4;

// contractLogic prices a loan as amount + premium; the responder gate in
// botLogic.shouldAcceptPlayerContract then clears it only when
// totalDue <= cash * CONTRACT_REPAY_RATIO.
function loanTotalDue(offer) {
  const amount = Math.max(0, Math.floor(Number(offer?.amount) || 0));
  return amount + Math.ceil(amount * (Number(offer?.premiumRate) || 0) / 100);
}

function borrowerRepayCapacity(target) {
  return Number(target?.cash || 0) * CONTRACT_REPAY_RATIO;
}

function loanContractScore(totalDue, capacity) {
  return LOAN_CONTRACT_BASE_SCORE + LOAN_CONTRACT_HEADROOM_SCORE * (capacity - totalDue) / capacity;
}

function loanContractCandidate(target, lenderCash, reserve) {
  // Bots sign only interest-free loans (botContractPolicy.js), so a priced loan
  // aimed at a bot is a sure refusal that still burns the one deal action.
  if (target.isBot) return null;
  const amount = Math.min(300, Math.max(100, Math.floor(Math.max(0, lenderCash - reserve) / 3)));
  const offer = { toPlayerId: target.id, kind: 'loan', amount, premiumRate: LOAN_PREMIUM_RATE, durationRounds: 3, collateralTileIndex: null };
  const totalDue = loanTotalDue(offer);
  const capacity = borrowerRepayCapacity(target);
  if (!(capacity > 0) || totalDue > capacity) return null;
  return {
    id: 'contract:loan:' + target.id,
    kind: 'contract-propose',
    offer,
    risk: amount / lenderCash,
    score: loanContractScore(totalDue, capacity)
  };
}

function equityContractCandidate(target, property, lenderCash, reserve) {
  const amount = Math.min(200, Math.max(50, Math.floor((lenderCash - reserve) / 5)));
  return {
    id: 'contract:equity:' + target.id + ':' + property.index,
    kind: 'contract-propose',
    offer: { toPlayerId: target.id, kind: 'equity', amount, premiumRate: 0, durationRounds: 3, propertyIndex: property.index, equityShare: 15, equityControl: 'passive', permanent: false },
    risk: 0.2,
    score: 8
  };
}

function targetTradeableProperty(game, target) {
  return (target.properties || [])
    .map(index => game.getTile(index))
    .find(tile => tile && game.isTradeableTile(tile) && tile.type === 'property' && tile.houseCount === 0 && !tile.mortgaged);
}

// The engine refuses market orders and casino bets while a payment, auction, purchase, sponsorship, trade or
// contract is open (marketLogic.js, economyApi.js), including the bot's own offer, so offering them only burns the tick.
// The deal collectors use the narrower tableObligationOpen (botContractPolicy.js): a pending payment never blocks a deal.
function engineTableObligationPending(game) {
  return typeof game.tableObligationPending === 'function' && game.tableObligationPending();
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
  const quote = Number(game.marketQuotes?.[id]);
  if (!Number.isInteger(quote) || quote <= 0) return null;
  const average = Number(position.averageCost) || quote;
  const profitable = quote > average;
  if (!marketSellWanted(game, player, profitable)) return null;
  const quoteForecast = forecastMarketOrder({
    instrumentId: id,
    quote,
    quantity,
    side: 'sell',
    ...marketForecastContext(game)
  });
  return {
    id: 'market:sell:' + id,
    kind: 'market', instrumentId: id, side: 'sell', quantity,
    risk: quoteForecast.volatilityPercent,
    score: quoteForecast.expectedPnl,
    expectedMarketPnl: quoteForecast.expectedPnl,
    expectedMovePercent: quoteForecast.expectedMovePercent,
    fee: quoteForecast.fee
  };
}

function marketForecastContext(game) {
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

function marketBuyCandidates(game, player) {
  if (!marketBuyEligible(game, player) || game.hasLoanBackedCash?.(player)) return [];
  if (engineTableObligationPending(game) || game.marginMaintenanceDue?.(player) || Number(player.shortDefaultDebt) > 0) return [];
  return Object.entries(game.marketQuotes || {}).flatMap(([instrumentId, rawQuote]) => {
    const quote = Number(rawQuote);
    if (!Number.isInteger(quote) || quote <= 0) return [];
    const forecast = forecastMarketOrder({
      instrumentId,
      quote,
      quantity: 1,
      side: 'buy',
      ...marketForecastContext(game)
    });
    if (!forecast.supported || Number(player.cash || 0) < quote + forecast.fee) return [];
    return [{
      id: 'market:' + instrumentId,
      kind: 'market',
      instrumentId,
      side: 'buy',
      quantity: 1,
      risk: forecast.volatilityPercent,
      score: forecast.expectedPnl,
      expectedMarketPnl: forecast.expectedPnl,
      expectedMovePercent: forecast.expectedMovePercent,
      fee: forecast.fee
    }];
  });
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
    // A deed named by an open trade or contract cannot be managed (the engine
    // refuses it), so it is never offered as a rescue.
    .filter(tile => !game.propertyOpenOfferRejection?.(tile))
    .map(tile => houseSellCandidate(game, player, tile, crisis));
}

function casinoStakesAllowed(game, player) {
  if (!game.settings.casino) return false;
  if ((player.casinoBetsThisRound || 0) >= 1) return false;
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

// A due debt is cured in full or not at all: a part payment still defaults (the engine seizes the whole basket)
// and only strands the cash. A debt that can be cured is MANDATORY (see repaymentCandidate), because the planner
// books repaying as net-worth neutral and would otherwise always prefer to roll.
function repaymentPlan(contract, player) {
  const remaining = Math.max(0, Math.floor(Number(contract.remaining) || 0));
  const due = contract.status === 'due';
  const cash = Math.max(0, Math.floor(Number(player.cash || 0)));
  if (due) return { remaining, due, amount: cash >= remaining ? remaining : 0 };
  return { remaining, due, amount: Math.min(remaining, Math.max(0, cash - 180)) };
}

function repaymentCandidate(contract, plan, player) {
  return {
    id: 'repay:' + contract.id,
    kind: 'repay',
    contractId: contract.id,
    amount: plan.amount,
    remaining: plan.remaining,
    risk: plan.due ? 0.05 : plan.amount / Math.max(1, player.cash),
    score: plan.due ? 32 : 11,
    ...(plan.due ? { mandatory: true } : {})
  };
}

function collectRepaymentCandidate(player, contract, out) {
  if (!repayableContract(player, contract)) return;
  const plan = repaymentPlan(contract, player);
  if (plan.amount <= 0) return;
  out.push(repaymentCandidate(contract, plan, player));
}

function bankLoanRepayment(game, loan, player) {
  const remaining = Math.max(0, Math.floor(Number(loan.remaining) || 0));
  const cash = Math.max(0, Math.floor(Number(player.cash || 0)));
  // Request the full balance to activate amnesty; the engine charges the discounted amount.
  if (remaining > 0 && game.globalEventIncludes?.('debt-amnesty')) {
    const cost = Math.min(remaining, settlementDiscount(game, loan));
    const reserve = loan.status === 'due' ? 0 : 180;
    if (cash - reserve >= cost) return { remaining, amount: remaining };
  }
  // Same rule as player contracts: a due loan is paid in full or left alone.
  if (loan.status === 'due') return { remaining, amount: cash >= remaining ? remaining : 0 };
  return { remaining, amount: Math.min(remaining, Math.max(0, cash - 180)) };
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
    score: loan.status === 'due' ? 34 : 13,
    ...(loan.status === 'due' ? { mandatory: true } : {})
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
  botItemCandidates(player) {
    return (this.summaryItems?.(player, player.id) || [])
      .filter(item => item.catalogId === 'parlor-bond' && item.canUse)
      .map(item => ({ id: `item-use:${item.itemId}`, itemId: item.itemId, kind: 'item-use', risk: 0, score: 100 }));
  },
  botItemSaleCandidates(player) {
    return (this.summaryItems?.(player, player.id) || [])
      .filter(item => item.canSell && !(item.catalogId === 'parlor-bond' && item.canUse))
      .map(item => ({ id: `item-sell:${item.itemId}`, itemId: item.itemId, kind: 'item-sell', risk: 0, score: 4, mandatory: true }));
  },
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
  // them by score desc, development value desc (builds only), risk asc.
  getBotCandidates(player, options = {}) {
    if (!player?.isBot) return [];
    if (options.postRoll) return this.botPostRollCandidates(player, options);
    const candidates = [{ id: 'roll', kind: 'roll', risk: 0, score: 0 }];
    if (!this.hasRolled) appendPreRollCandidates(this, player, options, candidates);
    return sortCandidates(candidates, buildValueIndex(this, player, candidates));
  },

  // Once movement resolves, humans may still use the finance rail before ending their turn. Keep that window
  // open for both bot brains. A pending purchase is the only obligation that takes precedence over finance actions;
  // otherwise candidates are legal post-roll verbs plus a low-priority end-turn sentinel.
  botPostRollCandidates(player, options = {}) {
    if (!player?.isBot) return [];
    if (player.id !== this.currentPlayerId) return [];
    const offer = this.pendingPurchaseOffer;
    const purchase = pendingPurchaseCandidate(this, player, offer);
    if (purchase) return [purchase];
    // Another seat's offer: nothing for me to buy, but the turn still needs
    // an explicit end action, not a no-op stall.
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
    const repayment = bankLoanRepayment(this, loan, player);
    if (repayment.amount <= 0) return [];
    return [bankLoanRepayCandidate(player, loan, repayment)];
  },

  botBuildCandidates(player) {
    const buildLimit = Number(this.activeEventEffects?.().buildingLimitPerTurn);
    if (buildLimitReached(player, buildLimit)) return [];
    return this.tiles
      .filter(tile => this.canBuildOnTile(player, tile))
      .filter(tile => !this.propertyOpenOfferRejection(tile))
      .filter(tile => Number(player.cash || 0) >= this.getPropertyHouseCost(tile) + BOT_BUILD_RESERVE_CASH)
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
      score: BOT_BUILD_SCORE - hotelMalus
    };
  },

  botMortgageCandidates(player) {
    if (player.cash >= 180) return [];
    return this.tiles
      .filter(tile => this.canMortgageTile(player, tile))
      // A deed named by an open trade or contract cannot be managed (the
      // engine refuses it), so it is never offered as a rescue.
      .filter(tile => !this.propertyOpenOfferRejection(tile))
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
      .filter(tile => !this.propertyOpenOfferRejection(tile))
      .map(tile => {
        const multiplier = typeof this.propertyValueMultiplier === 'function' ? this.propertyValueMultiplier() : 1;
        const cost = unmortgageCostFor(tile.price, multiplier);
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
      score: BOT_MORTGAGE_SCORE
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
      score: BOT_LOAN_SCORE
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
    const ctx = { game: this, player, ask: BOT_TRADE_ASK_DEFAULT };
    const owned = tradeTiles(this, player);
    const table = coalitionAgainst(this, player.id);
    const partners = tradePartners(this, player, table, player.grudge);
    const candidates = [];
    partners.forEach(partner => collectGroupTradeCandidates(ctx, partner, owned, candidates));
    // Set completers first, then the most valuable offer; the sort is stable.
    candidates.sort((a, b) => b.score - a.score || b.strategicValue - a.strategicValue);
    return candidates.slice(0, 12);
  },

  botRichTradeCandidates(player) {
    if (!canOfferTrade(this, player)) return [];
    const owned = tradeTiles(this, player).slice(0, 3);
    if (owned.length < 2) return [];
    const table = coalitionAgainst(this, player.id);
    const partners = tradePartners(this, player, table, player.grudge);
    return partners.flatMap(partner => richTradeCandidate(this, player, partner, owned)).slice(0, 4);
  },

  botContractCandidates(player) {
    // The server rejects loan-backed contract cash (contractLogic.js guard), so a loaned bot proposing contracts
    // burns its deal counter on a sure rejection every turn. The casino and market collectors already apply the same guard.
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
    return result
      .sort((left, right) => Number(right.score || 0) - Number(left.score || 0) || Number(left.risk || 0) - Number(right.risk || 0))
      .slice(0, 8);
  },

  botMarketCandidates(player) {
    const buy = this.botMarketCandidate(player);
    if (!this.settings.market) return buy;
    if (engineTableObligationPending(this)) return buy;
    if ((player.marketActionsThisTurn || 0) >= 1) return buy;
    if (!marketTradingOpen(this)) return buy;
    const sells = marketSellCandidates(this, player);
    return [...buy, ...sells].slice(0, 32);
  },

  botMarketExpansionCandidates(player) {
    return marketExpansionCandidatesFor(this, player);
  },

  firstTradeableOwnedTile(player) {
    return player.properties.map(index => this.getTile(index)).find(tile => tile && this.isTradeableTile(tile));
  },

  botMarketCandidate(player) {
    return marketBuyCandidates(this, player);
  },

  botCasinoCandidate(player) {
    if (!casinoStakesAllowed(this, player)) return [];
    if (engineTableObligationPending(this)) return [];
    if (!casinoCashReady(this, player)) return [];
    const entryFee = casinoEntryFee(this);
    const stake = Math.min(20, Math.max(1, Math.floor(player.cash * 0.03)));
    if (player.cash < stake + entryFee) return [];
    return [{
      id: 'casino:red',
      kind: 'casino',
      color: 'red',
      stake,
      risk: 0.55,
      score: -5
    }];
  }
};

export { botApi };
