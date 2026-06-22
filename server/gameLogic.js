const DEFAULT_ROOM_SETTINGS = {
  maxPlayers: 4,
  doubleRent: false,
  vacationCash: true,
  auction: true,
  noRentWhileInPrison: false,
  mortgage: true,
  evenBuild: true,
  randomizePlayerOrder: false,
  startingCash: 1500
};

const AUCTION_DURATION_MS = 5000;
const AUCTION_BID_COOLDOWN_MS = 300;
const PROPERTY_HOUSE_COST_BY_GROUP = {
  Brown: 50,
  'Light Blue': 50,
  Pink: 100,
  Orange: 100,
  Red: 150,
  Yellow: 150,
  Green: 200,
  'Dark Blue': 200
};
const PROPERTY_RENT_MULTIPLIERS = [1, 5, 15, 45, 80, 125];
const RAILROAD_RENT = [25, 50, 100, 200];
const JAIL_FINE = 50;
const JAIL_MAX_TURNS = 3;

const DEFAULT_TILES = [
  { index: 0, name: 'Start', type: 'start' },
  { index: 1, name: 'Salvador', type: 'property', group: 'Brown', price: 60, rent: 10, color: '#92400e' },
  { index: 2, name: 'Treasure', type: 'chance' },
  { index: 3, name: 'Rio', type: 'property', group: 'Brown', price: 60, rent: 10, color: '#92400e' },
  { index: 4, name: 'Earnings Tax', type: 'tax', amount: 200 },
  { index: 5, name: 'ACC Airport', type: 'railroad', price: 200 },
  { index: 6, name: 'Accra', type: 'property', group: 'Light Blue', price: 100, rent: 14, color: '#38bdf8' },
  { index: 7, name: 'Surprise?', type: 'chance' },
  { index: 8, name: 'Tema', type: 'property', group: 'Light Blue', price: 100, rent: 14, color: '#38bdf8' },
  { index: 9, name: 'Kumasi', type: 'property', group: 'Light Blue', price: 120, rent: 16, color: '#38bdf8' },
  { index: 10, name: 'Passing By', type: 'jail' },
  { index: 11, name: 'Pattaya', type: 'property', group: 'Pink', price: 140, rent: 10, color: '#ec4899' },
  { index: 12, name: 'Electric Company', type: 'utility', price: 150 },
  { index: 13, name: 'Chiang Mai', type: 'property', group: 'Pink', price: 140, rent: 12, color: '#ec4899' },
  { index: 14, name: 'Bangkok', type: 'property', group: 'Pink', price: 160, rent: 14, color: '#ec4899' },
  { index: 15, name: 'BKK Airport', type: 'railroad', price: 200 },
  { index: 16, name: 'Kyoto', type: 'property', group: 'Orange', price: 180, rent: 14, color: '#f97316' },
  { index: 17, name: 'Treasure', type: 'chance' },
  { index: 18, name: 'Osaka', type: 'property', group: 'Orange', price: 180, rent: 14, color: '#f97316' },
  { index: 19, name: 'Tokyo', type: 'property', group: 'Orange', price: 200, rent: 16, color: '#f97316' },
  { index: 20, name: 'Vacation', type: 'vacation' },
  { index: 21, name: 'Eindhoven', type: 'property', group: 'Red', price: 220, rent: 18, color: '#ef4444' },
  { index: 22, name: 'Surprise?', type: 'chance' },
  { index: 23, name: 'Rotterdam', type: 'property', group: 'Red', price: 220, rent: 18, color: '#ef4444' },
  { index: 24, name: 'Amsterdam', type: 'property', group: 'Red', price: 240, rent: 20, color: '#ef4444' },
  { index: 25, name: 'AMS Airport', type: 'railroad', price: 200 },
  { index: 26, name: 'Calgary', type: 'property', group: 'Yellow', price: 260, rent: 22, color: '#eab308' },
  { index: 27, name: 'Vancouver', type: 'property', group: 'Yellow', price: 260, rent: 22, color: '#eab308' },
  { index: 28, name: 'Water Company', type: 'utility', price: 150 },
  { index: 29, name: 'Toronto', type: 'property', group: 'Yellow', price: 280, rent: 24, color: '#eab308' },
  { index: 30, name: 'Go to Prison', type: 'goToJail' },
  { index: 31, name: 'Bern', type: 'property', group: 'Green', price: 300, rent: 26, color: '#22c55e' },
  { index: 32, name: 'Geneva', type: 'property', group: 'Green', price: 300, rent: 26, color: '#22c55e' },
  { index: 33, name: 'Treasure', type: 'chance' },
  { index: 34, name: 'Zurich', type: 'property', group: 'Green', price: 320, rent: 28, color: '#22c55e' },
  { index: 35, name: 'MB Airport', type: 'railroad', price: 200 },
  { index: 36, name: 'Surprise?', type: 'chance' },
  { index: 37, name: 'Downtown', type: 'property', group: 'Dark Blue', price: 350, rent: 35, color: '#1d4ed8' },
  { index: 38, name: 'Premium Tax', type: 'tax', amount: 100 },
  { index: 39, name: 'Marina Bay', type: 'property', group: 'Dark Blue', price: 400, rent: 50, color: '#1d4ed8' }
];

const CARD_DECK = [
  { text: 'Advance to Start and collect $200', action: 'collectStart' },
  { text: 'Pay $100 for renovation', action: 'pay', amount: 100 },
  { text: 'Collect $150 from bank', action: 'collect', amount: 150 },
  { text: 'Go to Vacation', action: 'move', tileIndex: 20 },
  { text: 'Go directly to Jail', action: 'goToJail' },
  { text: 'Receive $100 from each player', action: 'collectFromEach', amount: 100 }
];

function randomInt(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function createRoomCode() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += alphabet.charAt(Math.floor(Math.random() * alphabet.length));
  }
  return code;
}

function rollDice() {
  return [randomInt(1, 6), randomInt(1, 6)];
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = Math.floor(Math.random() * (i + 1));
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function cloneTiles() {
  return DEFAULT_TILES.map(tile => ({ ...tile, ownerId: null, mortgaged: false, houseCount: 0 }));
}

class Player {
  constructor({ clientId, socketId, nickname, color, isHost = false, isBot = false }) {
    this.id = `${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
    this.clientId = clientId || this.id;
    this.socketId = socketId;
    const safeNickname = typeof nickname === 'string' ? nickname.trim().slice(0, 24) : '';
    const safeColor = typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#84cc16';
    this.nickname = safeNickname || 'Player';
    this.color = safeColor;
    this.isHost = isHost;
    this.isBot = isBot;
    this.cash = DEFAULT_ROOM_SETTINGS.startingCash;
    this.position = 0;
    this.properties = [];
    this.inJail = false;
    this.jailTurns = 0;
    this.bankrupt = false;
    this.disconnected = false;
    this.ready = false;
  }
}

class AuctionState {
  constructor(propertyTile, startingPlayerId) {
    this.propertyTile = propertyTile;
    this.active = true;
    this.highestBid = 0;
    this.highestBidderId = null;
    this.participants = [];
    this.startingPlayerId = startingPlayerId;
    this.startedAt = Date.now();
    this.endsAt = Date.now() + AUCTION_DURATION_MS;
    this.cooldownUntil = 0;
    this.lastBidAt = 0;
  }
}

class GameState {
  constructor(settings) {
    this.settings = { ...DEFAULT_ROOM_SETTINGS, ...settings };
    this.reset();
  }

  reset() {
    this.tiles = cloneTiles();
    this.players = [];
    this.currentPlayerId = null;
    this.lastDice = [0, 0];
    this.hasRolled = false;
    this.consecutiveDoubles = 0;
    this.extraRollPending = false;
    this.turnAllowsExtraRoll = false;
    this.pendingPurchaseOffer = null;
    this.started = false;
    this.feed = [];
    this.auction = null;
    this.pendingTrade = null;
    this.pendingPayment = null;
    this.pendingPaymentTurnOptions = null;
    this.lastWinner = null;
    this.vacationPool = 0;
    this.cardDeck = [...CARD_DECK];
  }

  addPlayer(player) {
    player.cash = this.settings.startingCash;
    player.position = 0;
    player.properties = [];
    player.inJail = false;
    player.jailTurns = 0;
    player.bankrupt = false;
    player.disconnected = false;
    player.ready = false;
    this.players.push(player);
    this.feedMessage(`${player.nickname} joined the room.`);
    return player;
  }

  resetForNewGame() {
    this.tiles = cloneTiles();
    this.currentPlayerId = null;
    this.turnOrder = [];
    this.lastDice = [0, 0];
    this.hasRolled = false;
    this.consecutiveDoubles = 0;
    this.extraRollPending = false;
    this.turnAllowsExtraRoll = false;
    this.pendingPurchaseOffer = null;
    this.started = false;
    this.feed = [];
    this.auction = null;
    this.pendingTrade = null;
    this.pendingPayment = null;
    this.pendingPaymentTurnOptions = null;
    this.lastWinner = null;
    this.vacationPool = 0;
    this.cardDeck = [...CARD_DECK];

    this.players.forEach(player => {
      player.cash = this.settings.startingCash;
      player.position = 0;
      player.properties = [];
      player.inJail = false;
      player.jailTurns = 0;
      player.bankrupt = false;
      player.ready = false;
    });
  }

  removePlayerBySocket(socketId) {
    const index = this.players.findIndex(player => player.socketId === socketId);
    if (index !== -1) {
      this.players.splice(index, 1);
    }
  }

  removePlayerByClient(clientId) {
    const index = this.players.findIndex(player => player.clientId === clientId);
    if (index !== -1) {
      this.players.splice(index, 1);
    }
  }

  getPlayerBySocket(socketId) {
    return this.players.find(player => player.socketId === socketId);
  }

  getPlayerByClient(clientId) {
    return this.players.find(player => player.clientId === clientId);
  }

  getPlayerById(id) {
    return this.players.find(player => player.id === id);
  }

  setPlayerAppearance(socketId, { color, nickname } = {}) {
    const player = this.getPlayerBySocket(socketId);
    if (!player) {
      return { success: false, error: 'Player not found.' };
    }
    if (typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color)) {
      player.color = color;
    }
    if (typeof nickname === 'string' && !this.started) {
      const safeNickname = nickname.trim().slice(0, 24);
      if (safeNickname) {
        player.nickname = safeNickname;
      }
    }
    return { success: true };
  }

  getTile(index) {
    return this.tiles.find(tile => tile.index === index);
  }

  getGroupTiles(group) {
    return this.tiles.filter(tile => tile.group === group && tile.type === 'property');
  }

  getPropertyHouseCost(tile) {
    return PROPERTY_HOUSE_COST_BY_GROUP[tile?.group] || 0;
  }

  getPropertyRent(tile) {
    const baseRent = tile.rent || 0;
    if (tile.mortgaged) {
      return 0;
    }
    if (tile.type === 'property') {
      const level = Math.max(0, Math.min(5, tile.houseCount || 0));
      if (level > 0) {
        return Math.floor(baseRent * PROPERTY_RENT_MULTIPLIERS[level]);
      }
      if (tile.group && this.settings.doubleRent && this.hasFullSet(tile.ownerId, tile.group)) {
        return baseRent * 2;
      }
    }
    if (tile.type === 'utility') {
      const owner = this.getPlayerById(tile.ownerId);
      if (!owner) return baseRent || 20;
      const ownedUtilities = this.tiles.filter(entry => entry.type === 'utility' && entry.ownerId === owner.id).length;
      const diceTotal = Math.max(2, (this.lastDice?.[0] || 0) + (this.lastDice?.[1] || 0));
      return diceTotal * (ownedUtilities >= 2 ? 10 : 4);
    }
    if (tile.type === 'railroad') {
      const owner = this.getPlayerById(tile.ownerId);
      if (!owner) return RAILROAD_RENT[0];
      const ownedRailroads = this.tiles.filter(entry => entry.type === 'railroad' && entry.ownerId === owner.id).length;
      return RAILROAD_RENT[Math.min(Math.max(ownedRailroads, 1), RAILROAD_RENT.length) - 1];
    }
    return baseRent;
  }

  isTradeableTile(tile) {
    if (!tile || !tile.ownerId) return false;
    if (tile.mortgaged) return false;
    return (tile.type === 'property' || tile.type === 'utility' || tile.type === 'railroad') && (tile.houseCount || 0) === 0;
  }

  canBuildOnTile(player, tile) {
    if (!player || !tile || tile.type !== 'property') return false;
    if (tile.ownerId !== player.id || tile.mortgaged) return false;
    if (!this.hasFullSet(player.id, tile.group)) return false;
    const groupTiles = this.getGroupTiles(tile.group).filter(entry => entry.ownerId === player.id);
    if (!groupTiles.length) return false;
    if (groupTiles.some(entry => entry.mortgaged)) return false;
    if (!this.settings.evenBuild) {
      return (tile.houseCount || 0) < 5;
    }
    const houseLevels = groupTiles.map(entry => entry.houseCount || 0);
    const minLevel = Math.min(...houseLevels);
    return (tile.houseCount || 0) === minLevel && (tile.houseCount || 0) < 5;
  }

  canSellFromTile(player, tile) {
    if (!player || !tile || tile.type !== 'property') return false;
    if (tile.ownerId !== player.id) return false;
    const groupTiles = this.getGroupTiles(tile.group).filter(entry => entry.ownerId === player.id);
    if (!groupTiles.length) return false;
    if (!this.settings.evenBuild) {
      return (tile.houseCount || 0) > 0;
    }
    const houseLevels = groupTiles.map(entry => entry.houseCount || 0);
    const maxLevel = Math.max(...houseLevels);
    return (tile.houseCount || 0) === maxLevel && (tile.houseCount || 0) > 0;
  }

  canMortgageTile(player, tile) {
    if (!player || !tile || tile.ownerId !== player.id) return false;
    if (!this.settings.mortgage) return false;
    if (tile.type !== 'property' && tile.type !== 'utility' && tile.type !== 'railroad') return false;
    if ((tile.houseCount || 0) > 0) return false;
    if (tile.mortgaged) return false;
    if (tile.type === 'property') {
      const groupTiles = this.getGroupTiles(tile.group).filter(entry => entry.ownerId === player.id);
      if (groupTiles.some(entry => (entry.houseCount || 0) > 0)) {
        return false;
      }
    }
    return true;
  }

  canUnmortgageTile(player, tile) {
    return Boolean(player && tile && tile.ownerId === player.id && tile.mortgaged);
  }

  applyPropertyOwnershipChange(fromPlayer, toPlayer, tile) {
    tile.ownerId = toPlayer ? toPlayer.id : null;
    tile.mortgaged = false;
    tile.houseCount = 0;
    if (fromPlayer) {
      fromPlayer.properties = fromPlayer.properties.filter(propertyIndex => propertyIndex !== tile.index);
    }
    if (toPlayer) {
      toPlayer.properties.push(tile.index);
    }
  }

  feedMessage(text) {
    this.feed.unshift({ text, timestamp: Date.now() });
    if (this.feed.length > 40) {
      this.feed.length = 40;
    }
  }

  canJoin() {
    if (this.started) {
      return false;
    }
    return this.players.filter(player => !player.isBot && !player.bankrupt && !player.disconnected).length < this.settings.maxPlayers;
  }

  activePlayers() {
    return this.players.filter(player => !player.bankrupt && !player.disconnected);
  }

  nonBankruptPlayers() {
    return this.players.filter(player => !player.bankrupt);
  }

  connectedNonBankruptPlayers() {
    return this.players.filter(player => !player.bankrupt && !player.disconnected);
  }

  configureStartOrder() {
    const active = [...this.players].filter(p => !p.bankrupt && !p.disconnected);
    if (this.settings.randomizePlayerOrder) {
      shuffleArray(active);
    }
    this.turnOrder = active.map(p => p.id);
    this.currentPlayerId = this.turnOrder[0] || null;
    this.hasRolled = false;
  }

  getCurrentPlayer() {
    return this.getPlayerById(this.currentPlayerId);
  }

  startGame() {
    if (this.started) {
      return { success: false, error: 'Game has already started.' };
    }
    if (this.players.filter(player => !player.disconnected).length < 2) {
      return { success: false, error: 'At least two players are required.' };
    }
    this.resetForNewGame();
    this.started = true;
    this.configureStartOrder();
    this.feedMessage('The game begins. Players take turns clockwise.');
    return { success: true };
  }

  rollDice(socketId) {
    const player = this.getPlayerBySocket(socketId);
    if (!player) {
      return { success: false, error: 'Player not found.' };
    }
    if (!this.started) {
      return { success: false, error: 'Game has not started.' };
    }
    if (player.id !== this.currentPlayerId) {
      return { success: false, error: 'It is not your turn.' };
    }
    if (this.pendingPayment?.playerId === player.id) {
      return { success: false, error: 'Settle your debt before rolling.' };
    }
    if (player.inJail) {
      return this.handleJailRoll(player);
    }
    if (this.hasRolled && !this.extraRollPending) {
      return { success: false, error: 'You have already rolled this turn.' };
    }
    const dice = rollDice();
    this.lastDice = dice;
    this.hasRolled = true;
    this.turnAllowsExtraRoll = dice[0] === dice[1];
    this.extraRollPending = this.turnAllowsExtraRoll;
    if (this.turnAllowsExtraRoll) {
      this.consecutiveDoubles += 1;
    } else {
      this.consecutiveDoubles = 0;
    }
    if (this.consecutiveDoubles >= 3) {
      player.position = this.tiles.find(tile => tile.type === 'jail').index;
      player.inJail = true;
      player.jailTurns = 0;
      this.consecutiveDoubles = 0;
      this.turnAllowsExtraRoll = false;
      this.extraRollPending = false;
      this.hasRolled = false;
      this.feedMessage(`${player.nickname} rolled three doubles and was sent to Jail.`);
      this.nextTurn();
      return { success: true };
    }
    const move = dice[0] + dice[1];
    this.feedMessage(`${player.nickname} rolled ${dice[0]} and ${dice[1]} (${move}).`);
    return this.movePlayer(player, move);
  }

  handleJailRoll(player) {
    if (this.hasRolled && !this.extraRollPending) {
      return { success: false, error: 'You have already rolled this turn.' };
    }
    const dice = rollDice();
    this.lastDice = dice;
    this.hasRolled = true;
    this.turnAllowsExtraRoll = false;
    this.extraRollPending = false;
    this.consecutiveDoubles = 0;
    if (dice[0] === dice[1]) {
      player.inJail = false;
      player.jailTurns = 0;
      this.feedMessage(`${player.nickname} rolled doubles and escaped jail!`);
      return this.movePlayer(player, dice[0] + dice[1], { allowExtraRoll: false });
    }
    player.jailTurns = (player.jailTurns || 0) + 1;
    if (player.jailTurns >= JAIL_MAX_TURNS) {
      if (player.cash >= JAIL_FINE) {
        player.cash -= JAIL_FINE;
        player.inJail = false;
        player.jailTurns = 0;
        this.feedMessage(`${player.nickname} paid $${JAIL_FINE} to leave jail after ${JAIL_MAX_TURNS} turns.`);
        return this.movePlayer(player, dice[0] + dice[1], { allowExtraRoll: false });
      }
      this.feedMessage(`${player.nickname} could not pay the jail fine and remains in jail.`);
    } else {
      this.feedMessage(`${player.nickname} failed to roll doubles in jail (turn ${player.jailTurns}/${JAIL_MAX_TURNS}).`);
    }
    this.nextTurn();
    return { success: true, message: 'You remain in jail and the turn has passed.' };
  }

  payJailFine(socketId) {
    const player = this.getPlayerBySocket(socketId);
    if (!player) {
      return { success: false, error: 'Player not found.' };
    }
    if (!this.started) {
      return { success: false, error: 'Game has not started.' };
    }
    if (player.id !== this.currentPlayerId) {
      return { success: false, error: 'It is not your turn.' };
    }
    if (!player.inJail) {
      return { success: false, error: 'You are not in jail.' };
    }
    if (this.hasRolled) {
      return { success: false, error: 'You have already rolled this turn.' };
    }
    if (player.cash < JAIL_FINE) {
      return { success: false, error: `You need $${JAIL_FINE} to pay the jail fine.` };
    }
    player.cash -= JAIL_FINE;
    player.inJail = false;
    player.jailTurns = 0;
    this.feedMessage(`${player.nickname} paid $${JAIL_FINE} to leave jail.`);
    return { success: true, message: 'You left jail. Roll the dice to move.' };
  }

  movePlayer(player, steps, options = {}) {
    const oldPosition = player.position;
    player.position = (player.position + steps) % this.tiles.length;
    if (player.position < oldPosition) {
      player.cash += 200;
      this.feedMessage(`${player.nickname} passed Start and collected $200.`);
    }
    const tile = this.getTile(player.position);
    return this.applyTile(player, tile, options);
  }

  resolveTurnAfterAction({ allowExtraRoll = true } = {}) {
    if (allowExtraRoll && this.turnAllowsExtraRoll) {
      this.extraRollPending = true;
      this.hasRolled = false;
      return { retainedTurn: true };
    }

    this.extraRollPending = false;
    this.turnAllowsExtraRoll = false;
    this.nextTurn();
    return { retainedTurn: false };
  }

  applyTile(player, tile, options = {}) {
    switch (tile.type) {
      case 'start':
        this.feedMessage(`${player.nickname} landed on Start.`);
        this.resolveTurnAfterAction(options);
        return { success: true };
      case 'property':
        return this.handlePropertyTile(player, tile, options);
      case 'tax':
        return this.handleTaxTile(player, tile, options);
      case 'chance':
        return this.handleChanceTile(player, options);
      case 'jail':
        this.feedMessage(`${player.nickname} is visiting Jail.`);
        this.resolveTurnAfterAction(options);
        return { success: true };
      case 'goToJail':
        player.position = this.tiles.find(tileItem => tileItem.type === 'jail').index;
        player.inJail = true;
        player.jailTurns = 0;
        this.feedMessage(`${player.nickname} was sent to Jail.`);
        this.resolveTurnAfterAction({ ...options, allowExtraRoll: false });
        return { success: true };
      case 'vacation':
        return this.handleVacationTile(player, options);
      case 'utility':
        return this.handleUtilityTile(player, tile, options);
      case 'railroad':
        return this.handleRailroadTile(player, tile, options);
      default:
        this.resolveTurnAfterAction(options);
        return { success: true };
    }
  }

  handlePropertyTile(player, tile, options = {}) {
    return this.handleBuyableTile(player, tile, options, 'property');
  }

  handleTaxTile(player, tile, options = {}) {
    const amount = tile.amount || 0;
    if (this.settings.vacationCash) {
      this.chargePlayer(player, null, amount, `${player.nickname} paid $${amount} in tax into Vacation cash.`, options, {
        onPaid: paid => { this.vacationPool += paid; }
      });
    } else {
      this.chargePlayer(player, null, amount, `${player.nickname} paid $${amount} in tax.`, options);
    }
    return { success: true };
  }

  handleVacationTile(player, options = {}) {
    if (!options.skipVacationCollect && this.vacationPool > 0) {
      player.cash += this.vacationPool;
      this.feedMessage(`${player.nickname} collected $${this.vacationPool} from Vacation cash.`);
      this.vacationPool = 0;
    } else {
      this.feedMessage(`${player.nickname} landed on Vacation.`);
    }
    this.resolveTurnAfterAction(options);
    return { success: true };
  }

  handleRailroadTile(player, tile, options = {}) {
    return this.handleBuyableTile(player, tile, options, 'railroad');
  }

  handleBuyableTile(player, tile, options = {}, label = 'property') {
    if (tile.mortgaged) {
      this.feedMessage(`${player.nickname} landed on a mortgaged ${label} and paid no rent.`);
      this.resolveTurnAfterAction(options);
      return { success: true };
    }
    if (tile.ownerId === null) {
      if (player.cash < tile.price) {
        this.feedMessage(`${player.nickname} cannot afford ${tile.name}.`);
        if (this.settings.auction) {
          this.startAuction(tile, player.id);
          return { success: true, auctionStarted: true };
        }
        this.resolveTurnAfterAction(options);
        return { success: true };
      }
      this.pendingPurchaseOffer = { playerId: player.id, tileIndex: tile.index };
      return { success: true, purchaseOffer: { tileIndex: tile.index, name: tile.name, price: tile.price } };
    }
    if (tile.ownerId === player.id) {
      this.feedMessage(`${player.nickname} landed on their own ${label}.`);
      this.resolveTurnAfterAction(options);
      return { success: true };
    }
    const owner = this.getPlayerById(tile.ownerId);
    if (!owner || owner.bankrupt) {
      this.resolveTurnAfterAction(options);
      return { success: true };
    }
    if (owner.inJail && this.settings.noRentWhileInPrison) {
      this.feedMessage(`${player.nickname} landed on ${owner.nickname}'s ${label}, but rent is not collected while the owner is in jail.`);
      this.resolveTurnAfterAction(options);
      return { success: true };
    }
    const rent = this.calculateRent(tile);
    this.chargePlayer(player, owner, rent, `${player.nickname} paid $${rent} rent to ${owner.nickname}.`, options);
    return { success: true };
  }

  handleUtilityTile(player, tile, options = {}) {
    return this.handleBuyableTile(player, tile, options, 'utility');
  }

  handleChanceTile(player, options = {}) {
    const card = this.drawCard();
    this.feedMessage(`${player.nickname} drew a card: ${card.text}`);
    const result = this.applyCard(player, card, options);
    return result || { success: true };
  }

  drawCard() {
    if (this.cardDeck.length === 0) {
      this.cardDeck = [...CARD_DECK];
    }
    const index = randomInt(0, this.cardDeck.length - 1);
    return this.cardDeck.splice(index, 1)[0];
  }

  applyCard(player, card, options = {}) {
    switch (card.action) {
      case 'collectStart':
        player.position = 0;
        player.cash += 200;
        this.feedMessage(`${player.nickname} collected $200 from Start.`);
        break;
      case 'pay':
        this.chargePlayer(player, null, card.amount, `${player.nickname} paid $${card.amount}.`, options);
        return;
      case 'collect':
        player.cash += card.amount;
        this.feedMessage(`${player.nickname} collected $${card.amount}.`);
        break;
      case 'move': {
        const destTile = this.getTile(card.tileIndex);
        if (!destTile) break;
        player.position = card.tileIndex;
        this.feedMessage(`${player.nickname} moved to ${destTile.name}.`);
        const moveOptions = destTile.type === 'vacation'
          ? { ...options, skipVacationCollect: true }
          : options;
        return this.applyTile(player, destTile, moveOptions);
      }
      case 'goToJail':
        player.position = this.tiles.find(tile => tile.type === 'jail').index;
        player.inJail = true;
        player.jailTurns = 0;
        this.feedMessage(`${player.nickname} was sent to Jail by a card.`);
        this.resolveTurnAfterAction({ ...options, allowExtraRoll: false });
        return;
      case 'collectFromEach': {
        const alive = this.activePlayers();
        alive.forEach(other => {
          if (other.id !== player.id) {
            this.chargePlayer(other, player, card.amount, `${other.nickname} paid $${card.amount} to ${player.nickname}.`, options);
          }
        });
        break;
      }
      default:
        break;
    }
    this.resolveTurnAfterAction(options);
  }

  nextTurn() {
    this.pendingPurchaseOffer = null;
    this.extraRollPending = false;
    this.turnAllowsExtraRoll = false;
    const nonBankrupt = this.nonBankruptPlayers();
    if (nonBankrupt.length <= 1) {
      this.endGame();
      return;
    }
    const currentIndex = this.turnOrder.indexOf(this.currentPlayerId);
    let nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % this.turnOrder.length;
    let nextPlayer = this.getPlayerById(this.turnOrder[nextIndex]);
    let attempts = 0;
    while (nextPlayer && (nextPlayer.bankrupt || nextPlayer.disconnected) && attempts < this.turnOrder.length) {
      nextIndex = (nextIndex + 1) % this.turnOrder.length;
      nextPlayer = this.getPlayerById(this.turnOrder[nextIndex]);
      attempts += 1;
    }
    if (!nextPlayer || nextPlayer.bankrupt || nextPlayer.disconnected) {
      const waiting = this.getPlayerById(this.currentPlayerId);
      if (waiting && !waiting.bankrupt) {
        this.feedMessage(`Waiting for ${waiting.nickname} to reconnect…`);
      }
      return;
    }
    this.currentPlayerId = nextPlayer.id;
    this.hasRolled = false;
    this.feedMessage(`${nextPlayer.nickname}'s turn.`);
  }

  calculateRent(tile) {
    return this.getPropertyRent(tile);
  }

  hasFullSet(ownerId, group) {
    const groupTiles = this.tiles.filter(tile => tile.group === group);
    return groupTiles.every(tile => tile.ownerId === ownerId);
  }

  chargePlayer(player, creditor, amount, message, turnOptions = {}, hooks = {}) {
    if (!player || amount <= 0) {
      this.resolveTurnAfterAction(turnOptions);
      return;
    }
    if (player.cash >= amount) {
      player.cash -= amount;
      if (creditor) {
        creditor.cash += amount;
      }
      this.feedMessage(message);
      if (hooks.onPaid) hooks.onPaid(amount);
      this.resolveTurnAfterAction(turnOptions);
      return;
    }
    const partial = player.cash;
    if (partial > 0) {
      player.cash = 0;
      if (creditor) {
        creditor.cash += partial;
      }
      this.feedMessage(`${player.nickname} paid $${partial} toward the debt.`);
      if (hooks.onPaid) hooks.onPaid(partial);
    }
    const remaining = amount - partial;
    this.pendingPayment = {
      playerId: player.id,
      creditorId: creditor ? creditor.id : null,
      amountRemaining: remaining,
      reason: message
    };
    this.pendingPaymentTurnOptions = turnOptions;
    this.feedMessage(`${player.nickname} owes $${remaining}. Mortgage or sell buildings to raise funds, or declare bankruptcy.`);
  }

  trySettlePendingPayment() {
    if (!this.pendingPayment) return false;
    const player = this.getPlayerById(this.pendingPayment.playerId);
    if (!player || player.bankrupt) {
      this.pendingPayment = null;
      this.pendingPaymentTurnOptions = null;
      return false;
    }
    if (player.cash < this.pendingPayment.amountRemaining) {
      return false;
    }
    const creditor = this.pendingPayment.creditorId
      ? this.getPlayerById(this.pendingPayment.creditorId)
      : null;
    const amount = this.pendingPayment.amountRemaining;
    player.cash -= amount;
    if (creditor) {
      creditor.cash += amount;
    }
    this.feedMessage(`${player.nickname} paid the remaining $${amount}.`);
    const turnOptions = this.pendingPaymentTurnOptions || {};
    this.pendingPayment = null;
    this.pendingPaymentTurnOptions = null;
    this.resolveTurnAfterAction(turnOptions);
    return true;
  }

  declareBankruptcy(socketId) {
    const player = this.getPlayerBySocket(socketId);
    if (!player) {
      return { success: false, error: 'Player not found.' };
    }
    if (!this.pendingPayment || this.pendingPayment.playerId !== player.id) {
      return { success: false, error: 'You have no outstanding debt to settle.' };
    }
    const creditor = this.pendingPayment.creditorId
      ? this.getPlayerById(this.pendingPayment.creditorId)
      : null;
    this.pendingPayment = null;
    this.pendingPaymentTurnOptions = null;
    this.handleBankruptcy(player, creditor);
    if (player.id === this.currentPlayerId) {
      this.nextTurn();
    }
    return { success: true };
  }

  transferMoney(from, to, amount, message) {
    if (!from || !to || amount <= 0) {
      return;
    }
    from.cash -= amount;
    to.cash += amount;
    this.feedMessage(message);
  }

  deductMoney(player, amount, message) {
    this.chargePlayer(player, null, amount, message, {});
  }

  handleBankruptcy(player, creditor = null) {
    player.bankrupt = true;
    this.extraRollPending = false;
    this.turnAllowsExtraRoll = false;
    this.consecutiveDoubles = 0;
    if (this.pendingPayment?.playerId === player.id) {
      this.pendingPayment = null;
      this.pendingPaymentTurnOptions = null;
    }
    if (creditor && player.cash > 0) {
      creditor.cash += player.cash;
      player.cash = 0;
    }
    const properties = [...player.properties];
    properties.forEach(propertyIndex => {
      const tile = this.getTile(propertyIndex);
      if (!tile) return;
      if (creditor && !creditor.bankrupt) {
        this.applyPropertyOwnershipChange(player, creditor, tile);
      } else {
        tile.ownerId = null;
        tile.houseCount = 0;
        tile.mortgaged = false;
        player.properties = player.properties.filter(index => index !== propertyIndex);
      }
    });
    player.properties = [];
    if (creditor) {
      this.feedMessage(`${player.nickname} is bankrupt. Assets transferred to ${creditor.nickname}.`);
    } else {
      this.feedMessage(`${player.nickname} is bankrupt and removed from the game.`);
    }
    if (this.nonBankruptPlayers().length <= 1) {
      this.endGame();
    } else if (player.id === this.currentPlayerId) {
      this.nextTurn();
    }
  }

  purchaseProperty(socketId, tileIndex) {
    const player = this.getPlayerBySocket(socketId);
    const tile = this.getTile(tileIndex);
    if (!player || !tile || tile.ownerId !== null) {
      return { success: false, error: 'Property is no longer available.' };
    }
    if (
      !this.pendingPurchaseOffer ||
      this.pendingPurchaseOffer.playerId !== player.id ||
      this.pendingPurchaseOffer.tileIndex !== tileIndex
    ) {
      return { success: false, error: 'There is no active purchase offer for this property.' };
    }
    if (player.cash < tile.price) {
      return { success: false, error: 'Insufficient cash to purchase this property.' };
    }
    player.cash -= tile.price;
    tile.ownerId = player.id;
    tile.mortgaged = false;
    tile.houseCount = 0;
    player.properties.push(tile.index);
    this.feedMessage(`${player.nickname} purchased ${tile.name} for $${tile.price}.`);
    this.pendingPurchaseOffer = null;
    this.resolveTurnAfterAction();
    return { success: true };
  }

  declineProperty(socketId, tileIndex) {
    const player = this.getPlayerBySocket(socketId);
    const tile = this.getTile(tileIndex);
    if (!player || !tile || tile.ownerId !== null) {
      return { success: false, error: 'Property is no longer available.' };
    }
    if (
      !this.pendingPurchaseOffer ||
      this.pendingPurchaseOffer.playerId !== player.id ||
      this.pendingPurchaseOffer.tileIndex !== tileIndex
    ) {
      return { success: false, error: 'There is no active purchase offer for this property.' };
    }
    this.pendingPurchaseOffer = null;
    if (this.settings.auction) {
      this.startAuction(tile, player.id);
      return { success: true, auctionStarted: true, message: 'Auction started for the declined property.' };
    }
    this.feedMessage(`${player.nickname} declined to buy ${tile.name}.`);
    this.resolveTurnAfterAction();
    return { success: true };
  }

  startAuction(tile, initiatingPlayerId) {
    const participants = this.players.filter(player => !player.bankrupt && !player.disconnected).map(player => player.id);
    this.auction = new AuctionState(tile, initiatingPlayerId);
    this.auction.participants = participants;
    this.feedMessage(`Auction started for ${tile.name}. Players may place bids.`);
  }

  placeAuctionBid(socketId, amount) {
    const player = this.getPlayerBySocket(socketId);
    if (!player || !this.auction || !this.auction.active) {
      return { success: false, error: 'No auction is active.' };
    }
    const now = Date.now();
    if (player.bankrupt || player.disconnected) {
      return { success: false, error: 'You cannot bid right now.' };
    }
    if (this.auction.participants.length && !this.auction.participants.includes(player.id)) {
      return { success: false, error: 'You are not part of this auction.' };
    }
    if (this.auction.cooldownUntil && now < this.auction.cooldownUntil) {
      return { success: false, error: 'Please wait a moment before bidding again.' };
    }
    if (!Number.isFinite(amount) || amount % 1 !== 0) {
      return { success: false, error: 'Bid must be a whole number.' };
    }
    if (amount <= this.auction.highestBid) {
      return { success: false, error: 'Bid must be higher than the current bid.' };
    }
    if (amount > player.cash) {
      return { success: false, error: 'Insufficient funds for this bid.' };
    }
    if (this.auction.highestBid > 0 && this.auction.highestBidderId === player.id) {
      return { success: false, error: 'Another player must raise the bid first.' };
    }
    this.auction.highestBid = amount;
    this.auction.highestBidderId = player.id;
    this.auction.lastBidAt = now;
    this.auction.cooldownUntil = now + AUCTION_BID_COOLDOWN_MS;
    this.auction.endsAt = now + AUCTION_DURATION_MS;
    this.feedMessage(`${player.nickname} bid $${amount}.`);
    return { success: true };
  }

  finishAuction() {
    if (!this.auction || !this.auction.active) {
      return;
    }
    const auction = this.auction;
    auction.active = false;
    if (!auction.highestBidderId) {
      this.feedMessage(`No bids were placed for ${auction.propertyTile.name}. The property remains unsold.`);
      this.resolveTurnAfterAction();
      this.auction = null;
      return;
    }
    const winner = this.getPlayerById(auction.highestBidderId);
    if (!winner || winner.bankrupt || winner.disconnected) {
      this.feedMessage(`Auction ended without a valid winner.`);
      this.resolveTurnAfterAction();
      this.auction = null;
      return;
    }
    auction.propertyTile.ownerId = winner.id;
    auction.propertyTile.mortgaged = false;
    auction.propertyTile.houseCount = 0;
    winner.properties.push(auction.propertyTile.index);
    this.feedMessage(`${winner.nickname} won the auction for ${auction.propertyTile.name} at $${auction.highestBid}.`);
    this.chargePlayer(
      winner,
      null,
      auction.highestBid,
      `${winner.nickname} paid $${auction.highestBid} for ${auction.propertyTile.name}.`,
      {}
    );
    this.auction = null;
  }

  manageProperty(socketId, { tileIndex, action } = {}) {
    const player = this.getPlayerBySocket(socketId);
    const tile = this.getTile(tileIndex);
    if (!player || !tile) {
      return { success: false, error: 'Property not found.' };
    }
    if (tile.ownerId !== player.id) {
      return { success: false, error: 'You do not own this property.' };
    }

    const settlingDebt = this.pendingPayment?.playerId === player.id;

    if (action === 'build-house' || action === 'sell-house') {
      if (!settlingDebt) {
        if (player.id !== this.currentPlayerId) {
          return { success: false, error: 'You can only build or sell during your turn.' };
        }
        if (this.hasRolled && !this.extraRollPending) {
          return { success: false, error: 'You can only build or sell before rolling the dice.' };
        }
      } else if (action === 'build-house') {
        return { success: false, error: 'You cannot build while settling a debt.' };
      }
    }

    let result;
    if (action === 'build-house') {
      if (!this.canBuildOnTile(player, tile)) {
        return { success: false, error: 'You cannot build on this property right now.' };
      }
      const cost = this.getPropertyHouseCost(tile);
      if (player.cash < cost) {
        return { success: false, error: 'Insufficient cash to build a house.' };
      }
      player.cash -= cost;
      tile.houseCount = (tile.houseCount || 0) + 1;
      const label = tile.houseCount >= 5 ? 'hotel' : 'house';
      this.feedMessage(`${player.nickname} built a ${label} on ${tile.name}.`);
      result = { success: true };
    } else if (action === 'sell-house') {
      if (!this.canSellFromTile(player, tile)) {
        return { success: false, error: 'You cannot sell a house from this property right now.' };
      }
      const cost = this.getPropertyHouseCost(tile);
      const wasHotel = (tile.houseCount || 0) >= 5;
      tile.houseCount = Math.max(0, (tile.houseCount || 0) - 1);
      player.cash += Math.floor(cost / 2);
      const label = wasHotel ? 'hotel' : 'house';
      this.feedMessage(`${player.nickname} sold a ${label} from ${tile.name}.`);
      result = { success: true };
    } else if (action === 'mortgage') {
      if (!this.canMortgageTile(player, tile)) {
        return { success: false, error: 'You cannot mortgage this property right now.' };
      }
      tile.mortgaged = true;
      const amount = Math.floor((tile.price || 0) / 2);
      player.cash += amount;
      this.feedMessage(`${player.nickname} mortgaged ${tile.name} for $${amount}.`);
      result = { success: true };
    } else if (action === 'unmortgage') {
      if (!this.canUnmortgageTile(player, tile)) {
        return { success: false, error: 'You cannot unmortgage this property right now.' };
      }
      const cost = Math.ceil(Math.floor((tile.price || 0) / 2) * 1.1);
      if (player.cash < cost) {
        return { success: false, error: 'Insufficient cash to unmortgage this property.' };
      }
      player.cash -= cost;
      tile.mortgaged = false;
      this.feedMessage(`${player.nickname} unmortgaged ${tile.name}.`);
      result = { success: true };
    } else {
      return { success: false, error: 'Unknown property action.' };
    }

    if (result?.success && this.pendingPayment?.playerId === player.id) {
      this.trySettlePendingPayment();
    }
    return result;
  }

  proposeTrade(socketId, offer = {}) {
    const fromPlayer = this.getPlayerBySocket(socketId);
    const toPlayer = this.getPlayerById(offer.toPlayerId);
    if (!fromPlayer || !toPlayer || fromPlayer.id === toPlayer.id) {
      return { success: false, error: 'Choose a valid trade partner.' };
    }
    if (fromPlayer.bankrupt || fromPlayer.disconnected || toPlayer.bankrupt || toPlayer.disconnected) {
      return { success: false, error: 'Both players must be active to trade.' };
    }
    if (this.pendingTrade) {
      return { success: false, error: 'Another trade is already pending.' };
    }

    const giveCash = Math.max(0, Number(offer.giveCash || 0));
    const requestCash = Math.max(0, Number(offer.requestCash || 0));
    const givePropertyIndexes = Array.isArray(offer.givePropertyIndexes) ? offer.givePropertyIndexes.map(Number) : [];
    const requestPropertyIndexes = Array.isArray(offer.requestPropertyIndexes) ? offer.requestPropertyIndexes.map(Number) : [];

    if (!Number.isFinite(giveCash) || !Number.isFinite(requestCash)) {
      return { success: false, error: 'Cash values must be valid numbers.' };
    }

    const giveTiles = givePropertyIndexes.map(index => this.getTile(index));
    const requestTiles = requestPropertyIndexes.map(index => this.getTile(index));

    if (!giveCash && !requestCash && !givePropertyIndexes.length && !requestPropertyIndexes.length) {
      return { success: false, error: 'Choose at least one cash or property item to include in the trade.' };
    }

    if (giveTiles.some(tile => !tile || tile.ownerId !== fromPlayer.id || !this.isTradeableTile(tile))) {
      return { success: false, error: 'You can only offer properties that you own and that have no houses, hotels, or mortgage.' };
    }
    if (requestTiles.some(tile => !tile || tile.ownerId !== toPlayer.id || !this.isTradeableTile(tile))) {
      return { success: false, error: 'The requested properties are not available for trade.' };
    }
    if (fromPlayer.cash < giveCash) {
      return { success: false, error: 'You do not have enough cash for this offer.' };
    }

    const trade = {
      id: `${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
      fromPlayerId: fromPlayer.id,
      fromPlayerName: fromPlayer.nickname,
      toPlayerId: toPlayer.id,
      toPlayerName: toPlayer.nickname,
      giveCash,
      requestCash,
      givePropertyIndexes,
      requestPropertyIndexes,
      createdAt: Date.now()
    };

    this.pendingTrade = trade;
    this.feedMessage(`${fromPlayer.nickname} sent a trade offer to ${toPlayer.nickname}.`);
    return { success: true, trade };
  }

  respondToTrade(socketId, { tradeId, accept } = {}) {
    const player = this.getPlayerBySocket(socketId);
    if (!player || !this.pendingTrade || this.pendingTrade.id !== tradeId) {
      return { success: false, error: 'No matching trade offer was found.' };
    }
    const trade = this.pendingTrade;
    if (trade.toPlayerId !== player.id) {
      return { success: false, error: 'Only the receiving player can respond to this trade.' };
    }

    if (!accept) {
      this.feedMessage(`${player.nickname} declined the trade offer.`);
      this.pendingTrade = null;
      return { success: true, accepted: false };
    }

    const fromPlayer = this.getPlayerById(trade.fromPlayerId);
    const toPlayer = this.getPlayerById(trade.toPlayerId);
    if (!fromPlayer || !toPlayer || fromPlayer.bankrupt || toPlayer.bankrupt || fromPlayer.disconnected || toPlayer.disconnected) {
      this.pendingTrade = null;
      return { success: false, error: 'The trade is no longer valid.' };
    }
    if (fromPlayer.cash < trade.giveCash || toPlayer.cash < trade.requestCash) {
      this.pendingTrade = null;
      return { success: false, error: 'One of the players no longer has enough cash.' };
    }

    const giveTiles = trade.givePropertyIndexes.map(index => this.getTile(index));
    const requestTiles = trade.requestPropertyIndexes.map(index => this.getTile(index));
    if (giveTiles.some(tile => !tile || tile.ownerId !== fromPlayer.id || !this.isTradeableTile(tile))) {
      this.pendingTrade = null;
      return { success: false, error: 'One of the offered properties is no longer tradable.' };
    }
    if (requestTiles.some(tile => !tile || tile.ownerId !== toPlayer.id || !this.isTradeableTile(tile))) {
      this.pendingTrade = null;
      return { success: false, error: 'One of the requested properties is no longer tradable.' };
    }

    fromPlayer.cash -= trade.giveCash;
    toPlayer.cash += trade.giveCash;
    toPlayer.cash -= trade.requestCash;
    fromPlayer.cash += trade.requestCash;

    giveTiles.forEach(tile => this.applyPropertyOwnershipChange(fromPlayer, toPlayer, tile));
    requestTiles.forEach(tile => this.applyPropertyOwnershipChange(toPlayer, fromPlayer, tile));

    this.pendingTrade = null;
    this.feedMessage(`${fromPlayer.nickname} and ${toPlayer.nickname} completed a trade.`);
    if (this.pendingPayment?.playerId === fromPlayer.id || this.pendingPayment?.playerId === toPlayer.id) {
      this.trySettlePendingPayment();
    }
    return { success: true, accepted: true };
  }

  endTurn(socketId) {
    const player = this.getPlayerBySocket(socketId);
    if (!player || player.id !== this.currentPlayerId) {
      return { success: false, error: 'Only the active player can end the turn.' };
    }
    if (!this.hasRolled) {
      return { success: false, error: 'You must roll the dice before ending your turn.' };
    }
    if (this.extraRollPending || this.turnAllowsExtraRoll) {
      return { success: false, error: 'You must roll again after doubles before ending your turn.' };
    }
    if (this.auction?.active) {
      return { success: false, error: 'Finish the active auction before ending the turn.' };
    }
    if (this.pendingPurchaseOffer?.playerId === player.id) {
      return { success: false, error: 'Resolve the property offer before ending the turn.' };
    }
    if (this.pendingPayment?.playerId === player.id) {
      return { success: false, error: 'Settle your debt before ending the turn.' };
    }
    this.nextTurn();
    return { success: true };
  }

  skipDisconnectedCurrentPlayer() {
    const current = this.getCurrentPlayer();
    if (!current || !current.disconnected || current.bankrupt) {
      return;
    }
    this.pendingPurchaseOffer = null;
    this.feedMessage(`${current.nickname} was skipped due to disconnect.`);
    this.nextTurn();
  }

  endGame() {
    const winner = this.connectedNonBankruptPlayers()[0] || this.nonBankruptPlayers()[0];
    this.lastWinner = winner ? { id: winner.id, nickname: winner.nickname } : null;
    if (winner) {
      this.feedMessage(`${winner.nickname} is the last player remaining and wins the game!`);
    } else {
      this.feedMessage('The game has ended.');
    }
    this.started = false;
    this.currentPlayerId = null;
    this.hasRolled = false;
    this.pendingPurchaseOffer = null;
    this.auction = null;
    this.pendingTrade = null;
    this.extraRollPending = false;
    this.turnAllowsExtraRoll = false;
    this.consecutiveDoubles = 0;
  }

  getGameSummary() {
    return {
      started: this.started,
      currentPlayerId: this.currentPlayerId,
      turnOrder: this.turnOrder || [],
      hasRolled: this.hasRolled,
      extraRollPending: this.extraRollPending,
      pendingPurchaseOffer: this.pendingPurchaseOffer,
      pendingPayment: this.pendingPayment,
      lastWinner: this.lastWinner,
      lastDice: this.lastDice,
      tiles: this.tiles.map(tile => ({
        index: tile.index,
        name: tile.name,
        type: tile.type,
        group: tile.group,
        ownerId: tile.ownerId,
        price: tile.price,
        rent: tile.rent,
        color: tile.color,
        amount: tile.amount,
        mortgaged: tile.mortgaged,
        houseCount: tile.houseCount || 0,
        houseCost: this.getPropertyHouseCost(tile)
      })),
      players: this.players.map(player => ({
        id: player.id,
        nickname: player.nickname,
        color: player.color,
        cash: player.cash,
        position: player.position,
        inJail: player.inJail,
        jailTurns: player.jailTurns || 0,
        bankrupt: player.bankrupt,
        disconnected: player.disconnected,
        isHost: player.isHost,
        properties: player.properties,
        ready: player.ready,
        isBot: player.isBot,
        clientId: player.clientId
      })),
      feed: this.feed,
      auction: this.auction ? {
        active: this.auction.active,
        tileIndex: this.auction.propertyTile.index,
        tileName: this.auction.propertyTile.name,
        highestBid: this.auction.highestBid,
        highestBidderId: this.auction.highestBidderId,
        participants: this.auction.participants,
        startedAt: this.auction.startedAt,
        endsAt: this.auction.endsAt,
        cooldownUntil: this.auction.cooldownUntil,
        lastBidAt: this.auction.lastBidAt,
        durationMs: AUCTION_DURATION_MS
      } : null,
      pendingTrade: this.pendingTrade,
      vacationPool: this.vacationPool
    };
  }
}

class Room {
  constructor(hostPlayer) {
    this.roomCode = createRoomCode();
    this.hostId = hostPlayer.id;
    this.settings = { ...DEFAULT_ROOM_SETTINGS };
    this.game = new GameState(this.settings);
    this.game.addPlayer(hostPlayer);
    this.playerMap = new Map();
    this.playerMap.set(hostPlayer.id, hostPlayer);
  }

  addOrReconnectPlayer(playerInfo) {
    const existing = this.game.getPlayerByClient(playerInfo.clientId);
    if (existing) {
      existing.socketId = playerInfo.socketId;
      existing.disconnected = false;
      if (typeof playerInfo.nickname === 'string') {
        const safeNickname = playerInfo.nickname.trim().slice(0, 24);
        if (safeNickname) {
          existing.nickname = safeNickname;
        }
      }
      if (typeof playerInfo.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(playerInfo.color)) {
        existing.color = playerInfo.color;
      }
      return { success: true, player: existing };
    }
    if (this.game.started) {
      return { success: false, error: 'Game is already in progress.' };
    }
    if (!this.game.canJoin()) {
      return { success: false, error: 'Room is full.' };
    }
    const player = new Player(playerInfo);
    this.game.addPlayer(player);
    this.playerMap.set(player.id, player);
    return { success: true, player };
  }

  getPlayerBySocket(socketId) {
    return this.game.getPlayerBySocket(socketId);
  }

  getPlayerById(id) {
    return this.game.getPlayerById(id);
  }

  setRoomSetting(key, value) {
    if (this.game.started || !Object.prototype.hasOwnProperty.call(this.settings, key)) {
      return;
    }

    if (key === 'maxPlayers') {
      return;
    } else if (key === 'startingCash') {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return;
      value = Math.max(0, Math.floor(parsed));
    } else if (typeof this.settings[key] === 'boolean') {
      value = value === true || value === 'true' || value === 1 || value === '1';
    } else if (typeof value === 'string') {
      value = value.trim();
    }

    this.settings[key] = value;
    this.game.settings[key] = value;
    if (key === 'startingCash') {
      this.game.players.forEach(player => {
        player.cash = Number(value);
      });
    }
  }

  startGame() {
    return this.game.startGame();
  }

  rollDice(socketId) {
    return this.game.rollDice(socketId);
  }

  purchaseProperty(socketId, tileIndex) {
    return this.game.purchaseProperty(socketId, tileIndex);
  }

  declineProperty(socketId, tileIndex) {
    return this.game.declineProperty(socketId, tileIndex);
  }

  placeAuctionBid(socketId, amount) {
    return this.game.placeAuctionBid(socketId, amount);
  }

  manageProperty(socketId, payload) {
    return this.game.manageProperty(socketId, payload);
  }

  proposeTrade(socketId, payload) {
    return this.game.proposeTrade(socketId, payload);
  }

  respondToTrade(socketId, payload) {
    return this.game.respondToTrade(socketId, payload);
  }

  endTurn(socketId) {
    return this.game.endTurn(socketId);
  }

  payJailFine(socketId) {
    return this.game.payJailFine(socketId);
  }

  declareBankruptcy(socketId) {
    return this.game.declareBankruptcy(socketId);
  }

  getRoomSummary() {
    return {
      roomCode: this.roomCode,
      hostId: this.hostId,
      settings: this.settings,
      players: this.game.players.map(player => ({
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
        isBot: player.isBot
      })),
      started: this.game.started,
      vacationPool: this.game.vacationPool
    };
  }
}

class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.socketRoom = new Map();
  }

  createRoom(hostInfo) {
    const player = new Player({ ...hostInfo, isHost: true });
    const room = new Room(player);
    this.rooms.set(room.roomCode, room);
    this.socketRoom.set(hostInfo.socketId, room);
    return room;
  }

  getRoom(roomCode) {
    if (!roomCode) return null;
    return this.rooms.get(String(roomCode).toUpperCase()) || null;
  }

  getRoomBySocket(socketId) {
    return this.socketRoom.get(socketId) || null;
  }

  restoreConnection(clientId, socketId) {
    const room =
      [...this.rooms.values()].find(roomItem => {
        const player = roomItem.game.getPlayerByClient(clientId);
        return player && !player.disconnected;
      }) ||
      [...this.rooms.values()].find(roomItem => roomItem.game.getPlayerByClient(clientId));
    if (!room) return null;
    const player = room.game.getPlayerByClient(clientId);
    if (!player) return null;
    player.socketId = socketId;
    player.disconnected = false;
    this.socketRoom.set(socketId, room);
    return room;
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

  leaveRoomByClient(clientId, socketId) {
    const room = this.getRoomByClient(clientId);
    if (!room) return null;
    const player = room.game.getPlayerByClient(clientId);
    if (!player) return null;
    if (socketId) {
      this.socketRoom.delete(socketId);
    }
    if (!room.game.started) {
      room.game.removePlayerByClient(clientId);
      if (room.game.players.length === 0) {
        this.rooms.delete(room.roomCode);
      }
    } else {
      player.disconnected = true;
      player.socketId = null;
    }
    return room;
  }
}

module.exports = { RoomManager };

