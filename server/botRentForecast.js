import { PROPERTY_RENT_MULTIPLIERS, RAILROAD_RENT, UTILITY_DICE_MULTIPLIERS } from './gameData.js';

// The "premium districts" every premium mechanism keys on. Hoisted above the rule table so both paths agree on membership:
// the boom hardcoded Dark Blue while premiumEventFactors listed Metro Silver, and the boom suppresses the generic path,
// so Metro Silver's surge was dropped entirely. Metro Gold is in neither list: a design question, not a bug.
const PREMIUM_GROUPS = ['Dark Blue', 'Metro Silver'];

const DIRECT_EVENT_RULES = [
  { id: 'housing-bubble', factor: 0.65, matches: ({ tile }) => tile.type === 'property' },
  { id: 'airport-strike', factor: 0, matches: ({ tile }) => tile.type === 'railroad' },
  // Not read via factorKey: rent.test.js pins 'tourism-skips-premium-multiplier' at 45 with premiumRentMultiplier 2,
  // so the boom ignores the effect payload and uses its own 1.3. Premium groups still come from PREMIUM_GROUPS.
  { id: 'tourism-boom', factor: 1.3, matches: ({ tile }) => PREMIUM_GROUPS.includes(tile.group) },
  // factorKey reads the declared event effect so tuning the effect (e.g.
  // globalEventData anti-monopoly leaderRentMultiplier) reaches live rent
  // instead of desyncing a hardcoded duplicate.
  { id: 'anti-monopoly', factor: 0.6, factorKey: 'leaderRentMultiplier', matches: antiMonopolyTargetsOwner },
  { id: 'energy-crisis', factor: 1.5, matches: ({ tile }) => tile.type === 'utility' },
  { id: 'city-election', factor: 0.75, matches: cityElectionTargetsProperty },
];

function antiMonopolyTargetsOwner({ tile, event, ownerSeat, ownerId }) {
  if (event.resolvedChoice === 'dismiss') return false;
  if (event.targetPlayerId) return event.targetPlayerId === ownerId;
  return event.targetSeat === ownerSeat && Boolean(tile);
}

function cityElectionTargetsProperty({ tile, event }) {
  return event.resolvedChoice === 'public-works' && tile.type === 'property';
}

function directEventFactors(context) {
  return DIRECT_EVENT_RULES
    .filter(rule => rule.id === context.eventId && rule.matches(context))
    .map(rule => (rule.factorKey ? Number(context.event?.effects?.[rule.factorKey]) || rule.factor : rule.factor));
}

function infrastructureEventFactors(tile, eventId, effects) {
  const factors = [];
  if (tile.type === 'railroad' && eventId !== 'airport-strike') factors.push(effects.airportRentMultiplier);
  if (tile.type === 'utility' && eventId !== 'energy-crisis') factors.push(effects.utilityRentMultiplier);
  return factors;
}

function premiumEventFactors(tile, eventId, effects) {
  // tourism-boom applies its own direct factor above, so it suppresses this
  // path instead of double-surging the same districts.
  if (!PREMIUM_GROUPS.includes(tile.group) || eventId === 'tourism-boom') return [];
  return [effects.premiumRentMultiplier];
}

function globalEventFactors(eventId, effects) {
  if (eventId === 'housing-bubble') return [];
  const multiplier = Number(effects.rentMultiplier);
  return multiplier > 0 ? [multiplier] : [];
}

function eventFactorsFor({ tile, event, effects, ownerSeat, ownerId = null }) {
  const eventId = event?.phase === 'active' ? event.id : null;
  const context = { tile, event, ownerSeat, ownerId, eventId };
  const factors = [
    ...directEventFactors(context),
    ...infrastructureEventFactors(tile, eventId, effects),
    ...premiumEventFactors(tile, eventId, effects),
    ...globalEventFactors(eventId, effects),
  ];
  return factors.filter(value => Number.isFinite(Number(value))).map(Number);
}

function normalizeFacts({ tile, hasFullSet = false, doubleRent = false, ownedRailroadCount = 0, ownedUtilityCount = 0, diceTotal = 2, eventFactors = [], rentCap = null }) {
  return {
    tile: tile ? { ...tile } : {},
    hasFullSet: hasFullSet === true,
    doubleRent: doubleRent === true,
    ownedRailroadCount: Math.max(0, Math.floor(Number(ownedRailroadCount) || 0)),
    ownedUtilityCount: Math.max(0, Math.floor(Number(ownedUtilityCount) || 0)),
    diceTotal: Math.max(2, Math.floor(Number(diceTotal) || 0)),
    eventFactors: Array.isArray(eventFactors) ? eventFactors : [],
    rentCap: Number.isFinite(Number(rentCap)) ? Number(rentCap) : null
  };
}

function rentForProperty(tile, facts) {
  const baseRent = Number(tile.rent) || 0;
  const level = Math.max(0, Math.min(5, Math.floor(Number(tile.houseCount) || 0)));
  if (level > 0) return Math.floor(baseRent * PROPERTY_RENT_MULTIPLIERS[level]);
  const setMultiplier = facts.doubleRent && facts.hasFullSet ? 2 : 1;
  return baseRent * setMultiplier;
}

function rentForRailroad(facts) {
  const count = Math.min(Math.max(facts.ownedRailroadCount, 1), RAILROAD_RENT.length);
  return RAILROAD_RENT[count - 1];
}

function rentForUtility(tile, facts) {
  if (facts.ownedUtilityCount <= 0) return Number(tile.rent) || 20;
  const count = Math.min(facts.ownedUtilityCount, UTILITY_DICE_MULTIPLIERS.length);
  return facts.diceTotal * UTILITY_DICE_MULTIPLIERS[count - 1];
}

function baseRentFor(tile, facts) {
  if (tile.type === 'property') return rentForProperty(tile, facts);
  if (tile.type === 'railroad') return rentForRailroad(facts);
  if (tile.type === 'utility') return rentForUtility(tile, facts);
  return Number(tile.rent) || 0;
}

function applyRentFactors(rent, factors) {
  return factors.reduce((value, factor) => {
    if (!Number.isFinite(Number(factor))) return value;
    return value * Number(factor);
  }, rent);
}

// The rent cap is a per-payment ceiling the live engine charges once, after
// the event factors. Projects that price rent elsewhere (the bot auction
// ceiling) share this helper so they cannot disagree with the charge.
export function applyRentCap(rent, rentCap) {
  return rentCap > 0 ? Math.min(rent, rentCap) : rent;
}

export function calculateRentFromFacts(facts) {
  const normalized = normalizeFacts(facts || {});
  if (normalized.tile.mortgaged) return 0;
  const baseRent = baseRentFor(normalized.tile, normalized);
  const adjustedRent = applyRentFactors(baseRent, normalized.eventFactors);
  return Math.max(0, Math.floor(applyRentCap(adjustedRent, normalized.rentCap)));
}

function gameOwner(game, tile) {
  if (typeof game?.getPlayerById !== 'function') return null;
  return game.getPlayerById(tile?.ownerId);
}

function gameOwnerSeat(game, owner) {
  if (!owner) return 'bank';
  const ownerIndex = (game.players || []).indexOf(owner);
  return ownerIndex === 0 ? 'self' : `opponent-${ownerIndex}`;
}

function countOwnedGameAssets(game, ownerId, type) {
  return (game?.tiles || []).filter(entry => entry.type === type && entry.ownerId === ownerId && !entry.mortgaged).length;
}

function storedGameDiceTotal(game) {
  const dice = game?.lastDice || [];
  return Math.max(2, (dice[0] || 0) + (dice[1] || 0));
}

function gameDiceTotal(game, diceTotal) {
  return diceTotal ?? storedGameDiceTotal(game);
}

function gameRentEffects(game) {
  if (typeof game?.activeEventEffects !== 'function') return {};
  return game.activeEventEffects();
}

function gameRentCap(effects) {
  const cap = Number(effects.rentCap);
  return cap;
}

function gameOwnedCount(game, owner, tile, type) {
  if (!owner) return 0;
  return countOwnedGameAssets(game, tile?.ownerId, type);
}

function gameRentContext(game, tile) {
  const owner = gameOwner(game, tile);
  const ownerSeat = gameOwnerSeat(game, owner);
  const effects = gameRentEffects(game);
  return { owner, ownerSeat, effects, event: game?.globalEvent || null, rentCap: gameRentCap(effects) };
}

function ownerHasFullSet(game, owner, tile) {
  if (!owner) return false;
  if (!tile?.group) return false;
  return game.hasFullSet(owner.id, tile.group);
}

export function rentFactsFromGame(game, tile, diceTotal) {
  const context = gameRentContext(game, tile);
  return normalizeFacts({
    tile,
    hasFullSet: ownerHasFullSet(game, context.owner, tile),
    doubleRent: game?.settings?.doubleRent,
    ownedRailroadCount: gameOwnedCount(game, context.owner, tile, 'railroad'),
    ownedUtilityCount: gameOwnedCount(game, context.owner, tile, 'utility'),
    diceTotal: gameDiceTotal(game, diceTotal),
    eventFactors: eventFactorsFor({ tile: tile || {}, ...context, ownerId: context.owner?.id }),
    rentCap: context.rentCap
  });
}

// One pass over the board answers every ownership question a rent lookup asks: the tile's group (size and how much
// the owner holds) and the owner's unmortgaged railroads and utilities. The planner calls this millions of times per
// expert match, so it must not filter the board once per question.
function snapshotBoardCounts(board, group, ownerSeat) {
  const countsOwnedAssets = ownerSeat !== 'bank';
  let groupSize = 0;
  let groupOwned = 0;
  let railroads = 0;
  let utilities = 0;
  for (let index = 0; index < board.length; index += 1) {
    const entry = board[index];
    const ownedByOwner = entry.ownerSeat === ownerSeat;
    if (group && entry.group === group) {
      groupSize += 1;
      if (ownedByOwner) groupOwned += 1;
    }
    if (countsOwnedAssets && ownedByOwner && !entry.mortgaged) {
      if (entry.type === 'railroad') railroads += 1;
      else if (entry.type === 'utility') utilities += 1;
    }
  }
  return { hasFullSet: groupSize > 0 && groupSize === groupOwned, railroads, utilities };
}

function snapshotEffects(snapshot) {
  return snapshot?.rulesDigest?.globalEvents?.activeEffects || {};
}

function snapshotOwnerSeat(tile) {
  return tile?.ownerSeat || 'bank';
}

function snapshotRentContext(snapshot) {
  const effects = snapshotEffects(snapshot);
  return {
    effects,
    event: snapshot?.activeEvent || null,
    doubleRent: snapshot?.rulesDigest?.doubleRent,
  };
}

export function rentFactsFromSnapshot(snapshot, tile, diceTotal) {
  const board = snapshot?.board || [];
  const ownerSeat = snapshotOwnerSeat(tile);
  const counts = snapshotBoardCounts(board, tile?.group, ownerSeat);
  const context = snapshotRentContext(snapshot);
  return normalizeFacts({
    tile,
    hasFullSet: counts.hasFullSet,
    doubleRent: context.doubleRent,
    ownedRailroadCount: counts.railroads,
    ownedUtilityCount: counts.utilities,
    diceTotal,
    eventFactors: eventFactorsFor({ tile: tile || {}, event: context.event, effects: context.effects, ownerSeat }),
    rentCap: context.effects.rentCap
  });
}
