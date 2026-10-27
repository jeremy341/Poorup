// Characterization suite for GameState.applyCard — the card-action dispatcher
// in the rules engine. Each case drives one card action (and the tricky
// branches: low-tax election modifier, airport-strike grounding, owned
// railroad/utility rent, missing destinations) from an identical two-player
// fixture and pins the observable contract: return shape, positions, cash
// movement, pending purchase offer, turn resolution and feed volume. Captured
// from the pre-refactor switch; the dispatch-table extraction must keep it green.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';

const GOLDEN = {
  "collectStart": {
    "ret": "undefined",
    "p0": {
      "pos": 0,
      "cash": 1200,
      "inJail": false,
      "jailTurns": 0,
      "jailFree": 0
    },
    "p1cash": 1000,
    "offer": null,
    "trade": 0,
    "turn": "p0",
    "rolled": true,
    "await": true,
    "feedCount": 3
  },
  "collectStart-lowtax": {
    "ret": "undefined",
    "p0": {
      "pos": 0,
      "cash": 1160,
      "inJail": false,
      "jailTurns": 0,
      "jailFree": 0
    },
    "p1cash": 1000,
    "offer": null,
    "trade": 0,
    "turn": "p0",
    "rolled": true,
    "await": true,
    "feedCount": 3
  },
  "collectStart-noamount": {
    "ret": "undefined",
    "p0": {
      "pos": 0,
      "cash": 1200,
      "inJail": false,
      "jailTurns": 0,
      "jailFree": 0
    },
    "p1cash": 1000,
    "offer": null,
    "trade": 0,
    "turn": "p0",
    "rolled": true,
    "await": true,
    "feedCount": 3
  },
  "collect": {
    "ret": "undefined",
    "p0": {
      "pos": 0,
      "cash": 1050,
      "inJail": false,
      "jailTurns": 0,
      "jailFree": 0
    },
    "p1cash": 1000,
    "offer": null,
    "trade": 0,
    "turn": "p0",
    "rolled": true,
    "await": true,
    "feedCount": 3
  },
  "collect-lowtax": {
    "ret": "undefined",
    "p0": {
      "pos": 0,
      "cash": 1040,
      "inJail": false,
      "jailTurns": 0,
      "jailFree": 0
    },
    "p1cash": 1000,
    "offer": null,
    "trade": 0,
    "turn": "p0",
    "rolled": true,
    "await": true,
    "feedCount": 3
  },
  "pay": {
    "ret": "undefined",
    "p0": {
      "pos": 0,
      "cash": 970,
      "inJail": false,
      "jailTurns": 0,
      "jailFree": 0
    },
    "p1cash": 1000,
    "offer": null,
    "trade": 0,
    "turn": "p0",
    "rolled": true,
    "await": true,
    "feedCount": 3
  },
  "jailFree": {
    "ret": "undefined",
    "p0": {
      "pos": 0,
      "cash": 1000,
      "inJail": false,
      "jailTurns": 0,
      "jailFree": 1
    },
    "p1cash": 1000,
    "offer": null,
    "trade": 0,
    "turn": "p0",
    "rolled": true,
    "await": true,
    "feedCount": 3
  },
  "moveBack-default": {
    "ret": "{\"success\":true,\"purchaseOffer\":{\"tileIndex\":9,\"name\":\"Kumasi\",\"price\":120}}",
    "p0": {
      "pos": 9,
      "cash": 1000,
      "inJail": false,
      "jailTurns": 0,
      "jailFree": 0
    },
    "p1cash": 1000,
    "offer": 9,
    "trade": 0,
    "turn": "p0",
    "rolled": true,
    "await": false,
    "feedCount": 3
  },
  "moveBack-steps": {
    "ret": "{\"success\":true,\"purchaseOffer\":{\"tileIndex\":8,\"name\":\"Tema\",\"price\":100}}",
    "p0": {
      "pos": 8,
      "cash": 1000,
      "inJail": false,
      "jailTurns": 0,
      "jailFree": 0
    },
    "p1cash": 1000,
    "offer": 8,
    "trade": 0,
    "turn": "p0",
    "rolled": true,
    "await": false,
    "feedCount": 3
  },
  "moveTo-railroad": {
    "ret": "{\"success\":true,\"purchaseOffer\":{\"tileIndex\":5,\"name\":\"ACC Airport\",\"price\":200}}",
    "p0": {
      "pos": 5,
      "cash": 1000,
      "inJail": false,
      "jailTurns": 0,
      "jailFree": 0
    },
    "p1cash": 1000,
    "offer": 5,
    "trade": 0,
    "turn": "p0",
    "rolled": true,
    "await": false,
    "feedCount": 3
  },
  "moveTo-backward-bonus": {
    "ret": "{\"success\":true,\"purchaseOffer\":{\"tileIndex\":3,\"name\":\"Rio\",\"price\":60}}",
    "p0": {
      "pos": 3,
      "cash": 1200,
      "inJail": false,
      "jailTurns": 0,
      "jailFree": 0
    },
    "p1cash": 1000,
    "offer": 3,
    "trade": 0,
    "turn": "p0",
    "rolled": true,
    "await": false,
    "feedCount": 4
  },
  "moveTo-missing-tile": {
    "ret": "undefined",
    "p0": {
      "pos": 2,
      "cash": 1000,
      "inJail": false,
      "jailTurns": 0,
      "jailFree": 0
    },
    "p1cash": 1000,
    "offer": null,
    "trade": 0,
    "turn": "p0",
    "rolled": true,
    "await": true,
    "feedCount": 2
  },
  "nearestRailroad": {
    "ret": "{\"success\":true,\"purchaseOffer\":{\"tileIndex\":15,\"name\":\"BKK Airport\",\"price\":200}}",
    "p0": {
      "pos": 15,
      "cash": 1000,
      "inJail": false,
      "jailTurns": 0,
      "jailFree": 0
    },
    "p1cash": 1000,
    "offer": 15,
    "trade": 0,
    "turn": "p0",
    "rolled": true,
    "await": false,
    "feedCount": 2
  },
  "nearestRailroad-strike": {
    "ret": "{\"success\":true}",
    "p0": {
      "pos": 6,
      "cash": 1000,
      "inJail": false,
      "jailTurns": 0,
      "jailFree": 0
    },
    "p1cash": 1000,
    "offer": null,
    "trade": 0,
    "turn": "p0",
    "rolled": true,
    "await": true,
    "feedCount": 3
  },
  "nearestRailroad-owned": {
    "ret": "{\"success\":true}",
    "p0": {
      "pos": 15,
      "cash": 950,
      "inJail": false,
      "jailTurns": 0,
      "jailFree": 0
    },
    "p1cash": 1050,
    "offer": null,
    "trade": 0,
    "turn": "p0",
    "rolled": true,
    "await": true,
    "feedCount": 3
  },
  "nearestUtility": {
    "ret": "{\"success\":true,\"purchaseOffer\":{\"tileIndex\":12,\"name\":\"Electric Company\",\"price\":150}}",
    "p0": {
      "pos": 12,
      "cash": 1000,
      "inJail": false,
      "jailTurns": 0,
      "jailFree": 0
    },
    "p1cash": 1000,
    "offer": 12,
    "trade": 0,
    "turn": "p0",
    "rolled": true,
    "await": false,
    "feedCount": 2
  },
  "nearestUtility-owned": {
    "ret": "{\"success\":true}",
    "p0": {
      "pos": 12,
      "cash": 930,
      "inJail": false,
      "jailTurns": 0,
      "jailFree": 0
    },
    "p1cash": 1070,
    "offer": null,
    "trade": 0,
    "turn": "p0",
    "rolled": true,
    "await": true,
    "feedCount": 3
  },
  "repairs": {
    "ret": "undefined",
    "p0": {
      "pos": 0,
      "cash": 750,
      "inJail": false,
      "jailTurns": 0,
      "jailFree": 0
    },
    "p1cash": 1000,
    "offer": null,
    "trade": 0,
    "turn": "p0",
    "rolled": true,
    "await": true,
    "feedCount": 3
  },
  "repairs-zero": {
    "ret": "undefined",
    "p0": {
      "pos": 0,
      "cash": 1000,
      "inJail": false,
      "jailTurns": 0,
      "jailFree": 0
    },
    "p1cash": 1000,
    "offer": null,
    "trade": 0,
    "turn": "p0",
    "rolled": true,
    "await": true,
    "feedCount": 2
  },
  "payEach": {
    "ret": "undefined",
    "p0": {
      "pos": 0,
      "cash": 980,
      "inJail": false,
      "jailTurns": 0,
      "jailFree": 0
    },
    "p1cash": 1020,
    "offer": null,
    "trade": 0,
    "turn": "p0",
    "rolled": true,
    "await": true,
    "feedCount": 3
  },
  "collectFromEach": {
    "ret": "undefined",
    "p0": {
      "pos": 0,
      "cash": 1015,
      "inJail": false,
      "jailTurns": 0,
      "jailFree": 0
    },
    "p1cash": 985,
    "offer": null,
    "trade": 0,
    "turn": "p0",
    "rolled": true,
    "await": true,
    "feedCount": 3
  },
  "move-jail-tile": {
    "ret": "{\"success\":true}",
    "p0": {
      "pos": 10,
      "cash": 1000,
      "inJail": false,
      "jailTurns": 0,
      "jailFree": 0
    },
    "p1cash": 1000,
    "offer": null,
    "trade": 0,
    "turn": "p0",
    "rolled": true,
    "await": true,
    "feedCount": 4
  },
  "move-vacation": {
    "ret": "{\"success\":true}",
    "p0": {
      "pos": 20,
      "cash": 1000,
      "inJail": false,
      "jailTurns": 0,
      "jailFree": 0
    },
    "p1cash": 1000,
    "offer": null,
    "trade": 0,
    "turn": "p0",
    "rolled": true,
    "await": true,
    "feedCount": 4
  },
  "move-missing": {
    "ret": "undefined",
    "p0": {
      "pos": 0,
      "cash": 1000,
      "inJail": false,
      "jailTurns": 0,
      "jailFree": 0
    },
    "p1cash": 1000,
    "offer": null,
    "trade": 0,
    "turn": "p0",
    "rolled": true,
    "await": true,
    "feedCount": 2
  },
  "goToJail": {
    "ret": "undefined",
    "p0": {
      "pos": 10,
      "cash": 1000,
      "inJail": true,
      "jailTurns": 0,
      "jailFree": 0
    },
    "p1cash": 1000,
    "offer": null,
    "trade": 0,
    "turn": "p0",
    "rolled": true,
    "await": true,
    "feedCount": 3
  },
  "unknown-action": {
    "ret": "undefined",
    "p0": {
      "pos": 0,
      "cash": 1000,
      "inJail": false,
      "jailTurns": 0,
      "jailFree": 0
    },
    "p1cash": 1000,
    "offer": null,
    "trade": 0,
    "turn": "p0",
    "rolled": true,
    "await": true,
    "feedCount": 2
  }
};

function runCase(setup, card) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 's-a', clientId: 'c-a', nickname: 'Ada' });
  room.addOrReconnectPlayer({ socketId: 's-b', clientId: 'c-b', nickname: 'Bob' });
  const game = room.game;
  game.started = true;
  game.settings.startingCash = 1500;
  game.players.forEach((player) => { player.cash = 1000; });
  const [p0, p1] = game.players;
  game.currentPlayerId = p0.id;
  game.hasRolled = true;
  game.awaitingEndTurn = false;
  setup(game, p0, p1);
  const returned = game.applyCard(p0, card, {});
  return {
    ret: returned === undefined ? 'undefined' : JSON.stringify(returned),
    p0: { pos: p0.position, cash: p0.cash, inJail: p0.inJail, jailTurns: p0.jailTurns, jailFree: p0.jailFreeCards },
    p1cash: p1.cash,
    offer: game.pendingPurchaseOffer ? game.pendingPurchaseOffer.tileIndex : null,
    trade: game.pendingTrade ? 1 : 0,
    turn: game.currentPlayerId === p0.id ? 'p0' : 'moved',
    rolled: game.hasRolled,
    await: game.awaitingEndTurn,
    feedCount: game.feed.length
  };
}

const lowTax = (game) => { game.globalEvent = { id: 'city-election', phase: 'active', resolvedChoice: 'low-tax' }; };
const strike = (game) => { game.globalEvent = { id: 'airport-strike', phase: 'active' }; };

const CASES = {
  'collectStart': [() => {}, { action: 'collectStart', amount: 200 }],
  'collectStart-lowtax': [lowTax, { action: 'collectStart', amount: 200 }],
  'collectStart-noamount': [() => {}, { action: 'collectStart' }],
  'collect': [() => {}, { action: 'collect', amount: 50 }],
  'collect-lowtax': [lowTax, { action: 'collect', amount: 50 }],
  'pay': [() => {}, { action: 'pay', amount: 30 }],
  'jailFree': [() => {}, { action: 'jailFree' }],
  'moveBack-default': [(g, p0) => { p0.position = 12; }, { action: 'moveBack' }],
  'moveBack-steps': [(g, p0) => { p0.position = 12; }, { action: 'moveBack', steps: 4 }],
  'moveTo-railroad': [(g, p0) => { p0.position = 2; }, { action: 'moveTo', tileIndex: 5 }],
  'moveTo-backward-bonus': [(g, p0) => { p0.position = 20; }, { action: 'moveTo', tileIndex: 3 }],
  'moveTo-missing-tile': [(g, p0) => { p0.position = 2; }, { action: 'moveTo', tileIndex: 999 }],
  'nearestRailroad': [(g, p0) => { p0.position = 6; }, { action: 'nearestRailroad' }],
  'nearestRailroad-strike': [(g, p0) => { p0.position = 6; strike(g); }, { action: 'nearestRailroad' }],
  'nearestRailroad-owned': [(g, p0) => { p0.position = 6; g.tiles[15].ownerId = g.players[1].id; g.lastDice = [3, 4]; }, { action: 'nearestRailroad' }],
  'nearestUtility': [(g, p0) => { p0.position = 6; g.lastDice = [3, 4]; }, { action: 'nearestUtility' }],
  'nearestUtility-owned': [(g, p0) => { p0.position = 6; g.tiles[12].ownerId = g.players[1].id; g.lastDice = [3, 4]; }, { action: 'nearestUtility' }],
  'repairs': [(g, p0) => { p0.properties = [1, 3, 6]; g.tiles[1].houseCount = 2; g.tiles[3].houseCount = 5; g.tiles[6].houseCount = 1; }, { action: 'repairs', houseCost: 50, hotelCost: 100 }],
  'repairs-zero': [() => {}, { action: 'repairs', houseCost: 50, hotelCost: 100 }],
  'payEach': [() => {}, { action: 'payEach', amount: 20 }],
  'collectFromEach': [() => {}, { action: 'collectFromEach', amount: 15 }],
  'move-jail-tile': [() => {}, { action: 'move', tileIndex: 10 }],
  'move-vacation': [(g, p0) => { g.settings.vacationRules = true; }, { action: 'move', tileIndex: 20 }],
  'move-missing': [() => {}, { action: 'move', tileIndex: 999 }],
  'goToJail': [(g, p0) => { p0.position = 22; }, { action: 'goToJail' }],
  'unknown-action': [() => {}, { action: 'mystery' }]
};

let passed = 0;
const failures = [];
for (const [name, [setup, card]] of Object.entries(CASES)) {
  try {
    assert.deepStrictEqual(runCase(setup, card), GOLDEN[name], name);
    passed += 1;
    console.log(`PASS — applyCard ${name}`);
  } catch (error) {
    failures.push(name);
    console.log(`FAIL — applyCard ${name}: ${error.message}`);
  }
}
console.log(`applyCard tests: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exitCode = 1;

// Regression: a movement card to an owned utility can be resolved before a
// normal roll has populated lastDice. The utility contract still uses the
// Monopoly minimum dice total (2), never a zero-dollar rent calculation.
try {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 's-pre-roll-a', clientId: 'c-pre-roll-a', nickname: 'Ada' });
  room.addOrReconnectPlayer({ socketId: 's-pre-roll-b', clientId: 'c-pre-roll-b', nickname: 'Bob' });
  const game = room.game;
  game.started = true;
  game.currentPlayerId = game.players[0].id;
  game.hasRolled = true;
  game.players.forEach((player) => { player.cash = 1000; });
  game.players[0].position = 6;
  game.tiles[12].ownerId = game.players[1].id;
  game.lastDice = [0, 0];
  const result = game.applyCard(game.players[0], { action: 'nearestUtility', multiplier: 10 }, {});
  assert.deepEqual({ result, payer: game.players[0].cash, owner: game.players[1].cash }, {
    result: { success: true }, payer: 980, owner: 1020
  });
  console.log('PASS — applyCard nearestUtility-pre-roll uses minimum dice total');
} catch (error) {
  console.log(`FAIL — applyCard nearestUtility-pre-roll: ${error.message}`);
  process.exitCode = 1;
}

try {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 's-energy-a', clientId: 'c-energy-a', nickname: 'Ada' });
  room.addOrReconnectPlayer({ socketId: 's-energy-b', clientId: 'c-energy-b', nickname: 'Bob' });
  const game = room.game;
  const payer = game.players[0];
  const owner = game.players[1];
  payer.position = 6;
  payer.cash = 1000;
  owner.cash = 1000;
  game.tiles[12].ownerId = owner.id;
  game.lastDice = [3, 4];
  game.globalEvent = { id: 'energy-crisis', phase: 'active', effects: { utilityRentMultiplier: 1.5 } };
  game.applyCard(payer, { action: 'nearestUtility', multiplier: 10 }, {});
  assert.equal(payer.cash, 895);
  assert.equal(owner.cash, 1105);
  console.log('PASS — applyCard utility rent honors active event modifiers');
} catch (error) {
  console.log(`FAIL — applyCard utility event modifier: ${error.message}`);
  process.exitCode = 1;
}

// F-015: the rent cap limits the single amount a card charges, so "pay double"
// to an airport never exceeds a $30 cap (double of a capped $25 would be $50).
// Utility cards already capped after their multiplier; both must agree.
try {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 's-cap-rr-a', clientId: 'c-cap-rr-a', nickname: 'Ada' });
  room.addOrReconnectPlayer({ socketId: 's-cap-rr-b', clientId: 'c-cap-rr-b', nickname: 'Bob' });
  const game = room.game;
  const payer = game.players[0];
  const owner = game.players[1];
  payer.position = 6;
  payer.cash = 1000;
  owner.cash = 1000;
  game.tiles[15].ownerId = owner.id;
  game.lastDice = [3, 4];
  game.globalEvent = { id: 'custom', phase: 'active', effects: { rentCap: 30 } };
  game.applyCard(payer, { action: 'nearestRailroad', multiplier: 2 }, {});
  assert.equal(payer.cash, 970);
  assert.equal(owner.cash, 1030);
  console.log('PASS — applyCard railroad double rent honors the rent cap');
} catch (error) {
  console.log(`FAIL — applyCard railroad double rent cap: ${error.message}`);
  process.exitCode = 1;
}

try {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 's-cap-ut-a', clientId: 'c-cap-ut-a', nickname: 'Ada' });
  room.addOrReconnectPlayer({ socketId: 's-cap-ut-b', clientId: 'c-cap-ut-b', nickname: 'Bob' });
  const game = room.game;
  const payer = game.players[0];
  const owner = game.players[1];
  payer.position = 6;
  payer.cash = 1000;
  owner.cash = 1000;
  game.tiles[12].ownerId = owner.id;
  game.lastDice = [3, 4];
  game.globalEvent = { id: 'custom', phase: 'active', effects: { rentCap: 30 } };
  game.applyCard(payer, { action: 'nearestUtility', multiplier: 10 }, {});
  assert.equal(payer.cash, 970);
  assert.equal(owner.cash, 1030);
  console.log('PASS — applyCard utility rent honors the rent cap');
} catch (error) {
  console.log(`FAIL — applyCard utility rent cap: ${error.message}`);
  process.exitCode = 1;
}

try {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 's-pay-a', clientId: 'c-pay-a', nickname: 'Ada' });
  room.addOrReconnectPlayer({ socketId: 's-pay-b', clientId: 'c-pay-b', nickname: 'Bob' });
  const game = room.game;
  const player = game.players[0];
  player.cash = 20;
  const before = player.cash;
  game.applyCard(player, { action: 'pay', amount: 50 }, {});
  assert.equal(game.pendingPayment.amountRemaining, 30);
  assert.equal(game.cardCashAfterPlay(player, { action: 'pay', amount: 50 }, before, player.position), -20);
  console.log('PASS — applyCard pay reveal reports actual partial payment');
} catch (error) {
  console.log(`FAIL — applyCard pay reveal: ${error.message}`);
  process.exitCode = 1;
}

try {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 's-pay-each-a', clientId: 'c-pay-each-a', nickname: 'Ada' });
  room.addOrReconnectPlayer({ socketId: 's-pay-each-b', clientId: 'c-pay-each-b', nickname: 'Bob' });
  room.addOrReconnectPlayer({ socketId: 's-pay-each-c', clientId: 'c-pay-each-c', nickname: 'Cara' });
  room.addOrReconnectPlayer({ socketId: 's-pay-each-d', clientId: 'c-pay-each-d', nickname: 'Dee' });
  const game = room.game;
  const payer = game.players[0];
  payer.cash = 10;
  game.players.slice(1).forEach(player => { player.cash = 1000; });
  game.started = true;
  game.currentPlayerId = payer.id;
  game.hasRolled = true;
  game.applyCard(payer, { action: 'payEach', amount: 50 }, {});
  assert.equal(payer.cash, 0);
  assert.equal(game.players[1].cash, 1010);
  assert.equal(game.players[2].cash, 1000);
  assert.equal(game.players[3].cash, 1000);
  assert.deepEqual(game.pendingPayment, {
    playerId: payer.id,
    creditorId: game.players[1].id,
    amountRemaining: 40,
    reason: `${payer.nickname} paid $50 to other players from the card.`,
    equityTileIndex: null,
    equityOwnerId: null
  });
  assert.deepEqual(game.pendingPaymentQueue.map(entry => ({
    creditorId: entry.payment.creditorId,
    amountRemaining: entry.payment.amountRemaining
  })), [
    { creditorId: game.players[2].id, amountRemaining: 50 },
    { creditorId: game.players[3].id, amountRemaining: 50 }
  ]);
  console.log('PASS — applyCard payEach parks every unpaid recipient leg');
} catch (error) {
  console.log(`FAIL — applyCard payEach shortfall: ${error.message}`);
  process.exitCode = 1;
}

try {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 's-collect-a', clientId: 'c-collect-a', nickname: 'Ada' });
  room.addOrReconnectPlayer({ socketId: 's-collect-b', clientId: 'c-collect-b', nickname: 'Bob' });
  const player = room.game.players[0];
  player.cash = 100;
  const game = room.game;
  game.applyCard(player, { action: 'collect' }, {});
  assert.equal(player.cash, 300);
  assert.equal(game.cardCashAfterPlay(player, { action: 'collect' }, 100, player.position), 200);
  console.log('PASS — applyCard collect reveal matches default payout');
} catch (error) {
  console.log(`FAIL — applyCard collect default: ${error.message}`);
  process.exitCode = 1;
}

try {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 's-move-a', clientId: 'c-move-a', nickname: 'Ada' });
  room.addOrReconnectPlayer({ socketId: 's-move-b', clientId: 'c-move-b', nickname: 'Bob' });
  const game = room.game;
  const payer = game.players[0];
  const owner = game.players[1];
  payer.position = 20;
  payer.cash = 1000;
  owner.cash = 1000;
  game.tiles[3].ownerId = owner.id;
  const before = payer.cash;
  game.applyCard(payer, { action: 'moveTo', tileIndex: 3 }, {});
  assert.equal(game.cardCashAfterPlay(payer, { action: 'moveTo', tileIndex: 3 }, before), 190);
  console.log('PASS — applyCard movement reveal includes salary and rent');
} catch (error) {
  console.log(`FAIL — applyCard movement reveal: ${error.message}`);
  process.exitCode = 1;
}

// S03-6: nearest-airport/utility card rent is a landing, so it records the same
// facts a dice landing does (airport visit stat, airport-strike rent flags).
try {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 's-fact-a', clientId: 'c-fact-a', nickname: 'Ada' });
  room.addOrReconnectPlayer({ socketId: 's-fact-b', clientId: 'c-fact-b', nickname: 'Bob' });
  const game = room.game;
  const payer = game.players[0];
  const owner = game.players[1];
  payer.position = 6;
  payer.cash = 1000;
  game.tiles[15].ownerId = owner.id;
  game.lastDice = [3, 4];
  game.applyCard(payer, { action: 'nearestRailroad', multiplier: 2 }, {});
  assert.equal(payer.cash < 1000, true, 'rent was charged');
  assert.deepEqual([...payer.airportVisits], [15]);

  const strikeManager = new RoomManager();
  const strikeRoom = strikeManager.createRoom({ socketId: 's-fact-c', clientId: 'c-fact-c', nickname: 'Cy' });
  strikeRoom.addOrReconnectPlayer({ socketId: 's-fact-d', clientId: 'c-fact-d', nickname: 'Di' });
  const strikeGame = strikeRoom.game;
  const strikePayer = strikeGame.players[0];
  const strikeOwner = strikeGame.players[1];
  strikePayer.position = 6;
  strikePayer.cash = 1000;
  strikeGame.tiles[12].ownerId = strikeOwner.id;
  strikeOwner.properties.push(12);
  strikeGame.lastDice = [3, 4];
  strikeGame.globalEvent = { id: 'airport-strike', phase: 'active', effects: {} };
  strikeGame.applyCard(strikePayer, { action: 'nearestUtility', multiplier: 10 }, {});
  assert.equal(strikePayer.cash < 1000, true, 'utility rent was charged');
  assert.equal(strikeOwner.nonAirportRentDuringStrike, true);
  console.log('PASS — applyCard card rent records landing facts');
} catch (error) {
  console.log(`FAIL — applyCard card rent landing facts: ${error.message}`);
  process.exitCode = 1;
}

// K2: the low-tax election cuts every card reward, including the per-player
// collection of a collect-from-each card.
try {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 's-k2-a', clientId: 'c-k2-a', nickname: 'Ada' });
  room.addOrReconnectPlayer({ socketId: 's-k2-b', clientId: 'c-k2-b', nickname: 'Bob' });
  const game = room.game;
  game.started = true;
  game.currentPlayerId = game.players[0].id;
  game.hasRolled = true;
  game.players.forEach(player => { player.cash = 1000; });
  game.globalEvent = { id: 'city-election', phase: 'active', resolvedChoice: 'low-tax' };
  game.applyCard(game.players[0], { action: 'collectFromEach', amount: 50 }, {});
  assert.equal(game.players[0].cash, 1040);
  assert.equal(game.players[1].cash, 960);
  console.log('PASS — applyCard collectFromEach honors the low-tax discount');
} catch (error) {
  console.log(`FAIL — applyCard collectFromEach low tax: ${error.message}`);
  process.exitCode = 1;
}

// K3: a card transfer that empties the payer's wallet must record the
// zero-cash achievement flag, exactly like the debt paths do.
try {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 's-k3-a', clientId: 'c-k3-a', nickname: 'Ada' });
  room.addOrReconnectPlayer({ socketId: 's-k3-b', clientId: 'c-k3-b', nickname: 'Bob' });
  const game = room.game;
  game.started = true;
  game.currentPlayerId = game.players[0].id;
  game.hasRolled = true;
  const payer = game.players[0];
  const other = game.players[1];
  payer.cash = 20;
  other.cash = 1000;
  game.applyCard(payer, { action: 'payEach', amount: 20 }, {});
  assert.equal(payer.cash, 0);
  assert.equal(payer.zeroCashReached, true);
  console.log('PASS — applyCard payEach records the payer reaching zero cash');
} catch (error) {
  console.log(`FAIL — applyCard payEach zero cash: ${error.message}`);
  process.exitCode = 1;
}

try {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 's-k3-c', clientId: 'c-k3-c', nickname: 'Ada' });
  room.addOrReconnectPlayer({ socketId: 's-k3-d', clientId: 'c-k3-d', nickname: 'Bob' });
  const game = room.game;
  game.started = true;
  game.currentPlayerId = game.players[0].id;
  game.hasRolled = true;
  const collector = game.players[0];
  const payer = game.players[1];
  collector.cash = 1000;
  payer.cash = 15;
  game.applyCard(collector, { action: 'collectFromEach', amount: 15 }, {});
  assert.equal(payer.cash, 0);
  assert.equal(payer.zeroCashReached, true);
  console.log('PASS — applyCard collectFromEach records the payer reaching zero cash');
} catch (error) {
  console.log(`FAIL — applyCard collectFromEach zero cash: ${error.message}`);
  process.exitCode = 1;
}

// K4: cash arriving from a pay-each card must immediately settle a parked debt
// held by the recipient, matching the property/loan/trade rescue rule.
try {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 's-k4-a', clientId: 'c-k4-a', nickname: 'Ada' });
  room.addOrReconnectPlayer({ socketId: 's-k4-b', clientId: 'c-k4-b', nickname: 'Bob' });
  room.addOrReconnectPlayer({ socketId: 's-k4-c', clientId: 'c-k4-c', nickname: 'Cara' });
  const game = room.game;
  game.started = true;
  game.currentPlayerId = game.players[0].id;
  game.hasRolled = true;
  const [payer, debtor, creditor] = game.players;
  payer.cash = 100;
  debtor.cash = 0;
  creditor.cash = 1000;
  game.pendingPayment = {
    playerId: debtor.id,
    creditorId: creditor.id,
    amountRemaining: 20,
    reason: 'parked rent',
    equityTileIndex: null,
    equityOwnerId: null
  };
  game.applyCard(payer, { action: 'payEach', amount: 20 }, {});
  // The card pays BOTH opponents $20, so the payer keeps 100 - 40 = 60. The
  // debtor's share is handed straight to the parked creditor by the
  // settlement, which is why the creditor ends up with 1000 + 20 + 20.
  assert.equal(payer.cash, 60);
  assert.equal(debtor.cash, 0);
  assert.equal(creditor.cash, 1040);
  assert.equal(game.pendingPayment, null);
  console.log('PASS — applyCard payEach settles a recipient parked debt');
} catch (error) {
  console.log(`FAIL — applyCard payEach recipient debt: ${error.message}`);
  process.exitCode = 1;
}
