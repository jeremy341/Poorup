// Bot-proposed trades: group-completing swaps and two-for-two offers, priced against both seats' portfolios.
import { deedValue, monopolyRequirement, portfolioValue, tradeSetChanges, vetoTrade, TRADE_MIN_NET_GAIN } from './botTradeValuation.js';
import { tradePairKey, tradePairCoolingOff } from './botTableMind.js';
import { contractReserve, tableObligationOpen } from './botContractPolicy.js';

export const BOT_TRADE_ASK_DEFAULT = { requestCash: 0, score: 8 };

// Grudge-gated dealing: ledgers start empty, so normalize missing entries
// to 0, since a direct Number(undefined) comparison would lock out every seat.
function grudgedOut(grudges, id) {
  return Number((grudges || {})[id] || 0) >= 3;
}

// Shared trade gating: the group and rich trade collectors refuse the same table states before pairing deeds.
// The engine refuses a proposal while an auction, purchase offer, sponsored purchase or trade is open
// (tradeApi.js), so the bot must not offer one either.
export function canOfferTrade(game, player) {
  if (game.settings.trading === false) return false;
  if (tableObligationOpen(game)) return false;
  if (game.pendingTrade) return false;
  if (game.pendingPlayerContract) return false;
  if (player?.isBot && Number(player.botDealActionsThisTurn) >= 1) return false;
  return true;
}

export function tradeTiles(game, player) {
  return (player.properties || [])
    .map(index => game.getTile(index))
    .filter(tile => tile && game.isTradeableTile(tile) && tile.group);
}

// Bots may deal with bots too (same veto applies); otherwise humans could
// exploit isolated bot seats that never cooperate.
export function tradePartners(game, player, table, grudges) {
  return game.activePlayers().filter(candidate => isDealPartner(player, table, grudges, candidate));
}

// Who a bot may propose a trade or contract to: no feeding a teaming pair, no deals with a grudge >= 3.
export function isDealPartner(player, table, grudges, candidate) {
  if (candidate.id === player.id) return false;
  if (candidate.bankrupt) return false;
  if (candidate.disconnected) return false;
  if (table.teaming && table.pair.includes(candidate.id)) return false;
  return !grudgedOut(grudges, candidate.id);
}

// Seat label the planner projects against: opponents are numbered in table order
// with the deciding bot left out, exactly as the strategic snapshot labels them.
// Without it every trade would be projected against opponent-1.
function partnerSeatLabel(game, player, partner) {
  const opponents = (game.players || []).filter(candidate => candidate.id !== player.id);
  const index = opponents.findIndex(candidate => candidate.id === partner.id);
  return index < 0 ? undefined : `opponent-${index + 1}`;
}

// Group trades exist to finish or concentrate colour sets. Same-group 1-for-1 swaps change nothing for either seat,
// so each ask is a deed of a group the bot already holds a stake in, paid for with a deed from a group the bot
// is not building, or with cash.
function groupOwnedBy(game, playerId, group) {
  return (game.getGroupTiles(group) || []).filter(tile => tile.ownerId === playerId).length;
}

// Deeds the bot can part with for `askTile`: other groups only, and never a group
// it holds all of (or all but one of: that is a set in the making).
function giveCandidates(game, player, owned, askTile) {
  return owned.filter(tile => {
    if (tile.group === askTile.group) return false;
    const total = (game.getGroupTiles(tile.group) || []).length;
    return groupOwnedBy(game, player.id, tile.group) <= total - 2;
  });
}

export function collectGroupTradeCandidates(ctx, partner, owned, out) {
  const { game } = ctx;
  const found = tradeTiles(game, partner).flatMap(askTile => groupAskCandidates(ctx, partner, owned, askTile));
  found.sort((a, b) => b.score - a.score || b.strategicValue - a.strategicValue);
  out.push(...found.slice(0, 4));
}

// Priced offers for one deed the partner holds, one per give-side option (a single tradeable deed, or cash alone).
function groupAskCandidates(ctx, partner, owned, askTile) {
  const { game, player } = ctx;
  const held = groupOwnedBy(game, player.id, askTile.group);
  if (!held) return [];
  const completer = held === (game.getGroupTiles(askTile.group) || []).length - 1;
  const gives = giveCandidates(game, player, owned, askTile).map(tile => [tile]);
  // Cash alone can buy the last deed of a set; it never buys a partial stake.
  if (completer) gives.push([]);
  return gives
    .map(giveTiles => groupTradeCandidate(ctx, partner, giveTiles, askTile))
    .filter(Boolean);
}

// One priced offer, or null: no cooled-off repeat, no value-neutral swap, no set
// handed over below the monopoly premium (priceTradeTerms enforces all three).
function groupTradeCandidate(ctx, partner, giveTiles, askTile) {
  const { game, ask, player } = ctx;
  const giveIndexes = giveTiles.map(tile => tile.index);
  const terms = offerTerms(game, player, partner, giveIndexes, [askTile.index]);
  if (!terms) return null;
  const sets = tradeSetChanges(game, player.id, giveIndexes, [askTile.index]);
  return {
    // The give tile is part of the id: two same-group give tiles for one ask are
    // distinct offers, and a shared id made the second unaddressable.
    id: 'trade:' + partner.id + ':' + askTile.index + ':' + (giveIndexes.length ? giveIndexes.join('-') : 'cash'),
    kind: 'trade',
    toPlayerId: partner.id,
    toPlayerSeat: partnerSeatLabel(game, player, partner),
    givePropertyIndexes: giveIndexes,
    requestPropertyIndexes: [askTile.index],
    giveCash: terms.giveCash,
    requestCash: terms.requestCash,
    risk: 0.2,
    score: groupTradeScore(ask, { completesGroup: sets.completes.length > 0, breaksGroup: sets.breaks.length > 0 }),
    strategicValue: terms.botGain,
    partnerGain: terms.partnerGain
  };
}

function groupTradeScore(ask, state) {
  return ask.score + (state.completesGroup ? 28 : 0) - (state.breaksGroup ? 30 : 0);
}

// Pricing plus the offer-level gates shared by group and rich trades.
function offerTerms(game, player, partner, giveIndexes, requestIndexes) {
  if (tradePairCoolingOff(player, tradePairKey(partner.id, giveIndexes, requestIndexes), game.roundNumber)) return null;
  const terms = priceTradeTerms(game, player, partner, giveIndexes, requestIndexes);
  if (!terms) return null;
  // The same veto either seat will apply on receipt, checked on the final terms.
  const trade = {
    fromPlayerId: player.id,
    toPlayerId: partner.id,
    givePropertyIndexes: giveIndexes,
    requestPropertyIndexes: requestIndexes,
    giveCash: terms.giveCash,
    requestCash: terms.requestCash
  };
  if (vetoTrade(game, trade, player.id).vetoed || vetoTrade(game, trade, partner.id).vetoed) return null;
  return terms;
}

function tradeMargin(game, requestIndexes) {
  const face = requestIndexes.reduce((sum, index) => sum + deedValue(game, game.getTile(index)), 0);
  return Math.max(TRADE_MIN_NET_GAIN, Math.ceil(face / 10));
}

// The portfolio model both trade paths price with: deeds, progress credit, and the build value of a finished set.
// Proposals are one step more generous than acceptance (portfolioValue in botTradeValuation.js). The spread is
// harmless: the monopoly premium clamps cash both ways, and every proposal clears the partner's own acceptance bar.
// Prices one swap between the bot and a partner. Both seats use the same portfolio model, and the partner
// is paid for its loss plus a margin. The cash is then pushed so neither seat hands the other a colour set
// below the monopoly premium. Returns null when the swap is value-neutral, breaks a set either seat holds, or cannot be paid.
function priceTradeTerms(game, player, partner, giveIndexes, requestIndexes) {
  if (!giveIndexes.length && !requestIndexes.length) return null;
  if (tradeSetChanges(game, player.id, giveIndexes, requestIndexes).breaks.length) return null;
  if (tradeSetChanges(game, partner.id, requestIndexes, giveIndexes).breaks.length) return null;
  const botNext = [...new Set([...(player.properties || []).filter(index => !giveIndexes.includes(index)), ...requestIndexes])];
  const partnerNext = [...new Set([...(partner.properties || []).filter(index => !requestIndexes.includes(index)), ...giveIndexes])];
  const botDelta = portfolioValue(game, player.id, botNext) - portfolioValue(game, player.id, player.properties || []);
  const partnerDelta = portfolioValue(game, partner.id, partnerNext) - portfolioValue(game, partner.id, partner.properties || []);
  if (botDelta + partnerDelta < 2 * TRADE_MIN_NET_GAIN) return null;
  // Positive = the partner pays the bot, negative = the bot pays the partner. A seat
  // that hands over a finishing deed bounds the cash from its side.
  const handsSet = monopolyRequirement(game, giveIndexes, requestIndexes, partner.id);
  const takesSet = monopolyRequirement(game, requestIndexes, giveIndexes, player.id);
  const floor = handsSet.givesMonopoly ? handsSet.needCash : -Infinity;
  const ceiling = takesSet.givesMonopoly ? -takesSet.needCash : Infinity;
  if (floor > ceiling) return null;
  // The partner is paid its own loss plus a margin (a tenth of the deeds it hands over, or half the surplus if smaller).
  // It is not paid for the build value the bot gains from a finished set: splitting that evenly priced every
  // completer beyond any bank balance.
  const partnerShare = Math.min(Math.floor((botDelta + partnerDelta) / 2), tradeMargin(game, requestIndexes));
  const net = Math.max(floor, Math.min(ceiling, partnerDelta - partnerShare));
  const giveCash = Math.max(0, -net);
  const requestCash = Math.max(0, net);
  if (requestCash > Number(partner.cash || 0)) return null;
  if (giveCash > 0 && giveCash > Number(player.cash || 0) - contractReserve(game)) return null;
  const botGain = botDelta + net;
  const partnerGain = partnerDelta - net;
  if (botGain < TRADE_MIN_NET_GAIN || partnerGain < 0) return null;
  return { giveCash, requestCash, botGain, partnerGain };
}

function tradePairs(tiles) {
  const pairs = [];
  for (let i = 0; i < tiles.length; i += 1) {
    for (let j = i + 1; j < tiles.length; j += 1) pairs.push([tiles[i].index, tiles[j].index]);
  }
  return pairs;
}

// Two-for-two offers: the best priced pair of the first three deeds each side.
export function richTradeCandidate(game, player, partner, owned) {
  const requested = tradeTiles(game, partner).slice(0, 3);
  if (requested.length < 2) return [];
  let best = null;
  for (const giveIndexes of tradePairs(owned)) {
    for (const requestIndexes of tradePairs(requested)) {
      const terms = offerTerms(game, player, partner, giveIndexes, requestIndexes);
      if (terms && (!best || terms.botGain > best.terms.botGain)) best = { giveIndexes, requestIndexes, terms };
    }
  }
  if (!best) return [];
  const { terms } = best;
  return [{
    id: 'trade:rich:' + partner.id,
    kind: 'trade',
    rich: true,
    toPlayerId: partner.id,
    toPlayerSeat: partnerSeatLabel(game, player, partner),
    givePropertyIndexes: best.giveIndexes,
    requestPropertyIndexes: best.requestIndexes,
    giveCash: terms.giveCash,
    requestCash: terms.requestCash,
    risk: 0.3,
    score: Math.max(8, Math.min(24, 16 + Math.floor(Math.min(terms.botGain, terms.partnerGain) / 100))),
    strategicValue: terms.botGain,
    partnerGain: terms.partnerGain
  }];
}
