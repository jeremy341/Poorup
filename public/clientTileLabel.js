// BOARD TILE ACCESSIBLE NAMES
// Pure so it can be unit-tested; clientBoardRender re-applies it on
// every render so ownership, buildings and mortgages are never visual-only.

/**
 * @param {{ name?: string, price?: number|null }} tile
 * @param {{ ownerName?: string|null, houses?: number, hotel?: boolean, mortgaged?: boolean }} [status]
 */
export function tileAriaLabel(tile, status = {}) {
  const parts = [String(tile?.name || "Tile")];
  if (tile?.price) parts.push(`price $${tile.price}`);
  const owner = typeof status.ownerName === "string" ? status.ownerName.trim() : "";
  if (owner) parts.push(`owned by ${owner}`);
  if (status.hotel) parts.push("hotel");
  else if (status.houses > 0) parts.push(status.houses === 1 ? "1 house" : `${status.houses} houses`);
  if (status.mortgaged) parts.push("mortgaged");
  return parts.join(", ");
}
