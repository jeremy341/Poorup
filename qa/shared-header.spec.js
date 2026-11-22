import { test, expect } from '@playwright/test';

test('shared page headers keep active navigation, shortcut and audio behavior', async ({ page }) => {
  await page.goto('/');
  await page.locator('#home-alias').fill('HEADERGUEST');
  const home = page.locator('#view-home > header');
  await expect(home.locator('[data-settings-toggle], [data-settings-menu]')).toHaveCount(0);
  await expect(home.locator('[data-shortcut-toggle]')).toBeVisible();
  await expect(home.locator('[data-global-nav] [data-about-link]')).toHaveCount(0);
  const navX = (await home.locator('[data-global-nav]').boundingBox()).x;

  for (const view of ['profile', 'rankings', 'social', 'rules']) {
    await home.locator(`[data-home-tab="${view}"], [data-top-surface="${view}"]`).click();
    const header = page.locator(`#view-${view} > header`);
    await expect(header).toBeVisible();
    await expect(header.locator('[data-global-nav] [aria-current="page"]')).toHaveCount(1);
    await expect(header.locator('[data-global-nav] [aria-current="page"]')).toContainText(view.toUpperCase());
    await expect(header.locator('[data-page-back]')).toBeVisible();
    await expect(header.locator('[data-global-you-name]')).toContainText('HEADERGUEST');
    await expect(header.locator('[data-settings-toggle], [data-settings-menu]')).toHaveCount(0);
    await expect(header.locator('[data-shortcut-toggle]')).toBeVisible();
    await expect(header.locator('[data-global-nav] [data-about-link]')).toHaveCount(0);
    expect(Math.abs((await header.locator('[data-global-nav]').boundingBox()).x - navX)).toBeLessThanOrEqual(1);
    const canonical = page.locator('#sound-toggle-btn');
    const before = await canonical.getAttribute('aria-pressed');
    await header.locator(`#${view}-sound-toggle-btn`).click();
    await expect(canonical).not.toHaveAttribute('aria-pressed', before);
    await header.locator('[data-page-back]').click();
    await expect(home).toBeVisible();
  }
});

test('shortcuts can be switched off and About stays in the footer', async ({ page }) => {
  await page.goto('/');
  await page.locator('#home-profile-tab').click();
  const profile = page.locator('#view-profile > header');
  await profile.locator('[data-shortcut-toggle]').click();
  await expect(page.locator('#home-shortcut-toggle-btn .t-label')).toHaveText('KEYS: OFF');
  await expect(profile.locator('[data-shortcut-toggle]')).toHaveAttribute('aria-pressed', 'false');
  await profile.locator('[data-home-tab="play"]').click();
  await expect(page.locator('#view-home')).toBeVisible();
  await page.locator('#view-home .ticker a[href="/about"]').click();
  await expect(page).toHaveURL(/\/about$/);

  const about = page.locator('#view-about > header');
  await expect(about).toBeVisible();
  await expect(about.locator('[data-global-nav] [data-about-link]')).toHaveCount(0);
  await expect(about.locator('[data-shortcut-toggle] .t-label')).toHaveText('KEYS: OFF');
  await about.locator('[data-page-back]').click();
  await expect(page.locator('#view-home')).toBeVisible();
  await expect(page.locator('#home-shortcut-toggle-btn .t-label')).toHaveText('KEYS: OFF');
  expect(await page.locator('[id]').evaluateAll(elements => {
    const ids = elements.map(element => element.id);
    return ids.length === new Set(ids).size;
  })).toBe(true);
});
