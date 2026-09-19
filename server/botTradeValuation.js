// Shared opponent-aware trade valuation for bots (deterministic, testable).
// Used by the no-AI brain (botLogic.js accept path) and the AI candidate
// builder (botApi.js proposals) so both price set completion the same way.
// All math is integer whole-dollars; every function degrades gracefully when
// tiles lack group/owner info (legacy price-only behavior) so pinned tests
// calling with bare {price} stubs keep passing.
//
// Parameter choices (Jev-guided): quadratic progress credit, 2x monopoly
// premium, flat per-group traffic tiers, build-readiness = 1 house cost.

// Flat traffic tiers as integer percent (Collins-inspired order:
// Orange > Light Blue > Red > Pink > Yellow > Green > Brown > Dark Blue).
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

export const MONOPOLY_PREMIUM_NUM = 2;
export const MONOPOLY_PREMIUM_DEN = 1;

function trafficPercent(group) {
  return GROUP_TRAFFIC_PERCENT[group] || 100;
}

function tilePrice(tile) {
  return Math.max(0, Math.floor(Number(tile?.price) || 0));
}

// All tiles of a group: prefer the authoritative registry when available,
// fall back to scanning the board tiles for the group name.
export function groupTiles(game, group) {
  if (!group) return [];
  if (typeof game?.getGroupTiles === 'function') {
    try {
      return game.getGroupTiles(group) || [];
    } catch { return []; }
  }
  if (Array.isArray(game?.tiles)) return game.tiles.filter(tile => tile?.group === group);
  return [];
}

export function ownedInGroup(game, playerId, group) {
  if (!playerId || !group) return { owned: 0, total: 0 };
  const tiles = groupTiles(game, group);
  return {
    owned: tiles.filter(tile => tile?.ownerId === playerId).length,
    total: tiles.length,
  };
}

// Face value adjusted by traffic tier (whole dollars).
export function deedValue(game, tile) {
  void game;
  if (!tile || !tile.group) return tilePrice(tile);
  return Math.floor(tilePrice(tile) * trafficPercent(tile.group) / 100);
}

// Quadratic progress credit for moving from `before` to `after` owned deeds
// within a group: credit = groupValue * (after^2 - before^2) / total^2.
// The completing deed is worth the most (Jev: quadratic).
export function progressCredit(game, group, before, after) {
  const tiles = groupTiles(game, group);
  if (!tiles.length) return 0;
  const total = tiles.length;
  const cappedBefore = Math.max(0, Math.min(total, before));
  const cappedAfter = Math.max(0, Math.min(total, after));
  if (cappedAfter <= cappedBefore) return 0;
  const groupValue = tiles.reduce((sum, tile) => sum + deedValue(game, tile), 0);
  return Math.floor(groupValue * (cappedAfter * cappedAfter - cappedBefore * cappedBefore) / (total * total));
}

// Cheapest house cost for a group (build-readiness threshold = 1 house).
export function cheapestHouseCost(game, group) {
  const tiles = groupTiles(game, group);
  let cheapest = 0;
  for (const tile of tiles) {
    let cost = 0;
    if (typeof game?.getPropertyHouseCost === 'function') {
      try { cost = Math.max(0, Math.floor(Number(game.getPropertyHouseCost(tile)) || 0)); } catch { cost = 0; }
    }
    if (!cost) cost = 100;
    if (!cheapest || cost < cheapest) cheapest = cost;
  }
  return cheapest || 100;
}

// Does handing `giveIndexes` to `receiverId` complete one of their groups?
// Returns { givesMonopoly, groups: [{group, before, after, total}], buildReady }.
export function monopolyGiveaway(game, giveIndexes, receiverId) {
  const result = { givesMonopoly: false, groups: [], buildReady: false };
  if (!game || !receiverId || !Array.isArray(giveIndexes) || !giveIndexes.length) return result;
  const resolve = typeof game.getTile === 'function' ? index => game.getTile(index) : () => null;
  const byGroup = new Map();
  for (const index of giveIndexes) {
    const tile = resolve(index);
    if (!tile?.group) continue;
    if (!byGroup.has(tile.group)) byGroup.set(tile.group, []);
    byGroup.get(tile.group).push(tile);
  }
  for (const [group, deeds] of byGroup) {
    const { owned, total } = ownedInGroup(game, receiverId, group);
    if (!total) continue;
    const after = owned + deeds.length;
    if (owned < total && after >= total) {
      result.givesMonopoly = true;
      result.groups.push({ group, before: owned, after, total });
    }
  }
  if (result.givesMonopoly) {
    const receiver = typeof game.getPlayerById === 'function' ? game.getPlayerById(receiverId) : null;
    const cash = Math.max(0, Math.floor(Number(receiver?.cash) || 0));
    const threshold = Math.min(...result.groups.map(entry => cheapestHouseCost(game, entry.group)));
    result.buildReady = cash >= threshold;
  }
  return result;
}

// Should the responder veto this trade? Vetoes only a build-ready monopoly
// giveaway (Jev: one-house readiness). Legacy shapes without player ids or
// grouped tiles never veto, preserving pinned behavior.
export function vetoTrade(game, trade, responderId) {
  const calm = { vetoed: false, reasonCode: null, detail: null };
  if (!game || !trade || !responderId) return calm;
  const { fromPlayerId, toPlayerId, givePropertyIndexes = [], requestPropertyIndexes = [] } = trade;
  if (!fromPlayerId || !toPlayerId) return calm;
  // Responder gives away the request leg when they are the recipient, or the
  // give leg when they are the proposer (adjust/counter flows).
  const responderGives = responderId === toPlayerId ? requestPropertyIndexes : givePropertyIndexes;
  const proposerId = responderId === toPlayerId ? fromPlayerId : toPlayerId;
  const giveaway = monopolyGiveaway(game, responderGives, proposerId);
  if (giveaway.givesMonopoly && giveaway.buildReady) {
    return {
      vetoed: true,
      reasonCode: 'veto-monopoly-build-ready',
      detail: giveaway,
    };
  }
  return calm;
}
