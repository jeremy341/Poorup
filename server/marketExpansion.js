// Optional market obligations for the staged Market Complexity setting. The
// module contains deterministic, fully-collateralized actions only; it never
// introduces real securities, cash withdrawal, or naked exposure.
const COMPLEXITY_RANK = Object.freeze({ basic: 0, margin: 1, shorting: 2, derivatives: 3 });
const MARGIN_MAINTENANCE_RATE = 0.25;
const SHORT_COLLATERAL_RATE = 0.5;
const SHORT_BORROW_FEE_RATE = 0.01;
const OPTION_EXPIRY_MAX = 20;

function complexityAllows(game, required) {
  const current = String(game?.settings?.marketComplexity || 'basic').toLowerCase();
  return (COMPLEXITY_RANK[current] || 0) >= (COMPLEXITY_RANK[required] || 0);
}

function integerAmount(value, max = 1000) {
  const amount = Math.floor(Number(value));
  return Number.isInteger(amount) && amount >= 1 && amount <= max ? amount : 0;
}

function quoteFor(game, instrument) {
  return Math.max(10, Number(game.marketQuotes?.[instrument.id]) || Number(instrument.price) || 100);
}

function marketInstrument(instruments, id) {
  return instruments.find(instrument => instrument.id === String(id || '').trim().toLowerCase()) || null;
}

function maintenanceDue(game, player) {
  ensurePlayerMarketState(player || {});
  if (!player || Number(player.marginMaintenance) <= 0) return false;
  const value = Object.entries(player.marginPositions || {}).reduce((sum, [id, position]) => sum + (Number(game.marketQuotes?.[id]) || 0) * (Number(position?.quantity) || 0), 0);
  return value < Number(player.marginMaintenance);
}

function expansionGuard(game, player, required, operation = 'open') {
  if (!game?.settings?.market) return 'Market access is off for this room.';
  if (!complexityAllows(game, required)) return `Market complexity ${required.toUpperCase()} is not enabled.`;
  if (!game.started || !player || player.bankrupt || player.disconnected) return 'Market access is unavailable right now.';
  if (player.id !== game.currentPlayerId) return 'Market actions are available during your turn.';
  if (game.pendingPayment || game.auction || game.pendingPurchaseOffer || game.pendingSponsoredPurchase || game.pendingTrade || game.pendingPlayerContract) return 'Resolve the table obligation before trading.';
  if (game.activeEventEffects?.().tradingEnabled === false) return 'Market trading is paused by the active global event.';
  if (operation === 'open' && maintenanceDue(game, player)) return 'Settle your margin maintenance before opening a new market position.';
  return null;
}

function ensurePlayerMarketState(player) {
  player.marginBalance ||= 0;
  player.marginMaintenance ||= 0;
  player.marginPositions ||= {};
  player.shortPositions ||= {};
  player.optionPositions ||= [];
  player.reservedCash ||= 0;
  return player;
}

function openMargin(game, player, instrument, amount) {
  ensurePlayerMarketState(player);
  const quote = quoteFor(game, instrument);
  const gross = quote * amount;
  const fee = Math.max(1, Math.ceil(gross * 0.02));
  if (player.cash < fee) return { success: false, error: 'You need cash for the margin settlement fee.' };
  player.cash -= fee;
  const position = player.marginPositions[instrument.id] || { quantity: 0, averageCost: 0 };
  position.averageCost = ((position.averageCost * position.quantity) + gross) / (position.quantity + amount);
  position.quantity += amount;
  player.marginPositions[instrument.id] = position;
  player.marginBalance += gross;
  player.marginMaintenance += gross * MARGIN_MAINTENANCE_RATE;
  return { success: true, action: 'open-margin', instrumentId: instrument.id, quantity: amount, quote, fee, marginBalance: player.marginBalance, maintenance: player.marginMaintenance };
}

function reduceMargin(player, amount) {
  ensurePlayerMarketState(player);
  const repayment = Math.min(player.marginBalance, amount);
  if (repayment <= 0) return { success: false, error: 'There is no margin balance to reduce.' };
  if (player.cash < repayment) return { success: false, error: 'You do not have enough cash to reduce margin.' };
  player.cash -= repayment;
  const ratio = player.marginBalance ? repayment / player.marginBalance : 1;
  player.marginBalance -= repayment;
  player.marginMaintenance = Math.max(0, player.marginMaintenance * (1 - ratio));
  return { success: true, action: 'reduce-margin', amount: repayment, marginBalance: player.marginBalance, maintenance: player.marginMaintenance };
}

function openShort(game, player, instrument, amount, inventory) {
  ensurePlayerMarketState(player);
  inventory[instrument.id] = Math.max(0, Math.floor(Number(inventory[instrument.id]) || 0));
  if (inventory[instrument.id] < amount) return { success: false, error: 'There is not enough borrowable inventory for that short.' };
  const quote = quoteFor(game, instrument);
  const gross = quote * amount;
  const fee = Math.max(1, Math.ceil(gross * 0.02));
  const collateral = Math.ceil(gross * SHORT_COLLATERAL_RATE);
  if (player.cash < collateral) return { success: false, error: 'Short positions require disclosed cash collateral.' };
  inventory[instrument.id] -= amount;
  player.cash -= collateral;
  player.cash += Math.max(0, gross - fee);
  player.reservedCash += collateral;
  const position = player.shortPositions[instrument.id] || { quantity: 0, entryQuote: 0, collateral: 0, borrowFee: 0 };
  position.entryQuote = ((position.entryQuote * position.quantity) + gross) / (position.quantity + amount);
  position.quantity += amount;
  position.collateral += collateral;
  position.borrowFee += Math.max(1, Math.ceil(gross * SHORT_BORROW_FEE_RATE));
  player.shortPositions[instrument.id] = position;
  return { success: true, action: 'open-short', instrumentId: instrument.id, quantity: amount, quote, fee, collateral, position: { ...position } };
}

function coverShort(game, player, instrument, amount, inventory) {
  ensurePlayerMarketState(player);
  const position = player.shortPositions[instrument.id];
  if (!position || position.quantity < amount) return { success: false, error: 'You do not hold enough short inventory to cover.' };
  const quote = quoteFor(game, instrument);
  const gross = quote * amount;
  const fee = Math.max(1, Math.ceil(gross * 0.02));
  const collateralRelease = Math.ceil((position.collateral / position.quantity) * amount);
  const total = gross + fee;
  if (player.cash + collateralRelease < total) return { success: false, error: 'You cannot cover this short at the current quote.' };
  player.cash -= Math.max(0, total - collateralRelease);
  player.cash += 0;
  player.reservedCash = Math.max(0, player.reservedCash - collateralRelease);
  inventory[instrument.id] = (inventory[instrument.id] || 0) + amount;
  position.quantity -= amount;
  position.collateral = Math.max(0, position.collateral - collateralRelease);
  const pnl = (position.entryQuote - quote) * amount - fee - Math.ceil(position.borrowFee * (amount / Math.max(1, position.quantity + amount)));
  if (!position.quantity) delete player.shortPositions[instrument.id];
  return { success: true, action: 'cover-short', instrumentId: instrument.id, quantity: amount, quote, fee, collateralReleased: collateralRelease, realizedPnl: pnl };
}

function optionExpiry(round, requested) {
  const duration = Math.max(1, Math.min(OPTION_EXPIRY_MAX, Math.floor(Number(requested) || 3)));
  return round + duration;
}

function openOption(game, player, instrument, payload) {
  ensurePlayerMarketState(player);
  const quantity = integerAmount(payload.quantity, 100);
  if (!quantity) return { success: false, error: 'Option quantity must be between 1 and 100.' };
  const side = payload.side === 'put' ? 'put' : 'call';
  const role = payload.role === 'writer' ? 'writer' : 'buyer';
  const strike = Math.max(10, Math.floor(Number(payload.strike) || quoteFor(game, instrument)));
  const premium = Math.max(1, Math.floor(Number(payload.premium) || Math.ceil(strike * 0.05)));
  const totalPremium = premium * quantity;
  const id = `opt_${game.roundNumber}_${player.id.slice(0, 8)}_${player.optionPositions.length + 1}`;
  const expiryRound = optionExpiry(game.roundNumber, payload.expiryRounds);
  const collateral = role === 'writer' ? Math.max(strike * quantity, quoteFor(game, instrument) * quantity) : 0;
  if (role === 'writer') {
    if (player.cash < collateral) return { success: false, error: 'Option writers must fully collateralize the position.' };
    player.cash -= collateral;
    player.reservedCash += collateral;
  } else if (player.cash < totalPremium) {
    return { success: false, error: 'You do not have enough cash for that option premium.' };
  } else {
    player.cash -= totalPremium;
  }
  const option = { id, instrumentId: instrument.id, side, role, quantity, strike, premium, expiryRound, collateral, status: 'open', exercised: false };
  player.optionPositions.push(option);
  return { success: true, action: role === 'writer' ? 'write-option' : 'buy-option', option: { ...option } };
}

function exerciseOption(game, player, optionId) {
  ensurePlayerMarketState(player);
  const option = player.optionPositions.find(entry => entry.id === optionId && entry.status === 'open');
  if (!option) return { success: false, error: 'That option is no longer open.' };
  if (game.roundNumber > option.expiryRound) return { success: false, error: 'That option has expired.' };
  const quote = Number(game.marketQuotes?.[option.instrumentId]) || option.strike;
  const intrinsic = option.side === 'call' ? Math.max(0, quote - option.strike) : Math.max(0, option.strike - quote);
  if (intrinsic <= 0) return { success: false, error: 'This option has no exercise value at the current quote.' };
  const payout = intrinsic * option.quantity;
  if (option.role === 'writer') return { success: false, error: 'Writers cannot exercise their own option.' };
  player.cash += payout;
  option.status = 'exercised';
  option.exercised = true;
  return { success: true, action: 'exercise-option', optionId, payout, quote };
}

function closeOption(game, player, optionId) {
  ensurePlayerMarketState(player);
  const option = player.optionPositions.find(entry => entry.id === optionId && entry.status === 'open');
  if (!option) return { success: false, error: 'That option is no longer open.' };
  const quote = Number(game.marketQuotes?.[option.instrumentId]) || option.strike;
  const intrinsic = option.side === 'call' ? Math.max(0, quote - option.strike) : Math.max(0, option.strike - quote);
  if (option.role === 'writer') {
    player.cash += option.collateral;
    player.reservedCash = Math.max(0, player.reservedCash - option.collateral);
  } else {
    player.cash += Math.floor(intrinsic * option.quantity * 0.8);
  }
  option.status = 'closed';
  return { success: true, action: 'close-position', optionId, payout: Math.floor(intrinsic * option.quantity * 0.8) };
}

function forceLiquidate(game, player, inventory) {
  ensurePlayerMarketState(player);
  const actions = [];
  player.optionPositions.forEach(option => {
    if (option.status !== 'open' || game.roundNumber <= option.expiryRound) return;
    if (option.role === 'writer') {
      player.cash += Math.max(0, Number(option.collateral) || 0);
      player.reservedCash = Math.max(0, player.reservedCash - (Number(option.collateral) || 0));
    }
    option.status = 'expired';
    actions.push('option-expiry');
  });
  if (player.marginBalance > 0 && player.marginMaintenance > 0) {
    const marketValue = Object.entries(player.marginPositions).reduce((sum, [id, position]) => sum + (Number(game.marketQuotes?.[id]) || 0) * (Number(position.quantity) || 0), 0);
    if (marketValue < player.marginMaintenance) {
      Object.entries(player.marginPositions).forEach(([id, position]) => {
        const value = (Number(game.marketQuotes?.[id]) || 0) * (Number(position.quantity) || 0);
        player.cash += Math.max(0, Math.floor(value * 0.98));
      });
      player.marginPositions = {};
      player.marginBalance = 0;
      player.marginMaintenance = 0;
      actions.push('margin-liquidation');
    }
  }
  Object.entries(player.shortPositions).forEach(([id, position]) => {
    const quote = Number(game.marketQuotes?.[id]) || position.entryQuote;
    if (quote > position.entryQuote * 1.5) {
      const instrument = game.marketInstruments?.find(entry => entry.id === id);
      if (instrument) {
        const result = coverShort(game, player, instrument, position.quantity, inventory);
        if (result.success) actions.push('short-buy-in');
      }
    }
  });
  return actions;
}

function expansionCandidates(game, player) {
  ensurePlayerMarketState(player);
  const candidates = [];
  if (complexityAllows(game, 'margin') && player.cash > 100) candidates.push({ id: 'market:open-margin', kind: 'open-margin', score: 4 });
  if (complexityAllows(game, 'margin') && player.marginBalance > 0 && player.cash > 0) candidates.push({ id: 'market:reduce-margin', kind: 'reduce-margin', score: 9 });
  if (complexityAllows(game, 'shorting') && player.cash > 200) candidates.push({ id: 'market:open-short', kind: 'open-short', score: 3 });
  if (Object.values(player.shortPositions).some(position => position.quantity > 0)) candidates.push({ id: 'market:cover-short', kind: 'cover-short', score: 10 });
  if (complexityAllows(game, 'derivatives') && player.cash > 100) candidates.push({ id: 'market:open-option', kind: 'open-option', score: 2 });
  if ((player.optionPositions || []).some(option => option.status === 'open')) candidates.push({ id: 'market:exercise-option', kind: 'exercise-option', score: 8 });
  return candidates;
}

export {
  COMPLEXITY_RANK,
  MARGIN_MAINTENANCE_RATE,
  OPTION_EXPIRY_MAX,
  SHORT_BORROW_FEE_RATE,
  SHORT_COLLATERAL_RATE,
  complexityAllows,
  coverShort,
  closeOption,
  ensurePlayerMarketState,
  expansionCandidates,
  expansionGuard,
  exerciseOption,
  forceLiquidate,
  integerAmount,
  maintenanceDue,
  marketInstrument,
  openMargin,
  openOption,
  openShort,
  reduceMargin
};
