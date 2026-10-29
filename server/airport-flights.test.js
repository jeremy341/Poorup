// Airport flights: the fare rule (arrival fee beats departure fee beats the
// default fare), who is paid, when a flight is refused, and the owner fee limits.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { AIRPORT_DEFAULT_FARE, AIRPORT_MAX_FEE } from './airportApi.js';

const failures = [];
function check(name, run) {
  try {
    run();
    console.log(`PASS - ${name}`);
  } catch (error) {
    failures.push({ name, error });
    console.log(`FAIL - ${name}: ${error.stack || error.message}`);
  }
}

const ACC = 5;
const BKK = 15;
const AMS = 25;
const MB = 35;

function flightRoom(options = {}) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'a', clientId: 'a', nickname: 'A', rulesProfile: 'advanced', rulesetOverrides: { flights: true }, ...options });
  room.addOrReconnectPlayer({ socketId: 'b', clientId: 'b', nickname: 'B' });
  assert.equal(room.startGame().success, true);
  const [a, b] = room.game.players;
  room.game.currentPlayerId = a.id;
  a.position = ACC;
  a.cash = 1000;
  b.cash = 1000;
  return { room, game: room.game, a, b };
}

function giveAirport(game, player, index, fees = {}) {
  const tile = game.getTile(index);
  tile.ownerId = player.id;
  tile.mortgaged = false;
  if (!player.properties.includes(index)) player.properties.push(index);
  Object.assign(tile, fees);
  return tile;
}

check('flights are an add-on and default to off', () => {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'a', clientId: 'a', nickname: 'A' });
  assert.equal(room.settings.flights, false);
  assert.equal(room.getDirectorySummary().addOns.includes('flights'), false);
  const on = manager.createRoom({ socketId: 'c', clientId: 'c', nickname: 'C', rulesProfile: 'advanced', rulesetOverrides: { flights: true } });
  assert.equal(on.settings.flights, true);
  assert.equal(on.getDirectorySummary().addOns.includes('flights'), true);
});

check('two unowned airports charge the default fare to the bank', () => {
  const { game, a } = flightRoom();
  const result = game.flyToAirport('a', BKK);
  assert.equal(result.success, true);
  assert.equal(result.fare, AIRPORT_DEFAULT_FARE);
  assert.equal(result.basis, 'default');
  assert.equal(a.cash, 1000 - AIRPORT_DEFAULT_FARE);
  assert.equal(a.position, BKK);
});

check('an owned origin charges its departure fee to its owner', () => {
  const { game, a, b } = flightRoom();
  giveAirport(game, b, ACC, { departureFee: 60, arrivalFee: 150 });
  const result = game.flyToAirport('a', BKK);
  assert.equal(result.fare, 60);
  assert.equal(result.basis, 'departure');
  assert.equal(a.cash, 940);
  assert.equal(b.cash, 1060);
});

check('an owned destination overwrites the fare with its arrival fee', () => {
  const { game, a, b } = flightRoom();
  giveAirport(game, b, ACC, { departureFee: 60 });
  giveAirport(game, b, BKK, { arrivalFee: 30 });
  const result = game.flyToAirport('a', BKK);
  assert.equal(result.fare, 30);
  assert.equal(result.basis, 'arrival');
  assert.equal(a.cash, 970);
  assert.equal(b.cash, 1030);
  assert.equal(game.pendingPayment, null, 'no landing rent on top of the arrival fee');
});

check('a traveller flies free into or out of an airport they own', () => {
  const { game, a, b } = flightRoom();
  giveAirport(game, a, BKK, { arrivalFee: 90 });
  const result = game.flyToAirport('a', BKK);
  assert.equal(result.fare, 0);
  assert.equal(a.cash, 1000);
  assert.equal(b.cash, 1000);
});

check('a mortgaged airport acts as unowned', () => {
  const { game, a, b } = flightRoom();
  giveAirport(game, b, BKK, { arrivalFee: 10 });
  game.getTile(BKK).mortgaged = true;
  const result = game.flyToAirport('a', BKK);
  assert.equal(result.basis, 'default');
  assert.equal(a.cash, 1000 - AIRPORT_DEFAULT_FARE);
  assert.equal(b.cash, 1000);
});

check('flying replaces the roll and leaves the turn ready to end', () => {
  const { game, a } = flightRoom();
  game.flyToAirport('a', AMS);
  assert.equal(game.hasRolled, true);
  assert.equal(game.extraRollPending, false);
  assert.equal(game.rollDice('a').success, false, 'cannot roll after flying');
  assert.equal(game.flyToAirport('a', BKK).success, false, 'one flight per turn');
  assert.equal(a.position, AMS);
});

check('a flight never passes Start: no salary, even when it wraps the board', () => {
  const wrap = flightRoom();
  wrap.a.position = MB;
  const result = wrap.game.flyToAirport('a', ACC);
  assert.equal(result.success, true);
  assert.equal(wrap.a.position, ACC);
  assert.equal(wrap.a.cash, 1000 - AIRPORT_DEFAULT_FARE, 'only the fare moves; no Start salary');
  assert.equal(wrap.game.feed.some(entry => /Start/.test(entry.text || entry)), false);
});

check('a flight teleports: the summary marks it so clients snap, and the mark clears next turn', () => {
  const { game, a, b } = flightRoom();
  giveAirport(game, b, BKK, { arrivalFee: 10 });
  game.flyToAirport('a', BKK);
  const summary = game.getGameSummary(a.id);
  assert.deepEqual(summary.lastFlight, { playerId: a.id, from: ACC, to: BKK });
  game.endTurn('a');
  assert.equal(game.getGameSummary(a.id).lastFlight, null);
});

check('landing on an unowned airport offers the purchase', () => {
  const { game, a } = flightRoom();
  game.flyToAirport('a', MB);
  assert.equal(game.pendingPurchaseOffer?.playerId, a.id);
  assert.equal(game.pendingPurchaseOffer?.tileIndex ?? game.pendingPurchaseOffer?.tile?.index, MB);
});

check('a flight is refused when it cannot be booked', () => {
  const off = flightRoom({ rulesetOverrides: {} });
  assert.match(off.game.flyToAirport('a', BKK).error, /off at this table/);

  const broke = flightRoom();
  broke.a.cash = AIRPORT_DEFAULT_FARE - 1;
  assert.match(broke.game.flyToAirport('a', BKK).error, /need \$100/);
  assert.equal(broke.a.position, ACC);

  const notAirport = flightRoom();
  notAirport.a.position = 1;
  assert.match(notAirport.game.flyToAirport('a', BKK).error, /only fly from an airport/);

  const notYourTurn = flightRoom();
  assert.match(notYourTurn.game.flyToAirport('b', BKK).error, /not your turn/);

  const sameAirport = flightRoom();
  assert.match(sameAirport.game.flyToAirport('a', ACC).error, /already at that airport/);

  const notAnAirport = flightRoom();
  assert.match(notAnAirport.game.flyToAirport('a', 1).error, /not an airport/);

  const jailed = flightRoom();
  jailed.a.inJail = true;
  assert.match(jailed.game.flyToAirport('a', BKK).error, /from jail/);

  const struck = flightRoom();
  struck.game.globalEvent = { id: 'airport-strike', phase: 'active', effects: { airportCardsBlocked: true } };
  assert.match(struck.game.flyToAirport('a', BKK).error, /strike/);
});

check('only the owner sets fees, within $0 to the maximum, whole dollars', () => {
  const { game, a, b } = flightRoom();
  giveAirport(game, b, ACC);
  assert.match(game.setAirportFees('a', ACC, { departure: 10 }).error, /do not own/);
  assert.equal(game.setAirportFees('b', ACC, { departure: 40, arrival: 0 }).success, true);
  assert.equal(game.getTile(ACC).departureFee, 40);
  assert.equal(game.getTile(ACC).arrivalFee, 0);
  assert.match(game.setAirportFees('b', ACC, { departure: AIRPORT_MAX_FEE + 1 }).error, /\$0 to \$200/);
  assert.match(game.setAirportFees('b', ACC, { departure: -1 }).error, /\$0 to \$200/);
  assert.match(game.setAirportFees('b', ACC, { departure: 12.5 }).error, /\$0 to \$200/);
  assert.match(game.setAirportFees('b', ACC, { departure: 'x' }).error, /\$0 to \$200/);
  assert.match(game.setAirportFees('b', ACC, {}).error, /Nothing to change/);
  assert.match(game.setAirportFees('b', 1, { departure: 10 }).error, /not an airport/);
  assert.equal(game.getTile(ACC).departureFee, 40, 'rejected edits change nothing');
  assert.equal(a.cash, 1000);
});

check('an unset fee falls back to the default fare', () => {
  const { game, a, b } = flightRoom();
  giveAirport(game, b, ACC);
  const result = game.flyToAirport('a', BKK);
  assert.equal(result.fare, AIRPORT_DEFAULT_FARE);
  assert.equal(result.basis, 'departure');
  assert.equal(b.cash, 1000 + AIRPORT_DEFAULT_FARE);
  assert.equal(a.cash, 1000 - AIRPORT_DEFAULT_FARE);
});

check('the summary prices every destination for the viewer and hides fees when flights are off', () => {
  const { game, b } = flightRoom();
  giveAirport(game, b, BKK, { arrivalFee: 20 });
  const summary = game.getGameSummary(game.players[0].id);
  assert.equal(summary.flights.enabled, true);
  assert.equal(summary.flights.defaultFare, AIRPORT_DEFAULT_FARE);
  assert.equal(summary.flights.maxFee, AIRPORT_MAX_FEE);
  assert.deepEqual(summary.flights.options.map(option => [option.tileIndex, option.fare, option.basis]), [
    [BKK, 20, 'arrival'], [AMS, 100, 'default'], [MB, 100, 'default'],
  ]);
  const airportTile = summary.tiles.find(tile => tile.index === BKK);
  assert.equal(airportTile.arrivalFee, 20);
  assert.equal(airportTile.departureFee, AIRPORT_DEFAULT_FARE);
  const opponent = game.getGameSummary(game.players[1].id);
  assert.deepEqual(opponent.flights.options, [], 'no options when it is not your turn');

  const off = flightRoom({ rulesetOverrides: {} });
  const offSummary = off.game.getGameSummary(off.a.id);
  assert.equal(offSummary.flights.enabled, false);
  assert.equal(offSummary.tiles.find(tile => tile.index === BKK).arrivalFee, undefined);
});

check('a missing or out-of-range destination is refused before any fare moves', () => {
  for (const bad of [999, -1, 'abc', undefined, NaN]) {
    const { game, a, b } = flightRoom();
    giveAirport(game, b, ACC, { departureFee: 150 });
    const result = game.flyToAirport('a', bad);
    assert.equal(result.success, false, `tileIndex ${String(bad)} must be refused`);
    assert.match(result.error, /not an airport/);
    assert.equal(a.cash, 1000, 'no fare is charged');
    assert.equal(b.cash, 1000, 'no fare is paid');
    assert.equal(a.position, ACC);
    assert.equal(game.hasRolled, false);
  }
});

check('fees reject null, blank, array and boolean values instead of zeroing them', () => {
  const { game, b } = flightRoom();
  giveAirport(game, b, ACC, { departureFee: 40, arrivalFee: 60 });
  for (const bad of [null, '', ' ', [], false, true, '0x10', '1e2']) {
    const result = game.setAirportFees('b', ACC, { departure: bad });
    assert.equal(result.success, false, `fee ${JSON.stringify(bad)} must be refused`);
    assert.equal(game.getTile(ACC).departureFee, 40, 'a rejected edit changes nothing');
  }
  assert.equal(game.setAirportFees('b', ACC, { departure: '75' }).success, true, 'digit-only strings still work');
  assert.equal(game.getTile(ACC).departureFee, 75);
  assert.equal(game.setAirportFees('b', ACC, null).success, false, 'a null fees object is "nothing to change", not a throw');
});

if (failures.length) {
  console.log(`airport flights: ${failures.length} failed`);
  process.exit(1);
}
console.log('airport flights: all passed');
