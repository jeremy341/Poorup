import { test, expect } from '@playwright/test';

test('option writer survives a market desk economy refresh', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    document.body.innerHTML = '<div id="market-modal" role="dialog"><div id="market-card"></div></div>';

    const [{ state }, marketUi] = await Promise.all([
      import('/clientState.js'),
      import('/clientMarketUi.js'),
    ]);
    state.economy = {
      ...state.economy,
      market: {
        enabled: true,
        round: 1,
        complexity: 'derivatives',
        feeRate: 0.02,
        quotes: { brazil: 104 },
        positions: {},
        shorts: { positions: {} },
        options: [],
      },
    };

    window.__marketActions = [];
    marketUi.configureMarketUi({
      emitServer(eventName, payload, acknowledge) {
        window.__marketActions.push({ eventName, payload });
        acknowledge({ success: false, error: 'Test acknowledgement' });
      },
      createRequestId: () => 'market-option-test',
      renderRightRail: () => {},
      say: () => {},
      renderChat: () => {},
    });
    marketUi.renderMarketDeskIfOpen();
    window.__refreshMarketDesk = () => {
      state.economy = {
        ...state.economy,
        market: { ...state.economy.market, round: 2 },
      };
      marketUi.renderMarketDeskIfOpen();
    };
  });

  const role = page.locator('#market-desk-role');
  await role.selectOption('writer');
  await page.evaluate(() => window.__refreshMarketDesk());

  await expect(role.locator('option')).toHaveCount(2);
  expect(await role.locator('option').evaluateAll(options => options.map(option => option.value))).toEqual(['writer', 'buyer']);
  await expect(role).toHaveValue('writer');

  await page.locator('[data-market-advanced="open-option"][data-market-id="brazil"]').click();
  await expect.poll(() => page.evaluate(() => window.__marketActions.at(-1))).toMatchObject({
    eventName: 'open-option',
    payload: {
      instrumentId: 'brazil',
      role: 'writer',
      requestId: 'market-option-test',
    },
  });
});
