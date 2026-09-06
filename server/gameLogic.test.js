import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { DeterministicAdvisor, DeepSeekAdvisor } from './botAdvisor.js';
import { AchievementStore } from './achievementStore.js';
import { AccountStore } from './accountStore.js';
import { MatchStore } from './matchStore.js';
import fs from 'node:fs';

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

// Contract 10: live turns hold for an explicit endTurn after the landing resolves.
async function testExplicitEndTurn() {
  const nodeCrypto = (await import('crypto')).default;
  const original = nodeCrypto.randomInt;
  // Queue the next die faces: rollDice draws randomInt(1, 7) twice.
  const diceQueue = [];
  nodeCrypto.randomInt = (min, max) => (min === 1 && max === 7 && diceQueue.length ? diceQueue.shift() : original(min, max));
  try {
    const room = makeRoom();
    room.startGame();
    const a = room.game.players[0];
    const b = room.game.players[1];
    assert.equal(room.game.currentPlayerId, a.id);

    // Ending before rolling is rejected.
    assert.equal(room.endTurn('socket-a').success, false);

    // Land on Passing By (tile 10, jail visit): 7 + 1 + 2. The turn must HOLD.
    a.position = 7;
    diceQueue.push(1, 2);
    assert.equal(room.rollDice('socket-a').success, true);
    assert.equal(a.position, 10);
    assert.equal(room.game.awaitingEndTurn, true);
    assert.equal(room.game.currentPlayerId, a.id, 'turn must not auto-advance');
    assert.equal(room.game.getGameSummary().awaitingEndTurn, true);

    // Only the active player may end.
    assert.equal(room.endTurn('socket-b').success, false);
    const ended = room.endTurn('socket-a');
    assert.equal(ended.success, true);
    assert.equal(room.game.currentPlayerId, b.id);
    assert.equal(room.game.awaitingEndTurn, false);
    assert.equal(room.game.hasRolled, false);

    // Doubles retain the turn for the forced re-roll: no hold, no ending.
    room.game.getTile(15).ownerId = b.id; // BKK Airport — B's own tile, a plain landing
    b.position = 4;
    diceQueue.push(3, 3); // 4 + 6 = 10 → jail visit with doubles pending
    assert.equal(room.rollDice('socket-b').success, true);
    assert.equal(room.game.awaitingEndTurn, false);
    assert.equal(room.game.extraRollPending, true);
    assert.equal(room.game.currentPlayerId, b.id);
    assert.equal(room.endTurn('socket-b').success, false, 'doubles force the re-roll');
    diceQueue.push(2, 3); // 10 + 5 = 15 → own railroad → plain landing → hold
    assert.equal(room.rollDice('socket-b').success, true);
    assert.equal(room.game.awaitingEndTurn, true);
    assert.equal(room.endTurn('socket-b').success, true);

    // Jail stay: failing to roll doubles holds the turn instead of passing it.
    assert.equal(room.game.currentPlayerId, a.id);
    a.inJail = true;
    a.jailTurns = 0;
    diceQueue.push(1, 3);
    assert.equal(room.rollDice('socket-a').success, true);
    assert.equal(room.game.awaitingEndTurn, true, 'jail stay must hold for an explicit end');
    assert.equal(room.game.currentPlayerId, a.id);
    assert.equal(room.endTurn('socket-a').success, true);
    assert.equal(room.game.currentPlayerId, b.id);
  } finally {
    nodeCrypto.randomInt = original;
  }
}

// ---------------------------------------------------------------------------
// Stores characterization. The FIX_* fixtures below and the GOLDEN_* constants
// were captured verbatim from the pre-refactor stores (main @ e23788d, 2026-09-04).
// Dynamic ids/timestamps normalize to sentinels (<iso>, <uuid>, <acct>). This pins
// current outputs so the participant-schema extraction must be equivalent.
// ---------------------------------------------------------------------------

const isRecursable = (value) => Boolean(value) && typeof value === 'object' && !(value instanceof Set);

const replaceAcctSentinel = (value, acctId) => {
  if (typeof value === 'string') return value === '<acct>' ? acctId : value;
  if (Array.isArray(value)) return value.map((item) => replaceAcctSentinel(item, acctId));
  if (isRecursable(value)) {
    const next = {};
    for (const key of Object.keys(value)) next[key] = replaceAcctSentinel(value[key], acctId);
    return next;
  }
  return value;
};

// Dynamic string shapes that vary run to run, mapped to their sentinel.
// Table-driven so adding a shape (e.g. a new id prefix) is one row, not a
// new branch in normalizeDynamic's cyclomatic path.
const DYNAMIC_SENTINELS = [
  [/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/, '<iso>'],
  [/^match_[0-9a-f-]{36}$/, '<uuid>'],
  [/^acct_[0-9a-f-]{36}$/, '<acct>']
];

function stringSentinel(value) {
  const rule = DYNAMIC_SENTINELS.find(([pattern]) => pattern.test(value));
  return rule ? rule[1] : value;
}

const normalizeDynamic = (value) => {
  if (typeof value === 'string') return stringSentinel(value);
  if (Array.isArray(value)) return value.map(normalizeDynamic);
  if (value && typeof value === 'object') {
    const next = {};
    for (const key of Object.keys(value)) {
      // undefined-valued own keys are invisible in the JSON form the stores
      // persist; strip them so deepEqual compares the persisted contract.
      if (value[key] === undefined) continue;
      next[key] = normalizeDynamic(value[key]);
    }
    return next;
  }
  return value;
};

const FIX_garbage = {
  matchId: 'x'.repeat(200),
  completedAt: 12345,
  durationSeconds: 'nope',
  roundCount: -5,
  roomVisibility: 'SECRET',
  participants: 'not-an-array',
  globalEvents: ['a', 3, 'b'],
  eventCombinations: null,
  tradesCompleted: 'many',
  auctionsCompleted: {},
  casino: [{ accountId: 7, bets: '2.5', net: 'bad' }],
  market: [{ accountId: 'm1', positions: 'nope' }],
  playerContracts: [{ id: 'i', kind: 'weird', fromAccountId: 5, amount: '-3', status: 's'.repeat(50), premiumRate: 'r', equityShare: null, collateralTileIndex: 'abc' }],
}
const FIX_nullparts = { matchId: 'm-null', participants: null }
const FIX_full = {
  matchId: 'm-full',
  completedAt: '2026-09-04T00:00:00.000Z',
  durationSeconds: 600.5,
  roundCount: 3,
  roomVisibility: 'private',
  participants: [
    {
      accountId: 'a1',
      displayNameAtMatch: 'P'.repeat(50),
      colorAtMatch: '#abc',
      finalPlacement: 0,
      endingCash: '1500',
      propertyCount: 2,
      bankrupt: 'yes',
      disconnected: true,
      auctionWins: 1,
      rentCollected: '10.9',
      globalEventsExperienced: 2,
      globalEventsSurvived: 1,
      casinoNet: -50,
      casinoBets: 8,
      casinoMaxStake: 100,
      casinoTotalStaked: 200,
      casinoAllIn: true,
      casinoOneDollar: false,
      marketTrades: 10,
      crisisMarketProfit: true,
      bankLoanStatus: 'defaulted',
      bankLoanDefaulted: true,
      bankLoanCount: 2,
      airportVisits: 4,
      taxTilesVisited: 1,
      maxRentPayersInRound: 3,
      auctionUnderListWins: 1,
      loanWarningSeen: true,
      badIdeaLoan: true,
      prisonBreak: true,
      fullGroups: 1,
      evenBuilds: 2,
      councilWins: 1,
      publicWorksBuilds: 1,
      cardDraws: { surprise: 2, treasure: '3' },
      zeroCashReached: true,
      collateralLost: true,
      comboExperienced: true,
      bubbleSurvivor: true,
      rebuiltAfterHousingBubble: true,
      foreclosureNoSecondLoan: true,
      housingBubbleEnded: true,
      soldBuildingsDuringHousingBubble: 3,
      boughtDuringHousingBubble: true,
      airportOwnedDuringStrike: true,
      nonAirportRentDuringStrike: false,
      tradesDuringCombo: 1,
      groupTherapyTrade: true,
      unanimousVote: true,
      publicEnemy: true,
      compromisedCouncil: true,
      coalitionTrade: true,
      bailoutReceived: true,
      moralHazard: true,
      treasureCardsSeen: 16,
      treasureCardsSeenList: ['t'.repeat(200)].concat(Array.from({ length: 40 }, (_, i) => `c${i}`)),
      underdogAtHalfway: true,
      oneMoreTurn: true,
      moveCount: 25,
      hiddenMovementSequence: true,
    },
    // every field missing
    { accountId: 'a2' },
  ],
  globalEvents: Array.from({ length: 25 }, (_, i) => `E${i}x`.repeat(50)),
  eventCombinations: ['stagflation', 7],
  tradesCompleted: 5,
  auctionsCompleted: 2,
  casino: [{ accountId: 'a1', bets: 8, net: -50 }],
  market: [{ accountId: 'a1', positions: { X: { realizedPnl: 10 } } }],
  playerContracts: [
    { id: 'c1', kind: 'equity', fromAccountId: 'a1', toAccountId: 'a2', fromPlayerId: 'p1', toPlayerId: 'p2', amount: 500, status: 'paid', premiumRate: 0.1, equityShare: 0.2, collateralTileIndex: 12 },
    { id: 'c2', kind: 'loan', fromAccountId: 'a1', toAccountId: 'a2', amount: 'x', status: 'active', premiumRate: -1, equityShare: 'y', collateralTileIndex: 'z' },
  ],
}
const FIX_contractInput = {
  participants: [{ accountId: 'x1' }, { accountId: 'x2' }],
  playerContracts: [
    { kind: 'loan', status: 'paid', fromAccountId: 'x1', collateralTileIndex: null },
    { kind: 'loan', status: 'defaulted', fromAccountId: 'x1', collateralTileIndex: 5 },
    { kind: 'loan', status: 'paid', fromAccountId: 'x2', collateralTileIndex: null },
  ],
}
const FIX_histInputY = { participants: [{ accountId: 'y', treasureCardsSeenList: ['a', 'b'] }] }
const FIX_histInputZ = { participants: [{ accountId: 'z', treasureCardsSeenList: ['a', 'b'] }] }
const FIX_histPastZ = [{ participants: [{ accountId: 'z', treasureCardsSeenList: ['c', 'd'] }] }]
const FIX_playerFull = {
  id: 'p1', accountId: '<acct>', nickname: 'FN', color: '#fff', cash: 1234,
  properties: [1, 2, 3], bankrupt: false, disconnected: false,
  auctionWins: 2, rentCollected: 300, globalEventsExperienced: 2, globalEventsSurvived: 1,
  casinoLedger: [1, 2, 3], casinoMaxStake: 90, casinoTotalStaked: 240, casinoAllIn: true, casinoOneDollar: true,
  marketTrades: 11, crisisMarketProfit: true,
  bankLoan: { status: 'paid' }, bankLoanCount: 2,
  airportVisits: new Set([1, 2, 3, 4]), taxTilesVisited: new Set(['tax1']),
  maxRentPayersInRound: 3, auctionUnderListWins: 1, loanWarningSeen: true, badIdeaLoan: true, prisonBreak: true,
  fullGroups: new Set(['g1']), evenBuilds: 3, councilWins: 1, publicWorksBuilds: 2,
  cardDraws: { surprise: 1, treasure: 2 },
  zeroCashReached: true, collateralLost: true, comboExperienced: true, bubbleSurvivor: true,
  rebuiltAfterHousingBubble: true, foreclosureNoSecondLoan: true, housingBubbleEnded: true,
  soldBuildingsDuringHousingBubble: 4, boughtDuringHousingBubble: true,
  airportOwnedDuringStrike: true, nonAirportRentDuringStrike: true,
  tradesDuringCombo: 2, groupTherapyTrade: true, unanimousVote: true, publicEnemy: true,
  compromisedCouncil: true, coalitionTrade: true, bailoutReceived: true, moralHazard: true,
  treasureCardsSeen: new Set(['t1', 't2']), underdogAtHalfway: true, oneMoreTurn: true,
  moveCount: 30, hiddenMovementSequence: true,
}
const FIX_playerDefaulted = { id: 'p2', accountId: '<acct>', bankLoan: { status: 'defaulted' }, cash: '2.9' }
const FIX_meta = {
  gameId: 'game-1', completedAt: '2026-09-04T00:00:00.000Z', durationSeconds: 900, roundCount: 5,
  roomVisibility: 'private', globalEvents: Array.from({ length: 25 }, (_, i) => `e${i}`),
  eventCombinations: ['a'], tradesCompleted: 3, auctionsCompleted: 4,
  casino: [{ accountId: '<acct>', bets: 3, net: -10 }],
  market: [{ accountId: '<acct>', positions: { A: { realizedPnl: '5' }, B: { realizedPnl: 'junk' } } }],
  playerContracts: [
    { kind: 'loan', status: 'paid', fromAccountId: '<acct>', toAccountId: 'other' },
    { kind: 'loan', status: 'defaulted', fromAccountId: 'other', toAccountId: '<acct>' },
    { kind: 'loan', status: 'active', fromAccountId: '<acct>', toAccountId: 'other' },
    { kind: 'equity', status: 'paid', fromAccountId: 'other', toAccountId: '<acct>' },
  ],
}
const GOLDEN_GARBAGE = {"matchId":"xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx","completedAt":"<iso>","durationSeconds":0,"roundCount":0,"roomVisibility":"public","participants":[],"globalEvents":["a","b"],"eventCombinations":[],"tradesCompleted":0,"auctionsCompleted":0,"casino":[{"accountId":null,"bets":2.5,"net":0}],"market":[{"accountId":"m1","positions":{}}],"playerContracts":[{"id":"i","kind":"loan","fromAccountId":null,"toAccountId":null,"fromPlayerId":null,"toPlayerId":null,"amount":0,"status":"ssssssssssssssssssss","premiumRate":0,"equityShare":0,"collateralTileIndex":null}]};
const GOLDEN_NULLPARTS = {"created":true,"match":{"matchId":"m-null","completedAt":"<iso>","durationSeconds":0,"roundCount":0,"roomVisibility":"public","participants":[],"globalEvents":[],"eventCombinations":[],"tradesCompleted":0,"auctionsCompleted":0,"casino":[],"market":[],"playerContracts":[]}};
const GOLDEN_FULL = {"matchId":"m-full","completedAt":"<iso>","durationSeconds":600.5,"roundCount":3,"roomVisibility":"private","participants":[{"accountId":"a1","displayNameAtMatch":"PPPPPPPPPPPPPPPPPPPPPPPP","colorAtMatch":"#abc","finalPlacement":1,"endingCash":1500,"propertyCount":2,"bankrupt":false,"disconnected":true,"auctionWins":1,"rentCollected":10.9,"globalEventsExperienced":2,"globalEventsSurvived":1,"casinoNet":-50,"casinoBets":8,"casinoMaxStake":100,"casinoTotalStaked":200,"casinoAllIn":true,"casinoOneDollar":false,"marketTrades":10,"crisisMarketProfit":true,"bankLoanStatus":"defaulted","bankLoanDefaulted":true,"bankLoanCount":2,"airportVisits":4,"taxTilesVisited":1,"maxRentPayersInRound":3,"auctionUnderListWins":1,"loanWarningSeen":true,"badIdeaLoan":true,"prisonBreak":true,"fullGroups":1,"evenBuilds":2,"councilWins":1,"publicWorksBuilds":1,"cardDraws":{"surprise":2,"treasure":3},"zeroCashReached":true,"collateralLost":true,"comboExperienced":true,"bubbleSurvivor":true,"rebuiltAfterHousingBubble":true,"foreclosureNoSecondLoan":true,"housingBubbleEnded":true,"soldBuildingsDuringHousingBubble":3,"boughtDuringHousingBubble":true,"airportOwnedDuringStrike":true,"nonAirportRentDuringStrike":false,"tradesDuringCombo":1,"groupTherapyTrade":true,"unanimousVote":true,"publicEnemy":true,"compromisedCouncil":true,"coalitionTrade":true,"bailoutReceived":true,"moralHazard":true,"treasureCardsSeen":16,"treasureCardsSeenList":["tttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttttt","c0","c1","c2","c3","c4","c5","c6","c7","c8","c9","c10","c11","c12","c13","c14","c15","c16","c17","c18","c19","c20","c21","c22","c23","c24","c25","c26","c27","c28","c29","c30"],"underdogAtHalfway":true,"oneMoreTurn":true,"moveCount":25,"hiddenMovementSequence":true},{"accountId":"a2","displayNameAtMatch":"PLAYER","colorAtMatch":"#35a653","finalPlacement":null,"endingCash":0,"propertyCount":0,"bankrupt":false,"disconnected":false,"auctionWins":0,"rentCollected":0,"globalEventsExperienced":0,"globalEventsSurvived":0,"casinoNet":0,"casinoBets":0,"casinoMaxStake":0,"casinoTotalStaked":0,"casinoAllIn":false,"casinoOneDollar":false,"marketTrades":0,"crisisMarketProfit":false,"bankLoanStatus":null,"bankLoanDefaulted":false,"bankLoanCount":0,"airportVisits":0,"taxTilesVisited":0,"maxRentPayersInRound":0,"auctionUnderListWins":0,"loanWarningSeen":false,"badIdeaLoan":false,"prisonBreak":false,"fullGroups":0,"evenBuilds":0,"councilWins":0,"publicWorksBuilds":0,"cardDraws":{"surprise":0,"treasure":0},"zeroCashReached":false,"collateralLost":false,"comboExperienced":false,"bubbleSurvivor":false,"rebuiltAfterHousingBubble":false,"foreclosureNoSecondLoan":false,"housingBubbleEnded":false,"soldBuildingsDuringHousingBubble":0,"boughtDuringHousingBubble":false,"airportOwnedDuringStrike":false,"nonAirportRentDuringStrike":false,"tradesDuringCombo":0,"groupTherapyTrade":false,"unanimousVote":false,"publicEnemy":false,"compromisedCouncil":false,"coalitionTrade":false,"bailoutReceived":false,"moralHazard":false,"treasureCardsSeen":0,"treasureCardsSeenList":[],"underdogAtHalfway":false,"oneMoreTurn":false,"moveCount":0,"hiddenMovementSequence":false}],"globalEvents":["E0xE0xE0xE0xE0xE0xE0xE0xE0xE0xE0xE0xE0xE0xE0xE0xE0xE0xE0xE0xE0xE0xE0xE0xE0xE0xE0xE0xE0xE0xE0xE0xE0xE","E1xE1xE1xE1xE1xE1xE1xE1xE1xE1xE1xE1xE1xE1xE1xE1xE1xE1xE1xE1xE1xE1xE1xE1xE1xE1xE1xE1xE1xE1xE1xE1xE1xE","E2xE2xE2xE2xE2xE2xE2xE2xE2xE2xE2xE2xE2xE2xE2xE2xE2xE2xE2xE2xE2xE2xE2xE2xE2xE2xE2xE2xE2xE2xE2xE2xE2xE","E3xE3xE3xE3xE3xE3xE3xE3xE3xE3xE3xE3xE3xE3xE3xE3xE3xE3xE3xE3xE3xE3xE3xE3xE3xE3xE3xE3xE3xE3xE3xE3xE3xE","E4xE4xE4xE4xE4xE4xE4xE4xE4xE4xE4xE4xE4xE4xE4xE4xE4xE4xE4xE4xE4xE4xE4xE4xE4xE4xE4xE4xE4xE4xE4xE4xE4xE","E5xE5xE5xE5xE5xE5xE5xE5xE5xE5xE5xE5xE5xE5xE5xE5xE5xE5xE5xE5xE5xE5xE5xE5xE5xE5xE5xE5xE5xE5xE5xE5xE5xE","E6xE6xE6xE6xE6xE6xE6xE6xE6xE6xE6xE6xE6xE6xE6xE6xE6xE6xE6xE6xE6xE6xE6xE6xE6xE6xE6xE6xE6xE6xE6xE6xE6xE","E7xE7xE7xE7xE7xE7xE7xE7xE7xE7xE7xE7xE7xE7xE7xE7xE7xE7xE7xE7xE7xE7xE7xE7xE7xE7xE7xE7xE7xE7xE7xE7xE7xE","E8xE8xE8xE8xE8xE8xE8xE8xE8xE8xE8xE8xE8xE8xE8xE8xE8xE8xE8xE8xE8xE8xE8xE8xE8xE8xE8xE8xE8xE8xE8xE8xE8xE","E9xE9xE9xE9xE9xE9xE9xE9xE9xE9xE9xE9xE9xE9xE9xE9xE9xE9xE9xE9xE9xE9xE9xE9xE9xE9xE9xE9xE9xE9xE9xE9xE9xE","E10xE10xE10xE10xE10xE10xE10xE10xE10xE10xE10xE10xE10xE10xE10xE10xE10xE10xE10xE10xE10xE10xE10xE10xE10x","E11xE11xE11xE11xE11xE11xE11xE11xE11xE11xE11xE11xE11xE11xE11xE11xE11xE11xE11xE11xE11xE11xE11xE11xE11x","E12xE12xE12xE12xE12xE12xE12xE12xE12xE12xE12xE12xE12xE12xE12xE12xE12xE12xE12xE12xE12xE12xE12xE12xE12x","E13xE13xE13xE13xE13xE13xE13xE13xE13xE13xE13xE13xE13xE13xE13xE13xE13xE13xE13xE13xE13xE13xE13xE13xE13x","E14xE14xE14xE14xE14xE14xE14xE14xE14xE14xE14xE14xE14xE14xE14xE14xE14xE14xE14xE14xE14xE14xE14xE14xE14x","E15xE15xE15xE15xE15xE15xE15xE15xE15xE15xE15xE15xE15xE15xE15xE15xE15xE15xE15xE15xE15xE15xE15xE15xE15x","E16xE16xE16xE16xE16xE16xE16xE16xE16xE16xE16xE16xE16xE16xE16xE16xE16xE16xE16xE16xE16xE16xE16xE16xE16x","E17xE17xE17xE17xE17xE17xE17xE17xE17xE17xE17xE17xE17xE17xE17xE17xE17xE17xE17xE17xE17xE17xE17xE17xE17x","E18xE18xE18xE18xE18xE18xE18xE18xE18xE18xE18xE18xE18xE18xE18xE18xE18xE18xE18xE18xE18xE18xE18xE18xE18x","E19xE19xE19xE19xE19xE19xE19xE19xE19xE19xE19xE19xE19xE19xE19xE19xE19xE19xE19xE19xE19xE19xE19xE19xE19x"],"eventCombinations":["stagflation"],"tradesCompleted":5,"auctionsCompleted":2,"casino":[{"accountId":"a1","bets":8,"net":-50}],"market":[{"accountId":"a1","positions":{"X":{"realizedPnl":10}}}],"playerContracts":[{"id":"c1","kind":"equity","fromAccountId":"a1","toAccountId":"a2","fromPlayerId":"p1","toPlayerId":"p2","amount":500,"status":"paid","premiumRate":0.1,"equityShare":0.2,"collateralTileIndex":12},{"id":"c2","kind":"loan","fromAccountId":"a1","toAccountId":"a2","fromPlayerId":null,"toPlayerId":null,"amount":0,"status":"active","premiumRate":0,"equityShare":0,"collateralTileIndex":null}]};
const GOLDEN_LIST = 1;
const GOLDEN_AGAIN = {"firstCreated":true,"secondCreated":false,"sameRef":true};
const GOLDEN_ACH = [{"accountId":"a1","achievementId":"first-deed","title":"FIRST DEED","rarity":"COMMON","body":"You bought your first property."},{"accountId":"a1","achievementId":"last-wallet-standing","title":"LAST WALLET STANDING","rarity":"COMMON","body":"You were the last wallet standing."},{"accountId":"a1","achievementId":"full-street","title":"FULL STREET","rarity":"UNCOMMON","body":"You completed a country property group."},{"accountId":"a1","achievementId":"even-builder","title":"EVEN BUILDER","rarity":"UNCOMMON","body":"You built while keeping the street balanced."},{"accountId":"a1","achievementId":"council-member","title":"COUNCIL MEMBER","rarity":"UNCOMMON","body":"You backed the policy that won the table vote."},{"accountId":"a1","achievementId":"public-works","title":"PUBLIC WORKS","rarity":"RARE","body":"You built through a public-works policy."},{"accountId":"a1","achievementId":"auction-ghost","title":"AUCTION GHOST","rarity":"RARE","body":"You won an auction below the listed price."},{"accountId":"a1","achievementId":"rent-reaper","title":"RENT REAPER","rarity":"RARE","body":"You collected rent from three players in one round."},{"accountId":"a1","achievementId":"airport-hopper","title":"AIRPORT HOPPER","rarity":"UNCOMMON","body":"You visited every airport."},{"accountId":"a1","achievementId":"liquidity-king","title":"LIQUIDITY KING","rarity":"EPIC","body":"You finished with more cash than the rest of the table combined."},{"accountId":"a1","achievementId":"bad-idea-good-timing","title":"BAD IDEA, GOOD TIMING","rarity":"RARE","body":"You survived after borrowing from the edge."},{"accountId":"a1","achievementId":"prison-break","title":"PRISON BREAK","rarity":"RARE","body":"You used a prison card and still won."},{"accountId":"a1","achievementId":"no-refunds","title":"NO REFUNDS","rarity":"RARE","body":"You won after reaching the loan warning."},{"accountId":"a1","achievementId":"roulette-regular","title":"ROULETTE REGULAR","rarity":"RARE","body":"You placed eight roulette bets in one game."},{"accountId":"a1","achievementId":"all-in","title":"ALL IN","rarity":"EPIC","body":"You risked your available capital on one roulette stake."},{"accountId":"a1","achievementId":"first-index","title":"FIRST INDEX","rarity":"COMMON","body":"You entered the fictional exchange."},{"accountId":"a1","achievementId":"market-maker","title":"MARKET MAKER","rarity":"RARE","body":"You completed ten market orders in one game."},{"accountId":"a1","achievementId":"crisis-investor","title":"CRISIS INVESTOR","rarity":"EPIC","body":"You bought through a crisis and profited after recovery."},{"accountId":"a1","achievementId":"fire-sale","title":"FIRE SALE","rarity":"RARE","body":"You sold three buildings while the housing market was in crisis."},{"accountId":"a1","achievementId":"bubble-survivor","title":"BUBBLE SURVIVOR","rarity":"EPIC","body":"You kept a developed deed through the housing crash."},{"accountId":"a1","achievementId":"short-the-street","title":"SHORT THE STREET","rarity":"EPIC","body":"You sold into the crash and rebuilt after recovery."},{"accountId":"a1","achievementId":"underdog","title":"THE UNDERDOG","rarity":"RARE","body":"You were last in cash at the midpoint and still won."},{"accountId":"a1","achievementId":"one-more-turn","title":"ONE MORE TURN","rarity":"EPIC","body":"You repaid a loan on its final cure round."},{"accountId":"a1","achievementId":"group-therapy","title":"GROUP THERAPY","rarity":"UNCOMMON","body":"You completed a trade involving three properties."},{"accountId":"a1","achievementId":"coalition-builder","title":"COALITION BUILDER","rarity":"RARE","body":"You traded with a player who backed a different policy."},{"accountId":"a1","achievementId":"unanimous","title":"UNANIMOUS","rarity":"RARE","body":"Every active player chose the same policy."},{"accountId":"a1","achievementId":"public-enemy","title":"PUBLIC ENEMY","rarity":"LEGENDARY","body":"The table voted to enforce an investigation against your portfolio."},{"accountId":"a1","achievementId":"compromised-council","title":"COMPROMISED COUNCIL","rarity":"LEGENDARY","body":"You chose the quiet exit when the legitimacy crisis reached the council."},{"accountId":"a1","achievementId":"stagflation-trader","title":"STAGFLATION TRADER","rarity":"EPIC","body":"You completed a trade through the stagflation squeeze."},{"accountId":"a1","achievementId":"moral-hazard","title":"MORAL HAZARD","rarity":"EPIC","body":"You took the bailout while already carrying a bank loan."},{"accountId":"a1","achievementId":"41st-tile","title":"THE 41ST TILE","rarity":"MYTHICAL","body":"There are forty tiles. You stepped on one more."},{"accountId":"a1","achievementId":"null-player","title":"THE NULL PLAYER","rarity":"MYTHICAL","body":"Your wallet was empty. The turn continued."},{"accountId":"a1","achievementId":"black-ledger","title":"THE BLACK LEDGER","rarity":"MYTHICAL","body":"The bank closed the book. Something inside kept counting."},{"accountId":"a1","achievementId":"crisis-manager","title":"CRISIS MANAGER","rarity":"RARE","body":"You stayed solvent through a global headline."},{"accountId":"a1","achievementId":"double-headline","title":"DOUBLE HEADLINE","rarity":"LEGENDARY","body":"You survived two global headlines in one game."},{"accountId":"a1","achievementId":"treasure-map","title":"TREASURE MAP","rarity":"EPIC","body":"You drew every Treasure card across your account history."},{"accountId":"a1","achievementId":"event-tourist","title":"EVENT TOURIST","rarity":"RARE","body":"You experienced three different global events."},{"accountId":"a2","achievementId":"double-headline","title":"DOUBLE HEADLINE","rarity":"LEGENDARY","body":"You survived two global headlines in one game."},{"accountId":"a2","achievementId":"debt-free","title":"DEBT FREE","rarity":"UNCOMMON","body":"You finished the game with clean books."},{"accountId":"a2","achievementId":"event-tourist","title":"EVENT TOURIST","rarity":"RARE","body":"You experienced three different global events."}];
const GOLDEN_ACH2 = [{"accountId":"x1","achievementId":"generous-lender","title":"GENEROUS LENDER","rarity":"UNCOMMON","body":"You funded a player loan that was fully repaid."},{"accountId":"x1","achievementId":"silent-partner","title":"SILENT PARTNER","rarity":"RARE","body":"You completed a player loan without collateral."},{"accountId":"x1","achievementId":"collateral-damage","title":"COLLATERAL DAMAGE","rarity":"RARE","body":"A player loan default cost the collateral deed."},{"accountId":"x1","achievementId":"debt-free","title":"DEBT FREE","rarity":"UNCOMMON","body":"You finished the game with clean books."},{"accountId":"x2","achievementId":"generous-lender","title":"GENEROUS LENDER","rarity":"UNCOMMON","body":"You funded a player loan that was fully repaid."},{"accountId":"x2","achievementId":"silent-partner","title":"SILENT PARTNER","rarity":"RARE","body":"You completed a player loan without collateral."},{"accountId":"x2","achievementId":"debt-free","title":"DEBT FREE","rarity":"UNCOMMON","body":"You finished the game with clean books."}];
const GOLDEN_HIST = {"h1":[{"accountId":"y","achievementId":"debt-free","title":"DEBT FREE","rarity":"UNCOMMON","body":"You finished the game with clean books."}],"h2":[{"accountId":"z","achievementId":"debt-free","title":"DEBT FREE","rarity":"UNCOMMON","body":"You finished the game with clean books."}]};
const GOLDEN_REC1 = {"matchId":"game-1","completedAt":"<iso>","durationSeconds":900,"roundCount":5,"roomVisibility":"private","participants":[{"accountId":"<acct>","displayNameAtMatch":"FN","colorAtMatch":"#fff","finalPlacement":1,"endingCash":1234,"propertyCount":3,"bankrupt":false,"disconnected":false,"auctionWins":2,"rentCollected":300,"globalEventsExperienced":2,"globalEventsSurvived":1,"casinoNet":0,"casinoBets":3,"casinoMaxStake":90,"casinoTotalStaked":240,"casinoAllIn":true,"casinoOneDollar":true,"marketTrades":11,"crisisMarketProfit":true,"bankLoanStatus":"paid","bankLoanDefaulted":false,"bankLoanCount":2,"airportVisits":4,"taxTilesVisited":1,"maxRentPayersInRound":3,"auctionUnderListWins":1,"loanWarningSeen":true,"badIdeaLoan":true,"prisonBreak":true,"fullGroups":1,"evenBuilds":3,"councilWins":1,"publicWorksBuilds":2,"cardDraws":{"surprise":1,"treasure":2},"zeroCashReached":true,"collateralLost":true,"comboExperienced":true,"bubbleSurvivor":true,"rebuiltAfterHousingBubble":true,"foreclosureNoSecondLoan":true,"housingBubbleEnded":true,"soldBuildingsDuringHousingBubble":4,"boughtDuringHousingBubble":true,"airportOwnedDuringStrike":true,"nonAirportRentDuringStrike":true,"tradesDuringCombo":2,"groupTherapyTrade":true,"unanimousVote":true,"publicEnemy":true,"compromisedCouncil":true,"coalitionTrade":true,"bailoutReceived":true,"moralHazard":true,"treasureCardsSeen":2,"treasureCardsSeenList":["t1","t2"],"underdogAtHalfway":true,"oneMoreTurn":true,"moveCount":30,"hiddenMovementSequence":true},{"accountId":"<acct>","finalPlacement":2,"endingCash":2.9,"propertyCount":0,"bankrupt":false,"disconnected":false,"auctionWins":0,"rentCollected":0,"globalEventsExperienced":0,"globalEventsSurvived":0,"casinoNet":0,"casinoBets":0,"casinoMaxStake":0,"casinoTotalStaked":0,"casinoAllIn":false,"casinoOneDollar":false,"marketTrades":0,"crisisMarketProfit":false,"bankLoanStatus":"defaulted","bankLoanDefaulted":true,"bankLoanCount":0,"airportVisits":0,"taxTilesVisited":0,"maxRentPayersInRound":0,"auctionUnderListWins":0,"loanWarningSeen":false,"badIdeaLoan":false,"prisonBreak":false,"fullGroups":0,"evenBuilds":0,"councilWins":0,"publicWorksBuilds":0,"cardDraws":{},"zeroCashReached":false,"collateralLost":false,"comboExperienced":false,"bubbleSurvivor":false,"rebuiltAfterHousingBubble":false,"foreclosureNoSecondLoan":false,"housingBubbleEnded":false,"soldBuildingsDuringHousingBubble":0,"boughtDuringHousingBubble":false,"airportOwnedDuringStrike":false,"nonAirportRentDuringStrike":false,"tradesDuringCombo":0,"groupTherapyTrade":false,"unanimousVote":false,"publicEnemy":false,"compromisedCouncil":false,"coalitionTrade":false,"bailoutReceived":false,"moralHazard":false,"treasureCardsSeen":0,"treasureCardsSeenList":[],"underdogAtHalfway":false,"oneMoreTurn":false,"moveCount":0,"hiddenMovementSequence":false}],"globalEvents":["e0","e1","e2","e3","e4","e5","e6","e7","e8","e9","e10","e11","e12","e13","e14","e15","e16","e17","e18","e19"],"eventCombinations":["a"],"tradesCompleted":3,"auctionsCompleted":4,"casino":[{"accountId":"<acct>","bets":3,"net":-10}],"market":[{"accountId":"<acct>","positions":{"A":{"realizedPnl":"5"},"B":{"realizedPnl":"junk"}}}],"playerContracts":[{"kind":"loan","status":"paid","fromAccountId":"<acct>","toAccountId":"other"},{"kind":"loan","status":"defaulted","fromAccountId":"other","toAccountId":"<acct>"},{"kind":"loan","status":"active","fromAccountId":"<acct>","toAccountId":"other"},{"kind":"equity","status":"paid","fromAccountId":"other","toAccountId":"<acct>"}]};
const GOLDEN_ACCT = {"id":"<acct>","username":"goldone","displayName":"G","color":"#d74438","avatarGrid":null,"stats":{"gamesPlayed":2,"wins":1,"bankruptcies":0,"auctionWins":2,"rentCollected":300,"eventSurvival":1,"casinoNet":-20,"marketProfit":10,"playerLoansGiven":4,"playerLoansRepaid":0,"playerLoanDefaults":2,"equityDeals":2,"bankLoansTaken":2,"bankLoanRepayments":1,"bankLoanDefaults":1,"patrolBest":0,"patrolAceRuns":0},"history":[{"matchId":"game-1","playedAt":"<iso>","result":"ROUND","won":false,"endingCash":2.9,"properties":0},{"matchId":"game-1","playedAt":"<iso>","result":"WIN","won":true,"endingCash":1234,"properties":3}],"achievements":[],"matchHistory":[{"matchId":"game-1"}],"privacy":{"history":"friends","achievements":"friends","friendRequests":"everyone","roomInvites":"friends"},"recentClearedAt":null,"createdAt":"<iso>"};
const GOLDEN_REC2 = {"matchId":"<uuid>","completedAt":"<iso>","durationSeconds":0,"roundCount":0,"roomVisibility":"public","participants":[],"globalEvents":[],"eventCombinations":[],"tradesCompleted":0,"auctionsCompleted":0,"casino":[],"market":[],"playerContracts":[]};
const GOLDEN_REC3 = {"participants":[{"accountId":null,"finalPlacement":2,"endingCash":0,"propertyCount":0,"bankrupt":true,"disconnected":false,"auctionWins":0,"rentCollected":0,"globalEventsExperienced":0,"globalEventsSurvived":0,"casinoNet":0,"casinoBets":0,"casinoMaxStake":0,"casinoTotalStaked":0,"casinoAllIn":false,"casinoOneDollar":false,"marketTrades":0,"crisisMarketProfit":false,"bankLoanStatus":null,"bankLoanDefaulted":false,"bankLoanCount":0,"airportVisits":0,"taxTilesVisited":0,"maxRentPayersInRound":0,"auctionUnderListWins":0,"loanWarningSeen":false,"badIdeaLoan":false,"prisonBreak":false,"fullGroups":0,"evenBuilds":0,"councilWins":0,"publicWorksBuilds":0,"cardDraws":{},"zeroCashReached":false,"collateralLost":false,"comboExperienced":false,"bubbleSurvivor":false,"rebuiltAfterHousingBubble":false,"foreclosureNoSecondLoan":false,"housingBubbleEnded":false,"soldBuildingsDuringHousingBubble":0,"boughtDuringHousingBubble":false,"airportOwnedDuringStrike":false,"nonAirportRentDuringStrike":false,"tradesDuringCombo":0,"groupTherapyTrade":false,"unanimousVote":false,"publicEnemy":false,"compromisedCouncil":false,"coalitionTrade":false,"bailoutReceived":false,"moralHazard":false,"treasureCardsSeen":0,"treasureCardsSeenList":[],"underdogAtHalfway":false,"oneMoreTurn":false,"moveCount":0,"hiddenMovementSequence":false},{"accountId":null,"finalPlacement":1,"endingCash":0,"propertyCount":0,"bankrupt":false,"disconnected":false,"auctionWins":0,"rentCollected":0,"globalEventsExperienced":0,"globalEventsSurvived":0,"casinoNet":0,"casinoBets":0,"casinoMaxStake":0,"casinoTotalStaked":0,"casinoAllIn":false,"casinoOneDollar":false,"marketTrades":0,"crisisMarketProfit":false,"bankLoanStatus":null,"bankLoanDefaulted":false,"bankLoanCount":0,"airportVisits":0,"taxTilesVisited":0,"maxRentPayersInRound":0,"auctionUnderListWins":0,"loanWarningSeen":false,"badIdeaLoan":false,"prisonBreak":false,"fullGroups":0,"evenBuilds":0,"councilWins":0,"publicWorksBuilds":0,"cardDraws":{},"zeroCashReached":false,"collateralLost":false,"comboExperienced":false,"bubbleSurvivor":false,"rebuiltAfterHousingBubble":false,"foreclosureNoSecondLoan":false,"housingBubbleEnded":false,"soldBuildingsDuringHousingBubble":0,"boughtDuringHousingBubble":false,"airportOwnedDuringStrike":false,"nonAirportRentDuringStrike":false,"tradesDuringCombo":0,"groupTherapyTrade":false,"unanimousVote":false,"publicEnemy":false,"compromisedCouncil":false,"coalitionTrade":false,"bailoutReceived":false,"moralHazard":false,"treasureCardsSeen":0,"treasureCardsSeenList":[],"underdogAtHalfway":false,"oneMoreTurn":false,"moveCount":0,"hiddenMovementSequence":false}],"completedAtIsString":"string"};

const goldMatchesFile = 'server/data/__test_gold_matches.json';
const goldAcctFile = 'server/data/__test_gold_acct.json';
const goldAchFile = 'server/data/__test_gold_ach.json';

function testStoresCharacterization() {
  fs.rmSync(goldMatchesFile, { force: true });
  fs.rmSync(goldAcctFile, { force: true });
  fs.rmSync(goldAchFile, { force: true });
  const store = new MatchStore(goldMatchesFile);
  const garbage = store.record(FIX_garbage);
  assert.deepEqual(normalizeDynamic(garbage.match), GOLDEN_GARBAGE, 'garbage-in record');
  assert.equal(garbage.created, true, 'garbage-in created a record');
  const nullparts = store.record(FIX_nullparts);
  assert.deepEqual(normalizeDynamic(nullparts), GOLDEN_NULLPARTS, 'null participants');
  const first = store.record(FIX_full);
  assert.deepEqual(normalizeDynamic(first.match), GOLDEN_FULL, 'full record');
  assert.equal(store.listForAccount('a1').length, GOLDEN_LIST, 'listForAccount');
  const again = store.record(FIX_full);
  assert.equal(again.created, false, 're-record is not created');
  assert.equal(again.match, first.match, 're-record returns the stored object');
  assert.deepEqual(normalizeDynamic({ firstCreated: first.created, secondCreated: again.created, sameRef: again.match === first.match }), GOLDEN_AGAIN, 'idempotent re-record');
  const achievements = new AchievementStore(goldAchFile);
  assert.deepEqual(
    achievements.evaluateMatch(first.match, (accountId) => (accountId === 'a1' ? [first.match] : [])),
    GOLDEN_ACH,
    'evaluateMatch on the full record'
  );
  assert.deepEqual(achievements.evaluateMatch(FIX_contractInput), GOLDEN_ACH2, 'contract-driven achievements');
  const h1 = achievements.evaluateMatch(FIX_histInputY, 'not-a-function');
  const h2 = achievements.evaluateMatch(FIX_histInputZ, () => FIX_histPastZ);
  assert.deepEqual(normalizeDynamic({ h1, h2 }), GOLDEN_HIST, 'history arg handling');
  const accounts = new AccountStore(goldAcctFile);
  const registered = accounts.register({ username: 'goldone', password: 'password123', displayName: 'G' });
  assert.equal(registered.success, true);
  const acctId = registered.account.id;
  const rec1 = accounts.recordGameResults(
    [replaceAcctSentinel(FIX_playerFull, acctId), replaceAcctSentinel(FIX_playerDefaulted, acctId)],
    'p1',
    replaceAcctSentinel(FIX_meta, acctId)
  );
  assert.deepEqual(normalizeDynamic(rec1), GOLDEN_REC1, 'recordGameResults match record');
  const saved = { ...[...accounts.accounts.values()][0] };
  delete saved.passwordSalt;
  delete saved.passwordHash;
  delete saved.sessionTokenHash;
  const savedNormalized = normalizeDynamic(saved);
  // The persisted matchHistory embeds a full copy of REC1; that shape is already
  // pinned above, so only its matchId is compared here.
  savedNormalized.matchHistory = savedNormalized.matchHistory.map((entry) => ({ matchId: entry.matchId }));
  assert.deepEqual(savedNormalized, GOLDEN_ACCT, 'persisted account stats/history');
  const rec2 = accounts.recordGameResults();
  assert.deepEqual(normalizeDynamic(rec2), GOLDEN_REC2, 'recordGameResults with no args');
  const rec3 = accounts.recordGameResults(
    [
      { id: 'w1', accountId: null, bankrupt: true, cash: 0 },
      { id: 'w2', accountId: null, cash: 'NaN', properties: 'no' },
    ],
    'w1',
    { gameId: 'game-2' }
  );
  assert.deepEqual(normalizeDynamic({ participants: rec3.participants, completedAtIsString: typeof rec3.completedAt }), GOLDEN_REC3, 'bankrupt winner placement order');
  fs.rmSync(goldMatchesFile, { force: true });
  fs.rmSync(goldAcctFile, { force: true });
  fs.rmSync(goldAchFile, { force: true });
}

const CONTRACT_SUITES = [
  ['contract 7 — createRoom generated codes never overwrite', testCreateRoomCodeCollision],
  ['contract 6 — join/create color collision auto-assign', testJoinColorUniqueness],
  ['contract 6 — setPlayerAppearance duplicate-color rejection', testSetPlayerAppearance],
  ['contract 4 — Room.hasConnectedHumans', testHasConnectedHumans],
  ['contract 5 — listPublicRooms browse purity', testListPublicRooms],
  ['contract 8 — getGameSummary players[] avatarGrid', testGameSummaryAvatarGrid],
  ['contract 9 — leaveRoomByClient mid-game seat release', testLeaveRoomByClientMidGame],
  ['contract 10 — explicit end-turn hold after landing', testExplicitEndTurn],
  ['stores — participant schema + achievement characterization', testStoresCharacterization]
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
