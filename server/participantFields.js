// Shared participant schema for the two match-record builders:
//   - matchStore.sanitizeMatch (record-shaped input loaded/persisted by MatchStore)
//   - accountStore.recordGameResults (live RoomManager player objects, Set-typed fields)
// Both stores used to hand-write the same 60 fields in the same order (a CodeScene
// "Bumpy Road" hotspot). The key list and order now live here; the coercions stay
// per-side because record input and live-player input genuinely differ (Sets,
// bankLoan.status, casinoLedger.length, raw spreads/leaks on the player side).
// Characterization goldens in server/gameLogic.test.js pin the current output of
// both builders; do not "clean up" a coercer without regenerating those goldens.

export const numberOrZero = (value) => Number(value) || 0;
export const nonNegative = (value) => Math.max(0, Number(value) || 0);
export const flag = (value) => value === true;
export const setSize = (value) => (value instanceof Set ? value.size : 0);

const text = (value, maxLength) => (typeof value === 'string' ? value.slice(0, maxLength) : null);

// One descriptor per participant field, in output order.
export const PARTICIPANT_FIELDS = [
  { key: 'accountId', fromRecord: (v) => (typeof v?.accountId === 'string' ? v.accountId : null), fromPlayer: (p) => p.accountId },
  { key: 'displayNameAtMatch', fromRecord: (v) => (typeof v?.displayNameAtMatch === 'string' ? v.displayNameAtMatch.slice(0, 24) : 'PLAYER'), fromPlayer: (p) => p.nickname },
  { key: 'colorAtMatch', fromRecord: (v) => (typeof v?.colorAtMatch === 'string' ? v.colorAtMatch : '#35a653'), fromPlayer: (p) => p.color },
  { key: 'finalPlacement', fromRecord: (v) => (Number.isInteger(v?.finalPlacement) ? Math.max(1, v.finalPlacement) : null), fromPlayer: (p, ctx) => ctx.placementById.get(p.id) || (p.id === ctx.winnerId ? 1 : null) },
  { key: 'endingCash', fromRecord: (v) => nonNegative(v?.endingCash), fromPlayer: (p) => nonNegative(p.cash) },
  { key: 'propertyCount', fromRecord: (v) => nonNegative(v?.propertyCount), fromPlayer: (p) => (Array.isArray(p.properties) ? p.properties.length : 0) },
  { key: 'bankrupt', fromRecord: (v) => flag(v?.bankrupt), fromPlayer: (p) => Boolean(p.bankrupt) },
  { key: 'disconnected', fromRecord: (v) => flag(v?.disconnected), fromPlayer: (p) => Boolean(p.disconnected) },
  { key: 'auctionWins', fromRecord: (v) => nonNegative(v?.auctionWins), fromPlayer: (p) => nonNegative(p.auctionWins) },
  { key: 'rentCollected', fromRecord: (v) => nonNegative(v?.rentCollected), fromPlayer: (p) => nonNegative(p.rentCollected) },
  { key: 'globalEventsExperienced', fromRecord: (v) => nonNegative(v?.globalEventsExperienced), fromPlayer: (p) => nonNegative(p.globalEventsExperienced) },
  { key: 'globalEventsSurvived', fromRecord: (v) => nonNegative(v?.globalEventsSurvived), fromPlayer: (p) => nonNegative(p.globalEventsSurvived) },
  { key: 'casinoNet', fromRecord: (v) => numberOrZero(v?.casinoNet), fromPlayer: (p) => numberOrZero(p.casinoNet) },
  { key: 'casinoBets', fromRecord: (v) => nonNegative(v?.casinoBets), fromPlayer: (p) => (Array.isArray(p.casinoLedger) ? p.casinoLedger.length : 0) },
  { key: 'casinoMaxStake', fromRecord: (v) => nonNegative(v?.casinoMaxStake), fromPlayer: (p) => nonNegative(p.casinoMaxStake) },
  { key: 'casinoTotalStaked', fromRecord: (v) => nonNegative(v?.casinoTotalStaked), fromPlayer: (p) => nonNegative(p.casinoTotalStaked) },
  { key: 'casinoAllIn', fromRecord: (v) => flag(v?.casinoAllIn), fromPlayer: (p) => flag(p.casinoAllIn) },
  { key: 'casinoOneDollar', fromRecord: (v) => flag(v?.casinoOneDollar), fromPlayer: (p) => flag(p.casinoOneDollar) },
  { key: 'marketTrades', fromRecord: (v) => nonNegative(v?.marketTrades), fromPlayer: (p) => nonNegative(p.marketTrades) },
  { key: 'crisisMarketProfit', fromRecord: (v) => flag(v?.crisisMarketProfit), fromPlayer: (p) => flag(p.crisisMarketProfit) },
  { key: 'bankLoanStatus', fromRecord: (v) => text(v?.bankLoanStatus, 20), fromPlayer: (p) => (typeof p.bankLoan?.status === 'string' ? p.bankLoan.status : null) },
  { key: 'bankLoanDefaulted', fromRecord: (v) => flag(v?.bankLoanDefaulted), fromPlayer: (p) => p.bankLoan?.status === 'defaulted' },
  { key: 'bankLoanCount', fromRecord: (v) => nonNegative(v?.bankLoanCount), fromPlayer: (p) => nonNegative(p.bankLoanCount) },
  { key: 'airportVisits', fromRecord: (v) => nonNegative(v?.airportVisits), fromPlayer: (p) => setSize(p.airportVisits) },
  { key: 'taxTilesVisited', fromRecord: (v) => nonNegative(v?.taxTilesVisited), fromPlayer: (p) => setSize(p.taxTilesVisited) },
  { key: 'maxRentPayersInRound', fromRecord: (v) => nonNegative(v?.maxRentPayersInRound), fromPlayer: (p) => nonNegative(p.maxRentPayersInRound) },
  { key: 'auctionUnderListWins', fromRecord: (v) => nonNegative(v?.auctionUnderListWins), fromPlayer: (p) => nonNegative(p.auctionUnderListWins) },
  { key: 'loanWarningSeen', fromRecord: (v) => flag(v?.loanWarningSeen), fromPlayer: (p) => flag(p.loanWarningSeen) },
  { key: 'badIdeaLoan', fromRecord: (v) => flag(v?.badIdeaLoan), fromPlayer: (p) => flag(p.badIdeaLoan) },
  { key: 'prisonBreak', fromRecord: (v) => flag(v?.prisonBreak), fromPlayer: (p) => flag(p.prisonBreak) },
  { key: 'fullGroups', fromRecord: (v) => nonNegative(v?.fullGroups), fromPlayer: (p) => setSize(p.fullGroups) },
  { key: 'evenBuilds', fromRecord: (v) => nonNegative(v?.evenBuilds), fromPlayer: (p) => nonNegative(p.evenBuilds) },
  { key: 'councilWins', fromRecord: (v) => nonNegative(v?.councilWins), fromPlayer: (p) => nonNegative(p.councilWins) },
  { key: 'publicWorksBuilds', fromRecord: (v) => nonNegative(v?.publicWorksBuilds), fromPlayer: (p) => nonNegative(p.publicWorksBuilds) },
  {
    key: 'cardDraws',
    fromRecord: (v) => (v?.cardDraws && typeof v.cardDraws === 'object'
      ? { surprise: nonNegative(v.cardDraws.surprise), treasure: nonNegative(v.cardDraws.treasure) }
      : { surprise: 0, treasure: 0 }),
    fromPlayer: (p) => ({ ...(p.cardDraws || {}) }),
  },
  { key: 'zeroCashReached', fromRecord: (v) => flag(v?.zeroCashReached), fromPlayer: (p) => flag(p.zeroCashReached) },
  { key: 'collateralLost', fromRecord: (v) => flag(v?.collateralLost), fromPlayer: (p) => flag(p.collateralLost) },
  { key: 'comboExperienced', fromRecord: (v) => flag(v?.comboExperienced), fromPlayer: (p) => flag(p.comboExperienced) },
  { key: 'bubbleSurvivor', fromRecord: (v) => flag(v?.bubbleSurvivor), fromPlayer: (p) => flag(p.bubbleSurvivor) },
  { key: 'rebuiltAfterHousingBubble', fromRecord: (v) => flag(v?.rebuiltAfterHousingBubble), fromPlayer: (p) => flag(p.rebuiltAfterHousingBubble) },
  { key: 'foreclosureNoSecondLoan', fromRecord: (v) => flag(v?.foreclosureNoSecondLoan), fromPlayer: (p) => flag(p.foreclosureNoSecondLoan) },
  { key: 'housingBubbleEnded', fromRecord: (v) => flag(v?.housingBubbleEnded), fromPlayer: (p) => flag(p.housingBubbleEnded) },
  { key: 'soldBuildingsDuringHousingBubble', fromRecord: (v) => nonNegative(v?.soldBuildingsDuringHousingBubble), fromPlayer: (p) => nonNegative(p.soldBuildingsDuringHousingBubble) },
  { key: 'boughtDuringHousingBubble', fromRecord: (v) => flag(v?.boughtDuringHousingBubble), fromPlayer: (p) => flag(p.boughtDuringHousingBubble) },
  { key: 'airportOwnedDuringStrike', fromRecord: (v) => flag(v?.airportOwnedDuringStrike), fromPlayer: (p) => flag(p.airportOwnedDuringStrike) },
  { key: 'nonAirportRentDuringStrike', fromRecord: (v) => flag(v?.nonAirportRentDuringStrike), fromPlayer: (p) => flag(p.nonAirportRentDuringStrike) },
  { key: 'tradesDuringCombo', fromRecord: (v) => nonNegative(v?.tradesDuringCombo), fromPlayer: (p) => nonNegative(p.tradesDuringCombo) },
  { key: 'groupTherapyTrade', fromRecord: (v) => flag(v?.groupTherapyTrade), fromPlayer: (p) => flag(p.groupTherapyTrade) },
  { key: 'unanimousVote', fromRecord: (v) => flag(v?.unanimousVote), fromPlayer: (p) => flag(p.unanimousVote) },
  { key: 'publicEnemy', fromRecord: (v) => flag(v?.publicEnemy), fromPlayer: (p) => flag(p.publicEnemy) },
  { key: 'compromisedCouncil', fromRecord: (v) => flag(v?.compromisedCouncil), fromPlayer: (p) => flag(p.compromisedCouncil) },
  { key: 'coalitionTrade', fromRecord: (v) => flag(v?.coalitionTrade), fromPlayer: (p) => flag(p.coalitionTrade) },
  { key: 'bailoutReceived', fromRecord: (v) => flag(v?.bailoutReceived), fromPlayer: (p) => flag(p.bailoutReceived) },
  { key: 'moralHazard', fromRecord: (v) => flag(v?.moralHazard), fromPlayer: (p) => flag(p.moralHazard) },
  { key: 'treasureCardsSeen', fromRecord: (v) => nonNegative(v?.treasureCardsSeen), fromPlayer: (p) => setSize(p.treasureCardsSeen) },
  {
    key: 'treasureCardsSeenList',
    fromRecord: (v) => (Array.isArray(v?.treasureCardsSeenList) ? v.treasureCardsSeenList.slice(0, 32).map((value) => String(value).slice(0, 160)) : []),
    fromPlayer: (p) => (p.treasureCardsSeen instanceof Set ? [...p.treasureCardsSeen].slice(0, 32) : []),
  },
  { key: 'underdogAtHalfway', fromRecord: (v) => flag(v?.underdogAtHalfway), fromPlayer: (p) => flag(p.underdogAtHalfway) },
  { key: 'oneMoreTurn', fromRecord: (v) => flag(v?.oneMoreTurn), fromPlayer: (p) => flag(p.oneMoreTurn) },
  { key: 'moveCount', fromRecord: (v) => nonNegative(v?.moveCount), fromPlayer: (p) => nonNegative(p.moveCount) },
  { key: 'hiddenMovementSequence', fromRecord: (v) => flag(v?.hiddenMovementSequence), fromPlayer: (p) => flag(p.hiddenMovementSequence) },
];

// Build one participant from a record-shaped object (matchStore input).
export function sanitizeParticipant(participant) {
  const result = {};
  PARTICIPANT_FIELDS.forEach((field) => {
    result[field.key] = field.fromRecord(participant);
  });
  return result;
}

// Build one participant from a live player (accountStore input).
export function participantFromPlayer(player, context) {
  const result = {};
  PARTICIPANT_FIELDS.forEach((field) => {
    result[field.key] = field.fromPlayer(player, context);
  });
  return result;
}
