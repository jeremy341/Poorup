// Opponent minds: beliefs, desires, intentions, emotions, and the
// relationship ledger for one bot seat (deterministic, testable).
// Theory-of-mind depth is capped at 2 (I model you; I model you modeling
// me for vetoes) per the literature: decisive without search.
// Coalition signal uses ONLY existing state (contracts, votes, live
// offers) so no persistence migration is needed. All helpers degrade on
// thin stubs. Money math is integer whole-dollars.

function number(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function livePlayers(game) {
  return (Array.isArray(game?.players) ? game.players : []).filter(
    player => player && !player.bankrupt && !player.disconnected
  );
}

function groupTiles(game, group) {
  if (typeof game?.getGroupTiles === 'function') {
    try {
      return game.getGroupTiles(group) || [];
    } catch {
      return [];
    }
  }
  return (Array.isArray(game?.tiles) ? game.tiles : []).filter(tile => tile?.group === group);
}

function allGroups(game) {
  return [...new Set((Array.isArray(game?.tiles) ? game.tiles : []).map(tile => tile?.group).filter(Boolean))];
}

// Wanted groups, most-urgent first: owned/total fraction then group size.
export function wantedGroups(game, opponentId) {
  const out = [];
  for (const group of allGroups(game)) {
    const tiles = groupTiles(game, group);
    if (!tiles.length) continue;
    const owned = tiles.filter(tile => tile?.ownerId === opponentId).length;
    if (!owned || owned >= tiles.length) continue;
    out.push({ group, owned, total: tiles.length });
  }
  return out.sort((a, b) => b.owned / b.total - a.owned / a.total || a.total - b.total);
}

// Desire class from portfolio facts: monopolist / developer / survivor /
// spoiler / drifter. Drives stage-gated risk and targeting.
export function desireClass(game, opponent) {
  if (!opponent) return 'drifter';
  const cash = Math.max(0, Math.floor(number(opponent.cash)));
  const starting = Math.max(1, Math.floor(number(game?.settings?.startingCash, 1500)));
  if (game?.pendingPayment?.playerId === opponent.id || cash < starting * 0.35) return 'survivor';
  let complete = 0;
  let nearComplete = 0;
  for (const group of allGroups(game)) {
    const tiles = groupTiles(game, group);
    if (!tiles.length) continue;
    const owned = tiles.filter(tile => tile?.ownerId === opponent.id).length;
    if (owned >= tiles.length) complete += 1;
    else if (owned >= tiles.length - 1) nearComplete += 1;
  }
  if (complete > 0 && cash >= 100) return 'developer';
  if (complete > 0 || nearComplete > 0) return 'monopolist';
  return 'drifter';
}

// Emotion readout, derived from facts only (chat is never trusted):
// desperate (debt + broke), tilting (serial rescues + casino bleed),
// cooperative (funded me / dealt fairly — from my ledger).
export function emotionReadout(game, bot, opponent) {
  if (!opponent) return 'unknown';
  const cash = Math.max(0, Math.floor(number(opponent.cash)));
  const starting = Math.max(1, Math.floor(number(game?.settings?.startingCash, 1500)));
  if (game?.pendingPayment?.playerId === opponent.id && cash < starting * 0.35) return 'desperate';
  if (number(opponent.casinoNet) < -starting * 0.5) return 'tilting';
  const gratitude = Math.max(number(bot?.gratitude?.[opponent.id]), number(bot?.sponsoredBy?.[opponent.id]) > 0 ? 1 : 0);
  if (gratitude > 0) return 'cooperative';
  const grudge = number(bot?.grudge?.[opponent.id]);
  if (grudge >= 3) return 'hostile';
  return 'steady';
}

// Alliance score between two seats from existing state only:
// active contracts (2 each) + vote alignment (1) + coalition flag (1) +
// live pending trade/sponsor between them (1 each). Bounded small ints.
export function allianceScore(game, aId, bId) {
  if (!aId || !bId || aId === bId) return 0;
  let score = 0;
  for (const contract of game?.playerContracts || []) {
    if (!['active', 'due'].includes(contract?.status)) continue;
    const pair = [contract.fromPlayerId, contract.toPlayerId];
    if (pair.includes(aId) && pair.includes(bId)) score += 2;
  }
  const a = typeof game?.getPlayerById === 'function' ? game.getPlayerById(aId) : null;
  const b = typeof game?.getPlayerById === 'function' ? game.getPlayerById(bId) : null;
  if (a?.lastVoteChoice && a.lastVoteChoice === b?.lastVoteChoice) score += 1;
  if (a?.coalitionTrade && b?.coalitionTrade) score += 1;
  const trade = game?.pendingTrade;
  if (trade && ((trade.fromPlayerId === aId && trade.toPlayerId === bId) || (trade.fromPlayerId === bId && trade.toPlayerId === aId))) score += 1;
  const sponsor = game?.pendingSponsoredPurchase;
  if (sponsor) {
    const sponsors = (sponsor.contributions || []).map(entry => entry.sponsorId);
    if (sponsor.buyerId === aId && sponsors.includes(bId)) score += 1;
    if (sponsor.buyerId === bId && sponsors.includes(aId)) score += 1;
  }
  return score;
}

// Strongest teaming signal against me: max alliance between any two OTHER
// seats, plus whether I am the odd one out of the top pair.
export function coalitionAgainst(game, botId) {
  const others = livePlayers(game).map(player => player.id).filter(id => id !== botId);
  let top = { pair: [], score: 0 };
  for (let i = 0; i < others.length; i += 1) {
    for (let j = i + 1; j < others.length; j += 1) {
      const score = allianceScore(game, others[i], others[j]);
      if (score > top.score) top = { pair: [others[i], others[j]], score };
    }
  }
  return { ...top, teaming: top.score >= 3 };
}

// Relationship ledger on my own seat: gratitude/grudge per opponent with
// per-round decay. Call once per decision tick; pure besides bot fields.
export function tickLedger(bot, roundNumber) {
  if (!bot) return;
  if (bot.ledgerRound === roundNumber) return;
  bot.ledgerRound = roundNumber;
  for (const key of ['grudge', 'gratitude']) {
    const ledger = bot[key];
    if (!ledger || typeof ledger !== 'object') continue;
    for (const id of Object.keys(ledger)) {
      ledger[id] = Math.floor(number(ledger[id]) * 0.9);
      if (ledger[id] <= 0) delete ledger[id];
    }
  }
}

export function addGrudge(bot, opponentId, amount = 1) {
  if (!bot || !opponentId) return;
  bot.grudge = bot.grudge || {};
  bot.grudge[opponentId] = number(bot.grudge[opponentId]) + Math.max(1, Math.floor(number(amount, 1)));
}

export function addGratitude(bot, opponentId, amount = 1) {
  if (!bot || !opponentId) return;
  bot.gratitude = bot.gratitude || {};
  bot.gratitude[opponentId] = number(bot.gratitude[opponentId]) + Math.max(1, Math.floor(number(amount, 1)));
}

// Full mind readout for one opponent, for traces and advisor context.
export function readMind(game, bot, opponentId) {
  const opponent = typeof game?.getPlayerById === 'function' ? game.getPlayerById(opponentId) : null;
  const others = livePlayers(game).map(player => player.id).filter(id => id !== bot?.id && id !== opponentId);
  return {
    id: opponentId,
    wanted: wantedGroups(game, opponentId).slice(0, 3),
    desire: desireClass(game, opponent),
    emotion: emotionReadout(game, bot, opponent),
    withMe: allianceScore(game, bot?.id, opponentId),
    maxWithOthers: others.length ? Math.max(...others.map(id => allianceScore(game, opponentId, id))) : 0,
    grudge: number(bot?.grudge?.[opponentId]),
    gratitude: number(bot?.gratitude?.[opponentId]),
  };
}
