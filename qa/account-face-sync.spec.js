import { test, expect } from '@playwright/test';

// A signed-in player's face lives on the server account, so it follows them to any
// browser. Three separate browser contexts stand in for three machines.
test('a signed-in player keeps their face across browsers', async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== 'desktop-1440x900', 'One browser project proves the account flow.');
  const suffix = Math.floor(Math.random() * 90000 + 10000);
  const user = `face${suffix}`;
  const pass = `Pw-${Math.random().toString(36).slice(2, 10)}!9`;
  const face = (inkA, inkB) => Array.from({ length: 8 }, (_, r) => Array.from({ length: 8 }, (_, c) => ((r + c) % 2 ? inkA : inkB)));
  const firstFace = face('#12ab34', '#cc1155');
  const secondFace = face('#2255ee', '#cc1155');

  const signIn = async (page, mode) => {
    await page.evaluate(async (m) => { (await import('/clientAccountIdentity.js')).openAccountModal(m); }, mode);
    await page.locator('#account-username-input').fill(user);
    await page.locator('#account-password-input').fill(pass);
    if (mode === 'register') {
      await page.locator('#account-display-input').fill('FACETEST').catch(() => {});
      await expect(page.locator('#account-username-status')).toContainText('available');
    }
    await page.locator('#account-form').evaluate(form => form.requestSubmit());
    const hasCurrentCookieAccount = async () => page.evaluate(async () => {
      const { state } = await import('/clientState.js');
      if (!state.account?.account?.id) return false;
      try {
        const response = await fetch('/account/session', { credentials: 'include' });
        const session = await response.json();
        return response.ok && session?.success === true && session.account?.id === state.account.account.id;
      } catch {
        return false;
      }
    });
    await expect.poll(hasCurrentCookieAccount, { timeout: 10_000 }).toBe(true);
    await page.evaluate(async () => {
      const { requestSocialData } = await import('/clientSocialSurfaces.js');
      requestSocialData('#social-page-content');
    });
    await expect.poll(
      () => page.evaluate(async () => (await import('/clientAccountIdentity.js')).canApplyAccountSocialUpdate()),
      { timeout: 10_000 },
    ).toBe(true);
  };
  const activeFace = page => page.evaluate(async () => {
    const { state, getAppearanceMeta } = await import('/clientState.js');
    const meta = getAppearanceMeta(state.appearance);
    return { color: meta.color, grid: meta.avatarGrid };
  });
  const choose = (page, id, color, grid) => page.evaluate(async ([id, color, grid]) => {
    const { upsertProfile } = await import('/clientState.js');
    upsertProfile({ id, designName: id.toUpperCase().slice(0, 12), color, avatarGrid: grid });
    const { setActiveAppearance } = await import('/clientLobbyUi.js');
    setActiveAppearance(id);
  }, [id, color, grid]);

  const a = await (await browser.newContext()).newPage();
  await a.goto('/');
  await signIn(a, 'register');
  await choose(a, 'pf_first', '#cc1155', firstFace);

  const b = await (await browser.newContext()).newPage();
  await b.goto('/');
  await signIn(b, 'login');
  await expect.poll(async () => JSON.stringify((await activeFace(b)).grid)).toBe(JSON.stringify(firstFace));
  expect((await activeFace(b)).color).toBe('#cc1155');

  await choose(b, 'pf_second', '#2255ee', secondFace);

  const c = await (await browser.newContext()).newPage();
  await c.goto('/');
  await signIn(c, 'login');
  await expect.poll(async () => JSON.stringify((await activeFace(c)).grid)).toBe(JSON.stringify(secondFace));
  expect((await activeFace(c)).color).toBe('#2255ee');
});
