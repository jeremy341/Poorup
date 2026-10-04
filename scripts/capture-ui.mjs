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

function readOptions(argv) {
  try {
    return { options: parseCaptureArgs(argv) };
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    return { exitCode: 2 };
  }
}

function createCapturePlan(options) {
  try {
    return { plan: buildCapturePlan(options) };
  } catch (error) {
    console.error(error.message);
    console.error(usage());
    return { exitCode: 2 };
  }
}

function captureEnvironment(plan, options) {
  const environment = { ...process.env };
  Object.assign(environment, {
    POORUP_VISUAL_CAPTURE: '1',
    POORUP_CAPTURE_VISUALS: '1',
    POORUP_VISUAL_CAPTURE_DIR: plan.outputDir,
    POORUP_CAPTURE_SEED: plan.runId,
    POORUP_CAPTURE_GROUP: plan.group,
    PORT: '8080',
  });
  delete environment.POORUP_QA_BASE_URL;

  if (options.viewport) {
    const profile = plan.profiles[0];
    environment.POORUP_CAPTURE_VIEWPORT = profile.supported ? profile.id : `${profile.width}x${profile.height}`;
  } else {
    delete environment.POORUP_CAPTURE_VIEWPORT;
  }
  return environment;
}

function runPlaywright(plan, options) {
  const playwrightArgs = [playwrightCli, ...playwrightTestArgs(plan, configPath)];
  const run = spawnSync(process.execPath, playwrightArgs, {
    cwd: repositoryRoot,
    env: captureEnvironment(plan, options),
    stdio: 'inherit',
    windowsHide: true,
  });
  const exitCode = run.error || run.status === null ? 1 : run.status;
  const failures = run.error ? [run.error.message] : exitCode === 0 ? [] : [`Playwright exited with code ${exitCode}.`];
  return { exitCode, failures };
}

async function writeCaptureGallery(plan, failures) {
  try {
    const manifest = await buildGallery({
      outputDir: plan.outputDir,
      profiles: plan.profiles,
      expectedCaptures: plan.expectedCaptures,
      source: sourceMetadata(),
      failures,
      runId: plan.runId,
    });
    return { manifest };
  } catch (error) {
    console.error(`Could not build capture gallery: ${error.message}`);
    return { exitCode: 1 };
  }
}

async function executeCapture(plan, options) {
  try {
    await ensureEmptyOutputDirectory(plan.outputDir);
  } catch (error) {
    console.error(error.message);
    return 2;
  }

  console.log(formatCaptureList(plan));
  const result = runPlaywright(plan, options);
  const gallery = await writeCaptureGallery(plan, result.failures);
  if (!gallery.manifest) return gallery.exitCode;

  console.log(`Gallery: ${path.join(plan.outputDir, 'index.html')}`);
  console.log(`Manifest: ${path.join(plan.outputDir, 'manifest.json')}`);
  console.log(`Captured ${gallery.manifest.summary.captured}/${gallery.manifest.summary.expected}; ${gallery.manifest.summary.missing} missing, ${gallery.manifest.summary.duplicates} duplicates, ${gallery.manifest.summary.failed} failures.`);
  return evaluateCaptureResult(plan, result.exitCode, gallery.manifest);
}

async function main() {
  const parsed = readOptions(process.argv.slice(2));
  if (parsed.exitCode !== undefined) return parsed.exitCode;
  const { options } = parsed;
  if (options.help) {
    console.log(usage());
    return 0;
  }

  const prepared = createCapturePlan(options);
  if (prepared.exitCode !== undefined) return prepared.exitCode;
  const { plan } = prepared;
  if (options.list) {
    console.log(formatCaptureList(plan));
    return 0;
  }
  return executeCapture(plan, options);
}

main().then(code => {
  process.exitCode = code;
}).catch(error => {
  console.error(error.stack || error.message);
  process.exitCode = 1;
});
