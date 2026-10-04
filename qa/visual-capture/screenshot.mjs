/* global process */
import { appendFile, mkdir, stat } from 'node:fs/promises';
import path from 'node:path';
import { supportedViewports } from './viewports.mjs';

function safeSegment(value, label) {
  const segment = String(value || '');
  if (!/^[a-z0-9][a-z0-9-]*$/i.test(segment)) throw new Error(`Invalid ${label}: ${segment}`);
  return segment;
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
  if (!outputDir) {
    if (!fallbackPath) throw new Error('Screenshot capture needs a visual output directory or fallbackPath.');
    const resolvedFallbackPath = path.resolve(fallbackPath);
    await mkdir(path.dirname(resolvedFallbackPath), { recursive: true });
    await page.screenshot({ path: resolvedFallbackPath, animations: 'disabled', fullPage });
    return { relativePath: path.resolve(fallbackPath), status: 'captured' };
  }

  const selectedGroup = process.env.POORUP_CAPTURE_GROUP;
  if (selectedGroup && selectedGroup !== 'all' && selectedGroup !== group) {
    return { status: 'skipped', group };
  }

  const groupSegment = safeSegment(group, 'capture group');
  const surfaceSegment = safeSegment(surfaceId, 'surface ID');
  const profileId = safeSegment(testInfo.project.name, 'viewport profile');
  const relativePath = `${profileId}/${groupSegment}/${surfaceSegment}.png`;
  const absolutePath = path.join(path.resolve(outputDir), ...relativePath.split('/'));
  await mkdir(path.dirname(absolutePath), { recursive: true });

  try {
    await stat(absolutePath);
    throw new Error(`duplicate capture path: ${relativePath}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }

  await page.screenshot({ path: absolutePath, animations: 'disabled', fullPage });
  const use = testInfo.project.use || {};
  const profile = supportedViewports.find(candidate => candidate.id === profileId);
  const record = {
    profileId,
    group: groupSegment,
    surfaceId: surfaceSegment,
    label: String(label),
    relativePath,
    width: use.viewport?.width || null,
    height: use.viewport?.height || null,
    deviceScaleFactor: use.deviceScaleFactor || 1,
    isMobile: Boolean(use.isMobile),
    hasTouch: Boolean(use.hasTouch),
    aliases: profile?.aliases || [],
    browser: use.browserName || 'chromium',
    browserVersion: page.context?.().browser?.()?.version?.() || null,
    fixtureId: fixtureId || testInfo.title,
    capturedAt: new Date().toISOString(),
    status: 'captured',
  };
  const recordDirectory = path.join(path.resolve(outputDir), '.records');
  await mkdir(recordDirectory, { recursive: true });
  await appendFile(path.join(recordDirectory, `${profileId}.jsonl`), `${JSON.stringify(record)}\n`, 'utf8');
  return record;
}
