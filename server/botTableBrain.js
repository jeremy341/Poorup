// Table-wide strategic brain for bots (deterministic, testable).
// Answers the "big picture" questions a smart player asks every turn:
// who is winning, what threatens me, what is my path to victory, and am
// I being teamed on. Pure functions over the live game object; every
// helper degrades gracefully when methods are absent (unit-test stubs).
// Consumed as score terms by the deterministic brain and as a prompt
// section by the AI advisor. All money math is integer whole-dollars.

import { rentAtLevel } from './botDevelopmentForecast.js';

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

function BotTiles(game) {
  return Array.isArray(game?.tiles) ? game.tiles : [];
}

function livePlayers(game) {
  return (Array.isArray(game?.players) ? game.players : []).filter(
    player => player && !player.bankrupt && !player.disconnected
  );
}

// Net worth: cash + deed face + houses at half build cost - open debts.
// Mortgaged deeds count at half face (locked value).
export function netWorth(game, player) {
  if (!player) return 0;
  let worth = Math.max(0, Math.floor(number(player.cash)));
  for (const index of player.properties || []) {
    const tile = typeof game?.getTile === 'function' ? game.getTile(index) : null;
    if (!tile) continue;
    const face = Math.max(0, Math.floor(number(tile.price)));
    const houses = Math.max(0, Math.min(5, Math.floor(number(tile.houseCount))));
    if (tile.mortgaged) {
      worth += Math.floor(face / 2);
      continue;
    }
    worth += face;
    if (houses > 0) {
      const unit = typeof game?.getPropertyHouseCost === 'function'
        ? Math.max(0, Math.floor(number(safeHouseCost(game, tile))))
        : 100;
      worth += Math.floor(houses * unit * 0.5);
    }
  }
  worth -= Math.max(0, Math.floor(number(player.bankLoan?.remaining)));
  worth -= Math.max(0, Math.floor(number(player.shortDefaultDebt)));
  worth -= Math.max(0, Math.floor(number(player.marginBalance)));
  return Math.max(0, worth);
}

function safeHouseCost(game, tile) {
  try {
    return game.getPropertyHouseCost(tile);
  } catch {
    return 100;
  }
}

// Standings across live seats, richest first.
export function standings(game) {
  return livePlayers(game)
    .map(player => ({ id: player.id, netWorth: netWorth(game, player) }))
    .sort((a, b) => b.netWorth - a.netWorth || String(a.id).localeCompare(String(b.id)));
}

// Expected rent I pay per full circuit, per opponent: sum over their
// unmortgaged developed deeds of traffic-weighted CURRENT rent / 40 tiles.
export function threatPerCircuit(game, playerId, opponentId) {
  void playerId;
  let threat = 0;
  for (const tile of BotTiles(game)) {
    if (tile?.ownerId !== opponentId || tile?.mortgaged) continue;
    if (tile.type !== 'property' && tile.type !== 'railroad' && tile.type !== 'utility') continue;
    threat += Math.floor(rentAtLevel(tile, tile.houseCount) * trafficPercent(tile.group) / 100 / 40);
  }
  return threat;
}

export function threatMatrix(game, playerId) {
  return livePlayers(game)
    .filter(player => player.id !== playerId)
    .map(player => ({
      id: player.id,
      hitPerCircuit: threatPerCircuit(game, playerId, player.id),
      buildReady: isBuildReady(game, player),
      nearComplete: nearCompleteGroups(game, player.id),
    }))
    .sort((a, b) => b.hitPerCircuit - a.hitPerCircuit);
}

function groupTiles(game, group) {
  if (typeof game?.getGroupTiles === 'function') {
    try {
      return game.getGroupTiles(group) || [];
    } catch {
      return [];
    }
  }
  return BotTiles(game).filter(tile => tile?.group === group);
}

// Groups where the player owns all-but-one (or all) deeds.
export function nearCompleteGroups(game, playerId) {
  const groups = [...new Set(BotTiles(game).map(tile => tile?.group).filter(Boolean))];
  const out = [];
  for (const group of groups) {
    const tiles = groupTiles(game, group);
    if (!tiles.length) continue;
    const owned = tiles.filter(tile => tile?.ownerId === playerId).length;
    if (owned >= tiles.length - 1) out.push({ group, owned, total: tiles.length });
  }
  return out;
}

export function isBuildReady(game, player) {
  return Math.max(0, Math.floor(number(player?.cash))) >= 100;
}

// Primary win path: nearest completable group + reserve target.
export function winPath(game, playerId) {
  const groups = [...new Set(BotTiles(game).map(tile => tile?.group).filter(Boolean))];
  let target = null;
  for (const group of groups) {
    const tiles = groupTiles(game, group);
    if (!tiles.length) continue;
    const owned = tiles.filter(tile => tile?.ownerId === playerId);
    const missing = tiles.filter(tile => tile?.ownerId !== playerId);
    if (!owned.length || owned.length >= tiles.length) continue;
    const missingIndexes = missing.map(tile => tile.index);
    if (!target || missing.length < target.missing) {
      target = { group, owned: owned.length, total: tiles.length, missing: missing.length, missingIndexes };
    }
  }
  const threats = threatMatrix(game, playerId);
  const maxHit = threats.length ? Math.max(...threats.map(entry => entry.hitPerCircuit)) : 0;
  return {
    target,
    reserve: Math.max(120, Math.min(1000, maxHit * 40 + 100)),
    topThreat: threats[0]?.id || null,
  };
}

// Spoiler mode: I cannot plausibly win (leader worth 2x+ mine with 3+
// seats left) — deny the frontrunner instead of gifting anyone.
export function kingmakerState(game, playerId) {
  const table = standings(game);
  if (table.length < 3) return { spoiler: false, target: null };
  const me = table.find(entry => entry.id === playerId);
  const leader = table[0];
  if (!me || !leader || leader.id === playerId) return { spoiler: false, target: null };
  if (leader.netWorth >= Math.max(1, me.netWorth) * 2) {
    return { spoiler: true, target: leader.id, leaderGap: leader.netWorth - me.netWorth };
  }
  return { spoiler: false, target: null };
}

export function endgameClock(game) {
  const active = livePlayers(game).length;
  return { seats: active, endgame: active <= 2 };
}

// Raw traffic-weighted rent one seat deals another per circuit (no /40
// normalization): the endgame currency.
function rawThreatDealt(game, ownerId) {
  let total = 0;
  for (const tile of BotTiles(game)) {
    if (tile?.ownerId !== ownerId || tile?.mortgaged) continue;
    if (tile.type !== 'property' && tile.type !== 'railroad' && tile.type !== 'utility') continue;
    total += Math.floor(Math.max(0, Math.floor(number(tile.rent))) * trafficPercent(tile.group) / 100);
  }
  return total;
}

// Exact 2-seat endgame solve: project 10 circuits at ~30% landing
// coverage. Null unless exactly two live seats. { win, margin,
// netPerCircuit, circuitsToRuin }.
export function solveEndgame(game, playerId) {
  const table = standings(game);
  if (table.length !== 2) return null;
  const me = table.find(entry => entry.id === playerId);
  const foe = table.find(entry => entry.id !== playerId);
  if (!me || !foe) return null;
  const dealt = rawThreatDealt(game, playerId);
  const taken = rawThreatDealt(game, foe.id);
  const netPerCircuit = Math.floor((dealt - taken) * 0.3);
  const horizon = netPerCircuit * 10;
  const finalMe = me.netWorth + horizon;
  const finalFoe = foe.netWorth - horizon;
  const win = finalMe > finalFoe;
  const margin = Math.abs(finalMe - finalFoe);
  const loserDrain = win ? Math.max(0, -netPerCircuit) + Math.max(1, Math.floor(foe.netWorth / 40)) : Math.max(0, netPerCircuit) + Math.max(1, Math.floor(me.netWorth / 40));
  return {
    win,
    margin,
    netPerCircuit,
    circuitsToRuin: netPerCircuit === 0 ? Number.MAX_SAFE_INTEGER : Math.max(1, Math.ceil(Math.min(me.netWorth, foe.netWorth) / Math.max(1, Math.abs(netPerCircuit)))),
    loserDrain,
  };
}

// Full per-tick report for one bot seat.
export function tableBrain(game, playerId) {
  const table = standings(game);
  const rank = Math.max(1, table.findIndex(entry => entry.id === playerId) + 1);
  return {
    standings: table,
    rank,
    seats: table.length,
    threats: threatMatrix(game, playerId),
    path: winPath(game, playerId),
    kingmaker: kingmakerState(game, playerId),
    clock: endgameClock(game),
  };
}
