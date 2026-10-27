import { test, expect } from '@playwright/test';

// Audit F-059: Parlor Patrol / Night Shift is switched off (PARLOR_PATROL_ENABLED
// is false). This spec used to start the mode; it now pins the disabled state so
// nothing is left clickable, focusable or announced on Home.
test('Home offers no Night Shift or Parlor Patrol controls while the mode is off', async ({ page }) => {
  await page.goto('/');

  await expect(page.getByRole('button', { name: /night shift/i })).toHaveCount(0);
  await expect(page.getByRole('button', { name: /police helicopter/i })).toHaveCount(0);
  await expect(page.locator('#home-night-shift-start')).toBeHidden();
  await expect(page.locator('#home-helicopter')).toBeHidden();
  await expect(page.locator('#night-shift')).toBeHidden();
  await expect(page.locator('#home-local-time')).toBeVisible();

  await page.keyboard.press('Shift+P');
  await expect(page.locator('#night-shift')).toBeHidden();
  await expect(page.locator('body')).not.toHaveClass(/night-shift-open/);

  // Ctrl+P is the browser's print shortcut again: the page must not claim it.
  const prevented = await page.evaluate(() => new Promise((resolve) => {
    const event = new KeyboardEvent('keydown', { key: 'p', code: 'KeyP', ctrlKey: true, bubbles: true, cancelable: true });
    window.dispatchEvent(event);
    resolve(event.defaultPrevented);
  }));
  expect(prevented).toBe(false);
});
