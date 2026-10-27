import { test, expect } from '@playwright/test';
import { createServer } from 'node:http';
import { Server } from 'socket.io';
import { createSocialApi } from '../server/socketSocialApi.js';
import { registerSocialSocketHandlers } from '../server/serverSocketSocial.js';

test('browser delivers, tags and settles a target over a real socket', async ({ page }) => {
  const http = createServer();
  const io = new Server(http, { cors: { origin: '*' } });
  const saved = [];
  const account = { id: 'wire-account' };
  const accountStore = {
    recordPatrolResult(id, result) { saved.push({ id, ...result }); return { success: true, ...result, best: result.score, aceRuns: 0 }; },
    getAccountSnapshot() { return null; },
  };
  const social = createSocialApi({ io, accountStore, socialStore: {}, matchStore: {}, achievementStore: {} });
  social.accountForSocket = () => account;
  social.recordVerifiedAchievement = () => true;
  io.on('connection', socket => registerSocialSocketHandlers((event, handler) => socket.on(event, handler), socket, { io, accountStore, socialStore: {}, matchStore: {}, social }));
  await new Promise(resolve => http.listen(0, '127.0.0.1', resolve));
  try {
    await page.goto('/');
    await page.addScriptTag({ url: '/socket.io/socket.io.js' });
    const port = http.address().port;
    await page.evaluate(async port => {
      const socket = window.io(`http://127.0.0.1:${port}`, { transports: ['websocket'], reconnection: false });
      await new Promise((resolve, reject) => { socket.once('connect', resolve); socket.once('connect_error', reject); });
      const { state } = await import('/clientState.js');
      const patrol = await import('/clientNightShift.js');
      state.account = { account: { id: 'wire-account' } };
      const noop = () => {};
      window.wireEvents = [];
      socket.on('patrol-state', patrol.applyPatrolState);
      patrol.configureNightShift({ stopHomeHelicopter: noop, stopHomeClock: noop, renderPatrolHud: noop, startHomeClock: noop, scheduleHomeHelicopter: noop, parlorNotice: noop, unlockAchievement: noop, playPatrolHitSound: noop,
        emitServer(event, payload, callback) { window.wireEvents.push(event); socket.emit(event, payload, callback); } });
      window.wirePatrol = patrol;
      patrol.startNightShift();
    }, port);
    const target = page.locator('.night-target').first();
    await expect(target).toHaveCount(1, { timeout: 5000 });
    await expect(target).toHaveCSS('pointer-events', 'auto', { timeout: 5000 });
    await target.dispatchEvent('pointerdown');
    await expect(page.locator('#home-patrol-score')).toHaveText('125');
    await page.evaluate(() => window.wirePatrol.stopNightShift());
    await expect.poll(() => saved.length, { timeout: 4000 }).toBe(1);
    expect(saved[0].score).toBe(125);
    const events = await page.evaluate(() => window.wireEvents);
    expect(events.indexOf('ready-patrol-target')).toBeLessThan(events.indexOf('hit-patrol-target'));
    expect(events).toContain('finish-patrol-run');
  } finally {
    await new Promise(resolve => io.close(resolve));
    if (http.listening) await new Promise(resolve => http.close(resolve));
  }
});
