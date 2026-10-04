import assert from 'node:assert/strict';
import path from 'node:path';
import test from 'node:test';
import { captureCatalog } from './catalog.mjs';
import { buildCapturePlan, evaluateCaptureResult, playwrightTestArgs } from './runner.mjs';

test('capture plan filters a single group and viewport without changing supported defaults', () => {
  const plan = buildCapturePlan({ group: 'pages', viewport: 'ipad-1194x834', outputDir: 'qa-artifacts/test-run' }, new Date('2026-10-03T10:00:00.000Z'));

  assert.equal(plan.runId, 'test-run');
  assert.equal(plan.outputDir, path.resolve('qa-artifacts/test-run'));
  assert.deepEqual(plan.profiles.map(profile => profile.id), ['ipad-1194x834']);
  assert.equal(plan.expectedCaptures.length, 5);
  assert.equal(plan.flows.length, 1);
  assert.match(plan.grep, /shared header and first content stay fixed/);
  assert.equal(plan.supported, true);
});

test('default capture plan covers the complete catalog across supported profiles only', () => {
  const plan = buildCapturePlan({}, new Date('2026-10-03T10:00:00.000Z'));
  const catalogSize = captureCatalog.reduce((count, entry) => count + entry.surfaceIds.length, 0);

  assert.equal(plan.expectedCaptures.length, catalogSize * 12);
  assert.equal(plan.profiles.some(profile => profile.width === 1366 && profile.height === 768), false);
  assert.equal(plan.profiles.some(profile => profile.width === 1280 && profile.height === 720), false);
  assert.equal(plan.profiles.some(profile => profile.group === 'phone' || profile.orientation === 'portrait'), false);
});

test('custom one-off viewport is included but marked unsupported', () => {
  const plan = buildCapturePlan({ group: 'market', viewport: '1280x720' });

  assert.equal(plan.profiles[0].id, 'custom-1280x720');
  assert.equal(plan.profiles[0].supported, false);
  assert.equal(plan.supported, false);
  assert.equal(plan.expectedCaptures.length, 2);
});

test('Playwright receives only the selected capture test titles and profile projects', () => {
  const plan = buildCapturePlan({ group: 'lobby', viewport: 'ipad-1194x834' });
  const args = playwrightTestArgs(plan, 'qa/visual-capture/playwright.config.js');

  assert.deepEqual(args.slice(0, 3), ['test', '--config=qa/visual-capture/playwright.config.js', '--workers=1']);
  assert.match(args.find(argument => argument.startsWith('--grep=')), /capture every in-game modal/);
  assert.deepEqual(plan.flows.map(flow => flow.testTitle), ['capture every in-game modal on supported landscape profiles']);
});

test('runner fails on incomplete runs but allows explicit one-off profiles to remain labeled unsupported', () => {
  const plan = buildCapturePlan({ group: 'pages', viewport: 'ipad-1194x834' });
  const complete = { summary: { expected: 5, captured: 5, missing: 0, duplicates: 0, failed: 0 } };
  const incomplete = { summary: { expected: 5, captured: 4, missing: 1, duplicates: 0, failed: 0 } };

  assert.equal(evaluateCaptureResult(plan, 0, complete), 0);
  assert.equal(evaluateCaptureResult(plan, 1, complete), 1);
  assert.equal(evaluateCaptureResult(plan, 0, incomplete), 1);
  assert.equal(evaluateCaptureResult({ ...plan, supported: false }, 0, complete), 0);
});
