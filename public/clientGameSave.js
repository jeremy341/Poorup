/* ============================================================
   GAME SAVE: local persist/resume for the live table plus the
   shared restore-session ack (A4-F2). emitServer,
   setConnectionStatus, showView and renderAll are injected by
   the entry module; storage keys and payload fields are verbatim.
   ============================================================ */
import { state } from "./clientState.js";
import { applyProfileToHomeUI } from "./clientProfileRender.js";
import { parlorNotice } from "./clientSocialSurfaces.js";

let host = { emitServer: noop, setConnectionStatus: noop, showView: noop, renderAll: noop };

function noop() {}

export function configureGameSave(hooks) {
  host = { ...host, ...hooks };
}
const SAVE_KEY = "poorup.save.v1";
const SAVE_VERSION = 2;
const LEGACY_TILE_INDEX_MAP = Object.freeze({ 0: 20, 10: 30, 20: 0, 30: 10 });

function migrateSavedBoardLayout(saved) {
  if (!saved || saved.v !== 1) return saved;
  const remapIndexMap = (value) => Object.fromEntries(
    Object.entries(value || {}).map(([key, entry]) => [LEGACY_TILE_INDEX_MAP[key] ?? key, entry]),
  );
  return {
    ...saved,
    v: SAVE_VERSION,
    players: saved.players.map((player) => ({
      ...player,
      pos: LEGACY_TILE_INDEX_MAP[player.pos] ?? player.pos,
    })),
    owners: remapIndexMap(saved.owners),
    houses: remapIndexMap(saved.houses),
    mortgaged: remapIndexMap(saved.mortgaged),
  };
}






/* ---- persist / resume ---- */
function saveGame() {
  if (state.phase !== "playing") return;
  try {
    localStorage.setItem(SAVE_KEY, JSON.stringify({
      v: SAVE_VERSION,
      roomCode: state.roomCode,
      players: state.players,
      owners: state.owners,
      houses: state.houses,
      mortgaged: state.mortgaged,
      pool: state.pool,
      turnIndex: state.turnIndex,
      dice: state.dice,
      settings: state.settings,
      log: state.log,
      messages: state.messages,
    }));
  } catch { /* ignore */ }
}

function loadSavedGame() {
  try {
    const raw = localStorage.getItem(SAVE_KEY);
    if (!raw) return null;
    const s = JSON.parse(raw);
    if (!s) return null;
    if (![1, SAVE_VERSION].includes(s.v)) return null;
    if (!Array.isArray(s.players)) return null;
    if (!s.players.length) return null;
    return s.v === 1 ? migrateSavedBoardLayout(s) : s;
  } catch { return null; }
}

function clearSave() {
  try { localStorage.removeItem(SAVE_KEY); } catch { /* ignore */ }
}

/** Shared restore-session ack (A4-F2): report real failures visibly, clear the
    room mute, and only return to the parlor view when the player is mid-room. */
function reportRestoreFailure(response, explicit) {
  if (!explicit && state.phase === "home") return;
  parlorNotice("CONNECTION", response.error || "No active room session was found.");
  host.setConnectionStatus("offline", true);
}
function applyRestoredVisibility(visibility) {
  state.roomVisibility = visibility === "public" ? "public" : "private";
}
function applyRestoredSession(response, explicit) {
  state.suppressRoomUpdates = false;
  if (Object.prototype.hasOwnProperty.call(response, "roomCode")) state.roomCode = response.roomCode || state.roomCode;
  if (response.visibility) applyRestoredVisibility(response.visibility);
  // An explicit "Resume round" click always returns to the parlor — it is the
  // documented escape from a stuck mute; a background reconnect only re-asserts
  // the view when the player never left the room session.
  if (explicit || state.phase !== "home") host.showView("game");
  host.renderAll();
}

function handleRestoreSessionResponse(response, explicit = false) {
  if (response?.success === false) {
    reportRestoreFailure(response, explicit);
    if (explicit) {
      clearSave();
      applyProfileToHomeUI();
    }
    return;
  }
  if (!response?.success) return;
  applyRestoredSession(response, explicit);
}

function resumeGame() {
  // Clear the room mute before asking for the session so the restored
    // snapshots can render again ("Resume round" was a dead no-op, A6-F2).
    state.suppressRoomUpdates = false;
    host.emitServer("restore-session", {}, (response) => handleRestoreSessionResponse(response, true));
    return;
}

export { saveGame, loadSavedGame, clearSave, handleRestoreSessionResponse, resumeGame };
