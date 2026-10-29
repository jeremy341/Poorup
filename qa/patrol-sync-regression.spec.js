import { test, expect } from '@playwright/test';

async function enable(page) {
  await page.addInitScript(() => {
    // The no-op collaborators configureNightShift needs; each scenario overrides only the callbacks it observes.
    window.patrolNoopDeps = () => {
      const noop = () => {};
      return { stopHomeHelicopter: noop, stopHomeClock: noop, renderPatrolHud: noop, startHomeClock: noop, scheduleHomeHelicopter: noop, parlorNotice: noop, unlockAchievement: noop, playPatrolHitSound: noop };
    };
  });
  await page.route('**/clientParlorPatrolFlag.js', async route => {
    const response = await route.fetch();
    await route.fulfill({ response, body: (await response.text()).replace('PARLOR_PATROL_ENABLED = false', 'PARLOR_PATROL_ENABLED = true') });
  });
}

// Serves the night-shift module with extra named exports so a scenario can drive its internals.
// Names the module already exports (after the split, some helpers are shared
// with sibling modules) are skipped, so the appended export never repeats one.
async function exposeNightShiftExports(page, names) {
  await page.route('**/clientNightShift.js', async route => {
    const response = await route.fetch();
    const text = await response.text();
    const missing = names.split(',').map(name => name.trim()).filter(name => !new RegExp(`export function ${name}\\(`).test(text));
    await route.fulfill({ response, body: missing.length ? `${text}\nexport { ${missing.join(', ')} };` : text });
  });
}

test('a delayed server push uses estimated current server time for target position and hit gate', async ({ page }) => {
  await enable(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await page.evaluate(async () => {
    const { state } = await import('/clientState.js');
    const patrol = await import('/clientNightShift.js');
    state.account = { account: { id: 'test' } };
    patrol.configureNightShift({ ...window.patrolNoopDeps(),
      emitServer(event, payload, callback) { if (event === 'start-patrol-run') { const now = Date.now(); callback({ success: true, runToken: 'run', serverTime: now, revision: 1, wave: 1, endsAt: now + 60000, score: 0, hearts: 3, misses: 0, targets: [], ended: false, paused: false }); } } });
    patrol.startNightShift();
    const sent = Date.now() - 1000;
    patrol.applyPatrolState({ runToken: 'run', revision: 2, serverTime: sent, wave: 1, endsAt: sent + 60000, score: 0, hearts: 3, misses: 0, targets: [{ id: 'delayed', kind: 'drone', direction: 'right', lane: 32, duration: 10000, spawnedAt: sent, actionableAt: sent + 500, expiresAt: sent + 10000, wave: 1 }], ended: false, paused: false });
  });
  const target = page.locator('[data-target-id="delayed"]');
  await expect(target).toHaveCSS('pointer-events', 'auto', { timeout: 300 });
  const progress = await target.evaluate(el => el.getAnimations()[0]?.currentTime || 0);
  expect(progress).toBeGreaterThan(700);
  const countdown = await page.locator('#home-local-time').textContent();
  expect(countdown).toBe('00:59');
});

test('guest targets survive a wave boundary and resolve only once', async ({ page }) => {
  await enable(page);
  await exposeNightShiftExports(page, 'spawnNightShiftTarget, advanceNightShiftWave, missNightShiftTarget');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const patrol = await import('/clientNightShift.js');
    const { state } = await import('/clientState.js');
    state.account = null;
    patrol.configureNightShift({ ...window.patrolNoopDeps() });
    patrol.startNightShift();
    patrol.spawnNightShiftTarget();
    const first = document.querySelector('.night-target');
    patrol.advanceNightShiftWave();
    const survived = first.isConnected;
    patrol.missNightShiftTarget(first);
    patrol.missNightShiftTarget(first);
    const heartsAfterMiss = patrol.nightShiftState.hearts;
    patrol.spawnNightShiftTarget();
    const second = [...document.querySelectorAll('.night-target')].at(-1);
    patrol.advanceNightShiftWave();
    const secondSurvived = second.isConnected;
    second.dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    patrol.missNightShiftTarget(second);
    return { survived, secondSurvived, heartsAfterMiss, heartsAfterHit: patrol.nightShiftState.hearts };
  });
  expect(result).toEqual({ survived: true, secondSurvived: true, heartsAfterMiss: 2, heartsAfterHit: 2 });
});

test('guest clean-run unlock requires a resolved clean wave followed by game over', async ({ page }) => {
  await enable(page);
  await exposeNightShiftExports(page, 'spawnNightShiftTarget, advanceNightShiftWave, missNightShiftTarget');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const unlocked = await page.evaluate(async () => {
    const patrol = await import('/clientNightShift.js');
    const { state } = await import('/clientState.js');
    state.account = null;
    const earned = [];
    const noop = () => {};
    patrol.configureNightShift({ stopHomeHelicopter: noop, stopHomeClock: noop, renderPatrolHud: noop, startHomeClock: noop, scheduleHomeHelicopter: noop, parlorNotice: noop, unlockAchievement: id => earned.push(id), playPatrolHitSound: noop });
    patrol.startNightShift();
    patrol.spawnNightShiftTarget();
    document.querySelector('.night-target').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    patrol.advanceNightShiftWave();
    for (let i = 0; i < 3; i++) {
      patrol.spawnNightShiftTarget();
      patrol.missNightShiftTarget([...document.querySelectorAll('.night-target')].at(-1));
    }
    return earned;
  });
  expect(unlocked).toContain('clean-run');
});

test('unequal pause and resume latency reconciles the existing target to server time', async ({ page }) => {
  await enable(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await page.evaluate(async () => {
    const { state } = await import('/clientState.js');
    const patrol = await import('/clientNightShift.js');
    state.account = { account: { id: 'test' } };
    const now = Date.now();
    const target = { id: 'paused', kind: 'drone', direction: 'right', lane: 32, duration: 10000, spawnedAt: now, actionableAt: now + 500, expiresAt: now + 10000, wave: 1 };
    const snapshot = { runToken: 'run', revision: 1, serverTime: now, wave: 1, endsAt: now + 60000, score: 0, hearts: 3, misses: 0, targets: [target], ended: false, paused: false };
    let pausedAt;
    window.patrolResumeDone = false;
    patrol.configureNightShift({ ...window.patrolNoopDeps(),
      emitServer(event, payload, callback) {
        if (event === 'start-patrol-run') callback({ success: true, ...snapshot });
        if (event === 'pause-patrol-run') {
          pausedAt = Date.now() + 100;
          setTimeout(() => callback({ success: true, ...snapshot, revision: 2, serverTime: pausedAt, paused: true }), 400);
        }
        if (event === 'resume-patrol-run') {
          const resumedAt = Date.now() + 100;
          const shift = resumedAt - pausedAt;
          const shifted = { ...target, spawnedAt: target.spawnedAt + shift, actionableAt: target.actionableAt + shift, expiresAt: target.expiresAt + shift };
          window.expectedSpawn = shifted.spawnedAt;
          setTimeout(() => { callback({ success: true, ...snapshot, revision: 3, serverTime: resumedAt, endsAt: snapshot.endsAt + shift, targets: [shifted], paused: false }); window.patrolResumeDone = true; }, 500);
        }
      } });
    patrol.startNightShift();
  });
  await page.waitForTimeout(250);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(450);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.locator('body')).toHaveClass(/night-shift-paused/);
  await page.waitForFunction(() => window.patrolResumeDone);
  // Read both clocks in the same frame: a slow 4K frame would otherwise let the animation clock lag the wall clock.
  const timing = await page.locator('[data-target-id="paused"]').evaluate(async el => {
    await new Promise(resolve => requestAnimationFrame(() => resolve()));
    return { actual: el.getAnimations()[0].currentTime, expected: Date.now() - window.expectedSpawn };
  });
  // Wall-clock tolerance: a 4K run under load can lag the animation clock by ~200ms; an unshifted animation misses by the whole pause.
  expect(Math.abs(timing.actual - timing.expected)).toBeLessThan(300);
  await expect(page.locator('body')).not.toHaveClass(/night-shift-paused/);
});

test('guest clean-run is not awarded on early exit or a wave with an escaped beacon', async ({ page }) => {
  await enable(page);
  await exposeNightShiftExports(page, 'spawnNightShiftTarget, advanceNightShiftWave, missNightShiftTarget');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  const result = await page.evaluate(async () => {
    const patrol = await import('/clientNightShift.js');
    const { state } = await import('/clientState.js');
    state.account = null;
    const earned = [];
    const noop = () => {};
    patrol.configureNightShift({ stopHomeHelicopter: noop, stopHomeClock: noop, renderPatrolHud: noop, startHomeClock: noop, scheduleHomeHelicopter: noop, parlorNotice: noop, unlockAchievement: id => earned.push(id), playPatrolHitSound: noop });
    patrol.startNightShift();
    patrol.spawnNightShiftTarget();
    document.querySelector('.night-target').dispatchEvent(new PointerEvent('pointerdown', { bubbles: true }));
    patrol.advanceNightShiftWave();
    patrol.stopNightShift();
    const early = earned.includes('clean-run');
    earned.length = 0;
    patrol.startNightShift();
    patrol.spawnNightShiftTarget(); patrol.missNightShiftTarget(document.querySelector('.night-target'));
    patrol.advanceNightShiftWave();
    patrol.spawnNightShiftTarget(); patrol.missNightShiftTarget(document.querySelector('.night-target'));
    patrol.advanceNightShiftWave();
    const originalRandom = Math.random;
    Math.random = () => 0.2;
    patrol.spawnNightShiftTarget();
    const beacon = document.querySelector('.night-target-beacon');
    patrol.missNightShiftTarget(beacon);
    patrol.advanceNightShiftWave();
    Math.random = () => 0.9;
    patrol.spawnNightShiftTarget(); patrol.missNightShiftTarget(document.querySelector('.night-target'));
    Math.random = originalRandom;
    return { early, beaconWasSpawned: Boolean(beacon), awarded: earned.includes('clean-run') };
  });
  expect(result).toEqual({ early: false, beaconWasSpawned: true, awarded: false });
});

test('an already expired target is not displayed after a delayed snapshot', async ({ page }) => {
  await enable(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.evaluate(async () => {
    const { state } = await import('/clientState.js');
    const patrol = await import('/clientNightShift.js');
    state.account = { account: { id: 'test' } };
    patrol.configureNightShift({ ...window.patrolNoopDeps(),
      emitServer(event, payload, callback) { if (event === 'start-patrol-run') { const now = Date.now(); callback({ success: true, runToken: 'run', serverTime: now, revision: 1, wave: 1, endsAt: now + 60000, score: 0, hearts: 3, misses: 0, targets: [], ended: false, paused: false }); } } });
    patrol.startNightShift();
    const sent = Date.now() - 1000;
    patrol.applyPatrolState({ runToken: 'run', revision: 2, serverTime: sent, wave: 1, endsAt: sent + 60000, score: 0, hearts: 3, misses: 0, targets: [{ id: 'expired', kind: 'drone', direction: 'right', lane: 32, duration: 1000, spawnedAt: sent - 800, actionableAt: sent - 600, expiresAt: sent + 200, wave: 1 }], ended: false, paused: false });
  });
  await expect(page.locator('[data-target-id="expired"]')).toHaveCount(0);
});

test('visible play resumes when start acknowledgement follows hide and show', async ({ page }) => {
  await enable(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await page.evaluate(async () => {
    const { state } = await import('/clientState.js');
    const patrol = await import('/clientNightShift.js');
    state.account = { account: { id: 'test' } };
    patrol.configureNightShift({ ...window.patrolNoopDeps(),
      emitServer(event, payload, callback) { if (event === 'start-patrol-run') window.delayedStart = callback; } });
    patrol.startNightShift();
    Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange'));
    const now = Date.now();
    window.delayedStart({ success: true, runToken: 'run', revision: 1, serverTime: now, wave: 1, endsAt: now + 60000, score: 0, hearts: 3, misses: 0, targets: [{ id: 'late', kind: 'drone', direction: 'right', lane: 32, duration: 10000, spawnedAt: now, actionableAt: now + 500, expiresAt: now + 10000, wave: 1 }], ended: false, paused: false });
  });
  await expect(page.locator('body')).not.toHaveClass(/night-shift-paused/);
  const animation = await page.locator('[data-target-id="late"]').evaluate(el => el.getAnimations()[0].playState);
  expect(animation).toBe('running');
  await expect(page.locator('#night-hearts')).toHaveAttribute('aria-label', '3 hearts remaining');
});

test('reordered visibility acknowledgements cannot unpause targets while hidden', async ({ page }) => {
  await enable(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await page.evaluate(async () => {
    const { state } = await import('/clientState.js');
    const patrol = await import('/clientNightShift.js');
    state.account = { account: { id: 'test' } };
    const now = Date.now();
    const snapshot = { success: true, runToken: 'run', revision: 1, serverTime: now, wave: 1, endsAt: now + 60000, score: 0, hearts: 3, misses: 0, targets: [{ id: 'aircraft', kind: 'drone', direction: 'right', lane: 32, duration: 10000, spawnedAt: now, actionableAt: now + 500, expiresAt: now + 10000, wave: 1 }], ended: false, paused: false };
    const calls = [];
    patrol.configureNightShift({ ...window.patrolNoopDeps(),
      emitServer(event, payload, callback) { if (event === 'start-patrol-run') callback(snapshot); else calls.push({ event, callback }); } });
    patrol.startNightShift();
    Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange'));
    Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange'));
    calls.find(call => call.event === 'resume-patrol-run').callback({ ...snapshot, revision: 3, paused: false });
    calls.filter(call => call.event === 'pause-patrol-run').at(-1).callback({ ...snapshot, revision: 4, paused: true });
  });
  await expect(page.locator('body')).toHaveClass(/night-shift-paused/);
  const animation = await page.locator('[data-target-id="aircraft"]').evaluate(el => el.getAnimations()[0].playState);
  expect(animation).toBe('paused');
  await expect(page.locator('#night-hearts')).toHaveAttribute('aria-label', '3 hearts remaining');
});

test('a start-paused run stays safe while hidden and begins only when visible', async ({ page }) => {
  await enable(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await page.evaluate(async () => {
    const { state } = await import('/clientState.js');
    const patrol = await import('/clientNightShift.js');
    state.account = { account: { id: 'test' } };
    window.patrolStartCalls = [];
    let start;
    patrol.configureNightShift({ ...window.patrolNoopDeps(),
      emitServer(event, payload, callback) {
        window.patrolStartCalls.push(event);
        if (event === 'start-patrol-run') { start = callback; return; }
        if (event === 'resume-patrol-run') {
          const now = Date.now();
          callback({ success: true, runToken: 'run', revision: 2, serverTime: now, wave: 1, endsAt: now + 60000, score: 0, hearts: 3, misses: 0, targets: [{ id: 'ready', kind: 'drone', direction: 'right', lane: 32, duration: 10000, spawnedAt: now, actionableAt: now + 500, expiresAt: now + 10000, wave: 1 }], ended: false, paused: false });
        }
      } });
    patrol.startNightShift();
    Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange'));
    const now = Date.now();
    start({ success: true, runToken: 'run', revision: 1, serverTime: now, wave: 1, endsAt: now + 60000, score: 0, hearts: 3, misses: 0, targets: [], ended: false, paused: true });
  });
  await expect(page.locator('body')).toHaveClass(/night-shift-paused/);
  expect(await page.evaluate(() => window.patrolStartCalls)).toEqual(['start-patrol-run']);
  await expect(page.locator('#night-hearts')).toHaveAttribute('aria-label', '3 hearts remaining');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.locator('body')).not.toHaveClass(/night-shift-paused/);
  await expect(page.locator('[data-target-id="ready"]')).toHaveCount(1);
  expect(await page.evaluate(() => window.patrolStartCalls)).toEqual(['start-patrol-run', 'resume-patrol-run']);
});

test('aircraft are visible by the earliest accepted hit and until near escape at desktop and tablet widths', async ({ browser }) => {
  for (const viewport of [{ width: 944, height: 656 }, { width: 1024, height: 768 }, { width: 1920, height: 1080 }]) {
    const page = await browser.newPage({ viewport, reducedMotion: 'no-preference' });
    await enable(page);
    await exposeNightShiftExports(page, 'spawnNightShiftTarget');
    await page.goto('/');
    const measurements = await page.evaluate(async () => {
      const patrol = await import('/clientNightShift.js');
      const { state } = await import('/clientState.js');
      state.account = null;
      patrol.configureNightShift({ ...window.patrolNoopDeps() });
      patrol.startNightShift();
      const layer = document.querySelector('#night-targets');
      const result = [];
      for (const [kind, duration] of [['helicopter', 4200], ['drone', 3400], ['airplane', 2800]]) {
        for (const direction of ['left', 'right']) {
          const id = `${kind}-${direction}`;
          const now = Date.now();
          patrol.spawnNightShiftTarget({ id, kind, direction, lane: 32, duration, spawnedAt: now, actionableAt: now + Math.round(duration * .16), expiresAt: now + duration, wave: 1 }, now);
          const target = [...layer.querySelectorAll('.night-target')].find(element => element.dataset.targetId === id);
          const animation = target.getAnimations()[0];
          animation.pause();
          const overlapAt = time => {
            animation.currentTime = time;
            const a = target.getBoundingClientRect(), b = layer.getBoundingClientRect();
            return { width: Math.max(0, Math.min(a.right, b.right) - Math.max(a.left, b.left)), height: Math.max(0, Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top)) };
          };
          result.push({ kind, direction, earliest: overlapAt(Math.round(duration * .16) - 150), nearEnd: overlapAt(duration * .97), atEnd: overlapAt(duration) });
          target.remove();
        }
      }
      return result;
    });
    for (const item of measurements) {
      const description = `${viewport.width} ${item.kind} ${item.direction}`;
      expect(item.earliest.width, description).toBeGreaterThanOrEqual(16);
      expect(item.earliest.height, description).toBeGreaterThanOrEqual(16);
      expect(item.nearEnd.width, description).toBeGreaterThan(0);
      expect(item.nearEnd.height, description).toBeGreaterThan(0);
      expect(Math.min(item.atEnd.width, item.atEnd.height), description).toBeLessThan(2);
    }
    await page.close();
  }
});

test('a server offer becomes actionable only after the client announces readiness', async ({ page }) => {
  await enable(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.evaluate(async () => {
    const { state } = await import('/clientState.js');
    const patrol = await import('/clientNightShift.js');
    state.account = { account: { id: 'test' } };
    const now = Date.now();
    const offer = { id: 'offer', kind: 'drone', direction: 'right', lane: 32, duration: 3400, wave: 1, deliveryPending: true, offeredAt: now, readyBy: now + 10000, spawnedAt: null, actionableAt: null, expiresAt: null };
    window.readyCalls = [];
    const base = { success: true, runToken: 'run', serverTime: now, revision: 1, wave: 1, endsAt: now + 60000, score: 0, hearts: 3, misses: 0, targets: [offer], ended: false, paused: false };
    patrol.configureNightShift({ ...window.patrolNoopDeps(),
      emitServer(event, payload, callback) {
        window.readyCalls.push({ event, payload });
        if (event === 'start-patrol-run') callback(base);
        if (event === 'ready-patrol-target') { const current = Date.now(); callback({ ...base, revision: 2, serverTime: current, targets: [{ ...offer, deliveryPending: false, spawnedAt: current - 544, actionableAt: current, expiresAt: current + 2856 }] }); }
      } });
    patrol.startNightShift();
  });
  const target = page.locator('[data-target-id="offer"]');
  await expect(target).toHaveCount(1);
  await expect(target).toHaveCSS('pointer-events', 'none');
  await expect(target).toHaveCSS('pointer-events', 'auto', { timeout: 2000 });
  const calls = await page.evaluate(() => window.readyCalls);
  expect(calls.map(call => call.event)).toContain('ready-patrol-target');
});

test('an offer delayed longer than a target flight still starts on receipt without losing hearts', async ({ page }) => {
  await enable(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await page.evaluate(async () => {
    const { state } = await import('/clientState.js');
    const patrol = await import('/clientNightShift.js');
    state.account = { account: { id: 'test' } };
    const now = Date.now();
    const base = { success: true, runToken: 'run', serverTime: now, revision: 1, wave: 1, endsAt: now + 60000, score: 0, hearts: 3, misses: 0, targets: [], ended: false, paused: false };
    window.readyCalls = [];
    patrol.configureNightShift({ ...window.patrolNoopDeps(),
      emitServer(event, payload, callback) {
        window.readyCalls.push(event);
        if (event === 'start-patrol-run') callback(base);
        if (event === 'ready-patrol-target') { const t = Date.now(); callback({ ...base, revision: 3, serverTime: t, targets: [{ id: 'slow', kind: 'drone', direction: 'right', lane: 32, duration: 2800, wave: 1, deliveryPending: false, spawnedAt: t - 448, actionableAt: t, expiresAt: t + 2352 }] }); }
      } });
    patrol.startNightShift();
    window.deliverSlowOffer = () => {
      const offeredAt = Date.now() - 4000;
      patrol.applyPatrolState({ ...base, revision: 2, serverTime: offeredAt, targets: [{ id: 'slow', kind: 'drone', direction: 'right', lane: 32, duration: 2800, wave: 1, deliveryPending: true, offeredAt, readyBy: offeredAt + 10000, spawnedAt: null, actionableAt: null, expiresAt: null }] });
    };
  });
  await page.waitForTimeout(4000);
  await page.evaluate(() => window.deliverSlowOffer());
  await expect(page.locator('[data-target-id="slow"]')).toHaveCount(1);
  await expect(page.locator('#night-hearts')).toHaveAttribute('aria-label', '3 hearts remaining');
  await expect.poll(() => page.evaluate(() => window.readyCalls.includes('ready-patrol-target')), { timeout: 2000 }).toBe(true);
});

test('a hit sent after ready succeeds even if the ready acknowledgement is delayed', async ({ page }) => {
  await enable(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.evaluate(async () => {
    const { state } = await import('/clientState.js');
    const patrol = await import('/clientNightShift.js');
    state.account = { account: { id: 'test' } };
    const noop = () => {};
    const now = Date.now();
    const offer = { id: 'race', kind: 'drone', direction: 'right', lane: 32, duration: 3400, wave: 1, deliveryPending: true, offeredAt: now, readyBy: now + 10000, spawnedAt: null, actionableAt: null, expiresAt: null };
    const base = { success: true, runToken: 'run', serverTime: now, revision: 1, wave: 1, endsAt: now + 60000, score: 0, hearts: 3, misses: 0, targets: [offer], ended: false, paused: false };
    window.raceEvents = []; window.raceNotices = [];
    patrol.configureNightShift({ stopHomeHelicopter: noop, stopHomeClock: noop, renderPatrolHud: noop, startHomeClock: noop, scheduleHomeHelicopter: noop, parlorNotice: (title, text) => window.raceNotices.push(text), unlockAchievement: noop, playPatrolHitSound: noop,
      emitServer(event, payload, callback) {
        window.raceEvents.push(event);
        if (event === 'start-patrol-run') callback(base);
        if (event === 'ready-patrol-target') window.lateReady = callback;
        if (event === 'hit-patrol-target') callback({ ...base, revision: 3, serverTime: Date.now(), score: 85, targets: [], targetId: 'race', points: 85 });
      } });
    patrol.startNightShift();
  });
  const target = page.locator('[data-target-id="race"]');
  await expect(target).toHaveCSS('pointer-events', 'auto', { timeout: 2000 });
  await target.dispatchEvent('pointerdown');
  await expect(page.locator('#home-patrol-score')).toHaveText('085');
  await page.evaluate(() => window.lateReady({ success: true, runToken: 'run', revision: 2, serverTime: Date.now(), wave: 1, endsAt: Date.now() + 60000, score: 0, hearts: 3, misses: 0, targets: [], ended: false, paused: false }));
  await page.waitForTimeout(2200);
  const result = await page.evaluate(() => ({ events: window.raceEvents, notices: window.raceNotices }));
  expect(result.events.indexOf('ready-patrol-target')).toBeLessThan(result.events.indexOf('hit-patrol-target'));
  expect(result.events).not.toContain('finish-patrol-run');
  expect(result.notices).toEqual([]);
  await expect(page.locator('#night-hearts')).toHaveAttribute('aria-label', '3 hearts remaining');
});

test('unconfirmed target readiness retries once then ends without deducting hearts', async ({ page }) => {
  await enable(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.evaluate(async () => {
    const { state } = await import('/clientState.js');
    const patrol = await import('/clientNightShift.js');
    state.account = { account: { id: 'test' } };
    const now = Date.now();
    const offer = { id: 'lost', kind: 'drone', direction: 'right', lane: 32, duration: 2800, wave: 1, deliveryPending: true, offeredAt: now, readyBy: now + 10000, spawnedAt: null, actionableAt: null, expiresAt: null };
    const base = { success: true, runToken: 'run', serverTime: now, revision: 1, wave: 1, endsAt: now + 60000, score: 125, hearts: 3, misses: 0, targets: [offer], ended: false, paused: false };
    window.timeoutEvents = [];
    patrol.configureNightShift({ ...window.patrolNoopDeps(),
      emitServer(event, payload, callback) {
        window.timeoutEvents.push({ event, payload });
        if (event === 'start-patrol-run') callback(base);
        if (event === 'finish-patrol-run') callback({ success: true, score: 125, best: 125, misses: 0 });
      } });
    patrol.startNightShift();
  });
  await expect(page.locator('#night-status')).toContainText('NETWORK INTERRUPTION', { timeout: 4500 });
  await expect(page.locator('#night-hearts')).toHaveAttribute('aria-label', '3 hearts remaining');
  const events = await page.evaluate(() => window.timeoutEvents);
  expect(events.filter(entry => entry.event === 'ready-patrol-target').map(entry => entry.payload.targetId)).toEqual(['lost', 'lost']);
  expect(events.filter(entry => entry.event === 'finish-patrol-run')).toHaveLength(1);
});

test('a late ready acknowledgement cannot undo hidden pause or resurrect a hit target', async ({ page }) => {
  await enable(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await page.evaluate(async () => {
    const { state } = await import('/clientState.js');
    const patrol = await import('/clientNightShift.js');
    state.account = { account: { id: 'test' } };
    const now = Date.now();
    const offer = { id: 'reorder', kind: 'drone', direction: 'right', lane: 32, duration: 3400, wave: 1, deliveryPending: true, offeredAt: now, readyBy: now + 10000, spawnedAt: null, actionableAt: null, expiresAt: null };
    const base = { success: true, runToken: 'run', serverTime: now, revision: 1, wave: 1, endsAt: now + 60000, score: 0, hearts: 3, misses: 0, targets: [offer], ended: false, paused: false };
    window.reorderEvents = [];
    patrol.configureNightShift({ ...window.patrolNoopDeps(),
      emitServer(event, payload, callback) {
        window.reorderEvents.push(event);
        if (event === 'start-patrol-run') callback(base);
        if (event === 'ready-patrol-target') window.delayedReady = callback;
        if (event === 'pause-patrol-run') window.delayedPause = callback;
        if (event === 'resume-patrol-run') {
          const t = Date.now();
          callback({ ...base, revision: 3, serverTime: t, targets: [{ ...offer, deliveryPending: false, spawnedAt: t - 544, actionableAt: t - 1, expiresAt: t + 2856 }], paused: false });
        }
        if (event === 'hit-patrol-target') callback({ ...base, revision: 4, serverTime: Date.now(), score: 85, targets: [], targetId: offer.id, points: 85 });
      } });
    patrol.startNightShift();
  });
  await expect.poll(() => page.evaluate(() => window.reorderEvents.includes('ready-patrol-target')), { timeout: 2000 }).toBe(true);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.locator('body')).toHaveClass(/night-shift-paused/);
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect(page.locator('body')).not.toHaveClass(/night-shift-paused/);
  await page.locator('[data-target-id="reorder"]').dispatchEvent('pointerdown');
  await page.evaluate(() => { const t = Date.now(); window.delayedReady({ success: true, runToken: 'run', revision: 2, serverTime: t, wave: 1, endsAt: t + 60000, score: 0, hearts: 3, misses: 0, targets: [], ended: false, paused: false }); });
  await expect(page.locator('#home-patrol-score')).toHaveText('085');
  await expect(page.locator('#night-hearts')).toHaveAttribute('aria-label', '3 hearts remaining');
  expect(await page.evaluate(() => window.reorderEvents)).not.toContain('finish-patrol-run');
});

test('server delivery timeout reports network interruption and settles earned score without losing hearts', async ({ page }) => {
  await enable(page);
  await page.goto('/');
  await page.evaluate(async () => {
    const { state } = await import('/clientState.js');
    const patrol = await import('/clientNightShift.js');
    state.account = { account: { id: 'test' } };
    const now = Date.now();
    const base = { success: true, runToken: 'run', serverTime: now, revision: 1, wave: 1, endsAt: now + 60000, score: 125, hearts: 3, misses: 0, targets: [], ended: false, paused: false };
    window.deliveryEvents = [];
    patrol.configureNightShift({ ...window.patrolNoopDeps(),
      emitServer(event, payload, callback) { window.deliveryEvents.push({ event, payload }); if (event === 'start-patrol-run') callback(base); if (event === 'finish-patrol-run') callback({ success: true, score: 125, best: 125, misses: 0 }); } });
    patrol.startNightShift();
    patrol.applyPatrolState({ ...base, revision: 2, ended: true, endReason: 'delivery-timeout' });
  });
  await expect(page.locator('#night-status')).toContainText('NETWORK INTERRUPTION');
  await expect(page.locator('#night-status')).not.toContainText('NO HEARTS');
  await expect(page.locator('#night-hearts')).toHaveAttribute('aria-label', '3 hearts remaining');
  const finish = await page.evaluate(() => window.deliveryEvents.find(entry => entry.event === 'finish-patrol-run'));
  expect(finish.payload).toEqual({ runToken: 'run' });
});

test('a lost ready acknowledgement is recovered by one idempotent retry', async ({ page }) => {
  await enable(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.evaluate(async () => {
    const { state } = await import('/clientState.js');
    const patrol = await import('/clientNightShift.js');
    state.account = { account: { id: 'test' } };
    const now = Date.now();
    const offer = { id: 'retry', kind: 'drone', direction: 'right', lane: 32, duration: 3400, wave: 1, deliveryPending: true, offeredAt: now, readyBy: now + 10000, spawnedAt: null, actionableAt: null, expiresAt: null };
    const base = { success: true, runToken: 'run', serverTime: now, revision: 1, wave: 1, endsAt: now + 60000, score: 0, hearts: 3, misses: 0, targets: [offer], ended: false, paused: false };
    window.readyRetries = 0; window.finishCount = 0;
    patrol.configureNightShift({ ...window.patrolNoopDeps(),
      emitServer(event, payload, callback) {
        if (event === 'start-patrol-run') callback(base);
        if (event === 'finish-patrol-run') window.finishCount++;
        if (event === 'ready-patrol-target' && ++window.readyRetries === 2) {
          const t = Date.now(); callback({ ...base, revision: 2, serverTime: t, targets: [{ ...offer, deliveryPending: false, spawnedAt: t - 1544, actionableAt: t - 1000, expiresAt: t + 1856 }] });
        }
      } });
    patrol.startNightShift();
  });
  await expect.poll(() => page.evaluate(() => window.readyRetries), { timeout: 3000 }).toBe(2);
  await page.waitForTimeout(1200);
  expect(await page.evaluate(() => window.finishCount)).toBe(0);
  await expect(page.locator('#night-hearts')).toHaveAttribute('aria-label', '3 hearts remaining');
});

test('an offer paused before readiness sends no ready event until visible again', async ({ page }) => {
  await enable(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await page.evaluate(async () => {
    const { state } = await import('/clientState.js');
    const patrol = await import('/clientNightShift.js');
    state.account = { account: { id: 'test' } };
    const now = Date.now();
    const offer = { id: 'paused-offer', kind: 'drone', direction: 'right', lane: 32, duration: 3400, wave: 1, deliveryPending: true, offeredAt: now, readyBy: now + 10000, spawnedAt: null, actionableAt: null, expiresAt: null };
    const base = { success: true, runToken: 'run', serverTime: now, revision: 1, wave: 1, endsAt: now + 60000, score: 0, hearts: 3, misses: 0, targets: [offer], ended: false, paused: false };
    window.offerEvents = [];
    patrol.configureNightShift({ ...window.patrolNoopDeps(),
      emitServer(event, payload, callback) {
        window.offerEvents.push(event);
        if (event === 'start-patrol-run') callback(base);
        if (event === 'pause-patrol-run') callback({ ...base, revision: 2, serverTime: Date.now(), paused: true });
        if (event === 'resume-patrol-run') callback({ ...base, revision: 3, serverTime: Date.now(), paused: false });
        if (event === 'ready-patrol-target') { const t = Date.now(); callback({ ...base, revision: 4, serverTime: t, targets: [{ ...offer, deliveryPending: false, spawnedAt: t - 544, actionableAt: t, expiresAt: t + 2856 }] }); }
      } });
    patrol.startNightShift();
    Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange'));
  });
  await page.waitForTimeout(900);
  expect(await page.evaluate(() => window.offerEvents)).not.toContain('ready-patrol-target');
  await page.evaluate(() => { Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(() => page.evaluate(() => window.offerEvents.includes('ready-patrol-target')), { timeout: 2000 }).toBe(true);
  await expect(page.locator('#night-hearts')).toHaveAttribute('aria-label', '3 hearts remaining');
});

test('disconnect during a pending ready request ignores the late acknowledgement', async ({ page }) => {
  await enable(page);
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('/');
  await page.evaluate(async () => {
    const { state } = await import('/clientState.js');
    const patrol = await import('/clientNightShift.js');
    state.account = { account: { id: 'test' } };
    const now = Date.now();
    const offer = { id: 'disconnect', kind: 'drone', direction: 'right', lane: 32, duration: 3400, wave: 1, deliveryPending: true, offeredAt: now, readyBy: now + 10000, spawnedAt: null, actionableAt: null, expiresAt: null };
    const base = { success: true, runToken: 'run', serverTime: now, revision: 1, wave: 1, endsAt: now + 60000, score: 0, hearts: 3, misses: 0, targets: [offer], ended: false, paused: false };
    window.disconnectEvents = [];
    patrol.configureNightShift({ ...window.patrolNoopDeps(),
      emitServer(event, payload, callback) { window.disconnectEvents.push(event); if (event === 'start-patrol-run') callback(base); if (event === 'ready-patrol-target') window.lateReadyDisconnect = callback; } });
    window.disconnectPatrol = patrol;
    patrol.startNightShift();
  });
  await expect.poll(() => page.evaluate(() => window.disconnectEvents.includes('ready-patrol-target')), { timeout: 2000 }).toBe(true);
  await page.evaluate(() => {
    window.disconnectPatrol.handlePatrolDisconnect();
    const now = Date.now();
    window.lateReadyDisconnect({ success: true, runToken: 'run', revision: 2, serverTime: now, wave: 1, endsAt: now + 60000, score: 999, hearts: 3, misses: 0, targets: [], ended: false, paused: false });
  });
  await expect(page.locator('#night-status')).toContainText('CONNECTION LOST');
  await expect(page.locator('#night-hearts')).toHaveAttribute('aria-label', '3 hearts remaining');
  expect(await page.evaluate(() => window.disconnectEvents)).not.toContain('finish-patrol-run');
});

test('a ready acknowledgement delayed 2.1 seconds does not interrupt a playable helicopter', async ({ page }) => {
  await enable(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await page.evaluate(async () => {
    const { state } = await import('/clientState.js');
    const patrol = await import('/clientNightShift.js');
    state.account = { account: { id: 'test' } };
    const now = Date.now();
    const offer = { id: 'slow-ready', kind: 'helicopter', direction: 'right', lane: 32, duration: 7340, wave: 1, deliveryPending: true, offeredAt: now, readyBy: now + 10000, spawnedAt: null, actionableAt: null, expiresAt: null };
    const base = { success: true, runToken: 'run', serverTime: now, revision: 1, wave: 1, endsAt: now + 60000, score: 0, hearts: 3, misses: 0, targets: [offer], ended: false, paused: false };
    window.delayedReadyDelivered = false; window.delayedReadyFinishes = 0; window.readyRequests = 0;
    patrol.configureNightShift({ ...window.patrolNoopDeps(),
      emitServer(event, payload, callback) {
        if (event === 'start-patrol-run') callback(base);
        if (event === 'finish-patrol-run') { window.delayedReadyFinishes++; callback({ success: true, score: 0, best: 0 }); }
        if (event === 'ready-patrol-target' && ++window.readyRequests === 1) {
          const t = Date.now();
          setTimeout(() => { callback({ ...base, revision: 2, serverTime: t, targets: [{ ...offer, deliveryPending: false, spawnedAt: t - 1174, actionableAt: t, expiresAt: t + 6166 }] }); window.delayedReadyDelivered = true; }, 2100);
        }
      } });
    patrol.startNightShift();
  });
  await expect.poll(() => page.evaluate(() => window.delayedReadyDelivered), { timeout: 5000 }).toBe(true);
  expect(await page.evaluate(() => window.delayedReadyFinishes)).toBe(0);
  await expect(page.locator('#night-hearts')).toHaveAttribute('aria-label', '3 hearts remaining');
  await expect(page.locator('[data-target-id="slow-ready"]')).toHaveCount(1);
});

// Runs in the page: starts a run with one offer whose ready acknowledgement never
// arrives. The server replies to start and finish; ready attempts are only counted.
async function startUnackedOffer({ kind, duration }) {
  const { state } = await import('/clientState.js');
  const patrol = await import('/clientNightShift.js');
  state.account = { account: { id: 'test' } };
  const now = Date.now();
  const offer = { id: 'no-ack', kind, direction: 'right', lane: 32, duration, wave: 1, deliveryPending: true, offeredAt: now, readyBy: now + 10000, spawnedAt: null, actionableAt: null, expiresAt: null };
  const base = { success: true, runToken: 'run', serverTime: now, revision: 1, wave: 1, endsAt: now + 60000, score: 0, hearts: 3, misses: 0, targets: [offer], ended: false, paused: false };
  window.watchdogStart = null; window.watchdogFinish = null; window.watchdogAttempts = 0;
  const serverHandlers = {
    'start-patrol-run': ({ callback }) => callback(base),
    'ready-patrol-target': () => { window.watchdogAttempts++; window.watchdogStart = window.watchdogStart || performance.now(); },
    'finish-patrol-run': ({ callback }) => { window.watchdogFinish = performance.now(); callback({ success: true, score: 0, best: 0 }); },
  };
  patrol.configureNightShift({ ...window.patrolNoopDeps(),
    emitServer(event, payload, callback) { serverHandlers[event]?.({ payload, callback }); } });
  patrol.startNightShift();
}

test('missing ready acknowledgements time out near but before each target flight ends', async ({ page }) => {
  await enable(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  for (const [kind, duration] of [['airplane', 2800], ['helicopter', 7340]]) {
    await page.goto('/');
    await page.evaluate(startUnackedOffer, { kind, duration });
    await expect.poll(() => page.evaluate(() => window.watchdogFinish), { timeout: 10000 }).not.toBeNull();
    const timing = await page.evaluate(() => ({ elapsed: window.watchdogFinish - window.watchdogStart, attempts: window.watchdogAttempts }));
    expect(timing.attempts, kind).toBe(2);
    expect(timing.elapsed, kind).toBeGreaterThan(duration * .75);
    expect(timing.elapsed, kind).toBeLessThan(duration * .84);
    await expect(page.locator('#night-hearts')).toHaveAttribute('aria-label', '3 hearts remaining');
  }
});

test('pausing after readiness preserves the unconfirmed target flight budget', async ({ page }) => {
  await enable(page);
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.goto('/');
  await page.evaluate(async () => {
    const { state } = await import('/clientState.js');
    const patrol = await import('/clientNightShift.js');
    state.account = { account: { id: 'test' } };
    const now = Date.now();
    const offer = { id: 'ready-paused', kind: 'airplane', direction: 'right', lane: 32, duration: 2800, wave: 1, deliveryPending: true, offeredAt: now, readyBy: now + 10000, spawnedAt: null, actionableAt: null, expiresAt: null };
    const base = { success: true, runToken: 'run', serverTime: now, revision: 1, wave: 1, endsAt: now + 60000, score: 0, hearts: 3, misses: 0, targets: [offer], ended: false, paused: false };
    window.pausedReadyAt = null; window.pausedFinishAt = null; window.pauseLength = 0;
    patrol.configureNightShift({ ...window.patrolNoopDeps(),
      emitServer(event, payload, callback) {
        if (event === 'start-patrol-run') callback(base);
        if (event === 'ready-patrol-target' && !window.pausedReadyAt) window.pausedReadyAt = performance.now();
        if (event === 'pause-patrol-run') callback({ ...base, revision: 2, serverTime: Date.now(), paused: true });
        if (event === 'resume-patrol-run') callback({ ...base, revision: 3, serverTime: Date.now(), paused: false });
        if (event === 'finish-patrol-run') { window.pausedFinishAt = performance.now(); callback({ success: true, score: 0, best: 0 }); }
      } });
    patrol.startNightShift();
  });
  await expect.poll(() => page.evaluate(() => window.pausedReadyAt), { timeout: 2000 }).not.toBeNull();
  await page.waitForTimeout(100);
  await page.evaluate(() => { window.hiddenAt = performance.now(); Object.defineProperty(document, 'hidden', { configurable: true, value: true }); document.dispatchEvent(new Event('visibilitychange')); });
  await page.waitForTimeout(500);
  await page.evaluate(() => { window.pauseLength = performance.now() - window.hiddenAt; Object.defineProperty(document, 'hidden', { configurable: true, value: false }); document.dispatchEvent(new Event('visibilitychange')); });
  await expect.poll(() => page.evaluate(() => window.pausedFinishAt), { timeout: 4000 }).not.toBeNull();
  const activeTime = await page.evaluate(() => window.pausedFinishAt - window.pausedReadyAt - window.pauseLength);
  expect(activeTime).toBeGreaterThan(2800 * .75);
  expect(activeTime).toBeLessThan(2800 * .84);
});
