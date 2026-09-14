// Optional market obligations for the staged Market Complexity setting. The
// module contains deterministic, fully-collateralized actions only; it never
// introduces real securities, cash withdrawal, or naked exposure.
const COMPLEXITY_RANK = Object.freeze({ basic: 0, margin: 1, shorting: 2, derivatives: 3 });
const MARGIN_MAINTENANCE_RATE = 0.25;
// Initial margin is the same disclosed cash percentage as the maintenance
// requirement. It is held separately from free cash until the position is
// reduced or liquidated, so opening margin cannot create uncollateralized
// exposure.
const MARGIN_COLLATERAL_RATE = MARGIN_MAINTENANCE_RATE;
const SHORT_COLLATERAL_RATE = 0.5;
const SHORT_BORROW_FEE_RATE = 0.01;
const OPTION_EXPIRY_MAX = 20;
const OPTION_RESERVE_INITIAL = 100_000;

function complexityAllows(game, required) {
  const current = String(game?.settings?.marketComplexity || 'basic').toLowerCase();
  return (COMPLEXITY_RANK[current] || 0) >= (COMPLEXITY_RANK[required] || 0);
}

function integerAmount(value, max = 1000) {
  const amount = Math.floor(Number(value));
  return Number.isInteger(amount) && amount >= 1 && amount <= max ? amount : 0;
}

function nonNegativeNumber(value) {
  return Math.max(0, Number(value) || 0);
}

function quoteFor(game, instrument) {
  return Math.max(10, Number(game.marketQuotes?.[instrument.id]) || Number(instrument.price) || 100);
}

function marketInstrument(instruments, id) {
  return instruments.find(instrument => instrument.id === String(id || '').trim().toLowerCase()) || null;
}

function ensureOptionReserve(game) {
  const current = Number(game?.marketOptionReserve);
  if (!Number.isFinite(current) || current < 0) game.marketOptionReserve = OPTION_RESERVE_INITIAL;
  return game.marketOptionReserve;
}

function maintenanceDue(game, player) {
  ensurePlayerMarketState(player || {});
  if (!maintenanceRequired(player)) return false;
  return marginEquity(game, player) < Number(player.marginMaintenance);
}

function maintenanceRequired(player) {
  if (!player) return false;
  return Number(player.marginMaintenance) > 0;
}

function marginMarketValue(game, player) {
  return Object.entries(player.marginPositions || {}).reduce((sum, [id, position]) => sum + (Number(game.marketQuotes?.[id]) || 0) * (Number(position?.quantity) || 0), 0);
}

function marginEquity(game, player) {
  return marginMarketValue(game, player)
    + nonNegativeNumber(player.marginCollateral)
    - nonNegativeNumber(player.marginBalance);
}

function tableObligationPending(game) {
  return Boolean(
    game.pendingPayment
      || game.auction
      || game.pendingPurchaseOffer
      || game.pendingSponsoredPurchase
      || game.pendingTrade
      || game.pendingPlayerContract
  );
}

function unavailableMarketSeat(game, player) {
  return !game.started || !player || player.bankrupt || player.disconnected;
}

function expansionSessionRejection(game, player, required) {
  if (!game?.settings?.market) return 'Market access is off for this room.';
  if (!complexityAllows(game, required)) return `Market complexity ${required.toUpperCase()} is not enabled.`;
  if (unavailableMarketSeat(game, player)) return 'Market access is unavailable right now.';
  return null;
}

function expansionTurnRejection(game, player) {
  if (player.id !== game.currentPlayerId) return 'Market actions are available during your turn.';
  if (tableObligationPending(game)) return 'Resolve the table obligation before trading.';
  if (game.activeEventEffects?.().tradingEnabled === false) return 'Market trading is paused by the active global event.';
  return null;
}

function positionOrderRejection(player, operation) {
  if (['open', 'manage'].includes(operation) && Number(player.marketActionsThisTurn) >= 1) return 'You have already placed a market order this turn.';
  return null;
}

function positionDebtRejection(player) {
  if (Number(player.shortDefaultDebt) > 0) return 'Settle your short buy-in debt before opening another market position.';
  return null;
}

function positionMarginRejection(player, operation) {
  if (operation === 'open' && marginNeedsReduction(player)) return 'Reduce your remaining margin balance before opening another position.';
  return null;
}

function marginNeedsReduction(player) {
  return Number(player.marginBalance) > 0 && !Object.keys(player.marginPositions || {}).length;
}

function positionMaintenanceRejection(game, player, operation) {
  if (operation === 'open' && maintenanceDue(game, player)) return 'Settle your margin maintenance before opening a new market position.';
  return null;
}

function expansionPositionRejection(game, player, operation) {
  return positionOrderRejection(player, operation)
    || positionDebtRejection(player)
    || positionMarginRejection(player, operation)
    || positionMaintenanceRejection(game, player, operation);
}

function expansionGuard(game, player, required, operation = 'open') {
  return expansionSessionRejection(game, player, required)
    || (player ? expansionTurnRejection(game, player) : null)
    || (player ? expansionPositionRejection(game, player, operation) : null);
}

function ensurePlayerMarketState(player) {
  player.marginBalance ||= 0;
  player.marginMaintenance ||= 0;
  player.marginCollateral ||= 0;
  player.marginPositions ||= {};
  player.shortPositions ||= {};
  player.shortDefaultDebt ||= 0;
  player.optionPositions ||= [];
  player.reservedCash ||= 0;
  return player;
}

function openMargin(game, player, instrument, amount) {
  ensurePlayerMarketState(player);
  const quote = quoteFor(game, instrument);
  const gross = quote * amount;
  const fee = Math.max(1, Math.ceil(gross * 0.02));
  const collateral = Math.ceil(gross * MARGIN_COLLATERAL_RATE);
  if (player.cash < fee + collateral) {
    return {
      success: false,
      error: `You need $${fee + collateral} cash for this margin position ($${fee} fee + $${collateral} collateral).`
    };
  }
  player.cash -= fee + collateral;
  player.marginCollateral += collateral;
  player.reservedCash += collateral;
  const position = player.marginPositions[instrument.id] || { quantity: 0, averageCost: 0 };
  position.averageCost = ((position.averageCost * position.quantity) + gross) / (position.quantity + amount);
  position.quantity += amount;
  player.marginPositions[instrument.id] = position;
  player.marginBalance += gross;
  player.marginMaintenance += gross * MARGIN_MAINTENANCE_RATE;
  return { success: true, action: 'open-margin', instrumentId: instrument.id, quantity: amount, quote, fee, collateral, marginBalance: player.marginBalance, maintenance: player.marginMaintenance, marginCollateral: player.marginCollateral };
}

function reduceMargin(player, amount) {
  ensurePlayerMarketState(player);
  const repayment = Math.min(player.marginBalance, amount);
  if (repayment <= 0) return { success: false, error: 'There is no margin balance to reduce.' };
  if (player.cash < repayment) return { success: false, error: 'You do not have enough cash to reduce margin.' };
  const balanceBefore = player.marginBalance;
  const collateralReleased = repayment >= balanceBefore
    ? player.marginCollateral
    : Math.min(player.marginCollateral, Math.ceil(player.marginCollateral * (repayment / balanceBefore)));
  player.cash -= repayment;
  player.cash += collateralReleased;
  player.marginCollateral = Math.max(0, player.marginCollateral - collateralReleased);
  player.reservedCash = Math.max(0, player.reservedCash - collateralReleased);
  const ratio = balanceBefore ? repayment / balanceBefore : 1;
  player.marginBalance -= repayment;
  player.marginMaintenance = Math.max(0, player.marginMaintenance * (1 - ratio));
  return { success: true, action: 'reduce-margin', amount: repayment, collateralReleased, marginBalance: player.marginBalance, maintenance: player.marginMaintenance, marginCollateral: player.marginCollateral };
}

function openShort(game, player, { instrument, amount, inventory }) {
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

function coverShort(game, player, { instrument, amount, inventory }) {
  ensurePlayerMarketState(player);
  const position = player.shortPositions[instrument.id];
  if (!position || position.quantity < amount) return { success: false, error: 'You do not hold enough short inventory to cover.' };
  const quote = quoteFor(game, instrument);
  const gross = quote * amount;
  const fee = Math.max(1, Math.ceil(gross * 0.02));
  const collateralRelease = Math.ceil((position.collateral / position.quantity) * amount);
  const total = gross + fee;
  const cashAvailable = Math.max(0, Number(player.cash) || 0);
  if (cashAvailable + collateralRelease < total) return { success: false, error: 'You cannot cover this short at the current quote.' };
  const cashRequired = Math.max(0, total - collateralRelease);
  player.cash = cashAvailable - cashRequired + Math.max(0, collateralRelease - total);
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

function optionTerms(game, player, instrument, payload) {
  const quantity = integerAmount(payload.quantity, 100);
  if (!quantity) return { error: 'Option quantity must be between 1 and 100.' };
  const side = payload.side === 'put' ? 'put' : 'call';
  const role = payload.role === 'writer' ? 'writer' : 'buyer';
  if (role === 'writer') return { error: 'Option writing requires an assigned counterparty.' };
  const strike = Math.max(10, Math.floor(Number(payload.strike) || quoteFor(game, instrument)));
  const premium = Math.max(1, Math.floor(Number(payload.premium) || Math.ceil(strike * 0.05)));
  return {
    quantity,
    side,
    role,
    strike,
    premium,
    totalPremium: premium * quantity,
    id: `opt_${game.roundNumber}_${player.id.slice(0, 8)}_${player.optionPositions.length + 1}`,
    expiryRound: optionExpiry(game.roundNumber, payload.expiryRounds)
  };
}

function optionReserveRejection(game, player, terms) {
  const maxPayout = terms.strike * terms.quantity;
  const reserve = ensureOptionReserve(game);
  if (reserve < maxPayout) return 'The option reserve cannot collateralize that position.';
  if (player.cash < terms.totalPremium) return 'You need premium cash for that option.';
  return null;
}

function openOption(game, player, instrument, payload) {
  ensurePlayerMarketState(player);
  // Pricing bands and quote-age policy are owner decisions. Until one is
  // configured, accepting client strike/premium/expiry terms is unsafe; fail
  // closed before touching cash, reserve, or option state.
  if (!game.optionPricingPolicy) return { success: false, error: 'OPTION_TERMS_SERVER_REQUIRED' };
  const terms = optionTerms(game, player, instrument, payload);
  if (terms.error) return { success: false, error: terms.error };
  // The first release is house-underwritten but bounded. The reserve is
  // explicitly debited at open and can only return through exercise, close,
  // or expiry, so a winning option cannot mint player cash.
  const reserveError = optionReserveRejection(game, player, terms);
  if (reserveError) return { success: false, error: reserveError };
  const maxPayout = terms.strike * terms.quantity;
  player.cash -= terms.totalPremium;
  game.marketOptionReserve -= maxPayout;
  const option = { id: terms.id, instrumentId: instrument.id, side: terms.side, role: terms.role, quantity: terms.quantity, strike: terms.strike, premium: terms.premium, createdRound: game.roundNumber, expiryRound: terms.expiryRound, collateral: 0, reserveHeld: maxPayout, maxPayout, status: 'open', exercised: false };
  player.optionPositions.push(option);
  return { success: true, action: terms.role === 'writer' ? 'write-option' : 'buy-option', option: { ...option } };
}

function openOptionForPlayer(player, optionId) {
  return player.optionPositions.find(entry => entry.id === optionId && entry.status === 'open') || null;
}

function optionQuote(game, option) {
  return Number(game.marketQuotes?.[option.instrumentId]) || option.strike;
}

function optionIntrinsic(option, quote) {
  return option.side === 'call'
    ? Math.max(0, quote - option.strike)
    : Math.max(0, option.strike - quote);
}

function exerciseStateError(game, option) {
  if (!option) return 'That option is no longer open.';
  if (game.roundNumber > option.expiryRound) return 'That option has expired.';
  if (option.createdRound == null || game.roundNumber <= Number(option.createdRound)) return 'OPTION_TERMS_SERVER_REQUIRED';
  return null;
}

function exerciseValueError(option, intrinsic) {
  if (intrinsic <= 0) return 'This option has no exercise value at the current quote.';
  if (option.role === 'writer') return 'Writers cannot exercise their own option.';
  return null;
}

function exerciseOption(game, player, optionId) {
  ensurePlayerMarketState(player);
  const option = openOptionForPlayer(player, optionId);
  const stateError = exerciseStateError(game, option);
  if (stateError) return { success: false, error: stateError };
  const quote = optionQuote(game, option);
  const intrinsic = optionIntrinsic(option, quote);
  const valueError = exerciseValueError(option, intrinsic);
  if (valueError) return { success: false, error: valueError };
  const reserveHeld = Math.max(0, Number(option.reserveHeld) || 0);
  const payout = Math.min(intrinsic * option.quantity, reserveHeld);
  ensureOptionReserve(game);
  player.cash += payout;
  game.marketOptionReserve += reserveHeld - payout;
  option.reserveHeld = 0;
  option.collateral = 0;
  option.status = 'exercised';
  option.exercised = true;
  return { success: true, action: 'exercise-option', optionId, payout, quote };
}

function closeOption(game, player, optionId) {
  ensurePlayerMarketState(player);
  const option = openOptionForPlayer(player, optionId);
  if (!option) return { success: false, error: 'That option is no longer open.' };
  const quote = optionQuote(game, option);
  const intrinsic = optionIntrinsic(option, quote);
  if (option.role === 'writer') {
    player.cash += option.collateral;
    player.reservedCash = Math.max(0, player.reservedCash - option.collateral);
  } else {
    const reserveHeld = Math.max(0, Number(option.reserveHeld) || 0);
    const payout = Math.min(Math.floor(intrinsic * option.quantity * 0.8), reserveHeld);
    ensureOptionReserve(game);
    player.cash += payout;
    game.marketOptionReserve += reserveHeld - payout;
  }
  option.reserveHeld = 0;
  option.collateral = 0;
  option.status = 'closed';
  return { success: true, action: 'close-position', optionId, payout: option.role === 'writer' ? 0 : Math.min(Math.floor(intrinsic * option.quantity * 0.8), Math.max(0, Number(option.maxPayout) || 0)) };
}

function addCandidate(candidates, condition, candidate) {
  if (condition) candidates.push(candidate);
}

function hasShortInventory(player) {
  return Object.values(player.shortPositions).some(position => position.quantity > 0);
}

function openOptionPositions(player) {
  return (player.optionPositions || []).filter(option => option.status === 'open');
}

function hasExercisableOption(options) {
  return options.some(option => option.role !== 'writer');
}

function canOpenMargin(game, player, canOpen) {
  return canOpen && complexityAllows(game, 'margin') && player.cash > 100;
}

function canReduceMargin(game, player, canManage = true) {
  return canManage && complexityAllows(game, 'margin') && player.marginBalance > 0 && player.cash > 0;
}

function canOpenShort(game, player, canOpen) {
  return canOpen && complexityAllows(game, 'shorting') && player.cash > 200;
}

function canOpenOption(game, player, canOpen) {
  return canOpen && complexityAllows(game, 'derivatives') && player.cash > 100;
}

function forceShortBuyIn(game, player, { id, position, quantity, inventory }) {
  // Forced buy-in remains authoritative even when the player cannot fund the
  // quote. Consume available cash/collateral, record the shortfall, return
  // the borrowed units, and remove the position so it cannot be reused.
  const quote = Number(game.marketQuotes?.[id]) || Number(position.entryQuote) || 0;
  const gross = quote * quantity;
  const fee = Math.max(1, Math.ceil(gross * 0.02));
  const total = gross + fee;
  const collateral = Math.min(
    nonNegativeNumber(position.collateral),
    nonNegativeNumber(player.reservedCash)
  );
  const cashRequired = Math.max(0, total - collateral);
  const cashBefore = nonNegativeNumber(player.cash);
  const cashUsed = Math.min(cashBefore, cashRequired);
  player.cash = cashBefore - cashUsed + Math.max(0, collateral - total);
  player.reservedCash = nonNegativeNumber(player.reservedCash) - collateral;
  player.shortDefaultDebt = nonNegativeNumber(player.shortDefaultDebt) + Math.max(0, cashRequired - cashUsed);
  inventory[id] = nonNegativeNumber(inventory[id]) + quantity;
  delete player.shortPositions[id];
  return { success: true, action: 'short-buy-in-default', shortfall: Math.max(0, cashRequired - cashUsed) };
}

// A forced buy-in can leave a bounded cash shortfall. Keep it collectible as
// an explicit obligation; callers may invoke this path on a later turn or
// before opening another market position.
function settleShortDefault(game, player, requestedAmount = null) {
  ensurePlayerMarketState(player);
  const outstanding = Math.max(0, Math.floor(Number(player.shortDefaultDebt) || 0));
  const requested = requestedAmount == null ? outstanding : Math.max(0, Math.floor(Number(requestedAmount) || 0));
  const due = Math.min(outstanding, requested || outstanding);
  const available = Math.max(0, Math.floor(Number(player.cash) || 0));
  const paid = Math.min(available, due);
  player.cash = available - paid;
  player.shortDefaultDebt = outstanding - paid;
  const remaining = player.shortDefaultDebt;
  if (paid > 0) game?.feedMessage?.(`${player.nickname || 'Player'} paid $${paid} toward short buy-in debt.`);
  return { success: true, action: remaining ? 'short-default-payment' : 'short-default-settled', paid, remaining };
}

function settleShortPosition(game, player, { id, position, inventory }) {
  const quantity = Math.max(0, Number(position?.quantity) || 0);
  if (!quantity) return { success: true, action: 'short-empty' };
  const instrument = game.marketInstruments?.find(entry => entry.id === id);
  const settlement = { id, position, quantity, inventory };
  if (!instrument) return forceShortBuyIn(game, player, settlement);
  const covered = coverShort(game, player, { instrument, amount: quantity, inventory });
  return covered.success ? covered : forceShortBuyIn(game, player, settlement);
}

function marginLiquidationProceeds(game, player) {
  return Object.entries(player.marginPositions || {}).reduce((sum, [id, position]) => {
    const value = (Number(game.marketQuotes?.[id]) || 0) * (Number(position.quantity) || 0);
    return sum + Math.max(0, Math.floor(value * 0.98));
  }, 0);
}

function hasMarginExposure(player) {
  return Object.keys(player.marginPositions || {}).length > 0 || Number(player.marginBalance) > 0;
}

function settleMarginPositions(game, player) {
  if (!hasMarginExposure(player)) return null;
  const proceeds = marginLiquidationProceeds(game, player);
  const debt = Math.max(0, Number(player.marginBalance) || 0);
  const collateral = Math.max(0, Number(player.marginCollateral) || 0);
  const available = proceeds + collateral;
  const repayment = Math.min(debt, available);
  player.cash = Math.max(0, Number(player.cash) || 0) + Math.max(0, available - repayment);
  player.marginBalance = Math.max(0, debt - repayment);
  player.marginMaintenance = 0;
  player.marginCollateral = 0;
  player.reservedCash = Math.max(0, Number(player.reservedCash) - collateral);
  player.marginPositions = {};
  return { success: true, action: 'margin-liquidation', proceeds, collateral, repayment, remaining: player.marginBalance };
}

function settleOptionOnExit(game, player, option) {
  if (option.role === 'writer') {
    const collateral = Math.max(0, Number(option.collateral) || 0);
    player.cash = Math.max(0, Number(player.cash) || 0) + collateral;
    player.reservedCash = Math.max(0, Number(player.reservedCash) - collateral);
  } else {
    ensureOptionReserve(game);
    game.marketOptionReserve += Math.max(0, Number(option.reserveHeld) || 0);
  }
  option.reserveHeld = 0;
  option.collateral = 0;
  option.status = 'closed';
  return 'option-close';
}

function liquidateAllMarketPositions(game, player, inventory = {}) {
  ensurePlayerMarketState(player);
  const actions = [];
  player.optionPositions.forEach(option => {
    if (option.status !== 'open') return;
    actions.push(settleOptionOnExit(game, player, option));
  });
  const margin = settleMarginPositions(game, player);
  if (margin) actions.push(margin.action);
  Object.entries({ ...(player.shortPositions || {}) }).forEach(([id, position]) => {
    const result = settleShortPosition(game, player, { id, position, inventory });
    if (result.success && result.action !== 'short-empty') actions.push(result.action);
  });
  return { success: true, actions };
}

function expireOption(game, player, option) {
  if (option.role === 'writer') {
    player.cash += Math.max(0, Number(option.collateral) || 0);
    player.reservedCash = Math.max(0, player.reservedCash - (Number(option.collateral) || 0));
  } else {
    ensureOptionReserve(game);
    game.marketOptionReserve += Math.max(0, Number(option.reserveHeld) || 0);
  }
  option.reserveHeld = 0;
  option.collateral = 0;
  option.status = 'expired';
  return 'option-expiry';
}

function expiredOptionActions(game, player) {
  return player.optionPositions
    .filter(option => option.status === 'open' && game.roundNumber > option.expiryRound)
    .map(option => expireOption(game, player, option));
}

function marginForceLiquidation(game, player) {
  if (!(player.marginBalance > 0 && player.marginMaintenance > 0)) return [];
  if (marginEquity(game, player) >= player.marginMaintenance) return [];
  settleMarginPositions(game, player);
  return ['margin-liquidation'];
}

function forcedShortActions(game, player, inventory) {
  const actions = [];
  Object.entries(player.shortPositions).forEach(([id, position]) => {
    const quote = Number(game.marketQuotes?.[id]) || position.entryQuote;
    if (quote <= position.entryQuote * 1.5) return;
    const result = settleShortPosition(game, player, { id, position, inventory });
    if (result.success && result.action !== 'short-empty') actions.push(result.action);
  });
  return actions;
}

function forceLiquidate(game, player, inventory) {
  ensurePlayerMarketState(player);
  const actions = expiredOptionActions(game, player);
  actions.push(...marginForceLiquidation(game, player));
  actions.push(...forcedShortActions(game, player, inventory));
  return actions;
}

function expansionCandidates(game, player) {
  ensurePlayerMarketState(player);
  const candidates = [];
  const canOpen = Number(player.marketActionsThisTurn) < 1;
  addCandidate(candidates, canOpenMargin(game, player, canOpen), { id: 'market:open-margin', kind: 'open-margin', score: 4 });
  addCandidate(candidates, canReduceMargin(game, player, canOpen), { id: 'market:reduce-margin', kind: 'reduce-margin', score: 9 });
  addCandidate(candidates, canOpenShort(game, player, canOpen), { id: 'market:open-short', kind: 'open-short', score: 3 });
  addCandidate(candidates, canOpen && hasShortInventory(player), { id: 'market:cover-short', kind: 'cover-short', score: 10 });
  addCandidate(candidates, canOpenOption(game, player, canOpen), { id: 'market:open-option', kind: 'open-option', score: 2 });
  const openOptions = openOptionPositions(player);
  addCandidate(candidates, canOpen && hasExercisableOption(openOptions), { id: 'market:exercise-option', kind: 'exercise-option', score: 8 });
  const option = openOptions[0];
  addCandidate(candidates, canOpen && Boolean(option), { id: 'market:close-position:' + option?.id, kind: 'close-position', optionId: option?.id, score: 7 });
  return candidates;
}

export {
  COMPLEXITY_RANK,
  MARGIN_COLLATERAL_RATE,
  MARGIN_MAINTENANCE_RATE,
  OPTION_RESERVE_INITIAL,
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
  liquidateAllMarketPositions,
  maintenanceDue,
  marketInstrument,
  openMargin,
  openOption,
  openShort,
  reduceMargin,
  settleShortDefault
};
