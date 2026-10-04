import path from 'node:path';
import { selectCaptureSuites } from './catalog.mjs';
import { selectViewports } from './viewports.mjs';

function escapeRegex(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export function buildCapturePlan(options = {}, now = new Date()) {
  const group = options.group || 'all';
  const suites = selectCaptureSuites(group);
  const profiles = selectViewports(options);
  const flowMap = new Map();
  for (const suite of suites) {
    const key = `${suite.file}\n${suite.testTitle}`;
    if (!flowMap.has(key)) flowMap.set(key, { file: suite.file, testTitle: suite.testTitle });
  }
  const flows = [...flowMap.values()];
  const expectedCaptures = profiles.flatMap(profile => suites.flatMap(suite => suite.surfaceIds.map(surfaceId => ({
    profileId: profile.id,
    group: suite.group,
    surfaceId,
    label: surfaceId.replaceAll('-', ' '),
  }))));
  const runId = options.outputDir
    ? path.basename(path.resolve(options.outputDir))
    : now.toISOString().replace(/[:.]/g, '-');
  const outputDir = options.outputDir
    ? path.resolve(options.outputDir)
    : path.resolve('qa-artifacts', 'visual-captures', runId);
  const titles = [...new Set(flows.map(flow => flow.testTitle))];
  const grep = titles.map(escapeRegex).join('|');

  return {
    group,
    profiles,
    suites,
    flows,
    expectedCaptures,
    expectedCount: expectedCaptures.length,
    runId,
    outputDir,
    grep: `(?:${grep})`,
    supported: profiles.every(profile => profile.supported !== false),
  };
}

export function playwrightTestArgs(plan, configPath) {
  return [
    'test',
    `--config=${configPath}`,
    '--workers=1',
    `--grep=${plan.grep}`,
  ];
}

export function evaluateCaptureResult(plan, playwrightExitCode, manifest) {
  if (playwrightExitCode !== 0 || !manifest?.summary) return 1;
  const summary = manifest.summary;
  return summary.expected === plan.expectedCount
    && summary.captured === plan.expectedCount
    && summary.missing === 0
    && summary.duplicates === 0
    && summary.failed === 0
    ? 0
    : 1;
}

export function formatCaptureList(plan) {
  const lines = [
    `Capture group: ${plan.group}`,
    `Profiles (${plan.profiles.length}):`,
    ...plan.profiles.map(profile => `  ${profile.id} · ${profile.width}×${profile.height}${profile.supported === false ? ' · one-off/unsupported' : ''}`),
    `Capture flows (${plan.flows.length}):`,
    ...plan.flows.map(flow => `  ${flow.file} · ${flow.testTitle}`),
    `Expected screenshots: ${plan.expectedCount}`,
    `Output: ${plan.outputDir}`,
  ];
  return lines.join('\n');
}
