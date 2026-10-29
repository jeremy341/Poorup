// The client-facing game projection as a prototype mixin: one small projector per top-level section of getGameSummary. Each emits the
// exact field set, clamps and viewer-scoped privacy the original single literal produced. server/rooms.test.js and
// public/clientStateSync.test.js pin the payload shapes.
import { AUCTION_DURATION_MS } from './auctionApi.js';
import { MARKET_FEE_RATE, marketQuoteHistorySnapshot } from './marketLogic.js';
import { computePlacementById } from './gamePlacement.js';
import { stripRetiredRoomSettings } from './roomSettings.js';

function isViewerSeat(player, viewerPlayerId) {
  return Boolean(viewerPlayerId && player.id === viewerPlayerId);
}

function playerSummaryFields(game, player, viewerPlayerId) {
  return {
    id: player.id,
    nickname: player.nickname,
    color: player.color,
    cash: player.cash,
    position: player.position,
    inJail: player.inJail,
    jailTurns: player.jailTurns || 0,
    jailFreeCards: player.jailFreeCards || 0,
    bankLoan: game.summaryBankLoan(player, viewerPlayerId),
    bankLoanOffer: game.summaryBankLoanOffer(player, viewerPlayerId),
    bankrupt: player.bankrupt,
    spectating: Boolean(player.spectating),
    inDebt: player.inDebt,
    disconnected: player.disconnected,
    presence: player.isBot ? null : {
      state: player.presence?.state === 'inactive' ? 'inactive' : 'active',
      inactiveSince: Number.isFinite(player.presence?.inactiveSince) ? player.presence.inactiveSince : null,
      inactiveUntil: Number.isFinite(player.presence?.inactiveUntil) ? player.presence.inactiveUntil : null,
    },
    isHost: player.isHost,
    properties: player.properties,
    ready: player.ready,
    isBot: player.isBot,
    finalNetWorth: !game.started && game.lastWinner?.id && Number.isFinite(game.finalNetWorthById?.[player.id])
      ? game.finalNetWorthById[player.id]
      : null,
    botBrain: player.isBot ? game.settings.botBrain : null,
    botDifficulty: player.isBot ? game.settings.botDifficulty : null
  };
}

function playerViewerFields(player, viewerPlayerId) {
  const ownSeat = isViewerSeat(player, viewerPlayerId);
  const fields = {
    // Account IDs are durable social identifiers. Keep them owner-scoped;
    // in-room cards can resolve an opponent through the roomPlayerId seam.
    accountId: ownSeat ? (player.accountId || null) : null,
    accountLinked: Boolean(player.accountId),
    roomPlayerId: player.id,
    avatarGrid: player.avatarGrid || null
  };
  if (ownSeat) {
    fields.clientId = player.clientId;
    fields.marketPositions = { ...(player.marketPositions || {}) };
  }
  return fields;
}

const summaryApi = {
  getGameSummary(viewerPlayerId = null) {
    return {
      rulesProfile: this.settings.rulesProfile,
      playerFinance: this.settings.playerFinance === true,
      started: this.started,
      startedAt: this.startedAt,
      boardVariant: this.boardVariant || this.settings?.boardVariant || 'standard-40',
      rulesetDigest: this.rulesetDigest || this.ruleset?.digest || null,
      currentPlayerId: this.currentPlayerId,
      turnOrder: this.turnOrder || [],
      hasRolled: this.hasRolled,
      extraRollPending: this.extraRollPending,
      awaitingEndTurn: this.awaitingEndTurn,
      diceRollSequence: this.diceRollSequence,
      presentation: this.presentation || null,
      pendingPurchaseOffer: this.pendingPurchaseOffer,
      pendingSponsoredPurchase: this.summarySponsoredPurchase(),
      pendingPayment: this.pendingPayment,
      lastWinner: this.lastWinner,
      finalPlacements: this.started || !(Number(this.roundNumber) > 0) || !this.lastWinner?.id
        ? null
        : Object.fromEntries(computePlacementById(this.players, this.lastWinner.id)),
      lastEndReason: this.lastEndReason || null,
      lastDice: this.lastDice,
      tiles: this.tiles.map(tile => this.summaryTileEntry(tile, viewerPlayerId)),
      flights: this.summaryFlights(viewerPlayerId),
      lastFlight: this.lastFlight || null,
      players: this.players.map(player => this.summaryPlayerEntry(player, viewerPlayerId)),
      feed: this.feed,
      roundNumber: this.roundNumber,
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

  summaryTileEntry(tile, viewerPlayerId = null) {
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
    if (tile.type === 'property' || tile.type === 'railroad') entry.currentRent = tile.ownerId ? this.calculateRent(tile) : 0;
    if (tile.type === 'railroad' && this.flightsEnabled()) {
      entry.departureFee = this.airportFee(tile, 'departure');
      entry.arrivalFee = this.airportFee(tile, 'arrival');
    }
    const viewer = viewerPlayerId ? this.getPlayerById(viewerPlayerId) : null;
    if (viewer && tile.ownerId === viewer.id) entry.propertyActions = this.propertyActionProjection(viewer, tile);
    if (tile.tileId) entry.tileId = tile.tileId;
    return entry;
  },

  summaryRuleset() {
    if (!this.ruleset) return null;
    const overrides = stripRetiredRoomSettings({ rulesetOverrides: this.ruleset.rulesetOverrides }).rulesetOverrides || [];
    return {
      boardVariant: this.ruleset.boardVariant,
      revision: this.ruleset.rulesetRevision,
      digest: this.rulesetDigest || this.ruleset.digest,
      overrides: overrides.map(entry => ({ ...entry })),
      effectiveSettings: stripRetiredRoomSettings(this.legacyRuleset ? this.settings : this.ruleset.effectiveSettings),
      legacyCompatibility: this.legacyRuleset === true
    };
  },

  summaryEquityEntry(share) {
    const contract = (this.playerContracts || []).find(entry => entry.id === share.contractId);
    return {
      rentShareVersion: contract?.rentShareVersion ?? null,
      rulesVersion: contract?.rulesVersion ?? null,
      expiresRound: contract?.expiresRound ?? null,
      holderId: share.holderId,
      holderName: this.getPlayerById(share.holderId)?.nickname || 'PLAYER',
      share: Math.max(0, Math.min(100, Number(share.share) || 0)),
      control: share.control || 'passive'
    };
  },

  summaryPlayerEntry(player, viewerPlayerId) {
    const entry = {
      ...playerSummaryFields(this, player, viewerPlayerId),
      ...playerViewerFields(player, viewerPlayerId)
    };
    // Inventory instance IDs and action eligibility belong only to this seat.
    // Public, spectator and rival projections omit the inventory field entirely.
    if (isViewerSeat(player, viewerPlayerId)) entry.items = this.summaryItems(player, viewerPlayerId);
    // The bank account and its ledger are private to the seat's owner.
    if (viewerPlayerId && player.id === viewerPlayerId && this.bankAccountsEnabled()) {
      entry.bankAccountTier = this.bankAccountOf(player).tier;
      entry.bankAccount = this.bankAccountProjection(player);
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
    // The election nonce is the server's own anti-stale guard: a ballot that
    // names it must match the running election. It is not published, so the
    // event the client sees keeps exactly the shape it already knows.
    const published = { ...event };
    delete published.voteNonce;
    delete published.settlementApplied;
    return {
      ...published,
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
        quotes: { ...this.marketQuotes },
        quoteHistory: marketQuoteHistorySnapshot(this)
      }
    };
  }
};

export { summaryApi };
