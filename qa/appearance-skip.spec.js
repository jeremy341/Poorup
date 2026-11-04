import { test, expect } from '@playwright/test';

// Joining a table skips the appearance step once a design is saved. The first confirm saves
// the look; later tables go straight to the lobby.
async function createTable(page, name) {
  await page.goto('/');
  if (await page.locator('#home-alias').isVisible()) {
    await page.locator('#home-alias').fill('Cora');
    await page.locator('#home-alias-form').evaluate(form => form.requestSubmit());
  }
  await page.click('#open-create-btn');
  await page.fill('#rc-name', name);
  await page.click('#rc-create-btn');
}

test('a saved design skips the appearance step on later tables', async ({ page, browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440x900', 'one desktop pass covers the table entry flow');
  await page.goto('/');
  await page.evaluate(() => { try { localStorage.clear(); } catch { /* storage unavailable */ } });
  await createTable(page, 'First table');
  const overlay = page.locator('#setup-wrap');
  await expect(overlay).toBeVisible();
  await expect(overlay.getByText('Choose Your Player Appearance')).toBeVisible();
  await page.locator('#su-start').click();
  await expect(overlay).toBeHidden();
  await expect.poll(() => page.evaluate(() => localStorage.getItem('poorup.active-design.v1'))).not.toBeNull();

  // A new session with the same saved design: a fresh identity, so the second table is a new seat.
  const storageState = await page.context().storageState();
  const second = await browser.newContext({ storageState, viewport: { width: 1440, height: 900 } });
  const seat = await second.newPage();
  await createTable(seat, 'Second table');
  await expect(seat.locator('#lobby-start-btn')).toBeVisible();
  await expect(seat.locator('#setup-wrap')).toBeHidden();
  await second.close();
});
