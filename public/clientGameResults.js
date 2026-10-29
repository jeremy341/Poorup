function playerServerId(player) {
  return player?.serverId || player?.id || null;
}

// Placements are only recorded for a game that has ended with a winner.
function placementsRecorded(game) {
  return !game?.started && Number(game?.roundNumber) > 0 && Boolean(game?.lastWinner?.id);
}

function isValidPlacement(value) {
  return Number.isInteger(value) && value > 0;
}

function normalizeFinalPlacements(game) {
  const source = game?.finalPlacements;
  if (!placementsRecorded(game) || !source || typeof source !== 'object' || Array.isArray(source)) return null;
  const placements = {};
  for (const [id, value] of Object.entries(source)) {
    if (id && isValidPlacement(value)) placements[id] = value;
  }
  return Object.keys(placements).length ? placements : null;
}

function legacyPlacement(player) {
  return (player?.disconnected ? 2 : 0) + (player?.bankrupt ? 1 : 0);
}

// Final placements are authoritative server data. The cash ordering remains
// available for legacy fixtures and snapshots produced before this field.
function placementFor(player, finalPlacements) {
  const id = playerServerId(player);
  return Number.isFinite(finalPlacements?.[id]) ? finalPlacements[id] : null;
}

// Ranked seats first, by placement; then the legacy tier, the winner, and cash.
// Placed seats order by their placement; the cash fallback only applies between unplaced seats.
function comparePlacedRows(a, b) {
  if (a.placement !== null && b.placement !== null) return a.placement - b.placement || a._index - b._index;
  return a.placement !== null ? -1 : 1;
}

function compareUnplacedRows(a, b) {
  const tierDifference = legacyPlacement(a) - legacyPlacement(b);
  if (tierDifference) return tierDifference;
  if (a.isWinner !== b.isWinner) return a.isWinner ? -1 : 1;
  return (Number(b.cash) || 0) - (Number(a.cash) || 0) || a._index - b._index;
}

// Ranked seats first, by placement; then the legacy tier, the winner, and cash.
function compareRankedRows(a, b) {
  if (a.placement !== null || b.placement !== null) return comparePlacedRows(a, b);
  return compareUnplacedRows(a, b);
}

function rankGameOverPlayers(players, finalPlacements = null, winnerId = null) {
  const rows = (Array.isArray(players) ? players : []).map((player, index) => {
    const id = playerServerId(player);
    return { ...player, placement: placementFor(player, finalPlacements), isWinner: Boolean(winnerId && (id === winnerId || player.id === winnerId)), _index: index };
  });
  rows.sort(compareRankedRows);
  return rows.map(({ _index, ...row }) => row);
}

function gameOverScore(player, endReason) {
  const roundLimit = endReason === 'round-limit';
  const raw = roundLimit ? player?.finalNetWorth : player?.cash;
  return { label: roundLimit ? 'NET WORTH' : 'CASH', value: typeof raw === 'number' && Number.isFinite(raw) ? raw : null };
}

// The first flag that holds names the seat's status; a seat with none of them finished.
const GAME_OVER_STATUSES = [['isWinner', 'WINNER'], ['bankrupt', 'OUT'], ['disconnected', 'LEFT'], ['spectating', 'RETIRED']];

function gameOverPlayerStatus(player) {
  const match = GAME_OVER_STATUSES.find(([flag]) => player[flag]);
  return match ? match[1] : 'FINISHED';
}

export { normalizeFinalPlacements, rankGameOverPlayers, gameOverScore, gameOverPlayerStatus };
