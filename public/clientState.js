/* ============================================================
   CLIENT STATE: the single shared mutable state object plus the
   profile/appearance helpers that read or mutate it. Imported by
   every client module that needs live UI state (mutated in place).
   ============================================================ */
import {
  APPEARANCES,
  MAX_PROFILES,
  sanitizeProfile,
  saveProfilesToStorage,
  saveActiveDesignId,
  loadAccountSession,
  loadGuestAlias,
  loadProfiles,
  loadActiveDesignId,
  loadSoundPreference,
  loadMusicPreference,
  persistAccountSession,
} from "./clientSanitize.js";
import { ACHIEVEMENT_STORAGE_KEY, loadAchievementRecords } from "./clientAchievements.js";
import { START_TILE_INDEX } from "./clientBoardData.js";
import { DEFAULT_THEME_ID } from "./clientThemeData.js";
// Bots avoid the human's exact icon (color plus face): a custom face in a
// preset color leaves that preset available to the table.
function presetIdentityTakenBy(preset, selected) {
  if (String(preset.color).toLowerCase() !== String(selected.color).toLowerCase()) return false;
  return !selected.avatarGrid;
}

function buildPlayers(choiceIndex, alias) {
  const selected = getAppearanceMeta(choiceIndex);
  // bots always come from the four preset appearances, minus whichever
  // preset exactly matches the human's pick
  const rest = typeof choiceIndex === "number"
    ? APPEARANCES.filter((_, i) => i !== choiceIndex)
    : APPEARANCES.filter((a) => !presetIdentityTakenBy(a, selected)).slice(0, 3);
  return [
    {
      id: "p1",
      name: (alias.trim() || selected.baseName).toUpperCase(),
      color: selected.color,
      textColor: selected.textColor,
      cash: 1500,
      pos: START_TILE_INDEX,
      online: true,
      spectating: false,
      jailFree: 0,
      avatarGrid: selected.avatarGrid || undefined,
    },
    ...rest.slice(0, 3).map((a, i) => ({
      id: `p${i + 2}`,
      name: a.baseName,
      color: a.color,
      textColor: a.textColor,
      cash: [1420, 1680, 980][i],
      pos: START_TILE_INDEX,
      online: i !== 2,
      bot: true,
      jailFree: 0,
      spectating: false,
    })),
  ];
}

function saveUnlockedAchievements() {
  try { localStorage.setItem(ACHIEVEMENT_STORAGE_KEY, JSON.stringify({ version: 2, records: Object.fromEntries(state.achievementRecords) })); } catch { /* storage unavailable */ }
}

function upsertProfile(profile) {
  const clean = sanitizeProfile(profile);
  if (!clean) return null;
  const lib = state.profiles.slice();
  const idx = lib.findIndex((p) => p.id === clean.id);
  if (idx >= 0) {
    lib[idx] = clean;
  } else {
    if (lib.length >= MAX_PROFILES) return "limit";
    lib.push(clean);
  }
  state.profiles = lib;
  saveProfilesToStorage(lib);
  return clean;
}

function deleteProfile(id) {
  state.profiles = state.profiles.filter((p) => p.id !== id);
  saveProfilesToStorage(state.profiles);
  // If the active design was removed, fall back deterministically and persist
  // the fallback so home, account, and the next lobby share one source of truth.
  if (state.appearance === id) {
    state.appearance = state.profiles[0]?.id || 0;
    saveActiveDesignId(state.appearance);
  }
  if (state.tableAppearanceOverride === id) state.tableAppearanceOverride = null;
}

function getProfileById(id) {
  return state.profiles.find((p) => p.id === id) || null;
}

/** Returns display metadata for a setup-overlay appearance choice.
 *  `choice` is either a numeric APPEARANCES index or a profile id string. */
function getAppearanceMeta(choice) {
  if (typeof choice === "string") {
    const p = getProfileById(choice);
    if (p) {
      return {
        label: "CUSTOM",
        baseName: "PLAYER",
        color: p.color,
        textColor: p.color,
        avatarGrid: p.avatarGrid,
      };
    }
  }
  const a = APPEARANCES[choice] || APPEARANCES[0];
  return { label: a.label, baseName: a.baseName, color: a.color, textColor: a.textColor, avatarGrid: null };
}

function saveAccountSession(session) {
  state.account = session;
  persistAccountSession(session);
}

function loadClientId() {
  try {
    return sessionStorage.getItem("poorup-client-id") || "";
  } catch {
    return "";
  }
}

const initialAchievementRecords = loadAchievementRecords();

const state = {
  
  // Per-tab session id (audit #10): sessionStorage survives reloads but is
  // fresh for every tab, so two tabs can no longer share — and hijack — one seat.
  clientId: loadClientId() || `client-${Date.now()}-${Math.random().toString(36).slice(2)}`,
  account: loadAccountSession(),
  hostId: null,
  serverTiles: [],
  pendingRoomSettings: null,
  pendingRoomMeta: null,
  suppressRoomUpdates: false,
  // Server-minus-local clock skew (ms), refreshed from every snapshot's
  // serverTime so auction deadlines survive a skewed local clock (audit #18).
  serverTimeOffset: 0,
  lastConnectionAnnouncement: "",
  previousTurnKey: "",
  phase: "home", // home | setup | lobby | playing
  roomEntryPending: false,
  roomEntryRequestId: "",
  roomPlayerId: null,
  roomCode: "",
  roomVisibility: "private",
  boardVariant: "standard-40",
  ruleset: null,
  alias: loadGuestAlias(),
  appearance: 0,
  tableAppearanceOverride: null, // optional one-table override; null inherits active design
  homeTab: "play",          // play | rooms | profile
  themeId: DEFAULT_THEME_ID, // client-only visual preference
  themePopoverOpen: false,
  maintenance: {
    mode: "normal",
    message: "",
    releaseId: "",
    drainDeadline: null,
    activeRounds: 0,
  },
  profileTab: "designs",    // overview | stats | designs | history | account
  setupTab: "preset",         // "preset" | "custom" — which tab is showing in the setup grid
  profiles: loadProfiles(),   // persisted array of saved player designs
  achievementRecords: initialAchievementRecords,
  unlockedAchievements: new Set(initialAchievementRecords.keys()),
  achievementFilter: "all",
  achievementDateFilter: "all",
  achievementRarityFilter: "all",
  profileDraft: null,         // working copy while the profile editor is open
  editingProfileId: null,     // id of profile being edited (null = brand new)
  homeReturnView: "home",     // where the profile editor's back button should return to
  players: buildPlayers(0, "MARLOWE"),
  turnIndex: 0,
  dice: [3, 5],
  rolling: false,
  busy: false,
  // A local action stays locked until its acknowledgement or timeout. A
  // server snapshot alone is not proof that the request was accepted.
  pendingAction: null,
  turnStage: "roll", // roll | end — landing actions happen before explicit end
  pool: 0,
  owners: {},
  highlight: null,
  selectedTile: null,
  // Right-rail intent. Legacy values are normalized by the renderer so a
  // reconnect or an older saved tab cannot strand the player on a dead view.
  tab: "holdings",
  dealsFilter: "needs-you",
  activityMode: "indexes",
  financeBankOpen: false,
  panelVisibility: {
    players: true,
    chat: true,
    rightRail: true,
    hud: "full",
  },
  walletView: "account",
  walletItemId: null,
  tradeWith: null,
  tradeCounterId: null,
  tradeAdjustId: null,
  tradeMyDeeds: new Set(),
  tradeTheirDeeds: new Set(),
  tradeMyCash: 0,
  tradeTheirCash: 0,
  houses: {},      // { [tileId]: 0..4 | 5(hotel) }
  mortgaged: {},   // { [tileId]: true }
  offers: [],      // pending bot→human trade offers
  pendingTrade: null,
  pendingBuyTile: null, // tile the human must resolve (buy/auction) before ending
  sponsorship: null,    // optional escrowed contribution flow for the open purchase
  auction: null,        // live auction state object
  deedDetail: null,     // tile index currently open in the deed/house manager
  jail: {},             // { playerId: turnsRemaining }
  roundNumber: 0,
  // `roundNumber` restarts at one for every rematch; retain the started
  // transition so stale game-over state cannot survive a new game.
  gameStarted: false,
  turnDeadline: 0,
  globalEvent: null,
  globalEventVotePending: false,
  playerContractOffer: null,
  negotiationContractId: null,
  playerContracts: { pending: null, active: [] },
  social: { friends: [], requests: [], outgoing: [], invites: [], notifications: [], recentPlayers: [] },
  socialSearchResults: [],
  socialSearchQuery: "",
  socialTab: "friends",
  rulesSection: "start-here",
  rulesQuery: "",
  leaderboard: { metric: "wins", scope: "all", rows: [], snapshots: {}, generatedAt: null, loading: false, error: "", requestId: 0 },
  season: { current: null, metric: "points", rows: [], rewards: [], claimedRewardIds: [], loading: false, error: "" },
  cosmetics: { tokens: 0, owned: [], equipped: {}, claims: [], catalog: [], loading: false, error: "" },
  cosmeticPreviewId: null,
  rankingSearchQuery: "",
  rankingSearchResults: [],
  economy: { casino: { enabled: false, maxBet: 500, lastResult: null, net: 0 }, market: { enabled: false, round: 0, feeRate: 0.02, quotes: {}, positions: {} } },
  economySnapshotStatus: "unknown", // unknown | fresh | stale
  selectedPlayer: null,
  selectedPlayerRelationship: "none",
  selectedPlayerView: "profile",
  selectedPlayerHistory: null,
  selectedPlayerHistoryScope: "all",
  botStatus: null,
  botProviderStatus: null,
  card: null,           // { tile, ev, kind } modal reveal
  gameOver: null,       // { winnerName, winnerId, summary[] } end screen
  sound: loadSoundPreference(), // global effects toggle
  // Canonical global soundtrack preference. The hidden theme-music runtime
  // mirrors this value but never owns or replaces it (including across tabs).
  music: loadMusicPreference(),
  quickJoin: false,     // "quick table" uses all-default rules
  settings: {
    maxPlayers:      4,       // 2 – 4
    startingCash:    1500,    // 1000 / 1500 / 2000 / 3000
    vacationPool:    true,    // free-parking jackpot on/off
    trading:         true,    // trading on/off
    auction:         false,   // auction unowned deeds on/off
    doubleGo:        false,   // $400 for landing exactly on GO
    noRentInJail:    true,    // owner can't collect while visiting
    houseLimit:      32,      // house bank 10 / 20 / 32 (unlimited)
    hotelLimit:      12,      // hotel bank 6 / 12 (unlimited)
    turnTimer:       0,       // seconds per turn: 0=off, 30, 60, 120
    bankruptMode:    "elim",  // legacy snapshot key; bankruptcy always eliminates/spectates
    bots:            0,        // reserved CPU seats; bot turns are added separately
    botPersonality: "survivor",
    botBrain:        "ai",    // "ai" | "no-ai" (legacy "auto" normalizes to "ai")
    botDifficulty:   "table", // "house" | "table" | "expert"
    bankLoans:       true,
    bankLoanSeverity: "predatory",
    items:           false,
    bankAccountUpgrades: false,
    predictionMarket: false,
    globalEvents:    false,
    casino:          false,
    market:          false,
    rulesetPreset:   "classic",
    rulesetBase:     "classic",
    rulesetOverrides: [],
    boardVariant:    "standard-40",
    rulesetRevision: 1,
    marketComplexity: "basic",
    globalEventDuration: 5,
    globalEventMax:  1,
  },
  log: ["WAITING FOR GAME — CHOOSE YOUR APPEARANCE."],
  messages: [
    { who: "", color: "", text: "TABLE OPENED. CHOOSE YOUR APPEARANCE.", system: true },
    { who: "", color: "", text: "JOIN A ROOM TO GET STARTED.", system: true },
  ],
};

if (state.profiles.length) {
  state.appearance = loadActiveDesignId(state.profiles);
  state.alias = loadGuestAlias();
  state.players = buildPlayers(state.appearance, state.alias);
}
if (state.account) {
  state.alias = state.account.account.displayName;
  state.players = buildPlayers(state.appearance, state.alias);
}

try { sessionStorage.setItem("poorup-client-id", state.clientId); } catch { /* storage unavailable */ }

function activeAppearance() {
  return state.tableAppearanceOverride ?? state.appearance;
}

function syncLocalAppearance() {
  const self = state.players.find((player) => player.id === "p1" || player.clientId === state.clientId);
  if (!self) return;
  const meta = getAppearanceMeta(activeAppearance());
  self.color = meta.color;
  self.textColor = meta.textColor;
  self.avatarGrid = meta.avatarGrid || undefined;
}

export {
  state,
  activeAppearance,
  syncLocalAppearance,
  saveAccountSession,
  buildPlayers,
  getProfileById,
  getAppearanceMeta,
  upsertProfile,
  deleteProfile,
  saveUnlockedAchievements,
};
