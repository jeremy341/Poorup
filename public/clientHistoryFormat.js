// HISTORY FORMAT: pure display formatters shared by the profile's
// completed-rounds list and the shared player-record modal, so both
// surfaces word dates and money the same way.

function validDate(value) {
  if (!value) return null;
  const date = new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatHistoryDate(value, fallback = "NOT RECORDED") {
  const date = validDate(value);
  if (!date) return fallback;
  return date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" }).toUpperCase();
}

export function formatHistoryDateTime(value, fallback = "NOT RECORDED") {
  const date = validDate(value);
  if (!date) return fallback;
  const day = date.toLocaleDateString("en-US", { month: "short", day: "numeric", year: "numeric" });
  const time = date.toLocaleTimeString("en-US", { hour: "2-digit", minute: "2-digit" });
  return `${day} · ${time}`.toUpperCase();
}

export function formatHistoryMoney(value, fallback = "NOT RECORDED") {
  const number = Number(value);
  if (value == null || !Number.isFinite(number)) return fallback;
  return `$${number.toLocaleString()}`;
}

/** +$65 / -$20 / $0, so a gain and a loss never read alike. */
export function formatSignedMoney(value, fallback = "NOT RECORDED") {
  const number = Number(value);
  if (value == null || !Number.isFinite(number)) return fallback;
  if (number > 0) return `+$${number.toLocaleString()}`;
  if (number < 0) return `-$${Math.abs(number).toLocaleString()}`;
  return "$0";
}
