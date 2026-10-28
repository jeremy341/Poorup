/* global window */
import { test, expect } from '@playwright/test';

const TARGET_PROJECTS = new Set(['desktop-1440x900', 'ipad-1194x834']);

async function createGameWithFlights(page, context, code) {
  const guest = await context.newPage();
  await page.goto('/');
  await page.locator('#home-alias').fill('FLYHOST');
  await page.locator('#open-create-btn').click();
  await page.locator('#rc-vis-selector [data-vis="private"]').click();
  await page.locator('#rc-room-code').fill(code);
  await page.locator('#rc-create-btn').click();
  await page.locator('#su-start').click();
  // The host switch lives in the lobby rules rail.
  const toggle = page.locator('[data-setting="flights"]').first();
  await toggle.scrollIntoViewIfNeeded();
  await toggle.click();
  await expect(toggle).toHaveAttribute('aria-pressed', 'true');

  await guest.goto('/');
  await guest.locator('#home-alias').fill('FLYGUEST');
  await guest.locator('#open-join-btn').click();
  await guest.locator('#room-join').fill(code);
  await guest.locator('#join-nickname').fill('FLYGUEST');
  await guest.locator('#join-room-submit').click();
  await guest.waitForFunction(() => [...document.querySelectorAll('#setup-wrap, #lobby-start-btn')].some(el => el.getClientRects().length > 0));
  if (await guest.locator('#su-start').isVisible()) await guest.locator('#su-start').click();
  await expect(page.locator('#player-list')).toContainText('FLYGUEST');
  await page.locator('#lobby-start-btn').click();
  await expect(page.locator('#view-game')).toBeVisible();
  return guest;
}

test.describe('airport flights UI', () => {
  test.beforeEach(({ page }, testInfo) => {
    void page;
    test.skip(!TARGET_PROJECTS.has(testInfo.project.name), 'Flight UI is checked on desktop and iPad landscape.');
  });

  test('the host switch turns flights on for the table and the server shares the fees', async ({ page, context }) => {
    const code = `F${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const guest = await createGameWithFlights(page, context, code);
    const readFlags = () => page.evaluate(async () => {
      const { state } = await import('/clientState.js');
      return { enabled: state.flights.enabled, setting: state.settings.flights };
    });
    await expect.poll(readFlags).toEqual({ enabled: true, setting: true });
    const airport = await page.evaluate(async () => {
      const { state } = await import('/clientState.js');
      const tile = state.serverTiles.find(entry => entry.type === 'railroad');
      return { departureFee: tile.departureFee, arrivalFee: tile.arrivalFee };
    });
    expect(airport).toEqual({ departureFee: 100, arrivalFee: 100 });
    await guest.close();
  });

  test('FLY FROM HERE opens a priced flight desk, selects the cheapest airport, and books it', async ({ page, context }) => {
    const code = `F${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const guest = await createGameWithFlights(page, context, code);
    const sent = await page.evaluate(async () => {
      const [{ state }, flight, hud] = await Promise.all([
        import('/clientState.js'), import('/clientFlightUi.js'), import('/clientHudRender.js'),
      ]);
      window.__flightEmits = [];
      flight.configureFlightUi({
        emitServer: (event, payload, ack) => { window.__flightEmits.push({ event, payload }); ack?.({ success: true, fare: 40, basis: 'arrival' }); },
        renderAll: () => hud.renderHud(),
      });
      // Pose the local player on ACC Airport with three priced destinations.
      state.phase = 'playing';
      state.turnIndex = 0;
      state.turnStage = 'roll';
      state.players[0].pos = 5;
      state.flights = {
        enabled: true, defaultFare: 100, maxFee: 200,
        options: [
          { tileIndex: 15, fare: 40, basis: 'arrival', payeeId: state.players[1]?.serverId || null, affordable: true },
          { tileIndex: 25, fare: 100, basis: 'default', payeeId: null, affordable: true },
          { tileIndex: 35, fare: 100000, basis: 'departure', payeeId: state.players[1]?.serverId || null, affordable: false },
        ],
      };
      hud.renderHud();
      return true;
    });
    expect(sent).toBe(true);

    const flyButton = page.locator('#open-flight-desk');
    await expect(flyButton).toBeVisible();
    await page.screenshot({ path: test.info().outputPath('fly-button.png') });
    await flyButton.click();
    const modal = page.locator('#flight-modal');
    await expect(modal).not.toHaveClass(/is-hidden/);
    await expect(modal.locator('#flight-card-title')).toContainText('Fly from');
    const rows = modal.locator('[data-flight-tile]');
    await expect(rows).toHaveCount(3);
    // The cheapest affordable airport starts selected; the unaffordable one is disabled.
    await expect(modal.locator('[data-flight-tile="15"]')).toHaveAttribute('aria-checked', 'true');
    await expect(modal.locator('[data-flight-tile="35"]')).toBeDisabled();
    await expect(modal.locator('#flight-go')).toContainText('FLY · $40');
    await expect(modal.locator('[data-flight-tile="35"]')).toContainText('AFFORD');

    await modal.locator('[data-flight-tile="25"]').click();
    await expect(modal.locator('#flight-go')).toContainText('FLY · $100');

    await page.screenshot({ path: test.info().outputPath('flight-desk.png') });

    await modal.locator('#flight-go').click();
    const emits = await page.evaluate(() => window.__flightEmits);
    expect(emits).toEqual([{ event: 'fly-to-airport', payload: { tileIndex: 25 } }]);
    await expect(modal).toHaveClass(/is-hidden/);
    await guest.close();
  });

  test('the flight desk closes with Escape and the FLY button hides when no flight is bookable', async ({ page, context }) => {
    const code = `F${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const guest = await createGameWithFlights(page, context, code);
    await page.evaluate(async () => {
      const [{ state }, hud] = await Promise.all([import('/clientState.js'), import('/clientHudRender.js')]);
      state.phase = 'playing';
      state.turnIndex = 0;
      state.turnStage = 'roll';
      state.flights = { enabled: true, defaultFare: 100, maxFee: 200, options: [{ tileIndex: 15, fare: 100, basis: 'default', payeeId: null, affordable: true }] };
      hud.renderHud();
    });
    await page.locator('#open-flight-desk').click();
    await expect(page.locator('#flight-modal')).not.toHaveClass(/is-hidden/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#flight-modal')).toHaveClass(/is-hidden/);
    await page.evaluate(async () => {
      const [{ state }, hud] = await Promise.all([import('/clientState.js'), import('/clientHudRender.js')]);
      state.flights = { enabled: true, defaultFare: 100, maxFee: 200, options: [] };
      hud.renderHud();
    });
    await expect(page.locator('#open-flight-desk')).toBeHidden();
    await guest.close();
  });

  test('an airport owner edits both fees with steppers inside the deed manager', async ({ page, context }) => {
    const code = `F${Math.random().toString(36).slice(2, 7).toUpperCase()}`;
    const guest = await createGameWithFlights(page, context, code);
    await page.evaluate(async () => {
      const [{ state }, deeds, flight] = await Promise.all([
        import('/clientState.js'), import('/clientDeedDetailUi.js'), import('/clientFlightUi.js'),
      ]);
      window.__feeEmits = [];
      flight.configureFlightUi({
        emitServer: (event, payload, ack) => { window.__feeEmits.push({ event, payload }); ack?.({ success: true }); },
        renderAll: () => {},
      });
      state.owners[5] = 'p1';
      const tile = state.serverTiles.find(entry => entry.index === 5);
      tile.departureFee = 60;
      tile.arrivalFee = 200;
      deeds.openDeedDetail(5);
    });
    const card = page.locator('#deed-card-detail');
    await expect(card.locator('.fee-block')).toContainText('FLIGHT FEES');
    await page.screenshot({ path: test.info().outputPath('fee-steppers.png') });
    await expect(card.locator('.fee-row').nth(0)).toContainText('$60');
    await expect(card.locator('.fee-row').nth(1)).toContainText('$200');
    // The arrival fee is already at the maximum, so its plus button is disabled.
    await expect(card.locator('[data-airport-fee="arrival"][data-delta="10"]')).toBeDisabled();
    await card.locator('[data-airport-fee="departure"][data-delta="10"]').click();
    await card.locator('[data-airport-fee="arrival"][data-delta="-10"]').click();
    const emits = await page.evaluate(() => window.__feeEmits);
    expect(emits).toEqual([
      { event: 'set-airport-fees', payload: { tileIndex: 5, departure: 70 } },
      { event: 'set-airport-fees', payload: { tileIndex: 5, arrival: 190 } },
    ]);
    await guest.close();
  });
});
