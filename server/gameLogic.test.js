import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { DeterministicAdvisor, DeepSeekAdvisor } from './botAdvisor.js';
import { AchievementStore } from './achievementStore.js';

function makeRoom() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A' });
  room.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B' });
  return room;
}

// --- Fix-phase contract suites (gameLogic items 4-9) -----------------------
// Frozen preset order per contract 6: CRIMSON, COBALT, AMBER, VERDANT.
const PRESET_COLORS = ['#d74438', '#286ea1', '#d9a62f', '#35a653'];

function playerOf(room, clientId) {
  return room.game.getPlayerByClient(clientId);
}

// Contract 7: generated room codes must never Map-overwrite an existing room.
async function testCreateRoomCodeCollision() {
  const nodeCrypto = (await import('crypto')).default;
  const manager = new RoomManager();
  const seeded = manager.createRoom({ socketId: 'socket-seed', clientId: 'client-seed', nickname: 'Seed', roomCode: 'AAAAAA' });
  const original = nodeCrypto.randomInt;
  // Force the generator: first code collides with AAAAAA, retry yields BBBBBB.
  const queue = [0, 0, 0, 0, 0, 0, 1, 1, 1, 1, 1, 1];
  nodeCrypto.randomInt = (min, max) => (min === 0 && max === 35 && queue.length ? queue.shift() : original(min, max));
  let generated;
  try {
    generated = manager.createRoom({ socketId: 'socket-gen', clientId: 'client-gen', nickname: 'Gen' });
  } finally {
    nodeCrypto.randomInt = original;
  }
  assert.notEqual(generated.roomCode, 'AAAAAA');
  assert.equal(manager.rooms.size, 2);
  assert.equal(manager.rooms.get('AAAAAA'), seeded);
  assert.equal(manager.rooms.get(generated.roomCode), generated);
}

// Contract 6: addOrReconnectPlayer / createRoom de-conflicts colors.
async function testJoinColorUniqueness() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A', color: PRESET_COLORS[0] });
  assert.equal(playerOf(room, 'client-a').color, '#d74438');
  // Explicit collision with a connected player → first preset not in use.
  const joined = room.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B', color: '#d74438' });
  assert.equal(joined.success, true);
  assert.equal(playerOf(room, 'client-b').color, '#286ea1');
  // A free requested color is kept as-is.
  const kept = room.addOrReconnectPlayer({ socketId: 'socket-c', clientId: 'client-c', nickname: 'C', color: '#d9a62f' });
  assert.equal(kept.success, true);
  assert.equal(playerOf(room, 'client-c').color, '#d9a62f');
  // Default appearance (audit A5.5: every fresh account is VERDANT) must also de-conflict.
  const defaults = new RoomManager();
  const lobby = defaults.createRoom({ socketId: 'socket-d', clientId: 'client-d', nickname: 'D' });
  assert.equal(playerOf(lobby, 'client-d').color, '#35a653');
  lobby.addOrReconnectPlayer({ socketId: 'socket-e', clientId: 'client-e', nickname: 'E' });
  assert.equal(playerOf(lobby, 'client-e').color, '#d74438');
  // All four presets in use (bots are players too) → keep the requested color.
  const packed = new RoomManager();
  const full = packed.createRoom({ socketId: 'socket-f', clientId: 'client-f', nickname: 'F', color: '#d74438' });
  full.addOrReconnectPlayer({ socketId: null, clientId: 'bot-1', nickname: 'BOT 1', color: '#286ea1', isBot: true });
  full.addOrReconnectPlayer({ socketId: null, clientId: 'bot-2', nickname: 'BOT 2', color: '#d9a62f', isBot: true });
  full.addOrReconnectPlayer({ socketId: null, clientId: 'bot-3', nickname: 'BOT 3', color: '#35a653', isBot: true });
  const desperate = full.addOrReconnectPlayer({ socketId: 'socket-g', clientId: 'client-g', nickname: 'G', color: '#d74438' });
  assert.equal(desperate.success, true);
  assert.equal(playerOf(full, 'client-g').color, '#d74438');
}

// Contract 6: GameState.setPlayerAppearance rejects duplicate colors.
async function testSetPlayerAppearance() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A', color: '#d74438' });
  room.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B', color: '#286ea1' });
  const a = playerOf(room, 'client-a');
  const b = playerOf(room, 'client-b');
  assert.equal(b.color, '#286ea1');
  // Duplicate color rejected — a differing custom avatarGrid does not exempt it (color is the identity).
  const dupe = room.game.setPlayerAppearance('socket-b', { color: '#d74438', avatarGrid: [[1, 0], [0, 1]] });
  assert.equal(dupe.success, false);
  assert.equal(dupe.error, 'That icon is already taken at this table.');
  assert.equal(b.color, '#286ea1');
  // Re-applying one's own look succeeds.
  assert.equal(room.game.setPlayerAppearance('socket-a', { color: '#d74438', nickname: 'A2', avatarGrid: null }).success, true);
  assert.equal(a.nickname, 'A2');
  // A free color applies.
  assert.equal(room.game.setPlayerAppearance('socket-b', { color: '#d9a62f' }).success, true);
  assert.equal(b.color, '#d9a62f');
  // Identity applies to non-preset colors too.
  assert.equal(room.game.setPlayerAppearance('socket-b', { color: '#123456' }).success, true);
  const offDupe = room.game.setPlayerAppearance('socket-a', { color: '#123456' });
  assert.equal(offDupe.success, false);
  assert.equal(offDupe.error, 'That icon is already taken at this table.');
  // Disconnected players are not "connected" and must not block a color.
  a.disconnected = true;
  assert.equal(room.game.setPlayerAppearance('socket-b', { color: '#d74438' }).success, true);
  a.disconnected = false;
  // Unknown socket keeps the pre-existing error.
  assert.equal(room.game.setPlayerAppearance('socket-zzz', { color: '#35a653' }).success, false);
}

// Contract 4: Room.hasConnectedHumans().
async function testHasConnectedHumans() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A' });
  assert.equal(room.hasConnectedHumans(), true);
  // Bot-only rooms are not human-occupied.
  const solo = new RoomManager();
  const empty = solo.createRoom({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B' });
  empty.game.removePlayerByClient('client-b');
  empty.addOrReconnectPlayer({ socketId: null, clientId: 'bot-1', nickname: 'BOT 1', isBot: true });
  assert.equal(empty.hasConnectedHumans(), false);
  // Disconnected humans do not count; reconnecting restores occupancy.
  const pair = new RoomManager();
  const lobby = pair.createRoom({ socketId: 'socket-c', clientId: 'client-c', nickname: 'C' });
  lobby.addOrReconnectPlayer({ socketId: 'socket-d', clientId: 'client-d', nickname: 'D' });
  playerOf(lobby, 'client-c').disconnected = true;
  playerOf(lobby, 'client-d').disconnected = true;
  assert.equal(lobby.hasConnectedHumans(), false);
  playerOf(lobby, 'client-d').disconnected = false;
  assert.equal(lobby.hasConnectedHumans(), true);
}

// Contract 5: listPublicRooms filters on hasConnectedHumans.
async function testListPublicRooms() {
  const manager = new RoomManager();
  const human = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A' });
  const botOnly = manager.createRoom({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B' });
  botOnly.game.removePlayerByClient('client-b');
  botOnly.addOrReconnectPlayer({ socketId: null, clientId: 'bot-1', nickname: 'BOT 1', isBot: true });
  const privateRoom = manager.createRoom({ socketId: 'socket-c', clientId: 'client-c', nickname: 'C', visibility: 'private' });
  let codes = manager.listPublicRooms().map(entry => entry.code);
  assert.equal(codes.includes(human.roomCode), true);
  assert.equal(codes.includes(botOnly.roomCode), false);
  assert.equal(codes.includes(privateRoom.roomCode), false);
  // Ghost rooms (human disconnected) vanish from the directory and return on reconnect.
  playerOf(human, 'client-a').disconnected = true;
  codes = manager.listPublicRooms().map(entry => entry.code);
  assert.equal(codes.includes(human.roomCode), false);
  playerOf(human, 'client-a').disconnected = false;
  codes = manager.listPublicRooms().map(entry => entry.code);
  assert.equal(codes.includes(human.roomCode), true);
  // Bots still count toward directory seats.
  const mixed = new RoomManager();
  const seatRoom = mixed.createRoom({ socketId: 'socket-d', clientId: 'client-d', nickname: 'D' });
  seatRoom.addOrReconnectPlayer({ socketId: null, clientId: 'bot-1', nickname: 'BOT 1', isBot: true });
  const listing = mixed.listPublicRooms().find(entry => entry.code === seatRoom.roomCode);
  assert.ok(listing);
  assert.equal(listing.seats, 2);
}

// Contract 8: getGameSummary players[] carry avatarGrid (same projection as getRoomSummary).
async function testGameSummaryAvatarGrid() {
  const room = makeRoom();
  const a = playerOf(room, 'client-a');
  a.avatarGrid = [[1, 0, 1], [0, 1, 0]];
  assert.equal(room.startGame().success, true);
  const summary = room.game.getGameSummary();
  const projected = summary.players.find(entry => entry.id === a.id);
  assert.equal('avatarGrid' in projected, true);
  assert.deepEqual(projected.avatarGrid, [[1, 0, 1], [0, 1, 0]]);
  const other = summary.players.find(entry => entry.id !== a.id);
  assert.equal('avatarGrid' in other, true);
  assert.equal(other.avatarGrid, null);
  // Viewer-scoped summary uses the same projection.
  const viewed = room.game.getGameSummary(a.id).players.find(entry => entry.id === a.id);
  assert.deepEqual(viewed.avatarGrid, [[1, 0, 1], [0, 1, 0]]);
}

// Contract 9: leaveRoomByClient fully releases the seat even mid-game.
async function testLeaveRoomByClientMidGame() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A' });
  room.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B' });
  room.addOrReconnectPlayer({ socketId: 'socket-c', clientId: 'client-c', nickname: 'C' });
  assert.equal(room.startGame().success, true);
  const b = playerOf(room, 'client-b');
  // Leaving on the departing player's turn: seat released AND turn advanced.
  room.game.currentPlayerId = b.id;
  const result = manager.leaveRoomByClient('client-b', 'socket-b');
  assert.equal(result, room);
  assert.equal(room.game.started, true);
  assert.equal(playerOf(room, 'client-b'), undefined);
  assert.equal(room.game.getPlayerBySocket('socket-b'), undefined);
  assert.equal(manager.getRoomBySocket('socket-b'), null);
  assert.notEqual(room.game.currentPlayerId, b.id);
  const nextUp = room.game.getPlayerById(room.game.currentPlayerId);
  assert.ok(nextUp);
  assert.equal(nextUp.disconnected, false);
  assert.equal(room.hasConnectedHumans(), true);
  // The remaining players leave in turn: the room ends GC-eligible (no connected players).
  manager.leaveRoomByClient('client-c', 'socket-c');
  const last = manager.leaveRoomByClient('client-a', 'socket-a');
  if (last) assert.equal(last.hasConnectedHumans(), false);
  assert.equal(room.hasConnectedHumans(), false);
  // Lobby leaves still fully remove the seat.
  const lobbyMgr = new RoomManager();
  const lobbyRoom = lobbyMgr.createRoom({ socketId: 'socket-l1', clientId: 'client-l1', nickname: 'L1' });
  lobbyRoom.addOrReconnectPlayer({ socketId: 'socket-l2', clientId: 'client-l2', nickname: 'L2' });
  const left = lobbyMgr.leaveRoomByClient('client-l2', 'socket-l2');
  assert.equal(left, lobbyRoom);
  assert.equal(playerOf(lobbyRoom, 'client-l2'), undefined);
}

async function run() {
  const room = makeRoom();
  assert.equal(room.getRoomSummary().roomCode, null);
  room.setRoomSetting('casino', true);
  room.setRoomSetting('market', true);
  assert.equal(room.startGame().success, true);

  const casino = room.placeCasinoBet('socket-a', 'red', 10, 'casino-1');
  assert.equal(casino.success, true);
  assert.equal(typeof casino.result.pocket, 'number');
  assert.equal(casino.result.balanceAfter >= 0, true);
  const casinoAgain = room.placeCasinoBet('socket-a', 'red', 10, 'casino-1');
  assert.deepEqual(casinoAgain.result, casino.result);

  const order = room.tradeMarket('socket-a', 'brazil', 'buy', 1, 'market-1');
  assert.equal(order.success, true);
  assert.equal(order.economy.market.positions.brazil.quantity, 1);
  const orderAgain = room.tradeMarket('socket-a', 'brazil', 'buy', 1, 'market-1');
  assert.deepEqual(orderAgain.order, order.order);

  const publicSummary = room.game.getGameSummary();
  assert.equal('marketPositions' in publicSummary.players[0], false);
  assert.equal(publicSummary.economy.market.enabled, true);

  const legacyRoom = makeRoom();
  legacyRoom.setRoomSetting('globalEventDuration', 10);
  legacyRoom.setRoomSetting('globalEventMax', 2);
  assert.equal(legacyRoom.settings.globalEventDuration, 5);
  assert.equal(legacyRoom.settings.globalEventMax, 1);
  legacyRoom.setRoomSetting('globalEvents', 'on');
  assert.equal(legacyRoom.settings.globalEvents, true);

  const eventRoom = makeRoom();
  assert.equal(eventRoom.startGame().success, true);
  eventRoom.game.activateGlobalEvent(eventRoom.game.globalEventDefinition('housing-bubble'));
  assert.equal(eventRoom.game.globalEvent.phase, 'warning');
  eventRoom.game.settings.casino = true;
  assert.equal(eventRoom.game.casinoLimits().maxBet, 500);
  eventRoom.game.advanceRound();
  assert.equal(eventRoom.game.globalEvent.phase, 'active');
  assert.equal(eventRoom.game.casinoLimits().maxBet, 300);
  for (let i = 0; i < eventRoom.game.globalEvent.durationRounds; i += 1) eventRoom.game.advanceRound();
  assert.equal(eventRoom.game.globalEvent.phase, 'recovery');
  eventRoom.game.advanceRound();
  assert.equal(eventRoom.game.globalEvent, null);

  const eventSettlementRoom = makeRoom();
  eventSettlementRoom.setRoomSetting('globalEvents', true);
  assert.equal(eventSettlementRoom.startGame().success, true);
  const maintenancePlayer = eventSettlementRoom.game.players[0];
  const maintenanceTile = eventSettlementRoom.game.getTile(1);
  maintenanceTile.ownerId = maintenancePlayer.id;
  maintenanceTile.houseCount = 2;
  maintenancePlayer.properties.push(maintenanceTile.index);
  eventSettlementRoom.game.activateGlobalEvent(eventSettlementRoom.game.globalEventDefinition('labor-strike'));
  eventSettlementRoom.game.advanceRound();
  assert.equal(eventSettlementRoom.game.globalEvent.phase, 'active');
  const cashBeforeMaintenance = maintenancePlayer.cash;
  eventSettlementRoom.game.advanceRound();
  assert.equal(maintenancePlayer.cash, cashBeforeMaintenance - 40);

  const bailoutRoom = makeRoom();
  bailoutRoom.setRoomSetting('globalEvents', true);
  assert.equal(bailoutRoom.startGame().success, true);
  const bailoutPlayer = bailoutRoom.game.players[0];
  bailoutPlayer.cash = 100;
  bailoutPlayer.bankLoan = { status: 'active', remaining: 450 };
  bailoutRoom.game.activateGlobalEvent(bailoutRoom.game.globalEventDefinition('bank-run'));
  bailoutRoom.game.voteGlobalEvent('socket-a', 'emergency-bailout');
  bailoutRoom.game.voteGlobalEvent('socket-b', 'emergency-bailout');
  assert.equal(bailoutRoom.game.globalEvent.phase, 'active');
  assert.equal(bailoutPlayer.bailoutReceived, true);
  assert.equal(bailoutPlayer.moralHazard, true);

  const botRoom = makeRoom();
  botRoom.setRoomSetting('bots', 1);
  botRoom.setRoomSetting('botPersonality', 'builder');
  assert.equal(botRoom.startGame().success, true);
  assert.equal(botRoom.game.players.filter(player => player.isBot).length, 1);
  assert.equal(botRoom.game.players.find(player => player.isBot).personality, 'builder');
  assert.equal(botRoom.game.turnOrder.length, 3);
  const botPlayer = botRoom.game.players.find(player => player.isBot);
  botRoom.game.currentPlayerId = botPlayer.id;
  const botCandidate = botRoom.game.getBotCandidates(botPlayer);
  assert.equal(Array.isArray(botCandidate), true);

  const comboRoom = makeRoom();
  comboRoom.setRoomSetting('globalEvents', true);
  assert.equal(comboRoom.startGame().success, true);
  comboRoom.game.roundNumber = 8;
  comboRoom.game.globalEventsTriggered = 1;
  comboRoom.game.globalEventHistory = [{ id: 'housing-bubble', title: 'HOUSING BUBBLE POP', comboId: null, endedRound: 7 }];
  comboRoom.game.players[0].bankLoan = { status: 'active' };
  comboRoom.game.activateGlobalEvent(comboRoom.game.globalEventDefinition('credit-freeze'), {
    id: 'foreclosure-spiral',
    title: 'FORECLOSURE SPIRAL',
    summary: 'The property crash meets a locked credit market.',
    effects: { constructionBlocked: true },
    duration: 8
  });
  assert.equal(comboRoom.game.globalEvent?.id, 'foreclosure-spiral');
  assert.equal(comboRoom.game.globalEvent?.comboId, 'foreclosure-spiral');
  assert.equal(comboRoom.game.casinoLimits().maxBet, 500);

  const advisor = new DeterministicAdvisor();
  const choice = await advisor.chooseAction({ personality: 'builder', candidates: [{ id: 'roll', kind: 'roll', score: 0 }, { id: 'build:1', kind: 'build', score: 1 }] });
  assert.equal(choice.actionId, 'build:1');
  const fallback = new DeepSeekAdvisor({ apiKey: 'test', fetchImpl: async () => ({ ok: true, json: async () => ({ choices: [{ message: { content: '{"actionId":"invented","confidence":2}' } }] }) }) });
  const safeFallback = await fallback.chooseAction({ candidates: [{ id: 'roll', kind: 'roll', score: 0 }] });
  assert.equal(safeFallback.actionId, 'roll');
  const financeRoom = makeRoom();
  assert.equal(financeRoom.startGame().success, true);
  const lender = financeRoom.game.players[0];
  const borrower = financeRoom.game.players[1];
  financeRoom.game.currentPlayerId = lender.id;
  const proposal = financeRoom.proposePlayerContract('socket-a', {
    toPlayerId: borrower.id, kind: 'loan', amount: 100, premiumRate: 20, durationRounds: 2, requestId: 'loan-proposal-1'
  });
  assert.equal(proposal.success, true);
  assert.equal(financeRoom.proposePlayerContract('socket-a', {
    toPlayerId: borrower.id, kind: 'loan', amount: 100, premiumRate: 20, durationRounds: 2, requestId: 'loan-proposal-1'
  }).contract.id, proposal.contract.id);
  assert.equal(financeRoom.respondPlayerContract('socket-b', true, 'loan-response-1').success, true);
  assert.equal(financeRoom.respondPlayerContract('socket-b', true, 'loan-response-1').contract.id, proposal.contract.id);
  const activeLoan = financeRoom.game.playerContracts[0];
  assert.equal(activeLoan.remaining, 120);
  assert.equal(financeRoom.repayPlayerContract('socket-b', { contractId: activeLoan.id, requestId: 'loan-repay-1' }).success, true);
  assert.equal(financeRoom.repayPlayerContract('socket-b', { contractId: activeLoan.id, requestId: 'loan-repay-1' }).contract.status, 'paid');
  assert.equal(activeLoan.status, 'paid');
  const equityTile = financeRoom.game.getTile(1);
  equityTile.ownerId = borrower.id;
  borrower.properties.push(equityTile.index);
  financeRoom.game.currentPlayerId = lender.id;
  const equityProposal = financeRoom.proposePlayerContract('socket-a', {
    toPlayerId: borrower.id, kind: 'equity', amount: 100, equityShare: 20, propertyIndex: equityTile.index, permanent: true
  });
  assert.equal(equityProposal.success, true);
  assert.equal(financeRoom.respondPlayerContract('socket-b', true).success, true);
  const equityContract = financeRoom.game.playerContracts.find(contract => contract.kind === 'equity');
  const lenderBeforeRent = lender.cash;
  const baseRent = financeRoom.game.calculateRent(equityTile);
  financeRoom.game.handleBuyableTile(lender, equityTile, { allowExtraRoll: false });
  assert.equal(equityContract.rentCollected, Math.floor(baseRent * 0.2));
  assert.equal(lender.cash, lenderBeforeRent - baseRent + equityContract.rentCollected);
  assert.equal(financeRoom.game.canMortgageTile(borrower, equityTile), false);

  const defaultRoom = makeRoom();
  assert.equal(defaultRoom.startGame().success, true);
  const defaultLender = defaultRoom.game.players[0];
  const defaultBorrower = defaultRoom.game.players[1];
  const defaultTile = defaultRoom.game.getTile(1);
  defaultTile.ownerId = defaultBorrower.id;
  defaultBorrower.properties.push(defaultTile.index);
  defaultRoom.game.currentPlayerId = defaultLender.id;
  assert.equal(defaultRoom.proposePlayerContract('socket-a', {
    requestId: 'default-proposal', toPlayerId: defaultBorrower.id, kind: 'loan', amount: 100, premiumRate: 20, durationRounds: 1, collateralTileIndex: defaultTile.index
  }).success, true);
  assert.equal(defaultRoom.respondPlayerContract('socket-b', true, 'default-response').success, true);
  const defaultContract = defaultRoom.game.playerContracts[0];
  defaultRoom.game.roundNumber = defaultContract.dueRound;
  defaultRoom.game.processPlayerContracts();
  assert.equal(defaultContract.status, 'due');
  defaultRoom.game.roundNumber = defaultContract.cureRound + 1;
  defaultRoom.game.processPlayerContracts();
  assert.equal(defaultContract.status, 'defaulted');
  assert.equal(defaultTile.ownerId, defaultLender.id);
  assert.equal(defaultRoom.game.getGameSummary().playerContracts.active.length, 0);

  const summaryTile = financeRoom.game.getGameSummary().tiles.find(tile => tile.index === equityTile.index);
  assert.equal(summaryTile.equityShares.length, 1);
  const redactedSummary = financeRoom.game.getGameSummary();
  const redactedEquity = redactedSummary.playerContracts.active.find(contract => contract.kind === 'equity');
  assert.equal(redactedEquity.amount, undefined);
  const ownerSummary = financeRoom.game.getGameSummary(lender.id);
  assert.equal(ownerSummary.playerContracts.active.find(contract => contract.kind === 'equity').amount, 100);

  const bankRoom = makeRoom();
  bankRoom.startGame();
  const bankPlayer = bankRoom.game.players[0];
  bankPlayer.cash = 100;
  bankRoom.game.currentPlayerId = bankPlayer.id;
  const bankLoan = bankRoom.takeBankLoan('socket-a', 'bank-loan-1');
  assert.equal(bankLoan.success, true);
  const bankAgain = bankRoom.takeBankLoan('socket-a', 'bank-loan-1');
  assert.deepEqual(bankAgain.loan, bankLoan.loan);
  const achievementEvaluator = new AchievementStore();
  const evaluated = achievementEvaluator.evaluateMatch({
    globalEvents: ['A', 'B'],
    eventCombinations: ['stagflation', 'foreclosure-spiral'],
    participants: [{
      accountId: 'acct',
      finalPlacement: 1,
      endingCash: 3000,
      propertyCount: 4,
      fullGroups: 1,
      auctionUnderListWins: 1,
      auctionWins: 2,
      maxRentPayersInRound: 3,
      airportVisits: 4,
      taxTilesVisited: 0,
      globalEventsExperienced: 1,
      soldBuildingsDuringHousingBubble: 3,
      bubbleSurvivor: true,
      rebuiltAfterHousingBubble: true,
      underdogAtHalfway: true,
      oneMoreTurn: true,
      groupTherapyTrade: true,
      coalitionTrade: true,
      unanimousVote: true,
      publicEnemy: true,
      bailoutReceived: true,
      moralHazard: true,
      tradesDuringCombo: 1,
      treasureCardsSeenList: Array.from({ length: 16 }, (_, i) => `card-${i}`),
      hiddenMovementSequence: true,
      bankLoanStatus: 'paid',
      bankLoanCount: 1,
      bankLoanDefaulted: false,
      badIdeaLoan: false,
      prisonBreak: true,
      bankrupt: false
    }, {
      accountId: 'other',
      endingCash: 100
    }]
  });
  assert.equal(evaluated.some(entry => entry.achievementId === 'full-street'), true);
  assert.equal(evaluated.some(entry => entry.achievementId === 'double-headline'), true);
  for (const id of ['fire-sale', 'bubble-survivor', 'short-the-street', 'underdog', 'one-more-turn', 'group-therapy', 'coalition-builder', 'unanimous', 'public-enemy', 'moral-hazard', 'stagflation-trader', 'no-floor', 'treasure-map']) {
    assert.equal(evaluated.some(entry => entry.achievementId === id), true, `expected ${id}`);
  }
  assert.equal(evaluated.some(entry => entry.achievementId === '41st-tile'), true);
  console.log('legacy smoke checks passed.');
}

const CONTRACT_SUITES = [
  ['contract 7 — createRoom generated codes never overwrite', testCreateRoomCodeCollision],
  ['contract 6 — join/create color collision auto-assign', testJoinColorUniqueness],
  ['contract 6 — setPlayerAppearance duplicate-color rejection', testSetPlayerAppearance],
  ['contract 4 — Room.hasConnectedHumans', testHasConnectedHumans],
  ['contract 5 — listPublicRooms browse purity', testListPublicRooms],
  ['contract 8 — getGameSummary players[] avatarGrid', testGameSummaryAvatarGrid],
  ['contract 9 — leaveRoomByClient mid-game seat release', testLeaveRoomByClientMidGame]
];

let passedCount = 0;
const failedSuites = [];
try {
  await run();
  passedCount += 1;
} catch (error) {
  failedSuites.push(['legacy smoke suite', error]);
  console.error(`FAIL — legacy smoke suite: ${error && error.message}`);
}
for (const [name, fn] of CONTRACT_SUITES) {
  try {
    await fn();
    passedCount += 1;
    console.log(`PASS — ${name}`);
  } catch (error) {
    failedSuites.push([name, error]);
    console.error(`FAIL — ${name}: ${error && error.message}`);
  }
}
const total = passedCount + failedSuites.length;
console.log(`gameLogic tests: ${total} suites — ${passedCount} passed, ${failedSuites.length} failed`);
if (failedSuites.length) {
  process.exitCode = 1;
}
