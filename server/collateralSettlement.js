// Server-authored, agreement-time collateral quotes. This module is pure:
// defaults apply the returned plan through the existing settlement owners.
export const COLLATERAL_CREDIT_VERSION = 1;

function wholeNonnegative(value) {
  const number = Number(value);
  return Number.isSafeInteger(number) && number >= 0 ? number : null;
}

export function collateralQuoteFor(game, indices = []) {
  const unique = [...new Set(indices.map(Number).filter(Number.isSafeInteger))];
  return unique.flatMap(tileIndex => {
    const tile = game.getTile(tileIndex), value = wholeNonnegative(tile?.price);
    if (!tile || value == null || !['property', 'railroad', 'utility'].includes(tile.type)) return [];
    return [{ tileIndex, name: String(tile.name || ''), value }];
  });
}

export function stampCollateralAgreement(game, contract, indices = []) {
  contract.collateralCreditVersion = COLLATERAL_CREDIT_VERSION;
  contract.collateralValuation = 'printed-price-at-agreement';
  contract.collateralCreditQuotes = collateralQuoteFor(game, indices);
  return contract.collateralCreditQuotes;
}

export function usesCollateralCredit(contract) {
  return contract?.collateralCreditVersion === COLLATERAL_CREDIT_VERSION;
}

export function collateralCreditPlan(game, borrower, contract, balance, { allowBankruptCollateral = false } = {}) {
  const outstanding = wholeNonnegative(balance) ?? 0;
  const empty = { outstanding, credit: 0, remaining: outstanding, entries: [], seizedTileIndices: [] };
  if (!usesCollateralCredit(contract) || !borrower || (borrower.bankrupt && !allowBankruptCollateral)) return empty;
  if (contract.toPlayerId != null && contract.toPlayerId !== borrower.id) return empty;
  const indices = Array.isArray(contract.collateralTileIndices) && contract.collateralTileIndices.length
    ? contract.collateralTileIndices : contract.collateralTileIndex == null ? [] : [contract.collateralTileIndex];
  const quotes = new Map((Array.isArray(contract.collateralCreditQuotes) ? contract.collateralCreditQuotes : [])
    .filter(q => Number.isSafeInteger(q?.tileIndex) && wholeNonnegative(q.value) != null)
    .map(q => [q.tileIndex, q]));
  const entries = [];
  let remaining = outstanding;
  for (const index of [...new Set(indices.map(Number).filter(Number.isSafeInteger))]) {
    if (remaining === 0) break;
    const tile = game.getTile(index), quote = quotes.get(index);
    if (!tile || tile.ownerId !== borrower.id || !['property', 'railroad', 'utility'].includes(tile.type) || !quote || quote.value === 0) continue;
    const credit = Math.min(remaining, quote.value);
    entries.push({ tileIndex: index, quotedValue: quote.value, credit });
    remaining -= credit;
  }
  return { outstanding, credit: outstanding - remaining, remaining, entries, seizedTileIndices: entries.map(e => e.tileIndex) };
}

// A foreclosure can touch several deeds and terminate share contracts before a
// later transfer or ledger write fails. Restore records in place so callers,
// pending-payment hooks and accepted-agreement references remain authoritative.
function captureRecords(records) {
  return records.map(record => ({ record, state: structuredClone(record) }));
}

function restoreRecord(record, state) {
  for (const key of Object.keys(record)) delete record[key];
  Object.assign(record, structuredClone(state));
}

function captureSettlement(game, agreement) {
  const players = (game.players || []).map(player => ({
    record: player, state: structuredClone(player), bankLoan: player.bankLoan
  }));
  const agreements = [...new Set([agreement, ...(game.playerContracts || []),
    ...(game.players || []).map(player => player.bankLoan).filter(Boolean)])];
  return {
    players,
    agreements: captureRecords(agreements),
    tiles: captureRecords(game.tiles || []),
    claims: captureRecords(game.defaultClaims || []),
    contractRefs: [...(game.playerContracts || [])],
    claimRefs: [...(game.defaultClaims || [])],
    feed: structuredClone(game.feed),
    pendingPayment: game.pendingPayment,
    pendingPaymentState: game.pendingPayment ? structuredClone(game.pendingPayment) : null,
    pendingPaymentHooks: game.pendingPaymentHooks,
    pendingPaymentTurnOptions: game.pendingPaymentTurnOptions,
    pendingPaymentQueue: game.pendingPaymentQueue?.map(entry => ({ ...entry, payment: { ...entry.payment } })),
    awaitingEndTurn: game.awaitingEndTurn,
    hasRolled: game.hasRolled,
    extraRollPending: game.extraRollPending,
    turnAllowsExtraRoll: game.turnAllowsExtraRoll
  };
}

function restoreSettlement(game, before) {
  before.players.forEach(({ record, state, bankLoan }) => {
    restoreRecord(record, state);
    if (Object.hasOwn(state, 'bankLoan')) record.bankLoan = bankLoan;
  });
  for (const { record, state } of [...before.tiles, ...before.agreements, ...before.claims]) restoreRecord(record, state);
  game.playerContracts = before.contractRefs;
  game.defaultClaims = before.claimRefs;
  game.feed = before.feed;
  game.pendingPayment = before.pendingPayment;
  if (before.pendingPayment) restoreRecord(before.pendingPayment, before.pendingPaymentState);
  for (const field of ['pendingPaymentHooks', 'pendingPaymentTurnOptions', 'pendingPaymentQueue',
    'awaitingEndTurn', 'hasRolled', 'extraRollPending', 'turnAllowsExtraRoll']) game[field] = before[field];
}

export function settleCollateralAtomically(game, agreement, settle) {
  const before = captureSettlement(game, agreement);
  try {
    settle();
    return true;
  } catch {
    restoreSettlement(game, before);
    return false;
  }
}

export function recordCollateralCredit(agreement, plan, roundNumber) {
  agreement.defaultedPrincipal = plan.outstanding;
  agreement.collateralCreditApplied = plan.credit;
  agreement.collateralSeizedTileIndices = plan.seizedTileIndices.slice();
  agreement.residualDebt = plan.remaining;
  agreement.remaining = plan.remaining;
  agreement.status = 'defaulted';
  agreement.defaultedRound = roundNumber;
  agreement.unsecuredDefault = plan.seizedTileIndices.length === 0;
}
