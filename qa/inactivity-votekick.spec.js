import { test, expect } from '@playwright/test';

/* global document, window, Event, KeyboardEvent, PointerEvent */

test('inactivity presence coalesces input and sends no raw event data', async ({ page }) => {
  await page.clock.install();
  await page.goto('/');
  await page.evaluate(async () => {
    const { createPresenceMonitor } = await import('/clientPlayerPresence.js');
    window.__presenceMessages = [];
    window.__presenceMonitor = createPresenceMonitor({ emit: (...args) => window.__presenceMessages.push(args) });
  });
  await page.clock.fastForward(30_000);
  await page.evaluate(() => {
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 811, clientY: 22 }));
    window.dispatchEvent(new PointerEvent('pointermove', { clientX: 812, clientY: 23 }));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'SecretKey' }));
  });
  await page.clock.fastForward(30_000);
  const messages = await page.evaluate(() => {
    window.__presenceMonitor.destroy();
    return window.__presenceMessages;
  });
  expect(messages).toEqual([
    ['player-presence', { state: 'inactive', reason: 'idle' }],
    ['player-presence', { state: 'active' }],
    ['player-presence', { state: 'inactive', reason: 'idle' }],
  ]);
  expect(JSON.stringify(messages)).not.toContain('SecretKey');
  expect(JSON.stringify(messages)).not.toContain('811');
});

test('presence monitor reports the hidden transition and a clean activity reset', async ({ page }) => {
  await page.goto('/');
  const messages = await page.evaluate(async () => {
    const { createPresenceMonitor } = await import('/clientPlayerPresence.js');
    const output = [];
    const originalVisibility = Object.getOwnPropertyDescriptor(document, 'visibilityState');
    let visibility = 'visible';
    Object.defineProperty(document, 'visibilityState', { configurable: true, get: () => visibility });
    const monitor = createPresenceMonitor({ emit: (...args) => output.push(args) });
    visibility = 'hidden';
    document.dispatchEvent(new Event('visibilitychange'));
    visibility = 'visible';
    document.dispatchEvent(new Event('visibilitychange'));
    window.dispatchEvent(new KeyboardEvent('keydown', { key: 'SecretKey' }));
    monitor.destroy();
    if (originalVisibility) Object.defineProperty(document, 'visibilityState', originalVisibility);
    else delete document.visibilityState;
    return output;
  });
  expect(messages).toEqual([
    ['player-presence', { state: 'inactive', reason: 'hidden' }],
    ['player-presence', { state: 'active' }],
  ]);
  expect(JSON.stringify(messages)).not.toContain('SecretKey');
});

test('inactive players show a countdown chip on their sidebar row', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    document.querySelector('#view-home')?.classList.add('is-hidden');
    document.querySelector('#view-game')?.classList.remove('is-hidden');
    document.querySelector('#setup-wrap')?.classList.add('is-hidden');
  });
  const rendered = await page.evaluate(async () => {
    const { createInactivityUi, inactiveBadgeHTML } = await import('/clientInactivityUi.js');
    const list = document.querySelector('#player-list');
    const now = Date.now();
    const players = [
      { id: 'earliest', name: 'MARLOW', presence: { state: 'inactive', inactiveSince: now, inactiveUntil: now + 180_000 } },
      { id: 'later', name: 'JUNO', presence: { state: 'inactive', inactiveSince: now, inactiveUntil: now + 240_000 } },
      { id: 'bot', name: 'CPU', isBot: true, presence: { state: 'inactive', inactiveSince: now, inactiveUntil: now + 30_000 } },
    ];
    list.innerHTML = players.map(p => '<div class="player-row"><span>' + p.name + '</span>' + inactiveBadgeHTML(p, now) + '</div>').join('');
    const ui = createInactivityUi({ listHost: list, now: () => now });
    window.__inactivityUi = ui;
    ui.update(players, now);
    return [...list.querySelectorAll('.pr-timer')].map(badge => ({
      player: badge.dataset.timerPlayer,
      text: badge.textContent,
      width: badge.getBoundingClientRect().width,
    }));
  });
  expect(rendered.map(badge => badge.player)).toEqual(['earliest', 'later']);
  expect(rendered.map(badge => badge.text)).toEqual(['3:00', '4:00']);
  expect(rendered[0].width).toBeGreaterThan(0);
  await page.evaluate(() => window.__inactivityUi.destroy());
});

test('vote panel discloses settlement and emits the approved room event payloads', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    document.querySelector('#view-home')?.classList.add('is-hidden');
    document.querySelector('#view-game')?.classList.remove('is-hidden');
    document.querySelector('#setup-wrap')?.classList.add('is-hidden');
  });
  await page.evaluate(async () => {
    const { createVoteKickUi } = await import('/clientVoteKickUi.js');
    const host = document.querySelector('#room-votekick-host');
    window.__voteEvents = [];
    window.__voteUi = createVoteKickUi({
      container: host,
      emit: (event, payload, ack) => { window.__voteEvents.push({ event, payload }); ack?.({ success: true }); },
      createRequestId: () => 'browser-vote-request',
    });
    window.__votePlayers = [
      { id: 'p1', serverId: 'seat-one', name: 'MARLOW' },
      { id: 'p2', serverId: 'seat-two', name: 'JUNO' },
      { id: 'p3', serverId: 'seat-three', name: 'PIP' },
    ];
    window.__voteUi.requestStart('seat-two', window.__votePlayers);
  });
  await expect(page.locator('#room-votekick-host')).toContainText('assets and debts are settled');
  await page.locator('#room-votekick-host [data-votekick-action="start"]').evaluate(button => button.click());
  await expect.poll(() => page.evaluate(() => window.__voteEvents[0])).toEqual({
    event: 'room-votekick-start',
    payload: { targetPlayerId: 'seat-two', requestId: 'browser-vote-request' },
  });
  await page.evaluate(() => window.__voteUi.update({
    voteId: 'vote-one', targetPlayerId: 'seat-two', openedAt: Date.now(), expiresAt: Date.now() + 30_000,
    eligibleCount: 2, yesCount: 1, noCount: 0, requiredYes: 2, status: 'open',
  }, window.__votePlayers, Date.now()));
  await expect(page.locator('#room-votekick-host')).toContainText('JUNO');
  await expect(page.locator('#room-votekick-host')).toContainText('NEEDED');
  await expect(page.locator('#room-votekick-host [role="progressbar"]')).toBeVisible();
  await page.locator('#room-votekick-host [data-votekick-choice="yes"]').evaluate(button => button.click());
  await expect.poll(() => page.evaluate(() => window.__voteEvents[1])).toEqual({
    event: 'room-votekick-cast',
    payload: { voteId: 'vote-one', choice: 'yes', requestId: 'browser-vote-request' },
  });
  await page.evaluate(() => window.__voteUi.destroy());
});

test('lobby keeps Standard 40 and has no building-supply or turn-limit controls', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const [{ state }, { renderLobbyRail }] = await Promise.all([
      import('/clientState.js'),
      import('/clientLobbyUi.js'),
    ]);
    state.phase = 'lobby';
    state.settings = { ...state.settings, boardVariant: 'standard-40', maxPlayers: 4 };
    renderLobbyRail();
  });
  await expect(page.locator('#rc-ruleset-preset')).toHaveCount(0);
  await expect(page.locator('#lobby-settings-body [data-setting="boardVariant"]')).toHaveValue('standard-40');
  await expect(page.locator('#lobby-settings-body')).not.toContainText('Bankruptcy');
  await expect(page.locator('#lobby-settings-body')).not.toContainText('Turn Timer');
  await expect(page.locator('#lobby-settings-body [data-setting="houseLimit"], #lobby-settings-body [data-setting="hotelLimit"]')).toHaveCount(0);
  await expect(page.locator('#lobby-settings-body')).not.toContainText(/House Limit|Hotel Limit/);
});

test('game surface keeps document overflow inside its own rails and drawers', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(() => {
    document.querySelector('#view-home')?.classList.add('is-hidden');
    document.querySelector('#view-game')?.classList.remove('is-hidden');
    document.querySelector('#setup-wrap')?.classList.add('is-hidden');
  });
  const overflow = await page.evaluate(() => ({
    viewportWidth: window.innerWidth,
    viewportHeight: window.innerHeight,
    documentWidth: document.documentElement.scrollWidth,
    documentHeight: document.documentElement.scrollHeight,
  }));
  expect(overflow.documentWidth).toBeLessThanOrEqual(overflow.viewportWidth);
  expect(overflow.documentHeight).toBeLessThanOrEqual(overflow.viewportHeight);
});
