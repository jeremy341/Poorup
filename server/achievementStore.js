import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

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
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      const records = Array.isArray(raw) ? raw : [];
      records.forEach((entry) => {
        const record = sanitize(entry);
        if (record.accountId && record.achievementId) this.records.set(this.key(record.accountId, record.achievementId), record);
      });
    } catch {
      // A missing achievement file starts an empty verified ledger.
    }
  }

  persist() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    fs.writeFileSync(this.filePath, `${JSON.stringify([...this.records.values()], null, 2)}\n`, 'utf8');
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
    const globalEvents = Array.isArray(matchRecord?.globalEvents) ? matchRecord.globalEvents : [];
    const eventCombinations = Array.isArray(matchRecord?.eventCombinations) ? matchRecord.eventCombinations : [];
    const participants = Array.isArray(matchRecord?.participants) ? matchRecord.participants : [];
    participants.forEach((participant) => {
      if (!participant.accountId) return;
      const others = participants.filter(entry => entry.accountId !== participant.accountId);
      const isWinner = participant.finalPlacement === 1;
      if (participant.propertyCount > 0) candidates.push({ accountId: participant.accountId, achievementId: 'first-deed', title: 'FIRST DEED', rarity: 'COMMON', body: 'You bought your first property.' });
      if (isWinner) candidates.push({ accountId: participant.accountId, achievementId: 'last-wallet-standing', title: 'LAST WALLET STANDING', rarity: 'COMMON', body: 'You were the last wallet standing.' });
      if (participant.fullGroups > 0) candidates.push({ accountId: participant.accountId, achievementId: 'full-street', title: 'FULL STREET', rarity: 'UNCOMMON', body: 'You completed a country property group.' });
      if (participant.evenBuilds > 0) candidates.push({ accountId: participant.accountId, achievementId: 'even-builder', title: 'EVEN BUILDER', rarity: 'UNCOMMON', body: 'You built while keeping the street balanced.' });
      if (participant.councilWins > 0) candidates.push({ accountId: participant.accountId, achievementId: 'council-member', title: 'COUNCIL MEMBER', rarity: 'UNCOMMON', body: 'You backed the policy that won the table vote.' });
      if (participant.publicWorksBuilds > 0) candidates.push({ accountId: participant.accountId, achievementId: 'public-works', title: 'PUBLIC WORKS', rarity: 'RARE', body: 'You built through a public-works policy.' });
      if (participant.auctionUnderListWins > 0) candidates.push({ accountId: participant.accountId, achievementId: 'auction-ghost', title: 'AUCTION GHOST', rarity: 'RARE', body: 'You won an auction below the listed price.' });
      if (participant.maxRentPayersInRound >= 3) candidates.push({ accountId: participant.accountId, achievementId: 'rent-reaper', title: 'RENT REAPER', rarity: 'RARE', body: 'You collected rent from three players in one round.' });
      if (participant.airportVisits >= 4) candidates.push({ accountId: participant.accountId, achievementId: 'airport-hopper', title: 'AIRPORT HOPPER', rarity: 'UNCOMMON', body: 'You visited every airport.' });
      if (isWinner && participant.taxTilesVisited === 0) candidates.push({ accountId: participant.accountId, achievementId: 'tax-evasion', title: 'TAX EVASION', rarity: 'RARE', body: 'You avoided every tax tile.' });
      if (participant.auctionWins >= 2) candidates.push({ accountId: participant.accountId, achievementId: 'hostile-bidder', title: 'HOSTILE BIDDER', rarity: 'RARE', body: 'You won two auctions in one game.' });
      if (isWinner && participant.fullGroups === 0) candidates.push({ accountId: participant.accountId, achievementId: 'empty-streets', title: 'EMPTY STREETS', rarity: 'EPIC', body: 'You won without completing a property group.' });
      if (isWinner && participant.endingCash > others.reduce((sum, entry) => sum + (Number(entry.endingCash) || 0), 0)) candidates.push({ accountId: participant.accountId, achievementId: 'liquidity-king', title: 'LIQUIDITY KING', rarity: 'EPIC', body: 'You finished with more cash than the rest of the table combined.' });
      if (participant.badIdeaLoan && !participant.bankrupt) candidates.push({ accountId: participant.accountId, achievementId: 'bad-idea-good-timing', title: 'BAD IDEA, GOOD TIMING', rarity: 'RARE', body: 'You survived after borrowing from the edge.' });
      if (participant.prisonBreak && isWinner) candidates.push({ accountId: participant.accountId, achievementId: 'prison-break', title: 'PRISON BREAK', rarity: 'RARE', body: 'You used a prison card and still won.' });
      if (participant.loanWarningSeen && isWinner) candidates.push({ accountId: participant.accountId, achievementId: 'no-refunds', title: 'NO REFUNDS', rarity: 'RARE', body: 'You won after reaching the loan warning.' });
      if (participant.casinoBets >= 8) candidates.push({ accountId: participant.accountId, achievementId: 'roulette-regular', title: 'ROULETTE REGULAR', rarity: 'RARE', body: 'You placed eight roulette bets in one game.' });
      if (participant.casinoOneDollar) candidates.push({ accountId: participant.accountId, achievementId: 'one-dollar-hedge', title: 'ONE DOLLAR HEDGE', rarity: 'COMMON', body: 'You placed a one-dollar roulette bet.' });
      if (participant.casinoAllIn) candidates.push({ accountId: participant.accountId, achievementId: 'all-in', title: 'ALL IN', rarity: 'EPIC', body: 'You risked your available capital on one roulette stake.' });
      if (participant.marketTrades >= 1) candidates.push({ accountId: participant.accountId, achievementId: 'first-index', title: 'FIRST INDEX', rarity: 'COMMON', body: 'You entered the fictional exchange.' });
      if (participant.marketTrades >= 10) candidates.push({ accountId: participant.accountId, achievementId: 'market-maker', title: 'MARKET MAKER', rarity: 'RARE', body: 'You completed ten market orders in one game.' });
      if (participant.crisisMarketProfit || (participant.boughtDuringHousingBubble && participant.bubbleSurvivor)) candidates.push({ accountId: participant.accountId, achievementId: 'crisis-investor', title: 'CRISIS INVESTOR', rarity: 'EPIC', body: 'You bought through a crisis and profited after recovery.' });
      if (participant.soldBuildingsDuringHousingBubble >= 3) candidates.push({ accountId: participant.accountId, achievementId: 'fire-sale', title: 'FIRE SALE', rarity: 'RARE', body: 'You sold three buildings while the housing market was in crisis.' });
      if (participant.bubbleSurvivor && !participant.bankrupt) candidates.push({ accountId: participant.accountId, achievementId: 'bubble-survivor', title: 'BUBBLE SURVIVOR', rarity: 'EPIC', body: 'You kept a developed deed through the housing crash.' });
      if (participant.rebuiltAfterHousingBubble) candidates.push({ accountId: participant.accountId, achievementId: 'short-the-street', title: 'SHORT THE STREET', rarity: 'EPIC', body: 'You sold into the crash and rebuilt after recovery.' });
      if (participant.underdogAtHalfway && isWinner) candidates.push({ accountId: participant.accountId, achievementId: 'underdog', title: 'THE UNDERDOG', rarity: 'RARE', body: 'You were last in cash at the midpoint and still won.' });
      if (participant.oneMoreTurn) candidates.push({ accountId: participant.accountId, achievementId: 'one-more-turn', title: 'ONE MORE TURN', rarity: 'EPIC', body: 'You repaid a loan on its final cure round.' });
      if (participant.groupTherapyTrade) candidates.push({ accountId: participant.accountId, achievementId: 'group-therapy', title: 'GROUP THERAPY', rarity: 'UNCOMMON', body: 'You completed a trade involving three properties.' });
      if (participant.coalitionTrade) candidates.push({ accountId: participant.accountId, achievementId: 'coalition-builder', title: 'COALITION BUILDER', rarity: 'RARE', body: 'You traded with a player who backed a different policy.' });
      if (participant.unanimousVote) candidates.push({ accountId: participant.accountId, achievementId: 'unanimous', title: 'UNANIMOUS', rarity: 'RARE', body: 'Every active player chose the same policy.' });
      if (participant.publicEnemy) candidates.push({ accountId: participant.accountId, achievementId: 'public-enemy', title: 'PUBLIC ENEMY', rarity: 'LEGENDARY', body: 'The table voted to enforce an investigation against your portfolio.' });
      if (participant.compromisedCouncil) candidates.push({ accountId: participant.accountId, achievementId: 'compromised-council', title: 'COMPROMISED COUNCIL', rarity: 'LEGENDARY', body: 'You chose the quiet exit when the legitimacy crisis reached the council.' });
      if (participant.airportOwnedDuringStrike && participant.nonAirportRentDuringStrike) candidates.push({ accountId: participant.accountId, achievementId: 'grounded-tourist', title: 'GROUNDED TOURIST', rarity: 'RARE', body: 'You kept earning from the city while flights were grounded.' });
      if (participant.tradesDuringCombo > 0 && eventCombinations.includes('stagflation')) candidates.push({ accountId: participant.accountId, achievementId: 'stagflation-trader', title: 'STAGFLATION TRADER', rarity: 'EPIC', body: 'You completed a trade through the stagflation squeeze.' });
      if (eventCombinations.includes('foreclosure-spiral') && participant.bankLoanCount <= 1 && !participant.bankrupt) candidates.push({ accountId: participant.accountId, achievementId: 'no-floor', title: 'NO FLOOR', rarity: 'LEGENDARY', body: 'You survived Foreclosure Spiral without taking a second bank loan.' });
      if (participant.bailoutReceived && participant.moralHazard) candidates.push({ accountId: participant.accountId, achievementId: 'moral-hazard', title: 'MORAL HAZARD', rarity: 'EPIC', body: 'You took the bailout while already carrying a bank loan.' });
      if (isWinner && participant.hiddenMovementSequence) candidates.push({ accountId: participant.accountId, achievementId: '41st-tile', title: 'THE 41ST TILE', rarity: 'MYTHICAL', body: 'There are forty tiles. You stepped on one more.' });
      if (isWinner && participant.zeroCashReached && !participant.bankrupt) candidates.push({ accountId: participant.accountId, achievementId: 'null-player', title: 'THE NULL PLAYER', rarity: 'MYTHICAL', body: 'Your wallet was empty. The turn continued.' });
      if (isWinner && participant.comboExperienced && participant.collateralLost) candidates.push({ accountId: participant.accountId, achievementId: 'black-ledger', title: 'THE BLACK LEDGER', rarity: 'MYTHICAL', body: 'The bank closed the book. Something inside kept counting.' });
      const contracts = Array.isArray(matchRecord.playerContracts) ? matchRecord.playerContracts : [];
      if (contracts.some(contract => contract.kind === 'loan' && contract.status === 'paid' && contract.fromAccountId === participant.accountId)) candidates.push({ accountId: participant.accountId, achievementId: 'generous-lender', title: 'GENEROUS LENDER', rarity: 'UNCOMMON', body: 'You funded a player loan that was fully repaid.' });
      if (contracts.some(contract => contract.kind === 'loan' && contract.status === 'paid' && contract.fromAccountId === participant.accountId && contract.collateralTileIndex == null)) candidates.push({ accountId: participant.accountId, achievementId: 'silent-partner', title: 'SILENT PARTNER', rarity: 'RARE', body: 'You completed a player loan without collateral.' });
      if (contracts.some(contract => contract.kind === 'loan' && contract.status === 'defaulted' && contract.fromAccountId === participant.accountId && contract.collateralTileIndex != null)) candidates.push({ accountId: participant.accountId, achievementId: 'collateral-damage', title: 'COLLATERAL DAMAGE', rarity: 'RARE', body: 'A player loan default cost the collateral deed.' });
      if (participant.globalEventsExperienced > 0 && !participant.bankrupt) candidates.push({ accountId: participant.accountId, achievementId: 'crisis-manager', title: 'CRISIS MANAGER', rarity: 'RARE', body: 'You stayed solvent through a global headline.' });
      if (globalEvents.length >= 2) candidates.push({ accountId: participant.accountId, achievementId: 'double-headline', title: 'DOUBLE HEADLINE', rarity: 'LEGENDARY', body: 'You survived two global headlines in one game.' });
      if (participant.bankLoanStatus === 'paid' && !participant.bankLoanDefaulted) candidates.push({ accountId: participant.accountId, achievementId: 'clean-exit', title: 'CLEAN EXIT', rarity: 'UNCOMMON', body: 'You repaid a bank loan before default.' });
      if (!participant.bankLoanStatus || participant.bankLoanStatus === 'paid') candidates.push({ accountId: participant.accountId, achievementId: 'debt-free', title: 'DEBT FREE', rarity: 'UNCOMMON', body: 'You finished the game with clean books.' });
      const historyResult = typeof historyForAccount === 'function' ? historyForAccount(participant.accountId) : [];
      const history = Array.isArray(historyResult) ? historyResult : [];
      const treasureCards = new Set();
      history.concat(matchRecord).forEach(record => {
        const owner = (record?.participants || []).find(entry => entry.accountId === participant.accountId);
        (owner?.treasureCardsSeenList || []).forEach(card => treasureCards.add(String(card)));
      });
      if (treasureCards.size >= 16) candidates.push({ accountId: participant.accountId, achievementId: 'treasure-map', title: 'TREASURE MAP', rarity: 'EPIC', body: 'You drew every Treasure card across your account history.' });
      const eventNames = new Set(history.flatMap(record => Array.isArray(record.globalEvents) ? record.globalEvents : []));
      globalEvents.forEach(event => eventNames.add(event));
      if (eventNames.size >= 3) candidates.push({ accountId: participant.accountId, achievementId: 'event-tourist', title: 'EVENT TOURIST', rarity: 'RARE', body: 'You experienced three different global events.' });
    });
    return candidates;
  }
}
