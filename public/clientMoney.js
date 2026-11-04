// MONEY FORMAT: one en-US form for board cash on every economy surface,
// "$1,500" and "-$45", whatever the browser locale. No DOM access, so
// presentation modules that tests load under Node can import it too.
export function formatMoney(value) {
  const amount = Number(value);
  const safe = Number.isFinite(amount) ? amount : 0;
  return `${safe < 0 ? "-" : ""}$${Math.abs(safe).toLocaleString("en-US")}`;
}
