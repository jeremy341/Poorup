/* global Buffer, process */
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm, stat } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { captureCatalog, captureGroups, expectedCaptureKeys, selectCaptureSuites } from './catalog.mjs';
import { buildGallery } from './gallery.mjs';
import { captureScreenshot } from './screenshot.mjs';

const profile = {
  id: 'desktop-1440x900',
  width: 1440,
  height: 900,
  deviceScaleFactor: 1,
  isMobile: false,
  hasTouch: false,
  aliases: [],
};

function createTestInfo() {
  return {
    project: { name: profile.id, use: { viewport: { width: profile.width, height: profile.height }, deviceScaleFactor: 1 } },
    title: 'visual fixture test',
    projectName: profile.id,
  };
}

test('screenshot helper writes profile metadata and gallery links to the real output file', async t => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'poorup-capture-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const page = {
    async screenshot({ path: screenshotPath }) {
      const { mkdir, writeFile } = await import('node:fs/promises');
      await mkdir(path.dirname(screenshotPath), { recursive: true });
      await writeFile(screenshotPath, 'png-fixture');
      return Buffer.from('png-fixture');
    },
  };

  const capture = await captureScreenshot(page, createTestInfo(), {
    outputDir,
    group: 'pages',
    surfaceId: 'home',
    label: 'Home',
    fixtureId: 'public-shell',
  });
  assert.equal(capture.relativePath, 'desktop-1440x900/pages/home.png');
  assert.equal((await stat(path.join(outputDir, capture.relativePath))).size, 11);

  const gallery = await buildGallery({
    outputDir,
    profiles: [profile],
    expectedCaptures: [{ group: 'pages', surfaceId: 'home', label: 'Home' }],
    source: { branch: 'development', commit: 'abc1234', dirty: true },
  });
  assert.deepEqual(gallery.summary, { expected: 1, captured: 1, missing: 0, duplicates: 0, failed: 0 });
  assert.equal(gallery.captures[0].browser, 'chromium');
  assert.equal(gallery.captures[0].fixtureId, 'public-shell');
  assert.ok(gallery.captures[0].capturedAt);
  const html = await readFile(path.join(outputDir, 'index.html'), 'utf8');
  assert.match(html, /Home/);
  assert.match(html, /desktop-1440x900\/pages\/home\.png/);
});

test('gallery records missing captures and escapes labels instead of hiding partial runs', async t => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'poorup-capture-partial-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const gallery = await buildGallery({
    outputDir,
    profiles: [profile],
    expectedCaptures: [{ group: 'pages', surfaceId: 'rankings', label: '<img src=x onerror=alert(1)>' }],
    source: { branch: 'development', commit: 'abc1234', dirty: true },
    failures: ['rankings fixture did not open'],
  });

  assert.deepEqual(gallery.summary, { expected: 1, captured: 0, missing: 1, duplicates: 0, failed: 1 });
  const html = await readFile(path.join(outputDir, 'index.html'), 'utf8');
  assert.match(html, /&lt;img src=x onerror=alert\(1\)&gt;/);
  assert.doesNotMatch(html, /<img src=x/);
  const manifest = JSON.parse(await readFile(path.join(outputDir, 'manifest.json'), 'utf8'));
  assert.equal(manifest.captures[0].status, 'missing');
  assert.deepEqual(manifest.failures, ['rankings fixture did not open']);
});

test('gallery does not multiply already profile-scoped expected entries by the viewport matrix again', async t => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'poorup-capture-scoped-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const ipad = { ...profile, id: 'ipad-1194x834', width: 1194, height: 834, deviceScaleFactor: 2, aliases: ['iPad Pro 11'] };
  const gallery = await buildGallery({
    outputDir,
    profiles: [profile, ipad],
    expectedCaptures: [
      { profileId: profile.id, group: 'pages', surfaceId: 'home', label: 'Home' },
      { profileId: ipad.id, group: 'pages', surfaceId: 'rankings', label: 'Rankings' },
    ],
    source: { branch: 'development', commit: 'abc1234', dirty: true },
  });

  assert.equal(gallery.summary.expected, 2);
  assert.deepEqual(gallery.missing, [
    'desktop-1440x900/pages/home',
    'ipad-1194x834/pages/rankings',
  ]);
});

test('screenshot helper rejects duplicate surface paths before overwriting evidence', async t => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'poorup-capture-duplicate-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const page = {
    async screenshot({ path: screenshotPath }) {
      const { mkdir, writeFile } = await import('node:fs/promises');
      await mkdir(path.dirname(screenshotPath), { recursive: true });
      await writeFile(screenshotPath, 'png-fixture');
    },
  };
  const options = { outputDir, group: 'pages', surfaceId: 'home', label: 'Home' };
  await captureScreenshot(page, createTestInfo(), options);
  await assert.rejects(captureScreenshot(page, createTestInfo(), options), /duplicate capture path/);
});

test('fallback screenshots create their parent directory for existing capture flows', async t => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'poorup-capture-fallback-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const fallbackPath = path.join(outputDir, 'nested', 'legacy.png');
  const page = {
    async screenshot({ path: screenshotPath }) {
      const { writeFile } = await import('node:fs/promises');
      await writeFile(screenshotPath, 'legacy-image');
    },
  };

  await captureScreenshot(page, createTestInfo(), { fallbackPath });
  assert.equal((await stat(fallbackPath)).size, 12);
});

test('capture group filters omit other groups without writing screenshots or records', async t => {
  const outputDir = await mkdtemp(path.join(os.tmpdir(), 'poorup-capture-group-'));
  t.after(() => rm(outputDir, { recursive: true, force: true }));
  const previousGroup = process.env.POORUP_CAPTURE_GROUP;
  process.env.POORUP_CAPTURE_GROUP = 'pages';
  t.after(() => {
    if (previousGroup === undefined) delete process.env.POORUP_CAPTURE_GROUP;
    else process.env.POORUP_CAPTURE_GROUP = previousGroup;
  });
  const page = { async screenshot() { throw new Error('filtered capture should not touch the browser'); } };

  const capture = await captureScreenshot(page, createTestInfo(), {
    outputDir,
    group: 'game',
    surfaceId: 'game-board',
    label: 'Game board',
  });

  assert.equal(capture.status, 'skipped');
  await assert.rejects(stat(path.join(outputDir, 'desktop-1440x900/game/game-board.png')), /ENOENT/);
});

test('capture catalog covers every user-facing group without duplicate profile keys', () => {
  assert.deepEqual(captureGroups, ['admin', 'funding', 'game', 'lobby', 'market', 'pages', 'player']);
  assert.ok(captureCatalog.some(entry => entry.group === 'pages' && entry.surfaceIds.includes('rankings')));
  assert.ok(captureCatalog.some(entry => entry.group === 'lobby' && entry.surfaceIds.includes('waiting-lobby')));
  assert.ok(captureCatalog.some(entry => entry.group === 'game' && entry.surfaceIds.includes('board-standard-40')));
  assert.ok(captureCatalog.some(entry => entry.group === 'game' && entry.surfaceIds.includes('board-metro-52')));
  assert.ok(captureCatalog.some(entry => entry.group === 'game' && entry.surfaceIds.includes('tile-airport')));
  assert.ok(captureCatalog.some(entry => entry.group === 'game' && entry.surfaceIds.includes('tile-electric-company')));
  assert.ok(captureCatalog.some(entry => entry.group === 'game' && entry.surfaceIds.includes('tile-water-company')));
  assert.ok(captureCatalog.some(entry => entry.group === 'game' && entry.surfaceIds.includes('card-gallery')));
  assert.ok(captureCatalog.some(entry => entry.group === 'admin' && entry.surfaceIds.includes('admin-match-health')));

  const keys = expectedCaptureKeys(['desktop-1440x900']);
  assert.equal(keys.length, new Set(keys).size);
  assert.ok(selectCaptureSuites('pages').every(entry => entry.group === 'pages'));
  assert.throws(() => selectCaptureSuites('phone'), /Unknown capture group/);
});
