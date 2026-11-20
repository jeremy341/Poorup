// One table: its seats, room settings and ruleset, lobby persistence snapshot and the summaries sent to clients. The Room wraps a GameState
// (the rules engine). Seats are roomSeat.js; finding and restoring rooms is roomManager.js, which rooms.js re-exports so gameLogic.js can
// keep re-exporting Room and RoomManager. GameState is imported circularly and only used at call time inside the Room constructor.
import crypto from 'crypto';
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
import { cleanPlayerName, nicknameRejection } from './nicknamePolicy.js';
import { personaForSeat } from './botPersonas.js';
import { botPersonaStore } from './botPersonaStore.js';
import { GameState } from './gameLogic.js';
import { LOBBY_SNAPSHOT_SCHEMA, plainJson } from './lobbySnapshot.js';
import { ensureRoomHost, LOBBY_ABSENT_SEAT_MS, Player, safeNickname } from './roomSeat.js';
import {
  boardVariantMeta,
  KNOWN_OVERRIDE_KEYS,
  normalizeOverrides,
  OPTIONAL_SYSTEM_KEYS,
  resolveRuleset,
  safeBoardVariant
} from './rulesetRegistry.js';

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

// Capacity-driven settings are refused when they would strand an occupied seat. A boardVariant write counts: its board meta owns
// maxPlayers, and applyBoardVariantSetting would silently apply that smaller limit, leaving a 4-seat board on a 5-seat turn order.
// Resolve the incoming board's own limit so the downgrade is refused through the same door as maxPlayers.
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

// Every retained non-bot seat holds capacity, including an eliminated one: resetForNewGame revives bankrupt seats for the rematch,
// so a table counting only solvent humans grows past maxPlayers when a seat is eliminated and a bot fills the slot already taken.
function retainedNonBotSeats(room) {
  return room.game.players.filter(player => !player.isBot).length;
}


function syncBotCapacity(room, key, value) {
  if (key !== 'maxPlayers') return;
  const maxBots = Math.max(0, value - 1);
  if (Number(room.settings.bots) <= maxBots) return;
  room.settings.bots = maxBots;
  room.game.settings.bots = maxBots;
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

class Room {
  constructor(hostPlayer, {
    roomName = 'AFTER HOURS',
    visibility = 'public',
    roomCode,
    rulesetOverrides,
    boardVariant,
    marketComplexity,
    rulesProfile,
    playerFinance
  } = {}) {
    const rulesetInput = { rulesetOverrides, boardVariant, marketComplexity, rulesProfile, playerFinance };
    this.roomCode = roomCode;
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
    if (marketComplexity !== undefined && !this.settings.rulesetOverrides.some(entry => entry.key === 'marketComplexity')) {
      this.settings.rulesetOverrides.push({ key: 'marketComplexity', value: marketComplexity });
    }
    this.refreshRuleset();
    this.game = new GameState(this.settings);
    this.game.ruleset = this.ruleset;
    this.game.legacyRuleset = false;
    this.game.boardVariant = this.ruleset.boardVariant;
    this.game.onSeatEliminated = () => ensureRoomHost(this);
    // The room owns the vote-kick, so it learns that the match is over here. A finished match is not mutable: the vote-kick start and the
    // seat removal it decides belong to a running match (a lobby that never played keeps them).
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
    // A clientId is a bearer key for guest seats, but it must never let a different signed-in account take over an account-owned seat
    // (or attach its account to a guest seat). Fast reloads without a token remain supported, since the clientId is the session credential.
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

  // The reconnect hole was two split updates: an omitted or invalid color skipped identity resolution, then any grid applied blindly.
  // The effective color (incoming when hex, else current) always resolves against the effective grid (incoming when provided, else
  // current) before either field is written, matching setPlayerAppearance.
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

  // A lobby seat's grace restarts forever (the empty-room GC is its only expiry), so a human who dropped and never came back would hold
  // capacity for good. Release seats whose first drop is older than one grace window, but only when a newcomer needs the room;
  // socketRuntime stamps disconnectedAt.
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

  // A persistable lobby has never started and is not a finished match's leftover room. Bot seats are not stored: ensureBots() re-derives
  // them from settings.bots at restore, and no socket id, disconnect clock or readiness flag is stored either.
  isPersistableLobby() {
    return !this.destroyed && !this.game.started && !this.matchFinished && this.hasHumanSeats();
  }

  toLobbySnapshot() {
    return {
      schema: LOBBY_SNAPSHOT_SCHEMA,
      kind: 'lobby',
      roomCode: this.roomCode,
      publicId: this.publicId,
      roomName: this.roomName,
      visibility: this.visibility,
      hostId: this.hostId,
      settings: plainJson(stripRetiredRoomSettings(this.settings)),
      kickedClientIds: [...this.kickedClientIds],
      kickedAccountIds: [...this.kickedAccountIds],
      players: this.game.players.filter(player => !player.isBot).map(player => ({
        id: player.id,
        clientId: player.clientId,
        nickname: player.nickname,
        color: player.color,
        avatarGrid: player.avatarGrid,
        accountId: player.accountId
      }))
    };
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

  // A vote-kick belongs to the match it was opened in. Both the end of a match and the start of the next clear it, so a stale ballot
  // cannot decide a rematch. The replay cache and cooldowns belong to that match too: a reused request id must not be answered with
  // the finished match's vote, and a cooldown must not bleed into the next match.
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
    // Desired bot count is derived from retained non-bot seats. Counting existing bots in the available-seat subtraction would make a
    // stable three-human, one-bot table oscillate, deleting its bot on every reconciliation pass. An eliminated seat still counts:
    // the rematch revives it, so its slot is not free either.
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
      const persona = personaForSeat(this.settings.botDifficulty, index);
      const bot = new Player({
        clientId: `bot-${this.roomCode}-${this.botSeatSecret}-${index + 1}`,
        nickname: persona.name,
        color: colors[index % colors.length],
        isBot: true
      });
      bot.personaId = persona.id;
      // Bots resolve through the same color-plus-face identity as humans
      // (bot grids are null generic faces), so a bot never duplicates a
      // human icon the way a raw 3-color cycle would.
      bot.color = resolveFreeAppearanceColor(this.game.players, bot.color, bot, bot.avatarGrid);
      this.game.addPlayer(bot);
    }
  }

  getBankLoanOffer(socketId) {
    return this.game.getBankLoanOffer(this.game.getPlayerBySocket(socketId));
  }

  getRoomSummary(viewerPlayerId = null) {
    // Legacy clients may still send these fields; the server owns scaling,
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
        legacyCompatibility: false
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
      personaStats: player.isBot ? botPersonaStore.profileFor(player.personaId) : null,
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

export { Room };
export { RoomManager } from './roomManager.js';


