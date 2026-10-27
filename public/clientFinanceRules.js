/** UI reads the server's effective settings. The server still validates every action. */
export function playerFinanceEnabled(settings) {
  return settings?.playerFinance === true;
}

export function isRentShare(contract) {
  return contract?.kind === "equity" && Number(contract.rentShareVersion) === 1;
}

export function contractLabel(contract) {
  if (isRentShare(contract)) return "Rent share";
  if (contract?.kind === "equity") return "Legacy equity";
  if (contract?.kind === "hybrid") return "Legacy convertible note";
  return "Loan";
}

export function rentShareDisclosure() {
  return "Collected rent only. Deed sale/mortgage locked. No capital refund.";
}

export function collateralCreditSummary(contract) {
  if (Number(contract?.collateralCreditVersion) !== 1) return "";
  const quotes = Array.isArray(contract.collateralCreditQuotes) ? contract.collateralCreditQuotes : [];
  if (!quotes.length) return "";
  const total = quotes.reduce((sum, quote) => sum + Math.max(0, Number(quote.value) || 0), 0);
  const balance = Math.max(0, Number(contract.remaining ?? contract.totalDue) || 0);
  const names = quotes.map(quote => `${quote.name || "Deed"} $${Math.max(0, Number(quote.value) || 0).toLocaleString()}`).join("; ");
  const settled = Number.isFinite(contract.collateralCreditApplied) && Number.isFinite(contract.residualDebt);
  const residual = settled ? Math.max(0, contract.residualDebt) : Math.max(0, balance - total);
  const applied = settled ? ` Applied: $${Math.max(0, contract.collateralCreditApplied).toLocaleString()}.` : "";
  return `Printed-price credit: ${names}. Capped at unpaid debt; no surplus cash.${applied} Residual debt: $${residual.toLocaleString()}.`;
}
