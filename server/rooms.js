// Seats, tables, and the table registry. gameLogic.js imports the classes
// from here and re-exports RoomManager/Room so every existing consumer
// (server.js and the room suites) keeps importing from './gameLogic.js'.
// GameState is imported circularly and only ever used at call time inside
// the Room constructor, which is safe for ES module live bindings.
import crypto from 'crypto';
import { randomInt } from './random.js';
import { START_TILE_INDEX } from './gameData.js';
import {
  DEFAULT_ROOM_SETTINGS,
  LEGACY_SCALED_SETTINGS,
  ROOM_BOT_PERSONALITIES,
  ROOM_FLAG_TRUE_VALUES,
  ROOM_SETTING_NORMALIZERS,
  SETTING_REJECTED
} from './roomSettings.js';
import { resolveFreeAppearanceColor } from './appearanceApi.js';
import { GameState } from './gameLogic.js';

function createRoomCode() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += alphabet.charAt(randomInt(0, alphabet.length - 1));
  }
  return code;
}

function safeNickname(nickname) {
  const safe = typeof nickname === 'string' ? nickname.trim().slice(0, 24) : '';
  return safe || 'Player';
}

function safeSeatColor(color) {
  if (typeof color !== 'string') return '#35a653';
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return '#35a653';
  return color;
}

function seatPersonality(personality) {
  if (ROOM_BOT_PERSONALITIES.includes(personality)) return personality;
  return 'survivor';
}

class Player {
  constructor({ clientId, socketId, nickname, color, avatarGrid = null, accountId = null, isHost = false, isBot = false, personality = 'survivor' }) {
    this.id = crypto.randomUUID();
    this.clientId = clientId || this.id;
    this.socketId = socketId;
    this.nickname = safeNickname(nickname);
    this.color = safeSeatColor(color);
    this.avatarGrid = Array.isArray(avatarGrid) ? avatarGrid : null;
    this.accountId = accountId || null;
    this.isHost = isHost;
    this.isBot = isBot;
    this.personality = seatPersonality(personality);
    this.cash = DEFAULT_ROOM_SETTINGS.startingCash;
    this.position = START_TILE_INDEX;
    this.resetTableState();
  }

  // The full per-seat game baseline, written as plain field assignments so
  // constructing (and re-constructing) a seat is one straight-line pass.
  resetTableState() {
    this.properties = [];
    this.inJail = false;
    this.jailTurns = 0;
    this.jailFreeCards = 0;
    this.bankLoan = null;
    this.casinoNet = 0;
    this.casinoLedger = [];
    this.casinoMaxStake = 0;
    this.casinoTotalStaked = 0;
    this.casinoAllIn = false;
    this.casinoOneDollar = false;
    this.casinoBetsThisRound = 0;
    this.marketPositions = {};
    this.marketTrades = 0;
    this.marketActionsThisTurn = 0;
    this.crisisMarketBuys = {};
    this.crisisMarketProfit = false;
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
    this.disconnected = false;
    this.ready = false;
  }
}

class Room {
  constructor(hostPlayer, { roomName = 'AFTER HOURS', visibility = 'public', roomCode = '' } = {}) {
    this.roomCode = roomCode || createRoomCode();
    this.roomName = roomName;
    this.visibility = visibility;
    this.statsRecorded = false;
    this.hostId = hostPlayer.id;
    this.settings = { ...DEFAULT_ROOM_SETTINGS };
    this.game = new GameState(this.settings);
    this.game.addPlayer(hostPlayer);
  }

  addOrReconnectPlayer(playerInfo) {
    const existing = this.game.getPlayerByClient(playerInfo.clientId);
    if (existing) return this.reconnectPlayer(existing, playerInfo);
    return this.seatNewPlayer(playerInfo);
  }

  reconnectPlayer(existing, playerInfo) {
    existing.socketId = playerInfo.socketId;
    existing.disconnected = false;
    this.refreshReconnectNickname(existing, playerInfo.nickname);
    this.refreshReconnectColor(existing, playerInfo.color);
    this.refreshReconnectAvatarGrid(existing, playerInfo.avatarGrid);
    if (playerInfo.accountId) existing.accountId = playerInfo.accountId;
    return { success: true, player: existing };
  }

  refreshReconnectNickname(player, nickname) {
    if (typeof nickname !== 'string') return;
    const safeNickname = nickname.trim().slice(0, 24);
    if (safeNickname) player.nickname = safeNickname;
  }

  refreshReconnectColor(player, color) {
    if (typeof color !== 'string') return;
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return;
    player.color = resolveFreeAppearanceColor(this.game.players, color, player);
  }

  refreshReconnectAvatarGrid(player, avatarGrid) {
    if (avatarGrid === null || Array.isArray(avatarGrid)) player.avatarGrid = avatarGrid;
  }

  seatNewPlayer(playerInfo) {
    if (this.game.started) {
      return { success: false, error: 'Game is already in progress.' };
    }
    if (!this.game.canJoin()) {
      return { success: false, error: 'Room is full.' };
    }
    const player = new Player(playerInfo);
    player.color = resolveFreeAppearanceColor(this.game.players, player.color, player);
    this.game.addPlayer(player);
    return { success: true, player };
  }

  // Public browse, disconnect GC, and stale-code reclaim share this single
  // liveness check: bots and ghost seats must not count as humans.
  hasConnectedHumans() {
    return this.game.players.some(player => !player.isBot && !player.disconnected);
  }

  getPlayerBySocket(socketId) {
    return this.game.getPlayerBySocket(socketId);
  }

  getPlayerById(id) {
    return this.game.getPlayerById(id);
  }

  setRoomSetting(key, value) {
    if (this.game.started) {
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(this.settings, key)) {
      return;
    }
    if (LEGACY_SCALED_SETTINGS.includes(key)) {
      return;
    }
    const normalizer = ROOM_SETTING_NORMALIZERS[key];
    const nextValue = normalizer ? normalizer(value, this) : this.defaultRoomSettingValue(key, value);
    if (nextValue === SETTING_REJECTED) {
      return;
    }
    this.settings[key] = nextValue;
    this.game.settings[key] = nextValue;
    this.applyRoomSettingSideEffect(key, nextValue);
  }

  // Generic fallback for keys the table does not specialise: boolean flags
  // parse the four truthy spellings, strings lose their edges, and other
  // types are stored exactly as received.
  defaultRoomSettingValue(key, value) {
    if (typeof this.settings[key] === 'boolean') {
      return ROOM_FLAG_TRUE_VALUES.includes(value);
    }
    if (typeof value === 'string') {
      return value.trim();
    }
    return value;
  }

  applyRoomSettingSideEffect(key, value) {
    if (key !== 'startingCash') {
      return;
    }
    this.game.players.forEach(player => {
      player.cash = Number(value);
    });
  }

  startGame() {
    this.ensureBots();
    const result = this.game.startGame();
    if (result?.success) this.statsRecorded = false;
    return result;
  }

  ensureBots() {
    const required = Math.max(0, Math.min(this.settings.maxPlayers - 1, Number(this.settings.bots) || 0));
    const existingBots = this.game.players.filter(player => player.isBot);
    if (existingBots.length > required) {
      existingBots.slice(required).forEach(bot => {
        this.game.removePlayerByClient(bot.clientId);
      });
    }
    const botCount = Math.min(existingBots.length, required);
    const colors = ['#286ea1', '#35a653', '#d9a62f'];
    for (let index = botCount; index < required; index += 1) {
      const bot = new Player({
        clientId: `bot-${this.roomCode}-${index + 1}`,
        nickname: `BOT ${index + 1}`,
        color: colors[index % colors.length],
        isBot: true,
        personality: this.settings.botPersonality
      });
      this.game.addPlayer(bot);
    }
  }

  getBankLoanOffer(socketId) {
    return this.game.getBankLoanOffer(this.game.getPlayerBySocket(socketId));
  }

  getRoomSummary() {
    // Legacy clients may still send these fields; the server owns scaling now,
    // so they never leave the server side of the wire.
    const publicSettings = { ...this.settings };
    delete publicSettings.globalEventDuration;
    delete publicSettings.globalEventMax;
    return {
      // Public tables are discovered directly; only private tables expose an
      // invite code in the client-facing room projection.
      roomCode: this.visibility === 'private' ? this.roomCode : null,
      roomName: this.roomName,
      visibility: this.visibility,
      capacity: this.settings.maxPlayers,
      hostId: this.hostId,
      settings: publicSettings,
      players: this.game.players.map(player => this.summarySeat(player)),
      started: this.game.started,
      vacationPool: this.game.vacationPool
    };
  }

  summarySeat(player) {
    return {
      id: player.id,
      clientId: player.clientId,
      nickname: player.nickname,
      color: player.color,
      cash: player.cash,
      position: player.position,
      inJail: player.inJail,
      jailTurns: player.jailTurns || 0,
      bankrupt: player.bankrupt,
      disconnected: player.disconnected,
      isHost: player.isHost,
      ready: player.ready,
      isBot: player.isBot,
      accountId: player.accountId || null,
      avatarGrid: player.avatarGrid || null
    };
  }

  getDirectorySummary() {
    const active = this.game.players.filter(player => !player.disconnected && !player.bankrupt);
    const started = this.game.started;
    return {
      code: this.roomCode,
      name: this.roomName,
      seats: active.length,
      cap: this.settings.maxPlayers,
      bank: `$${Number(this.settings.startingCash).toLocaleString()}`,
      state: started ? 'live' : 'open',
      visibility: this.visibility,
      note: started ? 'round live' : 'waiting for players'
    };
  }
}

// Room methods that forward a socket-keyed action to the game verbatim are
// installed as generated pass-throughs; only getBankLoanOffer, which maps
// the socket to a player first, stays a hand-written method above.
const GAME_PASSTHROUGHS = [
  'rollDice',
  'purchaseProperty',
  'declineProperty',
  'placeAuctionBid',
  'passAuction',
  'manageProperty',
  'proposeTrade',
  'respondToTrade',
  'proposePlayerContract',
  'respondPlayerContract',
  'repayPlayerContract',
  'endTurn',
  'payJailFine',
  'useJailFree',
  'takeBankLoan',
  'repayBankLoan',
  'placeCasinoBet',
  'tradeMarket',
  'runBotAction',
  'voteGlobalEvent',
  'declareBankruptcy'
];

GAME_PASSTHROUGHS.forEach(method => {
  Room.prototype[method] = function gamePassThrough(...args) {
    return this.game[method](...args);
  };
});

class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.socketRoom = new Map();
  }

  createRoom(hostInfo) {
    const player = new Player({ ...hostInfo, isHost: true });
    const roomCode = hostInfo.roomCode || this.reserveRoomCode();
    const room = new Room(player, { roomName: hostInfo.roomName, visibility: hostInfo.visibility, roomCode });
    player.color = resolveFreeAppearanceColor(room.game.players, player.color, player);
    this.rooms.set(room.roomCode, room);
    this.socketRoom.set(hostInfo.socketId, room);
    return room;
  }

  // Generated codes must never silently overwrite an existing room entry.
  reserveRoomCode() {
    let roomCode;
    do {
      roomCode = createRoomCode();
    } while (this.rooms.has(roomCode));
    return roomCode;
  }

  getRoom(roomCode) {
    if (!roomCode) return null;
    return this.rooms.get(String(roomCode).toUpperCase()) || null;
  }

  getRoomBySocket(socketId) {
    return this.socketRoom.get(socketId) || null;
  }

  restoreConnection(clientId, socketId) {
    const room = this.findLiveRoomFor(clientId) || this.findRoomFor(clientId);
    if (!room) return null;
    const player = room.game.getPlayerByClient(clientId);
    if (!player) return null;
    player.socketId = socketId;
    player.disconnected = false;
    this.socketRoom.set(socketId, room);
    return room;
  }

  findLiveRoomFor(clientId) {
    return [...this.rooms.values()].find(roomItem => {
      const player = roomItem.game.getPlayerByClient(clientId);
      if (!player) return false;
      return !player.disconnected;
    });
  }

  findRoomFor(clientId) {
    return [...this.rooms.values()].find(roomItem => roomItem.game.getPlayerByClient(clientId));
  }

  disconnectPlayer(socketId) {
    const room = this.getRoomBySocket(socketId);
    if (!room) return null;
    this.socketRoom.delete(socketId);
    return room;
  }

  getRoomByClient(clientId) {
    if (!clientId) return null;
    return [...this.rooms.values()].find(roomItem => roomItem.game.getPlayerByClient(clientId)) || null;
  }

  listPublicRooms() {
    return [...this.rooms.values()]
      .filter(room => room.visibility === 'public' && room.hasConnectedHumans())
      .map(room => room.getDirectorySummary());
  }

  leaveRoomByClient(clientId, socketId) {
    const room = this.getRoomByClient(clientId);
    if (!room) return null;
    const player = room.game.getPlayerByClient(clientId);
    if (!player) return null;
    if (socketId) {
      this.socketRoom.delete(socketId);
    }
    this.releaseSeat(room.game, player);
    if (room.game.players.length === 0) {
      this.rooms.delete(room.roomCode);
    }
    return room;
  }

  // A real leave releases the seat in the lobby AND mid-game, so the room
  // can drain to empty and the GC can reclaim it.
  releaseSeat(game, player) {
    const playerId = player.id;
    const wasCurrentTurn = this.wasCurrentTurnSeat(game, playerId);
    game.removePlayerByClient(player.clientId);
    if (game.started) this.clearStartedGameSeat(game, playerId, wasCurrentTurn);
  }

  wasCurrentTurnSeat(game, playerId) {
    if (!game.started) return false;
    return game.currentPlayerId === playerId;
  }

  clearStartedGameSeat(game, playerId, wasCurrentTurn) {
    if (Array.isArray(game.turnOrder)) {
      game.turnOrder = game.turnOrder.filter(id => id !== playerId);
    }
    this.clearPendingSeatObligations(game, playerId);
    this.revokeAuctionLead(game, playerId);
    if (!wasCurrentTurn) return;
    // nextTurn() treats an unknown current id as "before the first seat"
    // and hands the dice to the next surviving player in turn order.
    game.currentPlayerId = null;
    game.nextTurn();
  }

  clearPendingSeatObligations(game, playerId) {
    if (game.pendingPurchaseOffer?.playerId === playerId) game.pendingPurchaseOffer = null;
    if (this.pendingPaymentFrom(game, playerId)) {
      game.pendingPayment = null;
      game.pendingPaymentTurnOptions = null;
    }
    if (this.pendingTradeFrom(game, playerId)) game.pendingTrade = null;
    if (this.pendingContractFrom(game, playerId)) game.pendingPlayerContract = null;
  }

  pendingPaymentFrom(game, playerId) {
    const pending = game.pendingPayment;
    if (!pending) return false;
    return pending.playerId === playerId;
  }

  pendingTradeFrom(game, playerId) {
    const trade = game.pendingTrade;
    if (!trade) return false;
    if (trade.fromPlayerId === playerId) return true;
    return trade.toPlayerId === playerId;
  }

  pendingContractFrom(game, playerId) {
    const contract = game.pendingPlayerContract;
    if (!contract) return false;
    if (contract.fromPlayerId === playerId) return true;
    return contract.toPlayerId === playerId;
  }

  revokeAuctionLead(game, playerId) {
    const auction = game.auction;
    if (!auction) return;
    if (!auction.active) return;
    if (auction.highestBidderId !== playerId) return;
    auction.highestBidderId = null;
  }
}

export { Player, Room, RoomManager };
