const DEFAULT_ROOM_SETTINGS = {
  maxPlayers: 4,
  doubleRent: false,
  vacationCash: true,
  auction: true,
  trading: true,
  doubleGo: false,
  noRentWhileInPrison: false,
  mortgage: true,
  evenBuild: true,
  randomizePlayerOrder: false,
  houseLimit: 32,
  hotelLimit: 12,
  turnTimer: 0,
  bankruptMode: 'elim',
  bots: 0,
  startingCash: 1500,
  bankLoans: true,
  bankLoanSeverity: 'predatory',
  globalEvents: 'rare',
  globalEventDuration: 5,
  globalEventMax: 1
};

const AUCTION_DURATION_MS = 5000;
const AUCTION_BID_COOLDOWN_MS = 300;
const PROPERTY_HOUSE_COST_BY_GROUP = {
  Brown: 50,
  'Light Blue': 50,
  Pink: 100,
  Orange: 100,
  Magenta: 100,
  Red: 150,
  Yellow: 150,
  Green: 200,
  'Dark Blue': 200
};
const PROPERTY_RENT_MULTIPLIERS = [1, 5, 15, 45, 80, 125];
const RAILROAD_RENT = [25, 50, 100, 200];
const JAIL_FINE = 50;
const JAIL_MAX_TURNS = 3;
const START_TILE_INDEX = 0;
const GLOBAL_EVENT_COOLDOWN_ROUNDS = 3;
const GLOBAL_EVENT_MIN_ROUND = 4;
const BANK_LOAN_PRINCIPAL = 300;
const BANK_LOAN_TERM_ROUNDS = 3;

const GLOBAL_EVENT_DEFINITIONS = [
  {
    id: 'housing-bubble',
    title: 'HOUSING BUBBLE POP',
    category: 'ECONOMIC',
    summary: 'Property values are sliding. Construction is frozen while the market clears.',
    weight: 1,
    eligible: game => game.totalBuildings() >= 18,
    effects: { rentMultiplier: 0.65, constructionBlocked: true, buildingSaleMultiplier: 0.4, propertyValueMultiplier: 0.8 }
  },
  {
    id: 'credit-freeze',
    title: 'CREDIT FREEZE',
    category: 'ECONOMIC',
    summary: 'Lenders stop taking risk. New mortgages and bank loans are unavailable.',
    weight: 1,
    eligible: game => game.players.some(player => player.bankLoan?.status === 'active' || player.bankLoan?.status === 'due') || game.tiles.some(tile => tile.mortgaged),
    effects: { bankLoansBlocked: true, mortgagesBlocked: true }
  },
  {
    id: 'inflation-spiral',
    title: 'INFLATION SPIRAL',
    category: 'ECONOMIC',
    summary: 'Cash is losing buying power. Taxes and construction cost more.',
    weight: 1,
    eligible: game => game.totalCash() >= game.settings.startingCash * Math.max(2, game.activePlayers().length) * 1.1,
    effects: { taxMultiplier: 1.4, buildingCostMultiplier: 1.35, loanPremiumMultiplier: 1.25 }
  },
  {
    id: 'city-election',
    title: 'CITY ELECTION',
    category: 'CIVIC',
    summary: 'The table chooses the next Poorup policy package.',
    weight: 1,
    eligible: () => true,
    choices: [
      { id: 'low-tax', label: 'LOW TAX PLATFORM', description: 'Taxes fall, but card rewards are reduced.' },
      { id: 'public-works', label: 'PUBLIC WORKS PLATFORM', description: 'Construction costs fall, but property rent is capped.' },
      { id: 'bank-first', label: 'BANK-FIRST PLATFORM', description: 'Loans are easier, but default penalties increase.' }
    ],
    effects: {}
  },
  {
    id: 'airport-strike',
    title: 'AIRPORT STRIKE',
    category: 'INFRASTRUCTURE',
    summary: 'Flights are grounded. Airport rent and airport card movement are disrupted.',
    weight: 1,
    eligible: game => game.tiles.some(tile => tile.type === 'railroad' && tile.ownerId),
    effects: { airportRentMultiplier: 0, airportCardsBlocked: true }
  },
  {
    id: 'tourism-boom',
    title: 'TOURISM BOOM',
    category: 'INFRASTRUCTURE',
    summary: 'Visitors flood the city. Airports and premium districts surge.',
    weight: 1,
    eligible: () => true,
    effects: { airportRentMultiplier: 1.75, premiumRentMultiplier: 1.3 }
  },
  {
    id: 'anti-monopoly',
    title: 'ANTI-MONOPOLY INVESTIGATION',
    category: 'CIVIC',
    summary: 'The dominant portfolio is under review and its rent is temporarily capped.',
    weight: 1,
    eligible: game => game.players.some(player => game.playerGroups(player).length >= 2),
    effects: { leaderRentMultiplier: 0.6 }
  }
];

const DEFAULT_TILES = [
  { index: 0, name: 'Start', type: 'start' },
  { index: 1, name: 'Salvador', type: 'property', group: 'Brown', price: 60, rent: 10, color: '#7b5029' },
  { index: 2, name: 'Treasure', type: 'chest' },
  { index: 3, name: 'Rio', type: 'property', group: 'Brown', price: 60, rent: 10, color: '#7b5029' },
  { index: 4, name: 'Earnings Tax', type: 'tax', amount: 200 },
  { index: 5, name: 'ACC Airport', type: 'railroad', price: 200, rent: 25 },
  { index: 6, name: 'Accra', type: 'property', group: 'Light Blue', price: 100, rent: 14, color: '#3e7d7b' },
  { index: 7, name: 'Surprise?', type: 'chance' },
  { index: 8, name: 'Tema', type: 'property', group: 'Light Blue', price: 100, rent: 14, color: '#3e7d7b' },
  { index: 9, name: 'Kumasi', type: 'property', group: 'Light Blue', price: 120, rent: 16, color: '#3e7d7b' },
  { index: 10, name: 'Passing By', type: 'jail' },
  { index: 11, name: 'Pattaya', type: 'property', group: 'Pink', price: 140, rent: 10, color: '#a04e6f' },
  { index: 12, name: 'Electric Company', type: 'utility', price: 150, rent: 12 },
  { index: 13, name: 'Chiang Mai', type: 'property', group: 'Pink', price: 140, rent: 12, color: '#a04e6f' },
  { index: 14, name: 'Bangkok', type: 'property', group: 'Pink', price: 160, rent: 14, color: '#a04e6f' },
  { index: 15, name: 'BKK Airport', type: 'railroad', price: 200, rent: 25 },
  { index: 16, name: 'Kyoto', type: 'property', group: 'Orange', price: 180, rent: 14, color: '#b96d2a' },
  { index: 17, name: 'Treasure', type: 'chest' },
  { index: 18, name: 'Osaka', type: 'property', group: 'Orange', price: 180, rent: 14, color: '#b96d2a' },
  { index: 19, name: 'Tokyo', type: 'property', group: 'Orange', price: 200, rent: 16, color: '#b96d2a' },
  { index: 20, name: 'Vacation', type: 'vacation' },
  { index: 21, name: 'Eindhoven', type: 'property', group: 'Red', price: 220, rent: 18, color: '#87231e' },
  { index: 22, name: 'Surprise?', type: 'chance' },
  { index: 23, name: 'Rotterdam', type: 'property', group: 'Red', price: 220, rent: 18, color: '#87231e' },
  { index: 24, name: 'Amsterdam', type: 'property', group: 'Red', price: 240, rent: 20, color: '#87231e' },
  { index: 25, name: 'AMS Airport', type: 'railroad', price: 200, rent: 25 },
  { index: 26, name: 'Calgary', type: 'property', group: 'Yellow', price: 260, rent: 22, color: '#b18a2e' },
  { index: 27, name: 'Vancouver', type: 'property', group: 'Yellow', price: 260, rent: 22, color: '#b18a2e' },
  { index: 28, name: 'Water Company', type: 'utility', price: 150, rent: 12 },
  { index: 29, name: 'Toronto', type: 'property', group: 'Yellow', price: 280, rent: 24, color: '#b18a2e' },
  { index: 30, name: 'Go to Prison', type: 'goToJail' },
  { index: 31, name: 'Bern', type: 'property', group: 'Green', price: 300, rent: 26, color: '#4b853d' },
  { index: 32, name: 'Geneva', type: 'property', group: 'Green', price: 300, rent: 26, color: '#4b853d' },
  { index: 33, name: 'Treasure', type: 'chest' },
  { index: 34, name: 'Zurich', type: 'property', group: 'Green', price: 320, rent: 28, color: '#4b853d' },
  { index: 35, name: 'MB Airport', type: 'railroad', price: 200, rent: 25 },
  { index: 36, name: 'Surprise?', type: 'chance' },
  { index: 37, name: 'Downtown', type: 'property', group: 'Dark Blue', price: 400, rent: 35, color: '#286ea1' },
  { index: 38, name: 'Premium Tax', type: 'tax', amount: 75 },
  { index: 39, name: 'Marina Bay', type: 'property', group: 'Dark Blue', price: 400, rent: 50, color: '#286ea1' }
];

const SURPRISE_DECK = [
  { text: 'Advance to Marina Bay', action: 'moveTo', tileIndex: 39 },
  { text: 'Advance to Start and collect $200', action: 'collectStart', amount: 200 },
  { text: 'Advance to Amsterdam', action: 'moveTo', tileIndex: 24 },
  { text: 'Advance to Pattaya', action: 'moveTo', tileIndex: 11 },
  { text: 'Advance to the next Airport and pay double rent if owned', action: 'nearestRailroad', multiplier: 2 },
  { text: 'Advance to the next Airport and pay double rent if owned', action: 'nearestRailroad', multiplier: 2 },
  { text: 'Advance to the next Utility and pay ten times the dice roll if owned', action: 'nearestUtility', multiplier: 10 },
  { text: 'Bank dividend — collect $50', action: 'collect', amount: 50 },
  { text: 'Keep this card until needed: Get Out of Prison', action: 'jailFree' },
  { text: 'Move back three spaces', action: 'moveBack', steps: 3 },
  { text: 'Go directly to Prison', action: 'goToJail' },
  { text: 'Building repairs — pay $25 per house and $100 per hotel', action: 'repairs', houseCost: 25, hotelCost: 100 },
  { text: 'Speeding fine — pay $15', action: 'pay', amount: 15 },
  { text: 'Advance to ACC Airport', action: 'moveTo', tileIndex: 5 },
  { text: 'Elected chairperson — pay each player $50', action: 'payEach', amount: 50 },
  { text: 'Building loan matures — collect $150', action: 'collect', amount: 150 }
];

const TREASURE_DECK = [
  { text: 'Advance to Start and collect $200', action: 'collectStart', amount: 200 },
  { text: 'Bank error — collect $200', action: 'collect', amount: 200 },
  { text: "Doctor's fee — pay $50", action: 'pay', amount: 50 },
  { text: 'Investment sale — collect $50', action: 'collect', amount: 50 },
  { text: 'Keep this card until needed: Get Out of Prison', action: 'jailFree' },
  { text: 'Go directly to Prison', action: 'goToJail' },
  { text: 'Parlor show — collect $50 from each player', action: 'collectFromEach', amount: 50 },
  { text: 'Tax refund — collect $20', action: 'collect', amount: 20 },
  { text: 'Insurance matures — collect $100', action: 'collect', amount: 100 },
  { text: 'Hospital fee — pay $100', action: 'pay', amount: 100 },
  { text: 'School tax — pay $150', action: 'pay', amount: 150 },
  { text: 'Consulting fee — collect $25', action: 'collect', amount: 25 },
  { text: 'Street repairs — pay $40 per house and $115 per hotel', action: 'repairs', houseCost: 40, hotelCost: 115 },
  { text: 'Holiday fund matures — collect $100', action: 'collect', amount: 100 },
  { text: 'Beauty contest — collect $10', action: 'collect', amount: 10 },
  { text: 'Inheritance — collect $100', action: 'collect', amount: 100 }
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
  constructor({ clientId, socketId, nickname, color, avatarGrid = null, accountId = null, isHost = false, isBot = false }) {
    this.id = `${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
    this.clientId = clientId || this.id;
    this.socketId = socketId;
    const safeNickname = typeof nickname === 'string' ? nickname.trim().slice(0, 24) : '';
    const safeColor = typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#35a653';
    this.nickname = safeNickname || 'Player';
    this.color = safeColor;
    this.avatarGrid = Array.isArray(avatarGrid) ? avatarGrid : null;
    this.accountId = accountId || null;
    this.isHost = isHost;
    this.isBot = isBot;
    this.cash = DEFAULT_ROOM_SETTINGS.startingCash;
    this.position = START_TILE_INDEX;
    this.properties = [];
    this.inJail = false;
    this.jailTurns = 0;
    this.jailFreeCards = 0;
    this.bankLoan = null;
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
    this.passedPlayerIds = [];
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
    this.startedAt = null;
    this.feed = [];
    this.auction = null;
    this.pendingTrade = null;
    this.pendingPayment = null;
    this.pendingPaymentTurnOptions = null;
    this.lastWinner = null;
    this.vacationPool = 0;
    this.roundNumber = 0;
    this.globalEvent = null;
    this.globalEventHistory = [];
    this.globalEventCooldown = 0;
    this.globalEventsTriggered = 0;
    this.surpriseDeck = [...SURPRISE_DECK];
    this.treasureDeck = [...TREASURE_DECK];
  }

  addPlayer(player) {
    player.cash = this.settings.startingCash;
    player.position = START_TILE_INDEX;
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
    this.startedAt = Date.now();
    this.feed = [];
    this.auction = null;
    this.pendingTrade = null;
    this.pendingPayment = null;
    this.pendingPaymentTurnOptions = null;
    this.lastWinner = null;
    this.vacationPool = 0;
    this.roundNumber = 1;
    this.globalEvent = null;
    this.globalEventHistory = [];
    this.globalEventCooldown = 0;
    this.globalEventsTriggered = 0;
    this.surpriseDeck = [...SURPRISE_DECK];
    this.treasureDeck = [...TREASURE_DECK];

    this.players.forEach(player => {
      player.cash = this.settings.startingCash;
      player.position = START_TILE_INDEX;
      player.properties = [];
      player.inJail = false;
      player.jailTurns = 0;
      player.jailFreeCards = 0;
      player.bankLoan = null;
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

  setPlayerAppearance(socketId, { color, nickname, avatarGrid } = {}) {
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
    if (avatarGrid === null || Array.isArray(avatarGrid)) {
      player.avatarGrid = avatarGrid;
    }
    return { success: true };
  }

  getTile(index) {
    return this.tiles.find(tile => tile.index === index);
  }

  getGroupTiles(group) {
    return this.tiles.filter(tile => tile.group === group && tile.type === 'property');
  }

  totalBuildings() {
    return this.tiles.reduce((sum, tile) => sum + Math.max(0, Math.min(5, Number(tile.houseCount) || 0)), 0);
  }

  totalCash() {
    return this.activePlayers().reduce((sum, player) => sum + Math.max(0, Number(player.cash) || 0), 0);
  }

  playerGroups(player) {
    if (!player) return [];
    return [...new Set(player.properties.map(index => this.getTile(index)?.group).filter(Boolean))];
  }

  globalEventDefinition(id) {
    return GLOBAL_EVENT_DEFINITIONS.find(event => event.id === id) || null;
  }

  globalEventActive(id) {
    return this.globalEvent?.phase === 'active' && this.globalEvent.id === id;
  }

  isConstructionBlocked() {
    return this.globalEventActive('housing-bubble');
  }

  isLoanCollateral(player, tile) {
    return Boolean(player?.bankLoan?.status === 'active' || player?.bankLoan?.status === 'due')
      && Number(player.bankLoan.collateralTileIndex) === Number(tile?.index);
  }

  highestCollateralProperty(player) {
    return player?.properties
      ?.map(index => this.getTile(index))
      .filter(tile => tile && tile.type === 'property' && !tile.mortgaged && !(tile.houseCount > 0))
      .sort((a, b) => (b.price || 0) - (a.price || 0))[0] || null;
  }

  getPropertyHouseCost(tile) {
    const base = PROPERTY_HOUSE_COST_BY_GROUP[tile?.group] || 0;
    if (this.globalEventActive('inflation-spiral')) return Math.ceil(base * 1.35);
    if (this.globalEvent?.phase === 'active' && this.globalEvent.id === 'city-election' && this.globalEvent.resolvedChoice === 'public-works') {
      return Math.max(1, Math.floor(base * 0.65));
    }
    return base;
  }

  getPropertyRent(tile) {
    const baseRent = tile.rent || 0;
    let rent = baseRent;
    if (tile.mortgaged) {
      return 0;
    }
    if (tile.type === 'property') {
      const level = Math.max(0, Math.min(5, tile.houseCount || 0));
      if (level > 0) {
        rent = Math.floor(baseRent * PROPERTY_RENT_MULTIPLIERS[level]);
      } else if (tile.group && this.settings.doubleRent && this.hasFullSet(tile.ownerId, tile.group)) {
        rent = baseRent * 2;
      }
    }
    if (tile.type === 'utility') {
      const owner = this.getPlayerById(tile.ownerId);
      if (owner) {
        const ownedUtilities = this.tiles.filter(entry => entry.type === 'utility' && entry.ownerId === owner.id).length;
        const diceTotal = Math.max(2, (this.lastDice?.[0] || 0) + (this.lastDice?.[1] || 0));
        rent = diceTotal * (ownedUtilities >= 2 ? 10 : 4);
      } else {
        rent = baseRent || 20;
      }
    }
    if (tile.type === 'railroad') {
      const owner = this.getPlayerById(tile.ownerId);
      if (!owner) {
        rent = RAILROAD_RENT[0];
      } else {
        const ownedRailroads = this.tiles.filter(entry => entry.type === 'railroad' && entry.ownerId === owner.id).length;
        rent = RAILROAD_RENT[Math.min(Math.max(ownedRailroads, 1), RAILROAD_RENT.length) - 1];
      }
    }
    if (this.globalEventActive('housing-bubble') && tile.type === 'property') rent *= 0.65;
    if (this.globalEventActive('airport-strike') && tile.type === 'railroad') rent = 0;
    if (this.globalEventActive('tourism-boom') && tile.type === 'railroad') rent *= 1.75;
    if (this.globalEventActive('tourism-boom') && tile.group === 'Dark Blue') rent *= 1.3;
    if (this.globalEventActive('anti-monopoly') && tile.ownerId === this.globalEvent.targetPlayerId) rent *= 0.6;
    if (this.globalEvent?.phase === 'active' && this.globalEvent.id === 'city-election' && this.globalEvent.resolvedChoice === 'public-works' && tile.type === 'property') rent *= 0.75;
    return Math.max(0, Math.floor(rent));
  }

  isTradeableTile(tile) {
    if (!tile || !tile.ownerId) return false;
    if (tile.mortgaged) return false;
    const owner = this.getPlayerById(tile.ownerId);
    if (owner && this.isLoanCollateral(owner, tile)) return false;
    return (tile.type === 'property' || tile.type === 'utility' || tile.type === 'railroad') && (tile.houseCount || 0) === 0;
  }

  canBuildOnTile(player, tile) {
    if (!player || !tile || tile.type !== 'property') return false;
    if (this.isConstructionBlocked()) return false;
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
    if (this.globalEventActive('credit-freeze')) return false;
    if (this.isLoanCollateral(player, tile)) return false;
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
    return Boolean(player && tile && tile.ownerId === player.id && tile.mortgaged) && !this.globalEventActive('housing-bubble');
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
    this.startedAt = Date.now();
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

  useJailFree(socketId) {
    const player = this.getPlayerBySocket(socketId);
    if (!player || !this.started || player.id !== this.currentPlayerId) return { success: false, error: 'It is not your turn.' };
    if (!player.inJail || !(player.jailFreeCards > 0)) return { success: false, error: 'You do not have a Get Out of Prison card.' };
    if (this.hasRolled) return { success: false, error: 'You have already rolled this turn.' };
    player.jailFreeCards -= 1;
    player.inJail = false;
    player.jailTurns = 0;
    this.feedMessage(`${player.nickname} used a Get Out of Prison card.`);
    return { success: true, message: 'You left prison with a Get Out of Prison card.' };
  }

  bankLoanTerms(player) {
    const severity = this.settings.bankLoanSeverity === 'extreme' ? 'extreme' : this.settings.bankLoanSeverity === 'fair' ? 'fair' : 'predatory';
    let premiumRate = severity === 'extreme' ? 0.8 : severity === 'fair' ? 0.2 : 0.5;
    if (this.globalEventActive('inflation-spiral')) premiumRate *= 1.25;
    if (this.globalEvent?.phase === 'active' && this.globalEvent.id === 'city-election' && this.globalEvent.resolvedChoice === 'bank-first') premiumRate *= 0.8;
    const principal = BANK_LOAN_PRINCIPAL;
    const totalDue = principal + Math.ceil(principal * premiumRate);
    const collateral = this.highestCollateralProperty(player);
    return {
      principal,
      totalDue,
      premium: totalDue - principal,
      dueInRounds: BANK_LOAN_TERM_ROUNDS,
      dueRound: this.roundNumber + BANK_LOAN_TERM_ROUNDS,
      cureRound: this.roundNumber + BANK_LOAN_TERM_ROUNDS + 1,
      collateralTileIndex: collateral?.index ?? null,
      collateralName: collateral?.name || 'NONE',
      severity
    };
  }

  getBankLoanOffer(player) {
    if (!player || !this.settings.bankLoans) return { available: false, reason: 'Bank lending is disabled.' };
    if (!this.started) return { available: false, reason: 'The game has not started.' };
    if (this.globalEventActive('credit-freeze')) return { available: false, reason: 'Credit is frozen by the active global event.' };
    if (player.id !== this.currentPlayerId) return { available: false, reason: 'Bank credit is available during your turn.' };
    if (player.bankLoan?.status === 'active' || player.bankLoan?.status === 'due') return { available: false, reason: 'You already have an active bank loan.' };
    if (player.bankLoan?.status === 'defaulted') return { available: false, reason: 'Bank credit is suspended after your previous default.' };
    if (player.cash > 250) return { available: false, reason: 'Emergency credit unlocks below $250 cash.' };
    const terms = this.bankLoanTerms(player);
    return { available: true, ...terms };
  }

  takeBankLoan(socketId) {
    const player = this.getPlayerBySocket(socketId);
    const offer = this.getBankLoanOffer(player);
    if (!offer.available) return { success: false, error: offer.reason };
    player.cash += offer.principal;
    player.bankLoan = {
      status: 'active',
      principal: offer.principal,
      totalDue: offer.totalDue,
      remaining: offer.totalDue,
      issuedRound: this.roundNumber,
      dueRound: offer.dueRound,
      cureRound: offer.cureRound,
      collateralTileIndex: offer.collateralTileIndex,
      severity: offer.severity
    };
    this.feedMessage(`${player.nickname} accepted a $${offer.principal} bank loan. $${offer.totalDue} is due by round ${offer.dueRound}.`);
    return { success: true, loan: player.bankLoan };
  }

  repayBankLoan(socketId, { amount } = {}) {
    const player = this.getPlayerBySocket(socketId);
    if (!player || player.id !== this.currentPlayerId) return { success: false, error: 'It is not your turn.' };
    const loan = player.bankLoan;
    if (!loan || !['active', 'due'].includes(loan.status)) return { success: false, error: 'You have no bank loan to repay.' };
    const requested = amount == null ? loan.remaining : Math.floor(Number(amount));
    if (!Number.isFinite(requested) || requested <= 0) return { success: false, error: 'Enter a valid repayment amount.' };
    const payment = Math.min(requested, loan.remaining);
    if (player.cash < payment) return { success: false, error: `You need $${payment} to make this repayment.` };
    player.cash -= payment;
    loan.remaining -= payment;
    if (loan.remaining <= 0) {
      loan.remaining = 0;
      loan.status = 'paid';
      loan.paidRound = this.roundNumber;
      this.feedMessage(`${player.nickname} repaid the bank loan in full.`);
    } else {
      this.feedMessage(`${player.nickname} repaid $${payment} on the bank loan. $${loan.remaining} remains.`);
    }
    return { success: true, loan };
  }

  processBankLoans() {
    this.players.forEach(player => {
      const loan = player.bankLoan;
      if (!loan || player.bankrupt || !['active', 'due'].includes(loan.status)) return;
      if (loan.status === 'active' && this.roundNumber >= loan.dueRound) {
        loan.status = 'due';
        this.feedMessage(`${player.nickname}'s bank loan is due: $${loan.remaining}. One cure round remains.`);
      } else if (loan.status === 'due' && this.roundNumber > loan.cureRound) {
        this.defaultBankLoan(player);
      }
    });
  }

  defaultBankLoan(player) {
    const loan = player.bankLoan;
    if (!loan) return;
    const collateral = loan.collateralTileIndex == null ? null : this.getTile(loan.collateralTileIndex);
    if (collateral && collateral.ownerId === player.id) {
      collateral.ownerId = null;
      collateral.mortgaged = false;
      collateral.houseCount = 0;
      player.properties = player.properties.filter(index => index !== collateral.index);
      this.feedMessage(`${player.nickname} defaulted. The bank seized ${collateral.name}.`);
    } else {
      this.feedMessage(`${player.nickname} defaulted on an unsecured bank loan.`);
      this.handleBankruptcy(player, null);
    }
    loan.status = 'defaulted';
    loan.defaultedRound = this.roundNumber;
  }

  movePlayer(player, steps, options = {}) {
    const oldPosition = player.position;
    player.position = (player.position + steps) % this.tiles.length;
    const distanceToStart = (START_TILE_INDEX - oldPosition + this.tiles.length) % this.tiles.length || this.tiles.length;
    if (distanceToStart <= steps) {
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

  advanceRound() {
    this.roundNumber += 1;
    if (this.globalEventCooldown > 0) this.globalEventCooldown -= 1;

    if (this.globalEvent?.phase === 'voting' && this.roundNumber > this.globalEvent.voteRound) {
      this.resolveGlobalEventVote();
    } else if (this.globalEvent?.phase === 'warning' && this.roundNumber > this.globalEvent.startedRound) {
      this.globalEvent.phase = 'active';
      this.globalEvent.startedRound = this.roundNumber;
      this.globalEvent.roundsRemaining = this.globalEvent.durationRounds;
      this.feedMessage(`${this.globalEvent.title} is now active for ${this.globalEvent.durationRounds} rounds.`);
    } else if (this.globalEvent?.phase === 'active') {
      this.globalEvent.roundsRemaining -= 1;
      if (this.globalEvent.roundsRemaining <= 0) {
        const ended = this.globalEvent;
        this.globalEventHistory.unshift({ id: ended.id, title: ended.title, endedRound: this.roundNumber });
        this.globalEventHistory = this.globalEventHistory.slice(0, 8);
        this.feedMessage(`${ended.title} has ended. The table enters recovery.`);
        this.globalEvent = null;
        this.globalEventCooldown = GLOBAL_EVENT_COOLDOWN_ROUNDS;
      }
    }

    this.processBankLoans();
    this.maybeTriggerGlobalEvent();
  }

  maybeTriggerGlobalEvent(source = 'round') {
    if (!this.started || this.settings.globalEvents === 'off' || this.globalEvent || this.globalEventCooldown > 0) return;
    if (this.roundNumber < GLOBAL_EVENT_MIN_ROUND) return;
    const maxEvents = Math.max(1, Number(this.settings.globalEventMax) || 1);
    if (this.globalEventsTriggered >= maxEvents) return;
    const eligible = GLOBAL_EVENT_DEFINITIONS.filter(event => event.eligible(this));
    if (!eligible.length) return;
    const chance = source === 'surprise'
      ? (this.settings.globalEvents === 'hardcore' ? 0.1 : 0.05)
      : (this.settings.globalEvents === 'hardcore' ? 0.045 : 0.018);
    if (Math.random() >= chance) return;
    const totalWeight = eligible.reduce((sum, event) => sum + (event.weight || 1), 0);
    let roll = Math.random() * totalWeight;
    const selected = eligible.find(event => (roll -= (event.weight || 1)) <= 0) || eligible[eligible.length - 1];
    this.activateGlobalEvent(selected);
  }

  activateGlobalEvent(definition) {
    const duration = Math.max(5, Math.min(10, Number(this.settings.globalEventDuration) || 5));
    const choices = definition.choices?.map(choice => ({ ...choice })) || null;
    const leader = definition.id === 'anti-monopoly'
      ? [...this.players].sort((a, b) => this.playerGroups(b).length - this.playerGroups(a).length)[0]
      : null;
    this.globalEvent = {
      id: definition.id,
      title: definition.title,
      category: definition.category,
      summary: definition.summary,
      effects: { ...(definition.effects || {}) },
      phase: choices ? 'voting' : 'warning',
      startedRound: this.roundNumber,
      voteRound: choices ? this.roundNumber : null,
      durationRounds: duration,
      roundsRemaining: choices ? 1 : 1,
      choices,
      votes: {},
      resolvedChoice: null,
      targetPlayerId: leader?.id || null
    };
    this.globalEventsTriggered += 1;
    this.feedMessage(choices
      ? `${definition.title} is live. The table votes before the next round.`
      : `${definition.title} is building. The table has one round to prepare.`);
  }

  resolveGlobalEventVote() {
    const event = this.globalEvent;
    if (!event || event.phase !== 'voting') return;
    const counts = Object.fromEntries((event.choices || []).map(choice => [choice.id, 0]));
    Object.values(event.votes || {}).forEach(choiceId => { if (counts[choiceId] != null) counts[choiceId] += 1; });
    const top = Math.max(...Object.values(counts), 0);
    const winners = Object.entries(counts).filter(([, count]) => count === top).map(([id]) => id);
    event.resolvedChoice = winners.length ? winners[Math.floor(Math.random() * winners.length)] : event.choices?.[0]?.id || null;
    event.phase = 'active';
    event.startedRound = this.roundNumber;
    event.roundsRemaining = event.durationRounds;
    this.feedMessage(`${event.title} resolved: ${String(event.resolvedChoice || '').replaceAll('-', ' ').toUpperCase()}.`);
  }

  voteGlobalEvent(socketId, choiceId) {
    const player = this.getPlayerBySocket(socketId);
    const event = this.globalEvent;
    if (!player || !event || event.phase !== 'voting') return { success: false, error: 'There is no active global vote.' };
    if (!this.activePlayers().some(candidate => candidate.id === player.id)) return { success: false, error: 'Only active players can vote.' };
    if (!event.choices?.some(choice => choice.id === choiceId)) return { success: false, error: 'That policy is not available.' };
    if (event.votes[player.id]) return { success: false, error: 'You already voted in this election.' };
    event.votes[player.id] = choiceId;
    this.feedMessage(`${player.nickname} cast a vote in the ${event.title.toLowerCase()}.`);
    const voters = this.activePlayers().filter(candidate => event.votes[candidate.id]).length;
    if (voters >= this.activePlayers().length) this.resolveGlobalEventVote();
    return { success: true };
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
        return this.handleChanceTile(player, options, 'surprise');
      case 'chest':
        return this.handleChanceTile(player, options, 'treasure');
      case 'jail':
        this.feedMessage(`${player.nickname} is visiting Jail.`);
        this.resolveTurnAfterAction(options);
        return { success: true };
      case 'parking':
        if (this.vacationPool > 0) {
          player.cash += this.vacationPool;
          this.feedMessage(`${player.nickname} swept the Vacation pool for $${this.vacationPool}.`);
          this.vacationPool = 0;
        } else {
          this.feedMessage(`${player.nickname} took a breather at Free Parking.`);
        }
        this.resolveTurnAfterAction(options);
        return { success: true };
      case 'goToVacation':
        player.position = this.tiles.find(tileItem => tileItem.type === 'jail').index;
        player.inJail = false;
        player.jailTurns = 0;
        this.vacationPool += 50;
        this.feedMessage(`${player.nickname} was sent on Vacation and added $50 to the pool.`);
        this.resolveTurnAfterAction({ ...options, allowExtraRoll: false });
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
    let amount = tile.amount || 0;
    if (this.globalEventActive('inflation-spiral')) amount = Math.ceil(amount * 1.4);
    if (this.globalEvent?.phase === 'active' && this.globalEvent.id === 'city-election' && this.globalEvent.resolvedChoice === 'low-tax') amount = Math.max(1, Math.floor(amount * 0.6));
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

  handleChanceTile(player, options = {}, deckName = 'surprise') {
    const card = this.drawCard(deckName);
    this.feedMessage(`${player.nickname} drew a card: ${card.text}`);
    const cashBefore = player.cash;
    const positionBefore = player.position;
    const result = this.applyCard(player, card, options);
    if (deckName === 'surprise') this.maybeTriggerGlobalEvent('surprise');
    const dynamicCashActions = ['repairs', 'payEach', 'collectFromEach', 'nearestRailroad', 'nearestUtility'];
    let cash = 0;
    if (dynamicCashActions.includes(card.action)) {
      cash = player.cash - cashBefore;
      if (['nearestRailroad', 'nearestUtility'].includes(card.action) && player.position < positionBefore) cash -= 200;
    } else if (card.action === 'pay') {
      cash = -(Number(card.amount) || 0);
    } else if (card.action === 'collect' || card.action === 'collectStart') {
      const amount = Number(card.amount) || 200;
      cash = this.globalEvent?.phase === 'active' && this.globalEvent.id === 'city-election' && this.globalEvent.resolvedChoice === 'low-tax' ? Math.floor(amount * 0.8) : amount;
    }
    return {
      ...(result || { success: true }),
      cardReveal: { tileIndex: player.position, text: card.text, action: card.action, cash }
    };
  }

  drawCard(deckName = 'surprise') {
    const key = deckName === 'treasure' ? 'treasureDeck' : 'surpriseDeck';
    const source = deckName === 'treasure' ? TREASURE_DECK : SURPRISE_DECK;
    if (this[key].length === 0) this[key] = [...source];
    const index = randomInt(0, this[key].length - 1);
    return this[key].splice(index, 1)[0];
  }

  applyCard(player, card, options = {}) {
    switch (card.action) {
      case 'collectStart':
        player.position = START_TILE_INDEX;
        {
          const amount = Number(card.amount) || 200;
          const paid = this.globalEvent?.phase === 'active' && this.globalEvent.id === 'city-election' && this.globalEvent.resolvedChoice === 'low-tax' ? Math.floor(amount * 0.8) : amount;
          player.cash += paid;
          this.feedMessage(`${player.nickname} collected $${paid} from Start.`);
        }
        break;
      case 'pay':
        this.chargePlayer(player, null, card.amount, `${player.nickname} paid $${card.amount}.`, options);
        return;
      case 'collect':
        {
          const amount = Number(card.amount) || 0;
          const paid = this.globalEvent?.phase === 'active' && this.globalEvent.id === 'city-election' && this.globalEvent.resolvedChoice === 'low-tax' ? Math.floor(amount * 0.8) : amount;
          player.cash += paid;
          this.feedMessage(`${player.nickname} collected $${paid}.`);
        }
        break;
      case 'jailFree':
        player.jailFreeCards = (player.jailFreeCards || 0) + 1;
        this.feedMessage(`${player.nickname} received a Get Out of Prison card.`);
        break;
      case 'moveBack':
        player.position = (player.position - (card.steps || 3) + this.tiles.length) % this.tiles.length;
        this.feedMessage(`${player.nickname} moved back ${card.steps || 3} spaces.`);
        return this.applyTile(player, this.getTile(player.position), options);
      case 'moveTo': {
        const destination = this.getTile(card.tileIndex);
        if (!destination) break;
        if (destination.index < player.position) {
          player.cash += 200;
          this.feedMessage(`${player.nickname} passed Start and collected $200.`);
        }
        player.position = destination.index;
        this.feedMessage(`${player.nickname} advanced to ${destination.name}.`);
        return this.applyTile(player, destination, options);
      }
      case 'nearestRailroad':
      case 'nearestUtility': {
        const wantedType = card.action === 'nearestRailroad' ? 'railroad' : 'utility';
        if (wantedType === 'railroad' && this.globalEventActive('airport-strike')) {
          this.feedMessage(`${player.nickname} drew an airport movement card, but the strike grounded every flight.`);
          this.resolveTurnAfterAction(options);
          return { success: true };
        }
        const destination = Array.from({ length: this.tiles.length - 1 }, (_, offset) => (player.position + offset + 1) % this.tiles.length)
          .map(index => this.getTile(index))
          .find(tile => tile?.type === wantedType);
        if (!destination) break;
        if (destination.index < player.position) {
          player.cash += 200;
          this.feedMessage(`${player.nickname} passed Start and collected $200.`);
        }
        player.position = destination.index;
        const owner = destination.ownerId ? this.getPlayerById(destination.ownerId) : null;
        if (owner && owner.id !== player.id && !destination.mortgaged) {
          const amount = wantedType === 'utility'
            ? (Number(this.lastDice[0]) + Number(this.lastDice[1])) * (card.multiplier || 10)
            : this.calculateRent(destination) * (card.multiplier || 2);
          this.chargePlayer(player, owner, amount, `${player.nickname} paid $${amount} card rent to ${owner.nickname}.`, options);
          return { success: true };
        }
        return this.applyTile(player, destination, options);
      }
      case 'repairs': {
        const houses = player.properties.reduce((sum, index) => {
          const level = this.getTile(index)?.houseCount || 0;
          return sum + (level === 5 ? 0 : level);
        }, 0);
        const hotels = player.properties.reduce((sum, index) => sum + ((this.getTile(index)?.houseCount || 0) === 5 ? 1 : 0), 0);
        const amount = houses * (card.houseCost || 0) + hotels * (card.hotelCost || 0);
        if (amount) this.chargePlayer(player, null, amount, `${player.nickname} paid $${amount} in building repairs.`, options);
        break;
      }
      case 'payEach': {
        const amount = card.amount || 0;
        this.activePlayers().filter(other => other.id !== player.id).forEach(other => {
          const paid = Math.min(player.cash, amount);
          player.cash -= paid;
          other.cash += paid;
        });
        this.feedMessage(`${player.nickname} paid each player $${amount} from the card.`);
        break;
      }
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
            const paid = Math.min(other.cash, card.amount || 0);
            other.cash -= paid;
            player.cash += paid;
          }
        });
        this.feedMessage(`${player.nickname} collected from each player.`);
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
    if (currentIndex >= 0 && nextIndex <= currentIndex) this.advanceRound();
    if (!this.started) return;
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
    if (this.auction.passedPlayerIds.includes(player.id)) {
      return { success: false, error: 'You have passed on this auction.' };
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

  passAuction(socketId) {
    const player = this.getPlayerBySocket(socketId);
    if (!player || !this.auction || !this.auction.active) {
      return { success: false, error: 'No auction is active.' };
    }
    if (this.auction.participants.length && !this.auction.participants.includes(player.id)) {
      return { success: false, error: 'You are not part of this auction.' };
    }
    if (this.auction.highestBidderId === player.id) {
      return { success: false, error: 'The current high bidder cannot pass.' };
    }
    if (!this.auction.passedPlayerIds.includes(player.id)) {
      this.auction.passedPlayerIds.push(player.id);
      this.feedMessage(`${player.nickname} passed on the auction.`);
    }
    const remaining = this.auction.participants.filter(id => !this.auction.passedPlayerIds.includes(id));
    if (this.auction.highestBidderId && remaining.length <= 1) {
      this.finishAuction();
      return { success: true, finished: true };
    }
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
      const saleMultiplier = this.globalEventActive('housing-bubble') ? 0.4 : 0.5;
      player.cash += Math.floor(cost * saleMultiplier);
      const label = wasHotel ? 'hotel' : 'house';
      this.feedMessage(`${player.nickname} sold a ${label} from ${tile.name}.`);
      result = { success: true };
    } else if (action === 'mortgage') {
      if (!this.canMortgageTile(player, tile)) {
        return { success: false, error: 'You cannot mortgage this property right now.' };
      }
      tile.mortgaged = true;
      const amount = Math.floor((tile.price || 0) / 2 * (this.globalEventActive('housing-bubble') ? 0.8 : 1));
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
        jailFreeCards: player.jailFreeCards || 0,
        bankLoan: player.bankLoan,
        bankLoanOffer: this.getBankLoanOffer(player),
        bankrupt: player.bankrupt,
        disconnected: player.disconnected,
        isHost: player.isHost,
        properties: player.properties,
        ready: player.ready,
        isBot: player.isBot,
        clientId: player.clientId,
        accountId: player.accountId || null
      })),
      feed: this.feed,
      roundNumber: this.roundNumber,
      globalEvent: this.globalEvent ? {
        ...this.globalEvent,
        votes: { ...this.globalEvent.votes },
        choices: this.globalEvent.choices?.map(choice => ({ ...choice })) || null
      } : null,
      globalEventHistory: this.globalEventHistory,
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
        passedPlayerIds: this.auction.passedPlayerIds,
        durationMs: AUCTION_DURATION_MS
      } : null,
      pendingTrade: this.pendingTrade,
      vacationPool: this.vacationPool
    };
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
      if (playerInfo.avatarGrid === null || Array.isArray(playerInfo.avatarGrid)) {
        existing.avatarGrid = playerInfo.avatarGrid;
      }
      if (playerInfo.accountId) existing.accountId = playerInfo.accountId;
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
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return;
      value = Math.max(2, Math.min(4, Math.floor(parsed)));
    } else if (key === 'bots') {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return;
      value = Math.max(0, Math.min(this.settings.maxPlayers - 1, Math.floor(parsed)));
    } else if (['startingCash', 'houseLimit', 'hotelLimit', 'turnTimer', 'globalEventDuration', 'globalEventMax'].includes(key)) {
      const parsed = Number(value);
      if (!Number.isFinite(parsed)) return;
      value = Math.max(0, Math.floor(parsed));
      if (key === 'globalEventDuration') value = value >= 10 ? 10 : 5;
      if (key === 'globalEventMax') value = value >= 2 ? 2 : 1;
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
    const result = this.game.startGame();
    if (result?.success) this.statsRecorded = false;
    return result;
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

  passAuction(socketId) {
    return this.game.passAuction(socketId);
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

  useJailFree(socketId) {
    return this.game.useJailFree(socketId);
  }

  getBankLoanOffer(socketId) {
    return this.game.getBankLoanOffer(this.game.getPlayerBySocket(socketId));
  }

  takeBankLoan(socketId) {
    return this.game.takeBankLoan(socketId);
  }

  repayBankLoan(socketId, payload) {
    return this.game.repayBankLoan(socketId, payload);
  }

  voteGlobalEvent(socketId, choiceId) {
    return this.game.voteGlobalEvent(socketId, choiceId);
  }

  declareBankruptcy(socketId) {
    return this.game.declareBankruptcy(socketId);
  }

  getRoomSummary() {
    return {
      roomCode: this.roomCode,
      roomName: this.roomName,
      visibility: this.visibility,
      capacity: this.settings.maxPlayers,
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
        isBot: player.isBot,
        accountId: player.accountId || null,
        avatarGrid: player.avatarGrid || null
      })),
      started: this.game.started,
      vacationPool: this.game.vacationPool
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

class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.socketRoom = new Map();
  }

  createRoom(hostInfo) {
    const player = new Player({ ...hostInfo, isHost: true });
    const room = new Room(player, { roomName: hostInfo.roomName, visibility: hostInfo.visibility, roomCode: hostInfo.roomCode });
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

  listPublicRooms() {
    return [...this.rooms.values()]
      .filter(room => room.visibility === 'public' && room.game.players.some(player => !player.disconnected && !player.bankrupt))
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

export { RoomManager };

