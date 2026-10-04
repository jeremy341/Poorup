// Regression suite for the B-27 and B-29 economy-audit defects.
//
// B-27: GROUP_TRAFFIC_PERCENT was byte-identically duplicated in
// botTradeValuation.js, botDevelopmentForecast.js, and botTableBrain.js, and
// all three copies enumerated only the eight classic groups. Metro-52 ships
// Metro Gold and Metro Silver (boardRegistry.js GROUPS), so the highest-priced
// group on the board silently inherited the 100 fall-through and was valued
// exactly like Green. The table is now a single canonical export, both
// consumers import it, and the missing metro tiers are present.
//
// B-29: the tourism boom's direct rule hardcoded `tile.group === 'Dark Blue'`
// while premiumEventFactors listed both premium groups — and suppressed itself
// for tourism-boom — so Metro Silver matched neither path and lost the surge
// the event declares (premiumRentMultiplier 1.3). One PREMIUM_GROUPS constant
// now feeds both sites.
import test from 'node:test';
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { GROUPS, tileIndexById } from './boardRegistry.js';
import { GROUP_TRAFFIC_PERCENT, trafficPercent, deedValue } from './botTradeValuation.js';
import { trafficPercent as forecastTrafficPercent, houseDeltaPerCircuit, forecastMaxHit } from './botDevelopmentForecast.js';
import { trafficPercent as brainTrafficPercent, threatPerCircuit } from './botTableBrain.js';
import { calculateRentFromFacts, rentFactsFromGame, rentFactsFromSnapshot } from './botRentForecast.js';
import { buildBotStrategicContext } from './botStrategicContext.js';

// The eight classic tiers exactly as they were before the metro tiers landed.
const CLASSIC_TIERS = Object.freeze({
  Orange: 130,
  'Light Blue': 120,
  Red: 115,
  Pink: 110,
  Yellow: 105,
  Green: 100,
  Brown: 95,
  'Dark Blue': 90,
});

const ACCESSORS = Object.freeze({
  botTradeValuation: trafficPercent,
  botDevelopmentForecast: forecastTrafficPercent,
  botTableBrain: brainTrafficPercent,
});

// ------------------------------------------------------------------ B-27 tests

test('B-27 the metro groups resolve to their own tier, not the 100 fall-through', () => {
  assert.notEqual(GROUP_TRAFFIC_PERCENT['Metro Gold'], 100, 'Metro Gold must not inherit the Green-tier default');
  assert.notEqual(GROUP_TRAFFIC_PERCENT['Metro Silver'], 100, 'Metro Silver must not inherit the Green-tier default');
  assert.equal(trafficPercent(GROUPS.metroGold.group), GROUP_TRAFFIC_PERCENT['Metro Gold']);
  assert.equal(trafficPercent(GROUPS.metroSilver.group), GROUP_TRAFFIC_PERCENT['Metro Silver']);
});

test('B-27 the ordering contract holds: Metro Silver sits at or below Dark Blue', () => {
  assert.ok(
    GROUP_TRAFFIC_PERCENT[GROUPS.metroSilver.group] <= GROUP_TRAFFIC_PERCENT['Dark Blue'],
    `Metro Silver (${GROUP_TRAFFIC_PERCENT[GROUPS.metroSilver.group]}%) must rank at or below Dark Blue (${GROUP_TRAFFIC_PERCENT['Dark Blue']}%)`,
  );
  assert.ok(
    GROUP_TRAFFIC_PERCENT['Metro Gold'] > GROUP_TRAFFIC_PERCENT['Dark Blue'],
    'Metro Gold outranks Dark Blue under the declared descending order',
  );
});

test('B-27 every tier is a positive integer and the table is frozen', () => {
  for (const [group, percent] of Object.entries(GROUP_TRAFFIC_PERCENT)) {
    assert.equal(Number.isInteger(percent), true, `${group} tier must stay whole-dollar percent`);
    assert.ok(percent > 0, `${group} tier must stay positive`);
  }
  assert.equal(Object.isFrozen(GROUP_TRAFFIC_PERCENT), true);
});

test('B-27 the three modules share one table instead of three copies', () => {
  const groups = Object.keys(GROUP_TRAFFIC_PERCENT);
  for (const [module, accessor] of Object.entries(ACCESSORS)) {
    assert.equal(
      accessor,
      trafficPercent,
      `${module} must re-export the canonical accessor, not redeclare its own`,
    );
    const resolved = Object.fromEntries(groups.map(group => [group, accessor(group)]));
    assert.deepEqual(resolved, GROUP_TRAFFIC_PERCENT, `${module} reads a different traffic table`);
  }
});

test('B-27 every group boardRegistry.GROUPS declares has a non-default tier', () => {
  const declared = Object.values(GROUPS).map(entry => entry.group);
  assert.ok(declared.length > 0, 'the registry still declares groups');
  for (const group of declared) {
    assert.notEqual(
      GROUP_TRAFFIC_PERCENT[group],
      100,
      `${group} is declared by boardRegistry.GROUPS but has no traffic tier of its own`,
    );
    assert.notEqual(trafficPercent(group), 100, `${group} would silently inherit the Green tier`);
  }
});

test('B-27 every group that ships on a board tile has an explicit tier key', () => {
  // The registry is the contract, but the board data is the runtime truth: any
  // group a tile actually carries must be tiered, so a future board cannot
  // re-open this defect through a new tile rather than a new registry entry.
  // Presence — not a non-default value — is the assertion here: Green really is
  // the 100 tier, while a missing key would be indistinguishable from it.
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'b27-a', clientId: 'b27-a', nickname: 'A', boardVariant: 'metro-52' });
  const boardGroups = [...new Set(room.game.tiles.map(tile => tile.group).filter(Boolean))];
  assert.ok(boardGroups.includes('Metro Gold') && boardGroups.includes('Metro Silver'));
  for (const group of boardGroups) {
    assert.ok(Object.hasOwn(GROUP_TRAFFIC_PERCENT, group), `${group} ships on metro-52 with no tier key`);
  }
});

test('B-27 the eight classic groups keep their exact previous tiers', () => {
  for (const [group, percent] of Object.entries(CLASSIC_TIERS)) {
    assert.equal(trafficPercent(group), percent, `${group} tier must not move`);
    assert.equal(forecastTrafficPercent(group), percent);
    assert.equal(brainTrafficPercent(group), percent);
  }
  assert.equal(Object.keys(GROUP_TRAFFIC_PERCENT).length, Object.keys(CLASSIC_TIERS).length + 2,
    'the only added tiers are the two metro groups');
});

test('B-27 an ungrouped tile still falls back to the flat 100 baseline', () => {
  assert.equal(trafficPercent(undefined), 100);
  assert.equal(trafficPercent(null), 100);
  assert.equal(trafficPercent(''), 100);
  assert.equal(trafficPercent('Not A Group'), 100);
  // Railroads and utilities have no group; deedValue must still price them at face.
  assert.equal(deedValue({}, { index: 5, price: 200 }), 200);
  assert.equal(houseDeltaPerCircuit({ rent: 25, houseCount: 0 }), 100, 'ungrouped: floor((125-25) * 100%)');
});

test('B-27 the metro tiers reach the money the bots actually price', () => {
  const metroSilver = GROUPS.metroSilver.group;
  const metroGold = GROUPS.metroGold.group;
  // Busan is the $420 Metro Silver deed; Lagos is a $34 Metro Gold deed.
  assert.equal(deedValue({}, { index: 24, price: 420, group: metroSilver }), 369, 'floor(420 * 88%)');
  assert.equal(houseDeltaPerCircuit({ rent: 38, houseCount: 0, group: metroSilver }), 133, 'floor((190-38) * 88%)');
  assert.equal(houseDeltaPerCircuit({ rent: 34, houseCount: 0, group: metroGold }), 130, 'floor((170-34) * 96%)');
  // An opponent's Metro Silver deed is now forecast below its face rent instead
  // of at it, which is the whole point of tiering it.
  const board = [{ index: 24, group: metroSilver, ownerSeat: 'opponent-1', rent: 42, houseCount: 0, mortgaged: false }];
  assert.equal(forecastMaxHit(board), 36, 'floor(42 * 88%), was floor(42 * 100%) = 42');
});

test('B-27 botTableBrain threat math reads the shared metro tier', () => {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'b27-t', clientId: 'b27-t', nickname: 'A', boardVariant: 'metro-52' });
  room.addOrReconnectPlayer({ socketId: 'b27-u', clientId: 'b27-u', nickname: 'B' });
  assert.equal(room.startGame().success, true);
  const game = room.game;
  const busan = game.getTile(tileIndexById('metro-52', 'busan'));
  assert.equal(busan.group, GROUPS.metroSilver.group);
  assert.equal(busan.ownerId, null);
  busan.ownerId = game.players[1].id;
  busan.rent = 42;
  busan.houseCount = 0;
  assert.equal(
    threatPerCircuit(game, game.players[0].id, game.players[1].id),
    Math.floor(42 * GROUP_TRAFFIC_PERCENT[GROUPS.metroSilver.group] / 100 / 52),
    'the metro board divides the shared 88% tier across 52 spaces',
  );
});

// ------------------------------------------------------------------ B-29 setup

function startedRoom(options = {}) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'b29-a', clientId: 'b29-a', nickname: 'Ada', ...options });
  room.addOrReconnectPlayer({ socketId: 'b29-b', clientId: 'b29-b', nickname: 'Bob' });
  assert.equal(room.startGame().success, true);
  const game = room.game;
  game.settings.doubleRent = false;
  game.currentPlayerId = game.players[0].id;
  return game;
}

const own = (game, tile) => { tile.ownerId = game.players[0].id; return tile; };
const activate = (game, id, extra = {}) => { game.globalEvent = { id, phase: 'active', ...extra }; return game; };

// Rent through all three surfaces the invariant covers: the live player path,
// the bot game-forecast path, and the provider-safe snapshot path.
function tripleRent(game, tile) {
  const diceTotal = game.diceTotal();
  const live = game.getPropertyRent(tile);
  const forecast = calculateRentFromFacts(rentFactsFromGame(game, tile, diceTotal));
  const snapshot = buildBotStrategicContext(game, game.players[0]);
  const snapshotTile = snapshot.board.find(entry => entry.index === tile.index);
  const fromSnapshot = calculateRentFromFacts(rentFactsFromSnapshot(snapshot, snapshotTile, diceTotal));
  return { live, forecast, fromSnapshot };
}

// Metro-52, one deed from each metro group owned by seat 1. Seoul ($38) is the
// base rent behind the B-29 report; Lagos ($34) is the control.
function metroRoom(event) {
  const game = startedRoom({ boardVariant: 'metro-52' });
  const seoul = own(game, game.getTile(tileIndexById('metro-52', 'seoul')));
  const lagos = own(game, game.getTile(tileIndexById('metro-52', 'lagos')));
  if (event) activate(game, event.id, event.extra);
  return { game, seoul, lagos };
}

// The declared effects of the two premium events under test, straight from
// globalEventData.js so a retune shows up here as a failing expectation.
const TOURISM_BOOM_EFFECTS = { airportRentMultiplier: 1.5, premiumRentMultiplier: 1.3, marketPriceMultiplier: 1.15 };
const TRAVEL_CHAOS_EFFECTS = { airportRentMultiplier: 0, premiumRentMultiplier: 1.55, airportCardsBlocked: true };

// ------------------------------------------------------------------ B-29 tests

test('B-29 tourism-boom surges Metro Silver by the same x1.3 as Dark Blue', () => {
  const metro = metroRoom({ id: 'tourism-boom', extra: { effects: TOURISM_BOOM_EFFECTS } });
  const standard = startedRoom();
  const darkBlue = own(standard, standard.getTile(37));
  activate(standard, 'tourism-boom', { effects: TOURISM_BOOM_EFFECTS });

  assert.equal(metro.seoul.rent, 38, 'Seoul is the $38 Metro Silver deed from the audit');
  assert.equal(darkBlue.rent, 35);
  const silver = tripleRent(metro.game, metro.seoul);
  const blue = tripleRent(standard, darkBlue);
  assert.equal(silver.live, 49, 'floor(38 * 1.3) — the dropped multiplier the audit measured is gone');
  assert.equal(blue.live, 45, 'Dark Blue keeps its pinned 35 * 1.3');
  // Undo the whole-dollar floor and both districts carry the identical boost.
  assert.equal(Math.round((silver.live / metro.seoul.rent) * 100) / 100, 1.29);
  assert.equal(blue.live / darkBlue.rent >= 1.28 && blue.live / darkBlue.rent <= 1.3, true);
});

test('B-29 the tourism-boom multiplier reaches Metro Silver on all three rent paths', () => {
  const metro = metroRoom({ id: 'tourism-boom', extra: { effects: TOURISM_BOOM_EFFECTS } });
  const seoul = tripleRent(metro.game, metro.seoul);
  assert.equal(seoul.live, 49);
  assert.equal(seoul.forecast, 49, 'the bot game-forecast path agrees');
  assert.equal(seoul.fromSnapshot, 49, 'the bot snapshot path agrees');
});

test('B-29 Metro Silver still earns its premium under a non-tourism premium event', () => {
  const metro = metroRoom({ id: 'travel-chaos', extra: { effects: TRAVEL_CHAOS_EFFECTS } });
  const seoul = tripleRent(metro.game, metro.seoul);
  assert.equal(seoul.live, 58, 'floor(38 * 1.55) via premiumRentMultiplier');
  assert.equal(seoul.forecast, 58);
  assert.equal(seoul.fromSnapshot, 58);

  const convention = metroRoom({ id: 'convention-week', extra: { effects: { premiumRentMultiplier: 1.2 } } });
  assert.equal(tripleRent(convention.game, convention.seoul).live, 45, 'floor(38 * 1.2)');
});

test('B-29 Metro Gold is still not premium under either event', () => {
  const boom = metroRoom({ id: 'tourism-boom', extra: { effects: TOURISM_BOOM_EFFECTS } });
  assert.equal(boom.lagos.rent, 34);
  const boomGold = tripleRent(boom.game, boom.lagos);
  assert.equal(boomGold.live, 34, 'Metro Gold is in neither premium list — design, not bug');
  assert.equal(boomGold.forecast, 34);
  assert.equal(boomGold.fromSnapshot, 34);

  const chaos = metroRoom({ id: 'travel-chaos', extra: { effects: TRAVEL_CHAOS_EFFECTS } });
  const chaosGold = tripleRent(chaos.game, chaos.lagos);
  assert.equal(chaosGold.live, 34);
  assert.equal(chaosGold.forecast, 34);
  assert.equal(chaosGold.fromSnapshot, 34);
});

test('B-29 the live, game-forecast, and snapshot rent agree for Metro Silver under tourism-boom', () => {
  for (const deed of ['seoul', 'busan']) {
    const game = startedRoom({ boardVariant: 'metro-52' });
    const tile = own(game, game.getTile(tileIndexById('metro-52', deed)));
    activate(game, 'tourism-boom', { effects: TOURISM_BOOM_EFFECTS });
    const rent = tripleRent(game, tile);
    assert.equal(rent.forecast, rent.live, `${deed}: game forecast must equal live rent`);
    assert.equal(rent.fromSnapshot, rent.live, `${deed}: snapshot forecast must equal live rent`);
    assert.equal(rent.live, Math.floor(tile.rent * 1.3));
  }
});

test('B-29 the standard-40 tourism and premium goldens are unchanged', () => {
  const golden = (index, eventId, effects) => {
    const game = startedRoom();
    const tile = own(game, game.getTile(index));
    activate(game, eventId, effects ? { effects } : {});
    return tripleRent(game, tile);
  };

  // rent.test.js GOLDEN entries, re-asserted across all three paths.
  const darkBlue = golden(37, 'tourism-boom');
  assert.equal(darkBlue.live, 45);
  assert.equal(darkBlue.forecast, 45);
  assert.equal(darkBlue.fromSnapshot, 45);

  const skipsPremium = golden(37, 'tourism-boom', { premiumRentMultiplier: 2 });
  assert.equal(skipsPremium.live, 45, 'the boom still ignores the effect payload');
  assert.equal(skipsPremium.forecast, 45);
  assert.equal(skipsPremium.fromSnapshot, 45);

  const genericPremium = golden(37, 'custom', { premiumRentMultiplier: 2 });
  assert.equal(genericPremium.live, 70, 'the generic premium path still reads the effect');
  assert.equal(genericPremium.forecast, 70);
  assert.equal(genericPremium.fromSnapshot, 70);

  const airport = golden(5, 'tourism-boom', { airportRentMultiplier: 1.5 });
  assert.equal(airport.live, 37, 'floor(25 * 1.5)');
  assert.equal(airport.forecast, 37);
  assert.equal(airport.fromSnapshot, 37);
});