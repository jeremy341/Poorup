import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { simulateBotMatch } from './botTournamentSimulation.js';
import { buildTournamentSummary } from './botTournamentSummary.js';
import { runTournamentCli } from './botTournamentCli.js';

export { assertHealthyCash, createSimulationRoom, simulateBotMatch, withSeededSimulationGlobals } from './botTournamentSimulation.js';
export { buildMatchResult } from './botTournamentResults.js';
export { stateFingerprint } from './botTournamentState.js';
export { createBotPolicy, createDefaultPolicySet, createRandomLegalAdvisor } from './botTournamentPolicies.js';

export function createCappedFetch({ maxCalls, fetchImpl = globalThis.fetch } = {}) {
  if (!Number.isInteger(maxCalls) || maxCalls <= 0) throw new TypeError('maxCalls must be a positive integer');
  if (typeof fetchImpl !== 'function') throw new TypeError('fetchImpl must be a function');
  const tracker = {
    maxCalls,
    calls: 0,
    capExhaustions: 0,
    exhausted: false,
    fetchImpl: null
  };
  tracker.fetchImpl = async (...args) => {
    if (tracker.calls >= tracker.maxCalls) {
      tracker.capExhaustions += 1;
      tracker.exhausted = true;
      const error = new Error('Bot evaluation live provider call cap reached');
      error.code = 'POORUP_BOT_EVAL_CALL_CAP';
      throw error;
    }
    tracker.calls += 1;
    return fetchImpl(...args);
  };
  tracker.fetchImpl.botEvalCallCapTracker = tracker;
  return tracker;
}

function scenariosForPolicySet(seed, policySet, seatRotations, boardVariants) {
  return seatRotations.flatMap(seatRotation => boardVariants.map(boardVariant => ({
    seed,
    policySet,
    seatRotation,
    boardVariant,
  })));
}

function scenariosForSeed(seed, policySets, seatRotations, boardVariants) {
  return policySets.flatMap(policySet => scenariosForPolicySet(seed, policySet, seatRotations, boardVariants));
}

function tournamentScenarios(seeds, policySets, seatRotations, boardVariants) {
  return seeds.flatMap(seed => scenariosForSeed(seed, policySets, seatRotations, boardVariants));
}

async function simulateTournamentScenarios(scenarios, options) {
  const matches = [];
  for (const scenario of scenarios) {
    const policyBySeat = scenario.policySet.map((_, index) => scenario.policySet[(index + scenario.seatRotation) % scenario.policySet.length]);
    const result = await simulateBotMatch({
      seed: scenario.seed,
      policyBySeat,
      boardVariant: scenario.boardVariant,
      settings: { ...options.settings, seatCount: scenario.policySet.length },
      stepLimit: options.stepLimit,
      callCapTracker: options.callCapTracker,
      captureShadowTrace: options.captureShadowTrace,
    });
    matches.push({ ...result, seatRotation: scenario.seatRotation, boardVariant: scenario.boardVariant });
  }
  return matches;
}

export async function runBotTournament({ seeds, policySets, seatRotations = [0], boardVariants = ['standard-40'], settings = {}, stepLimit = 20_000, callCapTracker = null, captureShadowTrace = false }) {
  const configuredPolicies = policySets || [];
  const policyIds = [...new Set(configuredPolicies.flatMap(set => set.map(policy => policy.policyId)))];
  const scenarios = tournamentScenarios(seeds || [], configuredPolicies, seatRotations, boardVariants);
  const matches = await simulateTournamentScenarios(scenarios, { settings, stepLimit, callCapTracker, captureShadowTrace });
  return buildTournamentSummary(matches, policyIds);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  runTournamentCli({ runBotTournament, createCappedFetch }).catch(error => {
    console.error(error.message);
    process.exitCode = 1;
  });
}
