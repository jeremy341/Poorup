// Seat appearance as a prototype mixin plus the shared color helpers rooms
// use when seating humans and bots. gameLogic.js assigns the object onto
// GameState.prototype and re-exports APPEARANCE_PRESET_COLORS.

import { cleanPlayerName, nicknameRejection } from './nicknamePolicy.js';

// The four default appearance presets, in server assignment order.
const APPEARANCE_PRESET_COLORS = ['#d74438', '#286ea1', '#d9a62f', '#35a653'];

// Valid faces mirror the account path (server/accountStore.js sanitize: 8x8 cap, hex-or-null cells).
// Legacy small numeric faces such as [[1,0],[0,1]] still pass. Oversized grids and non-hex strings
// are malformed and get AVATAR_GRID_ERROR, never the taken-icon error.
const AVATAR_GRID_SIZE = 8;
const AVATAR_GRID_ERROR = 'Avatar face must be up to 8x8 cells of hex colors.';
const HEX_CELL_RE = /^#[0-9a-fA-F]{6}$/;

function isValidAvatarGridCell(cell) {
  if (cell === null) return true;
  if (typeof cell === 'number') return true;
  if (typeof cell !== 'string') return false;
  return HEX_CELL_RE.test(cell);
}

function listLengthOutOfBounds(list) {
  if (list.length < 1) return true;
  return list.length > AVATAR_GRID_SIZE;
}

function everyValidCell(row) {
  for (const cell of row) {
    if (isValidAvatarGridCell(cell)) continue;
    return false;
  }
  return true;
}

function isValidAvatarGrid(grid) {
  if (grid === null) return true;
  if (!Array.isArray(grid)) return false;
  if (listLengthOutOfBounds(grid)) return false;
  for (const row of grid) {
    if (!Array.isArray(row)) return false;
    if (listLengthOutOfBounds(row)) return false;
    if (!everyValidCell(row)) return false;
  }
  return true;
}

// Identity is color plus face: two seats share an icon only when both match, so a custom face
// in a preset color is its own icon. Grids are fixed 8x8, so JSON is a deterministic signature;
// hex cells are lowercased because editors may emit either case.
function faceSignature(avatarGrid) {
  if (!Array.isArray(avatarGrid)) return 'generic';
  const inked = avatarGrid.some((row) => Array.isArray(row) && row.some((cell) => Boolean(cell)));
  if (!inked) return 'generic';
  return JSON.stringify(avatarGrid, (key, value) => (typeof value === 'string' ? value.toLowerCase() : value));
}

function appearanceIdentity(color, avatarGrid) {
  return `${String(color).toLowerCase()}|${faceSignature(avatarGrid)}`;
}

// One shared rule for which seats count in identity checks: connected,
// non-bankrupt seats (other than the acting seat) carrying a string color.
function seatCountsForIdentity(other, self) {
  if (other === self) return false;
  if (other.disconnected) return false;
  if (other.bankrupt) return false;
  return typeof other.color === 'string';
}

// Resolves a requested seat look against icons taken by connected non-bankrupt players (not the own seat).
// An exact-identity collision becomes the first free preset, or keeps the requested color if none is free.
function resolveFreeAppearanceColor(players, requestedColor, self = null, avatarGrid = null) {
  if (typeof requestedColor !== 'string') return requestedColor;
  if (!requestedColor) return requestedColor;
  const wanted = appearanceIdentity(requestedColor, avatarGrid);
  const taken = new Set(
    players
      .filter(player => seatCountsForIdentity(player, self))
      .map(player => appearanceIdentity(player.color, player.avatarGrid))
  );
  if (!taken.has(wanted)) return requestedColor;
  const free = APPEARANCE_PRESET_COLORS.find(color => !taken.has(appearanceIdentity(color, null)));
  return free || requestedColor;
}

function gridRejectionFor(avatarGrid) {
  if (avatarGrid === undefined) return null;
  if (isValidAvatarGrid(avatarGrid)) return null;
  return { success: false, error: AVATAR_GRID_ERROR };
}

function takenRejectionFor(api, player, seatColor, seatGrid) {
  if (!seatColor) return null;
  if (!api.appearanceTakenAtTable(player, seatColor, seatGrid)) return null;
  return { success: false, error: 'That icon is already taken at this table.' };
}

// An omitted nickname keeps the seat's name; any other non-string is a
// malformed request and must not be acknowledged as a silent no-op.
function nicknameTypeRejectionFor(nickname) {
  if (nickname === undefined || typeof nickname === 'string') return null;
  return { success: false, error: 'Nickname must be text.' };
}

// Once the game has started the nickname is not applied at all, so it is not
// checked either (applyNickname keeps its silent no-op).
function nicknameTakenRejectionFor(api, player, nickname) {
  if (typeof nickname !== 'string' || api.started) return null;
  const safeNickname = cleanPlayerName(nickname, 24);
  if (!safeNickname) return null;
  const error = nicknameRejection(api.players, safeNickname, player);
  return error ? { success: false, error } : null;
}

const appearanceApi = {
  setPlayerAppearance(socketId, { color, nickname, avatarGrid } = {}) {
    const player = this.getPlayerBySocket(socketId);
    if (!player) {
      return { success: false, error: 'Player not found.' };
    }
    const gridRejection = gridRejectionFor(avatarGrid);
    if (gridRejection) return gridRejection;
    const nicknameTypeRejection = nicknameTypeRejectionFor(nickname);
    if (nicknameTypeRejection) return nicknameTypeRejection;
    const seatColor = this.parseSeatColor(color);
    // Identity is color plus face: another connected non-bankrupt seat wearing the same icon is taken.
    // The same color with a different face is a different icon. An omitted grid keeps the current face,
    // so the check uses the resulting look.
    const seatGrid = this.effectiveSeatGrid(player, avatarGrid);
    // A face sent without a color is still a new look: check it with the
    // seat's current color, or it could copy another seat's icon.
    const lookChanges = Boolean(seatColor) || avatarGrid !== undefined;
    const takenRejection = takenRejectionFor(this, player, lookChanges ? seatColor || player.color : null, seatGrid);
    if (takenRejection) return takenRejection;
    const nameRejection = nicknameTakenRejectionFor(this, player, nickname);
    if (nameRejection) return nameRejection;
    if (seatColor) player.color = seatColor;
    this.applyNickname(player, nickname);
    this.applyAvatarGrid(player, avatarGrid);
    return { success: true };
  },

  effectiveSeatGrid(player, avatarGrid) {
    if (avatarGrid === undefined) return player.avatarGrid;
    return avatarGrid;
  },

  parseSeatColor(color) {
    if (typeof color !== 'string') return null;
    if (!/^#[0-9a-fA-F]{6}$/.test(color)) return null;
    return color;
  },

  appearanceTakenAtTable(player, color, avatarGrid) {
    const wanted = appearanceIdentity(color, avatarGrid);
    return this.players.some(other => {
      if (!seatCountsForIdentity(other, player)) return false;
      return appearanceIdentity(other.color, other.avatarGrid) === wanted;
    });
  },

  applyNickname(player, nickname) {
    if (typeof nickname !== 'string') return;
    if (this.started) return;
    const safeNickname = cleanPlayerName(nickname, 24);
    if (safeNickname) player.nickname = safeNickname;
  },

  applyAvatarGrid(player, avatarGrid) {
    if (avatarGrid === null) {
      player.avatarGrid = null;
      return;
    }
    if (!Array.isArray(avatarGrid)) return;
    if (!isValidAvatarGrid(avatarGrid)) return;
    player.avatarGrid = avatarGrid;
  }
};

export { APPEARANCE_PRESET_COLORS, AVATAR_GRID_ERROR, appearanceApi, faceSignature, isValidAvatarGrid, resolveFreeAppearanceColor };
