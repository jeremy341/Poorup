// Bot decision support as a prototype mixin: socket impersonation for
// bot-driven actions and the pre-roll candidate ranking. The candidate
// arrays keep the original collector order; the final sort is stable, so
// ties keep this sequence. kind values are the contract consumed by
// botLogic's CANDIDATE_MAPPERS/CANDIDATE_RUNNERS tables.
import { MARKET_FEE_RATE } from './marketLogic.js';
import { JAIL_FINE } from './gameData.js';

const BOT_CANDIDATE_SOURCES = [
  { collect: (game, player) => game.botJailCandidates(player) },
  { collect: (game, player) => game.botBuildCandidates(player) },
  { collect: (game, player) => game.botMortgageCandidates(player) },
  { collect: (game, player) => game.botRepaymentCandidates(player) },
  { collect: (game, player) => game.botBankLoanRepaymentCandidates(player) },
  { collect: (game, player) => game.botLoanCandidate(player) },
  { collect: (game, player, options) => options.expanded ? game.botGroupTradeCandidates(player) : game.botGroupTradeCandidate(player) },
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

const BOT_TABLE_TALK = {
  builder: 'I am building the street one square at a time.',
  shark: 'The table is pricing risk incorrectly.',
  survivor: 'Cash first. The next rent bill is always closer than it looks.',
  speculator: 'The numbers are moving; I am watching the spread.',
  diplomat: 'There is probably a deal that leaves both wallets standing.',
  chaos: 'I have a plan. It is not the safe one.'
};

const BOT_TRADE_ASKS = {
  shark: { requestCash: 40, score: 8 },
  diplomat: { requestCash: 0, score: 24 }
};
const BOT_TRADE_ASK_DEFAULT = { requestCash: 0, score: 8 };

function pendingPurchaseCandidate(game, player, offer) {
  if (offer?.playerId !== player.id) return null;
  const tile = game.getTile(offer.tileIndex);
  return {
    id: 'purchase:' + offer.tileIndex,
    kind: 'purchase',
    tileIndex: offer.tileIndex,
    price: Number(tile?.price) || 0,
    risk: Number(tile?.price || 0) / Math.max(1, Number(player.cash || 0)),
    score: 26
  };
}

function appendPostRollParityCandidates(game, player, options, candidates) {
  if (!options.parity) return;
  candidates.push(...game.botContractCandidates(player));
  candidates.push(...game.botRichTradeCandidates(player));
  candidates.push(...(options.expanded ? game.botGroupTradeCandidates(player) : game.botGroupTradeCandidate(player)));
  candidates.push(...game.botMarketCandidates(player));
  candidates.push(...game.botMarketExpansionCandidates(player));
  candidates.push(...game.botCasinoCandidate(player));
  candidates.push(...game.botSocialCandidates(player));
}

function postRollCandidates(game, player, options) {
  const candidates = [];
  candidates.push(...game.botRepaymentCandidates(player));
  candidates.push(...game.botBankLoanRepaymentCandidates(player));
  candidates.push(...game.botMortgageCandidates(player));
  candidates.push(...game.botUnmortgageCandidates(player));
  if (player.personality === 'speculator') candidates.push(...game.botLoanCandidate(player));
  appendPostRollParityCandidates(game, player, options, candidates);
  if (game.settings.market) candidates.push({ id: 'end-finance-window', kind: 'end-finance-window', risk: 0, score: -49 });
  candidates.push({ id: 'end-turn', kind: 'end-turn', risk: 0, score: -50 });
  return candidates.sort((a, b) => b.score - a.score || a.risk - b.risk);
}

// Candidate risk against a cash floor of 1, so collectors never divide by
// zero while keeping the original ternary-ladder values verbatim.
function riskAgainstCash(amount, cash) {
  return amount / Math.max(1, cash);
}

// Personality score ladders as tables: the original ternaries mapped one
// personality to a premium score and everyone else to a default.
const BOT_BUILD_SCORES = { builder: 30 };
const BOT_BUILD_SCORE_DEFAULT = 10;
const BOT_MORTGAGE_SCORES = { survivor: 24 };
const BOT_MORTGAGE_SCORE_DEFAULT = 8;
const BOT_LOAN_SCORES = { speculator: 18 };
const BOT_LOAN_SCORE_DEFAULT = -20;
const BOT_MARKET_SCORES = { speculator: 20 };
const BOT_MARKET_SCORE_DEFAULT = 4;

function finiteOrZero(value) {
  const number = Number(value);
  return Number.isFinite(number) ? number : 0;
}

const botApi = {
  recordBotDecisionTrace(entry = {}) {
    const trace = {
      botId: entry.botId ? String(entry.botId).slice(0, 80) : null,
      gameId: entry.gameId ? String(entry.gameId).slice(0, 120) : null,
      ruleVersion: String(entry.ruleVersion || 'bot-policy-v1').slice(0, 32),
      sequence: Math.max(0, Math.floor(finiteOrZero(entry.decisionSequence))),
      phase: String(entry.phase || 'unknown').slice(0, 24),
      provider: String(entry.provider || 'deterministic').slice(0, 24),
      fallback: entry.fallback === true,
      success: entry.success !== false,
      fallbackReason: entry.fallbackReason ? String(entry.fallbackReason).slice(0, 40) : null,
      brain: String(entry.brain || this.settings.botBrain || 'auto').slice(0, 12),
      difficulty: String(entry.difficulty || this.settings.botDifficulty || 'table').slice(0, 12),
      planningHorizon: Math.max(0, Math.min(3, Math.floor(finiteOrZero(entry.planningHorizon)))),
      strategicScore: Number.isFinite(Number(entry.strategicScore)) ? Number(entry.strategicScore) : null,
      actionId: entry.actionId ? String(entry.actionId).slice(0, 100) : null,
      confidence: Math.max(0, Math.min(1, finiteOrZero(entry.confidence))),
      reasonCode: entry.reasonCode ? String(entry.reasonCode).slice(0, 40) : 'unknown',
      latencyMs: Math.max(0, Math.floor(finiteOrZero(entry.latencyMs))),
      candidateIds: Array.isArray(entry.candidateIds) ? entry.candidateIds.filter(id => typeof id === 'string').slice(0, 24).map(id => id.slice(0, 100)) : [],
      shadowActionId: entry.shadowActionId ? String(entry.shadowActionId).slice(0, 100) : null,
      shadowConfidence: entry.shadowConfidence == null ? null : Math.max(0, Math.min(1, finiteOrZero(entry.shadowConfidence))),
      shadowProvider: entry.shadowProvider ? String(entry.shadowProvider).slice(0, 24) : null,
      shadowAgreement: entry.shadowAgreement === true,
      shadowModel: entry.shadowModel ? String(entry.shadowModel).slice(0, 48) : null,
      recordedAt: new Date().toISOString()
    };
    this.botDecisionTrace = Array.isArray(this.botDecisionTrace) ? this.botDecisionTrace : [];
    this.botDecisionTrace.push(trace);
    if (this.botDecisionTrace.length > 200) this.botDecisionTrace.splice(0, this.botDecisionTrace.length - 200);
    return trace;
  },

  runBotAction(playerId, action) {
    const bot = this.getPlayerById(playerId);
    const rejection = this.botActionRejection(bot, action);
    if (rejection) return rejection;
    return this.actAsBotSocket(bot, action);
  },

  botActionRejection(bot, action) {
    if (!bot) return { success: false, error: 'Bot not found.' };
    if (!bot.isBot) return { success: false, error: 'Bot not found.' };
    if (bot.bankrupt || bot.disconnected) return { success: false, error: 'Bot is unavailable.' };
    if (typeof action !== 'function') return { success: false, error: 'Bot not found.' };
    return null;
  },

  // Bots act through the same socket-keyed methods humans do; the seat's
  // socketId is swapped to the bot actor key for the duration of the call.
  actAsBotSocket(bot, action) {
    const previousSocketId = bot.socketId;
    const actorId = `bot:${bot.id}`;
    bot.socketId = actorId;
    try {
      return action(actorId);
    } finally {
      bot.socketId = previousSocketId;
    }
  },

  // Roll is always available; the pre-roll table appends the remaining
  // candidate sources in their historical order, then the stable sort ranks
  // them by score desc, risk asc.
  getBotCandidates(player, options = {}) {
    if (!player?.isBot) return [];
    if (options.postRoll) return this.botPostRollCandidates(player, options);
    const candidates = [{ id: 'roll', kind: 'roll', risk: 0, score: 0 }];
    if (!this.hasRolled && player.inJail && options.parity) {
      return candidates.concat(this.botJailCandidates(player)).sort((a, b) => b.score - a.score || a.risk - b.risk);
    }
    if (!this.hasRolled) {
      for (const source of BOT_CANDIDATE_SOURCES) {
        candidates.push(...source.collect(this, player, options));
      }
      if (options.parity) {
        candidates.push(...this.botSellCandidates(player));
        candidates.push(...this.botUnmortgageCandidates(player));
        candidates.push(...this.botContractCandidates(player));
        candidates.push(...this.botRichTradeCandidates(player));
      candidates.push(...this.botMarketCandidates(player).filter(candidate => candidate.side === 'sell'));
      candidates.push(...this.botMarketExpansionCandidates(player));
        candidates.push(...this.botSocialCandidates(player));
      }
    }
    return candidates.sort((a, b) => b.score - a.score || a.risk - b.risk);
  },

  // Once movement has resolved, humans may still use the finance rail before
  // ending their turn. Keep that same window available to both bot brains. A
  // pending purchase is the only table obligation that takes precedence over
  // the normal finance actions; otherwise candidates are legal post-roll
  // verbs and a low-priority explicit end-turn sentinel.
  botPostRollCandidates(player, options = {}) {
    if (!player?.isBot || player.id !== this.currentPlayerId) return [];
    const offer = this.pendingPurchaseOffer;
    const purchase = pendingPurchaseCandidate(this, player, offer);
    if (purchase) return [purchase];
    if (offer) return [];
    return postRollCandidates(this, player, options);
  },

  botJailCandidates(player) {
    if (!player?.inJail) return [];
    const choices = [];
    if (player.cash >= JAIL_FINE) choices.push({ id: 'jail:fine', kind: 'jail-fine', risk: JAIL_FINE / Math.max(1, player.cash), score: player.jailTurns >= 2 ? 14 : 8 });
    if (player.jailFreeCards > 0) choices.push({ id: 'jail:free', kind: 'jail-free', risk: 0.05, score: player.jailTurns >= 2 ? 16 : 7 });
    return choices;
  },

  botSocialCandidates(player) {
    const sequence = Math.max(0, Math.floor(Number(this.botDecisionSequence) || 0));
    if (!player || sequence === 0 || sequence % 6 !== 0) return [];
    return [{ id: 'chat:table-talk', kind: 'chat', text: BOT_TABLE_TALK[player.personality] || BOT_TABLE_TALK.survivor, risk: 0, score: 1 }];
  },

  botBankLoanRepaymentCandidates(player) {
    const loan = player?.bankLoan;
    if (!loan || !['active', 'due'].includes(loan.status)) return [];
    if (player.id !== this.currentPlayerId) return [];
    const remaining = Math.max(0, Math.floor(Number(loan.remaining) || 0));
    const reserve = loan.status === 'due' ? 0 : 180;
    const amount = Math.min(remaining, Math.max(0, Math.floor(Number(player.cash || 0) - reserve)));
    if (amount <= 0) return [];
    return [{ id: 'bank-repay:' + player.id + ':' + (player.bankLoanCount || loan.issuedRound || 0), kind: 'bank-repay', amount, remaining, issuedRound: loan.issuedRound || 0, dueRound: loan.dueRound || 0, loanCount: player.bankLoanCount || 0, risk: amount / Math.max(1, player.cash), score: loan.status === 'due' ? 34 : 13 }];
  },

  botBuildCandidates(player) {
    const buildLimit = Number(this.activeEventEffects?.().buildingLimitPerTurn);
    if (Number.isFinite(buildLimit) && buildLimit > 0 && (player.buildActionsThisTurn || 0) >= buildLimit) return [];
    return this.tiles
      .filter(tile => this.canBuildOnTile(player, tile))
      .map(tile => this.botBuildCandidateFor(tile, player));
  },

  botBuildCandidateFor(tile, player) {
    const cost = this.getPropertyHouseCost(tile);
    return {
      id: 'build:' + tile.index,
      kind: 'build',
      tileIndex: tile.index,
      cost,
      risk: riskAgainstCash(cost, player.cash),
      score: BOT_BUILD_SCORES[player.personality] || BOT_BUILD_SCORE_DEFAULT
    };
  },

  botMortgageCandidates(player) {
    if (player.cash >= 180) return [];
    return this.tiles
      .filter(tile => this.canMortgageTile(player, tile))
      .map(tile => this.botMortgageCandidateFor(tile, player));
  },

  botSellCandidates(player) {
    if (!player || player.id !== this.currentPlayerId) return [];
    const crisis = Boolean(this.globalEventActive?.('housing-bubble'));
    if (!crisis && Number(player.cash || 0) >= Number(this.settings.startingCash || 1500) * 0.5) return [];
    return (player.properties || [])
      .map(index => this.getTile(index))
      .filter(tile => tile && tile.houseCount > 0 && this.canSellFromTile(player, tile))
      .map(tile => {
        const proceeds = Math.max(0, Math.floor(this.getPropertyHouseCost(tile) * this.buildingSaleMultiplier()));
        return { id: 'sell:' + tile.index, kind: 'sell', tileIndex: tile.index, proceeds, risk: 0.12, score: crisis ? 15 : 10 };
      });
  },

  botUnmortgageCandidates(player) {
    if (!player || player.id !== this.currentPlayerId) return [];
    return (player.properties || [])
      .map(index => this.getTile(index))
      .filter(tile => tile && this.canUnmortgageTile(player, tile))
      .map(tile => {
        const multiplier = typeof this.propertyValueMultiplier === 'function' ? this.propertyValueMultiplier() : 1;
        const cost = Math.ceil(Math.floor((tile.price || 0) / 2) * 1.1 * multiplier);
        if (player.cash < cost + 180) return null;
        return { id: 'unmortgage:' + tile.index, kind: 'unmortgage', tileIndex: tile.index, cost, risk: cost / Math.max(1, player.cash), score: 9 };
      })
      .filter(Boolean);
  },

  botMortgageCandidateFor(tile, player) {
    const valueMultiplier = Number(this.activeEventEffects?.().propertyValueMultiplier);
    const multiplier = Number.isFinite(valueMultiplier) && valueMultiplier > 0 ? valueMultiplier : 1;
    return {
      id: 'mortgage:' + tile.index,
      kind: 'mortgage',
      tileIndex: tile.index,
      proceeds: Math.floor((tile.price || 0) / 2 * multiplier),
      risk: 0.25,
      score: BOT_MORTGAGE_SCORES[player.personality] || BOT_MORTGAGE_SCORE_DEFAULT
    };
  },

  botLoanCandidate(player) {
    const loan = this.getBankLoanOffer(player);
    if (!loan.available) return [];
    return [{
      id: 'loan:emergency',
      kind: 'loan',
      principal: loan.principal,
      totalDue: loan.totalDue,
      premium: loan.premium,
      dueRound: loan.dueRound,
      cureRound: loan.cureRound,
      collateralTileIndex: loan.collateralTileIndex,
      risk: loan.totalDue / loan.principal,
      score: BOT_LOAN_SCORES[player.personality] || BOT_LOAN_SCORE_DEFAULT
    }];
  },

  // Repay player loans proactively when the bot can do so without draining
  // its liquidity floor. Due contracts are settled first; active contracts
  // are paid down only when the remaining balance is comfortably affordable.
  botRepaymentCandidates(player) {
    const contracts = Array.isArray(this.playerContracts) ? this.playerContracts : [];
    return contracts
      .filter(contract => contract
        && ['loan', 'hybrid'].includes(contract.kind)
        && ['active', 'due'].includes(contract.status)
        && contract.toPlayerId === player.id
        && Number(contract.remaining) > 0)
      .map(contract => {
        const remaining = Math.max(0, Math.floor(Number(contract.remaining) || 0));
        const due = contract.status === 'due';
        const available = Math.max(0, Math.floor(Number(player.cash || 0) - (due ? 0 : 180)));
        const amount = Math.min(remaining, available);
        if (amount <= 0) return null;
        return {
          id: 'repay:' + contract.id,
          kind: 'repay',
          contractId: contract.id,
          amount,
          remaining,
          risk: due ? 0.05 : amount / Math.max(1, player.cash),
          score: due ? 32 : 11
        };
      })
      .filter(Boolean);
  },

  botGroupTradeCandidate(player) {
    return this.botGroupTradeCandidates(player).slice(0, 1);
  },

  botGroupTradeCandidates(player) {
    if (this.settings.trading === false) return [];
    const ask = BOT_TRADE_ASKS[player.personality] || BOT_TRADE_ASK_DEFAULT;
    const owned = player.properties.map(index => this.getTile(index)).filter(tile => tile && this.isTradeableTile(tile) && tile.group);
    const partners = this.activePlayers().filter(candidate => candidate.id !== player.id && !candidate.isBot);
    const candidates = [];
    partners.forEach(partner => {
      const requested = partner.properties.map(index => this.getTile(index)).filter(tile => tile && this.isTradeableTile(tile) && tile.group);
      owned.forEach(giveTile => requested.filter(askTile => askTile.group === giveTile.group).forEach(askTile => {
        const botOwnedBefore = this.getGroupTiles(giveTile.group).filter(tile => tile.ownerId === player.id).length;
        const botOwnedAfter = botOwnedBefore - 1 + (askTile.ownerId === partner.id ? 1 : 0);
        const targetCount = this.getGroupTiles(giveTile.group).length;
        const completesGroup = botOwnedAfter >= targetCount;
        const breaksGroup = botOwnedBefore >= targetCount && botOwnedAfter < targetCount;
        candidates.push({
          id: 'trade:' + partner.id + ':' + askTile.index,
          kind: 'trade',
          toPlayerId: partner.id,
          givePropertyIndexes: [giveTile.index],
          requestPropertyIndexes: [askTile.index],
          giveCash: 0,
          requestCash: ask.requestCash,
          risk: 0.2,
          score: ask.score + (completesGroup ? 28 : 0) - (breaksGroup ? 30 : 0)
        });
      }));
    });
    return candidates.slice(0, 12);
  },

  botRichTradeCandidates(player) {
    if (this.settings.trading === false) return [];
    const partners = this.activePlayers().filter(candidate => candidate.id !== player.id && !candidate.bankrupt && !candidate.disconnected);
    const owned = (player.properties || []).map(index => this.getTile(index)).filter(tile => tile && this.isTradeableTile(tile) && tile.group).slice(0, 3);
    if (owned.length < 2) return [];
    return partners.flatMap(partner => {
      const requested = (partner.properties || []).map(index => this.getTile(index)).filter(tile => tile && this.isTradeableTile(tile) && tile.group).slice(0, 3);
      if (requested.length < 2) return [];
      return [{
        id: 'trade:rich:' + partner.id,
        kind: 'trade',
        rich: true,
        toPlayerId: partner.id,
        givePropertyIndexes: owned.slice(0, 2).map(tile => tile.index),
        requestPropertyIndexes: requested.slice(0, 2).map(tile => tile.index),
        giveCash: 0,
        requestCash: Math.max(0, Math.floor((requested[0].price + requested[1].price - owned[0].price - owned[1].price) * 0.2)),
        risk: 0.3,
        score: 18
      }];
    }).slice(0, 4);
  },

  botContractCandidates(player) {
    if (!player || player.id !== this.currentPlayerId) return [];
    const reserve = Math.max(180, Number(this.settings.startingCash || 1500) * 0.2);
    const lenderCash = Number(player.cash || 0);
    if (lenderCash <= reserve + 100) return [];
    const targets = this.activePlayers()
      .filter(target => target.id !== player.id && !target.bankrupt && !target.disconnected)
      .sort((a, b) => Number(a.cash || 0) - Number(b.cash || 0))
      .slice(0, 2);
    const result = [];
    targets.forEach(target => {
      const amount = Math.min(300, Math.max(100, Math.floor(Math.max(0, lenderCash - reserve) / 3)));
      result.push({ id: 'contract:loan:' + target.id, kind: 'contract-propose', offer: { toPlayerId: target.id, kind: 'loan', amount, premiumRate: 35, durationRounds: 3, collateralTileIndex: null }, risk: amount / lenderCash, score: 10 + Math.max(0, 300 - Number(target.cash || 0)) / 100 });
      const property = (target.properties || []).map(index => this.getTile(index)).find(tile => tile && this.isTradeableTile(tile) && tile.houseCount === 0 && !tile.mortgaged);
      if (!property) return;
      result.push({ id: 'contract:equity:' + target.id + ':' + property.index, kind: 'contract-propose', offer: { toPlayerId: target.id, kind: 'equity', amount: Math.min(200, Math.max(50, Math.floor((lenderCash - reserve) / 5))), premiumRate: 0, durationRounds: 10, propertyIndex: property.index, equityShare: 15, equityControl: 'passive', permanent: false }, risk: 0.2, score: 8 });
      result.push({ id: 'contract:hybrid:' + target.id + ':' + property.index, kind: 'contract-propose', offer: { toPlayerId: target.id, kind: 'hybrid', amount: Math.min(200, Math.max(50, Math.floor((lenderCash - reserve) / 5))), premiumRate: 25, durationRounds: 4, propertyIndex: property.index, conversionShare: 25 }, risk: 0.3, score: 7 });
    });
    return result.slice(0, 8);
  },

  botMarketCandidates(player) {
    const buy = this.botMarketCandidate(player);
    if (!this.settings.market || (player.marketActionsThisTurn || 0) >= 1) return buy;
    const sells = Object.entries(player.marketPositions || {}).map(([id, position]) => {
      const quantity = Math.max(0, Math.floor(Number(position?.quantity) || 0));
      if (!quantity) return null;
      const quote = Number(this.marketQuotes[id]) || 100;
      const average = Number(position.averageCost) || quote;
      const profitable = quote > average;
      if (!profitable && Number(player.cash || 0) > Number(this.settings.startingCash || 1500) * 0.35) return null;
      return { id: 'market:sell:' + id, kind: 'market', instrumentId: id, side: 'sell', quantity, risk: 0.1, score: profitable ? 15 : 8 };
    }).filter(Boolean);
    return [...buy, ...sells].slice(0, 8);
  },

  botMarketExpansionCandidates(player) {
    if (!this.settings.market || typeof this.marketExpansionCandidates !== 'function') return [];
    const source = this.marketExpansionCandidates(player) || [];
    const instrumentId = Object.entries(this.marketQuotes || {}).sort(([, a], [, b]) => Number(a) - Number(b))[0]?.[0] || 'brazil';
    return source.map(candidate => {
      if (candidate.kind === 'open-margin') return { ...candidate, instrumentId, quantity: 1 };
      if (candidate.kind === 'reduce-margin') return { ...candidate, amount: Math.min(200, Math.floor(player.cash || 0)) };
      if (candidate.kind === 'open-short') return { ...candidate, instrumentId, quantity: 1 };
      if (candidate.kind === 'cover-short') {
        const id = Object.entries(player.shortPositions || {}).find(([, position]) => Number(position?.quantity) > 0)?.[0] || instrumentId;
        return { ...candidate, instrumentId: id, quantity: 1 };
      }
      if (candidate.kind === 'open-option') return { ...candidate, instrumentId, quantity: 1, side: 'call', strike: Number(this.marketQuotes?.[instrumentId]) || 100, premium: 10, expiryRounds: 3 };
      if (candidate.kind === 'exercise-option') return { ...candidate, optionId: player.optionPositions?.find(option => option.status === 'open')?.id };
      return candidate;
    }).filter(candidate => candidate.kind !== 'exercise-option' || candidate.optionId);
  },

  firstTradeableOwnedTile(player) {
    return player.properties.map(index => this.getTile(index)).find(tile => tile && this.isTradeableTile(tile));
  },

  botMarketCandidate(player) {
    if (!this.settings.market) return [];
    if (this.activeEventEffects?.().tradingEnabled === false) return [];
    if ((player.marketActionsThisTurn || 0) >= 1) return [];
    const marketId = Object.entries(this.marketQuotes).sort(([, a], [, b]) => a - b)[0]?.[0];
    if (!marketId) return [];
    const quote = Number(this.marketQuotes[marketId]) || 100;
    const fee = Math.max(1, Math.ceil(quote * MARKET_FEE_RATE));
    if (player.cash < quote + fee) return [];
    if (this.hasLoanBackedCash?.(player)) return [];
    return [{
      id: 'market:' + marketId,
      kind: 'market',
      instrumentId: marketId,
      side: 'buy',
      quantity: 1,
      // Keep the historical quote-based risk telemetry stable; the fee is a
      // legality check above, not a personality-score signal.
      risk: riskAgainstCash(quote, player.cash),
      score: BOT_MARKET_SCORES[player.personality] || BOT_MARKET_SCORE_DEFAULT
    }];
  },

  botCasinoCandidate(player) {
    if (!this.settings.casino) return [];
    if ((player.casinoBetsThisRound || 0) >= 1) return [];
    if (!['shark', 'chaos'].includes(player.personality)) return [];
    if (player.cash <= 20) return [];
    const spec = BOT_CASINO_SPECS[player.personality];
    if (this.hasLoanBackedCash?.(player)) return [];
    const entryFee = Number(this.casinoLimits?.().entryFee) || 0;
    const stake = Math.min(20, Math.max(1, Math.floor(player.cash * spec.stakeRate)));
    if (player.cash < stake + entryFee) return [];
    return [{
      id: 'casino:red',
      kind: 'casino',
      color: spec.color,
      stake,
      risk: 0.55,
      score: spec.score
    }];
  }
};

export { botApi };
