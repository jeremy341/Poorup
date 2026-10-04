/* global process */
import { appendFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { supportedViewports } from './viewports.mjs';

function safeSegment(value, label) {
  const segment = String(value || '');
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(segment)) throw new Error(`Invalid ${label}: ${segment}`);
  return segment;
}

async function captureFallback(page, fallbackPath, fullPage) {
  if (!fallbackPath) throw new Error('Screenshot capture needs a visual output directory or fallbackPath.');
  const resolvedPath = path.resolve(fallbackPath);
  await mkdir(path.dirname(resolvedPath), { recursive: true });
  await page.screenshot({ path: resolvedPath, animations: 'disabled', fullPage });
  return { relativePath: resolvedPath, status: 'captured' };
}

function isCaptureGroupSkipped(group) {
  const selectedGroup = process.env.POORUP_CAPTURE_GROUP;
  return Boolean(selectedGroup && selectedGroup !== 'all' && selectedGroup !== group);
}

function capturePaths(outputDir, profileId, group, surfaceId) {
  const groupSegment = safeSegment(group, 'capture group');
  const surfaceSegment = safeSegment(surfaceId, 'surface ID');
  const safeProfileId = safeSegment(profileId, 'viewport profile');
  const relativePath = `${safeProfileId}/${groupSegment}/${surfaceSegment}.png`;
  return { relativePath, absolutePath: path.join(path.resolve(outputDir), ...relativePath.split('/')) };
}

async function ensureCapturePathIsUnused(absolutePath, relativePath) {
  try {
    await stat(absolutePath);
  } catch (error) {
    if (error.code === 'ENOENT') return;
    throw error;
  }
  throw new Error(`duplicate capture path: ${relativePath}`);
}

function captureProfileMetadata(use, profile) {
  return {
    width: use.viewport?.width || null,
    height: use.viewport?.height || null,
    deviceScaleFactor: use.deviceScaleFactor || 1,
    isMobile: Boolean(use.isMobile),
    hasTouch: Boolean(use.hasTouch),
    aliases: profile?.aliases || [],
  };
}

function captureBrowserMetadata(page, use) {
  return {
    browser: use.browserName || 'chromium',
    browserVersion: page.context?.().browser?.()?.version?.() || null,
  };
}

function captureRecord(capture) {
  const { page, testInfo, profileId, group, surfaceId, label, relativePath, fixtureId } = capture;
  const use = testInfo.project.use || {};
  const profile = supportedViewports.find(candidate => candidate.id === profileId);
  return {
    profileId,
    group,
    surfaceId,
    label: String(label),
    relativePath,
    ...captureProfileMetadata(use, profile),
    ...captureBrowserMetadata(page, use),
    fixtureId: fixtureId || testInfo.title,
    capturedAt: new Date().toISOString(),
    status: 'captured',
  };
}

async function appendCaptureRecord(outputDir, profileId, record) {
  const recordDirectory = path.join(path.resolve(outputDir), '.records');
  await mkdir(recordDirectory, { recursive: true });
  await appendFile(path.join(recordDirectory, `${profileId}.jsonl`), `${JSON.stringify(record)}\n`, 'utf8');
}

export async function captureScreenshot(page, testInfo, {
  group,
  surfaceId,
  label = surfaceId,
  fixtureId = null,
  fallbackPath = null,
  outputDir = process.env.POORUP_VISUAL_CAPTURE_DIR,
  fullPage = false,
} = {}) {
  if (!outputDir) return captureFallback(page, fallbackPath, fullPage);
  if (isCaptureGroupSkipped(group)) return { status: 'skipped', group };

  const profileId = testInfo.project.name;
  const { relativePath, absolutePath } = capturePaths(outputDir, profileId, group, surfaceId);
  await mkdir(path.dirname(absolutePath), { recursive: true });
  await ensureCapturePathIsUnused(absolutePath, relativePath);
  await page.screenshot({ path: absolutePath, animations: 'disabled', fullPage });
  const record = captureRecord({
    page,
    testInfo,
    profileId,
    group: safeSegment(group, 'capture group'),
    surfaceId: safeSegment(surfaceId, 'surface ID'),
    label,
    relativePath,
    fixtureId,
  });
  await appendCaptureRecord(outputDir, profileId, record);
  return record;
}
