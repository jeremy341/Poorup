// Seats, tables, and the table registry. gameLogic.js imports the classes
// from here and re-exports RoomManager/Room so every existing consumer
// (server.js and the room suites) keeps importing from './gameLogic.js'.
// GameState is imported circularly and only ever used at call time inside
// the Room constructor, which is safe for ES module live bindings.
import crypto from 'crypto';
import { randomInt } from './random.js';
import { START_TILE_INDEX } from './gameData.js';
import { tilesForVariant } from './boardRegistry.js';
import {
  DEFAULT_ROOM_SETTINGS,
  isRetiredRoomSettingKey,
  isPlainOverrideValue,
  LEGACY_SCALED_SETTINGS,
  ROOM_FLAG_TRUE_VALUES,
  ROOM_SETTING_NORMALIZERS,
  SETTING_REJECTED,
  stripRetiredRoomSettings
} from './roomSettings.js';
import { AVATAR_GRID_ERROR, isValidAvatarGrid, resolveFreeAppearanceColor } from './appearanceApi.js';
import { cleanPlayerName, LOBBY_BOT_NAMES, nicknameRejection } from './nicknamePolicy.js';
import { GameState } from './gameLogic.js';
import { outstandingDebtFor, settleQueuedDebtsOf } from './bankruptcyLogic.js';
import {
  boardVariantMeta,
  KNOWN_OVERRIDE_KEYS,
  normalizeOverrides,
  OPTIONAL_SYSTEM_KEYS,
  resolveRuleset,
  safeBoardVariant
} from './rulesetRegistry.js';

// Mirrors the 120 s reconnect grace in socketRuntime.js.
const LOBBY_ABSENT_SEAT_MS = 120_000;
const SEAT_INACTIVE_ERROR = 'That room seat is no longer active.';

function createRoomCode() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += alphabet.charAt(randomInt(0, alphabet.length - 1));
  }
  return code;
}

function safeNickname(nickname) {
  const safe = cleanPlayerName(nickname, 24);
  return safe || 'Player';
}

function safeClientId(clientId) {
  return typeof clientId === 'string' ? clientId.trim().slice(0, 120) : '';
}

function safeSeatColor(color) {
  if (typeof color !== 'string') return '#35a653';
  if (!/^#[0-9a-fA-F]{6}$/.test(color)) return '#35a653';
  return color;
}

function seatAccountAllowsReconnect(player, accountId) {
  if (!player.accountId) return true;
  return player.accountId === accountId;
}

function roomSettingChangeRejectionReason(room, key) {
  if (room.game.started) return 'Game settings can only be changed before the game starts.';
  if (isRetiredRoomSettingKey(key)) return 'Unknown room setting.';
  if (!Object.prototype.hasOwnProperty.call(room.settings, key)) return 'Unknown room setting.';
  if (LEGACY_SCALED_SETTINGS.includes(key)) return 'This setting is controlled by the server.';
  return null;
}

function normalizedRoomSetting(room, key, value) {
  // The creation override door accepts only finite primitive rule values.
  // Reject opaque/missing writes here too instead of turning them into false.
  if (KNOWN_OVERRIDE_KEYS.has(key) && !isPlainOverrideValue(value)) return SETTING_REJECTED;
  const normalizer = ROOM_SETTING_NORMALIZERS[key];
  return normalizer ? normalizer(value, room) : room.defaultRoomSettingValue(key, value);
}

// Capacity-driven settings are refused when they would strand an occupied seat.
// A boardVariant write counts: its board meta owns maxPlayers, and the clamp in
// applyBoardVariantSetting used to apply that smaller limit silently, leaving a
// 4-seat board running a 5-seat turn order. Resolve the incoming board's own
// limit so the downgrade is refused through the same door as maxPlayers.
function settingCapacityLimit(room, key, value) {
  if (key === 'maxPlayers') return value;
  if (key === 'boardVariant') return boardVariantMeta(safeBoardVariant(value)).maxPlayers;
  return null;
}

function capacityAllowsSetting(room, key, value) {
  const limit = settingCapacityLimit(room, key, value);
  if (limit == null) return true;
  const retainedSeats = retainedNonBotSeats(room);
  return limit >= retainedSeats;
}

// Every retained non-bot seat holds capacity, including an eliminated one:
// resetForNewGame revives the bankrupt seats for the rematch, so a table that
// counts only the solvent humans grows past maxPlayers once a seat is
// eliminated (and a bot is added into the slot that is already taken).
function retainedNonBotSeats(room) {
  return room.game.players.filter(player => !player.isBot).length;
}

// The seat a returning client holds is the one it dropped most recently. The
// ordering key is the actual first drop of the current absence: a lobby seat's
// grace restarts for ever, so its deadline cannot tell a fresh drop from a
// ghost.
function seatDropTime(player) {
  const droppedAt = Number(player?.disconnectedAt) || 0;
  if (droppedAt > 0) return droppedAt;
  return Number(player?.disconnectDeadline) || 0;
}

function droppedMoreRecently(candidate, current) {
  if (!current) return true;
  return seatDropTime(candidate) > seatDropTime(current);
}

function syncBotCapacity(room, key, value) {
  if (key !== 'maxPlayers') return;
  const maxBots = Math.max(0, value - 1);
  if (Number(room.settings.bots) <= maxBots) return;
  room.settings.bots = maxBots;
  room.game.settings.bots = maxBots;
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

// Flags written by the host are explicit overrides. Profile and board metadata
// live alongside the override list and cannot be smuggled through it.
function settingCapturesOverride(key) {
  return !['rulesProfile', 'rulesetOverrides', 'boardVariant', 'rulesetRevision'].includes(key);
}

function captureSettingOverride(room, key, value) {
  if (!settingCapturesOverride(key)) return;
  const overrides = new Map((room.settings.rulesetOverrides || []).map(entry => [entry.key, entry.value]));
  overrides.set(key, value);
  room.settings.rulesetOverrides = [...overrides.entries()].map(([overrideKey, overrideValue]) => ({ key: overrideKey, value: overrideValue }));
}

function syncRulesetState(room) {
  room.refreshRuleset();
  Object.assign(room.game.settings, room.settings);
  room.game.boardVariant = room.ruleset.boardVariant;
  room.game.ruleset = room.ruleset;
}

function applyBoardVariantSetting(room) {
  const meta = boardVariantMeta(room.settings.boardVariant);
  if (!room.game.started) {
    room.game.boardVariant = room.settings.boardVariant;
    room.game.tiles = tilesForVariant(room.game.boardVariant);
  }
  if (room.settings.maxPlayers > meta.maxPlayers) {
    room.settings.maxPlayers = meta.maxPlayers;
    room.game.settings.maxPlayers = meta.maxPlayers;
    syncBotCapacity(room, 'maxPlayers', meta.maxPlayers);
  }
}

const RULESET_INPUT_KEYS = ['rulesetOverrides', 'boardVariant', 'marketComplexity', 'rulesProfile', 'playerFinance'];

function roomSettingsSeed(rulesetInput) {
  const seed = { ...DEFAULT_ROOM_SETTINGS };
  RULESET_INPUT_KEYS.forEach(key => {
    if (rulesetInput[key] !== undefined) seed[key] = rulesetInput[key];
  });
  if (seed.rulesProfile === 'advanced' && rulesetInput.playerFinance === undefined) seed.playerFinance = true;
  return seed;
}

// Overrides arrive as a list of { key, value } or as a plain { key: value } map.
function overrideEntries(overrides) {
  if (Array.isArray(overrides)) return overrides.map(entry => ({ ...entry }));
  if (overrides && typeof overrides === 'object') return Object.entries(overrides).map(([key, value]) => ({ key, value }));
  return [];
}

function capacityDrivenSetting(key) {
  return ['bots', 'maxPlayers', 'boardVariant'].includes(key);
}

class Player {
  constructor({ clientId, socketId, nickname, color, avatarGrid = null, accountId = null, isHost = false, isBot = false }) {
    this.id = crypto.randomUUID();
    this.clientId = safeClientId(clientId) || this.id;
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

// The host seat belongs to a connected, solvent human: bots never host, and a
// bankrupt host keeps the seat only while no solvent human is connected. Every
// seat change that can leave the room hostless calls this, so a lobby or
// rematch is never stuck waiting on a seat that cannot start or configure it.
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

class Room {
  constructor(hostPlayer, {
    roomName = 'AFTER HOURS',
    visibility = 'public',
    roomCode = '',
    rulesetOverrides,
    boardVariant,
    marketComplexity,
    rulesProfile,
    playerFinance
  } = {}) {
    const rulesetInput = { rulesetOverrides, boardVariant, marketComplexity, rulesProfile, playerFinance };
    this.roomCode = roomCode || createRoomCode();
    this.publicId = 'room_' + crypto.randomUUID();
    this.roomName = roomName;
    this.visibility = visibility;
    this.statsRecorded = false;
    // True between the end of a match and the start of the next one.
    this.matchFinished = false;
    this.hostId = hostPlayer.id;
    this.kickedClientIds = new Set();
    this.kickedAccountIds = new Set();
    // Bot clientIds embed this per-room secret so a guessed room code does not
    // name a bot seat a client could claim.
    this.botSeatSecret = crypto.randomBytes(9).toString('hex');
    this.settings = roomSettingsSeed(rulesetInput);
    this.settings.rulesetOverrides = overrideEntries(this.settings.rulesetOverrides);
    // Remember a finance choice supplied at creation so a later profile
    // change cannot replace it with that profile's starting default.
    if (isPlainOverrideValue(playerFinance)
      && !Object.hasOwn(normalizeOverrides(this.settings.rulesetOverrides), 'playerFinance')) {
      this.settings.rulesetOverrides.push({ key: 'playerFinance', value: playerFinance });
    }
    this.rulesetExplicit = true;
    if (marketComplexity !== undefined && !this.settings.rulesetOverrides.some(entry => entry.key === 'marketComplexity')) {
      this.settings.rulesetOverrides.push({ key: 'marketComplexity', value: marketComplexity });
    }
    this.refreshRuleset();
    this.game = new GameState(this.settings);
    this.game.ruleset = this.ruleset;
    this.game.legacyRuleset = !this.rulesetExplicit;
    this.game.boardVariant = this.ruleset.boardVariant;
    this.game.onSeatEliminated = () => ensureRoomHost(this);
    // The room owns the vote-kick, so it learns that the match is over here.
    // The finished match is not mutable: the vote-kick start and the seat
    // removal it decides belong to a running match (a lobby that never
    // played keeps them).
    this.game.onGameEnded = () => {
      this.matchFinished = true;
      this.clearVoteKick();
    };
    this.game.addPlayer(hostPlayer);
  }

  refreshRuleset() {
    // A trusted pre-removal snapshot may still carry these legacy raw fields.
    // Remove them before canonical ruleset resolution and before syncing the
    // restored room state to its GameState.
    this.rulesetExplicit = true;
    this.settings = stripRetiredRoomSettings(this.settings);
    if (this.game?.settings) this.game.settings = stripRetiredRoomSettings(this.game.settings);
    if (!Object.hasOwn(this.settings, 'rulesProfile')) {
      // refreshRuleset is also the trusted snapshot restoration seam. Missing
      // mode metadata with an explicit optional override retains its intent.
      const optional = new Set([...OPTIONAL_SYSTEM_KEYS, 'playerFinance']);
      const legacyOptional = overrideEntries(this.settings.rulesetOverrides).some(entry => optional.has(entry.key));
      this.settings.rulesProfile = legacyOptional ? 'advanced' : 'standard';
      if (legacyOptional && !Object.hasOwn(this.settings, 'playerFinance')) this.settings.playerFinance = true;
    }
    const boardVariant = safeBoardVariant(this.settings.boardVariant);
    const ruleset = resolveRuleset({
      rulesetOverrides: this.settings.rulesetOverrides,
      boardVariant,
      settings: this.settings,
      rulesetRevision: this.settings.rulesetRevision
    });
    Object.assign(this.settings, ruleset.effectiveSettings);
    this.applyResolvedRulesetSettings(ruleset);
    if (this.game) {
      this.game.settings = { ...this.settings };
      this.game.ruleset = ruleset;
      this.game.legacyRuleset = false;
    }
    this.ruleset = ruleset;
    this.rulesetDigest = ruleset.digest;
    if (this.game) this.game.rulesetDigest = ruleset.digest;
    return ruleset;
  }

  applyResolvedRulesetSettings(ruleset) {
    this.settings.boardVariant = ruleset.boardVariant;
    this.settings.rulesetRevision = ruleset.rulesetRevision;
    this.settings.marketComplexity = ruleset.effectiveSettings.marketComplexity;
    this.settings.rulesetOverrides = ruleset.rulesetOverrides.map(entry => ({ ...entry }));
  }

  addOrReconnectPlayer(playerInfo) {
    if (this.isSeatBlocked(playerInfo?.clientId, playerInfo?.accountId)) {
      return { success: false, error: 'You cannot rejoin this room after a vote-kick.' };
    }
    const existing = this.game.getPlayerByClient(playerInfo.clientId);
    // A clientId never reclaims a bot seat: bots have no owner to restore them.
    if (existing?.isBot) return { success: false, error: 'That seat is already in use.' };
    if (existing) return this.reconnectPlayer(existing, playerInfo);
    return this.seatNewPlayer(playerInfo);
  }

  isSeatBlocked(clientId, accountId) {
    return Boolean(
      (clientId && this.kickedClientIds?.has(clientId))
      || (accountId && this.kickedAccountIds?.has(accountId)),
    );
  }

  seatHoldsOtherAccount(player, socketId) {
    return Boolean(player.accountId) && player.socketId !== socketId;
  }

  reconnectPlayer(existing, playerInfo) {
    // A clientId is a bearer key for guest seats, but it must never let a
    // different signed-in account take over an account-owned seat (or attach
    // its account to a guest seat). Fast reloads without a token remain
    // supported because the clientId itself is the session credential.
    if (playerInfo.accountId && existing.accountId !== playerInfo.accountId) {
      return { success: false, error: 'That seat is already linked to another account.' };
    }
    if (!playerInfo.accountId && this.seatHoldsOtherAccount(existing, playerInfo.socketId)) {
      return { success: false, error: 'That seat is already linked to another account.' };
    }
    if (this.reconnectGridIsInvalid(playerInfo.avatarGrid)) {
      return { success: false, error: AVATAR_GRID_ERROR };
    }
    existing.socketId = playerInfo.socketId;
    existing.disconnected = false;
    existing.disconnectDeadline = 0;
    // A connected seat carries no drop time: the reclaim comparator reads it
    // as the first drop of the current absence (socketRuntime clears it too).
    existing.disconnectedAt = 0;
    existing.presence = { state: 'active', inactiveSince: null, inactiveUntil: null };
    this.refreshReconnectNickname(existing, playerInfo.nickname);
    this.refreshReconnectAppearance(existing, playerInfo.color, playerInfo.avatarGrid);
    this.refreshReconnectAccount(existing, playerInfo.accountId);
    ensureRoomHost(this);
    return { success: true, player: existing };
  }

  reconnectGridIsInvalid(avatarGrid) {
    if (avatarGrid === undefined) return false;
    if (avatarGrid === null) return false;
    if (isValidAvatarGrid(avatarGrid)) return false;
    return true;
  }

  refreshReconnectNickname(player, nickname) {
    if (this.game.started) return;
    if (typeof nickname !== 'string') return;
    const safeNickname = cleanPlayerName(nickname, 24);
    // A reconnect keeps the seat's current name when the requested one is now
    // reserved or held by another seat at this table.
    if (safeNickname && !nicknameRejection(this.game.players, safeNickname, player)) player.nickname = safeNickname;
  }

  // The reconnect hole was two split updates: an omitted/invalid color
  // skipped identity resolution, then any grid array applied blindly. The
  // effective color (incoming when hex, else current) always resolves
  // against the effective grid (incoming when provided, else current)
  // before either field is written, matching setPlayerAppearance.
  refreshReconnectAppearance(player, color, avatarGrid) {
    const effectiveColor = this.effectiveReconnectColor(player, color);
    const effectiveGrid = this.effectiveReconnectGrid(player, avatarGrid);
    player.color = resolveFreeAppearanceColor(this.game.players, effectiveColor, player, effectiveGrid);
    player.avatarGrid = effectiveGrid;
  }

  effectiveReconnectColor(player, color) {
    if (typeof color !== 'string') return player.color;
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return player.color;
    return color;
  }

  effectiveReconnectGrid(player, avatarGrid) {
    if (avatarGrid === undefined) return player.avatarGrid;
    return avatarGrid;
  }

  refreshReconnectAccount(player, accountId) {
    if (!accountId) return;
    player.accountId = accountId;
  }

  safeGridForResolve(player, avatarGrid) {
    if (avatarGrid === undefined) return player.avatarGrid;
    if (avatarGrid === null) return null;
    if (isValidAvatarGrid(avatarGrid)) return avatarGrid;
    return player.avatarGrid;
  }

  refreshReconnectColor(player, color, avatarGrid) {
    const gridForResolve = this.safeGridForResolve(player, avatarGrid);
    const effectiveColor = this.effectiveReconnectColor(player, color);
    player.color = resolveFreeAppearanceColor(this.game.players, effectiveColor, player, gridForResolve);
  }

  refreshReconnectAvatarGrid(player, avatarGrid) {
    if (avatarGrid === undefined) return;
    if (avatarGrid === null) {
      player.avatarGrid = null;
      return;
    }
    if (!Array.isArray(avatarGrid)) return;
    if (!isValidAvatarGrid(avatarGrid)) return;
    player.avatarGrid = avatarGrid;
  }

  seatNewPlayer(playerInfo) {
    if (this.game.started) {
      return { success: false, error: 'Game is already in progress.' };
    }
    if (playerInfo.accountId && this.game.players.some(player => player.accountId === playerInfo.accountId)) {
      return { success: false, error: 'This account is already seated in this room.' };
    }
    const nicknameError = nicknameRejection(this.game.players, safeNickname(playerInfo.nickname));
    if (nicknameError) return { success: false, error: nicknameError };
    if (!this.lobbyHasFreeSeat()) this.reclaimAbsentLobbySeats();
    while (!this.lobbyHasFreeSeat()) {
      const lastBot = this.game.players.filter(player => player.isBot).at(-1);
      if (!lastBot) break;
      this.game.removePlayerByClient(lastBot.clientId);
    }
    if (!this.lobbyHasFreeSeat()) {
      return { success: false, error: 'Room is full.' };
    }
    const player = new Player(playerInfo);
    player.color = resolveFreeAppearanceColor(this.game.players, player.color, player, player.avatarGrid);
    this.game.addPlayer(player);
    ensureRoomHost(this);
    this.ensureBots();
    return { success: true, player };
  }

  // A lobby seat's grace restarts for ever (the empty-room GC is its only
  // expiry), so a human who dropped and never came back would hold capacity
  // for good. Release the seats whose first drop is older than one grace window,
  // only when a newcomer needs the room; socketRuntime stamps disconnectedAt.
  reclaimAbsentLobbySeats(now = Date.now()) {
    const absent = this.game.players.filter(player => !player.isBot && player.disconnected
      && Number(player.disconnectedAt) > 0 && now - Number(player.disconnectedAt) > LOBBY_ABSENT_SEAT_MS);
    absent.forEach(player => this.releaseExpiredSeatOrRemove(player));
    if (absent.length) ensureRoomHost(this);
    return absent.length;
  }

  // Before a match every retained seat holds capacity: resetForNewGame revives
  // eliminated seats for the rematch, so game.canJoin (which skips bankrupt
  // seats) let a post-game lobby admit a seat the rematch could not hold.
  lobbyHasFreeSeat() {
    if (!this.game.canJoin()) return false;
    return this.game.players.length < Number(this.game.settings.maxPlayers);
  }

  // Public browse, disconnect GC, and stale-code reclaim share this single
  // liveness check: bots and ghost seats must not count as humans.
  hasConnectedHumans() {
    return this.game.players.some(player => !player.isBot && !player.disconnected);
  }

  // A private code stays held while any human seat exists, including one that
  // is only in its disconnect grace window.
  hasHumanSeats() {
    return this.game.players.some(player => !player.isBot);
  }

  getPlayerBySocket(socketId) {
    return this.game.getPlayerBySocket(socketId);
  }

  getPlayerById(id) {
    return this.game.getPlayerById(id);
  }

  setRoomSetting(key, value) {
    const rejectionReason = roomSettingChangeRejectionReason(this, key);
    if (rejectionReason) return this.roomSettingResult(key, false, rejectionReason);
    const nextValue = normalizedRoomSetting(this, key, value);
    if (nextValue === SETTING_REJECTED) return this.roomSettingResult(key, false, `Invalid value for ${String(key)}.`);
    if (!capacityAllowsSetting(this, key, nextValue)) {
      return this.roomSettingResult(key, false, 'Room capacity cannot be lower than the number of active players.');
    }
    const previousValue = this.settings[key];
    const previousOverrides = this.settings.rulesetOverrides;
    if (key === 'rulesProfile' && nextValue === 'advanced' && this.settings.rulesProfile !== 'advanced'
      && !this.settings.rulesetOverrides.some(entry => entry.key === 'playerFinance')) this.settings.playerFinance = true;
    this.settings[key] = nextValue;
    this.game.settings[key] = nextValue;
    captureSettingOverride(this, key, nextValue);
    syncRulesetState(this);
    if (key === 'boardVariant') applyBoardVariantSetting(this);
    syncBotCapacity(this, key, nextValue);
    this.applyRoomSettingSideEffect(key, nextValue);
    const changed = !Object.is(previousValue, this.settings[key])
      || previousOverrides !== this.settings.rulesetOverrides;
    return this.roomSettingResult(key, changed, null);
  }

  roomSettingResult(key, changed, reason) {
    const ruleset = this.ruleset || this.refreshRuleset();
    const effectiveSettings = stripRetiredRoomSettings(ruleset.effectiveSettings);
    return {
      changed: Boolean(changed),
      rejected: Boolean(reason),
      reason: reason || null,
      key,
      value: !isRetiredRoomSettingKey(key) && Object.prototype.hasOwnProperty.call(this.settings, key)
        ? this.settings[key]
        : undefined,
      effectiveSettings
    };
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
    if (capacityDrivenSetting(key)) {
      this.ensureBots();
      return;
    }
    if (key === 'startingCash') {
      this.game.players.forEach(player => {
        player.cash = Number(value);
      });
      return;
    }
  }

  startGame() {
    this.pruneExpiredSeats();
    this.ensureBots();
    // Runtime analytics guards are keyed by the current round marker; a
    // rematch must be eligible for a fresh match-start event.
    this.analyticsMatchStartRecorded = null;
    this.analyticsMatchStalledRecorded = null;
    this.refreshRuleset();
    this.game.ruleset = Object.freeze({ ...this.ruleset, effectiveSettings: Object.freeze({ ...this.ruleset.effectiveSettings }) });
    this.game.rulesetDigest = this.ruleset.digest;
    this.game.boardVariant = this.ruleset.boardVariant;
    const result = this.game.startGame();
    if (result?.success) {
      this.statsRecorded = false;
      // A new match: the finished one is mutable again.
      this.matchFinished = false;
      this.clearVoteKick();
    }
    return result;
  }

  // A vote-kick belongs to the match it was opened in. Both the end of a match
  // and the start of the next one clear it, so a stale ballot cannot decide a
  // rematch. The replay cache and the cooldowns belong to that match too: a
  // reused request id must not be answered with the finished match's stale
  // vote, and a cooldown must not bleed into the next match.
  clearVoteKick() {
    this.voteKick = null;
    this.voteKickSnapshot = null;
    this.voteKickReplays?.clear?.();
    this.voteKickCooldowns?.clear?.();
    this.voteKickTargetCooldowns?.clear?.();
  }

  pruneExpiredSeats(now = Date.now()) {
    const expired = this.game.players.filter(player => player.disconnected
      && (Number(player.disconnectDeadline) === 0 || Number(player.disconnectDeadline) <= now));
    expired.forEach(player => this.releaseExpiredSeatOrRemove(player));
    ensureRoomHost(this);
    return expired.length;
  }

  releaseExpiredSeatOrRemove(player) {
    if (typeof this.releaseExpiredSeat === 'function') {
      this.releaseExpiredSeat(player);
      return;
    }
    this.game.removePlayerByClient(player.clientId);
  }

  ensureBots() {
    // Desired bot count is derived from retained non-bot seats. Counting
    // existing bots in the available-seat subtraction makes a stable
    // three-human/one-bot table oscillate by deleting its configured bot on
    // every reconciliation pass. An eliminated seat still counts: the
    // rematch revives it, so the slot it holds is not free either.
    const retainedSeats = retainedNonBotSeats(this);
    const availableSeats = Math.max(0, Number(this.settings.maxPlayers) - retainedSeats);
    const required = Math.max(0, Math.min(availableSeats, Number(this.settings.bots) || 0));
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
        clientId: `bot-${this.roomCode}-${this.botSeatSecret}-${index + 1}`,
        nickname: LOBBY_BOT_NAMES[index % LOBBY_BOT_NAMES.length],
        color: colors[index % colors.length],
        isBot: true
      });
      // Bots resolve through the same color-plus-face identity as humans
      // (bot grids are null generic faces), so a bot never duplicates a
      // human icon the way the raw 3-color cycle used to.
      bot.color = resolveFreeAppearanceColor(this.game.players, bot.color, bot, bot.avatarGrid);
      this.game.addPlayer(bot);
    }
  }

  getBankLoanOffer(socketId) {
    return this.game.getBankLoanOffer(this.game.getPlayerBySocket(socketId));
  }

  getRoomSummary(viewerPlayerId = null) {
    // Legacy clients may still send these fields; the server owns scaling now,
    // so they never leave the server side of the wire.
    const publicSettings = stripRetiredRoomSettings(this.settings);
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
      ruleset: {
        overrides: (stripRetiredRoomSettings({ rulesetOverrides: this.ruleset.rulesetOverrides }).rulesetOverrides || [])
          .map(entry => ({ ...entry })),
        boardVariant: this.ruleset.boardVariant,
        revision: this.ruleset.rulesetRevision,
        digest: this.game.rulesetDigest || this.ruleset.digest,
        effectiveSettings: stripRetiredRoomSettings(this.ruleset.effectiveSettings),
        legacyCompatibility: !this.rulesetExplicit
      },
      board: {
        variant: this.ruleset.boardVariant,
        spaces: boardVariantMeta(this.ruleset.boardVariant).spaces,
        corners: boardVariantMeta(this.ruleset.boardVariant).corners
      },
      players: this.game.players.map(player => this.summarySeat(player, viewerPlayerId)),
      voteKick: this.voteKickSnapshot || null,
      started: this.game.started,
      vacationPool: this.game.vacationPool
    };
  }

  summarySeat(player, viewerPlayerId = null) {
    const entry = {
      id: player.id,
      nickname: player.nickname,
      color: player.color,
      cash: player.cash,
      position: player.position,
      inJail: player.inJail,
      jailTurns: player.jailTurns || 0,
      ...this.summarySeatTableState(player),
      ...this.summarySeatAccount(player, viewerPlayerId),
      roomPlayerId: player.id,
      avatarGrid: player.avatarGrid || null
    };
    if (viewerPlayerId && player.id === viewerPlayerId) entry.clientId = player.clientId;
    return entry;
  }

  summarySeatTableState(player) {
    return {
      bankrupt: player.bankrupt,
      spectating: Boolean(player.spectating),
      disconnected: player.disconnected,
      presence: player.isBot ? null : this.summarySeatPresence(player),
      isHost: player.isHost,
      ready: player.ready,
      isBot: player.isBot,
      botBrain: player.isBot ? this.settings.botBrain : null,
      botDifficulty: player.isBot ? this.settings.botDifficulty : null,
    };
  }

  summarySeatPresence(player) {
    return {
      state: player.presence?.state === 'inactive' ? 'inactive' : 'active',
      inactiveSince: Number.isFinite(player.presence?.inactiveSince) ? player.presence.inactiveSince : null,
      inactiveUntil: Number.isFinite(player.presence?.inactiveUntil) ? player.presence.inactiveUntil : null,
    };
  }

  summarySeatAccount(player, viewerPlayerId) {
    return {
      accountId: viewerPlayerId && player.id === viewerPlayerId ? (player.accountId || null) : null,
      accountLinked: Boolean(player.accountId),
    };
  }

  getDirectorySummary() {
    const active = this.game.players.filter(player => !player.disconnected && !player.bankrupt);
    const started = this.game.started;
    return {
      roomId: this.publicId,
      code: this.visibility === 'private' ? this.roomCode : null,
      name: this.roomName,
      // A lobby seat in disconnect grace (or an eliminated seat kept for the
      // rematch) still holds capacity, so the listing counts it: advertising it
      // as open sent joiners to a room that refuses them.
      seats: started ? active.length : this.game.players.length,
      cap: this.settings.maxPlayers,
      bank: `$${Number(this.settings.startingCash).toLocaleString()}`,
      state: started ? 'live' : 'open',
      visibility: this.visibility,
      boardVariant: this.ruleset.boardVariant,
      addOns: this.enabledAddOns(),
      note: started ? 'round live' : 'waiting for players'
    };
  }

  enabledAddOns() {
    const settings = this.ruleset?.effectiveSettings || this.settings;
    return ['playerFinance', 'bankLoans', 'casino', 'market', 'globalEvents', 'flights', 'bankAccountUpgrades']
      .filter(key => Boolean(settings[key]))
      .map(key => ({ playerFinance: 'player finance', globalEvents: 'events', bankLoans: 'bank loans', bankAccountUpgrades: 'bank accounts' })[key] || key);
  }
}

// Room methods that forward a socket-keyed action to the game verbatim are
// installed as generated pass-throughs; only getBankLoanOffer, which maps
// the socket to a player first, stays a hand-written method above.
const GAME_PASSTHROUGHS = [
  'rollDice',
  'flyToAirport',
  'upgradeBankAccount',
  'setAirportFees',
  'purchaseProperty',
  'declineProperty',
  'placeAuctionBid',
  'manageProperty',
  'proposeTrade',
  'respondToTrade',
  'counterTrade',
  'adjustTrade',
  'cancelTrade',
  'proposePlayerContract',
  'counterPlayerContract',
  'adjustPlayerContract',
  'respondPlayerContract',
  'repayPlayerContract',
  'endTurn',
  'payJailFine',
  'useJailFree',
  'useItem',
  'sellItem',
  'takeBankLoan',
  'repayBankLoan',
  'placeCasinoBet',
  'tradeMarket',
  'openMargin',
  'reduceMargin',
  'openShort',
  'coverShort',
  'settleShortDefault',
  'openOption',
  'exerciseOption',
  'closePosition',
  'marketExpansionCandidates',
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
    this.roomDestroyer = null;
  }

  setRoomDestroyer(destroyer) {
    this.roomDestroyer = typeof destroyer === 'function' ? destroyer : null;
  }

  createRoom(hostInfo) {
    const player = new Player({ ...hostInfo, isHost: true });
    // Requested codes must never silently overwrite a live room entry.
    let roomCode = hostInfo.roomCode || this.reserveRoomCode();
    if (this.rooms.has(roomCode)) roomCode = this.reserveRoomCode();
    const room = new Room(player, {
      roomName: hostInfo.roomName,
      visibility: hostInfo.visibility,
      roomCode,
      rulesetOverrides: hostInfo.rulesetOverrides,
      rulesProfile: hostInfo.rulesProfile,
      playerFinance: hostInfo.playerFinance,
      boardVariant: hostInfo.boardVariant,
      marketComplexity: hostInfo.marketComplexity
    });
    room.releaseExpiredSeat = expiredPlayer => this.releaseSeat(room.game, expiredPlayer);
    player.color = resolveFreeAppearanceColor(room.game.players, player.color, player, player.avatarGrid);
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

  getRoomByPublicId(publicId) {
    if (!publicId) return null;
    return [...this.rooms.values()].find(room => room.publicId === String(publicId).trim()) || null;
  }

  getRoomBySocket(socketId) {
    return this.socketRoom.get(socketId) || null;
  }

  restoreConnection(clientId, socketId, accountId = null, onAccountSeatReclaimed = null) {
    const safeId = safeClientId(clientId);
    if (!safeId) return null;
    const room = this.findRestoreRoomFor(safeId, socketId);
    if (!room) return this.restoreAccountSeat(accountId, safeId, socketId, onAccountSeatReclaimed);
    return this.restoreRoomSeat(room, safeId, socketId, accountId);
  }

  restoreRoomSeat(room, safeId, socketId, accountId) {
    if (room.isSeatBlocked(safeId, accountId)) return null;
    const mappedRoom = this.socketRoom.get(socketId);
    if (mappedRoom && mappedRoom !== room) return null;
    const player = room.game.getPlayerByClient(safeId);
    if (!player) return null;
    if (accountId && player.accountId !== accountId) return null;
    if (player.disconnected) return this.restoreDisconnectedSeat(player, room, socketId, accountId);
    return this.restoreLiveSeat(player, room, socketId);
  }

  restoreLiveSeat(player, room, socketId) {
    // Same-socket restores are idempotent; another live socket must never
    // overwrite the seat's bearer socket or its socket-room index.
    if (player.socketId !== socketId) return null;
    this.socketRoom.set(socketId, room);
    return room;
  }

  restoreDisconnectedSeat(player, room, socketId, accountId) {
    if (!seatAccountAllowsReconnect(player, accountId)) return null;
    if (this.identitySeatElsewhere(room, { accountId, socketId })) return null;
    player.socketId = socketId;
    player.disconnected = false;
    player.disconnectDeadline = 0;
    player.disconnectedAt = 0;
    player.presence = { state: 'active', inactiveSince: null, inactiveUntil: null };
    this.socketRoom.set(socketId, room);
    ensureRoomHost(room);
    return room;
  }

  // Tab-restart recovery: a reopened tab has a fresh clientId (sessionStorage
  // dies with the tab), so clientId matching cannot find the seat. The
  // account session survives in localStorage, so a disconnected seat owned
  // by the same account is reclaimed under the new clientId. Connected seats
  // never match: a live tab keeps its seat and the newcomer is rejected,
  // preserving one-seat-per-tab.
  restoreAccountSeat(accountId, clientId, socketId, onAccountSeatReclaimed = null) {
    if (!accountId) return null;
    if (!clientId) return null;
    if (this.socketRoom.has(socketId)) return null;
    if (this.accountHasConnectedSeat(accountId)) return null;
    const seat = this.findDisconnectedAccountSeat(accountId);
    if (!seat) return null;
    const { room, player } = seat;
    // A kick only blocks the room that issued it, not seats at other tables.
    if (room.isSeatBlocked(clientId, accountId)) return null;
    const previousClientId = player.clientId;
    if (typeof onAccountSeatReclaimed === 'function') onAccountSeatReclaimed(previousClientId, room);
    player.clientId = clientId;
    player.socketId = socketId;
    player.disconnected = false;
    player.disconnectDeadline = 0;
    player.disconnectedAt = 0;
    player.presence = { state: 'active', inactiveSince: null, inactiveUntil: null };
    this.socketRoom.set(socketId, room);
    ensureRoomHost(room);
    return room;
  }

  accountHasConnectedSeat(accountId) {
    return [...this.rooms.values()].some(roomItem => roomItem.game.players
      .some(player => player.accountId === accountId && !player.bankrupt && !player.disconnected));
  }

  findDisconnectedAccountSeat(accountId) {
    let best = null;
    for (const room of this.rooms.values()) {
      const player = room.game.players.find(candidate => candidate.accountId === accountId);
      if (!player?.disconnected) continue;
      // The registry order is not the user's history: the account reclaim
      // must not take the oldest disconnected seat, but the one it dropped
      // last (the same seat the socket restore path picks).
      if (!droppedMoreRecently(player, best?.player)) continue;
      best = { room, player };
    }
    return best;
  }

  findLiveRoomFor(clientId) {
    return [...this.rooms.values()].find(roomItem => {
      const player = roomItem.game.getPlayerByClient(clientId);
      if (!player) return false;
      return !player.disconnected;
    });
  }

  // A clientId can hold seats in two rooms (a started seat in grace plus the
  // lobby it moved to). Restore the room this socket already maps to, then a
  // live seat, then the seat that was dropped last (the one the user is in).
  // The ordering key is the actual first drop: a lobby seat's grace restarts
  // for ever, so its deadline cannot tell a fresh drop from a ghost.
  findRestoreRoomFor(clientId, socketId) {
    const mapped = this.socketRoom.get(socketId);
    if (mapped && mapped.game.getPlayerByClient(clientId)) return mapped;
    const live = this.findLiveRoomFor(clientId);
    if (live) return live;
    let best = null;
    let bestPlayer = null;
    for (const roomItem of this.rooms.values()) {
      const player = roomItem.game.getPlayerByClient(clientId);
      if (!player) continue;
      if (!droppedMoreRecently(player, bestPlayer)) continue;
      best = roomItem;
      bestPlayer = player;
    }
    return best;
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

  // One seat per identity across the registry. A clientId keys its grace timer
  // and the leave/restore lookups, and an account plays one table at a time, so
  // a second seat under either identity is refused. A live seat held by the
  // joining socket itself may move rooms; the caller detaches it.
  identitySeatElsewhere(room, { clientId = '', accountId = null, socketId = null } = {}) {
    for (const other of this.rooms.values()) {
      if (other === room) continue;
      for (const player of other.game.players) {
        if (clientId && player.clientId === clientId) {
          if (!player.disconnected && socketId && player.socketId === socketId) continue;
          return player.disconnected
            ? 'That seat is still held by another room. Restore it or wait for it to expire.'
            : 'That seat is already in use.';
        }
        if (accountId && player.accountId === accountId && !player.bankrupt && !player.disconnected && player.socketId !== socketId) {
          return 'This account is already seated in another room.';
        }
      }
    }
    return null;
  }

  // Every live seat bound to a socket, whichever room the socket is mapped to.
  liveSeatsOnSocket(socketId) {
    const seats = [];
    for (const room of this.rooms.values()) {
      room.game.players.forEach(player => {
        if (socketId && player.socketId === socketId && !player.disconnected) seats.push({ room, player });
      });
    }
    return seats;
  }

  listPublicRooms() {
    return [...this.rooms.values()]
      .filter(room => room.visibility === 'public' && room.hasConnectedHumans())
      .map(room => room.getDirectorySummary());
  }

  leaveRoomByClient(clientId, socketId, room = this.getRoomByClient(clientId)) {
    if (!room) return null;
    const player = room.game.getPlayerByClient(clientId);
    if (!player) return null;
    const released = this.releaseSeat(room.game, player);
    if (released?.success === false) return released;
    // Unmap only a socket that is mapped to the room being released. A socket
    // seated in another room keeps its mapping and its live seat there.
    if (socketId && this.socketRoom.get(socketId) === room) {
      this.socketRoom.delete(socketId);
    }
    if (room.game.players.length === 0) {
      if (this.roomDestroyer) this.roomDestroyer(room);
      else this.rooms.delete(room.roomCode);
    }
    return room;
  }

  removeRoomSeat({ clientId, socketId, reason = 'leave', preventRejoin = false, room: targetRoom = null } = {}) {
    const seat = this.roomSeatTarget(clientId, socketId, targetRoom);
    if (seat.error) return { success: false, error: seat.error };
    const { room, player } = seat;
    const wasHost = room.hostId === player.id;
    const releasedRoom = this.leaveRoomByClient(player.clientId, socketId || player.socketId, room);
    if (!releasedRoom) return { success: false, error: SEAT_INACTIVE_ERROR };
    if (releasedRoom.success === false) return releasedRoom;
    if (preventRejoin) this.blockSeatRejoin(room, player);
    if (wasHost) ensureRoomHost(releasedRoom);
    return { success: true, room: releasedRoom, player, reason };
  }

  // An expiring seat names its own room, so a clientId that also holds a seat
  // in another room cannot resolve to the other room's seat.
  roomSeatTarget(clientId, socketId, targetRoom = null) {
    const room = targetRoom || this.getRoomByClient(clientId);
    const player = room?.game.getPlayerByClient(clientId);
    if (!room || !player) return { error: SEAT_INACTIVE_ERROR };
    if (socketId && !this.seatMatchesSocket(player, socketId)) return { error: SEAT_INACTIVE_ERROR };
    return { room, player };
  }

  seatMatchesSocket(player, socketId) {
    if (!player.socketId) return true;
    return player.socketId === socketId;
  }

  // Blocks the removed seat's clientId and accountId only. A guest who returns
  // with a fresh clientId is not blocked: the room keeps no client address to
  // match on (audit D2b-10, documented limit).
  blockSeatRejoin(room, player) {
    room.kickedClientIds.add(player.clientId);
    if (player.accountId) room.kickedAccountIds.add(player.accountId);
  }

  // A real leave releases the seat in the lobby AND mid-game, so the room
  // can drain to empty and the GC can reclaim it.
  releaseSeat(game, player) {
    const playerId = player.id;
    const wasCurrentTurn = this.wasCurrentTurnSeat(game, playerId);
    if (game.started) {
      const prepared = this.releaseStartedSeatAssets(game, player);
      if (prepared?.success === false) return prepared;
    }
    game.removePlayerByClient(player.clientId);
    if (game.started) this.clearStartedGameSeat(game, player, wasCurrentTurn);
    return { success: true };
  }

  releaseStartedSeatAssets(game, player) {
    const prepared = game.prepareCollateralForExit?.(player);
    if (prepared?.success === false) return prepared;
    // A voluntary leave is final. Remove every reference that could otherwise
    // leave orphaned deeds/market holdings or live contracts pointing at a
    // player no longer present in the table.
    const creditor = this.pendingSeatCreditor(game, player);
    this.clearPendingSeatObligations(game, player);
    this.settleSeatExit(game, player, creditor);
    return { success: true };
  }

  // The creditor the leaving seat's estate settles to: its head claim, or the
  // first queued claim it owes (see bankruptcyLogic.outstandingDebtFor).
  pendingSeatCreditor(game, player) {
    return outstandingDebtFor(game, player).creditor;
  }

  // A voluntary leave runs the same settlement ladder as a declared bankruptcy.
  // The bank-loan line is part of that ladder, not an optional extra: once the
  // seat is bankrupt advanceBankLoan skips it forever, so an unsettled loan
  // would stay active/remaining after the player left, keeping the principal
  // and premium they could no longer pay. Optional-call syntax because the
  // method arrives with the bankruptcy mixin on GameState.prototype.
  settleSeatExit(game, player, creditor) {
    game.markPlayerBankrupt?.(player);
    game.liquidateMarketPositions?.(player);
    game.liquidateItems?.(player);
    game.settleBankLoanOnBankruptcy?.(player);
    game.sweepCashToCreditor?.(player, creditor);
    game.settleContractsOnBankruptcy?.(player);
    game.forfeitOrReleaseProperties?.(player, creditor);
    game.feedMessage(`${player.nickname} left the table.`);
  }

  wasCurrentTurnSeat(game, playerId) {
    if (!game.started) return false;
    return game.currentPlayerId === playerId;
  }

  clearStartedGameSeat(game, player, wasCurrentTurn) {
    const playerId = player.id;
    // Consecutive-doubles state belongs to the seated roller, not the seat:
    // otherwise the successor inherits the count and jails one roll early.
    if (wasCurrentTurn) game.consecutiveDoubles = 0;
    // Capture the successor BEFORE filtering: nulling the id and calling
    // nextTurn() restarts at turnOrder[0] and skips the rightful next seat.
    const successor = wasCurrentTurn ? this.findTurnSuccessor(game, playerId) : null;
    this.removeSeatFromTurnOrder(game, playerId);
    this.clearPendingSeatObligations(game, player);
    const survivors = game.connectedNonBankruptPlayers();
    if (survivors.length <= 1) {
      // Only a clock that points at the departed seat (or nowhere) moves; a
      // live seat that still holds it keeps it. The table waits on a seat in
      // reconnect grace, as nextTurn does, instead of ending without it.
      // The inheriting seat starts a fresh turn: keeping the leaver's roll
      // state told it "already rolled" and wedged the table (concludeBankruptRound
      // resets the same way).
      if (!game.getPlayerById(game.currentPlayerId)) {
        game.resetTurnState();
        game.hasRolled = false;
        game.currentPlayerId = survivors[0]?.id || game.waitingSeat()?.id || null;
      }
      game.finishIfNoConnectedPlayers(survivors);
      return;
    }
    if (!wasCurrentTurn) return;
    this.beginSeatExitTurn(game, successor);
  }

  findTurnSuccessor(game, playerId) {
    const turnOrder = game.turnOrder;
    if (!Array.isArray(turnOrder)) return null;
    const oldIndex = turnOrder.indexOf(playerId);
    if (oldIndex < 0) return null;
    const wrapIndex = turnOrder.length - oldIndex - 1;
    const orderedIds = [...turnOrder.slice(oldIndex + 1), ...turnOrder.slice(0, oldIndex + 1)];
    const successorIndex = orderedIds.findIndex(id => this.turnCandidateIsActive(game, id, playerId));
    if (successorIndex < 0) return null;
    return { player: game.getPlayerById(orderedIds[successorIndex]), wrapped: successorIndex >= wrapIndex };
  }

  turnCandidateIsActive(game, candidateId, playerId) {
    const candidate = game.getPlayerById(candidateId);
    if (!candidate) return false;
    if (candidate.id === playerId) return false;
    if (candidate.bankrupt) return false;
    return !candidate.disconnected;
  }

  removeSeatFromTurnOrder(game, playerId) {
    if (typeof game.removePlayerFromTurnOrder === 'function') {
      game.removePlayerFromTurnOrder(playerId);
      return;
    }
    if (Array.isArray(game.turnOrder)) {
      game.turnOrder = game.turnOrder.filter(id => id !== playerId);
    }
  }

  beginSeatExitTurn(game, successor) {
    if (successor) {
      if (successor.wrapped) game.advanceRound();
      // The round limit can end the table inside advanceRound (F-081).
      if (!game.started) return;
      game.resetTurnState();
      game.beginSeatTurn(successor.player);
      return;
    }
    // nextTurn() treats an unknown current id as "before the first seat"
    // and hands the dice to the next surviving player in turn order.
    game.currentPlayerId = null;
    game.nextTurn();
  }

  clearPendingSeatObligations(game, player) {
    const playerId = player.id;
    this.clearSeatPurchaseOffer(game, playerId);
    this.clearSeatPendingPayment(game, player);
    this.clearSeatTrade(game, playerId);
    this.clearSeatContract(game, playerId);
    this.revokeAuctionLead(game, playerId);
  }

  clearSeatPurchaseOffer(game, playerId) {
    game.clearSponsoredPurchaseForPlayer?.(playerId);
    if (game.pendingPurchaseOffer?.playerId === playerId) game.pendingPurchaseOffer = null;
  }

  clearSeatPendingPayment(game, player) {
    // The seat's own queued claims settle against its estate before the head
    // is cancelled below: cancelling the head would promote one of them.
    settleQueuedDebtsOf(game, player, outstandingDebtFor(game, player).creditor);
    game.removeQueuedPaymentsForPlayer?.(player.id);
    if (this.seatIsPaymentDebtor(game, player.id)) {
      this.cancelSeatPayment(game, player);
      return;
    }
    if (this.seatIsPaymentCreditor(game, player.id)) {
      this.cancelSeatPayment(game, player, true);
    }
  }

  seatIsPaymentDebtor(game, playerId) {
    return this.pendingPaymentFrom(game, playerId);
  }

  seatIsPaymentCreditor(game, playerId) {
    const pending = game.pendingPayment;
    if (!pending) return false;
    return pending.creditorId === playerId;
  }

  // A pending debt cannot settle without its creditor: creditRentTo credits
  // the creditor seat and trySettlePendingPayment still debits the payer
  // even when getPlayerById(creditorId) is missing (creditRentTo
  // early-returns on a missing creditor). Forgiving the debt on
  // creditor-quit is the minimal coherent rule; bank debts (creditorId
  // null) never match a quitting seat and are left alone. When the debtor is
  // the roller whose landing created the debt, the roll only resolves through
  // collectPendingPayment, so a forgiven debt must resolve it too (as that
  // method does) or the debtor can neither roll again nor end the turn.
  cancelSeatPayment(game, player, forgiven = false) {
    const pending = game.pendingPayment;
    const turnOptions = game.pendingPaymentTurnOptions || {};
    const debtor = pending ? game.getPlayerById(pending.playerId) : null;
    const resolvesRoll = forgiven && Boolean(debtor) && !debtor.bankrupt
      && game.hasRolled && debtor.id === game.currentPlayerId;
    game.clearPendingPayment();
    game.feedMessage(`${player.nickname} left the table. A pending payment was cancelled.`);
    if (resolvesRoll) game.resolveTurnAfterAction(turnOptions);
  }

  clearSeatTrade(game, playerId) {
    if (this.pendingTradeFrom(game, playerId)) game.pendingTrade = null;
  }

  clearSeatContract(game, playerId) {
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
    auction.highestBid = 0;
    auction.lastBidAt = 0;
  }
}

export { Player, Room, RoomManager };
