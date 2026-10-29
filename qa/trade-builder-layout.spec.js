/* global window, document, getComputedStyle, process */
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

async function openTrade(page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const [{ state }, board, trade] = await Promise.all([
      import('/clientState.js'), import('/clientBoardData.js'), import('/clientTradeUi.js'),
    ]);
    board.setBoardVariant('standard-40');
    Object.assign(state, {
      phase: 'playing', roomCode: 'LAYOUT', boardVariant: 'standard-40',
      players: [
        { id: 'p1', serverId: 'host', name: 'HOST', cash: 1450, color: '#d74438', textColor: '#d74438' },
        { id: 'p2', serverId: 'guest', name: 'GUEST', cash: 1500, color: '#286ea1', textColor: '#286ea1' },
      ],
      owners: { 1: 'p1', 3: 'p1', 5: 'p1', 6: 'p1', 8: 'p1', 9: 'p1', 11: 'p1', 12: 'p1', 15: 'p2', 16: 'p2' },
      mortgaged: {}, houses: {}, pendingDebt: null,
    });
    state.settings.trading = true;
    document.querySelector('#view-home').classList.add('is-hidden');
    document.querySelector('#view-game').classList.remove('is-hidden');
    trade.openTradeModal('p2');
    window.__tradeLayout = { state, trade };
  });
  await page.evaluate(() => document.fonts.ready);
}

async function cashGeometry(page) {
  return page.locator('#trade-card .trade-cash-field .field').evaluateAll(inputs => inputs.map(input => {
    const { top, height } = input.getBoundingClientRect();
    return { top, height };
  }));
}

async function expectAlignedCash(page) {
  const [give, receive] = await cashGeometry(page);
  expect(Math.abs(give.top - receive.top), 'cash input tops align').toBeLessThanOrEqual(1);
  expect(give.height, 'cash input heights match').toBe(receive.height);
}

test('trade builder reserves equal deed slots and scrolls full rows without moving cash fields', async ({ page }, testInfo) => {
  await openTrade(page);
  const output = process.env.POORUP_TRADE_LAYOUT_CAPTURE_DIR;
  if (output) {
    await mkdir(output, { recursive: true });
    await page.locator('#trade-card').screenshot({ path: path.join(output, `${testInfo.project.name}.png`), animations: 'disabled' });
  }
  await expectAlignedCash(page);
  const viewport = page.viewportSize();
  const expectedRows = viewport.width >= 1920 && viewport.height >= 1200 ? 5 : 3;
  const lists = page.locator('#trade-card .trade-deed-list');
  const metrics = await lists.evaluateAll(elements => elements.map(list => {
    const box = list.getBoundingClientRect();
    return {
      height: box.height, top: box.top, bottom: box.bottom,
      scrollHeight: list.scrollHeight, clientHeight: list.clientHeight,
      overflow: getComputedStyle(list).overflowY,
      rows: [...list.querySelectorAll('.trade-deed')].map(row => {
        const rect = row.getBoundingClientRect();
        return { top: rect.top, bottom: rect.bottom, height: rect.height };
      }),
    };
  }));
  expect(metrics[0].height, 'both players reserve the same deed area').toBe(metrics[1].height);
  expect(metrics[0].overflow).toBe('auto');
  expect(metrics[0].scrollHeight).toBeGreaterThan(metrics[0].clientHeight);
  expect(metrics[0].rows.filter(row => row.top >= metrics[0].top - 1 && row.bottom <= metrics[0].bottom + 1)).toHaveLength(expectedRows);
  expect(metrics[0].rows[expectedRows].top, 'next deed stays below the visible area').toBeGreaterThanOrEqual(metrics[0].bottom);
  for (const row of metrics[0].rows) expect(row.height, 'deeds retain a usable target size').toBeGreaterThanOrEqual(44);
  await expect(lists.nth(0)).toHaveAttribute('tabindex', '0');
  await expect(lists.nth(0)).toHaveAttribute('aria-label', 'Deeds to offer');
  await expect(lists.nth(1)).toHaveAttribute('aria-label', 'Deeds to request');

  const beforeScroll = await cashGeometry(page);
  await lists.nth(0).focus();
  await page.keyboard.press('End');
  await expect.poll(() => lists.nth(0).evaluate(list => list.scrollTop)).toBeGreaterThan(0);
  const lastDeed = lists.nth(0).locator('.trade-deed').last();
  await lastDeed.focus();
  await page.keyboard.press('Space');
  await expect(lastDeed).toHaveClass(/is-selected/);
  expect(await cashGeometry(page), 'scrolling and selecting a deed does not shift the cash controls').toEqual(beforeScroll);

  await page.evaluate(() => {
    const { state, trade } = window.__tradeLayout;
    state.owners = Object.fromEntries(Object.entries(state.owners).filter(([, owner]) => owner === 'p1'));
    trade.renderTradeModal();
  });
  await expect(lists.nth(1)).toContainText('NO DEEDS TO REQUEST');
  await expectAlignedCash(page);
  const emptyHeights = await lists.evaluateAll(elements => elements.map(element => element.getBoundingClientRect().height));
  expect(emptyHeights[0]).toBe(emptyHeights[1]);
  expect(await page.evaluate(() => document.documentElement.scrollHeight <= window.innerHeight + 1)).toBe(true);
  await page.locator('#trade-close').click();
  await expect(page.locator('#trade-modal')).toHaveClass(/is-hidden/);
});
