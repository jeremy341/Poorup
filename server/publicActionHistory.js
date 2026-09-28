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

function isValidRound(roundNumber) {
  if (!Number.isSafeInteger(roundNumber)) return false;
  return roundNumber >= 0;
}

function isValidSeat(seatIndex) {
  if (!Number.isSafeInteger(seatIndex)) return false;
  return seatIndex >= 0;
}

function isAllowedAction(actionKind) {
  return PUBLIC_ACTION_KIND_SET.has(actionKind);
}

function validProfileEntry(entry, seatIndex) {
  if (!entry) return false;
  if (entry.seatIndex !== seatIndex) return false;
  if (!isAllowedAction(entry.actionKind)) return false;
  return isValidRound(entry.roundNumber);
}

function normalizedProfileRound(currentRound) {
  if (!isValidRound(currentRound)) return 0;
  return currentRound;
}

function weightedProfileEntries(history, seatIndex, round) {
  const entries = Array.isArray(history) ? history : [];
  return entries
    .filter(entry => validProfileEntry(entry, seatIndex))
    .map(entry => ({
      actionKind: entry.actionKind,
      weight: 0.5 ** Math.floor(Math.max(0, round - entry.roundNumber)),
    }));
}

function effectiveWeight(entries) {
  return entries.reduce((total, entry) => total + entry.weight, 0);
}

function roundedProfileWeight(weight) {
  return Math.round(weight * 1_000_000) / 1_000_000;
}

function isInsufficientProfileWeight(weight) {
  return weight < MIN_EFFECTIVE_PROFILE_WEIGHT;
}

function unknownProfile(weight) {
  return { status: 'unknown', effectiveSampleWeight: weight, confidence: 0, actionFrequencies: null };
}

function actionCounts(entries) {
  const counts = new Map();
  entries.forEach(entry => counts.set(entry.actionKind, (counts.get(entry.actionKind) || 0) + entry.weight));
  return counts;
}

function roundedActionFrequency(count, weight) {
  return Math.round((count / weight) * 1_000_000) / 1_000_000;
}

function actionFrequenciesFor(counts, weight) {
  return Object.fromEntries(PUBLIC_ACTION_KINDS.map(kind => [
    kind,
    roundedActionFrequency(counts.get(kind) || 0, weight),
  ]));
}

function profileConfidence(weight) {
  return Math.min(1, weight / (MIN_EFFECTIVE_PROFILE_WEIGHT * 2));
}

export function appendPublicAction(history, actionKind, seatIndex, roundNumber) {
  if (!Array.isArray(history)) return false;
  if (!isAllowedAction(actionKind)) return false;
  if (!isValidSeat(seatIndex)) return false;
  if (!isValidRound(roundNumber)) return false;

  history.push({ actionKind, seatIndex, roundNumber });
  if (history.length > MAX_PUBLIC_ACTION_HISTORY) history.splice(0, history.length - MAX_PUBLIC_ACTION_HISTORY);
  return true;
}

export function summarizePublicActionProfile(history, seatIndex, currentRound) {
  const round = normalizedProfileRound(currentRound);
  const weightedEntries = weightedProfileEntries(history, seatIndex, round);
  const roundedWeight = roundedProfileWeight(effectiveWeight(weightedEntries));
  if (isInsufficientProfileWeight(roundedWeight)) return unknownProfile(roundedWeight);
  const counts = actionCounts(weightedEntries);
  return {
    status: 'known',
    effectiveSampleWeight: roundedWeight,
    confidence: profileConfidence(roundedWeight),
    actionFrequencies: actionFrequenciesFor(counts, roundedWeight)
  };
}
