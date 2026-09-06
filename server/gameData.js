// Static board data and the pure helpers that only reshape it. Every value
// here is the verbatim table that used to live at the top of gameLogic.js;
// server/gameLogic.test.js and the room suites pin the tile and deck texts.
import { randomInt } from './random.js';

const PROPERTY_HOUSE_COST_BY_GROUP = {
  Brown: 50,
  'Light Blue': 50,
  Pink: 100,
  Orange: 100,
  Magenta: 100,
  Red: 150,
  Yellow: 150,
  Green: 200,
  'Dark Blue': 200
};
const PROPERTY_RENT_MULTIPLIERS = [1, 5, 15, 45, 80, 125];
const RAILROAD_RENT = [25, 50, 100, 200];
const JAIL_FINE = 50;
const JAIL_MAX_TURNS = 3;
const START_TILE_INDEX = 0;

const DEFAULT_TILES = [
  { index: 0, name: 'Start', type: 'start' },
  { index: 1, name: 'Salvador', type: 'property', group: 'Brown', price: 60, rent: 10, color: '#7b5029' },
  { index: 2, name: 'Treasure', type: 'chest' },
  { index: 3, name: 'Rio', type: 'property', group: 'Brown', price: 60, rent: 10, color: '#7b5029' },
  { index: 4, name: 'Earnings Tax', type: 'tax', amount: 200 },
  { index: 5, name: 'ACC Airport', type: 'railroad', price: 200, rent: 25 },
  { index: 6, name: 'Accra', type: 'property', group: 'Light Blue', price: 100, rent: 14, color: '#3e7d7b' },
  { index: 7, name: 'Surprise?', type: 'chance' },
  { index: 8, name: 'Tema', type: 'property', group: 'Light Blue', price: 100, rent: 14, color: '#3e7d7b' },
  { index: 9, name: 'Kumasi', type: 'property', group: 'Light Blue', price: 120, rent: 16, color: '#3e7d7b' },
  { index: 10, name: 'Passing By', type: 'jail' },
  { index: 11, name: 'Pattaya', type: 'property', group: 'Pink', price: 140, rent: 10, color: '#a04e6f' },
  { index: 12, name: 'Electric Company', type: 'utility', price: 150, rent: 12 },
  { index: 13, name: 'Chiang Mai', type: 'property', group: 'Pink', price: 140, rent: 12, color: '#a04e6f' },
  { index: 14, name: 'Bangkok', type: 'property', group: 'Pink', price: 160, rent: 14, color: '#a04e6f' },
  { index: 15, name: 'BKK Airport', type: 'railroad', price: 200, rent: 25 },
  { index: 16, name: 'Kyoto', type: 'property', group: 'Orange', price: 180, rent: 14, color: '#b96d2a' },
  { index: 17, name: 'Treasure', type: 'chest' },
  { index: 18, name: 'Osaka', type: 'property', group: 'Orange', price: 180, rent: 14, color: '#b96d2a' },
  { index: 19, name: 'Tokyo', type: 'property', group: 'Orange', price: 200, rent: 16, color: '#b96d2a' },
  { index: 20, name: 'Vacation', type: 'vacation' },
  { index: 21, name: 'Eindhoven', type: 'property', group: 'Red', price: 220, rent: 18, color: '#87231e' },
  { index: 22, name: 'Surprise?', type: 'chance' },
  { index: 23, name: 'Rotterdam', type: 'property', group: 'Red', price: 220, rent: 18, color: '#87231e' },
  { index: 24, name: 'Amsterdam', type: 'property', group: 'Red', price: 240, rent: 20, color: '#87231e' },
  { index: 25, name: 'AMS Airport', type: 'railroad', price: 200, rent: 25 },
  { index: 26, name: 'Calgary', type: 'property', group: 'Yellow', price: 260, rent: 22, color: '#b18a2e' },
  { index: 27, name: 'Vancouver', type: 'property', group: 'Yellow', price: 260, rent: 22, color: '#b18a2e' },
  { index: 28, name: 'Water Company', type: 'utility', price: 150, rent: 12 },
  { index: 29, name: 'Toronto', type: 'property', group: 'Yellow', price: 280, rent: 24, color: '#b18a2e' },
  { index: 30, name: 'Go to Prison', type: 'goToJail' },
  { index: 31, name: 'Bern', type: 'property', group: 'Green', price: 300, rent: 26, color: '#4b853d' },
  { index: 32, name: 'Geneva', type: 'property', group: 'Green', price: 300, rent: 26, color: '#4b853d' },
  { index: 33, name: 'Treasure', type: 'chest' },
  { index: 34, name: 'Zurich', type: 'property', group: 'Green', price: 320, rent: 28, color: '#4b853d' },
  { index: 35, name: 'MB Airport', type: 'railroad', price: 200, rent: 25 },
  { index: 36, name: 'Surprise?', type: 'chance' },
  { index: 37, name: 'Downtown', type: 'property', group: 'Dark Blue', price: 400, rent: 35, color: '#286ea1' },
  { index: 38, name: 'Premium Tax', type: 'tax', amount: 75 },
  { index: 39, name: 'Marina Bay', type: 'property', group: 'Dark Blue', price: 400, rent: 50, color: '#286ea1' }
];

const SURPRISE_DECK = [
  { text: 'Advance to Marina Bay', action: 'moveTo', tileIndex: 39 },
  { text: 'Advance to Start and collect $200', action: 'collectStart', amount: 200 },
  { text: 'Advance to Amsterdam', action: 'moveTo', tileIndex: 24 },
  { text: 'Advance to Pattaya', action: 'moveTo', tileIndex: 11 },
  { text: 'Advance to the next Airport and pay double rent if owned', action: 'nearestRailroad', multiplier: 2 },
  { text: 'Advance to the next Airport and pay double rent if owned', action: 'nearestRailroad', multiplier: 2 },
  { text: 'Advance to the next Utility and pay ten times the dice roll if owned', action: 'nearestUtility', multiplier: 10 },
  { text: 'Bank dividend — collect $50', action: 'collect', amount: 50 },
  { text: 'Keep this card until needed: Get Out of Prison', action: 'jailFree' },
  { text: 'Move back three spaces', action: 'moveBack', steps: 3 },
  { text: 'Go directly to Prison', action: 'goToJail' },
  { text: 'Building repairs — pay $25 per house and $100 per hotel', action: 'repairs', houseCost: 25, hotelCost: 100 },
  { text: 'Speeding fine — pay $15', action: 'pay', amount: 15 },
  { text: 'Advance to ACC Airport', action: 'moveTo', tileIndex: 5 },
  { text: 'Elected chairperson — pay each player $50', action: 'payEach', amount: 50 },
  { text: 'Building loan matures — collect $150', action: 'collect', amount: 150 }
];

const TREASURE_DECK = [
  { text: 'Advance to Start and collect $200', action: 'collectStart', amount: 200 },
  { text: 'Bank error — collect $200', action: 'collect', amount: 200 },
  { text: "Doctor's fee — pay $50", action: 'pay', amount: 50 },
  { text: 'Investment sale — collect $50', action: 'collect', amount: 50 },
  { text: 'Keep this card until needed: Get Out of Prison', action: 'jailFree' },
  { text: 'Go directly to Prison', action: 'goToJail' },
  { text: 'Parlor show — collect $50 from each player', action: 'collectFromEach', amount: 50 },
  { text: 'Tax refund — collect $20', action: 'collect', amount: 20 },
  { text: 'Insurance matures — collect $100', action: 'collect', amount: 100 },
  { text: 'Hospital fee — pay $100', action: 'pay', amount: 100 },
  { text: 'School tax — pay $150', action: 'pay', amount: 150 },
  { text: 'Consulting fee — collect $25', action: 'collect', amount: 25 },
  { text: 'Street repairs — pay $40 per house and $115 per hotel', action: 'repairs', houseCost: 40, hotelCost: 115 },
  { text: 'Holiday fund matures — collect $100', action: 'collect', amount: 100 },
  { text: 'Beauty contest — collect $10', action: 'collect', amount: 10 },
  { text: 'Inheritance — collect $100', action: 'collect', amount: 100 }
];

function rollDice() {
  return [randomInt(1, 6), randomInt(1, 6)];
}

function shuffleArray(array) {
  for (let i = array.length - 1; i > 0; i -= 1) {
    const j = randomInt(0, i);
    [array[i], array[j]] = [array[j], array[i]];
  }
  return array;
}

function cloneTiles() {
  return DEFAULT_TILES.map(tile => ({ ...tile, ownerId: null, mortgaged: false, houseCount: 0, equityShares: [] }));
}

export {
  DEFAULT_TILES,
  JAIL_FINE,
  JAIL_MAX_TURNS,
  PROPERTY_HOUSE_COST_BY_GROUP,
  PROPERTY_RENT_MULTIPLIERS,
  RAILROAD_RENT,
  START_TILE_INDEX,
  SURPRISE_DECK,
  TREASURE_DECK,
  cloneTiles,
  rollDice,
  shuffleArray
};
