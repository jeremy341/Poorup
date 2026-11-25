import { test, expect } from '@playwright/test';

test.describe('About in the parlor shell', () => {
  test('opens in the current document with shared identity, audio, navigation and history', async ({ page }) => {
    await page.goto('/');
    await page.locator('#home-alias').fill('ABOUTGUEST');
    await page.evaluate(() => { window.__aboutDocument = 'same-document'; });
    await page.locator('#view-home .ticker a[href="/about"]').click();
    await expect(page.locator('#view-about')).toBeVisible();
    await expect(page).toHaveURL(/\/about$/);
    expect(await page.evaluate(() => window.__aboutDocument)).toBe('same-document');
    await expect(page.locator('#view-about [data-global-you-name]')).toContainText('ABOUTGUEST');
    await expect(page.locator('#view-about [data-global-nav] button')).toHaveCount(6);
    const sound = page.locator('#sound-toggle-btn');
    const initialSound = await sound.getAttribute('aria-pressed');
    await page.locator('#about-sound-toggle-btn').click();
    await expect(sound).not.toHaveAttribute('aria-pressed', initialSound);
    await expect(page.locator('#about-sound-toggle-btn')).toHaveAttribute('aria-pressed', await sound.getAttribute('aria-pressed'));
    const music = page.locator('#music-toggle-btn');
    const initialMusic = await music.getAttribute('aria-pressed');
    await page.locator('#about-music-toggle-btn').click();
    await expect(music).not.toHaveAttribute('aria-pressed', initialMusic);
    await expect(page.locator('#about-music-toggle-btn')).toHaveAttribute('aria-pressed', await music.getAttribute('aria-pressed'));
    await page.goBack();
    await expect(page.locator('#view-home')).toBeVisible();
    await expect(page.locator('#view-home .ticker a[href="/about"]')).toBeFocused();
    await page.goForward();
    await expect(page.locator('#view-about')).toBeVisible();
    await page.locator('[data-about-back]').click();
    await expect(page.locator('#view-home')).toBeVisible();
    await expect(page.locator('#home-alias')).toHaveValue('ABOUTGUEST');
  });

  test('loads the public route in the saved theme and keeps information internally scrollable', async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('poorup.theme.id.v2', 'winter'));
    await page.goto('/about');
    await expect(page.locator('#view-about')).toBeVisible();
    await expect(page.locator('body')).toHaveAttribute('data-theme-id', 'winter');
    await expect(page.locator('#view-about .hdr')).toBeVisible();
    await expect(page.locator('#view-about [data-global-nav] button')).toHaveCount(6);
    await expect(page.locator('#view-about .hdr .hdr-brand')).toBeVisible();
    await expect(page.getByRole('heading', { name: 'About Poorup', exact: true })).toBeVisible();
    await expect(page.locator('#about-page-content .about-pull')).toHaveAttribute('aria-hidden', 'true');
    await expect(page.locator('#about-page-content .about-rider')).toContainText('Know Monopoly or Richup.io?');
    await page.locator('#view-about a[href="#about-faq"]').click();
    const question = page.locator('#about-page-content details').filter({ has: page.locator('summary', { hasText: 'Do I need an account to play?' }) });
    await question.locator('summary').focus();
    await page.keyboard.press('Enter');
    await expect(question.locator('p')).toBeVisible();
    await expect(question.locator('p')).toContainText('An account is optional');
    const geometry = await page.evaluate(() => ({ x: document.documentElement.scrollWidth - innerWidth, y: document.documentElement.scrollHeight - innerHeight, page: scrollY, content: document.querySelector('#about-page-content').scrollTop }));
    expect(geometry.x).toBeLessThanOrEqual(1);
    expect(geometry.y).toBeLessThanOrEqual(1);
    expect(geometry.page).toBe(0);
    expect(geometry.content).toBeGreaterThan(0);
  });

  test('keeps the ticket decorative and the turn track in plain sight', async ({ page }) => {
    await page.goto('/about');
    const ticket = page.locator('#about-page-content .about-ticket');
    await expect(ticket).toHaveAttribute('aria-hidden', 'true');
    expect(await ticket.locator('a, button, input, summary, h1, h2, h3, [tabindex]').count()).toBe(0);
    const steps = page.locator('#about-page-content .about-steps > li');
    await expect(steps).toHaveCount(5);
    await expect(steps.first()).toBeVisible();
    await expect(steps.last()).toContainText('Outlast the table.');
    await expect(page.getByRole('heading', { name: 'How a game of Poorup plays', level: 3 })).toBeVisible();
  });

  test('lays out inside every supported width with 44px targets, an ordered outline and a sticky contents strip', async ({ page }) => {
    for (const [width, height] of [[1920, 1080], [1440, 900], [1180, 820], [390, 844]]) {
      const label = `${width}px`;
      await page.setViewportSize({ width, height });
      await page.goto('/about');
      await expect(page.locator('#view-about')).toBeVisible();
      await page.locator('#about-page-content .about-music-credits summary').click();
      const report = await page.evaluate(() => {
        const content = document.querySelector('#about-page-content');
        const small = [...content.querySelectorAll('a[href], summary')]
          .filter(element => element.getClientRects().length)
          .map(element => ({ name: (element.textContent || '').trim().slice(0, 24), box: element.getBoundingClientRect() }))
          .filter(({ box }) => box.width < 43.5 || box.height < 43.5)
          .map(({ name, box }) => `${name} ${Math.round(box.width)}x${Math.round(box.height)}`);
        const levels = [...content.querySelectorAll('h1, h2, h3, h4, h5, h6')].map(heading => Number(heading.tagName[1]));
        return { x: document.documentElement.scrollWidth - innerWidth, y: document.documentElement.scrollHeight - innerHeight, contentX: content.scrollWidth - content.clientWidth, small, levels };
      });
      expect(report.x, `${label}: no horizontal page overflow`).toBeLessThanOrEqual(1);
      expect(report.y, `${label}: the page itself never scrolls`).toBeLessThanOrEqual(1);
      expect(report.contentX, `${label}: no horizontal overflow inside the reading surface`).toBeLessThanOrEqual(1);
      expect(report.small, `${label}: every link and question is a 44px target`).toEqual([]);
      expect(report.levels[0], `${label}: the outline starts at h1`).toBe(1);
      expect(report.levels.filter(level => level === 1)).toHaveLength(1);
      report.levels.reduce((previous, level) => {
        expect(level, `${label}: no skipped heading level`).toBeLessThanOrEqual(previous + 1);
        return level;
      }, 0);

      // The contents strip stays under the header on wide screens, never hogs a phone, and never hides where a link lands.
      const sticky = width >= 900;
      await page.evaluate(() => { document.querySelector('#about-page-content').scrollTop = 1400; });
      const main = await page.locator('#about-page-content').boundingBox();
      const stripAfterScroll = await page.locator('.about-contents').boundingBox();
      if (sticky) expect(Math.abs(stripAfterScroll.y - main.y), `${label}: the strip stays pinned`).toBeLessThanOrEqual(1);
      else expect(stripAfterScroll.y + stripAfterScroll.height, `${label}: the strip scrolls away on phones`).toBeLessThanOrEqual(main.y + 1);
      await page.evaluate(() => { document.querySelector('#about-page-content').scrollTop = 0; });
      await page.locator('#view-about a[href="#about-faq"]').click();
      const title = await page.locator('#about-faq-title').boundingBox();
      const strip = await page.locator('.about-contents').boundingBox();
      if (sticky) expect(title.y, `${label}: the landed heading clears the sticky strip`).toBeGreaterThanOrEqual(strip.y + strip.height - 1);
    }
  });

  test('shows a visible keyboard focus ring on the contents strip and the questions', async ({ page }) => {
    await page.goto('/about');
    await page.locator('.about-contents a').first().focus();
    await page.keyboard.press('Tab');
    // Large desktops zoom the page 1.25 (like the shared header); computed lengths are
    // un-zoomed there, so the drawn ring is its computed width times the element's zoom.
    const ring = element => element.evaluate(node => {
      const style = getComputedStyle(node);
      const zoom = node.offsetHeight ? node.getBoundingClientRect().height / node.offsetHeight : 1;
      return { style: style.outlineStyle, width: parseFloat(style.outlineWidth) * zoom, visible: node.matches(':focus-visible') };
    });
    const strip = await ring(page.locator('.about-contents a').nth(1));
    expect(strip).toMatchObject({ visible: true });
    expect(strip.style).not.toBe('none');
    expect(strip.width).toBeGreaterThanOrEqual(1.99);
    const summary = page.locator('#about-page-content .about-question summary').first();
    await summary.focus();
    const question = await ring(summary);
    expect(question.style).not.toBe('none');
    expect(question.width).toBeGreaterThanOrEqual(1.99);
  });

  test('opens About from the footer and returns to the previous view', async ({ page }) => {
    await page.goto('/');
    await page.locator('#home-profile-tab').click();
    await expect(page.locator('#view-profile')).toBeVisible();
    await page.locator('#view-profile [data-home-tab="play"]').click();
    await page.locator('#view-home .ticker a[href="/about"]').click();
    await expect(page.locator('#view-about')).toBeVisible();
    await page.locator('[data-about-back]').click();
    await expect(page.locator('#view-home')).toBeVisible();
  });

  test('public information and native FAQ remain readable without JavaScript', async ({ browser, baseURL }) => {
    const context = await browser.newContext({ javaScriptEnabled: false, viewport: { width: 390, height: 844 } });
    const page = await context.newPage();
    await page.goto(`${baseURL}/about`);
    await expect(page.locator('#view-about')).toBeVisible();
    await page.locator('#view-about a[href="#about-faq"]').click();
    const question = page.locator('#about-page-content details').filter({ has: page.locator('summary', { hasText: 'Is Poorup free to play?' }) });
    await question.locator('summary').click();
    await expect(question.locator('p')).toContainText('nothing to download');
    await expect(page.locator('#about-page-content a[href="/"]').first()).toHaveText('Play now');
    await expect(page.locator('#about-page-content a[href="/rules"]').first()).toBeAttached();
    await context.close();
  });

  test('follows all six themes through the canonical profile preferences', async ({ page }) => {
    await page.goto('/');
    for (const id of ['spring', 'summer', 'autumn', 'winter', 'light', 'original']) {
      await page.locator('#home-profile-tab').click();
      await page.locator('#profile-tab-account').click();
      await page.locator(`[data-theme-choice-label="${id}"]`).click();
      await page.locator('#view-profile [data-home-tab="play"]').click();
      await page.locator('#view-home .ticker a[href="/about"]').click();
      await expect(page.locator('#view-about')).toBeVisible();
      await expect(page.locator('#view-about')).toHaveAttribute('data-theme-id', id);
      await expect(page.locator('body')).toHaveAttribute('data-theme-id', id);
      await expect(page.locator('#about-page-content .about-question')).toHaveCount(8);
      await page.locator('[data-about-back]').click();
      await expect(page.locator('#view-home')).toBeVisible();
    }
  });

  test('keeps a real lobby connection and seat when opening and closing About', async ({ page }) => {
    await page.addInitScript(() => {
      let wrapped;
      Object.defineProperty(window, 'io', { configurable: true, get: () => wrapped, set: value => {
        wrapped = (...args) => { const socket = value(...args); window.__aboutSocket = socket; return socket; };
        Object.assign(wrapped, value);
      } });
    });
    await page.goto('/');
    await page.locator('#home-alias').fill('ABOUTSEAT');
    await page.locator('#open-create-btn').click();
    await page.locator('#room-create-btn').click();
    await page.locator('#setup-start-btn').click();
    await expect.poll(() => page.evaluate(async () => (await import('/clientState.js')).state.phase)).toBe('lobby');
    const before = await page.evaluate(async () => {
      const { state } = await import('/clientState.js');
      return { roomCode: state.roomCode, clientId: state.clientId, phase: state.phase, seat: state.roomPlayerId, socket: window.__aboutSocket.id };
    });
    await page.locator('#panels-btn').click();
    await page.locator('#panel-menu [data-about-link]').click();
    await expect(page.locator('#view-about')).toBeVisible();
    const after = await page.evaluate(async () => {
      const { state } = await import('/clientState.js');
      return { roomCode: state.roomCode, clientId: state.clientId, phase: state.phase, seat: state.roomPlayerId, socket: window.__aboutSocket.id };
    });
    expect(after).toEqual(before);
    expect(await page.evaluate(() => window.__aboutSocket.connected)).toBe(true);
    await expect(page.locator('#view-about [data-global-connection-label]')).toHaveText('ONLINE');
    await page.locator('[data-about-back]').click();
    await expect(page.locator('#view-game')).toBeVisible();
    expect(await page.evaluate(async () => (await import('/clientState.js')).state.roomCode)).toBe(before.roomCode);
    await page.locator('#view-game').getByRole('button', { name: 'Back to home', exact: true }).click();
    await page.locator('#confirm-modal').getByRole('button', { name: 'LEAVE ROOM', exact: true }).click();
    await expect(page.locator('#view-home')).toBeVisible();
  });
});
