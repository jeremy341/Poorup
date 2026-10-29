import { test, expect } from '@playwright/test';

test('room directory announces completed searches and filters without repeating unchanged updates', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const rooms = await import('/clientRoomsUi.js');
    rooms.configureRoomsUi({ emitServer: (_event, _payload, cb) => queueMicrotask(() => cb({ success: true, rooms: [
      { roomId: 'one', name: 'Alpha', seats: 1, cap: 4, state: 'live', visibility: 'public' },
      { roomId: 'two', name: 'Beta', seats: 4, cap: 4, state: 'full', visibility: 'public' },
    ] })) });
    rooms.openRoomsModal('browse');
  });
  const status = page.locator('#rooms-results-status');
  await expect(status).toHaveAttribute('role', 'status');
  await expect(status).toHaveText('2 public tables shown.');
  await page.locator('#rooms-search').fill('Alpha');
  await expect(status).toHaveText('1 public table shown.');
  await page.locator('#rooms-search').fill('Missing');
  await expect(status).toHaveText('No public tables match.');
  await page.locator('#rooms-search').fill('');
  await page.locator('.rooms-filter[data-filter=open]').click();
  await expect(status).toHaveText('1 public table shown.');
  await status.evaluate(element => {
    window.statusMutations = 0;
    new MutationObserver(() => { window.statusMutations += 1; }).observe(element, { childList: true, characterData: true, subtree: true });
  });
  await page.evaluate(async () => { const rooms = await import('/clientRoomsUi.js'); rooms.applyRoomsUpdated({ rooms: rooms.lobbyState.roomsDirectory }); });
  await page.waitForTimeout(500);
  await expect(status).toHaveText('1 public table shown.');
  expect(await page.evaluate(() => window.statusMutations)).toBe(0);
});
