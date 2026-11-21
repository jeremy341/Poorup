// Shared by the trade and financing screens: the game hooks they call into (configureTradeUi) and
// two small lookups both of them need.
import { state } from "./clientState.js";
import { TILES } from "./clientBoardData.js";

export let host = { emitServer: noop, say: noop, record: noop, recordActivity: noop, captureActionStatusNode: () => null, announceActionStatus: noop, renderChat: noop, createRequestId: noop, renderRightRail: noop };

function noop() {}

export function configureTradeUi(hooks) {
  host = { ...host, ...hooks };
}

// The seat id of the local player in the server snapshot.
export function financingMyServerId() {
  return state.players[0]?.serverId || null;
}

export function tradeBuildingLevel(tileIndex) {
  const serverTile = state.serverTiles.find(entry => Number(entry.index) === Number(tileIndex));
  const serverLevel = Number(serverTile?.houseCount);
  return Number.isInteger(serverLevel) && serverLevel >= 0 ? serverLevel : (Number(state.houses[tileIndex]) || 0);
}

export function tradeBuildingBlockReason(tile) {
  if (!tile.group) return "";
  const hasBuildings = TILES.some(candidate => candidate.group === tile.group && tradeBuildingLevel(candidate.i) > 0);
  return hasBuildings ? "Sell all buildings in this color set before trading a deed." : "";
}
