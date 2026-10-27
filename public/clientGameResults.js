function playerServerId(player) {
  return player?.serverId || player?.id || null;
}

function normalizeFinalPlacements(game) {
  const source = game?.finalPlacements;
  if (game?.started || !(Number(game?.roundNumber) > 0) || !game?.lastWinner?.id
      || !source || typeof source !== 'object' || Array.isArray(source)) return null;
  const placements = {};
  for (const [id, value] of Object.entries(source)) {
    if (id && Number.isInteger(value) && value > 0) placements[id] = value;
  }
  return Object.keys(placements).length ? placements : null;
}

function legacyPlacement(player) {
  return (player?.disconnected ? 2 : 0) + (player?.bankrupt ? 1 : 0);
}

// Final placements are authoritative server data. The cash ordering remains
// available for legacy fixtures and snapshots produced before this field.
function rankGameOverPlayers(players, finalPlacements = null, winnerId = null) {
  const rows = (Array.isArray(players) ? players : []).map((player, index) => {
    const id = playerServerId(player);
    const placement = Number.isFinite(finalPlacements?.[id])
      ? finalPlacements[id]
      : null;
    return { ...player, placement, isWinner: Boolean(winnerId && (id === winnerId || player.id === winnerId)), _index: index };
  });
  rows.sort((a, b) => {
    if (a.placement !== null && b.placement !== null) return a.placement - b.placement || a._index - b._index;
    if (a.placement !== null) return -1;
    if (b.placement !== null) return 1;
    const tierDifference = legacyPlacement(a) - legacyPlacement(b);
    if (tierDifference) return tierDifference;
    if (a.isWinner !== b.isWinner) return a.isWinner ? -1 : 1;
    return (Number(b.cash) || 0) - (Number(a.cash) || 0) || a._index - b._index;
  });
  return rows.map(({ _index, ...row }) => row);
}

function gameOverScore(player, endReason) {
  const label = endReason === 'round-limit' ? 'NET WORTH' : 'CASH';
  const raw = endReason === 'round-limit' ? player?.finalNetWorth : player?.cash;
  return { label, value: typeof raw === 'number' && Number.isFinite(raw) ? raw : null };
}

function gameOverPlayerStatus(player) {
  if (player.isWinner) return 'WINNER';
  if (player.bankrupt) return 'OUT';
  if (player.disconnected) return 'LEFT';
  if (player.spectating) return 'RETIRED';
  return 'FINISHED';
}

export { normalizeFinalPlacements, rankGameOverPlayers, gameOverScore, gameOverPlayerStatus };
