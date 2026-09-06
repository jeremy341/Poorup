import path from 'path';
import { fileURLToPath } from 'url';
import { loadJson, writeJson } from './storeIO.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_FILE = path.join(__dirname, 'data', 'achievements.json');

function sanitize(record = {}) {
  return {
    accountId: typeof record.accountId === 'string' ? record.accountId : null,
    achievementId: typeof record.achievementId === 'string' ? record.achievementId.slice(0, 80) : null,
    gameId: typeof record.gameId === 'string' ? record.gameId.slice(0, 80) : null,
    unlockedAt: typeof record.unlockedAt === 'string' ? record.unlockedAt : new Date().toISOString(),
    evidenceHash: typeof record.evidenceHash === 'string' ? record.evidenceHash.slice(0, 128) : null,
  };
}

// One descriptor per achievement rule, in evaluation order (the order is
// observable: candidates are pushed in this sequence). Tests read a per-player
// context assembled once in evaluateMatch; strings must stay verbatim because
// accountStore's rarity/points maps and client copy depend on them.
const ACHIEVEMENT_RULES = [
  { achievementId: 'first-deed', title: 'FIRST DEED', rarity: 'COMMON', body: 'You bought your first property.', test: ({ participant }) => participant.propertyCount > 0 },
  { achievementId: 'last-wallet-standing', title: 'LAST WALLET STANDING', rarity: 'COMMON', body: 'You were the last wallet standing.', test: ({ isWinner }) => isWinner },
  { achievementId: 'full-street', title: 'FULL STREET', rarity: 'UNCOMMON', body: 'You completed a country property group.', test: ({ participant }) => participant.fullGroups > 0 },
  { achievementId: 'even-builder', title: 'EVEN BUILDER', rarity: 'UNCOMMON', body: 'You built while keeping the street balanced.', test: ({ participant }) => participant.evenBuilds > 0 },
  { achievementId: 'council-member', title: 'COUNCIL MEMBER', rarity: 'UNCOMMON', body: 'You backed the policy that won the table vote.', test: ({ participant }) => participant.councilWins > 0 },
  { achievementId: 'public-works', title: 'PUBLIC WORKS', rarity: 'RARE', body: 'You built through a public-works policy.', test: ({ participant }) => participant.publicWorksBuilds > 0 },
  { achievementId: 'auction-ghost', title: 'AUCTION GHOST', rarity: 'RARE', body: 'You won an auction below the listed price.', test: ({ participant }) => participant.auctionUnderListWins > 0 },
  { achievementId: 'rent-reaper', title: 'RENT REAPER', rarity: 'RARE', body: 'You collected rent from three players in one round.', test: ({ participant }) => participant.maxRentPayersInRound >= 3 },
  { achievementId: 'airport-hopper', title: 'AIRPORT HOPPER', rarity: 'UNCOMMON', body: 'You visited every airport.', test: ({ participant }) => participant.airportVisits >= 4 },
  { achievementId: 'tax-evasion', title: 'TAX EVASION', rarity: 'RARE', body: 'You avoided every tax tile.', test: ({ participant, isWinner }) => isWinner && participant.taxTilesVisited === 0 },
  { achievementId: 'hostile-bidder', title: 'HOSTILE BIDDER', rarity: 'RARE', body: 'You won two auctions in one game.', test: ({ participant }) => participant.auctionWins >= 2 },
  { achievementId: 'empty-streets', title: 'EMPTY STREETS', rarity: 'EPIC', body: 'You won without completing a property group.', test: ({ participant, isWinner }) => isWinner && participant.fullGroups === 0 },
  { achievementId: 'liquidity-king', title: 'LIQUIDITY KING', rarity: 'EPIC', body: 'You finished with more cash than the rest of the table combined.', test: ({ participant, isWinner, othersCash }) => isWinner && participant.endingCash > othersCash },
  { achievementId: 'bad-idea-good-timing', title: 'BAD IDEA, GOOD TIMING', rarity: 'RARE', body: 'You survived after borrowing from the edge.', test: ({ participant }) => participant.badIdeaLoan && !participant.bankrupt },
  { achievementId: 'prison-break', title: 'PRISON BREAK', rarity: 'RARE', body: 'You used a prison card and still won.', test: ({ participant, isWinner }) => participant.prisonBreak && isWinner },
  { achievementId: 'no-refunds', title: 'NO REFUNDS', rarity: 'RARE', body: 'You won after reaching the loan warning.', test: ({ participant, isWinner }) => participant.loanWarningSeen && isWinner },
  { achievementId: 'roulette-regular', title: 'ROULETTE REGULAR', rarity: 'RARE', body: 'You placed eight roulette bets in one game.', test: ({ participant }) => participant.casinoBets >= 8 },
  { achievementId: 'one-dollar-hedge', title: 'ONE DOLLAR HEDGE', rarity: 'COMMON', body: 'You placed a one-dollar roulette bet.', test: ({ participant }) => participant.casinoOneDollar },
  { achievementId: 'all-in', title: 'ALL IN', rarity: 'EPIC', body: 'You risked your available capital on one roulette stake.', test: ({ participant }) => participant.casinoAllIn },
  { achievementId: 'first-index', title: 'FIRST INDEX', rarity: 'COMMON', body: 'You entered the fictional exchange.', test: ({ participant }) => participant.marketTrades >= 1 },
  { achievementId: 'market-maker', title: 'MARKET MAKER', rarity: 'RARE', body: 'You completed ten market orders in one game.', test: ({ participant }) => participant.marketTrades >= 10 },
  { achievementId: 'crisis-investor', title: 'CRISIS INVESTOR', rarity: 'EPIC', body: 'You bought through a crisis and profited after recovery.', test: ({ participant }) => participant.crisisMarketProfit || (participant.boughtDuringHousingBubble && participant.bubbleSurvivor) },
  { achievementId: 'fire-sale', title: 'FIRE SALE', rarity: 'RARE', body: 'You sold three buildings while the housing market was in crisis.', test: ({ participant }) => participant.soldBuildingsDuringHousingBubble >= 3 },
  { achievementId: 'bubble-survivor', title: 'BUBBLE SURVIVOR', rarity: 'EPIC', body: 'You kept a developed deed through the housing crash.', test: ({ participant }) => participant.bubbleSurvivor && !participant.bankrupt },
  { achievementId: 'short-the-street', title: 'SHORT THE STREET', rarity: 'EPIC', body: 'You sold into the crash and rebuilt after recovery.', test: ({ participant }) => participant.rebuiltAfterHousingBubble },
  { achievementId: 'underdog', title: 'THE UNDERDOG', rarity: 'RARE', body: 'You were last in cash at the midpoint and still won.', test: ({ participant, isWinner }) => participant.underdogAtHalfway && isWinner },
  { achievementId: 'one-more-turn', title: 'ONE MORE TURN', rarity: 'EPIC', body: 'You repaid a loan on its final cure round.', test: ({ participant }) => participant.oneMoreTurn },
  { achievementId: 'group-therapy', title: 'GROUP THERAPY', rarity: 'UNCOMMON', body: 'You completed a trade involving three properties.', test: ({ participant }) => participant.groupTherapyTrade },
  { achievementId: 'coalition-builder', title: 'COALITION BUILDER', rarity: 'RARE', body: 'You traded with a player who backed a different policy.', test: ({ participant }) => participant.coalitionTrade },
  { achievementId: 'unanimous', title: 'UNANIMOUS', rarity: 'RARE', body: 'Every active player chose the same policy.', test: ({ participant }) => participant.unanimousVote },
  { achievementId: 'public-enemy', title: 'PUBLIC ENEMY', rarity: 'LEGENDARY', body: 'The table voted to enforce an investigation against your portfolio.', test: ({ participant }) => participant.publicEnemy },
  { achievementId: 'compromised-council', title: 'COMPROMISED COUNCIL', rarity: 'LEGENDARY', body: 'You chose the quiet exit when the legitimacy crisis reached the council.', test: ({ participant }) => participant.compromisedCouncil },
  { achievementId: 'grounded-tourist', title: 'GROUNDED TOURIST', rarity: 'RARE', body: 'You kept earning from the city while flights were grounded.', test: ({ participant }) => participant.airportOwnedDuringStrike && participant.nonAirportRentDuringStrike },
  { achievementId: 'stagflation-trader', title: 'STAGFLATION TRADER', rarity: 'EPIC', body: 'You completed a trade through the stagflation squeeze.', test: ({ participant, eventCombinations }) => participant.tradesDuringCombo > 0 && eventCombinations.includes('stagflation') },
  { achievementId: 'no-floor', title: 'NO FLOOR', rarity: 'LEGENDARY', body: 'You survived Foreclosure Spiral without taking a second bank loan.', test: ({ participant, eventCombinations }) => eventCombinations.includes('foreclosure-spiral') && participant.bankLoanCount <= 1 && !participant.bankrupt },
  { achievementId: 'moral-hazard', title: 'MORAL HAZARD', rarity: 'EPIC', body: 'You took the bailout while already carrying a bank loan.', test: ({ participant }) => participant.bailoutReceived && participant.moralHazard },
  { achievementId: '41st-tile', title: 'THE 41ST TILE', rarity: 'MYTHICAL', body: 'There are forty tiles. You stepped on one more.', test: ({ participant, isWinner }) => isWinner && participant.hiddenMovementSequence },
  { achievementId: 'null-player', title: 'THE NULL PLAYER', rarity: 'MYTHICAL', body: 'Your wallet was empty. The turn continued.', test: ({ participant, isWinner }) => isWinner && participant.zeroCashReached && !participant.bankrupt },
  { achievementId: 'black-ledger', title: 'THE BLACK LEDGER', rarity: 'MYTHICAL', body: 'The bank closed the book. Something inside kept counting.', test: ({ participant, isWinner }) => isWinner && participant.comboExperienced && participant.collateralLost },
  { achievementId: 'generous-lender', title: 'GENEROUS LENDER', rarity: 'UNCOMMON', body: 'You funded a player loan that was fully repaid.', test: ({ participant, contracts }) => contracts.some(contract => contract.kind === 'loan' && contract.status === 'paid' && contract.fromAccountId === participant.accountId) },
  { achievementId: 'silent-partner', title: 'SILENT PARTNER', rarity: 'RARE', body: 'You completed a player loan without collateral.', test: ({ participant, contracts }) => contracts.some(contract => contract.kind === 'loan' && contract.status === 'paid' && contract.fromAccountId === participant.accountId && contract.collateralTileIndex == null) },
  { achievementId: 'collateral-damage', title: 'COLLATERAL DAMAGE', rarity: 'RARE', body: 'A player loan default cost the collateral deed.', test: ({ participant, contracts }) => contracts.some(contract => contract.kind === 'loan' && contract.status === 'defaulted' && contract.fromAccountId === participant.accountId && contract.collateralTileIndex != null) },
  { achievementId: 'crisis-manager', title: 'CRISIS MANAGER', rarity: 'RARE', body: 'You stayed solvent through a global headline.', test: ({ participant }) => participant.globalEventsExperienced > 0 && !participant.bankrupt },
  { achievementId: 'double-headline', title: 'DOUBLE HEADLINE', rarity: 'LEGENDARY', body: 'You survived two global headlines in one game.', test: ({ globalEvents }) => globalEvents.length >= 2 },
  { achievementId: 'clean-exit', title: 'CLEAN EXIT', rarity: 'UNCOMMON', body: 'You repaid a bank loan before default.', test: ({ participant }) => participant.bankLoanStatus === 'paid' && !participant.bankLoanDefaulted },
  { achievementId: 'debt-free', title: 'DEBT FREE', rarity: 'UNCOMMON', body: 'You finished the game with clean books.', test: ({ participant }) => !participant.bankLoanStatus || participant.bankLoanStatus === 'paid' },
  { achievementId: 'treasure-map', title: 'TREASURE MAP', rarity: 'EPIC', body: 'You drew every Treasure card across your account history.', test: ({ treasureCardCount }) => treasureCardCount >= 16 },
  { achievementId: 'event-tourist', title: 'EVENT TOURIST', rarity: 'RARE', body: 'You experienced three different global events.', test: ({ eventCount }) => eventCount >= 3 },
];

function asArray(value) {
  return Array.isArray(value) ? value : [];
}

function resolveHistory(historyForAccount, accountId) {
  const historyResult = typeof historyForAccount === 'function' ? historyForAccount(accountId) : [];
  return Array.isArray(historyResult) ? historyResult : [];
}

function countTreasureCards(history, matchRecord, accountId) {
  const treasureCards = new Set();
  history.concat(matchRecord).forEach(record => {
    const owner = (record?.participants || []).find(entry => entry.accountId === accountId);
    (owner?.treasureCardsSeenList || []).forEach(card => treasureCards.add(String(card)));
  });
  return treasureCards.size;
}

function countEventNames(history, globalEvents) {
  const eventNames = new Set(history.flatMap(record => (Array.isArray(record.globalEvents) ? record.globalEvents : [])));
  globalEvents.forEach(event => eventNames.add(event));
  return eventNames.size;
}

function othersCashSum(participants, accountId) {
  return participants
    .filter(entry => entry.accountId !== accountId)
    .reduce((sum, entry) => sum + (Number(entry.endingCash) || 0), 0);
}

// Assemble the per-player evaluation context in the original field order.
function buildMatchContext(participant, shared) {
  const history = resolveHistory(shared.historyForAccount, participant.accountId);
  return {
    participant,
    isWinner: participant.finalPlacement === 1,
    othersCash: othersCashSum(shared.participants, participant.accountId),
    contracts: shared.contracts,
    globalEvents: shared.globalEvents,
    eventCombinations: shared.eventCombinations,
    treasureCardCount: countTreasureCards(history, shared.matchRecord, participant.accountId),
    eventCount: countEventNames(history, shared.globalEvents),
  };
}

function appendUnlockedAchievements(candidates, context) {
  ACHIEVEMENT_RULES.forEach((rule) => {
    if (rule.test(context)) {
      candidates.push({ accountId: context.participant.accountId, achievementId: rule.achievementId, title: rule.title, rarity: rule.rarity, body: rule.body });
    }
  });
}

export class AchievementStore {
  constructor(filePath = DEFAULT_FILE) {
    this.filePath = filePath;
    this.records = new Map();
    this.load();
  }

  key(accountId, achievementId) {
    return `${accountId}:${achievementId}`;
  }

  load() {
    const { value } = loadJson(this.filePath);
    if (!value) return;
    const records = Array.isArray(value) ? value : [];
    records.forEach((entry) => {
      const record = sanitize(entry);
      if (record.accountId && record.achievementId) this.records.set(this.key(record.accountId, record.achievementId), record);
    });
  }

  persist() {
    writeJson(this.filePath, [...this.records.values()]);
  }

  unlock(record) {
    const next = sanitize(record);
    if (!next.accountId || !next.achievementId) return { created: false, record: null };
    const key = this.key(next.accountId, next.achievementId);
    const existing = this.records.get(key);
    if (existing) return { created: false, record: existing };
    this.records.set(key, next);
    this.persist();
    return { created: true, record: next };
  }

  listForAccount(accountId) {
    return [...this.records.values()].filter((record) => record.accountId === accountId);
  }

  evaluateMatch(matchRecord, historyForAccount = null) {
    const candidates = [];
    const participants = asArray(matchRecord?.participants);
    const shared = {
      participants,
      contracts: asArray(matchRecord?.playerContracts),
      globalEvents: asArray(matchRecord?.globalEvents),
      eventCombinations: asArray(matchRecord?.eventCombinations),
      matchRecord,
      historyForAccount,
    };
    participants.forEach((participant) => {
      if (!participant.accountId) return;
      appendUnlockedAchievements(candidates, buildMatchContext(participant, shared));
    });
    return candidates;
  }
}
