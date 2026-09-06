/* ============================================================
   CLIENT SANITIZE: profile / account / preference storage layer.
   Pure localStorage readers and writers; runtime state lives in
   clientState.js, which consumes these helpers at boot.
   ============================================================ */
import { FACE_SIZE } from "./clientSprites.js";
const PROFILE_KEY = "poorup.profile.v1";   // legacy single profile
const LIBRARY_KEY = "poorup.profiles.v1";  // array of saved profiles
const ACCOUNT_SESSION_KEY = "poorup.account.session.v1";
const GUEST_ALIAS_KEY = "poorup.guest.alias.v1";
const ACTIVE_DESIGN_KEY = "poorup.active-design.v1";
const SOUND_KEY = "poorup.sound.enabled.v1";
const MUSIC_KEY = "poorup.music.enabled.v1";

const APPEARANCES = [
  { label: "CRIMSON", baseName: "MARLOWE", color: "#d74438", textColor: "#d74438" },
  { label: "COBALT", baseName: "VESPER", color: "#286ea1", textColor: "#3c8bc3" },
  { label: "AMBER", baseName: "SOLOMON", color: "#d9a62f", textColor: "#d9a62f" },
  { label: "VERDANT", baseName: "JUNIPER", color: "#35a653", textColor: "#35a653" },
];

const HEX_COLOR = /^#[0-9a-f]{6}$/i;

function isHexColor(color) {
  return HEX_COLOR.test(String(color || ""));
}

function cleanDesignName(source) {
  const raw = source.designName || source.name || "PLAYER";
  return String(raw).toUpperCase().slice(0, 12) || "PLAYER";
}

function hasValidGridRows(grid) {
  if (!Array.isArray(grid)) return false;
  return grid.every((row) => Array.isArray(row));
}

function sanitizeGridCell(row, x) {
  const value = row?.[x];
  if (typeof value !== "string") return null;
  return isHexColor(value) ? value : null;
}

function buildFaceGrid(rows) {
  return Array.from({ length: FACE_SIZE }, (_, y) =>
    Array.from({ length: FACE_SIZE }, (_, x) => sanitizeGridCell(rows[y], x)),
  );
}

function cleanProfileId(id) {
  if (typeof id === "string") return id;
  return `pf_${Math.random().toString(36).slice(2, 9)}`;
}

function sanitizeProfile(p) {
  if (!p || typeof p !== "object") return null;
  if (!isHexColor(p.color)) return null;
  if (!hasValidGridRows(p.avatarGrid)) return null;
  return {
    id: cleanProfileId(p.id),
    designName: cleanDesignName(p),
    color: p.color,
    avatarGrid: buildFaceGrid(p.avatarGrid),
  };
}

function profileDesignName(profile) {
  return String(profile?.designName || profile?.name || "PLAYER").trim().toUpperCase().slice(0, 12) || "PLAYER";
}

function parseStoredLibrary(raw) {
  if (!raw) return [];
  const arr = JSON.parse(raw);
  if (!Array.isArray(arr)) return [];
  return arr.map(sanitizeProfile).filter(Boolean);
}

function migrateLegacyProfile() {
  try {
    const legacy = sanitizeProfile(JSON.parse(localStorage.getItem(PROFILE_KEY) || "null"));
    if (!legacy) return [];
    saveProfilesToStorage([legacy]);
    localStorage.removeItem(PROFILE_KEY);
    return [legacy];
  } catch { /* ignore */ }
  return [];
}

function loadProfiles() {
  let library = [];
  try {
    library = parseStoredLibrary(localStorage.getItem(LIBRARY_KEY));
  } catch { /* ignore */ }
  if (library.length) return library;
  return migrateLegacyProfile();
}

function presetDesignIndex(raw) {
  if (!/^\d+$/.test(raw)) return -1;
  const preset = Number(raw);
  if (preset < 0 || preset >= APPEARANCES.length) return -1;
  return preset;
}

function loadActiveDesignId(profiles = []) {
  let raw = "";
  try { raw = String(localStorage.getItem(ACTIVE_DESIGN_KEY) || ""); } catch { /* storage unavailable */ }
  const preset = presetDesignIndex(raw);
  if (preset >= 0) return preset;
  if (raw && profiles.some((profile) => profile.id === raw)) return raw;
  return profiles[0]?.id || 0;
}

function saveActiveDesignId(choice) {
  try { localStorage.setItem(ACTIVE_DESIGN_KEY, String(choice)); } catch { /* storage unavailable */ }
}

function loadSoundPreference() {
  try { return localStorage.getItem(SOUND_KEY) === "1"; } catch { return false; }
}

function saveSoundPreference(enabled) {
  try { localStorage.setItem(SOUND_KEY, enabled ? "1" : "0"); } catch { /* storage unavailable */ }
}

function loadMusicPreference() {
  try { return localStorage.getItem(MUSIC_KEY) === "1"; } catch { return false; }
}

function saveMusicPreference(enabled) {
  try { localStorage.setItem(MUSIC_KEY, enabled ? "1" : "0"); } catch { /* storage unavailable */ }
}

function loadGuestAlias() {
  try {
    return String(localStorage.getItem(GUEST_ALIAS_KEY) || "").trim().toUpperCase().slice(0, 12);
  } catch {
    return "";
  }
}

function saveGuestAlias(alias) {
  const value = String(alias || "").trim().toUpperCase().slice(0, 12);
  try {
    if (value) localStorage.setItem(GUEST_ALIAS_KEY, value);
    else localStorage.removeItem(GUEST_ALIAS_KEY);
  } catch { /* storage unavailable */ }
  return value;
}

const ACCOUNT_FALLBACK_COLOR = "#d74438";
const HISTORY_VISIBILITY = ["public", "friends", "private"];
const REQUEST_VISIBILITY = ["everyone", "friends", "nobody"];

function isRecord(value) {
  if (!value) return false;
  return typeof value === "object";
}

function statCount(source, key) {
  return Number(source?.[key]) || 0;
}

function cleanAccountStats(stats) {
  return {
    gamesPlayed: statCount(stats, "gamesPlayed"),
    wins: statCount(stats, "wins"),
    bankruptcies: statCount(stats, "bankruptcies"),
    auctionWins: statCount(stats, "auctionWins"),
    rentCollected: statCount(stats, "rentCollected"),
    eventSurvival: statCount(stats, "eventSurvival"),
    casinoNet: statCount(stats, "casinoNet"),
    marketProfit: statCount(stats, "marketProfit"),
    playerLoansGiven: statCount(stats, "playerLoansGiven"),
    playerLoansRepaid: statCount(stats, "playerLoansRepaid"),
    playerLoanDefaults: statCount(stats, "playerLoanDefaults"),
    equityDeals: statCount(stats, "equityDeals"),
    bankLoansTaken: statCount(stats, "bankLoansTaken"),
    bankLoanRepayments: statCount(stats, "bankLoanRepayments"),
    bankLoanDefaults: statCount(stats, "bankLoanDefaults"),
    patrolBest: statCount(stats, "patrolBest"),
    patrolAceRuns: statCount(stats, "patrolAceRuns"),
  };
}

function historyPlayedAt(entry) {
  if (typeof entry.playedAt === "string") return entry.playedAt;
  return null;
}

function historyResult(entry) {
  if (entry.result === "WIN") return "WIN";
  return "ROUND";
}

function historyWon(entry) {
  if (entry.won === true) return true;
  return entry.result === "WIN";
}

function historyCount(value) {
  return Math.max(0, Number(value) || 0);
}

function cleanHistoryEntry(entry) {
  return {
    playedAt: historyPlayedAt(entry),
    result: historyResult(entry),
    won: historyWon(entry),
    endingCash: historyCount(entry.endingCash),
    properties: historyCount(entry.properties),
  };
}

function cleanAccountHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.filter(isRecord).slice(0, 50).map(cleanHistoryEntry);
}

function cleanMatchHistory(history) {
  if (!Array.isArray(history)) return [];
  return history.filter(isRecord).slice(0, 50);
}

function isAchievementEntry(entry) {
  if (!entry) return false;
  return typeof entry.id === "string";
}

function cleanAchievementEntry(entry) {
  return {
    id: entry.id,
    unlockedAt: typeof entry.unlockedAt === "string" ? entry.unlockedAt : null,
  };
}

function cleanAccountAchievements(achievements) {
  if (!Array.isArray(achievements)) return [];
  return achievements.filter(isAchievementEntry).slice(0, 100).map(cleanAchievementEntry);
}

function privacyHistory(privacy) {
  const value = privacy?.history;
  if (HISTORY_VISIBILITY.includes(value)) return value;
  return "friends";
}

function privacyAchievements(privacy) {
  if (privacy?.achievements === "private") return "private";
  return "friends";
}

function privacyRequests(privacy) {
  const value = privacy?.friendRequests;
  if (REQUEST_VISIBILITY.includes(value)) return value;
  return "everyone";
}

function privacyInvites(privacy) {
  if (privacy?.roomInvites === "nobody") return "nobody";
  return "friends";
}

function cleanAccountPrivacy(privacy) {
  return {
    history: privacyHistory(privacy),
    achievements: privacyAchievements(privacy),
    friendRequests: privacyRequests(privacy),
    roomInvites: privacyInvites(privacy),
  };
}

function accountDisplayName(account) {
  const raw = account.displayName || account.username;
  return String(raw).slice(0, 18);
}

function accountAvatarGrid(grid) {
  if (Array.isArray(grid)) return grid;
  return null;
}

function sanitizedAccount(account) {
  return {
    id: account.id,
    username: account.username,
    displayName: accountDisplayName(account),
    color: isHexColor(account.color) ? account.color : ACCOUNT_FALLBACK_COLOR,
    avatarGrid: accountAvatarGrid(account.avatarGrid),
    stats: cleanAccountStats(account.stats),
    history: cleanAccountHistory(account.history),
    matchHistory: cleanMatchHistory(account.matchHistory),
    achievements: cleanAccountAchievements(account.achievements),
    privacy: cleanAccountPrivacy(account.privacy),
  };
}

function sanitizeAccountSession(value) {
  if (!value) return null;
  if (typeof value !== "object") return null;
  if (typeof value.sessionToken !== "string") return null;
  const account = value.account;
  if (!account) return null;
  if (typeof account.id !== "string") return null;
  if (typeof account.username !== "string") return null;
  return { sessionToken: value.sessionToken, account: sanitizedAccount(account) };
}

function persistAccountSession(session) {
  try {
    if (session) localStorage.setItem(ACCOUNT_SESSION_KEY, JSON.stringify(session));
    else localStorage.removeItem(ACCOUNT_SESSION_KEY);
  } catch { /* storage unavailable */ }
}

function loadAccountSession() {
  try {
    return sanitizeAccountSession(JSON.parse(localStorage.getItem(ACCOUNT_SESSION_KEY) || "null"));
  } catch {
    return null;
  }
}

function saveProfilesToStorage(library) {
  try {
    localStorage.setItem(LIBRARY_KEY, JSON.stringify(library));
  } catch { /* ignore */ }
}

const MAX_PROFILES = 4;

export {
  APPEARANCES,
  PROFILE_KEY,
  LIBRARY_KEY,
  ACCOUNT_SESSION_KEY,
  GUEST_ALIAS_KEY,
  ACTIVE_DESIGN_KEY,
  SOUND_KEY,
  MUSIC_KEY,
  sanitizeProfile,
  profileDesignName,
  loadProfiles,
  saveProfilesToStorage,
  loadActiveDesignId,
  saveActiveDesignId,
  loadSoundPreference,
  saveSoundPreference,
  loadMusicPreference,
  saveMusicPreference,
  loadGuestAlias,
  saveGuestAlias,
  sanitizeAccountSession,
  loadAccountSession,
  persistAccountSession,
  MAX_PROFILES,
};