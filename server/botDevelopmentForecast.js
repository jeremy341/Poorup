// Multi-turn development planning for bots (deterministic, testable).
// The future planner evaluates single candidates; this module answers the
// longer questions a smart player asks: which set do I develop first, how
// fast does it pay back, what is the biggest hit coming my way, and what
// stage is the table in. Pure functions over the provider-safe snapshot
// shape (board tiles with ownerSeat/rent/houseCount/mortgaged) plus an
// optional opponents list. Everything degrades to safe defaults on thin
// snapshots so legacy callers keep working.
import { PROPERTY_RENT_MULTIPLIERS } from './gameData.js';

// Flat traffic tiers mirror botTradeValuation so build priority and trade
// pricing agree on which groups matter. Percent, whole-dollar math.
const GROUP_TRAFFIC_PERCENT = {
  Orange: 130,
  'Light Blue': 120,
  Red: 115,
  Pink: 110,
  Yellow: 105,
  Green: 100,
  Brown: 95,
  'Dark Blue': 90,
};

function trafficPercent(group) {
  return GROUP_TRAFFIC_PERCENT[group] || 100;
}

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

// Expected rent at a house level (level 0..5, 5 = hotel).
export function rentAtLevel(tile, level) {
  const base = Math.max(0, Math.floor(number(tile?.rent)));
  const clamped = Math.max(0, Math.min(5, Math.floor(number(level))));
  if (clamped === 0) return base;
  return Math.floor(base * (PROPERTY_RENT_MULTIPLIERS[clamped] || 1));
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
  for (const tile of tiles) {
    if (tile?.mortgaged) return null;
    const level = Math.max(0, Math.min(5, Math.floor(number(tile?.houseCount))));
    const need = Math.max(0, 3 - level);
    if (!need) continue;
    const unit = Math.max(0, Math.floor(number(houseCostOf?.(tile))));
    if (!unit) return null;
    cost += unit * need;
    housesToThree += need;
    for (let step = 0; step < need; step += 1) {
      const delta = Math.max(0, rentAtLevel(tile, level + step + 1) - rentAtLevel(tile, level + step));
      gain += Math.floor(delta * trafficPercent(group) / 100);
    }
  }
  if (!housesToThree || gain <= 0) return null;
  return { group, cost, gainPerCircuit: gain, paybackRounds: Math.max(1, Math.ceil(cost / gain)) };
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

// Traffic-weighted rent gain from current levels up to 3 houses for a
// fully owned group. Null when incomplete, mortgaged, or already at 3+.
// Needs no cost data, so it runs on the provider-safe snapshot board.
export function groupGainToThree(board, group) {
  const tiles = ownGroupTiles(board, group, 'self');
  const total = groupSize(board, group);
  if (!total || tiles.length < total) return null;
  let gain = 0;
  let need = 0;
  for (const tile of tiles) {
    if (tile?.mortgaged) return null;
    const level = Math.max(0, Math.min(5, Math.floor(number(tile?.houseCount))));
    for (let step = level; step < 3; step += 1) {
      const delta = Math.max(0, rentAtLevel(tile, step + 1) - rentAtLevel(tile, step));
      gain += Math.floor(delta * trafficPercent(group) / 100);
      need += 1;
    }
  }
  if (!need || gain <= 0) return null;
  return { group, gainPerCircuit: gain, housesNeeded: need };
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
// Biggest single rent hit an opponent can deal next circuit: max over
// opponent-owned, unmortgaged, developed tiles of traffic-weighted rent.
// Drives the dynamic liquidity target (cover the max live hit).
export function forecastMaxHit(board) {
  let max = 0;
  for (const tile of board || []) {
    const seat = tile?.ownerSeat || 'bank';
    if (!seat.startsWith('opponent') || tile?.mortgaged) continue;
    const rent = rentAtLevel(tile, tile?.houseCount);
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

// Dynamic liquidity target: cover the forecasted max hit plus one house
// cost of headroom, bounded to sane whole dollars. Replaces static 120/180
// in planning math (candidate shapes and reserves stay untouched).
export function dynamicReserve(board, houseCost = 100) {
  const target = forecastMaxHit(board) + Math.max(0, Math.floor(number(houseCost)));
  return Math.max(120, Math.min(1000, target));
}

// Re-export for callers that want one import for development math.
export { trafficPercent };
