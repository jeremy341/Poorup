import { PROPERTY_RENT_MULTIPLIERS, RAILROAD_RENT } from './gameData.js';

const DIRECT_EVENT_RULES = [
  { id: 'housing-bubble', factor: 0.65, matches: ({ tile }) => tile.type === 'property' },
  { id: 'airport-strike', factor: 0, matches: ({ tile }) => tile.type === 'railroad' },
  { id: 'tourism-boom', factor: 1.3, matches: ({ tile }) => tile.group === 'Dark Blue' },
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
  const premiumGroups = ['Dark Blue', 'Metro Silver'];
  const isPremiumGroup = premiumGroups.includes(tile.group);
  if (!isPremiumGroup || eventId === 'tourism-boom') return [];
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
  const multiplier = facts.ownedUtilityCount >= 2 ? 10 : 4;
  return facts.diceTotal * multiplier;
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

function applyRentCap(rent, rentCap) {
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

function snapshotOwnerTiles(board, ownerSeat) {
  return board.filter(entry => entry.ownerSeat === ownerSeat && ownerSeat !== 'bank' && !entry.mortgaged);
}

function snapshotHasFullSet(tile, groupTiles, ownerSeat) {
  return Boolean(tile?.group && groupTiles.length > 0 && groupTiles.every(entry => entry.ownerSeat === ownerSeat));
}

function snapshotEffects(snapshot) {
  return snapshot?.rulesDigest?.globalEvents?.activeEffects || {};
}

function snapshotOwnerSeat(tile) {
  return tile?.ownerSeat || 'bank';
}

function snapshotGroupTiles(board, tile) {
  return board.filter(entry => entry.group === tile?.group);
}

function snapshotOwnedCount(ownerTiles, type) {
  return ownerTiles.filter(entry => entry.type === type).length;
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
  const ownerTiles = snapshotOwnerTiles(board, ownerSeat);
  const groupTiles = snapshotGroupTiles(board, tile);
  const context = snapshotRentContext(snapshot);
  return normalizeFacts({
    tile,
    hasFullSet: snapshotHasFullSet(tile, groupTiles, ownerSeat),
    doubleRent: context.doubleRent,
    ownedRailroadCount: snapshotOwnedCount(ownerTiles, 'railroad'),
    ownedUtilityCount: snapshotOwnedCount(ownerTiles, 'utility'),
    diceTotal,
    eventFactors: eventFactorsFor({ tile: tile || {}, event: context.event, effects: context.effects, ownerSeat }),
    rentCap: context.effects.rentCap
  });
}
