const DEFAULT_ROOM_SETTINGS = {
  maxPlayers: 4,
  privateRoom: false,
  allowBots: false,
  boardMap: 'classic',
  doubleRent: false,
  vacationCash: true,
  auction: true,
  noRentWhileInPrison: false,
  mortgage: true,
  evenBuild: true,
  randomizePlayerOrder: false,
  startingCash: 1500
};

const DEFAULT_TILES = [
  { index: 0, name: 'Start', type: 'start' },
  { index: 1, name: 'Salvador', type: 'property', group: 'Brown', price: 60, rent: 10, color: '#92400e' },
  { index: 2, name: 'Treasure', type: 'chance' },
  { index: 3, name: 'Rio', type: 'property', group: 'Brown', price: 60, rent: 10, color: '#92400e' },
  { index: 4, name: 'Earnings Tax', type: 'tax', amount: 200 },
  { index: 5, name: 'ACC Airport', type: 'utility', price: 200 },
  { index: 6, name: 'Accra', type: 'property', group: 'Light Blue', price: 100, rent: 14, color: '#38bdf8' },
  { index: 7, name: 'Surprise?', type: 'chance' },
  { index: 8, name: 'Tema', type: 'property', group: 'Light Blue', price: 100, rent: 14, color: '#38bdf8' },
  { index: 9, name: 'Kumasi', type: 'property', group: 'Light Blue', price: 120, rent: 16, color: '#38bdf8' },
  { index: 10, name: 'Passing By', type: 'jail' }, // Top Right Corner
  { index: 11, name: 'Pattaya', type: 'property', group: 'Pink', price: 140 },
  { index: 12, name: 'Electric Company', type: 'utility', price: 150 },
  { index: 13, name: 'Chiang Mai', type: 'property', group: 'Pink', price: 140 },
  { index: 14, name: 'Bangkok', type: 'property', group: 'Pink', price: 160 },
  { index: 15, name: 'BKK Airport', type: 'utility', price: 200 },
  { index: 16, name: 'Kyoto', type: 'property', group: 'Orange', price: 180 },
  { index: 17, name: 'Treasure', type: 'chance' },
  { index: 18, name: 'Osaka', type: 'property', group: 'Orange', price: 180 },
  { index: 19, name: 'Tokyo', type: 'property', group: 'Orange', price: 200 },
  { index: 20, name: 'Vacation', type: 'vacation' }, // Bottom Right Corner
  { index: 21, name: 'Eindhoven', type: 'property', group: 'Red', price: 220 },
  { index: 22, name: 'Surprise?', type: 'chance' },
  { index: 23, name: 'Rotterdam', type: 'property', group: 'Red', price: 220 },
  { index: 24, name: 'Amsterdam', type: 'property', group: 'Red', price: 240 },
  { index: 25, name: 'AMS Airport', type: 'utility', price: 200 },
  { index: 26, name: 'Calgary', type: 'property', group: 'Yellow', price: 260 },
  { index: 27, name: 'Vancouver', type: 'property', group: 'Yellow', price: 260 },
  { index: 28, name: 'Water Company', type: 'utility', price: 150 },
  { index: 29, name: 'Toronto', type: 'property', group: 'Yellow', price: 280 },
  { index: 30, name: 'Go to Prison', type: 'goToJail' }, // Bottom Left Corner
  { index: 31, name: 'Bern', type: 'property', group: 'Green', price: 300 },
  { index: 32, name: 'Geneva', type: 'property', group: 'Green', price: 300 },
  { index: 33, name: 'Treasure', type: 'chance' },
  { index: 34, name: 'Zurich', type: 'property', group: 'Green', price: 320 },
  { index: 35, name: 'MB Airport', type: 'utility', price: 200 },
  { index: 36, name: 'Surprise?', type: 'chance' },
  { index: 37, name: 'Downtown', type: 'property', group: 'Dark Blue', price: 350 },
  { index: 38, name: 'Premium Tax', type: 'tax', amount: 100 },
  { index: 39, name: 'Marina Bay', type: 'property', group: 'Dark Blue', price: 400 }
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

function cloneTiles() {
  return DEFAULT_TILES.map(tile => ({ ...tile, ownerId: null, mortgaged: false }));
}

class Player {
  constructor({ clientId, socketId, nickname, color, isHost = false, isBot = false }) {
    this.id = `${Math.random().toString(36).slice(2, 10)}-${Date.now().toString(36)}`;
    this.clientId = clientId || this.id;
    this.socketId = socketId;
    this.nickname = nickname || 'Player';
    this.color = color || '#84cc16';
    this.isHost = isHost;
    this.isBot = isBot;
    this.cash = DEFAULT_ROOM_SETTINGS.startingCash;
    this.position = 0;
    this.properties = [];
    this.inJail = false;
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
    this.pendingPurchaseOffer = null;
    this.started = false;
    this.feed = [];
    this.auction = null;
    this.vacationPool = 0;
    this.cardDeck = [...CARD_DECK];
  }

  addPlayer(player) {
    player.cash = this.settings.startingCash;
    player.position = 0;
    player.properties = [];
    player.inJail = false;
    player.bankrupt = false;
    player.disconnected = false;
    player.ready = false;
    this.players.push(player);
    this.feedMessage(`${player.nickname} joined the room.`);
    return player;
  }

  removePlayerBySocket(socketId) {
    const index = this.players.findIndex(player => player.socketId === socketId);
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
    if (color) {
      player.color = color;
    }
    if (nickname && !this.started) {
      player.nickname = nickname;
    }
    return { success: true };
  }

  getTile(index) {
    return this.tiles.find(tile => tile.index === index);
  }

  feedMessage(text) {
    this.feed.unshift({ text, timestamp: Date.now() });
    if (this.feed.length > 40) {
      this.feed.length = 40;
    }
  }

  canJoin() {
    return this.players.filter(player => !player.isBot && !player.bankrupt).length < this.settings.maxPlayers;
  }

  activePlayers() {
    return this.players.filter(player => !player.bankrupt && !player.disconnected);
  }

  configureStartOrder() {
    const active = [...this.players].filter(p => !p.bankrupt);
    if (this.settings.randomizePlayerOrder) {
      active.sort(() => Math.random() - 0.5);
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
    if (this.activePlayers().length < 2) {
      return { success: false, error: 'At least two players are required.' };
    }
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
    if (player.inJail) {
      return this.handleJailRoll(player);
    }
    const dice = rollDice();
    this.lastDice = dice;
    this.hasRolled = true;
    const move = dice[0] + dice[1];
    this.feedMessage(`${player.nickname} rolled ${dice[0]} and ${dice[1]} (${move}).`);
    return this.movePlayer(player, move);
  }

  handleJailRoll(player) {
    const dice = rollDice();
    this.lastDice = dice;
    this.hasRolled = true;
    if (dice[0] === dice[1]) {
      player.inJail = false;
      this.feedMessage(`${player.nickname} rolled doubles and escaped jail!`);
      return this.movePlayer(player, dice[0] + dice[1]);
    }
    this.feedMessage(`${player.nickname} failed to roll doubles in jail.`);
    this.nextTurn();
    return { success: true, message: 'You remain in jail and the turn has passed.' };
  }

  movePlayer(player, steps) {
    const oldPosition = player.position;
    player.position = (player.position + steps) % this.tiles.length;
    if (player.position < oldPosition) {
      player.cash += 200;
      this.feedMessage(`${player.nickname} passed Start and collected $200.`);
    }
    const tile = this.getTile(player.position);
    return this.applyTile(player, tile);
  }

  applyTile(player, tile) {
    switch (tile.type) {
      case 'start':
        this.feedMessage(`${player.nickname} landed on Start.`);
        this.nextTurn();
        return { success: true };
      case 'property':
        return this.handlePropertyTile(player, tile);
      case 'tax':
        return this.handleTaxTile(player, tile);
      case 'chance':
        return this.handleChanceTile(player);
      case 'jail':
        this.feedMessage(`${player.nickname} is visiting Jail.`);
        this.nextTurn();
        return { success: true };
      case 'goToJail':
        player.position = this.tiles.find(tileItem => tileItem.type === 'jail').index;
        player.inJail = true;
        this.feedMessage(`${player.nickname} was sent to Jail.`);
        this.nextTurn();
        return { success: true };
      case 'vacation':
        return this.handleVacationTile(player);
      case 'utility':
        return this.handleUtilityTile(player, tile);
      default:
        this.nextTurn();
        return { success: true };
    }
  }

  handlePropertyTile(player, tile) {
    if (tile.ownerId === null) {
      if (player.cash < tile.price) {
        this.feedMessage(`${player.nickname} cannot afford ${tile.name}.`);
        if (this.settings.auction) {
          this.startAuction(tile, player.id);
          return { success: true, auctionStarted: true };
        }
        this.nextTurn();
        return { success: true };
      }
      this.pendingPurchaseOffer = { playerId: player.id, tileIndex: tile.index };
      return { success: true, purchaseOffer: { tileIndex: tile.index, name: tile.name, price: tile.price } };
    }
    if (tile.ownerId === player.id) {
      this.feedMessage(`${player.nickname} landed on their own property.`);
      this.nextTurn();
      return { success: true };
    }
    const owner = this.getPlayerById(tile.ownerId);
    if (!owner || owner.bankrupt) {
      this.nextTurn();
      return { success: true };
    }
    if (owner.inJail && this.settings.noRentWhileInPrison) {
      this.feedMessage(`${player.nickname} landed on ${owner.nickname}'s property, but rent is not collected while the owner is in jail.`);
      this.nextTurn();
      return { success: true };
    }
    const rent = this.calculateRent(tile);
    this.transferMoney(player, owner, rent, `${player.nickname} paid $${rent} rent to ${owner.nickname}.`);
    this.nextTurn();
    return { success: true };
  }

  handleTaxTile(player, tile) {
    const amount = tile.amount || 0;
    if (this.settings.vacationCash) {
      this.vacationPool += amount;
      this.feedMessage(`${player.nickname} paid $${amount} in tax into Vacation cash.`);
    } else {
      this.deductMoney(player, amount, `${player.nickname} paid $${amount} in tax.`);
    }
    this.nextTurn();
    return { success: true };
  }

  handleVacationTile(player) {
    if (this.vacationPool > 0) {
      player.cash += this.vacationPool;
      this.feedMessage(`${player.nickname} collected $${this.vacationPool} from Vacation cash.`);
      this.vacationPool = 0;
    } else {
      this.feedMessage(`${player.nickname} landed on Vacation.`);
    }
    this.nextTurn();
    return { success: true };
  }

  handleUtilityTile(player, tile) {
    if (tile.ownerId === null) {
      if (player.cash >= tile.price) {
        this.pendingPurchaseOffer = { playerId: player.id, tileIndex: tile.index };
        return { success: true, purchaseOffer: { tileIndex: tile.index, name: tile.name, price: tile.price } };
      }
      this.feedMessage(`${player.nickname} cannot afford ${tile.name}.`);
      this.nextTurn();
      return { success: true };
    }
    if (tile.ownerId !== player.id) {
      const owner = this.getPlayerById(tile.ownerId);
      const rent = tile.rent || 20;
      this.transferMoney(player, owner, rent, `${player.nickname} paid $${rent} rent to ${owner.nickname}.`);
    }
    this.nextTurn();
    return { success: true };
  }

  handleChanceTile(player) {
    const card = this.drawCard();
    this.feedMessage(`${player.nickname} drew a card: ${card.text}`);
    const result = this.applyCard(player, card);
    return result || { success: true };
  }

  drawCard() {
    if (this.cardDeck.length === 0) {
      this.cardDeck = [...CARD_DECK];
    }
    const index = randomInt(0, this.cardDeck.length - 1);
    return this.cardDeck.splice(index, 1)[0];
  }

  applyCard(player, card) {
    switch (card.action) {
      case 'collectStart':
        player.cash += 200;
        this.feedMessage(`${player.nickname} collected $200 from Start.`);
        break;
      case 'pay':
        this.deductMoney(player, card.amount, `${player.nickname} paid $${card.amount}.`);
        break;
      case 'collect':
        player.cash += card.amount;
        this.feedMessage(`${player.nickname} collected $${card.amount}.`);
        break;
      case 'move':
        player.position = card.tileIndex;
        this.feedMessage(`${player.nickname} moved to ${this.getTile(card.tileIndex).name}.`);
        return this.applyTile(player, this.getTile(card.tileIndex));
      case 'goToJail':
        player.position = this.tiles.find(tile => tile.type === 'jail').index;
        player.inJail = true;
        this.feedMessage(`${player.nickname} was sent to Jail by a card.`);
        break;
      case 'collectFromEach':
        const alive = this.activePlayers();
        alive.forEach(other => {
          if (other.id !== player.id) {
            this.transferMoney(other, player, card.amount, `${other.nickname} paid $${card.amount} to ${player.nickname}.`);
          }
        });
        break;
      default:
        break;
    }
    this.nextTurn();
  }

  nextTurn() {
    const active = this.players.filter(player => !player.bankrupt && !player.disconnected);
    if (active.length <= 1) {
      this.endGame();
      return;
    }
    const currentIndex = this.turnOrder.indexOf(this.currentPlayerId);
    let nextIndex = (currentIndex + 1) % this.turnOrder.length;
    let nextPlayer = this.getPlayerById(this.turnOrder[nextIndex]);
    while (nextPlayer && (nextPlayer.bankrupt || nextPlayer.disconnected)) {
      nextIndex = (nextIndex + 1) % this.turnOrder.length;
      nextPlayer = this.getPlayerById(this.turnOrder[nextIndex]);
    }
    this.currentPlayerId = nextPlayer ? nextPlayer.id : null;
    this.hasRolled = false;
    if (this.currentPlayerId) {
      this.feedMessage(`${this.getPlayerById(this.currentPlayerId).nickname}'s turn.`);
    }
  }

  calculateRent(tile) {
    let amount = tile.rent || 0;
    if (tile.group && this.settings.doubleRent && this.hasFullSet(tile.ownerId, tile.group)) {
      amount *= 2;
    }
    return amount;
  }

  hasFullSet(ownerId, group) {
    const groupTiles = this.tiles.filter(tile => tile.group === group);
    return groupTiles.every(tile => tile.ownerId === ownerId);
  }

  transferMoney(from, to, amount, message) {
    from.cash -= amount;
    to.cash += amount;
    this.feedMessage(message);
    if (from.cash < 0) {
      this.handleBankruptcy(from);
    }
  }

  deductMoney(player, amount, message) {
    player.cash -= amount;
    this.feedMessage(message);
    if (player.cash < 0) {
      this.handleBankruptcy(player);
    }
  }

  handleBankruptcy(player) {
    player.bankrupt = true;
    player.properties.forEach(propertyIndex => {
      const tile = this.getTile(propertyIndex);
      if (tile) {
        tile.ownerId = null;
      }
    });
    player.properties = [];
    this.feedMessage(`${player.nickname} is bankrupt and removed from the game.`);
    if (this.activePlayers().length <= 1) {
      this.endGame();
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
    player.properties.push(tile.index);
    this.feedMessage(`${player.nickname} purchased ${tile.name} for $${tile.price}.`);
    this.pendingPurchaseOffer = null;
    this.nextTurn();
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
      return { success: true, message: 'Auction started for the declined property.' };
    }
    this.feedMessage(`${player.nickname} declined to buy ${tile.name}.`);
    this.nextTurn();
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
    if (amount <= this.auction.highestBid) {
      return { success: false, error: 'Bid must be higher than the current bid.' };
    }
    if (amount > player.cash) {
      return { success: false, error: 'Insufficient funds for this bid.' };
    }
    this.auction.highestBid = amount;
    this.auction.highestBidderId = player.id;
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
      this.nextTurn();
      this.auction = null;
      return;
    }
    const winner = this.getPlayerById(auction.highestBidderId);
    if (!winner) {
      this.feedMessage(`Auction ended without a valid winner.`);
      this.nextTurn();
      this.auction = null;
      return;
    }
    winner.cash -= auction.highestBid;
    auction.propertyTile.ownerId = winner.id;
    winner.properties.push(auction.propertyTile.index);
    this.feedMessage(`${winner.nickname} won the auction for ${auction.propertyTile.name} at $${auction.highestBid}.`);
    if (winner.cash < 0) {
      this.handleBankruptcy(winner);
    }
    this.nextTurn();
    this.auction = null;
  }

  endTurn(socketId) {
    const player = this.getPlayerBySocket(socketId);
    if (!player || player.id !== this.currentPlayerId) {
      return { success: false, error: 'Only the active player can end the turn.' };
    }
    if (!this.hasRolled) {
      return { success: false, error: 'You must roll the dice before ending your turn.' };
    }
    if (this.auction?.active) {
      return { success: false, error: 'Finish the active auction before ending the turn.' };
    }
    if (this.pendingPurchaseOffer?.playerId === player.id) {
      return { success: false, error: 'Resolve the property offer before ending the turn.' };
    }
    this.nextTurn();
    return { success: true };
  }

  endGame() {
    const winner = this.activePlayers()[0];
    if (winner) {
      this.feedMessage(`${winner.nickname} is the last player remaining and wins the game!`);
    } else {
      this.feedMessage('The game has ended.');
    }
    this.started = false;
    this.currentPlayerId = null;
  }

  getGameSummary() {
    return {
      started: this.started,
      currentPlayerId: this.currentPlayerId,
      turnOrder: this.turnOrder || [],
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
        mortgaged: tile.mortgaged
      })),
      players: this.players.map(player => ({
        id: player.id,
        nickname: player.nickname,
        color: player.color,
        cash: player.cash,
        position: player.position,
        inJail: player.inJail,
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
        participants: this.auction.participants
      } : null,
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
      existing.nickname = playerInfo.nickname || existing.nickname;
      existing.color = playerInfo.color || existing.color;
      return { success: true, player: existing };
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
    if (Object.prototype.hasOwnProperty.call(this.settings, key)) {
      this.settings[key] = value;
      this.game.settings[key] = value;
      if (key === 'startingCash') {
        this.game.players.forEach(player => {
          player.cash = Number(value);
        });
      }
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

  endTurn(socketId) {
    return this.game.endTurn(socketId);
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
    const room = [...this.rooms.values()].find(roomItem => roomItem.game.getPlayerByClient(clientId));
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
    const player = room.getPlayerBySocket(socketId);
    if (player) {
      player.disconnected = true;
    }
    if (room.hostId === player?.id) {
      const available = room.game.players.find(p => !p.disconnected && !p.bankrupt && p.id !== player.id);
      if (available) {
        room.hostId = available.id;
      }
    }
    return room;
  }
}

module.exports = { RoomManager };
