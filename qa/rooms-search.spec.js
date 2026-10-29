import { test, expect } from '@playwright/test';

// The room browser can be searched by table name, ignoring case.
test('the rooms list narrows as you search by table name', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440x900', 'One project proves the filter.');
  const tag = Math.random().toString(36).slice(2, 6).toUpperCase();
  const alpha = `ALPHA ${tag}`;
  const beta = `BETA ${tag}`;
  const makeRoom = async (name, alias) => {
    const page = await (await browser.newContext()).newPage();
    await page.goto('/');
    await page.locator('#home-alias').fill(alias);
    await page.locator('#open-create-btn').click();
    await page.locator('#rc-name').fill(name);
    await page.locator('#rc-create-btn').click();
    await page.locator('#su-start').click();
  };
  await makeRoom(alpha, 'HOSTONE');
  await makeRoom(beta, 'HOSTTWO');

  const viewer = await (await browser.newContext()).newPage();
  await viewer.goto('/');
  await viewer.locator('#open-join-btn').click();
  await viewer.locator('#rm-tab-browse').click();
  const names = () => viewer.locator('#rooms-list .room-name').allInnerTexts();
  await expect.poll(async () => (await names()).filter(name => name.includes(tag)).length).toBe(2);

  await viewer.locator('#rooms-search').fill(`alpha ${tag.toLowerCase()}`);
  await expect.poll(async () => (await names()).filter(name => name.includes(tag))).toEqual([alpha]);

  await viewer.locator('#rooms-search').fill('no-such-table-name');
  await expect(viewer.locator('#rooms-list')).toContainText('NO TABLES MATCH');

  await viewer.locator('#rooms-search').fill('');
  await expect.poll(async () => (await names()).filter(name => name.includes(tag)).length).toBe(2);
});
