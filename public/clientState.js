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
function buildPlayers(choiceIndex, alias) {
  const selected = getAppearanceMeta(choiceIndex);
  // bots always come from the four preset appearances, minus whichever
  // preset color collides with the human's pick (custom profiles never collide)
  const rest = typeof choiceIndex === "number"
    ? APPEARANCES.filter((_, i) => i !== choiceIndex)
    : APPEARANCES.filter((a) => a.color.toLowerCase() !== selected.color.toLowerCase()).slice(0, 3);
  return [
    {
      id: "p1",
      name: (alias.trim() || selected.baseName).toUpperCase(),
      color: selected.color,
      textColor: selected.textColor,
      cash: 1500,
      pos: START_TILE_INDEX,
      online: true,
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
const initialAchievementRecords = loadAchievementRecords();

const state = {
  
  // Per-tab session id (audit #10): sessionStorage survives reloads but is
  // fresh for every tab, so two tabs can no longer share — and hijack — one seat.
  clientId: sessionStorage.getItem("poorup-client-id") || `client-${Date.now()}-${Math.random().toString(36).slice(2)}`,
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
  roomCode: "",
  roomVisibility: "private",
  alias: loadGuestAlias(),
  appearance: 0,
  tableAppearanceOverride: null, // optional one-table override; null inherits active design
  homeTab: "play",          // play | rooms | profile
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
  turnStage: "roll", // roll | end — landing actions happen before explicit end
  pool: 0,
  owners: {},
  highlight: null,
  selectedTile: null,
  tab: "deeds",
  tradeWith: null,
  tradeMyDeeds: new Set(),
  tradeTheirDeeds: new Set(),
  tradeMyCash: 0,
  tradeTheirCash: 0,
  houses: {},      // { [tileId]: 0..4 | 5(hotel) }
  mortgaged: {},   // { [tileId]: true }
  offers: [],      // pending bot→human trade offers
  pendingBuyTile: null, // tile the human must resolve (buy/auction) before ending
  auction: null,        // live auction state object
  deedDetail: null,     // tile index currently open in the deed/house manager
  jail: {},             // { playerId: turnsRemaining }
  roundNumber: 0,
  globalEvent: null,
  playerContractOffer: null,
  playerContracts: { pending: null, active: [] },
  social: { friends: [], requests: [], outgoing: [], invites: [], notifications: [], recentPlayers: [] },
  socialSearchResults: [],
  socialSearchQuery: "",
  socialTab: "friends",
  rulesSection: "start-here",
  rulesQuery: "",
  leaderboard: { metric: "wins", scope: "all", rows: [], snapshots: {}, generatedAt: null, loading: false },
  rankingSearchQuery: "",
  rankingSearchResults: [],
  economy: { casino: { enabled: false, maxBet: 500, lastResult: null, net: 0 }, market: { enabled: false, round: 0, feeRate: 0.02, quotes: {}, positions: {} } },
  selectedPlayer: null,
  selectedPlayerRelationship: "none",
  selectedPlayerView: "profile",
  selectedPlayerHistory: null,
  selectedPlayerHistoryScope: "all",
  card: null,           // { tile, ev, kind } modal reveal
  gameOver: null,       // { winnerName, winnerId, summary[] } end screen
  sound: loadSoundPreference(), // global effects toggle
  music: loadMusicPreference(), // global soundtrack toggle
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
    bankruptMode:    "elim",  // "elim" | "debt" (debt = give assets, stay in)
    bots:            0,        // reserved CPU seats; bot turns are added separately
    botPersonality: "survivor",
    bankLoans:       true,
    bankLoanSeverity: "predatory",
    globalEvents:    false,
    casino:          false,
    market:          false,
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