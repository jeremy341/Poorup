export const PUBLIC_ACTION_KINDS = Object.freeze([
  'auction-bid',
  'auction-pass',
  'purchase',
  'build',
  'trade-accept',
  'trade-counter',
  'contract-accept',
  'contract-counter'
]);
export const PUBLIC_ACTION_PROFILE_PRODUCTION_ENABLED = false;

const PUBLIC_ACTION_KIND_SET = new Set(PUBLIC_ACTION_KINDS);
const MAX_PUBLIC_ACTION_HISTORY = 200;
const MIN_EFFECTIVE_PROFILE_WEIGHT = 5;

export function appendPublicAction(history, actionKind, seatIndex, roundNumber) {
  if (!Array.isArray(history)
    || !PUBLIC_ACTION_KIND_SET.has(actionKind)
    || !Number.isSafeInteger(seatIndex)
    || seatIndex < 0
    || !Number.isSafeInteger(roundNumber)
    || roundNumber < 0) return false;

  history.push({ actionKind, seatIndex, roundNumber });
  if (history.length > MAX_PUBLIC_ACTION_HISTORY) history.splice(0, history.length - MAX_PUBLIC_ACTION_HISTORY);
  return true;
}

export function summarizePublicActionProfile(history, seatIndex, currentRound) {
  const round = Number.isSafeInteger(currentRound) && currentRound >= 0 ? currentRound : 0;
  const counts = new Map();
  let effectiveSampleWeight = 0;
  (Array.isArray(history) ? history : []).forEach(entry => {
    if (!entry || entry.seatIndex !== seatIndex || !PUBLIC_ACTION_KIND_SET.has(entry.actionKind)
      || !Number.isSafeInteger(entry.roundNumber) || entry.roundNumber < 0) return;
    const elapsedRounds = Math.floor(Math.max(0, round - entry.roundNumber));
    const weight = 0.5 ** elapsedRounds;
    effectiveSampleWeight += weight;
    counts.set(entry.actionKind, (counts.get(entry.actionKind) || 0) + weight);
  });

  const roundedWeight = Math.round(effectiveSampleWeight * 1_000_000) / 1_000_000;
  if (roundedWeight < MIN_EFFECTIVE_PROFILE_WEIGHT) {
    return { status: 'unknown', effectiveSampleWeight: roundedWeight, confidence: 0, actionFrequencies: null };
  }
  const actionFrequencies = Object.fromEntries(PUBLIC_ACTION_KINDS.map(kind => [
    kind,
    Math.round(((counts.get(kind) || 0) / roundedWeight) * 1_000_000) / 1_000_000
  ]));
  return {
    status: 'known',
    effectiveSampleWeight: roundedWeight,
    confidence: Math.min(1, roundedWeight / (MIN_EFFECTIVE_PROFILE_WEIGHT * 2)),
    actionFrequencies
  };
}
