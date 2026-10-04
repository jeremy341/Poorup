import assert from 'node:assert/strict';
import test from 'node:test';
import { parseCaptureArgs, selectViewports, supportedViewports } from './viewports.mjs';

test('supported matrix includes all named desktop and landscape-iPad viewport tiers', () => {
  const profiles = new Map(supportedViewports.map(profile => [profile.id, profile]));

  for (const id of [
    'desktop-1440x900', 'desktop-1536x900', 'desktop-1600x900', 'desktop-1920x1080',
    'desktop-2560x1440', 'desktop-3840x2160',
    'ipad-944x656', 'ipad-1024x768', 'ipad-1080x810', 'ipad-1180x820',
    'ipad-1194x834', 'ipad-1366x1024',
  ]) assert.ok(profiles.has(id), `missing profile ${id}`);

  assert.equal(profiles.get('ipad-1024x768').aliases.length, 3);
  assert.equal(profiles.has('desktop-3440x1440'), false, '3440×1440 is no longer a supported profile');
  assert.equal(supportedViewports.some(profile => profile.width === 1366 && profile.height === 768), false);
  assert.equal(supportedViewports.some(profile => profile.width === 1280 && profile.height === 720), false);
  assert.equal(supportedViewports.some(profile => profile.group === 'phone' || profile.orientation === 'portrait'), false);
});

test('capture CLI parses group, viewport, output directory, and list filters', () => {
  assert.deepEqual(parseCaptureArgs(['--group=game', '--viewport=ipad-1194x834', '--output-dir=artifacts/run-1', '--list']), {
    group: 'game', viewport: 'ipad-1194x834', outputDir: 'artifacts/run-1', list: true,
  });
});

test('capture CLI accepts a custom viewport without adding it to the supported matrix', () => {
  const options = parseCaptureArgs(['--viewport=1280x720']);
  const selected = selectViewports(options);

  assert.equal(selected.length, 1);
  assert.equal(selected[0].id, 'custom-1280x720');
  assert.equal(selected[0].supported, false);
  assert.equal(supportedViewports.some(profile => profile.id === selected[0].id), false);
});

test('capture CLI rejects malformed or zero-sized custom viewports', () => {
  assert.throws(() => parseCaptureArgs(['--viewport=1920']), /WIDTHxHEIGHT/);
  assert.throws(() => parseCaptureArgs(['--viewport=0x720']), /positive/);
  assert.throws(() => parseCaptureArgs(['--viewport=768x1024']), /landscape/);
  assert.throws(() => parseCaptureArgs(['--unsupported=true']), /Unknown option/);
});

test('capture selection rejects unknown profile IDs and accepts supported IDs', () => {
  assert.deepEqual(selectViewports({ viewport: 'ipad-1194x834' }).map(profile => profile.id), ['ipad-1194x834']);
  assert.throws(() => selectViewports({ viewport: 'portrait-ipad' }), /Unknown viewport/);
});
