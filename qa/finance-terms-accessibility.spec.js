import { test, expect } from '@playwright/test';
test('finance tabs retain keyboard focus and loan terms match the offer', async ({ page }, info) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { state } = await import('/clientState.js');
    const { configureTradeUi, openFinancingModal } = await import('/clientTradeUi.js');
    state.phase = 'playing'; state.settings.playerFinance = true;
    state.players = [{ id: 'p1', serverId: 'p1', name: 'LENDER', cash: 1500 }, { id: 'p2', serverId: 'p2', name: 'BORROWER', cash: 1500 }];
    state.owners = { 1: 'p2' }; state.mortgaged = {}; state.serverTiles = [];
    window.financeOffers = [];
    configureTradeUi({ emitServer: (event, payload) => window.financeOffers.push({ event, payload }), createRequestId: () => 'qa' });
    openFinancingModal('loan');
  });
  const loan = page.locator('#financing-tab-loan');
  const equity = page.locator('#financing-tab-equity');
  await loan.focus(); await loan.press('ArrowRight');
  await expect(equity).toBeFocused(); await expect(equity).toHaveAttribute('aria-selected', 'true');
  await expect(loan).toHaveAttribute('tabindex', '-1');
  await expect(page.locator('#financing-mode-panel')).toHaveAttribute('aria-labelledby', 'financing-tab-equity');
  await equity.press('Home'); await expect(loan).toBeFocused();
  const duration = page.locator('#finance-loan-duration');
  const rate = page.locator('#finance-loan-rate');
  for (const [field, value] of [[duration, '5'], [rate, '15']]) {
    await field.focus(); await field.press('Control+A'); await field.press('Backspace');
    await expect(field).toHaveValue('');
    await expect(field).toHaveAttribute('aria-invalid', 'true');
    await expect(page.locator('#financing-send')).toBeDisabled();
    await field.pressSequentially(value);
    await expect(field).toHaveValue(value);
    await expect(field).toHaveAttribute('aria-invalid', 'false');
  }
  await duration.fill('21');
  await expect(page.locator('#financing-send')).toBeDisabled();
  await duration.fill('5');
  await expect(page.locator('#financing-preview')).toContainText('5 ROUNDS');
  await expect(page.locator('#financing-preview')).toContainText('15%');
  await page.locator('#financing-send').click();
  expect(await page.evaluate(() => window.financeOffers.at(-1).payload)).toMatchObject({ durationRounds: 5, premiumRate: 15 });
  await loan.focus();
  if (process.env.FINANCE_SCREENSHOTS) await page.screenshot({ path: `${process.env.FINANCE_SCREENSHOTS}/after-${info.project.name}.png` });
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= document.documentElement.clientHeight)).toBe(true);
});
