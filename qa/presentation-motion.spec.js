import { test, expect, devices } from '@playwright/test';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';

const captureRoot = path.resolve('qa-artifacts/turn-presentation');

async function installRenderedFixture(page, pageErrors = []) {
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.goto('/');
  await page.evaluate(async () => {
    const [{ state }, hud, rail, board, modals] = await Promise.all([
      import('/clientState.js'), import('/clientHudRender.js'), import('/clientRailRender.js'),
      import('/clientBoardRender.js'), import('/clientGameModalsUi.js'),
    ]);
    state.clientId = 'local-client';
    state.phase = 'playing';
    state.gameStarted = true;
    state.turnIndex = 0;
    state.turnStage = 'roll';
    state.busy = false;
    state.presentationBusy = false;
    state.rolling = false;
    state.players = [
      { id: 'p1', serverId: 'server-local', clientId: 'local-client', name: 'LOCAL', cash: 1240, visualCash: 1240, pos: 12, color: '#cfa75f', textColor: '#e8d3ab', online: true },
      { id: 'p2', serverId: 'server-other', clientId: 'other-client', name: 'RIVAL', cash: 860, visualCash: 860, pos: 9, color: '#78a9a1', textColor: '#e8d3ab', bot: true, online: true },
    ];
    state.owners = { 1: 'p1', 3: 'p1', 6: 'p1', 8: 'p1', 5: 'p1', 12: 'p1' };
    state.houses = { 1: 2, 3: 1 };
    state.mortgaged = {};
    state.jail = {};
    state.dice = [4, 3];
    state.pool = 0;
    state.pendingBuyTile = null;
    state.auction = null;
    state.sponsorship = null;
    state.settings = { startingCash: 1500, houseLimit: 32, hotelLimit: 12 };
    state.log = ['Fixture rent posted', 'Fixture roll recorded', 'Fixture turn started'];
    state.lastGameFeed = state.log.slice();
    state.tab = 'holdings';
    state.deedDetail = null;
    document.querySelector('#view-home')?.classList.add('is-hidden');
    document.querySelector('#view-game')?.classList.remove('is-hidden');
    if (!document.querySelector('#board-grid .tile')) board.buildBoard(() => {});
    hud.renderHud();
    rail.renderRightRail();
    board.renderBoardState();
    board.placePieces();
    window.__qaFixture = { state, hud, rail, board, modals };
  });
}

async function captureView(page, viewportName, viewName) {
  await mkdir(captureRoot, { recursive: true });
  const file = path.join(captureRoot, `${viewportName}-${viewName}.png`);
  await page.screenshot({ path: file, fullPage: false });
  const geometry = await page.evaluate(() => ({
    viewport: { width: innerWidth, height: innerHeight },
    document: {
      clientWidth: document.documentElement.clientWidth,
      clientHeight: document.documentElement.clientHeight,
      scrollWidth: document.documentElement.scrollWidth,
      scrollHeight: document.documentElement.scrollHeight,
      bodyScrollWidth: document.body.scrollWidth,
      bodyScrollHeight: document.body.scrollHeight,
      scrollX,
      scrollY,
    },
    surfaces: Object.fromEntries(['#board-frame', '#hud', '#right-rail-game', '#log-drawer', '#bankruptcy-modal'].map(selector => {
      const el = document.querySelector(selector);
      if (!el) return [selector, null];
      const r = el.getBoundingClientRect();
      return [selector, { x: Math.round(r.x), y: Math.round(r.y), width: Math.round(r.width), height: Math.round(r.height), right: Math.round(r.right), bottom: Math.round(r.bottom), visible: getComputedStyle(el).visibility !== 'hidden' && getComputedStyle(el).display !== 'none' }];
    })),
  }));
  console.log(`CAPTURE ${file} ${JSON.stringify(geometry)}`);
  return { file, geometry };
}

test('authoritative roll presents dice, walk, and landing cash in order without a pawn flash', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1920x1080', 'One deterministic integration run is enough across the viewport matrix.');
  const context = await browser.newContext({
    ...devices['Desktop Chrome'],
    viewport: { width: 1920, height: 1080 },
    reducedMotion: 'no-preference',
    colorScheme: 'dark',
  });
  const page = await context.newPage();
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await page.clock.install({ time: new Date('2026-01-01T12:00:00Z') });
  await page.clock.pauseAt(new Date('2026-01-01T12:00:00Z'));
  await page.goto(process.env.POORUP_QA_BASE_URL || 'http://127.0.0.1:8080');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  const setup = await page.evaluate(async () => {
    const [{ state }, { buildBoard, startPieceWalk, placePieces, tileCenter }, { applyServerState }, { renderHud }, diceEffect] = await Promise.all([
      import('/clientState.js'), import('/clientBoardRender.js'), import('/clientStateSync.js'), import('/clientHudRender.js'),
      import('/clientDiceRollEffect.js'),
    ]);
    state.clientId = 'local-client';
    state.players = [];
    document.querySelector('#view-home')?.classList.add('is-hidden');
    document.querySelector('#view-game')?.classList.remove('is-hidden');
    if (!document.querySelector('#board-grid .tile')) buildBoard(() => {});
    const totals = [];
    const walkStarts = [];
    const host = {
      setConnectionStatus() {}, gameViewVisible: () => true, showView() {},
      renderAll() { renderHud(); placePieces(); },
      startPieceWalk: (id, from, to, options) => { walkStarts.push({ id, from, to }); return startPieceWalk(id, from, to, options); },
      cancelPieceMovement() {}, openAuctionSurface() {}, closeAuctionSurface() {},
      retireButton: () => null, bankruptcyHidden: () => true, hideBankruptcyModal() {},
      openBankruptcyModal() {}, showGameOver() {}, placePiecesSoon: () => placePieces(),
      announceDiceRoll(total) { totals.push(total); diceEffect.showDiceRollTotal(total); },
    };
    const baseline = {
      room: { roomCode: 'MOTION-QA', visibility: 'private', settings: { boardVariant: 'standard-40' } },
      game: {
        started: true, startedAt: 123, currentPlayerId: 'server-local', roundNumber: 1,
        hasRolled: false, diceRollSequence: 0, awaitingEndTurn: false, lastDice: [0, 0],
        turnOrder: ['server-local'],
        players: [{ id: 'server-local', clientId: 'local-client', nickname: 'LOCAL', color: '#cfa75f', position: 0, cash: 1000 }],
        tiles: [], feed: [], pendingPayment: null,
      },
    };
    applyServerState(baseline, host);
    document.querySelectorAll('.dice-roll-total').forEach(element => element.remove());
    const now = Date.now();
    const record = {
      id: 1, actorId: 'server-local', gameStartedAt: 123, dice: [2, 2], startedAt: now, readyAt: now + 2640,
      segments: [{ from: 0, to: 4, path: [1, 2, 3, 4], stepMs: 300, offsetMs: 1240, durationMs: 1200 }],
      cashEvents: [{ cause: 'landing', atMs: 2640, deltas: [{ playerId: 'server-local', amount: -50 }] }],
    };
    const roll = {
      room: baseline.room,
      game: { ...baseline.game, hasRolled: true, diceRollSequence: 1, awaitingEndTurn: true, lastDice: [2, 2], players: [{ ...baseline.game.players[0], position: 4, cash: 950 }], presentation: record },
    };
    applyServerState(roll, host);
    const snapshot = () => {
        const piece = document.querySelector('.piece[data-player="p1"]');
      const rect = piece?.getBoundingClientRect();
      return {
        total: totals.at(-1) ?? null,
        moving: piece?.classList.contains('is-moving') ?? false,
        position: piece ? { x: piece.style.getPropertyValue('--piece-x'), y: piece.style.getPropertyValue('--piece-y') } : null,
        tile4: tileCenter(4),
        cash: state.players[0]?.visualCash,
        rollDisabled: document.querySelector('#roll-btn')?.disabled,
        pieceBounds: rect ? { x: rect.x, y: rect.y } : null,
      };
    };
    window.__qaMotion = { totals, walkStarts, state, host, applyServerState, tileCenter };
    return { snapshot: snapshot(), roll };
  });
  expect(setup.snapshot.moving).toBe(false);
  expect(setup.snapshot.cash).toBe(1000);
  expect(setup.snapshot.rollDisabled).toBe(true);
  await page.evaluate(roll => window.__qaMotion.applyServerState(roll, window.__qaMotion.host), setup.roll);
  expect(await page.evaluate(() => ({ busy: window.__qaMotion.state.presentationBusy, totals: window.__qaMotion.totals.length, walkStarts: window.__qaMotion.walkStarts.length }))).toEqual({ busy: true, totals: 0, walkStarts: 0 });

  await page.clock.runFor(799);
  expect(await page.evaluate(() => window.__qaMotion.totals.length)).toBe(0);
  expect(await page.locator('.dice-roll-total').count()).toBe(0);
  await page.clock.runFor(1);
  const afterDice = await page.evaluate(() => ({ rollDisabled: document.querySelector('#roll-btn')?.disabled, total: document.querySelector('.dice-roll-total')?.textContent, visible: document.querySelector('.dice-roll-total')?.classList.contains('is-visible') }));
  expect(afterDice.rollDisabled).toBe(true);
  expect(afterDice.total).toBe('4');
  expect(afterDice.visible).toBe(true);

  await page.clock.runFor(439);
  const beforeWalk = await page.evaluate(() => ({ moving: document.querySelector('.piece[data-player="p1"]')?.classList.contains('is-moving') }));
  expect(beforeWalk.moving).toBe(false);
  expect(await page.evaluate(() => window.__qaMotion.walkStarts.length)).toBe(0);
  await page.clock.runFor(1);
  expect(await page.locator('.piece[data-player="p1"]').evaluate(el => el.classList.contains('is-moving'))).toBe(true);
  expect(await page.evaluate(() => window.__qaMotion.walkStarts)).toEqual([{ id: 'p1', from: 0, to: 4 }]);

  const walkTrace = [];
  for (let step = 0; step < 4; step += 1) {
    await page.clock.runFor(300);
    walkTrace.push(await page.locator('.piece[data-player="p1"]').evaluate(el => el.style.getPropertyValue('--piece-x')));
  }
  const expectedWalkX = await page.evaluate(() => [1, 2, 3, 4].map(tile => `${Math.round(window.__qaMotion.tileCenter(tile).x)}px`));
  expect(walkTrace).toEqual(expectedWalkX);
  expect(walkTrace.slice(1).every(position => position !== setup.snapshot.position.x)).toBe(true);
  const beforeLanding = await page.evaluate(() => ({ cash: window.__qaMotion.state.players[0]?.visualCash, x: document.querySelector('.piece[data-player="p1"]')?.style.getPropertyValue('--piece-x') }));
  expect(beforeLanding.cash).toBe(1000);
  await page.clock.runFor(200);
  const atLanding = await page.evaluate(() => ({
    cash: window.__qaMotion.state.players[0]?.visualCash,
    position: window.__qaMotion.state.players[0]?.pos,
    moving: document.querySelector('.piece[data-player="p1"]')?.classList.contains('is-moving'),
    rollDisabled: document.querySelector('#roll-btn')?.disabled,
    presentationBusy: window.__qaMotion.state.presentationBusy,
        x: document.querySelector('.piece[data-player="p1"]')?.style.getPropertyValue('--piece-x'),
        tile: window.__qaMotion.tileCenter(4),
  }));
  expect(atLanding.cash).toBe(950);
  expect(atLanding.position).toBe(4);
  expect(atLanding.moving).toBe(false);
  expect(atLanding.presentationBusy).toBe(false);
  expect(atLanding.rollDisabled).toBe(false);
  expect(beforeLanding.x).not.toBe('0px');
  expect(atLanding.x).toBe(`${Math.round(atLanding.tile.x)}px`);
  expect(pageErrors, 'the main browser modules must not throw during a recorded roll').toEqual([]);
  await context.close();
});

test('13-inch landscape HUD keeps both jail release actions visible and reachable', async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== 'ipad-1366x1024', 'The 13-inch landscape control check uses its matching iPad profile.');
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await installRenderedFixture(page, pageErrors);
  await page.evaluate(() => {
    window.__qaFixture.state.jail = { p1: 2 };
    window.__qaFixture.state.players[0].jailFree = 1;
    window.__qaFixture.hud.renderHud();
  });

  const hud = page.locator('#hud');
  const jailFine = page.locator('#pay-jail-fine');
  const jailCard = page.locator('#use-jail-free');
  await expect(jailFine).toBeVisible();
  await expect(jailCard).toBeVisible();
  await expect(jailFine).toBeEnabled();
  await expect(jailCard).toBeEnabled();
  for (const control of [jailFine, jailCard]) {
    const box = await control.boundingBox();
    const hudBox = await hud.boundingBox();
    expect(box).not.toBeNull();
    expect(box.width).toBeGreaterThanOrEqual(44);
    expect(box.height).toBeGreaterThanOrEqual(44);
    expect(box.x).toBeGreaterThanOrEqual(hudBox.x);
    expect(box.y).toBeGreaterThanOrEqual(hudBox.y);
    expect(box.x + box.width).toBeLessThanOrEqual(hudBox.x + hudBox.width + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(hudBox.y + hudBox.height + 1);
    expect(box.y + box.height).toBeLessThanOrEqual(await page.evaluate(() => innerHeight));
  }
  expect(pageErrors).toEqual([]);
});

test('fixture captures grouped holdings, event log, debt modal, and body overflow at required viewports', async ({ page }, testInfo) => {
  test.setTimeout(120_000);
  test.skip(testInfo.project.name !== 'desktop-1920x1080', 'Viewport matrix is exercised in a single browser project.');
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const pageErrors = [];
  page.on('pageerror', error => pageErrors.push(error.message));
  await installRenderedFixture(page, pageErrors);

  const viewports = [
    ['desktop-1920x1080', 1920, 1080], ['desktop-1366x768', 1366, 768],
    ['ipad-1180x820', 1180, 820], ['ipad-820x1180', 820, 1180],
    ['ipad-1180x700', 1180, 700], ['ipad-820x1060', 820, 1060],
    ['ipad-200pct-proxy-590x410', 590, 410],
  ];
  const readings = [];
  const overflowFailures = [];
  const numericFontFailures = [];
  const browser = page.context().browser();
  for (const [name, width, height] of viewports) {
    let capturePage = page;
    let ipadContext = null;
    if (name.startsWith('ipad-')) {
      ipadContext = await browser.newContext({
        ...devices['iPad Pro 11 landscape'],
        viewport: { width, height },
      });
      capturePage = await ipadContext.newPage();
      await installRenderedFixture(capturePage, pageErrors);
    } else {
      await page.setViewportSize({ width, height });
    }
    await capturePage.evaluate(() => {
      window.__qaFixture.rail.renderRightRail();
      window.__qaFixture.hud.renderHud();
      window.__qaFixture.board.placePieces();
      document.querySelector('#log-drawer')?.classList.remove('is-open');
      document.querySelector('#bankruptcy-modal')?.classList.add('is-hidden');
    });
    const base = await captureView(capturePage, name, 'hud-holdings');
    readings.push(base.geometry);
    const bodyOverflow = {
      documentX: base.geometry.document.scrollWidth - base.geometry.document.clientWidth,
      documentY: base.geometry.document.scrollHeight - base.geometry.document.clientHeight,
      bodyX: base.geometry.document.bodyScrollWidth - base.geometry.document.clientWidth,
      bodyY: base.geometry.document.bodyScrollHeight - base.geometry.document.clientHeight,
    };
    if (Object.values(bodyOverflow).some(value => value > 2)) overflowFailures.push({ viewport: name, ...bodyOverflow });
    const groupOrder = await capturePage.locator('#rr-body [data-deed-open]').evaluateAll(nodes => nodes.map(node => node.dataset.deedOpen));
    expect(groupOrder).toEqual(['1', '3', '6', '8', '5', '12']);

    await capturePage.evaluate(async () => {
      const { toggleLogDrawerFromButton } = await import('/clientLogDrawer.js');
      toggleLogDrawerFromButton();
    });
    const logShot = await captureView(capturePage, name, 'event-log');
    readings.push(logShot.geometry);
    const logOverflow = {
      documentX: logShot.geometry.document.scrollWidth - logShot.geometry.document.clientWidth,
      documentY: logShot.geometry.document.scrollHeight - logShot.geometry.document.clientHeight,
      bodyX: logShot.geometry.document.bodyScrollWidth - logShot.geometry.document.clientWidth,
      bodyY: logShot.geometry.document.bodyScrollHeight - logShot.geometry.document.clientHeight,
    };
    if (Object.values(logOverflow).some(value => value > 2)) overflowFailures.push({ viewport: name, surface: 'log', ...logOverflow });
    await capturePage.locator('.tile[data-tile="1"]').focus();
    await capturePage.keyboard.press('Enter');
    await expect(capturePage.locator('#popup')).not.toHaveClass(/is-hidden/);
    await expect(capturePage.locator('#log-drawer')).toHaveClass(/is-open/);
    await capturePage.locator('#pop-close').click();
    await expect(capturePage.locator('#popup')).toHaveClass(/is-hidden/);
    await expect(capturePage.locator('#log-drawer')).toHaveClass(/is-open/);
    await capturePage.evaluate(() => document.querySelector('#log-drawer')?.classList.remove('is-open'));

    await capturePage.evaluate(() => {
      window.__qaFixture.modals.openBankruptcyModal(0, 1450, 'Fixture Bank', 'Fixture rent is due.');
    });
    const numericFonts = await capturePage.evaluate(() => ({
      sidebarPrice: getComputedStyle(document.querySelector('#rr-body .deed-price')).fontFamily,
      debtAmounts: [...document.querySelectorAll('#bankruptcy-card .numeric')].map(element => getComputedStyle(element).fontFamily),
    }));
    console.log(`NUMERIC FONTS ${name} ${JSON.stringify(numericFonts)}`);
    if (!numericFonts.sidebarPrice.includes('Silkscreen') || numericFonts.debtAmounts.some(family => !family.includes('Silkscreen'))) {
      numericFontFailures.push({ viewport: name, ...numericFonts });
    }
    const debtShot = await captureView(capturePage, name, 'debt-modal');
    readings.push(debtShot.geometry);
    const debtOverflow = {
      documentX: debtShot.geometry.document.scrollWidth - debtShot.geometry.document.clientWidth,
      documentY: debtShot.geometry.document.scrollHeight - debtShot.geometry.document.clientHeight,
      bodyX: debtShot.geometry.document.bodyScrollWidth - debtShot.geometry.document.clientWidth,
      bodyY: debtShot.geometry.document.bodyScrollHeight - debtShot.geometry.document.clientHeight,
    };
    if (Object.values(debtOverflow).some(value => value > 2)) overflowFailures.push({ viewport: name, surface: 'debt', ...debtOverflow });
    await capturePage.evaluate(() => document.querySelector('#bankruptcy-modal')?.classList.add('is-hidden'));
    await ipadContext?.close();
  }
  console.log(`OVERFLOW MATRIX ${JSON.stringify(readings.map(item => ({ viewport: item.viewport, document: item.document, surfaces: item.surfaces })))}`);
  expect(pageErrors, 'the main browser modules must not throw during fixture rendering').toEqual([]);
  expect(overflowFailures, 'document/body must not scroll in the fixture viewport matrix').toEqual([]);
  expect(numericFontFailures, 'sidebar and debt modal numeric fields should use Silkscreen').toEqual([]);
});
