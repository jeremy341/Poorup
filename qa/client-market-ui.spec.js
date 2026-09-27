import { test, expect } from '@playwright/test';

test('derivatives remain unavailable without server pricing policy across market refreshes', async ({ page }) => {
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

  const index = page.locator('#market-desk-index');
  await index.selectOption('canada');
  await page.evaluate(() => window.__refreshMarketDesk());

  await expect(index).toHaveValue('canada');
  await expect(page.locator('.market-derivatives-unavailable').first()).toContainText('SERVER PRICING POLICY NOT CONFIGURED');
  await expect(page.locator('#market-desk-role')).toHaveCount(0);
  await expect(page.locator('[data-market-advanced="open-option"]')).toHaveCount(0);
  expect(await page.evaluate(() => window.__marketActions)).toEqual([]);
});
