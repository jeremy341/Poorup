// Board-snapshot helpers the future planner shares: tile lookup, landing rent, pass-Start cash, and the dice tables.
import { rentFromSnapshot } from './botRentForecast.js';
import { finiteNumber, nonNegativeWhole } from './numberUtils.js';

export const DICE_TOTALS = [
  [2, 1 / 36], [3, 2 / 36], [4, 3 / 36], [5, 4 / 36], [6, 5 / 36],
  [7, 6 / 36], [8, 5 / 36], [9, 4 / 36], [10, 3 / 36], [11, 2 / 36], [12, 1 / 36]
];
export const DICE_PAIRS = Array.from({ length: 36 }, (_, index) => ({ first: Math.floor(index / 6) + 1, second: index % 6 + 1 }));
export const ALLOWED_ROLLOUT_BUDGETS = new Set([16, 64, 256]);

export function tileFor(snapshot, index) {
  const numeric = Number(index);
  return (snapshot.board || []).find(tile => tile.index === numeric) || null;
}

export function tileOwner(tile) {
  return tile?.ownerSeat || 'bank';
}

export function expectedCardDelta(snapshot, tile) {
  if (tile.type === 'chance') return finiteNumber(snapshot.rulesDigest?.cards?.surpriseExpectedCash);
  if (tile.type === 'chest') return finiteNumber(snapshot.rulesDigest?.cards?.treasureExpectedCash);
  return 0;
}

export function passStartValue(snapshot, position, move, boardLength) {
  if (position + move < boardLength) return 0;
  const base = finiteNumber(snapshot.rulesDigest?.passStartCash, 200);
  const exactBonus = position + move === boardLength && snapshot.rulesDigest?.doubleGo ? base : 0;
  return base + exactBonus;
}

export function landingRent(snapshot, board, tile, diceTotal, ownerSeat = tileOwner(tile)) {
  return rentFromSnapshot({ ...snapshot, board }, { ...tile, ownerSeat }, diceTotal);
}

export function boardSignature(state) {
  return state.board.map(tile => tile.ownerSeat + ':' + nonNegativeWhole(tile.houseCount) + ':' + (tile.mortgaged ? 1 : 0)).join('|');
}
