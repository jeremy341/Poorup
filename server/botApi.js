// Bot decision support as a prototype mixin: socket impersonation for
// bot-driven actions and the pre-roll candidate ranking. The candidate
// arrays keep the original collector order; the final sort is stable, so
// ties keep this sequence. kind values are the contract consumed by
// botLogic's CANDIDATE_MAPPERS/CANDIDATE_RUNNERS tables.
import { MARKET_FEE_RATE } from './marketLogic.js';

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
      fallbackReason: entry.fallbackReason ? String(entry.fallbackReason).slice(0, 40) : null,
      brain: String(entry.brain || this.settings.botBrain || 'auto').slice(0, 12),
      difficulty: String(entry.difficulty || this.settings.botDifficulty || 'table').slice(0, 12),
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
  getBotCandidates(player) {
    if (!player?.isBot) return [];
    const candidates = [{ id: 'roll', kind: 'roll', risk: 0, score: 0 }];
    if (!this.hasRolled) {
      for (const source of BOT_CANDIDATE_SOURCES) {
        candidates.push(...source.collect(this, player));
      }
    }
    return candidates.sort((a, b) => b.score - a.score || a.risk - b.risk);
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

  botMortgageCandidateFor(tile, player) {
    return {
      id: 'mortgage:' + tile.index,
      kind: 'mortgage',
      tileIndex: tile.index,
      proceeds: Math.floor((tile.price || 0) / 2),
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
      risk: loan.totalDue / loan.principal,
      score: BOT_LOAN_SCORES[player.personality] || BOT_LOAN_SCORE_DEFAULT
    }];
  },

  botGroupTradeCandidate(player) {
    const partner = this.activePlayers().find(candidate => candidate.id !== player.id && !candidate.isBot);
    if (!partner) return [];
    const giveTile = this.firstTradeableOwnedTile(player);
    const askTile = this.firstTradeableOwnedTile(partner);
    if (!giveTile) return [];
    if (!askTile) return [];
    if (!giveTile.group) return [];
    if (giveTile.group !== askTile.group) return [];
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
