import { PROPERTY_RENT_MULTIPLIERS, RAILROAD_RENT } from './gameData.js';

function eventFactorsFor(tile, event, effects, ownerSeat, ownerId = null) {
  const active = event?.phase === 'active';
  const eventId = active ? event.id : null;
  const factors = [];
  if (eventId === 'housing-bubble' && tile.type === 'property') factors.push(0.65);
  if (eventId === 'airport-strike' && tile.type === 'railroad') factors.push(0);
  if (eventId === 'tourism-boom' && tile.group === 'Dark Blue') factors.push(1.3);
  const targetSeat = event?.targetSeat;
  const targetsOwner = event?.targetPlayerId
    ? event.targetPlayerId === ownerId
    : targetSeat && targetSeat === ownerSeat;
  if (eventId === 'anti-monopoly' && targetsOwner && event.resolvedChoice !== 'dismiss') factors.push(0.6);
  if (eventId === 'energy-crisis' && tile.type === 'utility') factors.push(1.5);
  if (eventId === 'city-election' && event.resolvedChoice === 'public-works' && tile.type === 'property') factors.push(0.75);
  if (tile.type === 'railroad' && eventId !== 'airport-strike') factors.push(effects.airportRentMultiplier);
  if (tile.type === 'utility' && eventId !== 'energy-crisis') factors.push(effects.utilityRentMultiplier);
  if ((tile.group === 'Dark Blue' || tile.group === 'Metro Silver') && eventId !== 'tourism-boom') factors.push(effects.premiumRentMultiplier);
  if (eventId !== 'housing-bubble') {
    const globalMultiplier = Number(effects.rentMultiplier);
    if (globalMultiplier > 0) factors.push(globalMultiplier);
  }
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

export function calculateRentFromFacts(facts) {
  const normalized = normalizeFacts(facts || {});
  const { tile } = normalized;
  if (tile.mortgaged) return 0;
  let rent;
  if (tile.type === 'property') {
    const level = Math.max(0, Math.min(5, Math.floor(Number(tile.houseCount) || 0)));
    rent = level > 0
      ? Math.floor((Number(tile.rent) || 0) * PROPERTY_RENT_MULTIPLIERS[level])
      : (Number(tile.rent) || 0) * (normalized.doubleRent && normalized.hasFullSet ? 2 : 1);
  } else if (tile.type === 'railroad') {
    rent = RAILROAD_RENT[Math.min(Math.max(normalized.ownedRailroadCount, 1), RAILROAD_RENT.length) - 1];
  } else if (tile.type === 'utility') {
    rent = normalized.ownedUtilityCount > 0
      ? normalized.diceTotal * (normalized.ownedUtilityCount >= 2 ? 10 : 4)
      : Number(tile.rent) || 20;
  } else {
    rent = Number(tile.rent) || 0;
  }
  for (const factor of normalized.eventFactors) {
    if (Number.isFinite(Number(factor))) rent *= Number(factor);
  }
  if (normalized.rentCap > 0) rent = Math.min(rent, normalized.rentCap);
  return Math.max(0, Math.floor(rent));
}

export function rentFactsFromGame(game, tile, diceTotal) {
  const owner = typeof game?.getPlayerById === 'function' ? game.getPlayerById(tile?.ownerId) : null;
  const ownerSeat = owner ? (game.players || []).indexOf(owner) === 0 ? 'self' : `opponent-${(game.players || []).indexOf(owner)}` : 'bank';
  const owned = type => (game?.tiles || []).filter(entry => entry.type === type && entry.ownerId === tile?.ownerId && !entry.mortgaged).length;
  const effects = typeof game?.activeEventEffects === 'function' ? game.activeEventEffects() : {};
  const event = game?.globalEvent || null;
  const cap = Number(effects.rentCap);
  return normalizeFacts({
    tile,
    hasFullSet: Boolean(owner && tile?.group && game.hasFullSet(owner.id, tile.group)),
    doubleRent: game?.settings?.doubleRent,
    ownedRailroadCount: owner ? owned('railroad') : 0,
    ownedUtilityCount: owner ? owned('utility') : 0,
    diceTotal: diceTotal ?? Math.max(2, (game?.lastDice?.[0] || 0) + (game?.lastDice?.[1] || 0)),
    eventFactors: eventFactorsFor(tile || {}, event, effects, ownerSeat, owner?.id),
    rentCap: cap
  });
}

export function rentFactsFromSnapshot(snapshot, tile, diceTotal) {
  const board = snapshot?.board || [];
  const ownerSeat = tile?.ownerSeat || 'bank';
  const ownerTiles = board.filter(entry => entry.ownerSeat === ownerSeat && ownerSeat !== 'bank' && !entry.mortgaged);
  const groupTiles = board.filter(entry => entry.group === tile?.group);
  const event = snapshot?.activeEvent || null;
  const effects = snapshot?.rulesDigest?.globalEvents?.activeEffects || {};
  return normalizeFacts({
    tile,
    hasFullSet: Boolean(tile?.group && groupTiles.length > 0 && groupTiles.every(entry => entry.ownerSeat === ownerSeat)),
    doubleRent: snapshot?.rulesDigest?.doubleRent,
    ownedRailroadCount: ownerTiles.filter(entry => entry.type === 'railroad').length,
    ownedUtilityCount: ownerTiles.filter(entry => entry.type === 'utility').length,
    diceTotal,
    eventFactors: eventFactorsFor(tile || {}, event, effects, ownerSeat),
    rentCap: effects.rentCap
  });
}
