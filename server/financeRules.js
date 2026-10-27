// New player financing follows the table's own finance flag. Repayment and accepted legacy
// contract settlement deliberately do not use this proposal/acceptance gate.
export const PLAYER_FINANCE_DISABLED_REASON = 'Player finance is disabled for this table.';

export function playerFinanceEnabled(game) {
  const settings = game?.settings || {};
  return settings.playerFinance === true;
}
