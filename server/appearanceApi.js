// Seat appearance as a prototype mixin plus the shared color helpers rooms
// use when seating humans and bots. gameLogic.js assigns the object onto
// GameState.prototype and re-exports APPEARANCE_PRESET_COLORS.

// The four default appearance presets, in server assignment order.
const APPEARANCE_PRESET_COLORS = ['#d74438', '#286ea1', '#d9a62f', '#35a653'];

// Resolves a requested seat color against colors taken by connected
// non-bankrupt players (the player's own seat excluded). A collision becomes
// the first free preset; if no preset is free the requested color is kept.
function resolveFreeAppearanceColor(players, requestedColor, self = null) {
  if (typeof requestedColor !== 'string' || !requestedColor) return requestedColor;
  const taken = new Set(
    players
      .filter(player => player !== self && !player.disconnected && !player.bankrupt && typeof player.color === 'string')
      .map(player => player.color.toLowerCase())
  );
  if (!taken.has(requestedColor.toLowerCase())) return requestedColor;
  const free = APPEARANCE_PRESET_COLORS.find(color => !taken.has(color.toLowerCase()));
  return free || requestedColor;
}

const appearanceApi = {
  setPlayerAppearance(socketId, { color, nickname, avatarGrid } = {}) {
    const player = this.getPlayerBySocket(socketId);
    if (!player) {
      return { success: false, error: 'Player not found.' };
    }
    const seatColor = this.parseSeatColor(color);
    // Color is the appearance identity: another connected non-bankrupt
    // player using it means the icon is taken at this table. Custom
    // avatarGrids may still differ as long as colors differ.
    if (seatColor && this.colorTakenAtTable(player, seatColor)) {
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

  colorTakenAtTable(player, color) {
    const lowered = color.toLowerCase();
    return this.players.some(other => {
      if (other === player) return false;
      if (other.disconnected) return false;
      if (other.bankrupt) return false;
      if (typeof other.color !== 'string') return false;
      return other.color.toLowerCase() === lowered;
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

export { APPEARANCE_PRESET_COLORS, appearanceApi, resolveFreeAppearanceColor };
