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
