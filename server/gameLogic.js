import crypto from 'crypto';

const DEFAULT_ROOM_SETTINGS = {
  maxPlayers: 4,
  doubleRent: false,
  vacationCash: true,
  auction: true,
  trading: true,
  doubleGo: false,
  noRentWhileInPrison: false,
  mortgage: true,
  evenBuild: true,
  randomizePlayerOrder: false,
  houseLimit: 32,
  hotelLimit: 12,
  turnTimer: 0,
  bankruptMode: 'elim',
  bots: 0,
  botPersonality: 'survivor',
  startingCash: 1500,
  bankLoans: true,
  bankLoanSeverity: 'predatory',
  // Global headlines are intentionally a single on/off rule. Rarity,
  // severity, duration, and combinations are derived from the game clock.
  globalEvents: false,
  casino: false,
  market: false,
  // Kept for backwards-compatible snapshots only; client values are ignored.
  globalEventDuration: 5,
  globalEventMax: 1
};

// Room settings: a raw client value passes through its key's normalizer
// before being stored on both the room and its game. A normalizer returns
// SETTING_REJECTED to leave the stored value untouched — the old early
// `return`s. Keys with no entry keep the generic rule: a setting that is
// currently boolean parses the four truthy spellings, a string is trimmed,
// and anything else is stored as received.
const SETTING_REJECTED = Symbol('setting-rejected');
const ROOM_FLAG_TRUE_VALUES = [true, 'true', 1, '1'];
// Rarity spellings are accepted for globalEvents only; every other boolean
// key uses ROOM_FLAG_TRUE_VALUES.
const GLOBAL_EVENT_ON_VALUES = [true, 'true', 'on', 'rare', 'hardcore', 1, '1'];
const ROOM_BOT_PERSONALITIES = ['builder', 'shark', 'survivor', 'speculator', 'diplomat', 'chaos'];
// Legacy clients may still send these fields; the server owns scaling now.
const LEGACY_SCALED_SETTINGS = ['globalEventDuration', 'globalEventMax'];

function toFiniteSettingNumber(value) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : SETTING_REJECTED;
}

function clampSetting(value, min, max) {
  const parsed = toFiniteSettingNumber(value);
  if (parsed === SETTING_REJECTED) return SETTING_REJECTED;
  return Math.max(min, Math.min(max, Math.floor(parsed)));
}

function floorSettingAtZero(value) {
  const parsed = toFiniteSettingNumber(value);
  if (parsed === SETTING_REJECTED) return SETTING_REJECTED;
  return Math.max(0, Math.floor(parsed));
}

// The legacy duration/max knobs snap to the two-step ladder the old client
// UI expected. Unreachable while the legacy guard above stands, kept so the
// clamps live with the rest of the table.
function snapFlooredSetting(value, threshold, atOrAbove, below) {
  const floored = floorSettingAtZero(value);
  if (floored === SETTING_REJECTED) return SETTING_REJECTED;
  return floored >= threshold ? atOrAbove : below;
}

function normalizeBotPersonality(value) {
  const lowered = String(value).toLowerCase();
  return ROOM_BOT_PERSONALITIES.includes(lowered) ? lowered : 'survivor';
}

const ROOM_SETTING_NORMALIZERS = {
  maxPlayers: value => clampSetting(value, 2, 4),
  // Bots are clamped against the live maxPlayers so seat math stays coherent.
  bots: (value, room) => clampSetting(value, 0, room.settings.maxPlayers - 1),
  startingCash: floorSettingAtZero,
  houseLimit: floorSettingAtZero,
  hotelLimit: floorSettingAtZero,
  turnTimer: floorSettingAtZero,
  globalEventDuration: value => snapFlooredSetting(value, 10, 10, 5),
  globalEventMax: value => snapFlooredSetting(value, 2, 2, 1),
  globalEvents: value => GLOBAL_EVENT_ON_VALUES.includes(value),
  botPersonality: normalizeBotPersonality
};

const AUCTION_DURATION_MS = 5000;
const AUCTION_BID_COOLDOWN_MS = 300;
const CASINO_MAX_BET = 500;
const CASINO_BET_COLORS = ['red', 'black', 'green'];
// Loan states that keep borrowed cash pinned: the bank loan and the active
// side of a player contract share this exact status pair.
const LOAN_OUTSTANDING_STATUSES = ['active', 'due'];
const MARKET_FEE_RATE = 0.02;
const ROULETTE_RED = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const MARKET_INSTRUMENTS = [
  ['brazil', 'BRAZIL', 100], ['ghana', 'GHANA', 100], ['thailand', 'THAILAND', 100],
  ['japan', 'JAPAN', 100], ['netherlands', 'NETHERLANDS', 100], ['canada', 'CANADA', 100],
  ['switzerland', 'SWITZERLAND', 100], ['singapore', 'SINGAPORE', 100],
  ['airports', 'AIRPORTS', 100], ['utilities', 'UTILITIES', 100], ['property', 'PROPERTY', 100]
].map(([id, name, price]) => ({ id, name, price }));

// Player-contract vocabularies and the market order gates, in the exact
// historical check order; server/contracts-market.test.js pins every string.
const CONTRACT_KINDS = new Set(['loan', 'equity']);
const EQUITY_CONTROL_MODES = new Set(['passive', 'shared', 'controlling']);
const MARKET_SIDES = ['buy', 'sell'];
const MARKET_ORDER_GUARDS = [
  { test: game => !game.settings.market, error: 'Market access is off for this room.' },
  { test: (game, player) => !game.started || !player || player.bankrupt || player.disconnected, error: 'Market access is unavailable right now.' },
  { test: (game, player) => player.id !== game.currentPlayerId, error: 'Market orders are available during your turn.' },
  { test: (game, player) => (player.marketActionsThisTurn || 0) >= 1, error: 'You have already placed a market order this turn.' },
  { test: game => game.pendingPayment || game.auction || game.pendingTrade || game.pendingPlayerContract, error: 'Resolve the table obligation before trading.' },
  { test: game => game.activeEventEffects().tradingEnabled === false, error: 'Market trading is paused by the active global event.' }
];
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
const GLOBAL_EVENT_COOLDOWN_ROUNDS = 3;
const GLOBAL_EVENT_MIN_ROUND = 3;
const BANK_LOAN_PRINCIPAL = 300;
const BANK_LOAN_TERM_ROUNDS = 3;

const GLOBAL_EVENT_DEFINITIONS = [
  {
    id: 'housing-bubble',
    title: 'HOUSING BUBBLE POP',
    category: 'ECONOMIC',
    summary: 'Property values are sliding. Construction is frozen while the market clears.',
    weight: 1,
    eligible: game => game.totalBuildings() >= 18,
    effects: { rentMultiplier: 0.65, constructionBlocked: true, buildingSaleMultiplier: 0.4, propertyValueMultiplier: 0.8, marketPriceMultiplier: 0.65, marketVolatility: 1.5, casinoMaxBet: 300 }
  },
  {
    id: 'credit-freeze',
    title: 'CREDIT FREEZE',
    category: 'ECONOMIC',
    summary: 'Lenders stop taking risk. New mortgages and bank loans are unavailable.',
    weight: 1,
    eligible: game => game.players.some(player => player.bankLoan?.status === 'active' || player.bankLoan?.status === 'due') || game.tiles.some(tile => tile.mortgaged),
    effects: { bankLoansBlocked: true, mortgagesBlocked: true, marketPriceMultiplier: 0.8, tradingEnabled: false, casinoMaxBet: 350 }
  },
  {
    id: 'inflation-spiral',
    title: 'INFLATION SPIRAL',
    category: 'ECONOMIC',
    summary: 'Cash is losing buying power. Taxes and construction cost more.',
    weight: 1,
    eligible: game => game.totalCash() >= game.settings.startingCash * Math.max(2, game.activePlayers().length) * 1.1,
    effects: { taxMultiplier: 1.4, buildingCostMultiplier: 1.35, loanPremiumMultiplier: 1.25, marketPriceMultiplier: 1.1, casinoEntryFee: 5 }
  },
  {
    id: 'city-election',
    title: 'CITY ELECTION',
    category: 'CIVIC',
    summary: 'The table chooses the next Poorup policy package.',
    weight: 1,
    eligible: () => true,
    choices: [
      { id: 'low-tax', label: 'LOW TAX PLATFORM', description: 'Taxes fall, but card rewards are reduced.' },
      { id: 'public-works', label: 'PUBLIC WORKS PLATFORM', description: 'Construction costs fall, but property rent is capped.' },
      { id: 'bank-first', label: 'BANK-FIRST PLATFORM', description: 'Loans are easier, but default penalties increase.' }
    ],
    effects: {}
  },
  {
    id: 'airport-strike',
    title: 'AIRPORT STRIKE',
    category: 'INFRASTRUCTURE',
    summary: 'Flights are grounded. Airport rent and airport card movement are disrupted.',
    weight: 1,
    eligible: game => game.tiles.some(tile => tile.type === 'railroad' && tile.ownerId),
    effects: { airportRentMultiplier: 0, airportCardsBlocked: true, marketPriceMultiplier: 0.85 }
  },
  {
    id: 'tourism-boom',
    title: 'TOURISM BOOM',
    category: 'INFRASTRUCTURE',
    summary: 'Visitors flood the city. Airports and premium districts surge.',
    weight: 1,
    eligible: () => true,
    effects: { airportRentMultiplier: 1.75, premiumRentMultiplier: 1.3, marketPriceMultiplier: 1.15 }
  },
  {
    id: 'anti-monopoly',
    title: 'ANTI-MONOPOLY INVESTIGATION',
    category: 'CIVIC',
    summary: 'The dominant portfolio is under review and its rent is temporarily capped.',
    weight: 1,
    eligible: game => game.players.some(player => game.playerGroups(player).length >= 2),
    choices: [
      { id: 'enforce', label: 'ENFORCE THE AUDIT', description: 'Cap the leader’s rent while the investigation runs.' },
      { id: 'dismiss', label: 'DISMISS THE AUDIT', description: 'End the inquiry now and keep the table moving.' }
    ],
    effects: { leaderRentMultiplier: 0.6, marketPriceMultiplier: 0.9 }
  },
  {
    id: 'interest-rate-shock',
    title: 'INTEREST RATE SHOCK',
    category: 'ECONOMIC',
    summary: 'Debt becomes heavier. Existing bank loans carry a disclosed premium.',
    weight: 1,
    eligible: game => game.players.filter(player => ['active', 'due'].includes(player.bankLoan?.status)).length >= 2,
    effects: { loanPremiumMultiplier: 1.35 }
  },
  {
    id: 'energy-crisis',
    title: 'ENERGY CRISIS',
    category: 'INFRASTRUCTURE',
    summary: 'Utilities are suddenly valuable while construction costs climb.',
    weight: 1,
    eligible: game => game.tiles.some(tile => tile.type === 'utility' && tile.ownerId),
    effects: { utilityRentMultiplier: 1.5, buildingCostMultiplier: 1.2, marketPriceMultiplier: 1.1 }
  },
  {
    id: 'rent-control',
    title: 'RENT CONTROL ORDINANCE',
    category: 'CIVIC',
    summary: 'The council caps the most concentrated rents and returns a small stipend.',
    weight: 1,
    eligible: game => game.players.some(player => game.playerGroups(player).length >= 1),
    effects: { rentCap: 80, rentControlStipend: 25 }
  },
  {
    id: 'public-works',
    title: 'PUBLIC WORKS BOOM',
    category: 'CIVIC',
    summary: 'A construction package opens a temporary path to development.',
    weight: 1,
    eligible: game => game.roundNumber >= 5 && game.totalBuildings() < 18,
    effects: { buildingCostMultiplier: 0.65, buildingLimitPerTurn: 1 }
  },
  {
    id: 'labor-strike',
    title: 'LABOR STRIKE',
    category: 'CIVIC',
    summary: 'Developed properties pay maintenance while the table negotiates.',
    weight: 1,
    eligible: game => game.totalBuildings() >= 8,
    effects: { buildingMaintenance: 20 }
  },
  {
    id: 'currency-devaluation',
    title: 'CURRENCY DEVALUATION',
    category: 'ECONOMIC',
    summary: 'Cash reserves lose a small, visible percentage overnight.',
    weight: 1,
    eligible: game => game.totalCash() >= game.settings.startingCash * Math.max(3, game.activePlayers().length) * 1.25,
    effects: { cashMultiplier: 0.92 }
  },
  {
    id: 'supply-chain',
    title: 'SUPPLY CHAIN BREAKDOWN',
    category: 'INFRASTRUCTURE',
    summary: 'Materials are scarce. Construction is limited and more expensive.',
    weight: 1,
    eligible: game => game.totalBuildings() >= 4 && game.roundNumber >= 5,
    effects: { buildingCostMultiplier: 1.4, buildingLimitPerTurn: 1, marketPriceMultiplier: 0.9 }
  },
  {
    id: 'debt-amnesty',
    title: 'DEBT AMNESTY',
    category: 'ECONOMIC',
    summary: 'Borrowers can settle early at a discount, but the bank remembers.',
    weight: 1,
    eligible: game => game.players.some(player => ['active', 'due'].includes(player.bankLoan?.status)),
    effects: { loanSettlementMultiplier: 0.8, loanPremiumMultiplier: 1.15 }
  },
  {
    id: 'convention-week',
    title: 'CONVENTION WEEK',
    category: 'INFRASTRUCTURE',
    summary: 'One city group gets a short, noisy demand spike.',
    weight: 1,
    eligible: game => game.roundNumber >= 6,
    effects: { premiumRentMultiplier: 1.2 }
  },
  {
    id: 'tax-audit',
    title: 'TAX SCANDAL AUDIT',
    category: 'CIVIC',
    summary: 'A visible settlement is reviewed by the parlor authority.',
    weight: 1,
    eligible: game => game.roundNumber >= 5,
    effects: { taxMultiplier: 1.15 }
  },
  {
    id: 'bank-run',
    title: 'BANK RUN',
    category: 'ECONOMIC',
    summary: 'Bank actions slow down while liquidity is counted.',
    weight: 1,
    eligible: game => game.players.filter(player => player.cash < game.settings.startingCash * 0.35 && !player.bankrupt).length >= 2,
    choices: [
      { id: 'emergency-bailout', label: 'EMERGENCY BAILOUT', description: 'The bank advances a small rescue payment to distressed players, but active loans gain a surcharge.' },
      { id: 'let-the-ledger-run', label: 'LET THE LEDGER RUN', description: 'No rescue payment. The bank keeps the queue closed until liquidity returns.' }
    ],
    effects: { bankActionsBlocked: true, auctionBlocked: true, marketPriceMultiplier: 0.75, tradingEnabled: false, casinoMaxBet: 250 }
  },
  {
    id: 'transit-shutdown',
    title: 'TRANSIT SHUTDOWN',
    category: 'INFRASTRUCTURE',
    summary: 'Support routes are restricted for one cycle while operators negotiate.',
    weight: 1,
    eligible: game => game.roundNumber >= 5 && game.tiles.some(tile => tile.type === 'railroad' && tile.ownerId),
    effects: { airportCardsBlocked: true, airportRentMultiplier: 0.5, marketPriceMultiplier: 0.85 }
  }
];

const GLOBAL_EVENT_COMBINATIONS = [
  { id: 'foreclosure-spiral', required: ['housing-bubble', 'credit-freeze'], title: 'FORECLOSURE SPIRAL', summary: 'The property crash meets a locked credit market.', effects: { constructionBlocked: true, bankLoansBlocked: true, mortgagesBlocked: true, rentMultiplier: 0.55 }, duration: 8 },
  { id: 'stagflation', required: ['inflation-spiral', 'interest-rate-shock'], title: 'STAGFLATION', summary: 'Cash loses power while debt grows heavier.', effects: { taxMultiplier: 1.35, buildingCostMultiplier: 1.5, loanPremiumMultiplier: 1.5, rentMultiplier: 0.8 }, duration: 8 },
  { id: 'travel-chaos', required: ['airport-strike', 'tourism-boom'], title: 'TRAVEL CHAOS', summary: 'The city is full, but every flight is grounded.', effects: { airportRentMultiplier: 0, premiumRentMultiplier: 1.55, airportCardsBlocked: true }, duration: 7 },
  { id: 'legitimacy-crisis', required: ['city-election', 'tax-audit'], title: 'LEGITIMACY CRISIS', summary: 'The policy vote is now part of the investigation.', choices: [
    { id: 'publish-audit', label: 'PUBLISH THE AUDIT', description: 'Expose the books and keep the policy under review.' },
    { id: 'bury-audit', label: 'Bury the audit', description: 'End the investigation quietly and accept the political fallout.' }
  ], effects: { taxMultiplier: 1.35, rentCap: 90, tradingEnabled: false }, duration: 7 },
  { id: 'construction-shutdown', required: ['supply-chain', 'energy-crisis'], title: 'CONSTRUCTION SHUTDOWN', summary: 'No materials, no power, no new buildings.', effects: { constructionBlocked: true, buildingCostMultiplier: 1.75, utilityRentMultiplier: 1.75 }, duration: 8 },
  { id: 'moral-hazard', required: ['bank-run', 'debt-amnesty'], title: 'TOO BIG TO FAIL', summary: 'The bailout arrives, but the ledger keeps the premium.', choices: [
    { id: 'emergency-bailout', label: 'EMERGENCY BAILOUT', description: 'Rescue distressed borrowers and carry a visible future premium.' },
    { id: 'let-the-ledger-run', label: 'LET THE LEDGER RUN', description: 'Refuse the rescue and keep the bank queue closed.' }
  ], effects: { bankActionsBlocked: true, loanPremiumMultiplier: 1.6 }, duration: 7 }
];

// Global-event dispatch tables, mirroring CARD_ACTION_HANDLERS and
// RENT_EVENT_MODIFIERS below: activation-time targets, per-event activation
// hooks, vote-outcome side effects, and ordered activation settlements.
// Every entry encodes the exact condition and mutation the original inline
// if-ladders performed; the settlement order is observable (feed order and
// cash deltas), so the array sequence is frozen.
function positiveFiniteEffect(value) {
  const number = Number(value);
  return Number.isFinite(number) && number > 0 ? number : null;
}

const GLOBAL_EVENT_TARGET_FINDERS = {
  'anti-monopoly': game => [...game.players].sort((a, b) => game.playerGroups(b).length - game.playerGroups(a).length)[0],
  'tax-audit': game => [...game.activePlayers()].sort((a, b) => (Number(b.cash) || 0) - (Number(a.cash) || 0))[0]
};

const GLOBAL_EVENT_ACTIVATION_HOOKS = {
  'airport-strike': game => game.activePlayers().forEach(player => {
    if (player.properties.some(index => game.getTile(index)?.type === 'railroad')) player.airportOwnedDuringStrike = true;
  })
};

const GLOBAL_EVENT_VOTE_OUTCOME_HANDLERS = {
  'anti-monopoly': (game, event) => {
    if (!event.targetPlayerId || event.resolvedChoice !== 'enforce') return;
    const target = game.getPlayerById(event.targetPlayerId);
    if (target && event.votes?.[target.id] !== 'enforce') target.publicEnemy = true;
  },
  'legitimacy-crisis': (game, event) => {
    if (event.resolvedChoice !== 'bury-audit') return;
    game.activePlayers().forEach(player => {
      if (event.votes?.[player.id] === 'bury-audit') player.compromisedCouncil = true;
    });
  }
};

const GLOBAL_EVENT_SETTLEMENT_STEPS = [
  { appliesTo: (game, event) => positiveFiniteEffect(event.effects?.rentControlStipend) !== null, handler: 'settleRentControlStipend' },
  {
    appliesTo: (game, event) => {
      const multiplier = Number(event.effects?.cashMultiplier);
      return Number.isFinite(multiplier) && multiplier > 0 && multiplier < 1;
    },
    handler: 'settleCashMultiplier'
  },
  {
    appliesTo: (game, event) => ['bank-run', 'moral-hazard'].includes(event.id) && event.resolvedChoice === 'emergency-bailout',
    handler: 'settleEmergencyBailout'
  },
  { appliesTo: (game, event) => event.id === 'tax-audit' && Boolean(event.targetPlayerId), handler: 'settleTaxAuditPenalty' }
];

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

function randomInt(min, max) {
  return crypto.randomInt(min, max + 1);
}

function randomFloat() {
  return crypto.randomInt(0, 1_000_000) / 1_000_000;
}

// Roulette mapping: pocket 0 is green, the rest split on the classic red set.
function roulettePocketColor(pocket) {
  if (pocket === 0) return 'green';
  return ROULETTE_RED.has(pocket) ? 'red' : 'black';
}

function createRoomCode() {
  const alphabet = 'ABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789';
  let code = '';
  for (let i = 0; i < 6; i += 1) {
    code += alphabet.charAt(randomInt(0, alphabet.length - 1));
  }
  return code;
}

// The four default appearance presets, in server assignment order.
const APPEARANCE_PRESET_COLORS = ['#d74438', '#286ea1', '#d9a62f', '#35a653'];

// Resolves a requested seat color against colors taken by connected
// non-bankrupt players (the player's own seat excluded). A collision becomes
// the first free preset; if no preset is free the requested color is kept.
function resolveFreeAppearanceColor(players, requestedColor, self = null) {
  if (typeof requestedColor !== 'string' || !requestedColor) return requestedColor;
  const taken = new Set(
    players
      .filter(player => player !== self && !player.disconnected && !player.bankrupt && typeof player.color === 'string')
      .map(player => player.color.toLowerCase())
  );
  if (!taken.has(requestedColor.toLowerCase())) return requestedColor;
  const free = APPEARANCE_PRESET_COLORS.find(color => !taken.has(color.toLowerCase()));
  return free || requestedColor;
}

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

function freshMarketQuotes() {
  return Object.fromEntries(MARKET_INSTRUMENTS.map(instrument => [instrument.id, instrument.price]));
}

class Player {
  constructor({ clientId, socketId, nickname, color, avatarGrid = null, accountId = null, isHost = false, isBot = false, personality = 'survivor' }) {
    this.id = crypto.randomUUID();
    this.clientId = clientId || this.id;
    this.socketId = socketId;
    const safeNickname = typeof nickname === 'string' ? nickname.trim().slice(0, 24) : '';
    const safeColor = typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? color : '#35a653';
    this.nickname = safeNickname || 'Player';
    this.color = safeColor;
    this.avatarGrid = Array.isArray(avatarGrid) ? avatarGrid : null;
    this.accountId = accountId || null;
    this.isHost = isHost;
    this.isBot = isBot;
    this.personality = ['builder', 'shark', 'survivor', 'speculator', 'diplomat', 'chaos'].includes(personality) ? personality : 'survivor';
    this.cash = DEFAULT_ROOM_SETTINGS.startingCash;
    this.position = START_TILE_INDEX;
    this.properties = [];
    this.inJail = false;
    this.jailTurns = 0;
    this.jailFreeCards = 0;
    this.bankLoan = null;
    this.casinoNet = 0;
    this.casinoLedger = [];
    this.casinoMaxStake = 0;
    this.casinoTotalStaked = 0;
    this.casinoAllIn = false;
    this.casinoOneDollar = false;
    this.casinoBetsThisRound = 0;
    this.marketPositions = {};
    this.marketTrades = 0;
    this.marketActionsThisTurn = 0;
    this.crisisMarketBuys = {};
    this.crisisMarketProfit = false;
    this.playerContractIds = [];
    this.auctionWins = 0;
    this.rentCollected = 0;
    this.globalEventsExperienced = 0;
    this.globalEventsSurvived = 0;
    this.fullGroups = new Set();
    this.airportVisits = new Set();
    this.taxTilesVisited = new Set();
    this.rentPayerIds = new Set();
    this.rentPayersThisRound = new Set();
    this.maxRentPayersInRound = 0;
    this.auctionUnderListWins = 0;
    this.loanWarningSeen = false;
    this.badIdeaLoan = false;
    this.prisonBreak = false;
    this.bankLoanCount = 0;
    this.boughtDuringHousingBubble = false;
    this.soldBuildingsDuringHousingBubble = 0;
    this.bubbleSurvivor = false;
    this.rebuiltAfterHousingBubble = false;
    this.foreclosureNoSecondLoan = false;
    this.housingBubbleEnded = false;
    this.airportOwnedDuringStrike = false;
    this.nonAirportRentDuringStrike = false;
    this.tradesDuringCombo = 0;
    this.groupTherapyTrade = false;
    this.unanimousVote = false;
    this.publicEnemy = false;
    this.compromisedCouncil = false;
    this.coalitionTrade = false;
    this.lastVoteChoice = null;
    this.bailoutReceived = false;
    this.moralHazard = false;
    this.zeroCashReached = false;
    this.collateralLost = false;
    this.comboExperienced = false;
    this.buildActionsThisTurn = 0;
    this.evenBuilds = 0;
    this.councilWins = 0;
    this.publicWorksBuilds = 0;
    this.cardDraws = { surprise: 0, treasure: 0 };
    this.treasureCardsSeen = new Set();
    this.underdogAtHalfway = false;
    this.oneMoreTurn = false;
    this.taxAuditCount = 0;
    this.moveCount = 0;
    this.hiddenMovementSequence = false;
    this.bankrupt = false;
    this.disconnected = false;
    this.ready = false;
  }
}

class AuctionState {
  constructor(propertyTile, startingPlayerId) {
    this.propertyTile = propertyTile;
    this.active = true;
    this.highestBid = 0;
    this.highestBidderId = null;
    this.participants = [];
    this.startingPlayerId = startingPlayerId;
    this.startedAt = Date.now();
    this.endsAt = Date.now() + AUCTION_DURATION_MS;
    this.cooldownUntil = 0;
    this.lastBidAt = 0;
    this.passedPlayerIds = [];
  }
}

// Card action dispatch support. A handler returns either a real result (the
// movement cards that re-enter applyTile, or the strike/rent early-outs) or
// the RESOLVE_TAIL sentinel meaning "run the shared resolveTurnAfterAction
// tail and return undefined" — exactly the break-vs-return split the original
// switch encoded. Handlers live on GameState and are looked up by name.
const RESOLVE_TAIL = Symbol('resolveTurnAfterAction');
const CARD_ACTION_HANDLERS = {
  collectStart: 'collectStartCard',
  pay: 'payCard',
  collect: 'collectCard',
  jailFree: 'jailFreeCard',
  moveBack: 'moveBackCard',
  moveTo: 'moveToCard',
  nearestRailroad: 'nearestTileCard',
  nearestUtility: 'nearestTileCard',
  repairs: 'repairsCard',
  payEach: 'payEachCard',
  move: 'moveCard',
  goToJail: 'goToJailCard',
  collectFromEach: 'collectFromEachCard'
};

// Property action dispatch: the four manageProperty verbs mapped to their
// handler method names on GameState, replacing the original if/else ladder.
const PROPERTY_ACTION_HANDLERS = {
  'build-house': 'buildHousePropertyAction',
  'sell-house': 'sellHousePropertyAction',
  mortgage: 'mortgagePropertyAction',
  unmortgage: 'unmortgagePropertyAction'
};

const buildingLabel = (houseCount) => (houseCount >= 5 ? 'hotel' : 'house');

// Global-event rent modifiers as data: every rule is a multiplicative factor
// (airport-strike is a factor of 0) keyed off the event/effect state, folded
// in order over the base rent. None of them read the accumulated total, so
// multiplication commutes and the sequence is behavior-irrelevant; the only
// non-multiplicative step, rentCap, stays after the fold along with the
// Math.floor clamp. An effect factor parses to NaN when absent, and the fold
// skips non-finite factors — the exact "applies only when set" guard the
// original if-ladder repeated eleven times.
const RENT_EVENT_MODIFIERS = [
  { appliesTo: (game, tile) => game.globalEventActive('housing-bubble') && tile.type === 'property', factor: () => 0.65 },
  { appliesTo: (game, tile) => game.globalEventActive('airport-strike') && tile.type === 'railroad', factor: () => 0 },
  { appliesTo: (game, tile) => game.globalEventActive('tourism-boom') && tile.type === 'railroad', factor: () => 1.75 },
  { appliesTo: (game, tile) => game.globalEventActive('tourism-boom') && tile.group === 'Dark Blue', factor: () => 1.3 },
  {
    appliesTo: (game, tile) => game.globalEventActive('anti-monopoly')
      && tile.ownerId === game.globalEvent.targetPlayerId
      && game.globalEvent.resolvedChoice !== 'dismiss',
    factor: () => 0.6
  },
  { appliesTo: (game, tile) => game.globalEventActive('energy-crisis') && tile.type === 'utility', factor: () => 1.5 },
  { appliesTo: (game, tile) => game.isPublicWorksElection() && tile.type === 'property', factor: () => 0.75 },
  { appliesTo: (game, tile) => tile.type === 'railroad' && !game.globalEventActive('airport-strike'), factor: (game) => Number(game.activeEventEffects().airportRentMultiplier) },
  { appliesTo: (game, tile) => tile.type === 'utility' && !game.globalEventActive('energy-crisis'), factor: (game) => Number(game.activeEventEffects().utilityRentMultiplier) },
  { appliesTo: (game, tile) => tile.group === 'Dark Blue' && !game.globalEventActive('tourism-boom'), factor: (game) => Number(game.activeEventEffects().premiumRentMultiplier) },
  { appliesTo: (game) => !game.globalEventActive('housing-bubble'), factor: (game) => { const multiplier = Number(game.activeEventEffects().rentMultiplier); return multiplier > 0 ? multiplier : NaN; } }
];

// Trade proposal rejection rules as data: one entry per original if-clause of
// GameState.proposeTrade, kept in the original evaluation order so a single
// error string wins exactly as before. The context is fully normalized up
// front (pure lookups only), and every predicate reads just that context,
// mirroring the RENT_EVENT_MODIFIERS style above.
const TRADE_PROPOSAL_GUARDS = [
  {
    error: 'Choose a valid trade partner.',
    rejects: (game, ctx) => !ctx.fromPlayer || !ctx.toPlayer || ctx.fromPlayer.id === ctx.toPlayer.id
  },
  {
    error: 'Both players must be active to trade.',
    rejects: (game, ctx) => ctx.fromPlayer.bankrupt || ctx.fromPlayer.disconnected || ctx.toPlayer.bankrupt || ctx.toPlayer.disconnected
  },
  {
    error: 'Another trade is already pending.',
    rejects: game => Boolean(game.pendingTrade || game.pendingPlayerContract)
  },
  {
    error: 'Cash values must be valid numbers.',
    rejects: (game, ctx) => !Number.isFinite(ctx.giveCash) || !Number.isFinite(ctx.requestCash)
  },
  {
    error: 'Choose at least one cash or property item to include in the trade.',
    rejects: (game, ctx) => !ctx.giveCash && !ctx.requestCash && !ctx.givePropertyIndexes.length && !ctx.requestPropertyIndexes.length
  },
  {
    error: 'You can only offer properties that you own and that have no houses, hotels, or mortgage.',
    rejects: (game, ctx) => ctx.giveTiles.some(tile => game.tradeLegTileUnavailable(tile, ctx.fromPlayer.id))
  },
  {
    error: 'The requested properties are not available for trade.',
    rejects: (game, ctx) => ctx.requestTiles.some(tile => game.tradeLegTileUnavailable(tile, ctx.toPlayer.id))
  },
  {
    error: 'You do not have enough cash for this offer.',
    rejects: (game, ctx) => ctx.fromPlayer.cash < ctx.giveCash
  }
];

// Accept-side revalidation for respondToTrade: same order and strings as the
// original accept branch. A fired guard also clears the pending trade, which
// the responder does uniformly. The first entry covers the original combined
// "players still exist, active" condition verbatim.
const TRADE_SETTLEMENT_GUARDS = [
  {
    error: 'The trade is no longer valid.',
    rejects: (game, ctx) => !ctx.fromPlayer || !ctx.toPlayer || ctx.fromPlayer.bankrupt || ctx.toPlayer.bankrupt || ctx.fromPlayer.disconnected || ctx.toPlayer.disconnected
  },
  {
    error: 'One of the players no longer has enough cash.',
    rejects: (game, ctx) => ctx.fromPlayer.cash < ctx.trade.giveCash || ctx.toPlayer.cash < ctx.trade.requestCash
  },
  {
    error: 'One of the offered properties is no longer tradable.',
    rejects: (game, ctx) => ctx.giveTiles.some(tile => game.tradeLegTileUnavailable(tile, ctx.trade.fromPlayerId))
  },
  {
    error: 'One of the requested properties is no longer tradable.',
    rejects: (game, ctx) => ctx.requestTiles.some(tile => game.tradeLegTileUnavailable(tile, ctx.trade.toPlayerId))
  }
];

// Pre-roll bot candidate sources as data: the array order IS the original
// push order inside getBotCandidates, and the final sort is stable, so ties
// keep this sequence. Each collector returns a (possibly empty) array of
// candidates shaped exactly as before; kind values are the contract consumed
// by botLogic's CANDIDATE_MAPPERS/CANDIDATE_RUNNERS tables.
const BOT_CANDIDATE_SOURCES = [
  { collect: (game, player) => game.botBuildCandidates(player) },
  { collect: (game, player) => game.botMortgageCandidates(player) },
  { collect: (game, player) => game.botLoanCandidate(player) },
  { collect: (game, player) => game.botGroupTradeCandidate(player) },
  { collect: (game, player) => game.botMarketCandidate(player) },
  { collect: (game, player) => game.botCasinoCandidate(player) }
];

// Personality-driven candidate values as data tables so the collectors stay
// branch-light while reproducing the original ternary ladders verbatim. The
// casino spec is only read after the collector's guard confirms the
// personality, so that entry is always defined there.
const BOT_CASINO_SPECS = {
  chaos: { color: 'green', stakeRate: 0.08, score: 18 },
  shark: { color: 'red', stakeRate: 0.03, score: 11 }
};

const BOT_TRADE_ASKS = {
  shark: { requestCash: 40, score: 8 },
  diplomat: { requestCash: 0, score: 24 }
};
const BOT_TRADE_ASK_DEFAULT = { requestCash: 0, score: 8 };

class GameState {
  constructor(settings) {
    this.settings = { ...DEFAULT_ROOM_SETTINGS, ...settings };
    this.reset();
  }

  reset() {
    this.tiles = cloneTiles();
    this.players = [];
    this.currentPlayerId = null;
    this.lastDice = [0, 0];
    this.hasRolled = false;
    this.consecutiveDoubles = 0;
    this.extraRollPending = false;
    this.turnAllowsExtraRoll = false;
    this.awaitingEndTurn = false;
    this.pendingPurchaseOffer = null;
    this.started = false;
    this.startedAt = null;
    this.feed = [];
    this.auction = null;
    this.pendingTrade = null;
    this.pendingPlayerContract = null;
    this.playerContracts = [];
    this.contractTransactions = new Map();
    this.tradesCompleted = 0;
    this.auctionsCompleted = 0;
    this.pendingPayment = null;
    this.pendingPaymentTurnOptions = null;
    this.lastWinner = null;
    this.vacationPool = 0;
    this.roundNumber = 0;
    this.globalEvent = null;
    this.globalEventHistory = [];
    this.globalEventCooldown = 0;
    this.globalEventsTriggered = 0;
    this.midpointMarked = false;
    this.casinoLastResult = null;
    this.casinoLedger = [];
    this.marketLedger = [];
    this.economyTransactions = new Map();
    this.marketQuotes = freshMarketQuotes();
    this.marketRound = 0;
    this.surpriseDeck = [...SURPRISE_DECK];
    this.treasureDeck = [...TREASURE_DECK];
  }

  addPlayer(player) {
    player.cash = this.settings.startingCash;
    player.position = START_TILE_INDEX;
    player.properties = [];
    player.inJail = false;
    player.jailTurns = 0;
    player.casinoNet = 0;
    player.casinoLedger = [];
    player.casinoMaxStake = 0;
    player.casinoTotalStaked = 0;
    player.casinoAllIn = false;
    player.casinoOneDollar = false;
    player.casinoBetsThisRound = 0;
    player.marketPositions = {};
    player.marketTrades = 0;
    player.marketActionsThisTurn = 0;
    player.crisisMarketBuys = {};
    player.crisisMarketProfit = false;
    player.playerContractIds = [];
    player.auctionWins = 0;
    player.rentCollected = 0;
    player.globalEventsExperienced = 0;
    player.globalEventsSurvived = 0;
    player.fullGroups = new Set();
    player.airportVisits = new Set();
    player.taxTilesVisited = new Set();
    player.rentPayerIds = new Set();
    player.rentPayersThisRound = new Set();
    player.maxRentPayersInRound = 0;
    player.auctionUnderListWins = 0;
    player.loanWarningSeen = false;
    player.badIdeaLoan = false;
    player.prisonBreak = false;
    player.bankLoanCount = 0;
    player.boughtDuringHousingBubble = false;
    player.soldBuildingsDuringHousingBubble = 0;
    player.bubbleSurvivor = false;
    player.rebuiltAfterHousingBubble = false;
    player.foreclosureNoSecondLoan = false;
    player.housingBubbleEnded = false;
    player.airportOwnedDuringStrike = false;
    player.nonAirportRentDuringStrike = false;
    player.tradesDuringCombo = 0;
    player.groupTherapyTrade = false;
    player.unanimousVote = false;
    player.publicEnemy = false;
    player.compromisedCouncil = false;
    player.coalitionTrade = false;
    player.lastVoteChoice = null;
    player.bailoutReceived = false;
    player.moralHazard = false;
    player.zeroCashReached = false;
    player.collateralLost = false;
    player.comboExperienced = false;
    player.buildActionsThisTurn = 0;
    player.evenBuilds = 0;
    player.councilWins = 0;
    player.publicWorksBuilds = 0;
    player.cardDraws = { surprise: 0, treasure: 0 };
    player.treasureCardsSeen = new Set();
    player.underdogAtHalfway = false;
    player.oneMoreTurn = false;
    player.taxAuditCount = 0;
    player.moveCount = 0;
    player.hiddenMovementSequence = false;
    player.bankrupt = false;
    player.disconnected = false;
    player.ready = false;
    this.players.push(player);
    this.feedMessage(`${player.nickname} joined the room.`);
    return player;
  }

  resetForNewGame() {
    this.tiles = cloneTiles();
    this.currentPlayerId = null;
    this.turnOrder = [];
    this.lastDice = [0, 0];
    this.hasRolled = false;
    this.consecutiveDoubles = 0;
    this.extraRollPending = false;
    this.turnAllowsExtraRoll = false;
    this.awaitingEndTurn = false;
    this.pendingPurchaseOffer = null;
    this.started = false;
    this.startedAt = Date.now();
    this.feed = [];
    this.auction = null;
    this.pendingTrade = null;
    this.pendingPlayerContract = null;
    this.playerContracts = [];
    this.contractTransactions = new Map();
    this.tradesCompleted = 0;
    this.auctionsCompleted = 0;
    this.pendingPayment = null;
    this.pendingPaymentTurnOptions = null;
    this.lastWinner = null;
    this.vacationPool = 0;
    this.roundNumber = 1;
    this.globalEvent = null;
    this.globalEventHistory = [];
    this.globalEventCooldown = 0;
    this.globalEventsTriggered = 0;
    this.midpointMarked = false;
    this.casinoLastResult = null;
    this.casinoLedger = [];
    this.marketLedger = [];
    this.economyTransactions = new Map();
    this.marketQuotes = freshMarketQuotes();
    this.marketRound = 0;
    this.surpriseDeck = [...SURPRISE_DECK];
    this.treasureDeck = [...TREASURE_DECK];

    this.players.forEach(player => {
      player.cash = this.settings.startingCash;
      player.position = START_TILE_INDEX;
      player.properties = [];
      player.inJail = false;
      player.jailTurns = 0;
      player.jailFreeCards = 0;
      player.bankLoan = null;
      player.casinoNet = 0;
      player.casinoLedger = [];
      player.casinoMaxStake = 0;
      player.casinoTotalStaked = 0;
      player.casinoAllIn = false;
      player.casinoOneDollar = false;
      player.casinoBetsThisRound = 0;
      player.marketPositions = {};
      player.marketTrades = 0;
      player.marketActionsThisTurn = 0;
      player.crisisMarketBuys = {};
      player.crisisMarketProfit = false;
      player.playerContractIds = [];
      player.auctionWins = 0;
      player.rentCollected = 0;
      player.globalEventsExperienced = 0;
      player.globalEventsSurvived = 0;
      player.fullGroups = new Set();
      player.airportVisits = new Set();
      player.taxTilesVisited = new Set();
      player.rentPayerIds = new Set();
      player.rentPayersThisRound = new Set();
      player.maxRentPayersInRound = 0;
      player.auctionUnderListWins = 0;
      player.loanWarningSeen = false;
      player.badIdeaLoan = false;
      player.prisonBreak = false;
      player.bankLoanCount = 0;
      player.boughtDuringHousingBubble = false;
      player.soldBuildingsDuringHousingBubble = 0;
      player.bubbleSurvivor = false;
      player.rebuiltAfterHousingBubble = false;
      player.foreclosureNoSecondLoan = false;
      player.housingBubbleEnded = false;
      player.airportOwnedDuringStrike = false;
      player.nonAirportRentDuringStrike = false;
      player.tradesDuringCombo = 0;
      player.groupTherapyTrade = false;
      player.unanimousVote = false;
      player.publicEnemy = false;
      player.compromisedCouncil = false;
      player.coalitionTrade = false;
      player.lastVoteChoice = null;
      player.bailoutReceived = false;
      player.moralHazard = false;
      player.zeroCashReached = false;
      player.collateralLost = false;
      player.comboExperienced = false;
      player.buildActionsThisTurn = 0;
      player.evenBuilds = 0;
      player.councilWins = 0;
      player.publicWorksBuilds = 0;
      player.cardDraws = { surprise: 0, treasure: 0 };
      player.treasureCardsSeen = new Set();
      player.underdogAtHalfway = false;
      player.oneMoreTurn = false;
      player.taxAuditCount = 0;
      player.moveCount = 0;
      player.hiddenMovementSequence = false;
      player.bankrupt = false;
      player.ready = false;
    });
  }

  removePlayerBySocket(socketId) {
    const index = this.players.findIndex(player => player.socketId === socketId);
    if (index !== -1) {
      this.players.splice(index, 1);
    }
  }

  removePlayerByClient(clientId) {
    const index = this.players.findIndex(player => player.clientId === clientId);
    if (index !== -1) {
      this.players.splice(index, 1);
    }
  }

  getPlayerBySocket(socketId) {
    return this.players.find(player => player.socketId === socketId);
  }

  getPlayerByClient(clientId) {
    return this.players.find(player => player.clientId === clientId);
  }

  getPlayerById(id) {
    return this.players.find(player => player.id === id);
  }

  setPlayerAppearance(socketId, { color, nickname, avatarGrid } = {}) {
    const player = this.getPlayerBySocket(socketId);
    if (!player) {
      return { success: false, error: 'Player not found.' };
    }
    const safeColor = typeof color === 'string' && /^#[0-9a-fA-F]{6}$/.test(color) ? color : null;
    if (safeColor) {
      // Color is the appearance identity: another connected non-bankrupt
      // player using it means the icon is taken at this table. Custom
      // avatarGrids may still differ as long as colors differ.
      const clash = this.players.some(other =>
        other !== player &&
        !other.disconnected &&
        !other.bankrupt &&
        typeof other.color === 'string' &&
        other.color.toLowerCase() === safeColor.toLowerCase()
      );
      if (clash) {
        return { success: false, error: 'That icon is already taken at this table.' };
      }
      player.color = safeColor;
    }
    if (typeof nickname === 'string' && !this.started) {
      const safeNickname = nickname.trim().slice(0, 24);
      if (safeNickname) {
        player.nickname = safeNickname;
      }
    }
    if (avatarGrid === null || Array.isArray(avatarGrid)) {
      player.avatarGrid = avatarGrid;
    }
    return { success: true };
  }

  getTile(index) {
    return this.tiles.find(tile => tile.index === index);
  }

  getGroupTiles(group) {
    return this.tiles.filter(tile => tile.group === group && tile.type === 'property');
  }

  totalBuildings() {
    return this.tiles.reduce((sum, tile) => sum + Math.max(0, Math.min(5, Number(tile.houseCount) || 0)), 0);
  }

  totalCash() {
    return this.activePlayers().reduce((sum, player) => sum + Math.max(0, Number(player.cash) || 0), 0);
  }

  playerGroups(player) {
    if (!player) return [];
    return [...new Set(player.properties.map(index => this.getTile(index)?.group).filter(Boolean))];
  }

  refreshPlayerGroups(player) {
    if (!player) return;
    if (!(player.fullGroups instanceof Set)) player.fullGroups = new Set();
    const complete = this.playerGroups(player).filter(group => this.hasFullSet(player.id, group));
    complete.forEach(group => player.fullGroups.add(group));
  }

  playerContractById(contractId) {
    return this.playerContracts.find(contract => contract.id === contractId) || null;
  }

  playerContractSummary(viewerPlayerId = null) {
    const nameFor = id => this.getPlayerById(id)?.nickname || 'PLAYER';
    const project = contract => {
      const own = Boolean(viewerPlayerId) && (contract.fromPlayerId === viewerPlayerId || contract.toPlayerId === viewerPlayerId);
      const names = { fromPlayerName: nameFor(contract.fromPlayerId), toPlayerName: nameFor(contract.toPlayerId) };
      if (own) return { ...contract, ...names };
      return { id: contract.id, kind: contract.kind, status: contract.status, createdRound: contract.createdRound, ...names };
    };
    return {
      pending: this.pendingPlayerContract ? project(this.pendingPlayerContract) : null,
      active: this.playerContracts.filter(contract => ['active', 'due'].includes(contract.status)).map(project)
    };
  }

  proposePlayerContract(socketId, offer = {}) {
    const fromPlayer = this.getPlayerBySocket(socketId);
    const toPlayer = this.getPlayerById(offer.toPlayerId);
    const kind = CONTRACT_KINDS.has(String(offer.kind)) ? String(offer.kind) : 'loan';
    const amount = Math.floor(Number(offer.amount));
    const requestId = String(offer.requestId || '').trim().slice(0, 100);
    const transactionKey = requestId ? (fromPlayer?.id + ':contract:' + requestId) : null;
    if (transactionKey && this.contractTransactions.has(transactionKey)) return this.contractTransactions.get(transactionKey);
    const durationRounds = Math.max(1, Math.min(20, Math.floor(Number(offer.durationRounds) || 3)));
    const premiumRate = Math.max(0, Math.min(100, Number(offer.premiumRate) || 0));
    const rejection = this.contractProposalRejection(fromPlayer, toPlayer, amount);
    if (rejection) return rejection;
    const contract = this.baseContractTerms(fromPlayer, toPlayer, kind, amount, premiumRate, durationRounds);
    const terms = (kind === 'loan' ? this.loanContractTerms : this.equityContractTerms).call(this, contract, offer, toPlayer);
    if (terms) return terms;
    this.pendingPlayerContract = contract;
    this.feedMessage(fromPlayer.nickname + ' sent a ' + kind + ' contract to ' + toPlayer.nickname + '.');
    const result = { success: true, contract };
    if (transactionKey) this.contractTransactions.set(transactionKey, result);
    return result;
  }

  // Guard order and wording are pinned by server/contracts-market.test.js.
  contractProposalRejection(fromPlayer, toPlayer, amount) {
    if (!this.isPairOfActivePlayers(fromPlayer, toPlayer)) return { success: false, error: 'Choose two active players.' };
    if (fromPlayer.id !== this.currentPlayerId) return { success: false, error: 'Player contracts are proposed during your turn.' };
    if (this.tableObligationOpen()) return { success: false, error: 'Resolve the current table obligation first.' };
    if (!Number.isInteger(amount) || amount < 1 || fromPlayer.cash < amount) return { success: false, error: 'The lender does not have enough cash for that offer.' };
    return null;
  }

  isPairOfActivePlayers(fromPlayer, toPlayer) {
    if (!fromPlayer || !toPlayer || fromPlayer.id === toPlayer.id) return false;
    return !fromPlayer.bankrupt && !toPlayer.bankrupt && !fromPlayer.disconnected && !toPlayer.disconnected;
  }

  tableObligationOpen() {
    return [this.pendingPayment, this.auction, this.pendingPurchaseOffer, this.pendingTrade, this.pendingPlayerContract].some(Boolean);
  }

  baseContractTerms(fromPlayer, toPlayer, kind, amount, premiumRate, durationRounds) {
    return {
      id: 'contract_' + crypto.randomUUID(),
      kind,
      fromPlayerId: fromPlayer.id,
      toPlayerId: toPlayer.id,
      amount,
      premiumRate,
      durationRounds,
      createdRound: this.roundNumber,
      status: 'pending',
      collateralTileIndex: null,
      equityShare: 0,
      equityControl: 'passive'
    };
  }

  // Term builders mutate the draft contract and return null, or return the
  // rejection when the loan/equity specifics are invalid.
  loanContractTerms(contract, offer, borrower) {
    const collateralIndex = offer.collateralTileIndex == null ? null : Number(offer.collateralTileIndex);
    const collateral = collateralIndex == null ? null : this.getTile(collateralIndex);
    if (collateral && (collateral.ownerId !== borrower.id || !this.isTradeableTile(collateral))) {
      return { success: false, error: 'Collateral must be an unencumbered deed owned by the borrower.' };
    }
    contract.totalDue = contract.amount + Math.ceil(contract.amount * (contract.premiumRate / 100));
    contract.remaining = contract.totalDue;
    contract.dueRound = this.roundNumber + contract.durationRounds;
    contract.cureRound = contract.dueRound + 1;
    contract.collateralTileIndex = collateral?.index ?? null;
    return null;
  }

  equityContractTerms(contract, offer, recipient) {
    const property = this.getTile(Number(offer.propertyIndex));
    const share = Math.max(5, Math.min(100, Math.floor(Number(offer.equityShare) || 5)));
    if (!this.isEquityEligibleProperty(property, recipient.id)) {
      return { success: false, error: 'Equity needs an unencumbered property owned by the recipient.' };
    }
    const existingShare = (property.equityShares || []).reduce((sum, entry) => sum + Number(entry.share || 0), 0);
    if (existingShare + share > 100) {
      return { success: false, error: 'That property has no remaining equity to sell.' };
    }
    contract.propertyIndex = property.index;
    contract.equityShare = share;
    contract.equityControl = EQUITY_CONTROL_MODES.has(offer.equityControl) ? offer.equityControl : 'passive';
    contract.expiresRound = offer.permanent ? null : this.roundNumber + contract.durationRounds;
    return null;
  }

  isEquityEligibleProperty(property, ownerId) {
    if (!property || property.type !== 'property' || property.ownerId !== ownerId) return false;
    return !property.mortgaged && !(property.houseCount > 0);
  }

  respondPlayerContract(socketId, accept, requestId = null) {
    const player = this.getPlayerBySocket(socketId);
    const transactionKey = requestId ? (player?.id + ':contract-response:' + String(requestId).slice(0, 100)) : null;
    if (transactionKey && this.contractTransactions.has(transactionKey)) return this.contractTransactions.get(transactionKey);
    const contract = this.pendingPlayerContract;
    if (!player || !contract || contract.toPlayerId !== player.id) return { success: false, error: 'No matching player contract was found.' };
    if (!accept) {
      this.pendingPlayerContract = null;
      this.feedMessage(player.nickname + ' declined the player contract.');
      const result = { success: true, accepted: false };
      if (transactionKey) this.contractTransactions.set(transactionKey, result);
      return result;
    }
    const lender = this.getPlayerById(contract.fromPlayerId);
    if (!lender || lender.bankrupt || lender.disconnected || lender.cash < contract.amount) {
      this.pendingPlayerContract = null;
      return { success: false, error: 'The lender can no longer fund that contract.' };
    }
    if (contract.kind === 'equity') {
      const property = this.getTile(contract.propertyIndex);
      if (!property || property.ownerId !== player.id || property.mortgaged || property.houseCount > 0) {
        this.pendingPlayerContract = null;
        return { success: false, error: 'The equity property is no longer available.' };
      }
      const existingShare = (property.equityShares || []).reduce((sum, entry) => sum + Number(entry.share || 0), 0);
      if (existingShare + contract.equityShare > 100) {
        this.pendingPlayerContract = null;
        return { success: false, error: 'The property has no remaining equity.' };
      }
      property.equityShares = [...(property.equityShares || []), { holderId: lender.id, share: contract.equityShare, contractId: contract.id, control: contract.equityControl }];
    }
    lender.cash -= contract.amount;
    player.cash += contract.amount;
    contract.status = 'active';
    contract.acceptedRound = this.roundNumber;
    this.playerContracts.push(contract);
    lender.playerContractIds.push(contract.id);
    player.playerContractIds.push(contract.id);
    this.pendingPlayerContract = null;
    this.feedMessage(lender.nickname + ' and ' + player.nickname + ' activated a ' + contract.kind + ' contract.');
    const result = { success: true, accepted: true, contract };
    if (transactionKey) this.contractTransactions.set(transactionKey, result);
    return result;
  }

  repayPlayerContract(socketId, { contractId, amount, requestId } = {}) {
    const borrower = this.getPlayerBySocket(socketId);
    const transactionKey = requestId ? (borrower?.id + ':contract-repay:' + String(requestId).slice(0, 100)) : null;
    if (transactionKey && this.contractTransactions.has(transactionKey)) return this.contractTransactions.get(transactionKey);
    const contract = this.playerContractById(contractId);
    const lender = contract ? this.getPlayerById(contract.fromPlayerId) : null;
    if (!borrower || !contract || contract.kind !== 'loan' || contract.toPlayerId !== borrower.id || !['active', 'due'].includes(contract.status)) return { success: false, error: 'That loan is not available to repay.' };
    const requested = amount == null ? contract.remaining : Math.floor(Number(amount));
    const payment = Math.min(Math.max(0, requested), contract.remaining);
    if (!payment || borrower.cash < payment) return { success: false, error: 'You do not have enough cash for that repayment.' };
    borrower.cash -= payment;
    if (lender) lender.cash += payment;
    contract.remaining -= payment;
    if (contract.remaining <= 0) {
      contract.remaining = 0;
      contract.status = 'paid';
      contract.paidRound = this.roundNumber;
    }
    this.feedMessage(borrower.nickname + ' repaid $' + payment + ' on a player loan.');
    const result = { success: true, contract };
    if (transactionKey) this.contractTransactions.set(transactionKey, result);
    return result;
  }

  processPlayerContracts() {
    this.playerContracts.forEach(contract => {
      if (contract.kind === 'equity' && contract.status === 'active' && contract.expiresRound && this.roundNumber >= contract.expiresRound) {
        const property = this.getTile(contract.propertyIndex);
        if (property) property.equityShares = (property.equityShares || []).filter(entry => entry.contractId !== contract.id);
        contract.status = 'expired';
        return;
      }
      if (contract.kind !== 'loan' || !['active', 'due'].includes(contract.status)) return;
      if (contract.status === 'active' && this.roundNumber >= contract.dueRound) {
        contract.status = 'due';
        const borrower = this.getPlayerById(contract.toPlayerId);
        if (borrower) {
          borrower.loanWarningSeen = true;
          this.feedMessage(borrower.nickname + ' owes $' + contract.remaining + ' on a player loan.');
        }
      } else if (contract.status === 'due' && this.roundNumber > contract.cureRound) {
        const borrower = this.getPlayerById(contract.toPlayerId);
        const lender = this.getPlayerById(contract.fromPlayerId);
        const collateral = contract.collateralTileIndex == null ? null : this.getTile(contract.collateralTileIndex);
        if (borrower && !borrower.bankrupt && lender && collateral?.ownerId === borrower.id) this.applyPropertyOwnershipChange(borrower, lender, collateral);
        if (borrower && contract.collateralTileIndex != null) borrower.collateralLost = true;
        contract.status = 'defaulted';
        contract.defaultedRound = this.roundNumber;
        this.feedMessage((borrower?.nickname || 'PLAYER') + ' defaulted on a player loan.');
      }
    });
  }

  settleEquityShares(tile, owner, amountPaid) {
    if (!tile?.equityShares?.length || !owner || amountPaid <= 0) return;
    tile.equityShares.forEach(share => {
      const contract = this.playerContractById(share.contractId);
      const holder = this.getPlayerById(share.holderId);
      if (!contract || contract.status !== 'active' || !holder || holder.bankrupt) return;
      const payout = Math.min(owner.cash, Math.floor(amountPaid * (Number(share.share) / 100)));
      if (payout <= 0) return;
      owner.cash -= payout;
      holder.cash += payout;
      contract.rentCollected = (contract.rentCollected || 0) + payout;
    });
  }

  globalEventDefinition(id) {
    return GLOBAL_EVENT_DEFINITIONS.find(event => event.id === id) || null;
  }

  globalEventActive(id) {
    return this.globalEvent?.phase === 'active' && this.globalEvent.id === id;
  }

  activeEventEffects() {
    return this.globalEvent?.phase === 'active' ? (this.globalEvent.effects || {}) : {};
  }

  isConstructionBlocked() {
    return this.globalEvent?.phase === 'active' && Boolean(this.globalEvent.effects?.constructionBlocked)
      || this.globalEventActive('housing-bubble')
      || this.globalEventActive('bank-run')
      || this.globalEventActive('supply-chain');
  }

  isLoanCollateral(player, tile) {
    return Boolean(player?.bankLoan?.status === 'active' || player?.bankLoan?.status === 'due')
      && Number(player.bankLoan.collateralTileIndex) === Number(tile?.index);
  }

  isPlayerContractCollateral(player, tile) {
    return Boolean(player && tile && this.playerContracts?.some(contract =>
      contract.kind === 'loan'
      && ['active', 'due'].includes(contract.status)
      && contract.toPlayerId === player.id
      && Number(contract.collateralTileIndex) === Number(tile.index)
    ));
  }

  highestCollateralProperty(player) {
    return player?.properties
      ?.map(index => this.getTile(index))
      .filter(tile => tile && tile.type === 'property' && !tile.mortgaged && !(tile.houseCount > 0) && !this.isPlayerContractCollateral(player, tile))
      .sort((a, b) => (b.price || 0) - (a.price || 0))[0] || null;
  }

  getPropertyHouseCost(tile) {
    const base = PROPERTY_HOUSE_COST_BY_GROUP[tile?.group] || 0;
    if (this.isPublicWorksElection()) {
      return Math.max(1, Math.floor(base * 0.65));
    }
    const multiplier = Number(this.activeEventEffects().buildingCostMultiplier);
    return Number.isFinite(multiplier) && multiplier > 0 ? Math.max(1, Math.ceil(base * multiplier)) : base;
  }

  getPropertyRent(tile) {
    if (tile.mortgaged) {
      return 0;
    }
    return this.applyEventRentModifiers(this.baseRentByType(tile), tile);
  }

  baseRentByType(tile) {
    if (tile.type === 'property') return this.propertyBaseRent(tile);
    if (tile.type === 'utility') return this.utilityBaseRent(tile);
    if (tile.type === 'railroad') return this.railroadBaseRent(tile);
    return tile.rent || 0;
  }

  propertyBaseRent(tile) {
    const baseRent = tile.rent || 0;
    const level = Math.max(0, Math.min(5, tile.houseCount || 0));
    if (level > 0) {
      return Math.floor(baseRent * PROPERTY_RENT_MULTIPLIERS[level]);
    }
    if (!tile.group || !this.settings.doubleRent) return baseRent;
    if (this.hasFullSet(tile.ownerId, tile.group)) {
      return baseRent * 2;
    }
    return baseRent;
  }

  utilityBaseRent(tile) {
    const owner = this.getPlayerById(tile.ownerId);
    if (!owner) return tile.rent || 20;
    return this.diceTotal() * (this.ownedUtilityCount(owner) >= 2 ? 10 : 4);
  }

  ownedUtilityCount(owner) {
    return this.tiles.filter(entry => entry.type === 'utility' && entry.ownerId === owner.id).length;
  }

  diceTotal() {
    return Math.max(2, (this.lastDice?.[0] || 0) + (this.lastDice?.[1] || 0));
  }

  railroadBaseRent(tile) {
    const owner = this.getPlayerById(tile.ownerId);
    if (!owner) return RAILROAD_RENT[0];
    const ownedRailroads = this.tiles.filter(entry => entry.type === 'railroad' && entry.ownerId === owner.id).length;
    return RAILROAD_RENT[Math.min(Math.max(ownedRailroads, 1), RAILROAD_RENT.length) - 1];
  }

  applyEventRentModifiers(rent, tile) {
    let total = rent;
    for (const modifier of RENT_EVENT_MODIFIERS) {
      if (!modifier.appliesTo(this, tile)) continue;
      const factor = modifier.factor(this, tile);
      if (Number.isFinite(factor)) total *= factor;
    }
    const cap = Number(this.activeEventEffects().rentCap);
    if (Number.isFinite(cap) && cap > 0) total = Math.min(total, cap);
    return Math.max(0, Math.floor(total));
  }

  isTradeableTile(tile) {
    if (!tile || !tile.ownerId) return false;
    if (tile.mortgaged) return false;
    if (tile.equityShares?.length) return false;
    const owner = this.getPlayerById(tile.ownerId);
    if (owner && (this.isLoanCollateral(owner, tile) || this.isPlayerContractCollateral(owner, tile))) return false;
    return (tile.type === 'property' || tile.type === 'utility' || tile.type === 'railroad') && (tile.houseCount || 0) === 0;
  }

  canBuildOnTile(player, tile) {
    if (!player || !tile || tile.type !== 'property') return false;
    if (this.isConstructionBlocked()) return false;
    if (tile.ownerId !== player.id || tile.mortgaged) return false;
    if (!this.hasFullSet(player.id, tile.group)) return false;
    const groupTiles = this.getGroupTiles(tile.group).filter(entry => entry.ownerId === player.id);
    if (!groupTiles.length) return false;
    if (groupTiles.some(entry => entry.mortgaged)) return false;
    if (!this.settings.evenBuild) {
      return (tile.houseCount || 0) < 5;
    }
    const houseLevels = groupTiles.map(entry => entry.houseCount || 0);
    const minLevel = Math.min(...houseLevels);
    return (tile.houseCount || 0) === minLevel && (tile.houseCount || 0) < 5;
  }

  canSellFromTile(player, tile) {
    if (!player || !tile || tile.type !== 'property') return false;
    if (tile.ownerId !== player.id) return false;
    const groupTiles = this.getGroupTiles(tile.group).filter(entry => entry.ownerId === player.id);
    if (!groupTiles.length) return false;
    if (!this.settings.evenBuild) {
      return (tile.houseCount || 0) > 0;
    }
    const houseLevels = groupTiles.map(entry => entry.houseCount || 0);
    const maxLevel = Math.max(...houseLevels);
    return (tile.houseCount || 0) === maxLevel && (tile.houseCount || 0) > 0;
  }

  canMortgageTile(player, tile) {
    if (!player || !tile || tile.ownerId !== player.id) return false;
    if (!this.settings.mortgage) return false;
    if (this.globalEventActive('credit-freeze') || this.globalEventActive('bank-run') || this.activeEventEffects().mortgagesBlocked) return false;
    if (this.isLoanCollateral(player, tile) || this.isPlayerContractCollateral(player, tile)) return false;
    if (tile.equityShares?.length) return false;
    if (tile.type !== 'property' && tile.type !== 'utility' && tile.type !== 'railroad') return false;
    if ((tile.houseCount || 0) > 0) return false;
    if (tile.mortgaged) return false;
    if (tile.type === 'property') {
      const groupTiles = this.getGroupTiles(tile.group).filter(entry => entry.ownerId === player.id);
      if (groupTiles.some(entry => (entry.houseCount || 0) > 0)) {
        return false;
      }
    }
    return true;
  }

  canUnmortgageTile(player, tile) {
    return Boolean(player && tile && tile.ownerId === player.id && tile.mortgaged)
      && !this.globalEventActive('housing-bubble')
      && !this.globalEventActive('credit-freeze')
      && !this.globalEventActive('bank-run')
      && !this.isPlayerContractCollateral(player, tile);
  }

  applyPropertyOwnershipChange(fromPlayer, toPlayer, tile) {
    (tile.equityShares || []).forEach(share => {
      const contract = this.playerContractById(share.contractId);
      if (contract && contract.status === 'active') {
        contract.status = 'terminated';
        contract.terminatedRound = this.roundNumber;
      }
    });
    tile.ownerId = toPlayer ? toPlayer.id : null;
    tile.mortgaged = false;
    tile.houseCount = 0;
    tile.equityShares = [];
    if (fromPlayer) {
      fromPlayer.properties = fromPlayer.properties.filter(propertyIndex => propertyIndex !== tile.index);
      // A bubble-survivor deed must remain in the original owner's hands
      // through recovery; transferring it invalidates that achievement fact.
      if (fromPlayer.bubbleSurvivor && fromPlayer.housingBubbleEnded) {
        fromPlayer.bubbleSurvivor = fromPlayer.properties.some(index => (this.getTile(index)?.houseCount || 0) > 0);
      }
    }
    if (toPlayer) {
      toPlayer.properties.push(tile.index);
      this.refreshPlayerGroups(toPlayer);
    }
  }

  feedMessage(text) {
    this.feed.unshift({ text, timestamp: Date.now() });
    if (this.feed.length > 40) {
      this.feed.length = 40;
    }
  }

  canJoin() {
    if (this.started) {
      return false;
    }
    return this.players.filter(player => !player.isBot && !player.bankrupt && !player.disconnected).length < this.settings.maxPlayers;
  }

  activePlayers() {
    return this.players.filter(player => !player.bankrupt && !player.disconnected);
  }

  nonBankruptPlayers() {
    return this.players.filter(player => !player.bankrupt);
  }

  connectedNonBankruptPlayers() {
    return this.players.filter(player => !player.bankrupt && !player.disconnected);
  }

  configureStartOrder() {
    const active = [...this.players].filter(p => !p.bankrupt && !p.disconnected);
    if (this.settings.randomizePlayerOrder) {
      shuffleArray(active);
    }
    this.turnOrder = active.map(p => p.id);
    this.currentPlayerId = this.turnOrder[0] || null;
    this.hasRolled = false;
    this.awaitingEndTurn = false;
  }

  getCurrentPlayer() {
    return this.getPlayerById(this.currentPlayerId);
  }

  startGame() {
    if (this.started) {
      return { success: false, error: 'Game has already started.' };
    }
    if (this.players.filter(player => !player.disconnected).length < 2) {
      return { success: false, error: 'At least two players are required.' };
    }
    this.resetForNewGame();
    this.started = true;
    this.startedAt = Date.now();
    this.configureStartOrder();
    this.feedMessage('The game begins. Players take turns clockwise.');
    return { success: true };
  }

  rollDice(socketId) {
    const player = this.getPlayerBySocket(socketId);
    if (!player) {
      return { success: false, error: 'Player not found.' };
    }
    if (!this.started) {
      return { success: false, error: 'Game has not started.' };
    }
    if (player.id !== this.currentPlayerId) {
      return { success: false, error: 'It is not your turn.' };
    }
    if (this.pendingPayment?.playerId === player.id) {
      return { success: false, error: 'Settle your debt before rolling.' };
    }
    if (player.inJail) {
      return this.handleJailRoll(player);
    }
    if (this.hasRolled && !this.extraRollPending) {
      return { success: false, error: 'You have already rolled this turn.' };
    }
    const dice = rollDice();
    this.lastDice = dice;
    this.hasRolled = true;
    this.turnAllowsExtraRoll = dice[0] === dice[1];
    this.extraRollPending = this.turnAllowsExtraRoll;
    if (this.turnAllowsExtraRoll) {
      this.consecutiveDoubles += 1;
    } else {
      this.consecutiveDoubles = 0;
    }
    if (this.consecutiveDoubles >= 3) {
      player.position = this.tiles.find(tile => tile.type === 'jail').index;
      player.inJail = true;
      player.jailTurns = 0;
      this.consecutiveDoubles = 0;
      this.turnAllowsExtraRoll = false;
      this.extraRollPending = false;
      this.hasRolled = false;
      this.feedMessage(`${player.nickname} rolled three doubles and was sent to Jail.`);
      this.nextTurn();
      return { success: true };
    }
    const move = dice[0] + dice[1];
    this.feedMessage(`${player.nickname} rolled ${dice[0]} and ${dice[1]} (${move}).`);
    return this.movePlayer(player, move);
  }

  handleJailRoll(player) {
    if (this.hasRolled && !this.extraRollPending) {
      return { success: false, error: 'You have already rolled this turn.' };
    }
    const dice = rollDice();
    this.lastDice = dice;
    this.hasRolled = true;
    this.turnAllowsExtraRoll = false;
    this.extraRollPending = false;
    this.consecutiveDoubles = 0;
    if (dice[0] === dice[1]) {
      player.inJail = false;
      player.jailTurns = 0;
      this.feedMessage(`${player.nickname} rolled doubles and escaped jail!`);
      return this.movePlayer(player, dice[0] + dice[1], { allowExtraRoll: false });
    }
    player.jailTurns = (player.jailTurns || 0) + 1;
    if (player.jailTurns >= JAIL_MAX_TURNS) {
      if (player.cash >= JAIL_FINE) {
        player.cash -= JAIL_FINE;
        player.inJail = false;
        player.jailTurns = 0;
        this.feedMessage(`${player.nickname} paid $${JAIL_FINE} to leave jail after ${JAIL_MAX_TURNS} turns.`);
        return this.movePlayer(player, dice[0] + dice[1], { allowExtraRoll: false });
      }
      this.feedMessage(`${player.nickname} could not pay the jail fine and remains in jail.`);
    } else {
      this.feedMessage(`${player.nickname} failed to roll doubles in jail (turn ${player.jailTurns}/${JAIL_MAX_TURNS}).`);
    }
    this.awaitingEndTurn = true;
    return { success: true, message: 'You remain in jail. End your turn when ready.' };
  }

  payJailFine(socketId) {
    const player = this.getPlayerBySocket(socketId);
    if (!player) {
      return { success: false, error: 'Player not found.' };
    }
    if (!this.started) {
      return { success: false, error: 'Game has not started.' };
    }
    if (player.id !== this.currentPlayerId) {
      return { success: false, error: 'It is not your turn.' };
    }
    if (!player.inJail) {
      return { success: false, error: 'You are not in jail.' };
    }
    if (this.hasRolled) {
      return { success: false, error: 'You have already rolled this turn.' };
    }
    if (player.cash < JAIL_FINE) {
      return { success: false, error: `You need $${JAIL_FINE} to pay the jail fine.` };
    }
    player.cash -= JAIL_FINE;
    player.inJail = false;
    player.jailTurns = 0;
    this.feedMessage(`${player.nickname} paid $${JAIL_FINE} to leave jail.`);
    return { success: true, message: 'You left jail. Roll the dice to move.' };
  }

  useJailFree(socketId) {
    const player = this.getPlayerBySocket(socketId);
    if (!player || !this.started || player.id !== this.currentPlayerId) return { success: false, error: 'It is not your turn.' };
    if (!player.inJail || !(player.jailFreeCards > 0)) return { success: false, error: 'You do not have a Get Out of Prison card.' };
    if (this.hasRolled) return { success: false, error: 'You have already rolled this turn.' };
    player.jailFreeCards -= 1;
    player.prisonBreak = true;
    player.inJail = false;
    player.jailTurns = 0;
    this.feedMessage(`${player.nickname} used a Get Out of Prison card.`);
    return { success: true, message: 'You left prison with a Get Out of Prison card.' };
  }

  bankLoanTerms(player) {
    const severity = this.settings.bankLoanSeverity === 'extreme' ? 'extreme' : this.settings.bankLoanSeverity === 'fair' ? 'fair' : 'predatory';
    let premiumRate = severity === 'extreme' ? 0.8 : severity === 'fair' ? 0.2 : 0.5;
    if (this.globalEventActive('inflation-spiral')) premiumRate *= 1.25;
    const loanPremiumMultiplier = Number(this.activeEventEffects().loanPremiumMultiplier);
    if (Number.isFinite(loanPremiumMultiplier) && loanPremiumMultiplier > 0) premiumRate *= loanPremiumMultiplier;
    if (this.globalEvent?.phase === 'active' && this.globalEvent.id === 'city-election' && this.globalEvent.resolvedChoice === 'bank-first') premiumRate *= 0.8;
    const principal = BANK_LOAN_PRINCIPAL;
    const totalDue = principal + Math.ceil(principal * premiumRate);
    const collateral = this.highestCollateralProperty(player);
    return {
      principal,
      totalDue,
      premium: totalDue - principal,
      dueInRounds: BANK_LOAN_TERM_ROUNDS,
      dueRound: this.roundNumber + BANK_LOAN_TERM_ROUNDS,
      cureRound: this.roundNumber + BANK_LOAN_TERM_ROUNDS + 1,
      collateralTileIndex: collateral?.index ?? null,
      collateralName: collateral?.name || 'NONE',
      severity
    };
  }

  getBankLoanOffer(player) {
    if (!player || !this.settings.bankLoans) return { available: false, reason: 'Bank lending is disabled.' };
    if (!this.started) return { available: false, reason: 'The game has not started.' };
    if (this.globalEventActive('credit-freeze') || this.globalEventActive('bank-run') || this.activeEventEffects().bankLoansBlocked || this.activeEventEffects().bankActionsBlocked) return { available: false, reason: 'Credit is frozen by the active global event.' };
    if (player.id !== this.currentPlayerId) return { available: false, reason: 'Bank credit is available during your turn.' };
    if (player.bankLoan?.status === 'active' || player.bankLoan?.status === 'due') return { available: false, reason: 'You already have an active bank loan.' };
    if (player.bankLoan?.status === 'defaulted') return { available: false, reason: 'Bank credit is suspended after your previous default.' };
    if (player.cash > 250) return { available: false, reason: 'Emergency credit unlocks below $250 cash.' };
    const terms = this.bankLoanTerms(player);
    return { available: true, ...terms };
  }

  takeBankLoan(socketId, requestId = null) {
    const player = this.getPlayerBySocket(socketId);
    const key = this.transactionKey(player?.id, 'bank-loan', requestId);
    const cached = this.cachedTransaction(key);
    if (cached) return cached;
    const offer = this.getBankLoanOffer(player);
    if (!offer.available) return { success: false, error: offer.reason };
    if (player.cash < 50) player.badIdeaLoan = true;
    player.bankLoanCount = (player.bankLoanCount || 0) + 1;
    player.cash += offer.principal;
    player.bankLoan = {
      status: 'active',
      principal: offer.principal,
      totalDue: offer.totalDue,
      remaining: offer.totalDue,
      issuedRound: this.roundNumber,
      dueRound: offer.dueRound,
      cureRound: offer.cureRound,
      collateralTileIndex: offer.collateralTileIndex,
      severity: offer.severity
    };
    this.feedMessage(`${player.nickname} accepted a $${offer.principal} bank loan. $${offer.totalDue} is due by round ${offer.dueRound}.`);
    return this.cacheTransaction(key, { success: true, loan: player.bankLoan });
  }

  repayBankLoan(socketId, { amount, requestId } = {}) {
   const player = this.getPlayerBySocket(socketId);
    const key = this.transactionKey(player?.id, 'bank-repay', requestId);
    const cached = this.cachedTransaction(key);
    if (cached) return cached;
    if (!player || player.id !== this.currentPlayerId) return { success: false, error: 'It is not your turn.' };
    const loan = player.bankLoan;
    if (!loan || !['active', 'due'].includes(loan.status)) return { success: false, error: 'You have no bank loan to repay.' };
    const requested = amount == null ? loan.remaining : Math.floor(Number(amount));
    if (!Number.isFinite(requested) || requested <= 0) return { success: false, error: 'Enter a valid repayment amount.' };
    const amnesty = this.globalEventActive('debt-amnesty') && requested >= loan.remaining;
    if (loan.status === 'due' && this.roundNumber === loan.cureRound) player.oneMoreTurn = true;
    const settlementMultiplier = Number(this.activeEventEffects().loanSettlementMultiplier);
    const discountedDue = Number.isFinite(settlementMultiplier) && settlementMultiplier > 0 ? Math.ceil(loan.remaining * settlementMultiplier) : loan.remaining;
    const payment = Math.min(amnesty ? discountedDue : requested, loan.remaining);
    if (player.cash < payment) return { success: false, error: `You need $${payment} to make this repayment.` };
    player.cash -= payment;
    loan.remaining -= payment;
    if (amnesty) loan.remaining = 0;
    if (loan.remaining <= 0) {
      loan.remaining = 0;
      loan.status = 'paid';
      loan.paidRound = this.roundNumber;
      this.feedMessage(`${player.nickname} repaid the bank loan in full.`);
    } else {
      this.feedMessage(`${player.nickname} repaid $${payment} on the bank loan. $${loan.remaining} remains.`);
    }
    return this.cacheTransaction(key, { success: true, loan });
  }

  processBankLoans() {
    this.players.forEach(player => {
      const loan = player.bankLoan;
      if (!loan || player.bankrupt || !['active', 'due'].includes(loan.status)) return;
      if (loan.status === 'active' && this.roundNumber >= loan.dueRound) {
        loan.status = 'due';
        player.loanWarningSeen = true;
        this.feedMessage(`${player.nickname}'s bank loan is due: $${loan.remaining}. One cure round remains.`);
      } else if (loan.status === 'due' && this.roundNumber > loan.cureRound) {
        this.defaultBankLoan(player);
      }
    });
  }

  defaultBankLoan(player) {
    const loan = player.bankLoan;
    if (!loan) return;
    const collateral = loan.collateralTileIndex == null ? null : this.getTile(loan.collateralTileIndex);
    if (collateral && collateral.ownerId === player.id) {
      collateral.ownerId = null;
      collateral.mortgaged = false;
      collateral.houseCount = 0;
      player.properties = player.properties.filter(index => index !== collateral.index);
      player.collateralLost = true;
      this.feedMessage(`${player.nickname} defaulted. The bank seized ${collateral.name}.`);
    } else {
      this.feedMessage(`${player.nickname} defaulted on an unsecured bank loan.`);
      this.handleBankruptcy(player, null);
    }
    loan.status = 'defaulted';
    loan.defaultedRound = this.roundNumber;
  }

  movePlayer(player, steps, options = {}) {
    player.moveCount = (player.moveCount || 0) + 1;
    if (player.moveCount === 41) {
      player.hiddenMovementSequence = true;
      this.feedMessage(`${player.nickname} stepped on the 41st movement. The ledger skipped a line.`);
    }
    const oldPosition = player.position;
    player.position = (player.position + steps) % this.tiles.length;
    const distanceToStart = (START_TILE_INDEX - oldPosition + this.tiles.length) % this.tiles.length || this.tiles.length;
    if (distanceToStart <= steps) {
      player.cash += 200;
      this.feedMessage(`${player.nickname} passed Start and collected $200.`);
    }
    const tile = this.getTile(player.position);
    if (tile?.type === 'railroad') {
      if (!(player.airportVisits instanceof Set)) player.airportVisits = new Set();
      player.airportVisits.add(tile.index);
    }
    return this.applyTile(player, tile, options);
  }

  resolveTurnAfterAction({ allowExtraRoll = true } = {}) {
    if (allowExtraRoll && this.turnAllowsExtraRoll) {
      this.extraRollPending = true;
      this.hasRolled = false;
      return { retainedTurn: true };
    }

    this.extraRollPending = false;
    this.turnAllowsExtraRoll = false;
    // Explicit end-of-turn: the landing resolved, but the dice only pass when
    // the active player ends the turn (endTurn below). Bots and the AFK
    // watchdog reach the same door via room.endTurn()/nextTurn().
    this.awaitingEndTurn = true;
    return { retainedTurn: false };
  }

  advanceRound() {
    if (this._advancingRound) return;
    this._advancingRound = true;
    try {
      this.roundNumber += 1;
    if (this.globalEventCooldown > 0) this.globalEventCooldown -= 1;
    this.markMidpointFacts();

    if (this.globalEvent?.phase === 'voting' && this.roundNumber > this.globalEvent.voteRound) {
      this.resolveGlobalEventVote();
    } else if (this.globalEvent?.phase === 'warning' && this.roundNumber > this.globalEvent.startedRound) {
      this.globalEvent.phase = 'active';
      this.globalEvent.startedRound = this.roundNumber;
      this.globalEvent.roundsRemaining = this.globalEvent.durationRounds;
      this.applyGlobalEventActivationSettlements();
      this.feedMessage(`${this.globalEvent.title} is now active for ${this.globalEvent.durationRounds} rounds.`);
    } else if (this.globalEvent?.phase === 'active') {
      this.applyGlobalEventActivationSettlements();
      this.collectBuildingMaintenance();
      this.globalEvent.roundsRemaining -= 1;
      if (this.globalEvent.roundsRemaining <= 0) {
        if (this.globalEvent.id === 'housing-bubble') {
          this.activePlayers().forEach(player => {
            if (player.properties.some(index => (this.getTile(index)?.houseCount || 0) > 0)) player.bubbleSurvivor = true;
            player.housingBubbleEnded = true;
          });
        }
        this.activePlayers().forEach(player => {
          player.globalEventsSurvived = (player.globalEventsSurvived || 0) + 1;
        });
        this.globalEvent.phase = 'recovery';
        this.globalEvent.roundsRemaining = 1;
        this.feedMessage(`${this.globalEvent.title} has ended. The table enters recovery.`);
      }
    } else if (this.globalEvent?.phase === 'recovery') {
      const ended = this.globalEvent;
      this.globalEventHistory.unshift({ id: ended.id, title: ended.title, comboId: ended.comboId || null, startedRound: ended.startedRound, endedRound: this.roundNumber });
      this.globalEventHistory = this.globalEventHistory.slice(0, 8);
      this.globalEvent = null;
      this.globalEventCooldown = GLOBAL_EVENT_COOLDOWN_ROUNDS;
    }

    this.processBankLoans();
    this.processPlayerContracts();
    this.maybeTriggerGlobalEvent();
    this.advanceMarket();
    this.players.forEach(player => {
      player.rentPayersThisRound = new Set();
      player.casinoBetsThisRound = 0;
    });
    } finally {
      this._advancingRound = false;
    }
  }

  globalEventsEnabled() {
    const value = this.settings.globalEvents;
    return value === true || value === 1 || value === 'true' || value === 'on' || value === 'rare' || value === 'hardcore';
  }

  globalEventExpectedRounds() {
    return Math.max(12, this.activePlayers().length * 8);
  }

  globalEventProgress(expectedRounds = this.globalEventExpectedRounds()) {
    return Math.max(0, Math.min(1, (this.roundNumber - 1) / expectedRounds));
  }

  // One headline per match is the safe default. A second headline is only
  // possible when a surprise draw completes a named, curated combination.
  pendingGlobalEventCombo(source) {
    if (this.globalEventsTriggered !== 1 || source !== 'surprise') return null;
    const previous = this.globalEventHistory[0];
    if (!previous || previous.comboId) return null;
    return GLOBAL_EVENT_COMBINATIONS.find(candidate => candidate.required.includes(previous.id)) || null;
  }

  globalEventTriggerChance(source) {
    const progress = this.globalEventProgress();
    if (progress < 0.18) return 0;
    if (source === 'surprise') return progress < 0.55 ? 0.05 : 0.07;
    return progress < 0.55 ? 0.025 : 0.04;
  }

  selectWeightedGlobalEvent(eventPool) {
    const totalWeight = eventPool.reduce((sum, event) => sum + (event.weight || 1), 0);
    let roll = randomFloat() * totalWeight;
    return eventPool.find(event => (roll -= (event.weight || 1)) <= 0) || eventPool[eventPool.length - 1];
  }

  maybeTriggerGlobalEvent(source = 'round') {
    if (!this.started || !this.globalEventsEnabled() || this.globalEvent || this.globalEventCooldown > 0) return;
    if (this.roundNumber < GLOBAL_EVENT_MIN_ROUND) return;
    const combo = this.pendingGlobalEventCombo(source);
    if (this.globalEventsTriggered >= 1 && !combo) return;
    const eligible = GLOBAL_EVENT_DEFINITIONS.filter(event => event.eligible(this));
    const previous = this.globalEventHistory[0];
    const comboEventId = combo?.required.find(id => id !== previous.id);
    const eventPool = combo ? eligible.filter(event => event.id === comboEventId) : eligible;
    if (!eventPool.length) return;
    if (randomFloat() >= this.globalEventTriggerChance(source)) return;
    this.activateGlobalEvent(this.selectWeightedGlobalEvent(eventPool), combo);
  }

  globalEventDurationRounds(definition, combo) {
    if (combo?.duration) return combo.duration;
    const late = this.globalEventProgress() > 0.6;
    if (definition.id === 'housing-bubble') return late ? 8 : 7;
    return late ? 7 : 6;
  }

  globalEventChoices(definition, combo) {
    return (combo?.choices || definition.choices)?.map(choice => ({ ...choice })) || null;
  }

  globalEventBaseFields(definition, combo) {
    return {
      id: combo?.id || definition.id,
      title: combo?.title || definition.title,
      category: combo ? 'COMBINATION' : definition.category,
      summary: combo?.summary || definition.summary,
      effects: { ...(definition.effects || {}), ...(combo?.effects || {}) }
    };
  }

  buildGlobalEvent(definition, combo) {
    const choices = this.globalEventChoices(definition, combo);
    const findTarget = !combo && GLOBAL_EVENT_TARGET_FINDERS[definition.id];
    const target = findTarget ? findTarget(this) : null;
    return {
      ...this.globalEventBaseFields(definition, combo),
      phase: choices ? 'voting' : 'warning',
      startedRound: this.roundNumber,
      voteRound: choices ? this.roundNumber : null,
      durationRounds: this.globalEventDurationRounds(definition, combo),
      roundsRemaining: choices ? 1 : 1,
      choices,
      votes: {},
      resolvedChoice: null,
      targetPlayerId: target?.id || null
    };
  }

  activateGlobalEvent(definition, combo = null) {
    this.globalEvent = this.buildGlobalEvent(definition, combo);
    this.globalEvent.comboId = combo?.id || null;
    if (combo) this.activePlayers().forEach(player => { player.comboExperienced = true; });
    const onActivate = GLOBAL_EVENT_ACTIVATION_HOOKS[definition.id];
    if (onActivate) onActivate(this);
    this.activePlayers().forEach(player => {
      player.globalEventsExperienced = (player.globalEventsExperienced || 0) + 1;
    });
    this.globalEventsTriggered += 1;
    this.feedMessage(this.globalEvent.choices
      ? `${this.globalEvent.title} is live. The table votes before the next round.`
      : `${this.globalEvent.title} is building. The table has one round to prepare.`);
  }

  globalEventVoteWinners(event) {
    const counts = Object.fromEntries((event.choices || []).map(choice => [choice.id, 0]));
    Object.values(event.votes || {}).forEach(choiceId => { if (counts[choiceId] != null) counts[choiceId] += 1; });
    const top = Math.max(...Object.values(counts), 0);
    return Object.entries(counts).filter(([, count]) => count === top).map(([id]) => id);
  }

  applyGlobalEventVoteOutcomes(event) {
    const voters = this.activePlayers();
    const allVotedSame = voters.length > 0 && voters.every(player => event.votes?.[player.id] === event.resolvedChoice);
    voters.forEach(player => {
      if (event.votes?.[player.id]) player.lastVoteChoice = event.votes[player.id];
      if (event.votes?.[player.id] === event.resolvedChoice) player.councilWins = (player.councilWins || 0) + 1;
      if (allVotedSame) player.unanimousVote = true;
    });
    const onResolved = GLOBAL_EVENT_VOTE_OUTCOME_HANDLERS[event.id];
    if (onResolved) onResolved(this, event);
  }

  resolveGlobalEventVote() {
    const event = this.globalEvent;
    if (!event || event.phase !== 'voting') return;
    const winners = this.globalEventVoteWinners(event);
    event.resolvedChoice = winners.length ? winners[randomInt(0, winners.length - 1)] : event.choices?.[0]?.id || null;
    this.applyGlobalEventVoteOutcomes(event);
    event.phase = 'active';
    event.startedRound = this.roundNumber;
    event.roundsRemaining = event.durationRounds;
    this.applyGlobalEventActivationSettlements();
    this.feedMessage(`${event.title} resolved: ${String(event.resolvedChoice || '').replaceAll('-', ' ').toUpperCase()}.`);
  }

  voteGlobalEvent(socketId, choiceId) {
    const player = this.getPlayerBySocket(socketId);
    const event = this.globalEvent;
    if (!player || !event || event.phase !== 'voting') return { success: false, error: 'There is no active global vote.' };
    if (!this.activePlayers().some(candidate => candidate.id === player.id)) return { success: false, error: 'Only active players can vote.' };
    if (!event.choices?.some(choice => choice.id === choiceId)) return { success: false, error: 'That policy is not available.' };
    if (event.votes[player.id]) return { success: false, error: 'You already voted in this election.' };
    event.votes[player.id] = choiceId;
    this.feedMessage(`${player.nickname} cast a vote in the ${event.title.toLowerCase()}.`);
    const voters = this.activePlayers().filter(candidate => event.votes[candidate.id]).length;
    if (voters >= this.activePlayers().length) this.resolveGlobalEventVote();
    return { success: true };
  }

  applyGlobalEventActivationSettlements() {
    const event = this.globalEvent;
    if (!event || event.phase !== 'active' || event.settlementApplied) return;
    event.settlementApplied = true;
    GLOBAL_EVENT_SETTLEMENT_STEPS.forEach(step => {
      if (step.appliesTo(this, event)) this[step.handler](event);
    });
  }

  settleRentControlStipend(event) {
    const stipend = positiveFiniteEffect(event.effects?.rentControlStipend);
    this.activePlayers().filter(player => player.properties.length > 0).forEach(player => {
      player.cash += stipend;
      this.feedMessage(`${player.nickname} received a $${stipend} rent-control stipend.`);
    });
  }

  settleCashMultiplier(event) {
    const cashMultiplier = Number(event.effects?.cashMultiplier);
    this.activePlayers().forEach(player => {
      player.cash = Math.max(0, Math.floor(player.cash * cashMultiplier));
      if (player.cash === 0) player.zeroCashReached = true;
    });
    this.feedMessage(`${event.title} settled a visible cash adjustment across the table.`);
  }

  settleEmergencyBailout() {
    const threshold = this.settings.startingCash * 0.5;
    const rescue = Math.max(50, Math.floor(this.settings.startingCash * 0.1));
    this.activePlayers().filter(player => player.cash < threshold || ['active', 'due'].includes(player.bankLoan?.status)).forEach(player => {
      player.cash += rescue;
      player.bailoutReceived = true;
      if (['active', 'due'].includes(player.bankLoan?.status)) player.moralHazard = true;
      this.feedMessage(`${player.nickname} received a $${rescue} emergency bailout.`);
    });
  }

  settleTaxAuditPenalty() {
    const event = this.globalEvent;
    const target = this.getPlayerById(event.targetPlayerId);
    if (!target || target.bankrupt) return;
    const amount = Math.min(target.cash, Math.max(25, Math.floor(target.cash * 0.1)));
    if (amount <= 0) return;
    target.cash -= amount;
    if (this.settings.vacationCash) this.vacationPool += amount;
    if (target.cash === 0) target.zeroCashReached = true;
    target.taxAuditCount = (target.taxAuditCount || 0) + 1;
    this.feedMessage(`${target.nickname} paid $${amount} after the tax scandal audit.`);
  }

  collectBuildingMaintenance() {
    const maintenance = Number(this.activeEventEffects().buildingMaintenance);
    if (!Number.isFinite(maintenance) || maintenance <= 0) return;
    this.activePlayers().forEach(player => {
      const buildings = player.properties.reduce((sum, index) => {
        const level = Number(this.getTile(index)?.houseCount) || 0;
        if (level >= 5) return sum + 4;
        return sum + Math.max(0, level);
      }, 0);
      if (!buildings) return;
      const due = buildings * Math.floor(maintenance);
      const paid = Math.min(player.cash, due);
      player.cash -= paid;
      if (player.cash === 0) player.zeroCashReached = true;
      if (paid === due) this.feedMessage(`${player.nickname} paid $${paid} in labor-strike maintenance.`);
      else this.feedMessage(`${player.nickname} could only pay $${paid} of $${due} in labor-strike maintenance.`);
    });
  }

  markMidpointFacts() {
    if (this.midpointMarked) return;
    const expectedRounds = Math.max(12, this.activePlayers().length * 8);
    if (this.roundNumber < Math.ceil(expectedRounds / 2)) return;
    const active = this.activePlayers();
    if (!active.length) return;
    const lowestCash = Math.min(...active.map(player => Number(player.cash) || 0));
    active.filter(player => Number(player.cash) === lowestCash).forEach(player => { player.underdogAtHalfway = true; });
    this.midpointMarked = true;
  }

  casinoLimits() {
    const effects = this.activeEventEffects();
    const maxBet = Number(effects.casinoMaxBet);
    const entryFee = Number(effects.casinoEntryFee);
    return {
      maxBet: Number.isFinite(maxBet) && maxBet > 0 ? Math.min(CASINO_MAX_BET, Math.floor(maxBet)) : CASINO_MAX_BET,
      entryFee: Number.isFinite(entryFee) && entryFee > 0 ? Math.floor(entryFee) : 0
    };
  }

  transactionKey(playerId, kind, requestId) {
    const value = String(requestId || '').trim().slice(0, 100);
    return value ? `${playerId}:${kind}:${value}` : null;
  }

  cachedTransaction(key) {
    return key ? this.economyTransactions.get(key) || null : null;
  }

  cacheTransaction(key, result) {
    if (key) this.economyTransactions.set(key, result);
    return result;
  }

  economySnapshot(playerId = null) {
    const player = playerId ? this.getPlayerById(playerId) : null;
    const casinoLimits = this.casinoLimits();
    return {
      casino: {
        enabled: Boolean(this.settings.casino),
        maxBet: casinoLimits.maxBet,
        entryFee: casinoLimits.entryFee,
        lastResult: this.casinoLastResult ? { ...this.casinoLastResult } : null,
        net: Number(player?.casinoNet) || 0
      },
      market: {
        enabled: Boolean(this.settings.market),
        round: this.marketRound,
        feeRate: MARKET_FEE_RATE,
        quotes: { ...this.marketQuotes },
        positions: { ...(player?.marketPositions || {}) }
      }
    };
  }

  placeCasinoBet(socketId, color, stake, requestId = null) {
    const player = this.getPlayerBySocket(socketId);
    const choice = String(color || '').toLowerCase();
    const amount = Math.floor(Number(stake));
    const key = this.transactionKey(player?.id, 'casino', requestId);
    const cached = this.cachedTransaction(key);
    if (cached) return cached;
    const rejection = this.casinoBetRejection(player, choice, amount);
    if (rejection) return { success: false, error: rejection };
    return this.settleCasinoBet(player, choice, amount, key);
  }

  // Guard ladder kept in the original precedence order: the session rules
  // first, then the wager itself. Returns the exact client-facing error
  // string, or null when the bet may be settled.
  casinoBetRejection(player, choice, amount) {
    return this.casinoSessionRejection(player) || this.casinoWagerRejection(player, choice, amount);
  }

  casinoSessionRejection(player) {
    if (!this.settings.casino) return 'Casino access is off for this room.';
    if (this.casinoSessionBlocked(player)) return 'Casino access is unavailable right now.';
    if (this.tableObligationPending()) return 'Resolve the table obligation before betting.';
    return null;
  }

  // Casino access needs a live, started table and a seated, solvent,
  // connected player; any of those missing reads as "unavailable".
  casinoSessionBlocked(player) {
    if (!this.started) return true;
    if (!player) return true;
    if (player.bankrupt) return true;
    return Boolean(player.disconnected);
  }

  // A single "is the table busy" question: any of the five pending flows
  // keeps players away from the casino wheel.
  tableObligationPending() {
    return [
      this.pendingPayment,
      this.auction,
      this.pendingPurchaseOffer,
      this.pendingTrade,
      this.pendingPlayerContract
    ].some(Boolean);
  }

  casinoWagerRejection(player, choice, amount) {
    if (!CASINO_BET_COLORS.includes(choice)) return 'Choose red, black, or green.';
    const limits = this.casinoLimits();
    if (this.casinoStakeRejected(amount, limits)) return `Stake must be between $1 and ${limits.maxBet}.`;
    if (this.hasLoanBackedCash(player)) return 'Loan-backed cash cannot enter the casino.';
    if (player.cash < amount + limits.entryFee) return 'You do not have enough available cash for the stake and event fee.';
    return null;
  }

  // Stakes arrive already floored by the caller; whole-dollar stakes inside
  // the event-aware limit are the only ones accepted.
  casinoStakeRejected(amount, limits) {
    if (!Number.isInteger(amount)) return true;
    if (amount < 1) return true;
    return amount > limits.maxBet;
  }

  hasLoanBackedCash(player) {
    if (!player.bankLoan) return false;
    return LOAN_OUTSTANDING_STATUSES.includes(player.bankLoan.status);
  }

  // The spin itself: one pocket draw (randomInt is the only RNG call site on
  // this path), 35:1 on green and 1:1 on the colors, fees taken on both
  // sides of the outcome.
  settleCasinoBet(player, choice, amount, key) {
    const limits = this.casinoLimits();
    const cashBefore = player.cash;
    const pocket = randomInt(0, 36);
    const resultColor = roulettePocketColor(pocket);
    const won = choice === resultColor;
    const payout = choice === 'green' ? 35 : 1;
    const net = won ? amount * payout - limits.entryFee : -amount - limits.entryFee;
    player.cash -= amount + limits.entryFee;
    if (won) player.cash += amount + (amount * payout);
    this.applyCasinoTally(player, { amount, net, entryFee: limits.entryFee, cashBefore });
    const ledgerEntry = { transactionId: key || crypto.randomUUID(), roundNumber: this.roundNumber, color: choice, pocket, resultColor, stake: amount, net, createdAt: new Date().toISOString() };
    this.recordCasinoLedger(player, ledgerEntry);
    this.casinoLastResult = { playerId: player.id, color: choice, pocket, resultColor, net, roundNumber: this.roundNumber };
    this.feedMessage(`${player.nickname} bet $${amount} on ${choice.toUpperCase()} and ${won ? 'won' : 'lost'} $${Math.abs(net)}.`);
    return this.cacheTransaction(key, { success: true, result: { ...ledgerEntry, balanceAfter: player.cash }, economy: this.economySnapshot(player.id) });
  }

  // Bankroll facts: max/total staked, the sticky all-in and one-dollar
  // markers, and the per-round bet counter.
  applyCasinoTally(player, bet) {
    player.casinoNet += bet.net;
    player.casinoMaxStake = Math.max(player.casinoMaxStake || 0, bet.amount);
    player.casinoTotalStaked = (player.casinoTotalStaked || 0) + bet.amount;
    player.casinoAllIn = player.casinoAllIn || bet.amount + bet.entryFee >= bet.cashBefore;
    player.casinoOneDollar = player.casinoOneDollar || bet.amount === 1;
    player.casinoBetsThisRound = (player.casinoBetsThisRound || 0) + 1;
  }

  // Newest-first ledgers: the room keeps a wide copy stamped with the
  // playerId, the player a bare personal history.
  recordCasinoLedger(player, ledgerEntry) {
    this.casinoLedger = [{ ...ledgerEntry, playerId: player.id }, ...this.casinoLedger].slice(0, 200);
    player.casinoLedger = [ledgerEntry, ...(player.casinoLedger || [])].slice(0, 50);
  }

  advanceMarket() {
    if (!this.settings.market) return;
    this.marketRound += 1;
    const volatility = Number(this.activeEventEffects().marketVolatility);
    const spread = Number.isFinite(volatility) && volatility > 0 ? 0.06 * volatility : 0.06;
    Object.keys(this.marketQuotes).forEach((id) => {
      const drift = (randomFloat() * (spread * 2)) - spread;
      const eventMultiplier = Number(this.activeEventEffects().marketPriceMultiplier);
      const modifier = Number.isFinite(eventMultiplier) && eventMultiplier > 0 ? eventMultiplier : 1;
      this.marketQuotes[id] = Math.max(10, Math.round(this.marketQuotes[id] * (1 + drift) * modifier));
    });
  }

  tradeMarket(socketId, instrumentId, side, quantity, requestId = null) {
    const player = this.getPlayerBySocket(socketId);
    const id = String(instrumentId || '').toLowerCase();
    const direction = String(side || '').toLowerCase();
    const amount = Math.floor(Number(quantity));
    const key = this.transactionKey(player?.id, 'market', requestId);
    const cached = this.cachedTransaction(key);
    if (cached) return cached;
    const instrument = MARKET_INSTRUMENTS.find(entry => entry.id === id);
    const rejection = this.marketOrderRejection(player, instrument, direction, amount);
    if (rejection) return rejection;
    const quote = Number(this.marketQuotes[id]) || instrument.price;
    const gross = quote * amount;
    const fee = Math.max(1, Math.ceil(gross * MARKET_FEE_RATE));
    const position = player.marketPositions[id] || { quantity: 0, averageCost: 0, realizedPnl: 0 };
    const leg = direction === 'buy' ? this.applyMarketBuy : this.applyMarketSell;
    const legRejection = leg.call(this, player, id, position, { quote, gross, fee, amount });
    if (legRejection) return legRejection;
    player.marketPositions[id] = position;
    player.marketTrades = (player.marketTrades || 0) + 1;
    player.marketActionsThisTurn = (player.marketActionsThisTurn || 0) + 1;
    this.marketLedger = [{ transactionId: key || crypto.randomUUID(), roundNumber: this.roundNumber, playerId: player.id, instrumentId: id, side: direction, quantity: amount, quote, fee, createdAt: new Date().toISOString() }, ...this.marketLedger].slice(0, 300);
    this.feedMessage(`${player.nickname} ${direction === 'buy' ? 'bought' : 'sold'} ${amount} ${instrument.name} index unit${amount === 1 ? '' : 's'}.`);
    return this.cacheTransaction(key, { success: true, order: { instrumentId: id, side: direction, quantity: amount, quote, fee, total: direction === 'buy' ? gross + fee : gross - fee }, economy: this.economySnapshot(player.id) });
  }

  marketOrderRejection(player, instrument, direction, amount) {
    const guard = MARKET_ORDER_GUARDS.find(entry => entry.test(this, player));
    if (guard) return { success: false, error: guard.error };
    if (!instrument || !MARKET_SIDES.includes(direction)) return { success: false, error: 'Choose a valid market order.' };
    if (!Number.isInteger(amount) || amount < 1 || amount > 1000) return { success: false, error: 'Quantity must be between 1 and 1,000.' };
    return null;
  }

  applyMarketBuy(player, id, position, { quote, gross, fee, amount }) {
    const total = gross + fee;
    if (player.cash < total) return { success: false, error: 'Not enough cash for this order.' };
    player.cash -= total;
    position.averageCost = ((position.averageCost * position.quantity) + gross + fee) / (position.quantity + amount);
    position.quantity += amount;
    const eventMultiplier = Number(this.activeEventEffects().marketPriceMultiplier);
    if (this.globalEvent?.phase === 'active' && Number.isFinite(eventMultiplier) && eventMultiplier < 1) {
      player.crisisMarketBuys[id] ||= { quote, roundNumber: this.roundNumber };
    }
    return null;
  }

  applyMarketSell(player, id, position, { quote, gross, fee, amount }) {
    if (position.quantity < amount) return { success: false, error: 'You do not hold enough of this index.' };
    player.cash += gross - fee;
    position.realizedPnl += (quote - position.averageCost) * amount - fee;
    position.quantity -= amount;
    if (player.crisisMarketBuys?.[id] && quote > Number(player.crisisMarketBuys[id].quote || 0) && this.globalEvent?.phase !== 'active') {
      player.crisisMarketProfit = true;
      delete player.crisisMarketBuys[id];
    }
    if (!position.quantity) position.averageCost = 0;
    return null;
  }

  applyTile(player, tile, options = {}) {
    if (tile?.type === 'railroad') {
      if (!(player.airportVisits instanceof Set)) player.airportVisits = new Set();
      player.airportVisits.add(tile.index);
    }
    if (tile?.type === 'tax') {
      if (!(player.taxTilesVisited instanceof Set)) player.taxTilesVisited = new Set();
      player.taxTilesVisited.add(tile.index);
    }
    switch (tile.type) {
      case 'start':
        this.feedMessage(`${player.nickname} landed on Start.`);
        this.resolveTurnAfterAction(options);
        return { success: true };
      case 'property':
        return this.handlePropertyTile(player, tile, options);
      case 'tax':
        return this.handleTaxTile(player, tile, options);
      case 'chance':
        return this.handleChanceTile(player, options, 'surprise');
      case 'chest':
        return this.handleChanceTile(player, options, 'treasure');
      case 'jail':
        this.feedMessage(`${player.nickname} is visiting Jail.`);
        this.resolveTurnAfterAction(options);
        return { success: true };
      case 'parking':
        if (this.vacationPool > 0) {
          player.cash += this.vacationPool;
          this.feedMessage(`${player.nickname} swept the Vacation pool for $${this.vacationPool}.`);
          this.vacationPool = 0;
        } else {
          this.feedMessage(`${player.nickname} took a breather at Free Parking.`);
        }
        this.resolveTurnAfterAction(options);
        return { success: true };
      case 'goToVacation':
        player.position = this.tiles.find(tileItem => tileItem.type === 'jail').index;
        player.inJail = false;
        player.jailTurns = 0;
        this.vacationPool += 50;
        this.feedMessage(`${player.nickname} was sent on Vacation and added $50 to the pool.`);
        this.resolveTurnAfterAction({ ...options, allowExtraRoll: false });
        return { success: true };
      case 'goToJail':
        player.position = this.tiles.find(tileItem => tileItem.type === 'jail').index;
        player.inJail = true;
        player.jailTurns = 0;
        this.feedMessage(`${player.nickname} was sent to Jail.`);
        this.resolveTurnAfterAction({ ...options, allowExtraRoll: false });
        return { success: true };
      case 'vacation':
        return this.handleVacationTile(player, options);
      case 'utility':
        return this.handleUtilityTile(player, tile, options);
      case 'railroad':
        return this.handleRailroadTile(player, tile, options);
      default:
        this.resolveTurnAfterAction(options);
        return { success: true };
    }
  }

  handlePropertyTile(player, tile, options = {}) {
    return this.handleBuyableTile(player, tile, options, 'property');
  }

  handleTaxTile(player, tile, options = {}) {
    if (!(player.taxTilesVisited instanceof Set)) player.taxTilesVisited = new Set();
    player.taxTilesVisited.add(tile.index);
    let amount = tile.amount || 0;
    if (this.globalEventActive('inflation-spiral')) amount = Math.ceil(amount * 1.4);
    const taxMultiplier = Number(this.activeEventEffects().taxMultiplier);
    if (Number.isFinite(taxMultiplier) && taxMultiplier > 0 && !this.globalEventActive('inflation-spiral')) {
      amount = Math.ceil(amount * taxMultiplier);
    }
    if (this.globalEvent?.phase === 'active' && this.globalEvent.id === 'city-election' && this.globalEvent.resolvedChoice === 'low-tax') amount = Math.max(1, Math.floor(amount * 0.6));
    if (this.settings.vacationCash) {
      this.chargePlayer(player, null, amount, `${player.nickname} paid $${amount} in tax into Vacation cash.`, options, {
        onPaid: paid => { this.vacationPool += paid; }
      });
    } else {
      this.chargePlayer(player, null, amount, `${player.nickname} paid $${amount} in tax.`, options);
    }
    return { success: true };
  }

  handleVacationTile(player, options = {}) {
    if (!options.skipVacationCollect && this.vacationPool > 0) {
      player.cash += this.vacationPool;
      this.feedMessage(`${player.nickname} collected $${this.vacationPool} from Vacation cash.`);
      this.vacationPool = 0;
    } else {
      this.feedMessage(`${player.nickname} landed on Vacation.`);
    }
    this.resolveTurnAfterAction(options);
    return { success: true };
  }

  handleRailroadTile(player, tile, options = {}) {
    return this.handleBuyableTile(player, tile, options, 'railroad');
  }

  handleBuyableTile(player, tile, options = {}, label = 'property') {
    if (tile.mortgaged) {
      this.feedMessage(`${player.nickname} landed on a mortgaged ${label} and paid no rent.`);
      this.resolveTurnAfterAction(options);
      return { success: true };
    }
    if (tile.ownerId === null) {
      if (player.cash < tile.price) {
        this.feedMessage(`${player.nickname} cannot afford ${tile.name}.`);
        if (this.settings.auction) {
          const auction = this.startAuction(tile, player.id);
          return auction?.success === false ? auction : { success: true, auctionStarted: true };
        }
        this.resolveTurnAfterAction(options);
        return { success: true };
      }
      this.pendingPurchaseOffer = { playerId: player.id, tileIndex: tile.index };
      return { success: true, purchaseOffer: { tileIndex: tile.index, name: tile.name, price: tile.price } };
    }
    if (tile.ownerId === player.id) {
      this.feedMessage(`${player.nickname} landed on their own ${label}.`);
      this.resolveTurnAfterAction(options);
      return { success: true };
    }
    const owner = this.getPlayerById(tile.ownerId);
    if (!owner || owner.bankrupt) {
      this.resolveTurnAfterAction(options);
      return { success: true };
    }
    if (owner.inJail && this.settings.noRentWhileInPrison) {
      this.feedMessage(`${player.nickname} landed on ${owner.nickname}'s ${label}, but rent is not collected while the owner is in jail.`);
      this.resolveTurnAfterAction(options);
      return { success: true };
   }
    const rent = this.calculateRent(tile);
    if (this.globalEventActive('airport-strike') && owner.properties.some(index => this.getTile(index)?.type === 'railroad')) owner.airportOwnedDuringStrike = true;
    if (this.globalEventActive('airport-strike') && tile.type !== 'railroad') owner.nonAirportRentDuringStrike = true;
    this.chargePlayer(player, owner, rent, `${player.nickname} paid $${rent} rent to ${owner.nickname}.`, options, { onPaid: paid => this.settleEquityShares(tile, owner, paid), equityTileIndex: tile.index, equityOwnerId: owner.id });
   return { success: true };
  }

  handleUtilityTile(player, tile, options = {}) {
    return this.handleBuyableTile(player, tile, options, 'utility');
  }

  handleChanceTile(player, options = {}, deckName = 'surprise') {
    const card = this.drawCard(deckName);
    player.cardDraws ||= { surprise: 0, treasure: 0 };
    player.cardDraws[deckName] = (player.cardDraws[deckName] || 0) + 1;
    if (deckName === 'treasure') {
      if (!(player.treasureCardsSeen instanceof Set)) player.treasureCardsSeen = new Set();
      player.treasureCardsSeen.add(String(card.text || '').trim());
    }
    this.feedMessage(`${player.nickname} drew a card: ${card.text}`);
    const cashBefore = player.cash;
    const positionBefore = player.position;
    const result = this.applyCard(player, card, options);
    if (deckName === 'surprise') this.maybeTriggerGlobalEvent('surprise');
    const dynamicCashActions = ['repairs', 'payEach', 'collectFromEach', 'nearestRailroad', 'nearestUtility'];
    let cash = 0;
    if (dynamicCashActions.includes(card.action)) {
      cash = player.cash - cashBefore;
      if (['nearestRailroad', 'nearestUtility'].includes(card.action) && player.position < positionBefore) cash -= 200;
    } else if (card.action === 'pay') {
      cash = -(Number(card.amount) || 0);
    } else if (card.action === 'collect' || card.action === 'collectStart') {
      const amount = Number(card.amount) || 200;
      cash = this.globalEvent?.phase === 'active' && this.globalEvent.id === 'city-election' && this.globalEvent.resolvedChoice === 'low-tax' ? Math.floor(amount * 0.8) : amount;
    }
    return {
      ...(result || { success: true }),
      cardReveal: { tileIndex: player.position, text: card.text, action: card.action, cash }
    };
  }

  drawCard(deckName = 'surprise') {
    const key = deckName === 'treasure' ? 'treasureDeck' : 'surpriseDeck';
    const source = deckName === 'treasure' ? TREASURE_DECK : SURPRISE_DECK;
    if (this[key].length === 0) this[key] = [...source];
    const index = randomInt(0, this[key].length - 1);
    return this[key].splice(index, 1)[0];
  }

  applyCard(player, card, options = {}) {
    const handlerName = CARD_ACTION_HANDLERS[card.action];
    const handler = handlerName && this[handlerName];
    const outcome = handler ? handler.call(this, player, card, options) : RESOLVE_TAIL;
    if (outcome === RESOLVE_TAIL) {
      this.resolveTurnAfterAction(options);
      return undefined;
    }
    return outcome;
  }

  isLowTaxElection() {
    return this.globalEvent?.phase === 'active' && this.globalEvent.id === 'city-election' && this.globalEvent.resolvedChoice === 'low-tax';
  }

  isPublicWorksElection() {
    return this.globalEvent?.phase === 'active' && this.globalEvent.id === 'city-election' && this.globalEvent.resolvedChoice === 'public-works';
  }

  // Shared movement-card pieces: the pass-Start salary, the airport-strike
  // grounding test, the payable-rent-owner guard and the card rent formula.
  awardStartSalaryIfPassed(player, destination) {
    if (destination.index < player.position) {
      player.cash += 200;
      this.feedMessage(`${player.nickname} passed Start and collected $200.`);
    }
  }

  airportStrikeGroundsCard() {
    return this.globalEventActive('airport-strike') || this.activeEventEffects().airportCardsBlocked;
  }

  cardRentPayable(player, owner, destination) {
    if (!owner) return false;
    if (owner.id === player.id) return false;
    return !destination.mortgaged;
  }

  collectStartCard(player, card) {
    player.position = START_TILE_INDEX;
    const amount = Number(card.amount) || 200;
    const paid = this.isLowTaxElection() ? Math.floor(amount * 0.8) : amount;
    player.cash += paid;
    this.feedMessage(`${player.nickname} collected $${paid} from Start.`);
    return RESOLVE_TAIL;
  }

  collectCard(player, card) {
    const amount = Number(card.amount) || 0;
    const paid = this.isLowTaxElection() ? Math.floor(amount * 0.8) : amount;
    player.cash += paid;
    this.feedMessage(`${player.nickname} collected $${paid}.`);
    return RESOLVE_TAIL;
  }

  payCard(player, card, options) {
    this.chargePlayer(player, null, card.amount, `${player.nickname} paid $${card.amount}.`, options);
    return undefined;
  }

  jailFreeCard(player) {
    player.jailFreeCards = (player.jailFreeCards || 0) + 1;
    this.feedMessage(`${player.nickname} received a Get Out of Prison card.`);
    return RESOLVE_TAIL;
  }

  moveBackCard(player, card, options) {
    player.position = (player.position - (card.steps || 3) + this.tiles.length) % this.tiles.length;
    this.feedMessage(`${player.nickname} moved back ${card.steps || 3} spaces.`);
    return this.applyTile(player, this.getTile(player.position), options);
  }

  moveToCard(player, card, options) {
    const destination = this.getTile(card.tileIndex);
    if (!destination) return RESOLVE_TAIL;
    this.awardStartSalaryIfPassed(player, destination);
    player.position = destination.index;
    this.feedMessage(`${player.nickname} advanced to ${destination.name}.`);
    return this.applyTile(player, destination, options);
  }

  moveCard(player, card, options) {
    const destTile = this.getTile(card.tileIndex);
    if (!destTile) return RESOLVE_TAIL;
    player.position = card.tileIndex;
    this.feedMessage(`${player.nickname} moved to ${destTile.name}.`);
    const moveOptions = destTile.type === 'vacation' ? { ...options, skipVacationCollect: true } : options;
    return this.applyTile(player, destTile, moveOptions);
  }

  nearestTileCard(player, card, options) {
    const wantedType = card.action === 'nearestRailroad' ? 'railroad' : 'utility';
    if (wantedType === 'railroad' && this.airportStrikeGroundsCard()) {
      this.feedMessage(`${player.nickname} drew an airport movement card, but the strike grounded every flight.`);
      this.resolveTurnAfterAction(options);
      return { success: true };
    }
    const destination = this.findNextTileOfType(player, wantedType);
    if (!destination) return RESOLVE_TAIL;
    this.awardStartSalaryIfPassed(player, destination);
    player.position = destination.index;
    const owner = destination.ownerId ? this.getPlayerById(destination.ownerId) : null;
    if (this.cardRentPayable(player, owner, destination)) {
      const amount = this.cardRentAmount(destination, card, wantedType);
      this.chargePlayer(player, owner, amount, `${player.nickname} paid $${amount} card rent to ${owner.nickname}.`, options);
      return { success: true };
    }
    return this.applyTile(player, destination, options);
  }

  findNextTileOfType(player, wantedType) {
    return Array.from({ length: this.tiles.length - 1 }, (_, offset) => (player.position + offset + 1) % this.tiles.length)
      .map(index => this.getTile(index))
      .find(tile => tile?.type === wantedType);
  }

  cardRentAmount(destination, card, wantedType) {
    if (wantedType === 'utility') {
      return (Number(this.lastDice[0]) + Number(this.lastDice[1])) * (card.multiplier || 10);
    }
    return this.calculateRent(destination) * (card.multiplier || 2);
  }

  repairsCard(player, card, options) {
    const amount = this.buildingRepairCost(player, card);
    if (amount) this.chargePlayer(player, null, amount, `${player.nickname} paid $${amount} in building repairs.`, options);
    return RESOLVE_TAIL;
  }

  buildingRepairCost(player, card) {
    let houses = 0;
    let hotels = 0;
    player.properties.forEach((index) => {
      const level = this.getTile(index)?.houseCount || 0;
      if (level === 5) hotels += 1;
      else houses += level;
    });
    return houses * (card.houseCost || 0) + hotels * (card.hotelCost || 0);
  }

  payEachCard(player, card) {
    const amount = card.amount || 0;
    this.activePlayers().filter(other => other.id !== player.id).forEach(other => {
      const paid = Math.min(player.cash, amount);
      player.cash -= paid;
      other.cash += paid;
    });
    this.feedMessage(`${player.nickname} paid each player $${amount} from the card.`);
    return RESOLVE_TAIL;
  }

  collectFromEachCard(player, card) {
    const alive = this.activePlayers();
    alive.forEach(other => {
      if (other.id !== player.id) {
        const paid = Math.min(other.cash, card.amount || 0);
        other.cash -= paid;
        player.cash += paid;
      }
    });
    this.feedMessage(`${player.nickname} collected from each player.`);
    return RESOLVE_TAIL;
  }

  goToJailCard(player, options) {
    player.position = this.tiles.find(tile => tile.type === 'jail').index;
    player.inJail = true;
    player.jailTurns = 0;
    this.feedMessage(`${player.nickname} was sent to Jail by a card.`);
    this.resolveTurnAfterAction({ ...options, allowExtraRoll: false });
    return undefined;
  }

  nextTurn() {
    this.pendingPurchaseOffer = null;
    this.extraRollPending = false;
    this.turnAllowsExtraRoll = false;
    this.awaitingEndTurn = false;
    const nonBankrupt = this.nonBankruptPlayers();
    if (nonBankrupt.length <= 1) {
      this.endGame();
      return;
    }
    const currentIndex = this.turnOrder.indexOf(this.currentPlayerId);
    let nextIndex = currentIndex < 0 ? 0 : (currentIndex + 1) % this.turnOrder.length;
    let nextPlayer = this.getPlayerById(this.turnOrder[nextIndex]);
    let attempts = 0;
    while (nextPlayer && (nextPlayer.bankrupt || nextPlayer.disconnected) && attempts < this.turnOrder.length) {
      nextIndex = (nextIndex + 1) % this.turnOrder.length;
      nextPlayer = this.getPlayerById(this.turnOrder[nextIndex]);
      attempts += 1;
    }
    if (!nextPlayer || nextPlayer.bankrupt || nextPlayer.disconnected) {
      const waiting = this.getPlayerById(this.currentPlayerId);
      if (waiting && !waiting.bankrupt) {
        this.feedMessage(`Waiting for ${waiting.nickname} to reconnect…`);
      }
      return;
    }
    if (currentIndex >= 0 && nextIndex <= currentIndex) this.advanceRound();
    if (!this.started) return;
    this.currentPlayerId = nextPlayer.id;
    this.hasRolled = false;
    nextPlayer.buildActionsThisTurn = 0;
    nextPlayer.marketActionsThisTurn = 0;
    this.feedMessage(`${nextPlayer.nickname}'s turn.`);
  }

  calculateRent(tile) {
    return this.getPropertyRent(tile);
  }

  hasFullSet(ownerId, group) {
    const groupTiles = this.tiles.filter(tile => tile.group === group);
    return groupTiles.every(tile => tile.ownerId === ownerId);
  }

  chargePlayer(player, creditor, amount, message, turnOptions = {}, hooks = {}) {
    // Nothing to collect from a missing payer or a non-debt: the turn just
    // resolves normally.
    if (!player || amount <= 0) {
      this.resolveTurnAfterAction(turnOptions);
      return;
    }
    if (player.cash >= amount) {
      this.payDebtInFull({ player, creditor, amount, message, turnOptions, hooks });
      return;
    }
    this.openDebtSettlement({ player, creditor, amount, message, turnOptions, hooks });
  }

  payDebtInFull(debt) {
    const { player, creditor, amount, message, turnOptions, hooks } = debt;
    player.cash -= amount;
    if (player.cash === 0) player.zeroCashReached = true;
    this.creditRentTo(creditor, player, amount);
    this.feedMessage(message);
    if (hooks.onPaid) hooks.onPaid(amount);
    this.resolveTurnAfterAction(turnOptions);
  }

  // Shortfall path: whatever cash remains is tendered first, then the rest
  // of the debt parks in pendingPayment for the mortgage/sell/bankruptcy
  // mini-game to resolve.
  openDebtSettlement(debt) {
    const { player, creditor, amount, message, turnOptions, hooks } = debt;
    const partial = player.cash;
    if (partial > 0) {
      this.tenderPartialDebt(player, creditor, partial, hooks);
    }
    const remaining = amount - partial;
    this.pendingPayment = {
      playerId: player.id,
      creditorId: creditor ? creditor.id : null,
      amountRemaining: remaining,
      reason: message,
      equityTileIndex: hooks.equityTileIndex ?? null,
      equityOwnerId: hooks.equityOwnerId ?? null
    };
    this.pendingPaymentTurnOptions = turnOptions;
    this.feedMessage(`${player.nickname} owes $${remaining}. Mortgage or sell buildings to raise funds, or declare bankruptcy.`);
  }

  tenderPartialDebt(player, creditor, partial, hooks) {
    player.cash = 0;
    player.zeroCashReached = true;
    this.creditRentTo(creditor, player, partial);
    this.feedMessage(`${player.nickname} paid $${partial} toward the debt.`);
    if (hooks.onPaid) hooks.onPaid(partial);
  }

  // Every fact a rent credit touches: cash, the collection total, the payer
  // sets and their running per-round max. Bank debts (null creditor) skip it
  // entirely.
  creditRentTo(creditor, payer, amount) {
    if (!creditor) return;
    creditor.cash += amount;
    creditor.rentCollected = (creditor.rentCollected || 0) + amount;
    creditor.rentPayerIds ||= new Set();
    creditor.rentPayerIds.add(payer.id);
    creditor.rentPayersThisRound ||= new Set();
    creditor.rentPayersThisRound.add(payer.id);
    creditor.maxRentPayersInRound = Math.max(creditor.maxRentPayersInRound || 0, creditor.rentPayersThisRound.size);
  }

  trySettlePendingPayment() {
    if (!this.pendingPayment) return false;
    const player = this.getPlayerById(this.pendingPayment.playerId);
    if (!player || player.bankrupt) {
      this.pendingPayment = null;
      this.pendingPaymentTurnOptions = null;
      return false;
    }
    if (player.cash < this.pendingPayment.amountRemaining) {
      return false;
    }
    const creditor = this.pendingPayment.creditorId
      ? this.getPlayerById(this.pendingPayment.creditorId)
      : null;
    const amount = this.pendingPayment.amountRemaining;
    player.cash -= amount;
    if (creditor) {
      creditor.cash += amount;
      creditor.rentCollected = (creditor.rentCollected || 0) + amount;
      creditor.rentPayerIds ||= new Set();
      creditor.rentPayerIds.add(player.id);
      creditor.rentPayersThisRound ||= new Set();
      creditor.rentPayersThisRound.add(player.id);
      creditor.maxRentPayersInRound = Math.max(creditor.maxRentPayersInRound || 0, creditor.rentPayersThisRound.size);
    }
    if (this.pendingPayment.equityTileIndex != null) {
      const equityTile = this.getTile(this.pendingPayment.equityTileIndex);
      const equityOwner = this.getPlayerById(this.pendingPayment.equityOwnerId);
      this.settleEquityShares(equityTile, equityOwner, amount);
    }
    this.feedMessage(`${player.nickname} paid the remaining $${amount}.`);
    const turnOptions = this.pendingPaymentTurnOptions || {};
    this.pendingPayment = null;
    this.pendingPaymentTurnOptions = null;
    this.resolveTurnAfterAction(turnOptions);
    return true;
  }

  declareBankruptcy(socketId) {
    const player = this.getPlayerBySocket(socketId);
    if (!player) {
      return { success: false, error: 'Player not found.' };
    }
    if (!this.pendingPayment || this.pendingPayment.playerId !== player.id) {
      return { success: false, error: 'You have no outstanding debt to settle.' };
    }
    const creditor = this.pendingPayment.creditorId
      ? this.getPlayerById(this.pendingPayment.creditorId)
      : null;
    this.pendingPayment = null;
    this.pendingPaymentTurnOptions = null;
    this.handleBankruptcy(player, creditor);
    if (player.id === this.currentPlayerId) {
      this.nextTurn();
    }
    return { success: true };
  }

  transferMoney(from, to, amount, message) {
    if (!from || !to || amount <= 0) {
      return;
    }
    from.cash -= amount;
    to.cash += amount;
    this.feedMessage(message);
  }

  deductMoney(player, amount, message) {
    this.chargePlayer(player, null, amount, message, {});
  }

  // The bankruptcy pipeline, in the original statement order: table-state
  // resets, market liquidation (its feed line lands before any deed moves),
  // the cash sweep to the creditor, contract settlements, deed transfer or
  // release, the announcement, and the round conclusion.
  handleBankruptcy(player, creditor = null) {
    this.markPlayerBankrupt(player);
    this.liquidateMarketPositions(player);
    this.sweepCashToCreditor(player, creditor);
    this.settleContractsOnBankruptcy(player);
    this.forfeitOrReleaseProperties(player, creditor);
    this.announceBankruptcy(player, creditor);
    this.concludeBankruptRound(player);
  }

  markPlayerBankrupt(player) {
    player.bankrupt = true;
    player.bubbleSurvivor = false;
    this.extraRollPending = false;
    this.turnAllowsExtraRoll = false;
    this.consecutiveDoubles = 0;
    if (this.pendingPayment?.playerId === player.id) {
      this.pendingPayment = null;
      this.pendingPaymentTurnOptions = null;
    }
  }

  // Positions are force-sold at the current quote minus the market fee and
  // floored into cash; zero-proceeding holdings are dropped silently.
  liquidateMarketPositions(player) {
    const marketLiquidation = Object.entries(player.marketPositions || {}).reduce((sum, [id, position]) => {
      const quantity = Math.max(0, Number(position.quantity) || 0);
      const quote = Math.max(0, Number(this.marketQuotes[id]) || 0);
      const netProceeds = quote * quantity - Math.ceil(quote * quantity * MARKET_FEE_RATE);
      return sum + Math.max(0, netProceeds);
    }, 0);
    if (marketLiquidation <= 0) return;
    player.cash += Math.floor(marketLiquidation);
    player.marketPositions = {};
    this.feedMessage(`${player.nickname}'s market positions were liquidated for $${Math.floor(marketLiquidation)}.`);
  }

  // Whatever cash survives liquidation flows to the creditor before any
  // deed is handed over.
  sweepCashToCreditor(player, creditor) {
    if (!creditor) return;
    if (player.cash <= 0) return;
    creditor.cash += player.cash;
    player.cash = 0;
  }

  settleContractsOnBankruptcy(player) {
    this.playerContracts
      .filter(contract => LOAN_OUTSTANDING_STATUSES.includes(contract.status) && this.contractTouchesPlayer(contract, player))
      .forEach(contract => this.settleBankruptContract(player, contract));
  }

  contractTouchesPlayer(contract, player) {
    if (contract.toPlayerId === player.id) return true;
    return contract.fromPlayerId === player.id;
  }

  // A borrower's loan defaults (with the collateral seized while they still
  // hold it); a lender's loan just terminates; an equity agreement
  // terminates after its shares are stripped off the deed. Anything else is
  // left untouched, exactly as the original if-ladder.
  settleBankruptContract(player, contract) {
    if (contract.kind === 'loan') {
      // The pending-payment filter already guarantees one side is the
      // bankrupt player, so a loan not owed by them is one they issued.
      if (contract.toPlayerId === player.id) {
        this.seizeCollateralForLender(player, contract);
      } else {
        this.terminateContract(contract);
      }
    } else if (contract.kind === 'equity') {
      this.terminateEquityContract(contract);
    }
  }

  seizeCollateralForLender(player, contract) {
    const lender = this.getPlayerById(contract.fromPlayerId);
    const collateral = contract.collateralTileIndex == null ? null : this.getTile(contract.collateralTileIndex);
    if (lender && collateral?.ownerId === player.id) this.applyPropertyOwnershipChange(player, lender, collateral);
    if (contract.collateralTileIndex != null) player.collateralLost = true;
    contract.status = 'defaulted';
    contract.defaultedRound = this.roundNumber;
  }

  terminateContract(contract) {
    contract.status = 'terminated';
    contract.terminatedRound = this.roundNumber;
  }

  terminateEquityContract(contract) {
    const property = this.getTile(contract.propertyIndex);
    if (property) property.equityShares = (property.equityShares || []).filter(entry => entry.contractId !== contract.id);
    this.terminateContract(contract);
  }

  // With a solvent creditor every deed is transferred in holding order; the
  // collateral already seized during contract settling is no longer in the
  // snapshot taken here.
  forfeitOrReleaseProperties(player, creditor) {
    const properties = [...player.properties];
    properties.forEach(propertyIndex => {
      const tile = this.getTile(propertyIndex);
      if (!tile) return;
      if (creditor && !creditor.bankrupt) {
        this.applyPropertyOwnershipChange(player, creditor, tile);
      } else {
        this.releasePropertyTile(player, tile);
      }
    });
    player.properties = [];
  }

  releasePropertyTile(player, tile) {
    tile.ownerId = null;
    tile.houseCount = 0;
    tile.mortgaged = false;
    player.properties = player.properties.filter(index => index !== tile.index);
  }

  // A bankrupt player facing a creditor hands over assets; one owing the
  // bank simply leaves the table.
  announceBankruptcy(player, creditor) {
    if (creditor) {
      this.feedMessage(`${player.nickname} is bankrupt. Assets transferred to ${creditor.nickname}.`);
    } else {
      this.feedMessage(`${player.nickname} is bankrupt and removed from the game.`);
    }
  }

  // The last seat standing wins immediately; otherwise the bankrupt current
  // player forfeits the turn.
  concludeBankruptRound(player) {
    if (this.nonBankruptPlayers().length <= 1) {
      this.endGame();
    } else if (player.id === this.currentPlayerId) {
      this.nextTurn();
    }
  }

  purchaseProperty(socketId, tileIndex) {
    const player = this.getPlayerBySocket(socketId);
    const tile = this.getTile(tileIndex);
    if (!player || !tile || tile.ownerId !== null) {
      return { success: false, error: 'Property is no longer available.' };
    }
    if (
      !this.pendingPurchaseOffer ||
      this.pendingPurchaseOffer.playerId !== player.id ||
      this.pendingPurchaseOffer.tileIndex !== tileIndex
    ) {
      return { success: false, error: 'There is no active purchase offer for this property.' };
    }
    if (player.cash < tile.price) {
      return { success: false, error: 'Insufficient cash to purchase this property.' };
    }
    player.cash -= tile.price;
    tile.ownerId = player.id;
    tile.mortgaged = false;
    tile.houseCount = 0;
    player.properties.push(tile.index);
    if (this.globalEventActive('housing-bubble')) player.boughtDuringHousingBubble = true;
    this.refreshPlayerGroups(player);
    this.feedMessage(`${player.nickname} purchased ${tile.name} for $${tile.price}.`);
    this.pendingPurchaseOffer = null;
    this.resolveTurnAfterAction();
    return { success: true };
  }

  declineProperty(socketId, tileIndex) {
    const player = this.getPlayerBySocket(socketId);
    const tile = this.getTile(tileIndex);
    if (!player || !tile || tile.ownerId !== null) {
      return { success: false, error: 'Property is no longer available.' };
    }
    if (
      !this.pendingPurchaseOffer ||
      this.pendingPurchaseOffer.playerId !== player.id ||
      this.pendingPurchaseOffer.tileIndex !== tileIndex
    ) {
      return { success: false, error: 'There is no active purchase offer for this property.' };
    }
    this.pendingPurchaseOffer = null;
    if (this.settings.auction) {
      const auction = this.startAuction(tile, player.id);
      return auction?.success === false ? auction : { success: true, auctionStarted: true, message: 'Auction started for the declined property.' };
    }
    this.feedMessage(`${player.nickname} declined to buy ${tile.name}.`);
    this.resolveTurnAfterAction();
    return { success: true };
  }

  startAuction(tile, initiatingPlayerId) {
    if (this.globalEventActive('bank-run') || this.activeEventEffects().auctionBlocked) {
      this.feedMessage('The active global event pauses auctions until liquidity returns.');
      this.resolveTurnAfterAction({ allowExtraRoll: false });
      return { success: false, error: 'Auctions are paused by the active Bank Run.' };
    }
    const participants = this.players.filter(player => !player.bankrupt && !player.disconnected).map(player => player.id);
    this.auction = new AuctionState(tile, initiatingPlayerId);
    this.auction.participants = participants;
    this.feedMessage(`Auction started for ${tile.name}. Players may place bids.`);
  }

  placeAuctionBid(socketId, amount) {
    const player = this.getPlayerBySocket(socketId);
    if (!player || !this.auction || !this.auction.active) {
      return { success: false, error: 'No auction is active.' };
    }
    const now = Date.now();
    if (player.bankrupt || player.disconnected) {
      return { success: false, error: 'You cannot bid right now.' };
    }
    if (this.auction.participants.length && !this.auction.participants.includes(player.id)) {
      return { success: false, error: 'You are not part of this auction.' };
    }
    if (this.auction.passedPlayerIds.includes(player.id)) {
      return { success: false, error: 'You have passed on this auction.' };
    }
    if (this.auction.cooldownUntil && now < this.auction.cooldownUntil) {
      return { success: false, error: 'Please wait a moment before bidding again.' };
    }
    if (!Number.isFinite(amount) || amount % 1 !== 0) {
      return { success: false, error: 'Bid must be a whole number.' };
    }
    if (amount <= this.auction.highestBid) {
      return { success: false, error: 'Bid must be higher than the current bid.' };
    }
    if (amount > player.cash) {
      return { success: false, error: 'Insufficient funds for this bid.' };
    }
    if (this.auction.highestBid > 0 && this.auction.highestBidderId === player.id) {
      return { success: false, error: 'Another player must raise the bid first.' };
    }
    this.auction.highestBid = amount;
    this.auction.highestBidderId = player.id;
    this.auction.lastBidAt = now;
    this.auction.cooldownUntil = now + AUCTION_BID_COOLDOWN_MS;
    this.auction.endsAt = now + AUCTION_DURATION_MS;
    this.feedMessage(`${player.nickname} bid $${amount}.`);
    return { success: true };
  }

  passAuction(socketId) {
    const player = this.getPlayerBySocket(socketId);
    if (!player || !this.auction || !this.auction.active) {
      return { success: false, error: 'No auction is active.' };
    }
    if (this.auction.participants.length && !this.auction.participants.includes(player.id)) {
      return { success: false, error: 'You are not part of this auction.' };
    }
    if (this.auction.highestBidderId === player.id) {
      return { success: false, error: 'The current high bidder cannot pass.' };
    }
    if (!this.auction.passedPlayerIds.includes(player.id)) {
      this.auction.passedPlayerIds.push(player.id);
      this.feedMessage(`${player.nickname} passed on the auction.`);
    }
    const remaining = this.auction.participants.filter(id => !this.auction.passedPlayerIds.includes(id));
    if (this.auction.highestBidderId && remaining.length <= 1) {
      this.finishAuction();
      return { success: true, finished: true };
    }
    return { success: true };
  }

  finishAuction() {
    if (!this.auction || !this.auction.active) {
      return;
    }
    const auction = this.auction;
    auction.active = false;
    if (!auction.highestBidderId) {
      this.feedMessage(`No bids were placed for ${auction.propertyTile.name}. The property remains unsold.`);
      this.resolveTurnAfterAction();
      this.auction = null;
      return;
    }
    const winner = this.getPlayerById(auction.highestBidderId);
    if (!winner || winner.bankrupt || winner.disconnected) {
      this.feedMessage(`Auction ended without a valid winner.`);
      this.resolveTurnAfterAction();
      this.auction = null;
      return;
    }
    auction.propertyTile.ownerId = winner.id;
    auction.propertyTile.mortgaged = false;
    auction.propertyTile.houseCount = 0;
    winner.properties.push(auction.propertyTile.index);
    winner.auctionWins = (winner.auctionWins || 0) + 1;
    if (auction.highestBid < Number(auction.propertyTile.price || 0)) winner.auctionUnderListWins = (winner.auctionUnderListWins || 0) + 1;
    this.feedMessage(`${winner.nickname} won the auction for ${auction.propertyTile.name} at $${auction.highestBid}.`);
    this.chargePlayer(
      winner,
      null,
      auction.highestBid,
      `${winner.nickname} paid $${auction.highestBid} for ${auction.propertyTile.name}.`,
      {}
    );
    this.auctionsCompleted += 1;
    this.auction = null;
  }

  manageProperty(socketId, payload = {}) {
    const { tileIndex, action } = payload || {};
    const player = this.getPlayerBySocket(socketId);
    const tile = this.getTile(tileIndex);
    const rejection = this.propertyActionRejection(player, tile, action);
    if (rejection) return rejection;
    const handlerName = PROPERTY_ACTION_HANDLERS[action];
    if (!handlerName) return { success: false, error: 'Unknown property action.' };
    const result = this[handlerName](player, tile);
    if (result?.success && this.pendingPayment?.playerId === player.id) {
      this.trySettlePendingPayment();
    }
    return result;
  }

  // The shared gates of all four actions, in the historical order: existence,
  // ownership, then the build/sell turn window (relaxed while settling debt).
  propertyActionRejection(player, tile, action) {
    if (!player || !tile) {
      return { success: false, error: 'Property not found.' };
    }
    if (tile.ownerId !== player.id) {
      return { success: false, error: 'You do not own this property.' };
    }
    const settlingDebt = this.pendingPayment?.playerId === player.id;
    const buildOrSell = action === 'build-house' || action === 'sell-house';
    if (!buildOrSell) return null;
    if (!settlingDebt) return this.buildWindowRejection(player);
    if (action === 'build-house') {
      return { success: false, error: 'You cannot build while settling a debt.' };
    }
    return null;
  }

  buildWindowRejection(player) {
    if (player.id !== this.currentPlayerId) {
      return { success: false, error: 'You can only build or sell during your turn.' };
    }
    if (this.hasRolled && !this.extraRollPending) {
      return { success: false, error: 'You can only build or sell before rolling the dice.' };
    }
    return null;
  }

  buildingLimitRejection(player) {
    const buildLimit = Number(this.activeEventEffects().buildingLimitPerTurn);
    if (Number.isFinite(buildLimit) && buildLimit > 0 && (player.buildActionsThisTurn || 0) >= buildLimit) {
      return { success: false, error: 'The active event limits building actions this turn.' };
    }
    return null;
  }

  // Side effects a completed build awards, beyond the house itself.
  applyBuildBonuses(player) {
    if (player.housingBubbleEnded && player.soldBuildingsDuringHousingBubble > 0) player.rebuiltAfterHousingBubble = true;
    if (this.settings.evenBuild) player.evenBuilds = (player.evenBuilds || 0) + 1;
    const election = this.globalEvent;
    if (election?.phase === 'active' && election.id === 'city-election' && election.resolvedChoice === 'public-works') {
      player.publicWorksBuilds = (player.publicWorksBuilds || 0) + 1;
    }
  }

  buildHousePropertyAction(player, tile) {
    if (!this.canBuildOnTile(player, tile)) {
      return { success: false, error: 'You cannot build on this property right now.' };
    }
    const limit = this.buildingLimitRejection(player);
    if (limit) return limit;
    const cost = this.getPropertyHouseCost(tile);
    if (player.cash < cost) {
      return { success: false, error: 'Insufficient cash to build a house.' };
    }
    player.cash -= cost;
    tile.houseCount = (tile.houseCount || 0) + 1;
    player.buildActionsThisTurn = (player.buildActionsThisTurn || 0) + 1;
    this.applyBuildBonuses(player);
    this.feedMessage(`${player.nickname} built a ${buildingLabel(tile.houseCount)} on ${tile.name}.`);
    return { success: true };
  }

  sellHousePropertyAction(player, tile) {
    if (!this.canSellFromTile(player, tile)) {
      return { success: false, error: 'You cannot sell a house from this property right now.' };
    }
    const cost = this.getPropertyHouseCost(tile);
    const wasHotel = (tile.houseCount || 0) >= 5;
    tile.houseCount = Math.max(0, (tile.houseCount || 0) - 1);
    player.cash += Math.floor(cost * this.buildingSaleMultiplier());
    if (this.globalEventActive('housing-bubble')) player.soldBuildingsDuringHousingBubble = (player.soldBuildingsDuringHousingBubble || 0) + 1;
    this.feedMessage(`${player.nickname} sold a ${buildingLabel(wasHotel ? 5 : 0)} from ${tile.name}.`);
    return { success: true };
  }

  buildingSaleMultiplier() {
    const eventSaleMultiplier = Number(this.activeEventEffects().buildingSaleMultiplier);
    return Number.isFinite(eventSaleMultiplier) && eventSaleMultiplier >= 0 ? eventSaleMultiplier : 0.5;
  }

  mortgagePropertyAction(player, tile) {
    if (!this.canMortgageTile(player, tile)) {
      return { success: false, error: 'You cannot mortgage this property right now.' };
    }
    tile.mortgaged = true;
    const amount = Math.floor((tile.price || 0) / 2 * this.propertyValueMultiplier());
    player.cash += amount;
    this.feedMessage(`${player.nickname} mortgaged ${tile.name} for $${amount}.`);
    return { success: true };
  }

  propertyValueMultiplier() {
    const valueMultiplier = Number(this.activeEventEffects().propertyValueMultiplier);
    return Number.isFinite(valueMultiplier) && valueMultiplier > 0 ? valueMultiplier : 1;
  }

  unmortgagePropertyAction(player, tile) {
    if (!this.canUnmortgageTile(player, tile)) {
      return { success: false, error: 'You cannot unmortgage this property right now.' };
    }
    const cost = Math.ceil(Math.floor((tile.price || 0) / 2) * 1.1);
    if (player.cash < cost) {
      return { success: false, error: 'Insufficient cash to unmortgage this property.' };
    }
    player.cash -= cost;
    tile.mortgaged = false;
    this.feedMessage(`${player.nickname} unmortgaged ${tile.name}.`);
    return { success: true };
  }

  proposeTrade(socketId, offer = {}) {
    const ctx = this.tradeProposalContext(socketId, offer);
    const guard = TRADE_PROPOSAL_GUARDS.find(entry => entry.rejects(this, ctx));
    if (guard) return { success: false, error: guard.error };
    const trade = {
      id: crypto.randomUUID(),
      fromPlayerId: ctx.fromPlayer.id,
      fromPlayerName: ctx.fromPlayer.nickname,
      toPlayerId: ctx.toPlayer.id,
      toPlayerName: ctx.toPlayer.nickname,
      giveCash: ctx.giveCash,
      requestCash: ctx.requestCash,
      givePropertyIndexes: ctx.givePropertyIndexes,
      requestPropertyIndexes: ctx.requestPropertyIndexes,
      createdAt: Date.now()
    };
    this.pendingTrade = trade;
    this.feedMessage(`${ctx.fromPlayer.nickname} sent a trade offer to ${ctx.toPlayer.nickname}.`);
    return { success: true, trade };
  }

  // One normalization pass for the raw offer: cash clamping, index coercion,
  // and tile resolution all happen exactly as in the original single-body
  // implementation, before any guard reads the context.
  tradeProposalContext(socketId, offer) {
    const fromPlayer = this.getPlayerBySocket(socketId);
    const toPlayer = this.getPlayerById(offer.toPlayerId);
    const giveCash = Math.max(0, Number(offer.giveCash || 0));
    const requestCash = Math.max(0, Number(offer.requestCash || 0));
    const givePropertyIndexes = Array.isArray(offer.givePropertyIndexes) ? offer.givePropertyIndexes.map(Number) : [];
    const requestPropertyIndexes = Array.isArray(offer.requestPropertyIndexes) ? offer.requestPropertyIndexes.map(Number) : [];
    const giveTiles = givePropertyIndexes.map(index => this.getTile(index));
    const requestTiles = requestPropertyIndexes.map(index => this.getTile(index));
    return { fromPlayer, toPlayer, giveCash, requestCash, givePropertyIndexes, requestPropertyIndexes, giveTiles, requestTiles };
  }

  // The original inline per-tile leg check, named: a missing deed, a deed
  // owned by someone else, or an untradeable deed voids the leg.
  tradeLegTileUnavailable(tile, ownerId) {
    if (!tile) return true;
    if (tile.ownerId !== ownerId) return true;
    return !this.isTradeableTile(tile);
  }

  respondToTrade(socketId, { tradeId, accept } = {}) {
    const player = this.getPlayerBySocket(socketId);
    if (!player) {
      return { success: false, error: 'No matching trade offer was found.' };
    }
    const trade = this.pendingTrade;
    if (!trade || trade.id !== tradeId) {
      return { success: false, error: 'No matching trade offer was found.' };
    }
    if (trade.toPlayerId !== player.id) {
      return { success: false, error: 'Only the receiving player can respond to this trade.' };
    }
    if (!accept) {
      return this.declineTradeOffer(player);
    }
    const ctx = this.tradeSettlementContext(trade);
    const guard = TRADE_SETTLEMENT_GUARDS.find(entry => entry.rejects(this, ctx));
    if (guard) {
      this.pendingTrade = null;
      return { success: false, error: guard.error };
    }
    return this.settleTradeOffer(ctx);
  }

  // Deed re-resolution at accept time; pure tile lookups for the guards and
  // the settlement transfer below.
  tradeSettlementContext(trade) {
    return {
      trade,
      fromPlayer: this.getPlayerById(trade.fromPlayerId),
      toPlayer: this.getPlayerById(trade.toPlayerId),
      giveTiles: trade.givePropertyIndexes.map(index => this.getTile(index)),
      requestTiles: trade.requestPropertyIndexes.map(index => this.getTile(index))
    };
  }

  declineTradeOffer(player) {
    this.feedMessage(`${player.nickname} declined the trade offer.`);
    this.pendingTrade = null;
    return { success: true, accepted: false };
  }

  settleTradeOffer(ctx) {
    const { trade, fromPlayer, toPlayer, giveTiles, requestTiles } = ctx;
    fromPlayer.cash -= trade.giveCash;
    toPlayer.cash += trade.giveCash;
    toPlayer.cash -= trade.requestCash;
    fromPlayer.cash += trade.requestCash;
    giveTiles.forEach(tile => this.applyPropertyOwnershipChange(fromPlayer, toPlayer, tile));
    requestTiles.forEach(tile => this.applyPropertyOwnershipChange(toPlayer, fromPlayer, tile));
    this.pendingTrade = null;
    this.tradesCompleted += 1;
    this.markCompletedTradeFlags(fromPlayer, toPlayer, giveTiles.length + requestTiles.length);
    this.feedMessage(`${fromPlayer.nickname} and ${toPlayer.nickname} completed a trade.`);
    this.settleTradeLinkedPayments(fromPlayer, toPlayer);
    return { success: true, accepted: true };
  }

  markCompletedTradeFlags(fromPlayer, toPlayer, tradedPropertyCount) {
    if (tradedPropertyCount >= 3) {
      fromPlayer.groupTherapyTrade = true;
      toPlayer.groupTherapyTrade = true;
    }
    if (this.globalEventActive('stagflation')) {
      fromPlayer.tradesDuringCombo = (fromPlayer.tradesDuringCombo || 0) + 1;
      toPlayer.tradesDuringCombo = (toPlayer.tradesDuringCombo || 0) + 1;
    }
    if (fromPlayer.lastVoteChoice && toPlayer.lastVoteChoice) {
      if (fromPlayer.lastVoteChoice !== toPlayer.lastVoteChoice) {
        fromPlayer.coalitionTrade = true;
        toPlayer.coalitionTrade = true;
      }
    }
  }

  settleTradeLinkedPayments(fromPlayer, toPlayer) {
    if (this.pendingPayment?.playerId !== fromPlayer.id && this.pendingPayment?.playerId !== toPlayer.id) {
      return;
    }
    this.trySettlePendingPayment();
  }

  endTurn(socketId) {
    const player = this.getPlayerBySocket(socketId);
    if (!player || player.id !== this.currentPlayerId) {
      return { success: false, error: 'Only the active player can end the turn.' };
    }
    if (this.extraRollPending || this.turnAllowsExtraRoll) {
      return { success: false, error: 'You must roll again after doubles before ending your turn.' };
    }
    if (!this.awaitingEndTurn) {
      return { success: false, error: 'Resolve your roll before ending the turn.' };
    }
    if (this.auction?.active) {
      return { success: false, error: 'Finish the active auction before ending the turn.' };
    }
    if (this.pendingPurchaseOffer?.playerId === player.id) {
      return { success: false, error: 'Resolve the property offer before ending the turn.' };
    }
    if (this.pendingPayment?.playerId === player.id) {
      return { success: false, error: 'Settle your debt before ending the turn.' };
    }
    this.nextTurn();
    return { success: true };
  }

  runBotAction(playerId, action) {
    const bot = this.getPlayerById(playerId);
    if (!bot || !bot.isBot || typeof action !== 'function') return { success: false, error: 'Bot not found.' };
    const previousSocketId = bot.socketId;
    const actorId = `bot:${bot.id}`;
    bot.socketId = actorId;
    try {
      return action(actorId);
    } finally {
      bot.socketId = previousSocketId;
    }
  }

  // Roll is always available; the pre-roll table appends the remaining
  // candidate sources in their historical order, then the stable sort ranks
  // them by score desc, risk asc.
  getBotCandidates(player) {
    if (!player?.isBot) return [];
    const candidates = [{ id: 'roll', kind: 'roll', risk: 0, score: 0 }];
    if (!this.hasRolled) {
      for (const source of BOT_CANDIDATE_SOURCES) {
        candidates.push(...source.collect(this, player));
      }
    }
    return candidates.sort((a, b) => b.score - a.score || a.risk - b.risk);
  }

  botBuildCandidates(player) {
    return this.tiles
      .filter(tile => this.canBuildOnTile(player, tile))
      .map(tile => {
        const cost = this.getPropertyHouseCost(tile);
        return { id: 'build:' + tile.index, kind: 'build', tileIndex: tile.index, cost, risk: cost / Math.max(1, player.cash), score: player.personality === 'builder' ? 30 : 10 };
      });
  }

  botMortgageCandidates(player) {
    if (player.cash >= 180) return [];
    return this.tiles
      .filter(tile => this.canMortgageTile(player, tile))
      .map(tile => ({ id: 'mortgage:' + tile.index, kind: 'mortgage', tileIndex: tile.index, proceeds: Math.floor((tile.price || 0) / 2), risk: 0.25, score: player.personality === 'survivor' ? 24 : 8 }));
  }

  botLoanCandidate(player) {
    const loan = this.getBankLoanOffer(player);
    if (!loan.available) return [];
    return [{ id: 'loan:emergency', kind: 'loan', principal: loan.principal, risk: loan.totalDue / loan.principal, score: player.personality === 'speculator' ? 18 : -20 }];
  }

  botGroupTradeCandidate(player) {
    const partner = this.activePlayers().find(candidate => candidate.id !== player.id && !candidate.isBot);
    if (!partner) return [];
    const giveTile = this.firstTradeableOwnedTile(player);
    const askTile = this.firstTradeableOwnedTile(partner);
    if (!giveTile || !askTile) return [];
    if (!giveTile.group || giveTile.group !== askTile.group) return [];
    const ask = BOT_TRADE_ASKS[player.personality] || BOT_TRADE_ASK_DEFAULT;
    return [{
      id: 'trade:' + partner.id + ':' + askTile.index,
      kind: 'trade',
      toPlayerId: partner.id,
      givePropertyIndexes: [giveTile.index],
      requestPropertyIndexes: [askTile.index],
      giveCash: 0,
      requestCash: ask.requestCash,
      risk: 0.2,
      score: ask.score
    }];
  }

  firstTradeableOwnedTile(player) {
    return player.properties.map(index => this.getTile(index)).find(tile => tile && this.isTradeableTile(tile));
  }

  botMarketCandidate(player) {
    if (!this.settings.market) return [];
    if ((player.marketActionsThisTurn || 0) >= 1) return [];
    const marketId = Object.entries(this.marketQuotes).sort(([, a], [, b]) => a - b)[0]?.[0];
    if (!marketId) return [];
    return [{
      id: 'market:' + marketId,
      kind: 'market',
      instrumentId: marketId,
      side: 'buy',
      quantity: 1,
      risk: (Number(this.marketQuotes[marketId]) || 100) / Math.max(1, player.cash),
      score: player.personality === 'speculator' ? 20 : 4
    }];
  }

  botCasinoCandidate(player) {
    if (!this.settings.casino) return [];
    if ((player.casinoBetsThisRound || 0) >= 1) return [];
    if (!['shark', 'chaos'].includes(player.personality)) return [];
    if (player.cash <= 20) return [];
    const spec = BOT_CASINO_SPECS[player.personality];
    return [{
      id: 'casino:red',
      kind: 'casino',
      color: spec.color,
      stake: Math.min(20, Math.max(1, Math.floor(player.cash * spec.stakeRate))),
      risk: 0.55,
      score: spec.score
    }];
  }

  skipDisconnectedCurrentPlayer() {
    const current = this.getCurrentPlayer();
    if (!current || !current.disconnected || current.bankrupt) {
      return;
    }
    this.pendingPurchaseOffer = null;
    this.feedMessage(`${current.nickname} was skipped due to disconnect.`);
    this.nextTurn();
  }

  endGame() {
    const winner = this.connectedNonBankruptPlayers()[0] || this.nonBankruptPlayers()[0];
    if (this.globalEvent) {
      const event = this.globalEvent;
      if (!this.globalEventHistory.some(entry => entry.id === event.id && entry.startedRound === event.startedRound)) {
        this.globalEventHistory.unshift({ id: event.id, title: event.title, comboId: event.comboId || null, startedRound: event.startedRound, endedRound: this.roundNumber });
      }
    }
    this.lastWinner = winner ? { id: winner.id, nickname: winner.nickname } : null;
    if (winner) {
      this.feedMessage(`${winner.nickname} is the last player remaining and wins the game!`);
    } else {
      this.feedMessage('The game has ended.');
    }
    this.started = false;
    this.currentPlayerId = null;
    this.hasRolled = false;
    this.pendingPurchaseOffer = null;
    this.auction = null;
    this.pendingTrade = null;
    this.extraRollPending = false;
    this.turnAllowsExtraRoll = false;
    this.awaitingEndTurn = false;
    this.consecutiveDoubles = 0;
  }

  getGameSummary(viewerPlayerId = null) {
    return {
      started: this.started,
      currentPlayerId: this.currentPlayerId,
      turnOrder: this.turnOrder || [],
      hasRolled: this.hasRolled,
      extraRollPending: this.extraRollPending,
      awaitingEndTurn: this.awaitingEndTurn,
      pendingPurchaseOffer: this.pendingPurchaseOffer,
      pendingPayment: this.pendingPayment,
      lastWinner: this.lastWinner,
      lastDice: this.lastDice,
      tiles: this.tiles.map(tile => ({
        index: tile.index,
        name: tile.name,
        type: tile.type,
        group: tile.group,
        ownerId: tile.ownerId,
        price: tile.price,
        rent: tile.rent,
        color: tile.color,
        amount: tile.amount,
        mortgaged: tile.mortgaged,
        houseCount: tile.houseCount || 0,
        houseCost: this.getPropertyHouseCost(tile),
        equityShares: (tile.equityShares || []).map(share => ({
          holderId: share.holderId,
          holderName: this.getPlayerById(share.holderId)?.nickname || 'PLAYER',
          share: Math.max(0, Math.min(100, Number(share.share) || 0)),
          control: share.control || 'passive'
        }))
      })),
      players: this.players.map(player => ({
        id: player.id,
        nickname: player.nickname,
        color: player.color,
        cash: player.cash,
        position: player.position,
        inJail: player.inJail,
        jailTurns: player.jailTurns || 0,
        jailFreeCards: player.jailFreeCards || 0,
        bankLoan: viewerPlayerId && player.id === viewerPlayerId
          ? player.bankLoan
          : (player.bankLoan ? { status: player.bankLoan.status } : null),
        bankLoanOffer: viewerPlayerId && player.id === viewerPlayerId ? this.getBankLoanOffer(player) : null,
        bankrupt: player.bankrupt,
        disconnected: player.disconnected,
        isHost: player.isHost,
        properties: player.properties,
        ready: player.ready,
        isBot: player.isBot,
        personality: player.isBot ? player.personality : null,
        clientId: player.clientId,
        accountId: player.accountId || null,
        avatarGrid: player.avatarGrid || null
      })),
      feed: this.feed,
      roundNumber: this.roundNumber,
      globalEvent: this.globalEvent ? {
        ...this.globalEvent,
        votes: { ...this.globalEvent.votes },
        choices: this.globalEvent.choices?.map(choice => ({ ...choice })) || null
      } : null,
      globalEventHistory: this.globalEventHistory,
      auction: this.auction ? {
        active: this.auction.active,
        tileIndex: this.auction.propertyTile.index,
        tileName: this.auction.propertyTile.name,
        highestBid: this.auction.highestBid,
        highestBidderId: this.auction.highestBidderId,
        participants: this.auction.participants,
        startedAt: this.auction.startedAt,
        endsAt: this.auction.endsAt,
        cooldownUntil: this.auction.cooldownUntil,
        lastBidAt: this.auction.lastBidAt,
        passedPlayerIds: this.auction.passedPlayerIds,
        durationMs: AUCTION_DURATION_MS
      } : null,
      pendingTrade: this.pendingTrade,
      vacationPool: this.vacationPool,
      playerContracts: this.playerContractSummary(viewerPlayerId),
      economy: {
        casino: {
          enabled: Boolean(this.settings.casino),
          ...this.casinoLimits(),
          lastResult: this.casinoLastResult ? { ...this.casinoLastResult } : null
        },
        market: {
          enabled: Boolean(this.settings.market),
          round: this.marketRound,
          feeRate: MARKET_FEE_RATE,
          quotes: { ...this.marketQuotes }
        }
      }
    };
  }
}

class Room {
  constructor(hostPlayer, { roomName = 'AFTER HOURS', visibility = 'public', roomCode = '' } = {}) {
    this.roomCode = roomCode || createRoomCode();
    this.roomName = roomName;
    this.visibility = visibility;
    this.statsRecorded = false;
    this.hostId = hostPlayer.id;
    this.settings = { ...DEFAULT_ROOM_SETTINGS };
    this.game = new GameState(this.settings);
    this.game.addPlayer(hostPlayer);
  }

  addOrReconnectPlayer(playerInfo) {
    const existing = this.game.getPlayerByClient(playerInfo.clientId);
    if (existing) {
      existing.socketId = playerInfo.socketId;
      existing.disconnected = false;
      if (typeof playerInfo.nickname === 'string') {
        const safeNickname = playerInfo.nickname.trim().slice(0, 24);
        if (safeNickname) {
          existing.nickname = safeNickname;
        }
      }
      if (typeof playerInfo.color === 'string' && /^#[0-9a-fA-F]{6}$/.test(playerInfo.color)) {
        existing.color = resolveFreeAppearanceColor(this.game.players, playerInfo.color, existing);
      }
      if (playerInfo.avatarGrid === null || Array.isArray(playerInfo.avatarGrid)) {
        existing.avatarGrid = playerInfo.avatarGrid;
      }
      if (playerInfo.accountId) existing.accountId = playerInfo.accountId;
      return { success: true, player: existing };
    }
    if (this.game.started) {
      return { success: false, error: 'Game is already in progress.' };
    }
    if (!this.game.canJoin()) {
      return { success: false, error: 'Room is full.' };
    }
    const player = new Player(playerInfo);
    player.color = resolveFreeAppearanceColor(this.game.players, player.color, player);
    this.game.addPlayer(player);
    return { success: true, player };
  }

  // Public browse, disconnect GC, and stale-code reclaim share this single
  // liveness check: bots and ghost seats must not count as humans.
  hasConnectedHumans() {
    return this.game.players.some(player => !player.isBot && !player.disconnected);
  }

  getPlayerBySocket(socketId) {
    return this.game.getPlayerBySocket(socketId);
  }

  getPlayerById(id) {
    return this.game.getPlayerById(id);
  }

  setRoomSetting(key, value) {
    if (this.game.started) {
      return;
    }
    if (!Object.prototype.hasOwnProperty.call(this.settings, key)) {
      return;
    }
    if (LEGACY_SCALED_SETTINGS.includes(key)) {
      return;
    }
    const normalizer = ROOM_SETTING_NORMALIZERS[key];
    const nextValue = normalizer ? normalizer(value, this) : this.defaultRoomSettingValue(key, value);
    if (nextValue === SETTING_REJECTED) {
      return;
    }
    this.settings[key] = nextValue;
    this.game.settings[key] = nextValue;
    this.applyRoomSettingSideEffect(key, nextValue);
  }

  // Generic fallback for keys the table does not specialise: boolean flags
  // parse the four truthy spellings, strings lose their edges, and other
  // types are stored exactly as received.
  defaultRoomSettingValue(key, value) {
    if (typeof this.settings[key] === 'boolean') {
      return ROOM_FLAG_TRUE_VALUES.includes(value);
    }
    if (typeof value === 'string') {
      return value.trim();
    }
    return value;
  }

  applyRoomSettingSideEffect(key, value) {
    if (key !== 'startingCash') {
      return;
    }
    this.game.players.forEach(player => {
      player.cash = Number(value);
    });
  }

  startGame() {
    this.ensureBots();
    const result = this.game.startGame();
    if (result?.success) this.statsRecorded = false;
    return result;
  }

  ensureBots() {
    const required = Math.max(0, Math.min(this.settings.maxPlayers - 1, Number(this.settings.bots) || 0));
    const existingBots = this.game.players.filter(player => player.isBot);
    if (existingBots.length > required) {
      existingBots.slice(required).forEach(bot => {
        this.game.removePlayerByClient(bot.clientId);
      });
    }
    const botCount = Math.min(existingBots.length, required);
    const colors = ['#286ea1', '#35a653', '#d9a62f'];
    for (let index = botCount; index < required; index += 1) {
      const bot = new Player({
        clientId: `bot-${this.roomCode}-${index + 1}`,
       nickname: `BOT ${index + 1}`,
       color: colors[index % colors.length],
        isBot: true,
        personality: this.settings.botPersonality
      });
      this.game.addPlayer(bot);
    }
  }

  rollDice(socketId) {
    return this.game.rollDice(socketId);
  }

  purchaseProperty(socketId, tileIndex) {
    return this.game.purchaseProperty(socketId, tileIndex);
  }

  declineProperty(socketId, tileIndex) {
    return this.game.declineProperty(socketId, tileIndex);
  }

  placeAuctionBid(socketId, amount) {
    return this.game.placeAuctionBid(socketId, amount);
  }

  passAuction(socketId) {
    return this.game.passAuction(socketId);
  }

  manageProperty(socketId, payload) {
    return this.game.manageProperty(socketId, payload);
  }

  proposeTrade(socketId, payload) {
    return this.game.proposeTrade(socketId, payload);
  }

  respondToTrade(socketId, payload) {
    return this.game.respondToTrade(socketId, payload);
  }

  proposePlayerContract(socketId, payload) {
    return this.game.proposePlayerContract(socketId, payload);
  }

  respondPlayerContract(socketId, accept, requestId) {
    return this.game.respondPlayerContract(socketId, accept, requestId);
  }

  repayPlayerContract(socketId, payload) {
    return this.game.repayPlayerContract(socketId, payload);
  }

  endTurn(socketId) {
    return this.game.endTurn(socketId);
  }

  payJailFine(socketId) {
    return this.game.payJailFine(socketId);
  }

  useJailFree(socketId) {
    return this.game.useJailFree(socketId);
  }

  getBankLoanOffer(socketId) {
    return this.game.getBankLoanOffer(this.game.getPlayerBySocket(socketId));
  }

  takeBankLoan(socketId, requestId) {
    return this.game.takeBankLoan(socketId, requestId);
  }

  repayBankLoan(socketId, payload) {
    return this.game.repayBankLoan(socketId, payload);
  }

  placeCasinoBet(socketId, color, stake, requestId) {
    return this.game.placeCasinoBet(socketId, color, stake, requestId);
  }

  tradeMarket(socketId, instrumentId, side, quantity, requestId) {
    return this.game.tradeMarket(socketId, instrumentId, side, quantity, requestId);
  }

  runBotAction(playerId, action) {
    return this.game.runBotAction(playerId, action);
  }

  voteGlobalEvent(socketId, choiceId) {
    return this.game.voteGlobalEvent(socketId, choiceId);
  }

  declareBankruptcy(socketId) {
    return this.game.declareBankruptcy(socketId);
  }

  getRoomSummary() {
    // Legacy clients may still send these fields; the server owns scaling now,
    // so they never leave the server side of the wire.
    const publicSettings = { ...this.settings };
    delete publicSettings.globalEventDuration;
    delete publicSettings.globalEventMax;
    return {
      // Public tables are discovered directly; only private tables expose an
      // invite code in the client-facing room projection.
      roomCode: this.visibility === 'private' ? this.roomCode : null,
      roomName: this.roomName,
      visibility: this.visibility,
      capacity: this.settings.maxPlayers,
      hostId: this.hostId,
      settings: publicSettings,
      players: this.game.players.map(player => ({
        id: player.id,
        clientId: player.clientId,
        nickname: player.nickname,
        color: player.color,
        cash: player.cash,
        position: player.position,
        inJail: player.inJail,
        jailTurns: player.jailTurns || 0,
        bankrupt: player.bankrupt,
        disconnected: player.disconnected,
        isHost: player.isHost,
        ready: player.ready,
        isBot: player.isBot,
        accountId: player.accountId || null,
        avatarGrid: player.avatarGrid || null
      })),
      started: this.game.started,
      vacationPool: this.game.vacationPool
    };
  }

  getDirectorySummary() {
    const active = this.game.players.filter(player => !player.disconnected && !player.bankrupt);
    const started = this.game.started;
    return {
      code: this.roomCode,
      name: this.roomName,
      seats: active.length,
      cap: this.settings.maxPlayers,
      bank: `$${Number(this.settings.startingCash).toLocaleString()}`,
      state: started ? 'live' : 'open',
      visibility: this.visibility,
      note: started ? 'round live' : 'waiting for players'
    };
  }
}

class RoomManager {
  constructor() {
    this.rooms = new Map();
    this.socketRoom = new Map();
  }

  createRoom(hostInfo) {
    const player = new Player({ ...hostInfo, isHost: true });
    // Generated codes must never silently overwrite an existing room entry.
    let roomCode = hostInfo.roomCode;
    if (!roomCode) {
      do {
        roomCode = createRoomCode();
      } while (this.rooms.has(roomCode));
    }
    const room = new Room(player, { roomName: hostInfo.roomName, visibility: hostInfo.visibility, roomCode });
    player.color = resolveFreeAppearanceColor(room.game.players, player.color, player);
    this.rooms.set(room.roomCode, room);
    this.socketRoom.set(hostInfo.socketId, room);
    return room;
  }

  getRoom(roomCode) {
    if (!roomCode) return null;
    return this.rooms.get(String(roomCode).toUpperCase()) || null;
  }

  getRoomBySocket(socketId) {
    return this.socketRoom.get(socketId) || null;
  }

  restoreConnection(clientId, socketId) {
    const room =
      [...this.rooms.values()].find(roomItem => {
        const player = roomItem.game.getPlayerByClient(clientId);
        return player && !player.disconnected;
      }) ||
      [...this.rooms.values()].find(roomItem => roomItem.game.getPlayerByClient(clientId));
    if (!room) return null;
    const player = room.game.getPlayerByClient(clientId);
    if (!player) return null;
    player.socketId = socketId;
    player.disconnected = false;
    this.socketRoom.set(socketId, room);
    return room;
  }

  disconnectPlayer(socketId) {
    const room = this.getRoomBySocket(socketId);
    if (!room) return null;
    this.socketRoom.delete(socketId);
    return room;
  }

  getRoomByClient(clientId) {
    if (!clientId) return null;
    return [...this.rooms.values()].find(roomItem => roomItem.game.getPlayerByClient(clientId)) || null;
  }

  listPublicRooms() {
    return [...this.rooms.values()]
      .filter(room => room.visibility === 'public' && room.hasConnectedHumans())
      .map(room => room.getDirectorySummary());
  }

  leaveRoomByClient(clientId, socketId) {
    const room = this.getRoomByClient(clientId);
    if (!room) return null;
    const player = room.game.getPlayerByClient(clientId);
    if (!player) return null;
    if (socketId) {
      this.socketRoom.delete(socketId);
    }
    const playerId = player.id;
    const game = room.game;
    const wasCurrentTurn = game.started && game.currentPlayerId === playerId;
    // A real leave releases the seat in the lobby AND mid-game, so the room
    // can drain to empty and the GC can reclaim it.
    game.removePlayerByClient(clientId);
    if (game.started) {
      if (Array.isArray(game.turnOrder)) {
        game.turnOrder = game.turnOrder.filter(id => id !== playerId);
      }
      if (game.pendingPurchaseOffer?.playerId === playerId) game.pendingPurchaseOffer = null;
      if (game.pendingPayment?.playerId === playerId) {
        game.pendingPayment = null;
        game.pendingPaymentTurnOptions = null;
      }
      if (game.pendingTrade && (game.pendingTrade.fromPlayerId === playerId || game.pendingTrade.toPlayerId === playerId)) {
        game.pendingTrade = null;
      }
      if (game.pendingPlayerContract && (game.pendingPlayerContract.fromPlayerId === playerId || game.pendingPlayerContract.toPlayerId === playerId)) {
        game.pendingPlayerContract = null;
      }
      if (game.auction?.active && game.auction.highestBidderId === playerId) game.auction.highestBidderId = null;
      if (wasCurrentTurn) {
        // nextTurn() treats an unknown current id as "before the first seat"
        // and hands the dice to the next surviving player in turn order.
        game.currentPlayerId = null;
        game.nextTurn();
      }
    }
    if (game.players.length === 0) {
      this.rooms.delete(room.roomCode);
    }
    return room;
  }
}

export { RoomManager, GameState, Room, APPEARANCE_PRESET_COLORS, AUCTION_DURATION_MS };

