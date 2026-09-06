// Seat appearance as a prototype mixin plus the shared color helpers rooms
// use when seating humans and bots. gameLogic.js assigns the object onto
// GameState.prototype and re-exports APPEARANCE_PRESET_COLORS.

// The four default appearance presets, in server assignment order.
const APPEARANCE_PRESET_COLORS = ['#d74438', '#286ea1', '#d9a62f', '#35a653'];

// Identity is color plus face: two seats share an icon only when both
// match, so a custom face in a preset color is its own icon. Grids are
// fixed 8x8 arrays, so JSON is a deterministic signature; hex cells are
// lowercased because editors may emit either case.
function faceSignature(avatarGrid) {
  if (!Array.isArray(avatarGrid)) return 'generic';
  if (!avatarGrid.length) return 'generic';
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

// Resolves a requested seat look against icons taken by connected
// non-bankrupt players (the player's own seat excluded). An exact-identity
// collision becomes the first free preset; if no preset is free the
// requested color is kept.
function resolveFreeAppearanceColor(players, requestedColor, self = null, avatarGrid = null) {
  if (typeof requestedColor !== 'string' || !requestedColor) return requestedColor;
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

const appearanceApi = {
  setPlayerAppearance(socketId, { color, nickname, avatarGrid } = {}) {
    const player = this.getPlayerBySocket(socketId);
    if (!player) {
      return { success: false, error: 'Player not found.' };
    }
    const seatColor = this.parseSeatColor(color);
    // Identity is color plus face: another connected non-bankrupt seat
    // wearing the same icon means it is taken; the same color with a
    // different face is a different icon. An omitted grid keeps the
    // seat's current face, so the check uses the resulting look.
    const seatGrid = avatarGrid === undefined ? player.avatarGrid : avatarGrid;
    if (seatColor && this.appearanceTakenAtTable(player, seatColor, seatGrid)) {
      return { success: false, error: 'That icon is already taken at this table.' };
    }
    if (seatColor) player.color = seatColor;
    this.applyNickname(player, nickname);
    this.applyAvatarGrid(player, avatarGrid);
    return { success: true };
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
    const safeNickname = nickname.trim().slice(0, 24);
    if (safeNickname) player.nickname = safeNickname;
  },

  applyAvatarGrid(player, avatarGrid) {
    if (avatarGrid === null || Array.isArray(avatarGrid)) player.avatarGrid = avatarGrid;
  }
};

export { APPEARANCE_PRESET_COLORS, appearanceApi, faceSignature, resolveFreeAppearanceColor };
