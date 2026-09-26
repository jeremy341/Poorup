import { NO_AI_POLICY_VERSION, evaluateCandidate } from './botFuturePlanner.js';

const DEFAULT_NODE_BUDGETS = Object.freeze([16, 64, 256]);
const MAX_BENCHMARK_CANDIDATES = 32;
const EXACT_2D6_SCENARIOS = 36;
const UNSUPPORTED_SEARCH_REASON = 'No tested multi-action state-transition simulator exists for this public snapshot; UCT/progressive widening rewards would require inventing unvalidated transitions.';

function measuredCandidates(snapshot, candidates, seed, rolloutBudget) {
  return candidates.map((candidate, candidateIndex) => {
    const evaluation = evaluateCandidate(snapshot, candidate, {
      difficulty: 'expert',
      seed,
      rolloutBudget
    });
    return {
      candidateIndex,
      score: Number.isFinite(evaluation.score) ? evaluation.score : 0,
      expectedRent: Number.isFinite(evaluation.expectedRent) ? evaluation.expectedRent : 0,
      expectedRisk: Number.isFinite(evaluation.expectedRisk) ? evaluation.expectedRisk : 0,
      projectionStatus: evaluation.projectionStatus,
      rolloutBudget: evaluation.rolloutBudget
    };
  });
}

function measuredMode(snapshot, candidates, seed, { mode, rolloutBudget, nominalPerStateScenarioBudget, status = 'measured', comparisonRole = null }) {
  return {
    status,
    mode,
    ...(comparisonRole ? { comparisonRole } : {}),
    rolloutBudget,
    nominalPerStateScenarioBudget,
    candidateEvaluations: candidates.length,
    nominalScenarioBudgetTotal: candidates.length * nominalPerStateScenarioBudget,
    evaluations: measuredCandidates(snapshot, candidates, seed, rolloutBudget)
  };
}

function unsupportedVariant(requestedNodeBudget) {
  return {
    status: 'unsupported/not-comparable',
    requestedNodeBudget,
    reason: UNSUPPORTED_SEARCH_REASON
  };
}

export function benchmarkBotSearch({ snapshot, candidates = [], seed = 'poorup-search-benchmark', nodeBudgets = DEFAULT_NODE_BUDGETS } = {}) {
  if (!snapshot || typeof snapshot !== 'object') throw new TypeError('A public strategic snapshot is required');
  const safeCandidates = Array.isArray(candidates) ? candidates.slice(0, MAX_BENCHMARK_CANDIDATES) : [];
  const budgets = [...new Set((Array.isArray(nodeBudgets) ? nodeBudgets : DEFAULT_NODE_BUDGETS)
    .map(Number).filter(budget => DEFAULT_NODE_BUDGETS.includes(budget)))].sort((left, right) => left - right);
  const exactReference = measuredMode(snapshot, safeCandidates, seed, {
    mode: 'exact-2d6', rolloutBudget: 0, nominalPerStateScenarioBudget: EXACT_2D6_SCENARIOS,
    status: 'reference-only', comparisonRole: 'reference-only'
  });
  return {
    productionEnabled: false,
    policyVersion: NO_AI_POLICY_VERSION,
    accountingUnit: 'candidate-evaluations-and-nominal-per-state-scenario-budget',
    candidateEvaluations: safeCandidates.length,
    exactReference,
    comparisons: budgets.map(nodeBudget => ({
      nodeBudget,
      comparisonBasis: 'sensitivity/scaling-not-equal-cost',
      exactReference,
      stratified: measuredMode(snapshot, safeCandidates, seed, {
        mode: 'seeded-stratified', rolloutBudget: nodeBudget, nominalPerStateScenarioBudget: nodeBudget
      }),
      uct: unsupportedVariant(nodeBudget),
      progressiveWidening: unsupportedVariant(nodeBudget)
    }))
  };
}
