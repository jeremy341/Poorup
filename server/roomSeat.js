// A seat at the table: the Player record every human and bot occupies, and the rule that keeps a connected human as host.
// Rooms and the room registry that use these live in rooms.js and roomManager.js.
import crypto from 'crypto';
import { START_TILE_INDEX } from './gameData.js';
import { DEFAULT_ROOM_SETTINGS } from './roomSettings.js';
import { cleanPlayerName } from './nicknamePolicy.js';
import { normalizeClientId } from './roomSetup.js';

// How long a lobby seat may stay disconnected before a newcomer can take its place. Mirrors the 120 s reconnect grace in socketRuntime.js.
export const LOBBY_ABSENT_SEAT_MS = 120_000;

export function safeNickname(nickname) {
  const safe = cleanPlayerName(nickname, 24);
  return safe || 'Player';
}

function safeSeatColor(color) {
  if (typeof color !== 'string') return '#35a653';
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return '#35a653';
  return color;
}

function resetPlayerMarketState(player) {
  player.marketPositions = {};
  player.marginBalance = 0;
  player.marginMaintenance = 0;
  player.marginCollateral = 0;
  player.marginPositions = {};
  player.shortPositions = {};
  player.shortDefaultDebt = 0;
  player.shortOpeningFees = {};
  player.optionPositions = [];
  player.reservedCash = 0;
  player.marketTrades = 0;
  player.marketActionsThisTurn = 0;
  player.crisisMarketBuys = {};
  player.crisisMarketProfit = false;
}

export class Player {
  constructor({ clientId, socketId, nickname, color, avatarGrid = null, accountId = null, isHost = false, isBot = false }) {
    this.id = crypto.randomUUID();
    this.clientId = normalizeClientId(clientId) || this.id;
    this.socketId = socketId;
    this.nickname = safeNickname(nickname);
    this.color = safeSeatColor(color);
    this.avatarGrid = Array.isArray(avatarGrid) ? avatarGrid : null;
    this.accountId = accountId || null;
    this.isHost = isHost;
    this.isBot = isBot;
    this.cash = DEFAULT_ROOM_SETTINGS.startingCash;
    this.position = START_TILE_INDEX;
    this.resetTableState();
  }

  // The full per-seat game baseline, written as plain field assignments so
  // constructing (and re-constructing) a seat is one straight-line pass.
  resetTableState() {
    this.presence = { state: 'active', inactiveSince: null, inactiveUntil: null };
    this.properties = [];
    this.inJail = false;
    this.jailTurns = 0;
    this.jailFreeCards = 0;
    this.jailFreeOrigins = [];
    this.items = [];
    this.bankLoan = null;
    this.casinoNet = 0;
    this.casinoLedger = [];
    this.casinoMaxStake = 0;
    this.casinoTotalStaked = 0;
    this.casinoAllIn = false;
    this.casinoOneDollar = false;
    this.casinoBetsThisRound = 0;
    resetPlayerMarketState(this);
    this.playerContractIds = [];
    this.auctionWins = 0;
    this.rentCollected = 0;
    this.globalEventsExperienced = 0;
    this.globalEventsSurvived = 0;
    this.fullGroups = new Set();
    this.airportVisits = new Set();
    this.taxTilesVisited = new Set();
    this.rentPayerIds = new Set();
    this.rentPayersThisRound = new Set();
    this.maxRentPayersInRound = 0;
    this.auctionUnderListWins = 0;
    this.loanWarningSeen = false;
    this.badIdeaLoan = false;
    this.prisonBreak = false;
    this.bankLoanCount = 0;
    this.boughtDuringHousingBubble = false;
    this.soldBuildingsDuringHousingBubble = 0;
    this.bubbleSurvivor = false;
    this.rebuiltAfterHousingBubble = false;
    this.foreclosureNoSecondLoan = false;
    this.housingBubbleEnded = false;
    this.airportOwnedDuringStrike = false;
    this.nonAirportRentDuringStrike = false;
    this.tradesDuringCombo = 0;
    this.groupTherapyTrade = false;
    this.unanimousVote = false;
    this.publicEnemy = false;
    this.compromisedCouncil = false;
    this.coalitionTrade = false;
    this.lastVoteChoice = null;
    this.bailoutReceived = false;
    this.moralHazard = false;
    this.zeroCashReached = false;
    this.collateralLost = false;
    this.comboExperienced = false;
    this.buildActionsThisTurn = 0;
    this.evenBuilds = 0;
    this.councilWins = 0;
    this.publicWorksBuilds = 0;
    this.cardDraws = { surprise: 0, treasure: 0 };
    this.treasureCardsSeen = new Set();
    this.underdogAtHalfway = false;
    this.oneMoreTurn = false;
    this.taxAuditCount = 0;
    this.moveCount = 0;
    this.hiddenMovementSequence = false;
    this.bankrupt = false;
    this.spectating = false;
    this.disconnected = false;
    this.disconnectDeadline = 0;
    this.ready = false;
  }
}

// The host seat belongs to a connected, solvent human: bots never host, and a bankrupt host keeps the seat only while no solvent human
// is connected. Every seat change that can leave the room hostless calls this, so a lobby or rematch never waits on a seat that cannot start it.
export function ensureRoomHost(room, excludedPlayerId = null) {
  const players = room.game.players;
  const connectedHuman = player => player.id !== excludedPlayerId && !player.isBot && !player.disconnected;
  const solvent = player => connectedHuman(player) && !player.bankrupt && !player.inDebt;
  const current = players.find(player => player.id === room.hostId);
  if (!current || !solvent(current)) {
    const keptSpectator = current && connectedHuman(current) && current.bankrupt ? current : null;
    const replacement = players.find(solvent)
      || keptSpectator
      || players.find(player => connectedHuman(player) && player.bankrupt);
    room.hostId = replacement?.id || null;
  }
  players.forEach(player => { player.isHost = player.id === room.hostId; });
  return room.hostId;
}
