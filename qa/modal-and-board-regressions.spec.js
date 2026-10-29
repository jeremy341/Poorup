import { test, expect } from '@playwright/test';

async function showOffer(page) {
  await page.goto('/');
  await page.evaluate(async () => {
    const [{ state }, modals, socket] = await Promise.all([
      import('/clientState.js'), import('/clientGameModalsUi.js'), import('/clientSocketListeners.js'),
    ]);
    Object.assign(state, {
      phase: 'playing', roomCode: 'REVIEW',
      players: [
        { id: 'p1', serverId: 'recipient', name: 'YOU', cash: 700, color: '#d74438', textColor: '#d74438' },
        { id: 'p2', serverId: 'sender', name: 'NIGHT OWL', cash: 900, color: '#286ea1', textColor: '#286ea1' },
      ],
      owners: { 1: 'p2', 3: 'p1' }, mortgaged: {}, boardVariant: 'standard-40',
    });
    document.querySelector('#view-home').classList.add('is-hidden');
    document.querySelector('#view-game').classList.remove('is-hidden');
    const offer = { ...socket.normalizeTradeOffer({
      id: 'review-both-legs', fromPlayerId: 'sender', toPlayerId: 'recipient',
      giveCash: 300, requestCash: 100, givePropertyIndexes: [1], requestPropertyIndexes: [3],
    }), receivedAt: Date.now() };
    state.offers = [offer]; state.pendingTrade = offer;
    modals.configureGameModals({
      emitServer(event, payload, ack) {
        window.__offerRequest = { event, payload };
        ack({ success: false, error: 'The sender no longer owns this deed.' });
      },
      announceActionStatus(message) { window.__offerStatus = message; },
      openTradeNegotiation(value) { window.__negotiatedOffer = value; },
    });
    modals.openOfferModal(offer);
  });
}

test('trade review discloses both cash and deed legs before acceptance', async ({ page }, testInfo) => {
  await showOffer(page);
  const receive = page.getByRole('region', { name: 'You receive', exact: true });
  const give = page.getByRole('region', { name: 'You give', exact: true });
  await expect(receive).toContainText('$300');
  await expect(receive).toContainText(/salvador/i);
  await expect(give).toContainText('$100');
  await expect(give).toContainText(/rio/i);
  await expect(page.locator('#offer-close')).toBeFocused();
  await page.screenshot({ path: testInfo.outputPath('trade-review.png'), animations: 'disabled' });
  await page.locator('#offer-accept').click();
  await expect(page.locator('#offer-modal')).toBeVisible();
  await expect(receive).toContainText('$300');
  await expect(give).toContainText('$100');
  const outcome = await page.evaluate(() => ({ request: window.__offerRequest, message: window.__offerStatus }));
  expect(outcome.request).toMatchObject({ event: 'respond-trade', payload: { tradeId: 'review-both-legs', accept: true } });
  expect(outcome.message).toContain('no longer owns');
  await page.locator('#offer-counter').click();
  expect(await page.evaluate(() => window.__negotiatedOffer)).toMatchObject({ giveCash: 300, requestCash: 100, givePropertyIndexes: [1], requestPropertyIndexes: [3] });
});

test('emergency credit presents the complete bank terms and returns focus on cancel', async ({ page }, testInfo) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const [{ state }, bank, surfaces] = await Promise.all([
      import('/clientState.js'), import('/clientBankLoanUi.js'), import('/clientSurfaces.js'),
    ]);
    state.phase = 'playing';
    // Bank loans are an opt-in room setting, so the emergency offer only opens when it is on.
    state.settings = { ...state.settings, bankLoans: true };
    bank.configureBankLoanUi({
      getOffer: () => ({ available: true, principal: 300, premium: 45, totalDue: 345, dueRound: 4, cureRound: 5, collateralName: 'Salvador', severity: 'standard' }),
      openSurface: surfaces.openSurface, closeSurface: surfaces.closeSurface,
    });
    // Live room sync can reset the opt-in setting; re-apply it on every open.
    window.__reopenBankOffer = () => { state.settings = { ...state.settings, bankLoans: true }; return bank.openBankLoanOffer(document.querySelector('#open-create-btn')); };
    window.__reopenBankOffer();
  });
  const card = page.locator('#bank-loan-card');
  await expect(card.getByRole('heading', { name: 'Emergency bank loan' })).toBeVisible();
  for (const term of ['$300', '$345', '$45', '15%', '4', '5', 'Salvador']) await expect(card).toContainText(term);
  await expect(card.locator('[data-bank-offer-cancel]')).toBeFocused();
  await expect(card.getByRole('button', { name: 'Close emergency bank loan' })).toBeVisible();
  const geometry = await card.evaluate(element => {
    const rect = selector => element.querySelector(selector).getBoundingClientRect().toJSON();
    return { card: element.getBoundingClientRect().toJSON(), cancel: rect('[data-bank-offer-cancel]'), borrow: rect('[data-bank-offer-confirm]'), close: rect('[data-bank-loan-close]') };
  });
  expect(geometry.card.width).toBeLessThanOrEqual(420);
  expect(geometry.cancel.height).toBeGreaterThanOrEqual(52);
  expect(geometry.borrow.height).toBeGreaterThanOrEqual(52);
  expect(Math.abs(geometry.cancel.width - geometry.borrow.width)).toBeLessThan(1);
  expect(geometry.close.width).toBeGreaterThanOrEqual(44);
  expect(geometry.close.height).toBeGreaterThanOrEqual(44);
  await expect(card.locator('[data-bank-loan-close] svg')).toBeVisible();
  await page.screenshot({ path: testInfo.outputPath('emergency-bank-loan.png'), animations: 'disabled' });
  await card.screenshot({ path: testInfo.outputPath('emergency-bank-loan-card.png'), animations: 'disabled' });
  await card.getByRole('button', { name: 'Close emergency bank loan' }).click();
  await expect(page.locator('#bank-loan-modal')).toBeHidden();
  await expect(page.locator('#open-create-btn')).toBeFocused();
  await page.evaluate(() => window.__reopenBankOffer());
  await card.locator('[data-bank-offer-cancel]').click();
  await expect(page.locator('#bank-loan-modal')).toBeHidden();
  await page.evaluate(() => window.__reopenBankOffer());
  await page.keyboard.press('Escape');
  await expect(page.locator('#bank-loan-modal')).toBeHidden();
  await expect(page.locator('#open-create-btn')).toBeFocused();
});

async function createRound(page, browser, boardVariant) {
  const guestContext = await browser.newContext();
  const guest = await guestContext.newPage();
  const code = `U${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
  await page.goto('/');
  await page.locator('#home-alias').fill('LAYOUT HOST');
  await page.locator('#open-create-btn').click();
  await page.locator('#rc-vis-selector [data-vis="private"]').click();
  await page.locator('#rc-room-code').fill(code);
  await page.locator('#rc-create-btn').click();
  await page.locator('#su-start').click();
  await page.locator('[data-setting="boardVariant"]').selectOption(boardVariant);
  await guest.goto(new URL('/', page.url()).href);
  await guest.locator('#open-join-btn').click();
  await guest.locator('#room-join').fill(code);
  await guest.locator('#join-nickname').fill('LAYOUT GUEST');
  await guest.locator('#join-room-submit').click();
  await guest.waitForFunction(() => [...document.querySelectorAll('#setup-wrap, #lobby-start-btn')].some(el => el.getClientRects().length > 0));
  if (await guest.locator('#su-start').isVisible()) await guest.locator('#su-start').click();
  await expect(page.locator('#player-list .player-row')).toHaveCount(2);
  await page.locator('#lobby-start-btn').click();
  await expect(page.locator('#view-game')).toBeVisible();
  return guestContext;
}

for (const boardVariant of ['standard-40', 'metro-52']) {
  test(`${boardVariant} fills the center without overlapping turn controls`, async ({ page, browser }, testInfo) => {
    const guestContext = await createRound(page, browser, boardVariant);
    try {
      await expect(page.locator('#board-grid .tile')).toHaveCount(boardVariant === 'metro-52' ? 52 : 40);
      const boxes = await page.evaluate(() => {
        const box = selector => document.querySelector(selector).getBoundingClientRect().toJSON();
        return { stage: box('.board-area'), board: box('.board-holder'), name: box('#hud-name'), dice: box('#hud-dice'), roll: box('#roll-btn'), viewport: [innerWidth, innerHeight], document: [document.documentElement.scrollWidth, document.documentElement.scrollHeight] };
      });
      const { name, dice } = boxes;
      const overlap = name.left < dice.right && name.right > dice.left && name.top < dice.bottom && name.bottom > dice.top;
      expect(overlap, 'current turn name stays above the dice').toBe(false);
      expect(boxes.document).toEqual(boxes.viewport);
      // Boards stop growing at 1600px on very large screens, so "fills the center" means the smaller of the stage and that cap.
      expect(boxes.board.width).toBeGreaterThanOrEqual(Math.min(boxes.stage.width, boxes.stage.height, 1600) * 0.94);
      expect(boxes.board.bottom).toBeLessThanOrEqual(boxes.viewport[1] + 1);
      if (testInfo.project.use.hasTouch) expect(boxes.roll.height).toBeGreaterThanOrEqual(44);
      await page.screenshot({ path: testInfo.outputPath(`${boardVariant}-board.png`), animations: 'disabled' });
    } finally { await guestContext.close(); }
  });
}

test('short desktop home reserves space for clock and wordmark', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440x900', 'one desktop zoom-equivalent check');
  await page.setViewportSize({ width: 960, height: 540 });
  await page.goto('/');
  const overlap = await page.evaluate(() => {
    const clock = document.querySelector('#home-local-time').getBoundingClientRect();
    const title = document.querySelector('#view-home .wm-hero').getBoundingClientRect();
    return clock.left < title.right && clock.right > title.left && clock.top < title.bottom && clock.bottom > title.top;
  });
  expect(overlap).toBe(false);
});
