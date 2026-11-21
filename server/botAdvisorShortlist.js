// Picks the short, diverse list of planner-ranked candidates that is shown to the AI advisor, keeping mandatory and rescue options.

const RESCUE_CANDIDATE_KINDS = new Set(['bankruptcy', 'end-turn', 'end-finance-window', 'roll', 'sell', 'mortgage', 'unmortgage', 'bank-repay', 'loan', 'repay']);
const CANDIDATE_FAMILIES = new Map([
  ['sell', 'liquidation'], ['mortgage', 'liquidation'], ['unmortgage', 'liquidation'], ['bank-repay', 'debt'], ['repay', 'debt'], ['loan', 'debt'],
  ['build', 'development'], ['trade', 'trade'], ['contract-propose', 'contract'], ['choice', 'choice'], ['auction-bid', 'auction'], ['auction-wait', 'auction'],
  ['market', 'market'], ['open-margin', 'market'], ['reduce-margin', 'market'], ['open-short', 'market'], ['cover-short', 'market'], ['settle-short-default', 'debt'], ['open-option', 'market'], ['exercise-option', 'market'], ['close-position', 'market'],
  ['casino', 'casino'], ['jail-fine', 'jail'], ['jail-free', 'jail'], ['roll', 'turn'], ['end-turn', 'turn'], ['end-finance-window', 'turn'], ['bankruptcy', 'terminal']
]);

export function candidateEvaluation(candidate, evaluations) {
  const candidateId = candidate ? candidate.id : '';
  if (!candidateId) return null;
  if (!evaluations) return null;
  if (evaluations instanceof Map) return mapEvaluation(evaluations, candidateId);
  if (Array.isArray(evaluations)) return arrayEvaluation(evaluations, candidateId);
  return objectEvaluation(evaluations, candidateId);
}

function mapEvaluation(evaluations, candidateId) {
  return evaluations.get(candidateId) || null;
}

function arrayEvaluation(evaluations, candidateId) {
  const entry = evaluations.find(item => hasCandidateId(item, candidateId));
  return entry ? entry.evaluation || null : null;
}

function objectEvaluation(evaluations, candidateId) {
  if (typeof evaluations !== 'object') return null;
  return evaluations[candidateId] || null;
}

function hasCandidateId(entry, candidateId) {
  return Boolean(entry && entry.candidate && entry.candidate.id === candidateId);
}

function shortlistScore(candidate, evaluations) {
  const evaluation = candidateEvaluation(candidate, evaluations);
  // An 'unsupported' planner evaluation carries no information and scores 0 by construction.
  // Letting that 0 override the curated score sorted every auction to declaration order (bid first), so bots
  // bid regardless of affordability and the tournament stalled. Unplanned and synthetic evaluations are unaffected.
  const unsupported = evaluation?.projectionStatus === 'unsupported';
  const score = Number(unsupported
    ? (candidate?.futureScore ?? candidate?.score)
    : (evaluation?.score ?? evaluation?.expectedValue ?? candidate?.futureScore ?? candidate?.score));
  return Number.isFinite(score) ? score : 0;
}

function candidateFamily(candidate, phase) {
  if (candidate?.kind === 'choice') return choiceCandidateFamily(candidate, phase);
  return CANDIDATE_FAMILIES.get(candidate?.kind) || `kind:${String(candidate?.kind || 'unknown')}`;
}

function choiceCandidateFamily(candidate, phase) {
  const idParts = String(candidate.id || '').split(':');
  const choiceKind = String(candidate.choiceId || '').split(':')[0];
  if (phase === 'payment') return `payment:${choiceKind || idParts[1] || idParts[0] || 'unknown'}`;
  if (idParts[0] === 'debt' && idParts[1]) return `choice:${idParts[1]}`;
  if (['trade', 'contract', 'sponsorship', 'vote'].includes(idParts[0])) return `choice:${idParts[0]}`;
  return `choice:${choiceKind || idParts[0] || 'unknown'}`;
}

function firstActionIdPart(value) {
  return String(value || '').split(':')[0];
}

function secondActionIdPart(value) {
  return String(value || '').split(':')[1] || '';
}

function choiceActionKind(candidate) {
  if (!candidate) return '';
  const choiceKind = firstActionIdPart(candidate.choiceId);
  if (choiceKind) return choiceKind;
  const actionKind = firstActionIdPart(candidate.id);
  if (actionKind !== 'debt') return actionKind;
  return secondActionIdPart(candidate.id);
}

export function actionKindFromId(actionId) {
  const [prefix, detail] = String(actionId || '').split(':');
  if (prefix === 'debt' && ['mortgage', 'sell', 'loan', 'bankruptcy'].includes(detail)) return `debt-${detail}`;
  return /^[a-z][a-z0-9-]{0,30}$/i.test(prefix || '') ? prefix.toLowerCase() : 'unknown';
}

function candidateLimit(maxCandidates) {
  const requestedLimit = Number(maxCandidates);
  return Math.max(0, Math.floor(Number.isFinite(requestedLimit) ? requestedLimit : 32));
}

function rankShortlistEntries(source, evaluations) {
  return source.map((candidate, index) => ({ candidate, index, score: shortlistScore(candidate, evaluations) }))
    .sort((a, b) => b.score - a.score || a.index - b.index);
}

function rescueKind(candidate) {
  if (candidate?.kind === 'choice') return choiceActionKind(candidate);
  return candidate?.kind;
}

function terminalCandidate(entry) {
  return ['bankruptcy', 'end-turn', 'end-finance-window'].includes(rescueKind(entry.candidate));
}

function requiredShortlistEntries(ranked) {
  const mandatoryByKind = new Map();
  ranked.forEach(entry => {
    const kind = rescueKind(entry.candidate);
    if (RESCUE_CANDIDATE_KINDS.has(kind) && !mandatoryByKind.has(kind)) mandatoryByKind.set(kind, entry);
  });
  return [...mandatoryByKind.values()].sort((a, b) => Number(terminalCandidate(b)) - Number(terminalCandidate(a))
    || b.score - a.score || a.index - b.index);
}

function addShortlistEntry(selection, entry) {
  if (!entry || selection.selectedIds.has(entry.index)) return;
  selection.selected.push(entry);
  selection.selectedIds.add(entry.index);
}

function isMandatoryEntry(entry, mandatory) {
  return mandatory.some(item => item.index === entry.index);
}

function initialShortlistSelection(ranked, mandatory, limit) {
  const selection = { selected: [], selectedIds: new Set() };
  mandatory.forEach(entry => addShortlistEntry(selection, entry));
  for (const entry of ranked) {
    if (selection.selected.length >= limit) break;
    addShortlistEntry(selection, entry);
  }
  return selection;
}

function selectionFamilies(selected, phase) {
  return new Set(selected.map(entry => candidateFamily(entry.candidate, phase)));
}

function replaceLowestOptionalCandidate(selection, mandatory, phase) {
  const replaceIndex = selection.selected.findLastIndex(item => !isMandatoryEntry(item, mandatory));
  if (replaceIndex < 0) return;
  selection.selectedIds.delete(selection.selected[replaceIndex].index);
  selection.selected.splice(replaceIndex, 1);
  selection.families = selectionFamilies(selection.selected, phase);
}

function diversifyShortlist({ selection, ranked, mandatory, phase, limit }) {
  selection.families = selectionFamilies(selection.selected, phase);
  for (const entry of ranked) {
    const family = candidateFamily(entry.candidate, phase);
    if (selection.families.has(family)) continue;
    if (selection.selected.length >= limit) replaceLowestOptionalCandidate(selection, mandatory, phase);
    if (selection.selected.length < limit || isMandatoryEntry(entry, mandatory)) addShortlistEntry(selection, entry);
    selection.families.add(family);
  }
  return selection.selected;
}

function selectedShortlistCandidates(source, evaluations, phase, limit) {
  const ranked = rankShortlistEntries(source, evaluations);
  const required = requiredShortlistEntries(ranked);
  const mandatory = limit ? required.slice(0, limit) : [];
  const selection = initialShortlistSelection(ranked, mandatory, limit);
  return diversifyShortlist({ selection, ranked, mandatory, phase, limit })
    .sort((a, b) => b.score - a.score || a.index - b.index);
}

function omittedCandidatesByKind(source, ordered) {
  const included = new Set(ordered.map(entry => entry.index));
  const omittedByKind = {};
  source.forEach((candidate, index) => {
    if (!included.has(index)) {
      const kind = String(candidate?.kind || 'unknown');
      omittedByKind[kind] = (omittedByKind[kind] || 0) + 1;
    }
  });
  return omittedByKind;
}

export function shortlistAdvisorCandidates(candidates = [], evaluations = new Map(), { phase = 'pre-roll', maxCandidates = 32 } = {}) {
  const source = Array.isArray(candidates) ? candidates : [];
  const limit = candidateLimit(maxCandidates);
  const ordered = selectedShortlistCandidates(source, evaluations, phase, limit);
  const omittedByKind = omittedCandidatesByKind(source, ordered);
  return {
    candidates: ordered.map(entry => entry.candidate),
    totalCount: source.length,
    omittedCount: source.length - ordered.length,
    omittedByKind
  };
}
