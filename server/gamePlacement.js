// Shared placement policy for persisted results and the final public snapshot.
function computePlacementById(players, winnerId = null) {
  const sortCash = player => Number(player.cash) || 0;
  const tier = player => (player.disconnected ? 2 : 0) + (player.bankrupt ? 1 : 0);
  const crowned = player => (winnerId && player.id === winnerId ? -1 : 0);
  return new Map([...players]
    .sort((a, b) => tier(a) - tier(b) || crowned(a) - crowned(b) || sortCash(b) - sortCash(a))
    .map((player, index) => [player.id, index + 1]));
}

export { computePlacementById };
