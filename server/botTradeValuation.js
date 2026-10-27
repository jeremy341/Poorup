// Shared opponent-aware trade valuation for bots (deterministic, testable).
// Used by the no-AI brain (botLogic.js accept path) and the AI candidate
// builder (botApi.js proposals) so both price set completion the same way.
// All math is integer whole-dollars; every function degrades gracefully when
// tiles lack group/owner info (legacy price-only behavior) so pinned tests
// calling with bare {price} stubs keep passing.
//
// Parameter choices (Jev-guided): quadratic progress credit, 2x monopoly
// premium, flat per-group traffic tiers, build-readiness = 1 house cost.
import { PROPERTY_RENT_MULTIPLIERS } from './gameData.js';
import { unmortgageCostFor } from './propertyRules.js';

// Flat traffic tiers as integer percent (Collins-inspired order:
// Orange > Light Blue > Red > Pink > Yellow > Green > Metro Gold > Brown >
// Dark Blue > Metro Silver). This table is the ONLY copy: botDevelopmentForecast.js
// and botTableBrain.js import it, so build priority, threat, and trade pricing
// cannot disagree about which groups matter. Every group boardRegistry.GROUPS
// declares needs a key here — Metro-52 ships Metro Gold + Metro Silver, and an
// absent key is invisible at runtime because it inherits the Green-tier default.
export const GROUP_TRAFFIC_PERCENT = Object.freeze({
  Orange: 130,
  'Light Blue': 120,
  Red: 115,
  Pink: 110,
  Yellow: 105,
  Green: 100,
  'Metro Gold': 96,
  Brown: 95,
  'Dark Blue': 90,
  'Metro Silver': 88,
});

export const MONOPOLY_PREMIUM_NUM = 2;
export const MONOPOLY_PREMIUM_DEN = 1;

// Ungrouped tiles (railroads, utilities) legitimately have no tier, so the
// fall-through stays the flat 100 baseline; regression-b27-b29.test.js asserts
// every real group resolves to a non-default tier so the fallback cannot hide a
// missing board group.
export function trafficPercent(group) {
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
  if (!tile) return 0;
  const faceValue = tile.group
    ? Math.floor(tilePrice(tile) * trafficPercent(tile.group) / 100)
    : tilePrice(tile);
  if (!tile.mortgaged) return faceValue;
  const multiplier = typeof game?.propertyValueMultiplier === 'function' ? game.propertyValueMultiplier() : 1;
  return Math.max(0, faceValue - unmortgageCostFor(tile.price, multiplier));
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

// The rent a deed charges at one house level. The shared ladder: the
// development forecast and the trade pricing below both read it, so build
// priority and trade pricing cannot disagree about what a house earns.
export function rentAtLevel(tile, level) {
  const base = Math.max(0, Math.floor(Number(tile?.rent) || 0));
  const clamped = Math.max(0, Math.min(5, Math.floor(Number(level) || 0)));
  if (clamped === 0) return base;
  return Math.floor(base * (PROPERTY_RENT_MULTIPLIERS[clamped] || 1));
}

// The traffic-weighted rent gain from the current level up to three houses
// on every deed of a group the seat owns. Null when the group is not fully
// owned, a deed is mortgaged, or the set has nothing left to build.
export function groupDevelopmentGain(ownedTiles, group) {
  let gain = 0;
  let need = 0;
  for (const tile of ownedTiles || []) {
    if (tile?.mortgaged) return null;
    const level = Math.max(0, Math.min(5, Math.floor(Number(tile?.houseCount) || 0)));
    for (let step = level; step < 3; step += 1) {
      const delta = Math.max(0, rentAtLevel(tile, step + 1) - rentAtLevel(tile, step));
      gain += Math.floor(delta * trafficPercent(group) / 100);
      need += 1;
    }
  }
  if (!need || gain <= 0) return null;
  return { group, gainPerCircuit: gain, housesNeeded: need };
}

// ONE portfolio valuation for both trade paths: the face value of the deeds
// a seat holds, the quadratic progress credit for the groups it is close to
// completing, and the build value of a group it has completed. The proposal
// side (botApi.tradePortfolioValue) and the acceptance side
// (botLogic.shouldAcceptTrade) have to price a portfolio the same way, or a
// proposed trade can fail the partner's own acceptance bar.
export function portfolioValue(game, playerId, propertyIndexes) {
  if (!game || !playerId || !Array.isArray(propertyIndexes)) return 0;
  const owned = new Set(propertyIndexes.map(Number).filter(Number.isInteger));
  const properties = [...owned].map(index => typeof game.getTile === 'function' ? game.getTile(index) : null).filter(Boolean);
  let value = properties.reduce((sum, tile) => sum + deedValue(game, tile), 0);
  const groups = [...new Set((game.tiles || []).map(tile => tile?.group).filter(Boolean))];
  for (const group of groups) {
    const tiles = groupTiles(game, group);
    const ownedTiles = tiles.filter(tile => owned.has(tile.index));
    const count = ownedTiles.length;
    if (!count) continue;
    value += progressCredit(game, group, 0, count);
    // A finished set is worth the rent it would collect: three houses on
    // every deed, three circuits out.
    if (count !== tiles.length) continue;
    const development = groupDevelopmentGain(ownedTiles, group);
    if (!development) continue;
    value += development.gainPerCircuit * 3;
  }
  return value;
}

// Kept as the historical name of the shared valuation.
export function portfolioDeedValue(game, playerId, propertyIndexes) {
  return portfolioValue(game, playerId, propertyIndexes);
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

// Deeds below this net valuation gain are noise: a swap that only reshuffles face
// value ping-pongs between seats (388 accepted trades in one audited game), so a
// bot neither proposes nor accepts a tile-for-tile swap that gains less than this.
export const TRADE_MIN_NET_GAIN = 20;

// Rounds a declined (partner, give, ask) offer stays off the table. The grudge
// ledger only blocks a whole partner for a turn; this blocks the identical offer.
export const TRADE_DECLINE_COOLDOWN_ROUNDS = 4;

function indexList(list) {
  return [...new Set((Array.isArray(list) ? list : []).map(Number).filter(Number.isInteger))];
}

function resolver(game) {
  return typeof game?.getTile === 'function' ? index => game.getTile(index) : () => null;
}

// Does handing `giveIndexes` to `receiverId` complete one of their groups?
// `returnIndexes` are the receiver's own deeds that go back the other way in the
// same trade: they are netted out, so swapping one Brown for another completes
// nothing. Returns { givesMonopoly, groups: [{group, before, after, total}],
// buildReady }. buildReady (receiver cash >= one house) is informational only;
// the veto no longer reads it, because a $99 buyer finishes the set the moment
// they have $100 and the table cannot watch their wallet.
export function monopolyGiveaway(game, giveIndexes, receiverId, returnIndexes = []) {
  const result = { givesMonopoly: false, groups: [], buildReady: false };
  if (!game || !receiverId || !Array.isArray(giveIndexes) || !giveIndexes.length) return result;
  const resolve = resolver(game);
  const byGroup = new Map();
  for (const index of giveIndexes) {
    const tile = resolve(index);
    if (!tile?.group) continue;
    if (!byGroup.has(tile.group)) byGroup.set(tile.group, []);
    byGroup.get(tile.group).push(tile);
  }
  const returned = new Map();
  for (const index of indexList(returnIndexes)) {
    const tile = resolve(index);
    if (!tile?.group || tile.ownerId !== receiverId) continue;
    returned.set(tile.group, (returned.get(tile.group) || 0) + 1);
  }
  for (const [group, deeds] of byGroup) {
    const { owned, total } = ownedInGroup(game, receiverId, group);
    if (!total) continue;
    const after = owned + deeds.length - (returned.get(group) || 0);
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

// What the giver must be paid, in cash on top of the deeds coming back, for
// handing `outgoingIndexes` to `receiverId` while `incomingIndexes` come back.
// A completing trade is priced at the monopoly premium (2x deed value for the
// deeds of the completed group). needCash is the cash the giver must receive; it
// is negative when the deeds coming back already overpay (the giver may then pay
// cash), and 0 when the trade completes nothing.
export function monopolyRequirement(game, outgoingIndexes, incomingIndexes, receiverId) {
  const outgoing = indexList(outgoingIndexes);
  const incoming = indexList(incomingIndexes);
  const giveaway = monopolyGiveaway(game, outgoing, receiverId, incoming);
  const result = { ...giveaway, requiredValue: 0, incomingValue: 0, needCash: 0 };
  if (!giveaway.givesMonopoly) return result;
  const resolve = resolver(game);
  const completed = new Set(giveaway.groups.map(entry => entry.group));
  for (const index of outgoing) {
    const tile = resolve(index);
    if (!tile) continue;
    const value = deedValue(game, tile);
    result.requiredValue += value;
    if (completed.has(tile.group)) result.requiredValue += Math.floor(value * (MONOPOLY_PREMIUM_NUM - MONOPOLY_PREMIUM_DEN) / MONOPOLY_PREMIUM_DEN);
  }
  for (const index of incoming) {
    const tile = resolve(index);
    if (tile) result.incomingValue += deedValue(game, tile);
  }
  result.needCash = result.requiredValue - result.incomingValue;
  return result;
}

// Groups a player completes or breaks when `outgoingIndexes` leave and
// `incomingIndexes` arrive. Used to keep a seat from trading away its own set.
export function tradeSetChanges(game, playerId, outgoingIndexes, incomingIndexes) {
  const result = { completes: [], breaks: [] };
  if (!game || !playerId) return result;
  const resolve = resolver(game);
  const delta = new Map();
  for (const index of indexList(outgoingIndexes)) {
    const tile = resolve(index);
    if (!tile?.group || tile.ownerId !== playerId) continue;
    delta.set(tile.group, (delta.get(tile.group) || 0) - 1);
  }
  for (const index of indexList(incomingIndexes)) {
    const tile = resolve(index);
    if (!tile?.group || tile.ownerId === playerId) continue;
    delta.set(tile.group, (delta.get(tile.group) || 0) + 1);
  }
  for (const [group, change] of delta) {
    const { owned, total } = ownedInGroup(game, playerId, group);
    if (!total) continue;
    const after = owned + change;
    if (owned < total && after >= total) result.completes.push(group);
    if (owned >= total && after < total) result.breaks.push(group);
  }
  return result;
}

// Should the responder veto this trade? Vetoes any trade that finishes the other
// seat's colour set (netting what the responder receives back) unless the
// responder is paid the monopoly premium. The other seat's cash is irrelevant:
// the veto is on the set, not on whether they can build this turn. Legacy shapes
// without player ids or grouped tiles never veto, preserving pinned behavior.
export function vetoTrade(game, trade, responderId) {
  const calm = { vetoed: false, reasonCode: null, detail: null };
  if (!game || !trade || !responderId) return calm;
  const { fromPlayerId, toPlayerId, givePropertyIndexes = [], requestPropertyIndexes = [] } = trade;
  if (!fromPlayerId || !toPlayerId) return calm;
  // Responder gives away the request leg when they are the recipient, or the
  // give leg when they are the proposer (adjust/counter flows).
  const responderIsRecipient = responderId === toPlayerId;
  const responderGives = responderIsRecipient ? requestPropertyIndexes : givePropertyIndexes;
  const responderGets = responderIsRecipient ? givePropertyIndexes : requestPropertyIndexes;
  const proposerId = responderIsRecipient ? fromPlayerId : toPlayerId;
  const cashIn = responderIsRecipient
    ? Number(trade.giveCash || 0) - Number(trade.requestCash || 0)
    : Number(trade.requestCash || 0) - Number(trade.giveCash || 0);
  const requirement = monopolyRequirement(game, responderGives, responderGets, proposerId);
  if (requirement.givesMonopoly && cashIn < requirement.needCash) {
    return {
      vetoed: true,
      reasonCode: 'veto-monopoly-build-ready',
      detail: requirement,
    };
  }
  return calm;
}
