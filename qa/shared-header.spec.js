import { test, expect } from '@playwright/test';

test('shared page headers keep active navigation, settings and audio behavior', async ({ page }) => {
  await page.goto('/');
  await page.locator('#home-alias').fill('HEADERGUEST');
  const home = page.locator('#view-home > header');
  await expect(home.locator('[data-settings-toggle]')).toBeVisible();
  const navX = (await home.locator('[data-global-nav]').boundingBox()).x;

  for (const view of ['profile', 'rankings', 'social', 'rules']) {
    await home.locator(`[data-home-tab="${view}"], [data-top-surface="${view}"]`).click();
    const header = page.locator(`#view-${view} > header`);
    await expect(header).toBeVisible();
    await expect(header.locator('[data-global-nav] [aria-current="page"]')).toHaveCount(1);
    await expect(header.locator('[data-global-nav] [aria-current="page"]')).toContainText(view.toUpperCase());
    await expect(header.locator('[data-page-back]')).toBeVisible();
    await expect(header.locator('[data-global-you-name]')).toContainText('HEADERGUEST');
    expect(Math.abs((await header.locator('[data-global-nav]').boundingBox()).x-navX)).toBeLessThanOrEqual(1);
    await expect(header.locator('.hdr-right > .online, .hdr-right > [data-about-link]')).toHaveCount(0);
    await header.locator('[data-settings-toggle]').click();
    await expect(header.locator('[data-settings-menu]')).toBeVisible();
    await expect(header.locator('[data-settings-menu] [data-global-connection-label]')).toHaveText('ONLINE');
    await expect(header.locator('[data-about-link]')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(header.locator('[data-settings-menu]')).toBeHidden();
    await expect(header.locator('[data-settings-toggle]')).toBeFocused();
    const canonical = page.locator('#sound-toggle-btn');
    const before = await canonical.getAttribute('aria-pressed');
    await header.locator(`#${view}-sound-toggle-btn`).click();
    await expect(canonical).not.toHaveAttribute('aria-pressed', before);
    await header.locator('[data-page-back]').click();
    await expect(home).toBeVisible();
  }
});

test('About stays in Settings and restores the originating menu trigger on return', async ({ page }) => {
  await page.goto('/');
  await page.locator('#home-profile-tab').click();
  const profile = page.locator('#view-profile > header');
  await profile.locator('[data-settings-toggle]').click();
  await profile.locator('[data-shortcut-toggle]').click();
  await expect(page.locator('#home-shortcut-toggle-btn .t-label')).toHaveText('KEYS: OFF');
  await profile.locator('[data-about-link]').click();
  const about = page.locator('#view-about > header');
  await expect(about).toBeVisible();
  await expect(about.locator('[data-global-nav] [aria-current="page"]')).toHaveCount(0);
  await expect(profile.locator('[data-settings-menu]')).toBeHidden();
  await about.locator('[data-settings-toggle]').click();
  await expect(about.locator('[data-about-link]')).toHaveAttribute('aria-current', 'page');
  await expect(about.locator('[data-shortcut-toggle] .t-label')).toHaveText('KEYS: OFF');
  await page.keyboard.press('Escape');
  await about.locator('[data-page-back]').click();
  await expect(profile).toBeVisible();
  await expect(profile.locator('[data-settings-toggle]')).toBeFocused();
  expect(await page.locator('[id]').evaluateAll(elements => {
    const ids = elements.map(element => element.id);
    return ids.length === new Set(ids).size;
  })).toBe(true);
});
