/* global document */
import { test, expect } from '@playwright/test';

// Zero-visual-change client optimisations: identical renders must not rewrite the DOM, and
// music must not download anything until the user starts it.

async function startTwoPlayerGame(page, context, code) {
  const guest = await context.newPage();
  await page.goto('/');
  await page.locator('#home-alias').fill('RGHOST');
  await page.locator('#open-create-btn').click();
  await page.locator('#rc-vis-selector [data-vis="private"]').click();
  await page.locator('#rc-room-code').fill(code);
  await page.locator('#rc-create-btn').click();
  await page.locator('#su-start').click();

  await guest.goto('/');
  await guest.locator('#home-alias').fill('RGGUEST');
  await guest.locator('#open-join-btn').click();
  await guest.locator('#room-join').fill(code);
  await guest.locator('#join-nickname').fill('RGGUEST');
  await guest.locator('#join-room-submit').click();
  await guest.waitForFunction(() => [...document.querySelectorAll('#setup-wrap, #lobby-start-btn')].some(el => el.getClientRects().length > 0));
  if (await guest.locator('#su-start').isVisible()) await guest.locator('#su-start').click();
  await expect(page.locator('#player-list')).toContainText('RGGUEST');
  await page.locator('#lobby-start-btn').click();
  await expect(page.locator('#view-game')).toBeVisible();
  return guest;
}

test('a cold load with music off downloads no music and idles both audio nodes on preload none', async ({ page }) => {
  const audioRequests = [];
  page.on('request', (request) => { if (request.url().includes('/assets/audio/')) audioRequests.push(request.url()); });
  await page.goto('/');
  await page.waitForLoadState('networkidle');
  await page.waitForTimeout(500);
  expect(audioRequests).toEqual([]);
  const nodes = await page.evaluate(() => [...document.querySelectorAll('audio[data-music-audio]')].map((audio) => ({ preload: audio.preload, networkState: audio.networkState })));
  expect(nodes).toHaveLength(2);
  for (const node of nodes) expect(node.preload).toBe('none');
});

test('unchanged renders leave the rail, dice and top bar DOM alone and changed state still renders', async ({ page, context }, testInfo) => {
  const code = `RG${testInfo.project.name.replace(/\D/g, '').slice(0, 3)}${testInfo.workerIndex}`.slice(0, 6).toUpperCase();
  const guest = await startTwoPlayerGame(page, context, code);
  const result = await page.evaluate(async () => {
    const [stateModule, rail, hud, top] = await Promise.all([
      import('/clientState.js'), import('/clientRailRender.js'), import('/clientHudRender.js'), import('/clientTopNavRender.js'),
    ]);
    const { state } = stateModule;
    const renderAll = () => { top.renderTopNav(); hud.renderHud(); rail.renderRightRail(); };
    state.tab = 'holdings';
    renderAll();
    const body = document.querySelector('#rr-body');
    const dice = document.querySelector('#hud-dice');
    const online = document.querySelector('#tn-online');
    const railNode = body.firstElementChild;
    const diceNode = dice.firstElementChild;
    const onlineText = online.firstChild;
    let railMarkerClicks = 0;
    railNode.addEventListener('click', () => { railMarkerClicks += 1; });
    body.style.maxHeight = '60px';
    body.style.overflow = 'auto';
    body.scrollTop = 17;
    const scrollBefore = body.scrollTop;
    const focusable = body.querySelector('button, [tabindex], a, summary');
    focusable?.focus();
    const focused = document.activeElement;

    const records = [];
    const observer = new MutationObserver((list) => records.push(...list));
    for (const target of [body, dice, online, document.querySelector('#hud-cash'), document.querySelector('#tn-room')]) {
      observer.observe(target, { subtree: true, childList: true, characterData: true });
    }
    renderAll();
    renderAll();
    records.push(...observer.takeRecords());
    observer.disconnect();
    body.firstElementChild.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    const unchanged = {
      mutations: records.length,
      sameRailNode: body.firstElementChild === railNode,
      sameDiceNode: dice.firstElementChild === diceNode,
      sameOnlineText: online.firstChild === onlineText,
      markerClicks: railMarkerClicks,
      scrollKept: body.scrollTop === scrollBefore && scrollBefore > 0,
      focusKept: focusable ? document.activeElement === focused : true,
      hadFocusable: Boolean(focusable),
    };

    state.tab = 'deals';
    rail.renderRightRail();
    const afterTab = { newRailNode: body.firstElementChild !== railNode };
    state.tab = 'holdings';
    const cashBefore = document.querySelector('#hud-cash').textContent;
    state.players[0].cash = 4242;
    state.players[0].visualCash = 4242;
    hud.renderHud();
    return { unchanged, afterTab, cashBefore, cashAfter: document.querySelector('#hud-cash').textContent };
  });
  expect(result.unchanged.mutations).toBe(0);
  expect(result.unchanged.sameRailNode).toBe(true);
  expect(result.unchanged.sameDiceNode).toBe(true);
  expect(result.unchanged.sameOnlineText).toBe(true);
  expect(result.unchanged.markerClicks).toBe(1);
  expect(result.unchanged.scrollKept).toBe(true);
  expect(result.unchanged.focusKept).toBe(true);
  expect(result.afterTab.newRailNode).toBe(true);
  expect(result.cashAfter).toContain('4,242');
  expect(result.cashAfter).not.toBe(result.cashBefore);
  await guest.close();
});
