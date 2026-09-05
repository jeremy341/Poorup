// Characterization suite for GameState.getPropertyRent — the rent ladder with
// its stack of global-event modifiers. Each case pins the exact integer rent
// for a crafted tile/ownership/event context: mortgage, every house level
// (incl. clamping), double-rent full sets, utility dice scaling, railroad
// tiers, and every event modifier + effect-multiplier skip rule (housing
// bubble, airport strike, tourism boom, anti-monopoly, energy crisis, public
// works, global rent multiplier, rent cap). Captured from the pre-refactor
// method; the modifier-table extraction must keep it green.
import { RoomManager } from './gameLogic.js';

const GOLDEN = {"mortgaged":0,"property-plain":10,"property-h1":50,"property-h2":150,"property-h3":450,"property-h4":800,"property-h5-hotel":1250,"property-clamped-level":1250,"double-rent-full-group":20,"double-rent-off":10,"double-rent-partial-group":10,"utility-one-owned":28,"utility-both-owned":70,"utility-no-dice":8,"utility-unowned":12,"utility-unowned-zero-rent":20,"railroad-1":25,"railroad-2":50,"railroad-3":100,"railroad-4":200,"railroad-unowned":25,"bubble-property":32,"bubble-excludes-global-multiplier":32,"strike-railroad-zero":0,"strike-skips-airport-multiplier":0,"airport-multiplier":75,"tourism-railroad":43,"tourism-dark-blue":45,"tourism-skips-premium-multiplier":45,"premium-multiplier":70,"anti-monopoly-target":6,"anti-monopoly-dismissed":10,"anti-monopoly-non-target":10,"energy-crisis-utility":42,"energy-crisis-skips-utility-multiplier":42,"utility-multiplier":56,"election-public-works-property":7,"global-rent-multiplier":20,"global-rent-multiplier-zero-skips":10,"global-rent-multiplier-nan-skips":10,"cap-applies":30,"cap-zero-skips":25,"start-tile":0};

const own = (game, index, owner = 0) => { game.tiles[index].ownerId = game.players[owner].id; };
const event = (game, id, extra = {}) => { game.globalEvent = { id, phase: 'active', ...extra }; };

const CASES = {
  'mortgaged': [(g, t) => { own(g, 1); t.mortgaged = true; }, 1],
  'property-plain': [(g) => own(g, 1), 1],
  'property-h1': [(g, t) => { own(g, 1); t.houseCount = 1; }, 1],
  'property-h2': [(g, t) => { own(g, 1); t.houseCount = 2; }, 1],
  'property-h3': [(g, t) => { own(g, 1); t.houseCount = 3; }, 1],
  'property-h4': [(g, t) => { own(g, 1); t.houseCount = 4; }, 1],
  'property-h5-hotel': [(g, t) => { own(g, 1); t.houseCount = 5; }, 1],
  'property-clamped-level': [(g, t) => { own(g, 1); t.houseCount = 9; }, 1],
  'double-rent-full-group': [(g) => { own(g, 1); own(g, 3); g.settings.doubleRent = true; }, 1],
  'double-rent-off': [(g) => { own(g, 1); own(g, 3); g.settings.doubleRent = false; }, 1],
  'double-rent-partial-group': [(g) => { own(g, 1); g.settings.doubleRent = true; }, 1],
  'utility-one-owned': [(g) => { own(g, 12); g.lastDice = [3, 4]; }, 12],
  'utility-both-owned': [(g) => { own(g, 12); own(g, 28); g.lastDice = [3, 4]; }, 12],
  'utility-no-dice': [(g) => { own(g, 12); g.lastDice = [0, 0]; }, 12],
  'utility-unowned': [() => {}, 12],
  'utility-unowned-zero-rent': [(g) => { g.tiles[28].rent = 0; }, 28],
  'railroad-1': [(g) => own(g, 5), 5],
  'railroad-2': [(g) => { own(g, 5); own(g, 15); }, 5],
  'railroad-3': [(g) => { own(g, 5); own(g, 15); own(g, 25); }, 5],
  'railroad-4': [(g) => { own(g, 5); own(g, 15); own(g, 25); own(g, 35); }, 5],
  'railroad-unowned': [() => {}, 5],
  'bubble-property': [(g, t) => { own(g, 1); t.houseCount = 1; event(g, 'housing-bubble'); }, 1],
  'bubble-excludes-global-multiplier': [(g, t) => { own(g, 1); t.houseCount = 1; event(g, 'housing-bubble', { effects: { rentMultiplier: 2 } }); }, 1],
  'strike-railroad-zero': [(g) => { own(g, 5); event(g, 'airport-strike'); }, 5],
  'strike-skips-airport-multiplier': [(g) => { own(g, 5); event(g, 'airport-strike', { effects: { airportRentMultiplier: 3 } }); }, 5],
  'airport-multiplier': [(g) => { own(g, 5); event(g, 'custom', { effects: { airportRentMultiplier: 3 } }); }, 5],
  'tourism-railroad': [(g) => { own(g, 5); event(g, 'tourism-boom'); }, 5],
  'tourism-dark-blue': [(g) => { own(g, 37); event(g, 'tourism-boom'); }, 37],
  'tourism-skips-premium-multiplier': [(g) => { own(g, 37); event(g, 'tourism-boom', { effects: { premiumRentMultiplier: 2 } }); }, 37],
  'premium-multiplier': [(g) => { own(g, 37); event(g, 'custom', { effects: { premiumRentMultiplier: 2 } }); }, 37],
  'anti-monopoly-target': [(g) => { own(g, 1); event(g, 'anti-monopoly', { targetPlayerId: g.players[0].id }); }, 1],
  'anti-monopoly-dismissed': [(g) => { own(g, 1); event(g, 'anti-monopoly', { targetPlayerId: g.players[0].id, resolvedChoice: 'dismiss' }); }, 1],
  'anti-monopoly-non-target': [(g) => { own(g, 1); event(g, 'anti-monopoly', { targetPlayerId: 'someone-else' }); }, 1],
  'energy-crisis-utility': [(g) => { own(g, 12); g.lastDice = [3, 4]; event(g, 'energy-crisis'); }, 12],
  'energy-crisis-skips-utility-multiplier': [(g) => { own(g, 12); g.lastDice = [3, 4]; event(g, 'energy-crisis', { effects: { utilityRentMultiplier: 2 } }); }, 12],
  'utility-multiplier': [(g) => { own(g, 12); g.lastDice = [3, 4]; event(g, 'custom', { effects: { utilityRentMultiplier: 2 } }); }, 12],
  'election-public-works-property': [(g) => { own(g, 1); event(g, 'city-election', { resolvedChoice: 'public-works' }); }, 1],
  'global-rent-multiplier': [(g) => { own(g, 1); event(g, 'custom', { effects: { rentMultiplier: 2 } }); }, 1],
  'global-rent-multiplier-zero-skips': [(g) => { own(g, 1); event(g, 'custom', { effects: { rentMultiplier: 0 } }); }, 1],
  'global-rent-multiplier-nan-skips': [(g) => { own(g, 1); event(g, 'custom', { effects: { rentMultiplier: 'x' } }); }, 1],
  'cap-applies': [(g) => { own(g, 5); own(g, 15); event(g, 'custom', { effects: { rentCap: 30 } }); }, 5],
  'cap-zero-skips': [(g) => { own(g, 5); event(g, 'custom', { effects: { rentCap: 0 } }); }, 5],
  'start-tile': [(g) => { own(g, 1); event(g, 'custom', { effects: { rentMultiplier: 2 } }); }, 0]
};

function newGame() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 's-a', clientId: 'c-a', nickname: 'Ada' });
  room.addOrReconnectPlayer({ socketId: 's-b', clientId: 'c-b', nickname: 'Bob' });
  return room.game;
}

let passed = 0;
const failures = [];
for (const [name, [setup, index]] of Object.entries(CASES)) {
  const game = newGame();
  const tile = game.tiles[index];
  setup(game, tile);
  const actual = game.getPropertyRent(tile);
  if (actual === GOLDEN[name]) {
    passed += 1;
    console.log(`PASS — rent ${name} = ${actual}`);
  } else {
    failures.push(name);
    console.log(`FAIL — rent ${name}: expected ${GOLDEN[name]}, got ${actual}`);
  }
}
console.log(`rent tests: ${passed} passed, ${failures.length} failed`);
if (failures.length) process.exitCode = 1;
