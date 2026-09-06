// Global-event vocabulary as data: the definition table, the curated
// combination pairs, and the dispatch tables mirroring CARD_ACTION_HANDLERS
// and RENT_EVENT_MODIFIERS: activation-time targets, per-event activation
// hooks, vote-outcome side effects, and ordered activation settlements.
// Every entry encodes the exact condition and mutation the original inline
// if-ladders performed; the settlement order is observable (feed order and
// cash deltas), so the array sequence is frozen. server/global-events.test.js
// pins every title, summary, and effect payload through the live game loop.

const GLOBAL_EVENT_COOLDOWN_ROUNDS = 3;
const GLOBAL_EVENT_MIN_ROUND = 3;
// The spellings that turn headlines on (the '1' string is legacy-only and
// stays in ROOM_FLAG_TRUE_VALUES for the other boolean settings).
const GLOBAL_EVENTS_ENABLED_VALUES = [true, 1, 'true', 'on', 'rare', 'hardcore'];

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

export {
  GLOBAL_EVENT_ACTIVATION_HOOKS,
  GLOBAL_EVENT_COOLDOWN_ROUNDS,
  GLOBAL_EVENT_COMBINATIONS,
  GLOBAL_EVENT_DEFINITIONS,
  GLOBAL_EVENT_MIN_ROUND,
  GLOBAL_EVENT_SETTLEMENT_STEPS,
  GLOBAL_EVENT_TARGET_FINDERS,
  GLOBAL_EVENT_VOTE_OUTCOME_HANDLERS,
  GLOBAL_EVENTS_ENABLED_VALUES,
  positiveFiniteEffect
};
