// Small numeric helpers shared by the bot planners and net-worth maths.

// Coerces any value to a finite number, or `fallback` when it is NaN, Infinity or not numeric.
export function finiteNumber(value, fallback = 0) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : fallback;
}

export function nonNegativeWhole(value) {
  return Math.max(0, Math.floor(finiteNumber(value)));
}

export function clamp(value, minimum, maximum) {
  return Math.max(minimum, Math.min(maximum, value));
}
