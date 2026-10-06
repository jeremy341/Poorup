import { test, expect } from '@playwright/test';

test('Home exposes a native Night Shift button that starts the mode', async ({ page }) => {
  await page.goto('/');

  const startButton = page.getByRole('button', { name: /night shift/i });
  await expect(startButton).toBeVisible();
  const coarsePointer = await page.evaluate(() => matchMedia('(pointer: coarse)').matches);
  if (coarsePointer) await startButton.tap();
  else await startButton.click();

  await expect(page.locator('#night-shift')).toBeVisible();
  await expect(page.locator('body')).toHaveClass(/night-shift-open/);

  if (coarsePointer) await page.locator('#night-exit').tap();
  else await page.locator('#night-exit').click();
  await startButton.focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#night-shift')).toBeVisible();

  if (coarsePointer) await page.locator('#night-exit').tap();
  else await page.locator('#night-exit').click();
  await startButton.evaluate(element => element.blur());
  await page.keyboard.press('Shift+P');
  await expect(page.locator('#night-shift')).toBeVisible();
});
