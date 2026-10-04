#!/usr/bin/env node
/* global console */
import { spawnSync } from 'node:child_process';
import { access, mkdir, readdir } from 'node:fs/promises';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { buildGallery } from '../qa/visual-capture/gallery.mjs';
import { buildCapturePlan, evaluateCaptureResult, formatCaptureList, playwrightTestArgs } from '../qa/visual-capture/runner.mjs';
import { parseCaptureArgs } from '../qa/visual-capture/viewports.mjs';

const repositoryRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const playwrightCli = path.join(repositoryRoot, 'node_modules', '@playwright', 'test', 'cli.js');
const configPath = 'qa/visual-capture/playwright.config.js';

function gitValue(args) {
  const result = spawnSync('git', args, { cwd: repositoryRoot, encoding: 'utf8', windowsHide: true });
  return result.status === 0 ? result.stdout.trim() : '';
}

function sourceMetadata() {
  return {
    branch: gitValue(['rev-parse', '--abbrev-ref', 'HEAD']) || 'unknown',
    commit: gitValue(['rev-parse', '--short=12', 'HEAD']) || 'unknown',
    dirty: Boolean(gitValue(['status', '--porcelain'])),
  };
}

function usage() {
  return [
    'Poorup visual capture runner',
    '',
    'Usage:',
    '  npm run capture:ui',
    '  npm run capture:ui -- --group=game',
    '  npm run capture:ui -- --viewport=1920x1080 --group=pages',
    '  npm run capture:ui -- --list',
    '',
    'Options:',
    '  --group=<pages|lobby|game|admin|market|player|funding|all>',
    '  --viewport=<profile-id|WIDTHxHEIGHT>  Custom sizes are one-off and marked unsupported.',
    '  --output-dir=<path>                   Must be empty if it already exists.',
    '  --list                                Print the plan without launching Chromium.',
  ].join('\n');
}

async function ensureEmptyOutputDirectory(outputDir) {
  try {
    await access(outputDir);
    const entries = await readdir(outputDir);
    if (entries.length) throw new Error(`Refusing to overwrite non-empty capture directory: ${outputDir}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  await mkdir(outputDir, { recursive: true });
}

async function main() {
  let options;
  try {
    options = parseCaptureArgs(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    return 2;
  }
  if (options.help) {
    console.log(usage());
    return 0;
  }

  let plan;
  try {
    plan = buildCapturePlan(options);
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    return 2;
  }
  if (options.list) {
    console.log(formatCaptureList(plan));
    return 0;
  }

  try {
    await ensureEmptyOutputDirectory(plan.outputDir);
  } catch (error) {
    console.error(error.message);
    return 2;
  }

  const environment = { ...process.env };
  environment.POORUP_VISUAL_CAPTURE = '1';
  environment.POORUP_CAPTURE_VISUALS = '1';
  environment.POORUP_VISUAL_CAPTURE_DIR = plan.outputDir;
  environment.POORUP_CAPTURE_SEED = plan.runId;
  environment.POORUP_CAPTURE_GROUP = plan.group;
  environment.PORT = '8080';
  delete environment.POORUP_QA_BASE_URL;
  if (options.viewport) {
    const profile = plan.profiles[0];
    environment.POORUP_CAPTURE_VIEWPORT = profile.supported ? profile.id : `${profile.width}x${profile.height}`;
  } else {
    delete environment.POORUP_CAPTURE_VIEWPORT;
  }

  const playwrightArgs = [playwrightCli, ...playwrightTestArgs(plan, configPath)];
  console.log(formatCaptureList(plan));
  const run = spawnSync(process.execPath, playwrightArgs, {
    cwd: repositoryRoot,
    env: environment,
    stdio: 'inherit',
    windowsHide: true,
  });
  const playwrightExitCode = run.error || run.status === null ? 1 : run.status;
  const failures = run.error ? [run.error.message] : playwrightExitCode === 0 ? [] : [`Playwright exited with code ${playwrightExitCode}.`];

  let manifest;
  try {
    manifest = await buildGallery({
      outputDir: plan.outputDir,
      profiles: plan.profiles,
      expectedCaptures: plan.expectedCaptures,
      source: sourceMetadata(),
      failures,
      runId: plan.runId,
    });
  } catch (error) {
    console.error(`Could not build capture gallery: ${error.message}`);
    return 1;
  }

  console.log(`Gallery: ${path.join(plan.outputDir, 'index.html')}`);
  console.log(`Manifest: ${path.join(plan.outputDir, 'manifest.json')}`);
  console.log(`Captured ${manifest.summary.captured}/${manifest.summary.expected}; ${manifest.summary.missing} missing, ${manifest.summary.duplicates} duplicates, ${manifest.summary.failed} failures.`);
  return evaluateCaptureResult(plan, playwrightExitCode, manifest);
}

main().then(code => {
  process.exitCode = code;
}).catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
