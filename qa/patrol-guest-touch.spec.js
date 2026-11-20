import { test, expect } from '@playwright/test';

test('guest can start Patrol, hit a target and leave the mode', async ({ page }) => {
  await page.goto('/');
  await expect(page.locator('#home-night-shift-start')).toBeVisible();
  await page.locator('#home-night-shift-start').click();
  await expect(page.locator('#night-shift')).toBeVisible();
  const target = page.locator('.night-target').first();
  await expect(target).toBeVisible();
  await target.click();
  await expect(page.locator('#home-patrol-score')).not.toHaveText('000');
  await page.keyboard.press('Escape');
  await expect(page.locator('#night-shift')).toBeHidden();
  await expect(page.locator('body')).not.toHaveClass(/night-shift-open/);
});
