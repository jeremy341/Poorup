// Multi-turn development planning for bots (deterministic, testable). The future planner evaluates single candidates; this answers longer questions:
// which set to develop first, how fast it pays back, the biggest hit coming, and the table's stage. Pure functions over the provider-safe snapshot;
// thin snapshots degrade to safe defaults. Flat traffic tiers come from botTradeValuation, so build priority and trade pricing agree.
import { trafficPercent, groupDevelopmentGain, rentAtLevel as sharedRentAtLevel } from './botTradeValuation.js';
// The engine's own rent math: the event modifiers and the rent cap change
// what a seat actually pays, so a forecast that ignores them over-states the
// hit the reserve has to cover.
import { calculateRentFromFacts, rentFactsFromSnapshot } from './botRentForecast.js';

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Expected rent at a house level (level 0..5, 5 = hotel). The ladder itself
// is the shared one in botTradeValuation, so the forecast and the trade
// pricing read the same numbers.
export function rentAtLevel(tile, level) {
  return sharedRentAtLevel(tile, level);
}

// Extra rent per full opponent circuit if this tile gains one house,
// traffic-weighted. Abstract "circuits" currency shared with payback.
export function houseDeltaPerCircuit(tile) {
  const level = Math.max(0, Math.min(5, Math.floor(number(tile?.houseCount))));
  if (level >= 5) return 0;
  const delta = Math.max(0, rentAtLevel(tile, level + 1) - rentAtLevel(tile, level));
  return Math.floor(delta * trafficPercent(tile?.group) / 100);
}

// Circuits for one house to pay for itself. Lower is better. Infinity
// (Number.MAX_SAFE_INTEGER) when it never pays back.
export function buildPaybackRounds(tile, houseCost) {
  const gain = houseDeltaPerCircuit(tile);
  if (gain <= 0) return Number.MAX_SAFE_INTEGER;
  return Math.max(1, Math.ceil(Math.max(0, Math.floor(number(houseCost))) / gain));
}

function ownGroupTiles(board, group, seat = 'self') {
  return (board || []).filter(tile => tile?.group === group && tile?.ownerSeat === seat);
}

function groupSize(board, group) {
  return (board || []).filter(tile => tile?.group === group).length;
}

// Full development plan for one owned group: cost to bring every deed to 3
// houses, traffic-weighted rent gain per circuit, payback rank. Null when
// the group is not fully owned, has no buildable deeds, or is complete at 3+.
export function groupBuildPlan(board, group, houseCostOf) {
  const tiles = ownGroupTiles(board, group, 'self');
  const total = groupSize(board, group);
  if (!total || tiles.length < total) return null;
  let cost = 0;
  let gain = 0;
  let housesToThree = 0;
  // Even building adds one house per deed per round, so the slowest deed sets
  // how many rounds the whole plan takes.
  let buildRounds = 0;
  for (const tile of tiles) {
    if (tile?.mortgaged || tile?.constructionBlocked) return null;
    const level = Math.max(0, Math.min(5, Math.floor(number(tile?.houseCount))));
    const need = Math.max(0, 3 - level);
    if (!need) continue;
    const unit = Math.max(0, Math.floor(number(houseCostOf?.(tile))));
    if (!unit) return null;
    cost += unit * need;
    housesToThree += need;
    buildRounds = Math.max(buildRounds, need);
    for (let step = 0; step < need; step += 1) {
      const delta = Math.max(0, rentAtLevel(tile, level + step + 1) - rentAtLevel(tile, level + step));
      gain += Math.floor(delta * trafficPercent(group) / 100);
    }
  }
  if (!housesToThree || gain <= 0) return null;
  return { group, cost, gainPerCircuit: gain, paybackRounds: Math.max(1, Math.ceil(cost / gain)), buildRounds };
}

// Best development target across owned complete groups: lowest payback,
// ties broken by larger gain. The "concentrate to 3 houses on ONE set" rule.
export function bestBuildTarget(board, houseCostOf) {
  const groups = [...new Set((board || []).map(tile => tile?.group).filter(Boolean))];
  let best = null;
  for (const group of groups) {
    const plan = groupBuildPlan(board, group, houseCostOf);
    if (!plan) continue;
    if (!best || plan.paybackRounds < best.paybackRounds
      || (plan.paybackRounds === best.paybackRounds && plan.gainPerCircuit > best.gainPerCircuit)) {
      best = plan;
    }
  }
  return best;
}

// Traffic-weighted rent gain from current levels up to 3 houses for a fully owned group. Null when incomplete,
// mortgaged or already at 3+. Needs no cost data, so it runs on the provider-safe board. The gain is the shared one
// in botTradeValuation, so build priority and trade pricing agree on what a finished set is worth.
export function groupGainToThree(board, group) {
  const tiles = ownGroupTiles(board, group, 'self');
  const total = groupSize(board, group);
  if (!total || tiles.length < total) return null;
  return groupDevelopmentGain(tiles, group);
}

// Group with the largest gain-to-3: the "concentrate development HERE"
// answer. Drives the planner concentration bonus.
export function bestGainGroup(board) {
  const groups = [...new Set((board || []).map(tile => tile?.group).filter(Boolean))];
  let best = null;
  for (const group of groups) {
    const plan = groupGainToThree(board, group);
    if (!plan) continue;
    if (!best || plan.gainPerCircuit > best.gainPerCircuit) best = plan;
  }
  return best;
}
// The rent an opponent's tile would really charge. With a snapshot, the engine's own math applies (event modifiers,
// the rent cap, set and utility ladders). Without one, the static house ladder is all that is known.
function hitRent(board, tile, snapshot) {
  const type = tile?.type;
  if (snapshot && (type === 'property' || type === 'railroad' || type === 'utility')) {
    // A utility is the one tile whose rent grows with the dice, so the
    // worst case is the highest total.
    const diceTotal = type === 'utility' ? 12 : 7;
    return calculateRentFromFacts(rentFactsFromSnapshot({ ...snapshot, board }, tile, diceTotal));
  }
  return rentAtLevel(tile, tile?.houseCount);
}

// Biggest single rent hit an opponent can deal next circuit: max over
// opponent-owned, unmortgaged, developed tiles of traffic-weighted rent.
// Drives the dynamic liquidity target (cover the max live hit).
export function forecastMaxHit(board, snapshot = null) {
  let max = 0;
  for (const tile of board || []) {
    const seat = tile?.ownerSeat || 'bank';
    if (!seat.startsWith('opponent') || tile?.mortgaged) continue;
    const rent = hitRent(board, tile, snapshot);
    const weighted = Math.floor(rent * trafficPercent(tile?.group) / 100);
    if (weighted > max) max = weighted;
  }
  return max;
}

// Table stage from development facts: early (no monopolies yet), mid
// (first monopolies / houses going up), late (hotels or multiple
// monopolies). Drives phase-aware policy, not difficulty.
export function developmentStage(board) {
  const groups = [...new Set((board || []).map(tile => tile?.group).filter(Boolean))];
  let monopolies = 0;
  let houses = 0;
  let hotels = 0;
  for (const group of groups) {
    const tiles = (board || []).filter(tile => tile?.group === group);
    const bySeat = new Map();
    for (const tile of tiles) {
      const seat = tile?.ownerSeat || 'bank';
      bySeat.set(seat, (bySeat.get(seat) || 0) + 1);
      houses += Math.max(0, Math.min(4, Math.floor(number(tile?.houseCount))));
      if (Math.floor(number(tile?.houseCount)) >= 5) hotels += 1;
    }
    for (const [seat, count] of bySeat) {
      if (seat !== 'bank' && count >= tiles.length) monopolies += 1;
    }
  }
  if (hotels > 0 || monopolies >= 3) return 'late';
  if (monopolies > 0 || houses >= 3) return 'mid';
  return 'early';
}

// Dynamic liquidity target: cover the forecast max hit plus one house of headroom, bounded to sane whole dollars.
// Replaces the static 120/180 in planning math. The snapshot, when present, prices the hit the way the engine charges it.
export function dynamicReserve(board, houseCost = 100, snapshot = null) {
  const target = forecastMaxHit(board, snapshot) + Math.max(0, Math.floor(number(houseCost)));
  return Math.max(120, Math.min(1000, target));
}

// Re-export for callers that want one import for development math.
export { trafficPercent };
