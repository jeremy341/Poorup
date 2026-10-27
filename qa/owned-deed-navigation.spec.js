/* global window, document, process */
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { test, expect } from '@playwright/test';

async function prepareBoard(page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const [{ state }, data, board, popup, deeds] = await Promise.all([
      import('/clientState.js'), import('/clientBoardData.js'), import('/clientBoardRender.js'),
      import('/clientPopupUi.js'), import('/clientDeedDetailUi.js'),
    ]);
    data.setBoardVariant('standard-40');
    Object.assign(state, {
      phase: 'playing', roomCode: 'DEEDS', boardVariant: 'standard-40',
      players: [
        { id: 'p1', serverId: 'host', name: 'HOST', cash: 1500, pos: 0, color: '#d74438', textColor: '#d74438' },
        { id: 'p2', serverId: 'guest', name: 'GUEST', cash: 1500, pos: 0, color: '#286ea1', textColor: '#286ea1' },
      ],
      owners: { 1: 'p1', 3: 'p2', 5: 'p1', 12: 'p1' },
      houses: {}, mortgaged: {}, serverTiles: [], highlight: null,
      selectedTile: null, pendingDebt: null,
    });
    document.querySelector('#view-home').classList.add('is-hidden');
    document.querySelector('#view-game').classList.remove('is-hidden');
    board.buildBoard(popup.onTileClick);
    board.renderBoardState();
    window.__deedRequests = [];
    deeds.configureDeedDetail({
      emitServer(event, payload) { window.__deedRequests.push({ event, payload }); },
      renderAll() {},
    });
    window.__ownedDeedNavigation = { state, board };
  });
}

test('owned board deeds open management directly and return focus without an intermediate inspector', async ({ page }, testInfo) => {
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await prepareBoard(page);
  await page.evaluate(async () => (await import('/clientLogDrawer.js')).toggleLogDrawerFromButton());
  for (const [index, activation] of [[1, 'click'], [5, 'Enter'], [12, 'Space']]) {
    const tile = page.locator(`#board-grid .tile[data-tile="${index}"]`);
    if (activation === 'click') await tile.click();
    else { await tile.focus(); await page.keyboard.press(activation); }
    await expect(page.locator('#deed-modal')).toBeVisible();
    await expect(page.locator('#popup')).toBeHidden();
    await expect(page.locator('#dd-mortgage')).toBeVisible();
    await expect(page.locator('#dd-close')).toBeFocused();
    await expect(page.locator('#log-drawer')).toHaveClass(/is-open/);
    if (index === 1) {
      await expect(page.locator('#dd-buy')).toBeVisible();
      await expect(page.locator('#dd-trade-deed')).toBeVisible();
      await expect(page.locator('#dd-bank-sale')).toHaveCount(0);
      const output = process.env.POORUP_OWNED_DEED_CAPTURE_DIR;
      if (output) {
        await mkdir(output, { recursive: true });
        await page.locator('#deed-card-detail').screenshot({ path: path.join(output, `${testInfo.project.name}.png`), animations: 'disabled' });
      }
    }
    expect(await page.evaluate(() => window.__deedRequests)).toEqual([]);
    if (activation === 'Space') await page.keyboard.press('Escape');
    else await page.locator('#dd-close').click();
    await expect(page.locator('#deed-modal')).toBeHidden();
    await expect(tile).toBeFocused();
    await expect(page.locator('#log-drawer')).toHaveClass(/is-open/);
    expect(await page.evaluate(() => window.__ownedDeedNavigation.state.highlight)).toBeNull();
  }

  for (const index of [3, 6]) {
    await page.locator(`#board-grid .tile[data-tile="${index}"]`).click();
    await expect(page.locator('#popup')).toBeVisible();
    await expect(page.locator('#deed-modal')).toBeHidden();
    await expect(page.locator('#pop-manage')).toHaveCount(0);
    await page.locator('#pop-close').click();
  }

  await page.evaluate(() => { window.__ownedDeedNavigation.state.owners[3] = 'p1'; });
  await page.locator('#board-grid .tile[data-tile="3"]').click();
  await expect(page.locator('#deed-modal')).toBeVisible();
  await expect(page.locator('#popup')).toBeHidden();
  await page.locator('#dd-close').click();

  await page.evaluate(() => { window.__ownedDeedNavigation.state.mortgaged[12] = true; });
  await page.locator('#board-grid .tile[data-tile="12"]').click();
  await expect(page.locator('#dd-mortgage')).toContainText('UNMORTGAGE');
  await page.locator('#dd-mortgage').click();
  expect(await page.evaluate(() => window.__deedRequests)).toEqual([
    { event: 'manage-property', payload: { tileIndex: 12, action: 'unmortgage' } },
  ]);
  await page.locator('#dd-close').click();
  await page.locator('#board-grid .tile[data-tile="0"]').focus();
  await page.keyboard.press('Enter');
  await expect(page.locator('#deed-modal')).toBeHidden();
  await expect(page.locator('#popup')).toBeHidden();
  expect(pageErrors).toEqual([]);
});
