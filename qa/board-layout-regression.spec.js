import { test, expect } from '@playwright/test';

test('Metro captions and artwork stay inside their cells at 1440x900', async ({ page }) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('/');
  await page.evaluate(async () => {
    const board = await import('/clientBoardData.js');
    const render = await import('/clientBoardRender.js');
    board.setBoardVariant('metro-52');
    render.buildBoard(() => {});
    document.querySelector('#view-home').classList.add('is-hidden');
    document.querySelector('#view-game').classList.remove('is-hidden');
    await document.fonts.ready;
  });
  const escaped = await page.evaluate(() => [...document.querySelectorAll('.is-metro .tile:not(.is-corner)')].flatMap(tile => {
    const outer = tile.getBoundingClientRect();
    return [...tile.querySelectorAll('.tile-name, .tile-icon, .tile-price')].filter(child => {
      const r = child.getBoundingClientRect();
      return r.width && r.height && (r.left < outer.left - 1 || r.right > outer.right + 1 || r.top < outer.top - 1 || r.bottom > outer.bottom + 1);
    }).map(child => `${tile.dataset.tile}: ${child.className}`);
  }));
  expect(escaped).toEqual([]);
});

test('optional Patrol hint stays clear of the Home entry card at 1280x720', async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 720 });
  await page.goto('/');
  await page.evaluate(() => {
    document.querySelector('#home-patrol-score').hidden = false;
    document.querySelector('#home-night-shift-start').hidden = false;
  });
  const hint = await page.locator('#home-night-shift-start').boundingBox();
  const card = await page.locator('.home-entry-desk').boundingBox();
  expect(card.y - (hint.y + hint.height)).toBeGreaterThanOrEqual(12);
  expect(await page.evaluate(() => [document.documentElement.scrollWidth, document.documentElement.scrollHeight])).toEqual([1280, 720]);
});
