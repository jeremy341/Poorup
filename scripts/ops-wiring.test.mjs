import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { readdirSync, readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

// Text-level contracts for the operations files that cannot run in this
// repository's unit environment: the deploy shell scripts, the Dockerfile, the
// GitHub workflows and the licence/font files. Each check names the finding it
// guards, so a regression reads as the defect it reintroduces.

const root = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
// Working copies on Windows check files out with CRLF; the contracts are about
// content, so every read normalises to LF.
const read = relative => readFileSync(path.join(root, relative), 'utf8').replace(/\r\n/g, '\n');
const require = createRequire(import.meta.url);
const { parseEnvText } = require(path.join(root, 'scripts', 'loadEnvFile.cjs'));

// Environment contract: .env.example is the template the host copies,
// so it must parse under the loader and name every runtime variable.
const templateValues = parseEnvText(read('.env.example'), { source: '.env.example' });
assert.equal(templateValues.NODE_ENV, 'development', '.env.example parses with the bash-compatible loader');

const documented = new Set(read('.env.example').match(/POORUP_[A-Z0-9_]+/g));
// Variables read by server code that the template leaves out.
const NOT_IN_TEMPLATE = new Map([
  ['POORUP_TEST_RECONNECT_GRACE_MS', 'test-only reconnect grace override (NODE_ENV=test)'],
  ['POORUP_TRANSACTIONAL_ADAPTER_READY', 'PostgreSQL migration seam, inert in the single-process runtime'],
  ['POORUP_BOT_ADVISOR', 'alias of POORUP_BOT_BRAIN read by the advisor fallback; documented with the bot runtime'],
  ['POORUP_BOT_AI_DECISIONS', 'AI decision budget alias; documented with the AI budget work (C35-05)'],
  ['POORUP_AI_DECISIONS', 'AI decision budget; documented with the AI budget work (C35-05)'],
  ['POORUP_BOT_LIVE_AI', 'live-provider switch for the bot tournament CLI only'],
  ['POORUP_BOT_LIVE_AI_MAX_CALLS', 'live-provider call cap for the bot tournament CLI only'],
  ['POORUP_BOT_AI_SHADOW', 'shadow-AI evaluation switch for the bot tournament CLI only'],
  ['POORUP_BOT_EVAL_CALL_CAP', 'bot evaluation tuning for the tournament CLI only'],
  ['POORUP_BOT_EVAL_COUNT', 'bot evaluation tuning for the tournament CLI only'],
  ['POORUP_BOT_EVAL_SEEDS', 'bot evaluation tuning for the tournament CLI only'],
  ['POORUP_BOT_EVAL_STEP_LIMIT', 'bot evaluation tuning for the tournament CLI only']
]);

function serverSourceFiles() {
  const dir = path.join(root, 'server');
  return readdirSync(dir)
    .filter(name => name.endsWith('.js') && !/\.test\.js$/.test(name))
    .map(name => path.join(dir, name));
}

const runtimeNames = new Set();
for (const file of serverSourceFiles()) {
  for (const [name] of readFileSync(file, 'utf8').matchAll(/POORUP_[A-Z0-9_]+/g)) runtimeNames.add(name);
}
const undocumented = [...runtimeNames].filter(name => !documented.has(name) && !NOT_IN_TEMPLATE.has(name)).sort();
assert.deepEqual(undocumented, [], `server runtime variables missing from .env.example (F-068): ${undocumented.join(', ')}`);

// Deploy and drain scripts. They are
// not executed here (no Nest host); the contracts below pin the behaviour the
// reviewed text must keep. Syntax is checked by parsing only (bash -n).
const deploy = read('scripts/deploy-nest.sh');
const rollback = read('scripts/rollback-nest.sh');
const updater = read('scripts/nest-auto-update.sh');
const beginDrain = read('scripts/begin-drain.sh');
const endDrain = read('scripts/end-drain.sh');
const shellScripts = { 'deploy-nest.sh': deploy, 'rollback-nest.sh': rollback, 'nest-auto-update.sh': updater, 'begin-drain.sh': beginDrain, 'end-drain.sh': endDrain };

// Health gate: a host with no backup directory reports backupFresh:null
// and must pass; a configured host must report backupFresh:true.
assert.match(deploy, /backupConfigured":false/, 'the health gate accepts backupConfigured:false (F-067)');
assert.match(deploy, /backups_ready "\$ready_body"/, 'the health gate uses the backup predicate, not a bare backupFresh:true match (F-067)');

// Rollback restores the release id that the failed deploy overwrote.
assert.match(rollback, /PREVIOUS_SHA="\$\(basename "\$PREVIOUS_DIR"\)"/, 'rollback derives the previous release id (F-067)');
assert.match(rollback, /POORUP_RELEASE_ID=\$PREVIOUS_SHA/, 'rollback stamps the previous release id before reloading (F-067)');
assert.ok(rollback.indexOf('POORUP_RELEASE_ID=$PREVIOUS_SHA') < rollback.indexOf('pm2 startOrReload'), 'the stamp lands before the reload that reads it (F-067)');

// A failed SHA is recorded so the updater stops retrying it.
assert.match(deploy, /failed-releases\/\$RELEASE_SHA/, 'a failed health gate records the SHA (F-067)');
assert.ok(deploy.indexOf('failed-releases/$RELEASE_SHA') < deploy.indexOf('rollback-nest.sh"'), 'the failed SHA is recorded before the rollback runs (F-067)');
assert.match(updater, /\$APP_ROOT\/shared\/failed-releases\/\$latest_sha/, 'the updater skips a recorded failed SHA (F-067)');

// npm ci output is kept on the journal, so a failed install explains itself.
assert.doesNotMatch(updater, /npm ci[^\n]*2>&1/, 'npm ci output is not discarded (F-067)');

// The updater does not delete every CI-uploaded archive at the start of a tick.
assert.doesNotMatch(updater, /rm -f \/tmp\/poorup-\*/, 'the updater does not glob-delete fresh /tmp archives (E37-12)');

// A drain that times out returns the parlor to normal before failing.
assert.match(deploy, /did not drain[\s\S]*?post_maintenance '\{"mode":"normal"\}'[\s\S]*?exit 1/, 'a drain timeout posts normal before exiting (E37-12)');

// Waiting lobbies are reported when the reload drops them.
assert.match(deploy, /waitingRooms/, 'the deploy reads the waiting-lobby count (E37-04)');

// The maintenance token never reaches curl through argv. The
// updater itself sends no token; it hands the token to deploy-nest.sh by env.
for (const [name, source] of Object.entries(shellScripts).filter(([name]) => name !== 'nest-auto-update.sh')) {
  assert.doesNotMatch(source, /-H "x-poorup-maintenance-token: /, `${name} passes the maintenance token through argv (E37-09)`);
  assert.match(source, /-H "@\$MAINTENANCE_HEADER"/, `${name} sends the token from a 0600 header file (E37-09)`);
}

// Every shell script parses (bash -n only reads the text; nothing is run).
// The text is normalised to LF and fed on stdin, so a CRLF working copy or a
// Windows-path-hostile bash (WSL stub) cannot fail the parse; a host without a
// usable bash skips it (CI runs Linux).
for (const [name] of Object.entries(shellScripts)) {
  const parsed = spawnSync('bash', ['-n'], { cwd: root, input: read(`scripts/${name}`), encoding: 'utf8' });
  if (parsed.error || (process.platform === 'win32' && parsed.status === 127)) {
    console.log(`skipped bash -n scripts/${name}: no usable bash on this host`);
    continue;
  }
  assert.equal(parsed.status, 0, `bash -n scripts/${name}: ${parsed.stderr || parsed.error?.message || ''}`);
}

// Workflow gates: a workflow_run deploy or undrain acts only
// on a push to main from this repository, so a fork pull request whose branch
// is named main cannot reach the production host.
const deployWorkflow = read('.github/workflows/deploy-nest.yml');
const undrainWorkflow = read('.github/workflows/maintenance-undrain.yml');
for (const [name, workflow] of [['deploy-nest.yml', deployWorkflow], ['maintenance-undrain.yml', undrainWorkflow]]) {
  assert.match(workflow, /workflow_run\.event == 'push'/, `${name} requires a push-triggered CI run (G12-03)`);
  assert.match(workflow, /workflow_run\.head_repository\.full_name == github\.repository/, `${name} requires the CI head repository to be this one (G12-03)`);
}
// Undrain returns to normal only when no newer CI run on main is still pending;
// that run's own drain governs maintenance.
assert.match(undrainWorkflow, /status != \\"completed\\"/, 'undrain counts pending newer CI runs on main (E37-12)');
assert.match(undrainWorkflow, /if: steps\.newer\.outputs\.skip != 'true'/, 'undrain skips the SSH step when a newer run is pending (E37-12)');
assert.match(undrainWorkflow, /ref: \$\{\{ github\.event\.repository\.default_branch \}\}/, 'undrain runs end-drain.sh from the default branch (G12-03)');

// CI tiers and gates.
const ci = read('.github/workflows/ci.yml');
// The text of one top-level job: from its header to the next job header.
const jobBody = name => {
  const start = ci.indexOf(`\n  ${name}:\n`);
  assert.notEqual(start, -1, `ci.yml defines the ${name} job`);
  const next = ci.slice(start + 1).search(/\n {2}[a-z][a-z-]*:\n/);
  return next === -1 ? ci.slice(start) : ci.slice(start, start + 1 + next);
};
assert.match(ci, /EVENT_NAME" = "push" \] && \[ "\$PUSH_BRANCH" = "main" \]; then\s+tier=fast/, 'a push to main runs the fast tier with the testing-tree check (G12-04)');
assert.match(jobBody('lint'), /node server\/docs-parity\.test\.js/, 'docs-only pull requests still run the docs parity suite (G12-05)');
assert.match(jobBody('lint'), /node server\/docsFeatureStatus\.test\.js/, 'docs-only pull requests still run the feature-status suite (G12-05)');
assert.match(jobBody('boot'), /NODE_ENV=production[\s\S]*POORUP_ALLOWED_ORIGINS=[\s\S]*POORUP_DATA_DIR=[\s\S]*POORUP_BACKUP_DIR=[\s\S]*POORUP_HTTP_RATE_LIMIT=[\s\S]*POORUP_SOCKET_RATE_WINDOW_MS=/, 'boot smoke runs in production mode with its required directories and rate limits (G12-10)');
assert.match(ci, /^ {2}docker:\n[\s\S]*docker build[\s\S]*\/healthz/m,'a CI job builds the Docker image and smokes /healthz (G12-11)');
assert.match(jobBody('coverage'), /c8 report[^\n]*--check-coverage/, 'coverage enforces its floors (G12-08)');

const pkg = JSON.parse(read('package.json'));
assert.match(pkg.scripts.lint, /eslint server scripts qa --max-warnings \d+/, 'lint covers scripts and qa with a warning ratchet (G12-09)');
assert.equal(pkg.dependencies['@typesafe-ai/sdk'], undefined, 'the unused @typesafe-ai/sdk dependency is removed (E37-15)');
assert.equal(pkg.dependencies.echarts, undefined, 'echarts is not a runtime dependency (E37-15)');
assert.equal(pkg.devDependencies.echarts, undefined, 'echarts is gone: every chart is drawn by the in-house SVG module');
assert.equal(pkg.devDependencies.uplot, undefined, 'uplot is gone: every chart is drawn by the in-house SVG module');
const lock = JSON.parse(read('package-lock.json'));
const lockRoot = lock.packages[''];
assert.deepEqual(lockRoot.dependencies, pkg.dependencies, 'the lockfile root dependencies match package.json (E37-15)');
assert.deepEqual(lockRoot.devDependencies, pkg.devDependencies, 'the lockfile root devDependencies match package.json (E37-15)');
assert.equal(lock.packages['node_modules/@typesafe-ai/sdk'], undefined, 'the lockfile drops the unused SDK package (E37-15)');

// The nightly 1,000-game campaign covers development as well as main, and it
// leaves a summary and a log artifact behind.
const campaign = read('.github/workflows/bot-campaign.yml');
assert.match(campaign, /ref: \[main, development\]/, 'the nightly campaign runs on main and development (G12-14)');
assert.match(campaign, /GITHUB_STEP_SUMMARY/, 'the nightly campaign writes a step summary (G12-14)');
assert.match(campaign, /uses: actions\/upload-artifact@v6[\s\S]*path: campaign\.log/, 'the nightly campaign uploads its log (G12-14)');

// Container: the data volume is owned by the runtime user, one VOLUME,
// a .dockerignore keeps live data and secrets out of the image, and the health
// check uses readiness so a draining container is not reported healthy.
const dockerfile = read('Dockerfile');
assert.equal((dockerfile.match(/^VOLUME /gm) || []).length, 1, 'the Dockerfile declares one VOLUME (E37-06)');
// Production refuses to boot without positive rate limits, so the image must
// carry them (its first boot otherwise crash-loops).
for (const name of ['POORUP_HTTP_RATE_LIMIT', 'POORUP_HTTP_RATE_WINDOW_MS', 'POORUP_SOCKET_RATE_LIMIT', 'POORUP_SOCKET_RATE_WINDOW_MS']) {
  assert.match(dockerfile, new RegExp(`^ENV ${name}=\\d+$`, 'm'), `the image sets ${name} for production boot`);
}
// The data and backup directories are siblings under the mounted volume
// (a backup dir inside the data dir is refused by the production storage
// assertion, so the image must create both of them side by side) and the whole
// tree is owned by the runtime user.
assert.match(dockerfile, /mkdir -p [^\n]*\/var\/lib\/poorup\/(?:data|backups)[^\n]*\/var\/lib\/poorup\/(?:data|backups)[\s\S]*chown -R node:node \/var\/lib\/poorup/, 'the data and backup directories are created and owned by node (E37-06)');
assert.ok(dockerfile.indexOf('chown -R node:node') < dockerfile.indexOf('\nUSER node'), 'ownership is set before the USER switch (E37-06)');
assert.match(dockerfile, /HEALTHCHECK[\s\S]*\/readyz/, 'the container health check uses readiness (E37-06)');
const dockerignore = read('.dockerignore').split('\n').map(line => line.trim());
for (const entry of ['server/data', 'server/backups', '.env*', '.git', 'node_modules', 'qa-artifacts']) {
  assert.ok(dockerignore.includes(entry), `.dockerignore excludes ${entry} (E37-06)`);
}

// Licence and font credits.
const license = read('LICENSE');
assert.match(license, /^MIT License/, 'the repository carries an MIT LICENSE file (E37-16)');
assert.match(license, /Permission is hereby granted, free of charge/, 'the LICENSE file contains the MIT grant (E37-16)');
const fontCredits = read('public/assets/fonts/README.md');
for (const file of ['ibm-plex-mono-500.woff2', 'ibm-plex-mono-600.woff2', 'jersey15-regular.woff2', 'pixelify-sans-400.woff2', 'pixelify-sans-700.woff2', 'silkscreen-regular.ttf']) {
  assert.ok(fontCredits.includes(file), `the font credits name ${file} (E37-16)`);
}

console.log('ops wiring: env template, deploy/drain, workflow, container, package and licence contracts pass');
