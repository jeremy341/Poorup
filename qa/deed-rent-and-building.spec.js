import { test, expect } from '@playwright/test';
import { createRoom, finishedSnapshot, openDeedDetail, installFinishedRoom, expectNoPageScroll, grantDeeds, captureDeedSurface } from './support/deed-harness.mjs';

test('every owned deed manager shows its complete rent schedule without expanding details', async ({ page }, testInfo) => {
  const room = createRoom('rent-ladder');
  const game = room.game;
  const owner = game.players[0];
  grantDeeds(game, owner, [1, 3, 5, 12, 28]);
  await installFinishedRoom(page, room, owner);
  for (const [index, name, rows] of [[1, 'property', 6], [5, 'airport', 4], [12, 'electric', 2], [28, 'water', 2]]) {
    await openDeedDetail(page, index);
    const ladder = page.locator('#deed-card-detail .dd-ladder');
    await expect(ladder).toBeVisible();
    await expect(ladder.locator('.dd-row')).toHaveCount(rows);
    expect(await ladder.evaluate(element => element.closest('details') === null)).toBe(true);
    await expect(page.locator('.dd-extra-details')).toHaveCount(0);
    await expect(page.locator('#deed-card-detail')).not.toContainText(/HOUSE COST|YOUR CASH|BUILDINGS|Returns half the building cost/);
    await expect(page.locator('.dd-stock-details, .supply-strip')).toHaveCount(0);
    await expect(page.locator('#deed-card-detail')).not.toContainText('Bank stock');
    if (name === 'property') await expect(ladder).toContainText('HOTEL');
    await captureDeedSurface(page, testInfo, `deed-rent-${name}`, `Visible ${name} rent schedule`, `deed-rent-${name}.detail.png`);
    await page.locator('#dd-trade-deed').focus();
    await expect(page.locator('#dd-trade-deed')).toBeInViewport();
    await page.locator('#dd-close').click();
    await expectNoPageScroll(page);
  }
});

test('building stays available beyond the old shared supply totals even with legacy zero limits', async ({ page }, testInfo) => {
  const room = createRoom('uncapped-ui', 2, { evenBuild: false });
  const game = room.game;
  const owner = game.players[0];
  for (const tile of game.tiles.filter(entry => entry.type === 'property')) {
    tile.ownerId = owner.id; tile.purchasePricePaid = tile.price; tile.houseCount = 4;
    owner.properties.push(tile.index);
  }
  const target = game.getTile(1);
  target.houseCount = 0;
  game.settings.houseLimit = 0;
  game.settings.hotelLimit = 0;
  owner.cash = 50000;
  expect(game.tiles.reduce((sum, tile) => sum + (tile.houseCount || 0), 0)).toBeGreaterThan(32);
  await page.exposeFunction('__deedTruthAction', (event, payload) => {
    expect(event).toBe('manage-property');
    return { response: game.manageProperty('uncapped-ui-host', payload), snapshot: finishedSnapshot(room, owner) };
  });
  await installFinishedRoom(page, room, owner, true);
  await openDeedDetail(page, 1);
  await expect(page.locator('#dd-buy')).toBeEnabled();
  await expect(page.locator('.dd-stock-details')).toHaveCount(0);
  const cost = game.getPropertyHouseCost(target);
  const cashBefore = owner.cash;
  await page.locator('#dd-buy').click();
  await expect.poll(() => target.houseCount).toBe(1);
  expect(owner.cash).toBe(cashBefore - cost);
  const settings = await page.evaluate(() => window.__deedTruthHarness.state.settings);
  expect(Object.hasOwn(settings, 'houseLimit')).toBe(false);
  expect(Object.hasOwn(settings, 'hotelLimit')).toBe(false);
  await captureDeedSurface(page, testInfo, 'unlimited-building', 'Building with no shared inventory cap', 'unlimited-building.detail.png');
});
