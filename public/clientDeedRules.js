/* ============================================================
   DEED RULES (client view): ownership sets, rent ladders, and the
   server-tile lookup. Read-only against clientState.
   ============================================================ */
import {
  RENT_TABLE,
  GROUP_TARGETS,
  TILES,
  TILE_COUNT,
} from "./clientBoardData.js";
import { state } from "./clientState.js";

export function serverTileFor(index) {
  return state.serverTiles.find((tile) => Number(tile.index) === Number(index))
    || state.serverTiles.find((tile) => Number(tile.index) === (Number(index) % TILE_COUNT));
}

/** Owns every deed in the same color group as `tile` (including this one). */
export function ownsFullGroup(playerId, group) {
  if (!group) return false;
  const target = GROUP_TARGETS[group];
  if (!target) return false;
  let count = 0;
  for (const t of TILES) {
    if (t.group === group) {
      if (state.owners[t.i] !== playerId) return false;
      count++;
    }
  }
  return count === target;
}

function rentTableFor(tile) {
  return RENT_TABLE[tile.group || tile.kind] || null;
}

function countOwnedKind(kind, ownerId) {
  return TILES.filter((u) => u.kind === kind && state.owners[u.i] === ownerId).length;
}

function groupRent(tile, table) {
  const owned = countOwnedKind(tile.kind, state.owners[tile.i]);
  const index = Math.min(Math.max(owned - 1, 0), table.rents.length - 1);
  const rent = table.rents[index];
  if (rent == null) return table.base;
  return rent;
}

export function rentFor(tile) {
  const table = rentTableFor(tile);
  if (!table) return 0;
  if (tile.kind === "railroad" || tile.kind === "utility") return groupRent(tile, table);
  const level = state.houses[tile.i] || 0;
  return table.rents[Math.min(level, table.rents.length - 1)];
}
