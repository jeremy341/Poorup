import { test, expect } from '@playwright/test';

test('aircraft remain in the visible skyline until near their escape deadline', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await page.locator('#home-night-shift-start').click();
  const first = page.locator('.night-target').first();
  await expect(first).toBeVisible();
  const { id, duration } = await first.evaluate(el => ({ id: el.dataset.targetId, duration: parseFloat(el.style.getPropertyValue('--night-flight-duration')) }));
  const target = page.locator(`[data-target-id="${id}"]`);
  await page.waitForTimeout(Math.round(duration * 0.75));
  const geometry = await target.evaluate(el => {
    const target = el.getBoundingClientRect();
    const layer = el.parentElement.getBoundingClientRect();
    return { targetLeft: target.left, targetRight: target.right, layerLeft: layer.left, layerRight: layer.right };
  });
  expect(geometry.targetRight).toBeGreaterThan(geometry.layerLeft);
  expect(geometry.targetLeft).toBeLessThan(geometry.layerRight);
});


test('a tagged drone bursts at its live position', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.setViewportSize({ width: 1366, height: 768 });
  await page.goto('/');
  await page.locator('#home-night-shift-start').click();
  const drone = page.locator('.night-target-drone');
  await expect(drone).toHaveCount(1, { timeout: 8000 });
  await page.waitForTimeout(1500);
  const positions = await drone.evaluate(el => {
    const before = el.getBoundingClientRect();
    el.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true, clientX: before.left + before.width / 2, clientY: before.top + before.height / 2 }));
    const after = el.getBoundingClientRect();
    return { beforeX: before.x, beforeY: before.y, afterX: after.x, afterY: after.y };
  });
  expect(Math.abs(positions.afterX - positions.beforeX)).toBeLessThan(20);
  expect(Math.abs(positions.afterY - positions.beforeY)).toBeLessThan(20);
});

test('pausing freezes target interaction timing until play resumes', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await page.locator('#home-night-shift-start').click();
  const target = page.locator('.night-target').first();
  await expect(target).toHaveCount(1);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(1600);
  await expect(target).toHaveCSS('pointer-events', 'none');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(target).toHaveCSS('pointer-events', 'auto', { timeout: 2500 });
});

test('signed-in play displays and submits the server-owned target score', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await page.evaluate(async () => {
    const { state } = await import('/clientState.js');
    const patrol = await import('/clientNightShift.js');
    state.account = { account: { id: 'test' } };
    const now = Date.now();
    const target = { id: 'server-target', kind: 'drone', direction: 'right', lane: 32, duration: 5680, spawnedAt: now, actionableAt: now, expiresAt: now + 5680, wave: 1 };
    const snapshot = { runToken: 'server-run', serverTime: now, revision: 1, wave: 1, endsAt: now + 60000, score: 0, hearts: 3, misses: 0, targets: [target], ended: false, paused: false };
    window.patrolCalls = [];
    const noop = () => {};
    patrol.configureNightShift({ stopHomeHelicopter: noop, stopHomeClock: noop, renderPatrolHud: noop, startHomeClock: noop, scheduleHomeHelicopter: noop, parlorNotice: noop, unlockAchievement: noop, playPatrolHitSound: noop,
      emitServer(event, payload, callback) {
        window.patrolCalls.push({ event, payload });
        if (event === 'start-patrol-run') callback({ success: true, ...snapshot });
        if (event === 'hit-patrol-target') callback({ success: true, ...snapshot, revision: 2, score: 85, targets: [], targetId: target.id, points: 85 });
      } });
    patrol.startNightShift();
  });
  const target = page.locator('[data-target-id="server-target"]');
  await expect(target).toHaveCount(1);
  await target.dispatchEvent('pointerdown');
  await expect(page.locator('#home-patrol-score')).toHaveText('085');
  const hit = await page.evaluate(() => window.patrolCalls.find(call => call.event === 'hit-patrol-target'));
  expect(hit.payload).toEqual({ runToken: 'server-run', targetId: 'server-target' });
});

test('signed-in targets are not interactive before the server opens their hit window', async ({ page }) => {
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.evaluate(async () => {
    const { state } = await import('/clientState.js');
    const patrol = await import('/clientNightShift.js');
    state.account = { account: { id: 'test' } };
    const now = Date.now();
    const target = { id: 'future', kind: 'drone', direction: 'right', lane: 32, duration: 5680, spawnedAt: now, actionableAt: now + 1200, expiresAt: now + 5680, wave: 1 };
    const noop = () => {};
    patrol.configureNightShift({ stopHomeHelicopter: noop, stopHomeClock: noop, renderPatrolHud: noop, startHomeClock: noop, scheduleHomeHelicopter: noop, parlorNotice: noop, unlockAchievement: noop, playPatrolHitSound: noop,
      emitServer(event, payload, callback) { if (event === 'start-patrol-run') callback({ success: true, runToken: 'server-run', serverTime: now, revision: 1, wave: 1, endsAt: now + 60000, score: 0, hearts: 3, misses: 0, targets: [target], ended: false, paused: false }); } });
    patrol.startNightShift();
  });
  const target = page.locator('[data-target-id="future"]');
  await expect(target).toHaveCSS('pointer-events', 'none');
  await expect(target).toHaveCSS('pointer-events', 'auto', { timeout: 2500 });
  await expect(target).toHaveCount(0, { timeout: 6000 });
});

test('a long-run score remains fully visible without obscuring wave or clock', async ({ page }) => {
  await page.setViewportSize({ width: 1024, height: 768 });
  await page.goto('/');
  await page.locator('#home-night-shift-start').click();
  await page.evaluate(async () => {
    const { nightShiftState, renderNightShiftHud } = await import('/clientNightShift.js');
    nightShiftState.score = Number.MAX_SAFE_INTEGER;
    renderNightShiftHud();
  });
  const score = page.locator('#home-patrol-score');
  await expect(score).toHaveText('9007199254740991');
  const geometry = await page.evaluate(() => {
    const box = selector => document.querySelector(selector).getBoundingClientRect();
    const s = box('#home-patrol-score'), w = box('#night-wave'), c = box('#home-local-time'), area = box('.home-sky-atmosphere');
    return { scoreLeft: s.left, scoreRight: s.right, waveRight: w.right, clockRight: c.right, areaLeft: area.left, areaRight: area.right };
  });
  expect(geometry.scoreLeft).toBeGreaterThanOrEqual(geometry.areaLeft);
  expect(geometry.scoreRight).toBeLessThanOrEqual(geometry.areaRight);
  expect(geometry.scoreLeft).toBeGreaterThan(geometry.waveRight);
  expect(geometry.scoreLeft).toBeGreaterThan(geometry.clockRight);
});
