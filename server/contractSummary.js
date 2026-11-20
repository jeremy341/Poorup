// Client-facing projection of player contracts, scoped to the viewing seat, plus the "is this equity share still live" test.
import { ACTIVE_CONTRACT_STATUSES } from './contractGuards.js';

function contractNames(game, contract) {
  const nameFor = id => game.getPlayerById(id)?.nickname || 'PLAYER';
  return { fromPlayerName: nameFor(contract.fromPlayerId), toPlayerName: nameFor(contract.toPlayerId) };
}

function contractBelongsToViewer(contract, viewerPlayerId) {
  if (!viewerPlayerId) return false;
  if (contract.fromPlayerId === viewerPlayerId) return true;
  return contract.toPlayerId === viewerPlayerId;
}

function projectContract(game, contract, viewerPlayerId) {
  const names = contractNames(game, contract);
  if (contractBelongsToViewer(contract, viewerPlayerId)) return { ...contract, ...names };
  return { id: contract.id, kind: contract.kind, status: contract.status, createdRound: contract.createdRound, ...names };
}

// A converted hybrid note is live equity, so it stays visible alongside
// active and due contracts instead of vanishing from the ledger.
function contractIsLive(contract) {
  if (ACTIVE_CONTRACT_STATUSES.includes(contract.status)) return true;
  return contract.status === 'converted';
}

// An equity share earns and survives only while its contract is live: an
// active agreement, or a converted hybrid note whose debt leg has ended.
export function equityShareContractLive(contract) {
  if (!contract) return false;
  if (contract.status === 'active') return true;
  return contract.status === 'converted';
}

export function playerContractSummary(game, viewerPlayerId = null) {
  const pending = game.pendingPlayerContract
    ? projectContract(game, game.pendingPlayerContract, viewerPlayerId)
    : null;
  const active = game.playerContracts
    .filter(contractIsLive)
    .map(contract => projectContract(game, contract, viewerPlayerId));
  return { pending, active };
}
