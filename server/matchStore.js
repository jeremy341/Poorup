import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const DEFAULT_FILE = path.join(__dirname, 'data', 'matches.json');
const MAX_MATCHES = 500;

function safeArray(value, limit) {
  return Array.isArray(value) ? value.slice(0, limit) : [];
}

function sanitizeMatch(record = {}) {
  return {
    matchId: typeof record.matchId === 'string' ? record.matchId.slice(0, 80) : null,
    completedAt: typeof record.completedAt === 'string' ? record.completedAt : new Date().toISOString(),
    durationSeconds: Math.max(0, Number(record.durationSeconds) || 0),
    roundCount: Math.max(0, Number(record.roundCount) || 0),
    roomVisibility: record.roomVisibility === 'private' ? 'private' : 'public',
    participants: safeArray(record.participants, 8).map((participant) => ({
      accountId: typeof participant?.accountId === 'string' ? participant.accountId : null,
      displayNameAtMatch: typeof participant?.displayNameAtMatch === 'string' ? participant.displayNameAtMatch.slice(0, 24) : 'PLAYER',
      colorAtMatch: typeof participant?.colorAtMatch === 'string' ? participant.colorAtMatch : '#35a653',
      finalPlacement: Number.isInteger(participant?.finalPlacement) ? Math.max(1, participant.finalPlacement) : null,
      endingCash: Math.max(0, Number(participant?.endingCash) || 0),
      propertyCount: Math.max(0, Number(participant?.propertyCount) || 0),
      bankrupt: participant?.bankrupt === true,
      disconnected: participant?.disconnected === true,
      auctionWins: Math.max(0, Number(participant?.auctionWins) || 0),
      rentCollected: Math.max(0, Number(participant?.rentCollected) || 0),
      globalEventsExperienced: Math.max(0, Number(participant?.globalEventsExperienced) || 0),
      globalEventsSurvived: Math.max(0, Number(participant?.globalEventsSurvived) || 0),
      casinoNet: Number(participant?.casinoNet) || 0,
      casinoBets: Math.max(0, Number(participant?.casinoBets) || 0),
      casinoMaxStake: Math.max(0, Number(participant?.casinoMaxStake) || 0),
      casinoTotalStaked: Math.max(0, Number(participant?.casinoTotalStaked) || 0),
      casinoAllIn: participant?.casinoAllIn === true,
      casinoOneDollar: participant?.casinoOneDollar === true,
      marketTrades: Math.max(0, Number(participant?.marketTrades) || 0),
      crisisMarketProfit: participant?.crisisMarketProfit === true,
      bankLoanStatus: typeof participant?.bankLoanStatus === 'string' ? participant.bankLoanStatus.slice(0, 20) : null,
      bankLoanDefaulted: participant?.bankLoanDefaulted === true,
      bankLoanCount: Math.max(0, Number(participant?.bankLoanCount) || 0),
      airportVisits: Math.max(0, Number(participant?.airportVisits) || 0),
      taxTilesVisited: Math.max(0, Number(participant?.taxTilesVisited) || 0),
      maxRentPayersInRound: Math.max(0, Number(participant?.maxRentPayersInRound) || 0),
      auctionUnderListWins: Math.max(0, Number(participant?.auctionUnderListWins) || 0),
      loanWarningSeen: participant?.loanWarningSeen === true,
      badIdeaLoan: participant?.badIdeaLoan === true,
      prisonBreak: participant?.prisonBreak === true,
      fullGroups: Math.max(0, Number(participant?.fullGroups) || 0),
      evenBuilds: Math.max(0, Number(participant?.evenBuilds) || 0),
      councilWins: Math.max(0, Number(participant?.councilWins) || 0),
      publicWorksBuilds: Math.max(0, Number(participant?.publicWorksBuilds) || 0),
      cardDraws: participant?.cardDraws && typeof participant.cardDraws === 'object' ? {
        surprise: Math.max(0, Number(participant.cardDraws.surprise) || 0),
        treasure: Math.max(0, Number(participant.cardDraws.treasure) || 0)
      } : { surprise: 0, treasure: 0 },
      zeroCashReached: participant?.zeroCashReached === true,
      collateralLost: participant?.collateralLost === true,
      comboExperienced: participant?.comboExperienced === true,
      bubbleSurvivor: participant?.bubbleSurvivor === true,
      rebuiltAfterHousingBubble: participant?.rebuiltAfterHousingBubble === true,
      foreclosureNoSecondLoan: participant?.foreclosureNoSecondLoan === true,
      housingBubbleEnded: participant?.housingBubbleEnded === true,
      soldBuildingsDuringHousingBubble: Math.max(0, Number(participant?.soldBuildingsDuringHousingBubble) || 0),
      boughtDuringHousingBubble: participant?.boughtDuringHousingBubble === true,
      airportOwnedDuringStrike: participant?.airportOwnedDuringStrike === true,
      nonAirportRentDuringStrike: participant?.nonAirportRentDuringStrike === true,
      tradesDuringCombo: Math.max(0, Number(participant?.tradesDuringCombo) || 0),
      groupTherapyTrade: participant?.groupTherapyTrade === true,
      unanimousVote: participant?.unanimousVote === true,
      publicEnemy: participant?.publicEnemy === true,
      compromisedCouncil: participant?.compromisedCouncil === true,
      coalitionTrade: participant?.coalitionTrade === true,
      bailoutReceived: participant?.bailoutReceived === true,
      moralHazard: participant?.moralHazard === true,
      treasureCardsSeen: Math.max(0, Number(participant?.treasureCardsSeen) || 0),
      treasureCardsSeenList: Array.isArray(participant?.treasureCardsSeenList) ? participant.treasureCardsSeenList.slice(0, 32).map(value => String(value).slice(0, 160)) : [],
      underdogAtHalfway: participant?.underdogAtHalfway === true,
      oneMoreTurn: participant?.oneMoreTurn === true,
      moveCount: Math.max(0, Number(participant?.moveCount) || 0),
      hiddenMovementSequence: participant?.hiddenMovementSequence === true,
    })),
    globalEvents: safeArray(record.globalEvents, 20).filter((item) => typeof item === 'string').map((item) => item.slice(0, 100)),
    eventCombinations: safeArray(record.eventCombinations, 10).filter((item) => typeof item === 'string').map((item) => item.slice(0, 100)),
    tradesCompleted: Math.max(0, Number(record.tradesCompleted) || 0),
    auctionsCompleted: Math.max(0, Number(record.auctionsCompleted) || 0),
    casino: safeArray(record.casino, 8).map(entry => ({ accountId: typeof entry?.accountId === 'string' ? entry.accountId : null, bets: Math.max(0, Number(entry?.bets) || 0), net: Number(entry?.net) || 0 })),
    market: safeArray(record.market, 8).map(entry => ({ accountId: typeof entry?.accountId === 'string' ? entry.accountId : null, positions: entry?.positions && typeof entry.positions === 'object' ? entry.positions : {} })),
    playerContracts: safeArray(record.playerContracts, 20).map(contract => ({
      id: typeof contract?.id === 'string' ? contract.id.slice(0, 100) : null,
      kind: contract?.kind === 'equity' ? 'equity' : 'loan',
      fromAccountId: typeof contract?.fromAccountId === 'string' ? contract.fromAccountId : null,
      toAccountId: typeof contract?.toAccountId === 'string' ? contract.toAccountId : null,
      fromPlayerId: typeof contract?.fromPlayerId === 'string' ? contract.fromPlayerId : null,
      toPlayerId: typeof contract?.toPlayerId === 'string' ? contract.toPlayerId : null,
      amount: Math.max(0, Number(contract?.amount) || 0),
      status: typeof contract?.status === 'string' ? contract.status.slice(0, 20) : 'unknown',
      premiumRate: Math.max(0, Number(contract?.premiumRate) || 0),
      equityShare: Math.max(0, Number(contract?.equityShare) || 0),
      collateralTileIndex: Number.isInteger(Number(contract?.collateralTileIndex)) ? Number(contract.collateralTileIndex) : null
    })),
  };
}

export class MatchStore {
  constructor(filePath = DEFAULT_FILE) {
    this.filePath = filePath;
    this.matches = new Map();
    this.load();
  }

  load() {
    try {
      const raw = JSON.parse(fs.readFileSync(this.filePath, 'utf8'));
      const records = Array.isArray(raw) ? raw : [];
      records.forEach((record) => {
        const match = sanitizeMatch(record);
        if (match.matchId) this.matches.set(match.matchId, match);
      });
    } catch {
      // A missing match file starts an empty ledger.
    }
  }

  persist() {
    fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
    const records = [...this.matches.values()]
      .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)))
      .slice(0, MAX_MATCHES);
    fs.writeFileSync(this.filePath, `${JSON.stringify(records, null, 2)}\n`, 'utf8');
  }

  record(record) {
    const match = sanitizeMatch(record);
    if (!match.matchId) return { created: false, match: null };
    const existing = this.matches.get(match.matchId);
    if (existing) return { created: false, match: existing };
    this.matches.set(match.matchId, match);
    this.persist();
    return { created: true, match };
  }

  get(matchId) {
    return this.matches.get(matchId) || null;
  }

  listForAccount(accountId, limit = 50) {
    if (!accountId) return [];
    return [...this.matches.values()]
      .filter((match) => match.participants.some((participant) => participant.accountId === accountId))
      .sort((a, b) => String(b.completedAt).localeCompare(String(a.completedAt)))
      .slice(0, Math.max(1, Math.min(100, Number(limit) || 50)));
  }
}
