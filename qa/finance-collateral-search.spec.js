import { test, expect } from '@playwright/test';

async function openCollateralSurface(page, surface) {
  await page.goto('/');
  return page.evaluate(async (view) => {
    const { state } = await import('/clientState.js');
    const { TILES } = await import('/clientBoardData.js');
    const { configureTradeUi, openFinancingModal, openFinancingNegotiation } = await import('/clientTradeUi.js');
    const deeds = TILES.filter(tile => tile.kind === 'property').slice(0, 4);
    state.phase = 'playing';
    state.roomCode = 'COLLAT';
    state.roomPlayerId = 'p1';
    state.players = [
      { id: 'p1', serverId: 'server-p1', name: 'HOST', cash: 1500 },
      { id: 'p2', serverId: 'server-p2', name: 'BORROWER', cash: 1500 }
    ];
    state.owners = Object.fromEntries(deeds.map((tile, index) => [tile.i, view === 'negotiation' && index === deeds.length - 1 ? 'p1' : 'p2']));
    state.mortgaged = {};
    state.playerContractOffer = view === 'negotiation' ? {
      id: 'qa-contract', kind: 'loan', counterDepth: 0, fromPlayerId: 'server-p1', toPlayerId: 'server-p2',
      amount: 100, premiumRate: 10, durationRounds: 3, collateralTileIndices: [deeds[0].i]
    } : null;
    configureTradeUi({ emitServer() {}, say() {}, renderChat() {}, renderRightRail() {}, record() {}, createRequestId: () => 'qa-request' });
    if (view === 'builder') openFinancingModal('loan');
    else openFinancingNegotiation('qa-contract');
    return {
      names: (view === 'negotiation' ? deeds.slice(0, -1) : deeds).map(tile => tile.name),
      excludedName: view === 'negotiation' ? deeds.at(-1).name : null
    };
  }, surface);
}

async function expectPickerOpen(page, names) {
  const modal = page.locator('#financing-modal');
  const trigger = modal.locator('[data-collateral-trigger]');
  const panel = modal.locator('[data-collateral-panel]');
  await expect(modal).toBeVisible();
  await expect(modal.locator('details.financing-collateral-accordion, .financing-collateral-picker > summary')).toHaveCount(0);
  await expect(trigger).toBeVisible();
  await expect(trigger).toHaveAttribute('readonly', '');
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await trigger.focus();
  await trigger.press('Enter');
  await expect(trigger).toHaveAttribute('aria-expanded', 'true');
  await expect(panel).toBeVisible();
  const options = panel.locator('[data-collateral-option]');
  const list = panel.locator('.financing-collateral-options');
  await expect(panel.locator('[data-collateral-sort]')).toHaveCount(0);
  await expect(panel.getByText('SORT BY')).toHaveCount(0);
  await expect(panel.locator('input[type="search"], [data-collateral-search]')).toHaveCount(0);
  await expect(trigger).toBeFocused();
  await expect(panel.getByText('Every selected deed is at risk on uncured default.')).toHaveCount(0);
  const visibleDeedRows = await options.evaluateAll(rows => {
    const list = rows[0].closest('.financing-collateral-options');
    const bounds = list.getBoundingClientRect();
    return rows.filter(row => {
      const rect = row.getBoundingClientRect();
      return !row.hidden && rect.top >= bounds.top && rect.bottom <= bounds.bottom;
    }).length;
  });
  expect(visibleDeedRows).toBeLessThanOrEqual(2);
  await expect.poll(() => list.evaluate(element => element.scrollHeight > element.clientHeight)).toBe(true);

  const deedName = names[0];
  await expect(options.filter({ hasText: deedName })).toBeVisible();
  await expect(options.filter({ hasNotText: deedName })).toHaveCount(names.length - 1);
  const checkbox = options.filter({ hasText: deedName }).locator('input[type="checkbox"]');
  if (await checkbox.isChecked()) {
    await checkbox.uncheck();
    await expect(trigger).toHaveAttribute('placeholder', 'SELECT DEEDS…');
  }
  await checkbox.check();
  await expect(trigger).toHaveAttribute('placeholder', /1 SELECTED/);
  await expect(options).toHaveCount(names.length);
  await expect(options.filter({ hasText: deedName }).locator('input[type="checkbox"]')).toBeChecked();

  await trigger.press('Escape');
  await expect(panel).toBeHidden();
  await expect(trigger).toHaveAttribute('aria-expanded', 'false');
  await expect(trigger).toBeFocused();
  await trigger.click();
  await expect(panel).toBeVisible();
  await modal.locator('#financing-card-title').click();
  await expect(panel).toBeHidden();

  const pageOverflow = await page.evaluate(() => document.documentElement.scrollHeight > document.documentElement.clientHeight);
  expect(pageOverflow).toBe(false);
  return { modal, trigger, panel, options };
}

test('builder collateral selector expands into a two-row scrollable, multi-select list', async ({ page }, testInfo) => {
  const fixture = await openCollateralSurface(page, 'builder');
  const picker = await expectPickerOpen(page, fixture.names);
  if (testInfo.project.name === 'desktop-1920') {
    await picker.trigger.click();
    await expect(picker.panel).toBeVisible();
    await picker.modal.screenshot({ path: testInfo.outputPath('finance-collateral-builder-1920.png') });
  }
});

test('negotiation collateral selector preserves existing selections', async ({ page }) => {
  const fixture = await openCollateralSurface(page, 'negotiation');
  await expectPickerOpen(page, fixture.names);
  const trigger = page.locator('#financing-modal [data-collateral-trigger]');
  await expect(trigger).toHaveAttribute('placeholder', /1 SELECTED/);
  await expect(page.locator('#financing-modal [data-collateral-option]').filter({ hasText: fixture.excludedName })).toHaveCount(0);
});
