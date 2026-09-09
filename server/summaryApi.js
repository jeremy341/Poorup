// The client-facing game projection as a prototype mixin: one small
// projector per top-level section of getGameSummary, each emitting the exact
// field set, clamps, and viewer-scoped privacy the original single literal
// produced. server/rooms.test.js and server/client-state.test.js pin the
// payload shapes.
import { AUCTION_DURATION_MS } from './auctionApi.js';
import { MARKET_FEE_RATE } from './marketLogic.js';

const summaryApi = {
  getGameSummary(viewerPlayerId = null) {
    return {
      started: this.started,
      boardVariant: this.boardVariant || this.settings?.boardVariant || 'standard-40',
      rulesetDigest: this.rulesetDigest || this.ruleset?.digest || null,
      currentPlayerId: this.currentPlayerId,
      turnOrder: this.turnOrder || [],
      hasRolled: this.hasRolled,
      extraRollPending: this.extraRollPending,
      awaitingEndTurn: this.awaitingEndTurn,
      pendingPurchaseOffer: this.pendingPurchaseOffer,
      pendingSponsoredPurchase: this.summarySponsoredPurchase(),
      pendingPayment: this.pendingPayment,
      lastWinner: this.lastWinner,
      lastDice: this.lastDice,
      tiles: this.tiles.map(tile => this.summaryTileEntry(tile)),
      players: this.players.map(player => this.summaryPlayerEntry(player, viewerPlayerId)),
      feed: this.feed,
      roundNumber: this.roundNumber,
      turnDeadline: Number(this.turnDeadline) || 0,
      globalEvent: this.summaryGlobalEvent(),
      globalEventHistory: this.globalEventHistory,
      auction: this.summaryAuction(),
      pendingTrade: this.pendingTrade,
      vacationPool: this.vacationPool,
      playerContracts: this.playerContractSummary(viewerPlayerId),
      economy: this.summaryEconomy(),
      ruleset: this.summaryRuleset()
    };
  },

  summaryTileEntry(tile) {
    const entry = {
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
      equityShares: (Array.isArray(tile.equityShares) ? tile.equityShares : []).map(share => this.summaryEquityEntry(share))
    };
    if (tile.tileId) entry.tileId = tile.tileId;
    return entry;
  },

  summaryRuleset() {
    if (!this.ruleset) return null;
    return {
      preset: this.ruleset.rulesetPreset,
      base: this.ruleset.rulesetBase,
      boardVariant: this.ruleset.boardVariant,
      revision: this.ruleset.rulesetRevision,
      digest: this.rulesetDigest || this.ruleset.digest,
      overrides: this.ruleset.rulesetOverrides.map(entry => ({ ...entry })),
      effectiveSettings: this.legacyRuleset ? { ...this.settings } : { ...this.ruleset.effectiveSettings },
      legacyCompatibility: this.legacyRuleset === true
    };
  },

  summaryEquityEntry(share) {
    return {
      holderId: share.holderId,
      holderName: this.getPlayerById(share.holderId)?.nickname || 'PLAYER',
      share: Math.max(0, Math.min(100, Number(share.share) || 0)),
      control: share.control || 'passive'
    };
  },

  summaryPlayerEntry(player, viewerPlayerId) {
    const entry = {
      id: player.id,
      nickname: player.nickname,
      color: player.color,
      cash: player.cash,
      position: player.position,
      inJail: player.inJail,
      jailTurns: player.jailTurns || 0,
      jailFreeCards: player.jailFreeCards || 0,
      bankLoan: this.summaryBankLoan(player, viewerPlayerId),
      bankLoanOffer: this.summaryBankLoanOffer(player, viewerPlayerId),
      bankrupt: player.bankrupt,
      inDebt: player.inDebt,
      disconnected: player.disconnected,
      isHost: player.isHost,
      properties: player.properties,
      ready: player.ready,
      isBot: player.isBot,
      personality: player.isBot ? player.personality : null,
      botBrain: player.isBot ? this.settings.botBrain : null,
      botDifficulty: player.isBot ? this.settings.botDifficulty : null,
      accountId: player.accountId || null,
      avatarGrid: player.avatarGrid || null
    };
    if (viewerPlayerId && player.id === viewerPlayerId) {
      entry.clientId = player.clientId;
    }
    if (viewerPlayerId && player.id === viewerPlayerId) {
      entry.marketPositions = { ...(player.marketPositions || {}) };
    }
    return entry;
  },

  // Loan privacy: the viewer sees their own full loan, everyone else only
  // the status, and no loan object at all when the seat has none.
  summaryBankLoan(player, viewerPlayerId) {
    if (viewerPlayerId && player.id === viewerPlayerId) return player.bankLoan;
    if (!player.bankLoan) return null;
    return { status: player.bankLoan.status };
  },

  summaryBankLoanOffer(player, viewerPlayerId) {
    if (!viewerPlayerId) return null;
    if (player.id !== viewerPlayerId) return null;
    return this.getBankLoanOffer(player);
  },

  summaryGlobalEvent() {
    const event = this.globalEvent;
    if (!event) return null;
    return {
      ...event,
      votes: { ...event.votes },
      choices: this.summaryEventChoices(event)
    };
  },

  summaryEventChoices(event) {
    if (!event.choices) return null;
    return event.choices.map(choice => ({ ...choice }));
  },

  summaryAuction() {
    const auction = this.auction;
    if (!auction) return null;
    return {
      active: auction.active,
      tileIndex: auction.propertyTile.index,
      tileName: auction.propertyTile.name,
      highestBid: auction.highestBid,
      highestBidderId: auction.highestBidderId,
      participants: auction.participants,
      startedAt: auction.startedAt,
      endsAt: auction.endsAt,
      cooldownUntil: auction.cooldownUntil,
      lastBidAt: auction.lastBidAt,
      passedPlayerIds: auction.passedPlayerIds,
      durationMs: AUCTION_DURATION_MS
    };
  },

  summaryEconomy() {
    return {
      casino: {
        enabled: Boolean(this.settings.casino),
        ...this.casinoLimits(),
        lastResult: this.casinoLastResult ? { ...this.casinoLastResult } : null
      },
      market: {
        enabled: Boolean(this.settings.market),
        round: this.marketRound,
        feeRate: MARKET_FEE_RATE,
        complexity: this.settings.marketComplexity || 'basic',
        quotes: { ...this.marketQuotes }
      }
    };
  }
};

export { summaryApi };
