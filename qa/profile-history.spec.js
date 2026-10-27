import { test, expect } from '@playwright/test';

const OWNER = 'history-owner';

function round(n, cash, placement, extra = {}) {
  return {
    matchId: `match-${n}`, completedAt: `2026-10-${String(10 + n).padStart(2, '0')}T12:00:00.000Z`,
    durationSeconds: 800 + n * 60, roundCount: 10 + n, boardVariant: 'standard-40', result: placement === 1 ? 'WIN' : 'ROUND',
    globalEvents: ['Market rush'], tradesCompleted: 1, auctionsCompleted: 1,
    casino: [{ accountId: OWNER, net: -10 * n }], market: [{ accountId: OWNER, net: 5 * n }], playerContracts: [],
    netWorthTimeline: Array.from({ length: 6 }, (_, step) => ({ round: step + 1, worth: [Math.round(1500 + (cash - 1500) * ((step + 1) / 6)), Math.round(1500 - (cash - 1500) * ((step + 1) / 12))] })),
    participants: [
      { accountId: OWNER, displayNameAtMatch: 'HISTORY OWNER', finalPlacement: placement, endingCash: cash, propertyCount: 4, ...(extra.bankrupt ? { bankrupt: true } : {}) },
      { accountId: 'rival', displayNameAtMatch: 'RIVAL', finalPlacement: placement === 1 ? 2 : 1, endingCash: 500, propertyCount: 2 },
    ],
    ...extra.entry,
  };
}

// Newest first, like the real list: two wins, a placement, a bankruptcy, a metro round with house rules.
const HISTORY = [
  round(5, 900, 1), round(4, 1500, 1),
  round(3, 400, 2, { entry: { boardVariant: 'metro-52', rulesetOverrides: [{ key: 'startingCash', value: 2000 }] } }),
  round(2, 0, 3, { bankrupt: true }), round(1, 1100, 2),
];

async function openHistory(page, history = HISTORY, gamesPlayed = 9) {
  await page.goto('/');
  await expect(page.locator('#view-home')).toBeVisible();
  await page.locator('#home-rankings-tab').click();
  await page.locator('#view-rankings [data-home-tab="profile"]').click();
  await expect(page.locator('#view-profile')).toBeVisible();
  await page.evaluate(async ({ history: rows, owner, played }) => {
    const { state } = await import('/clientState.js');
    const { renderProfileStatistics, renderProfileHistory } = await import('/clientProfileRender.js');
    state.account = { sessionToken: 'qa-session', account: {
      id: owner, username: owner, displayName: 'HISTORY OWNER',
      stats: { gamesPlayed: played, wins: 3, bankruptcies: 1 }, matchHistory: rows, history: rows,
    } };
    renderProfileStatistics();
    renderProfileHistory();
  }, { history, owner: OWNER, played: gamesPlayed });
  await page.locator('#profile-tab-history').click();
  await expect(page.locator('.profile-history-row').first()).toBeVisible();
}

test.describe('profile round history', () => {
  test('summary strip reports the record and draws the cash trend without overflowing', async ({ page }) => {
    await openHistory(page);
    const strip = page.locator('.profile-history-strip');
    await expect(strip).toContainText('WINS');
    await expect(strip).toContainText('2 · 40%');
    await expect(strip).toContainText('#1.8');
    await expect(strip).toContainText('WIN STREAK');
    await expect(strip.locator('svg.pc-spark')).toHaveCount(1);
    await expect(page.locator('.profile-history-chip.is-best')).toHaveCount(1);
    await expect(page.locator('.profile-history-row').nth(1)).toContainText('BEST CASH');
    const overflow = await page.evaluate(() => ({
      page: document.documentElement.scrollWidth - document.documentElement.clientWidth,
      rows: Math.max(...[...document.querySelectorAll('.profile-history-row, .profile-history-strip, .profile-history-toolbar')].map(node => node.scrollWidth - node.clientWidth)),
    }));
    expect(overflow.page).toBe(0);
    expect(overflow.rows).toBeLessThanOrEqual(0);
  });

  test('says when older rounds are no longer listed', async ({ page }) => {
    await openHistory(page, HISTORY, 120);
    await expect(page.locator('#profile-history-content [role="status"]').first()).toHaveText('5 OF 120 ROUNDS LISTED');
    await expect(page.locator('.profile-history-note')).toContainText('Older rounds still count toward your statistics');
  });

  test('filters narrow the list, keep round numbers, announce the count and can be cleared', async ({ page }) => {
    await openHistory(page);
    const rows = page.locator('.profile-history-row');
    await expect(rows).toHaveCount(5);
    await page.locator('[data-profile-history-filter="result:win"]').click();
    await expect(rows).toHaveCount(2);
    await expect(page.locator('[data-profile-history-filter="result:win"]')).toHaveAttribute('aria-pressed', 'true');
    await expect(page.locator('[data-profile-history-filter="result:win"]')).toBeFocused();
    await expect(page.locator('#profile-history-content [role="status"]').first()).toHaveText('SHOWING 2 OF 5');
    await expect(rows.first().locator('.profile-history-index')).toHaveText('05');
    await expect(rows.nth(1).locator('.profile-history-index')).toHaveText('04');

    await page.locator('[data-profile-history-filter="houseRules"]').click();
    await expect(page.locator('.profile-history-empty')).toContainText('NO ROUNDS MATCH THESE FILTERS');
    await page.locator('[data-profile-history-filter="clear"]').click();
    await expect(rows).toHaveCount(5);

    await page.locator('[data-profile-history-filter="houseRules"]').click();
    await expect(rows).toHaveCount(1);
    await expect(rows.first()).toContainText('METRO-52');
    await page.locator('[data-profile-history-filter="clear"]').or(page.locator('[data-profile-history-filter="houseRules"]')).first().click();
    await page.locator('[data-profile-history-filter="result:all"]').click();

    await page.locator('select[data-profile-history-filter="board"]').selectOption('metro-52');
    await expect(rows).toHaveCount(1);
    await page.locator('select[data-profile-history-filter="board"]').selectOption('all');
    await expect(rows).toHaveCount(5);
  });

  test('expand all and collapse all open every visible round, and arrow keys walk the list', async ({ page }) => {
    await openHistory(page);
    await page.locator('[data-profile-history-bulk="expand"]').click();
    await expect(page.locator('.profile-history-toggle[aria-expanded="true"]')).toHaveCount(5);
    await expect(page.locator('.profile-history-details:visible')).toHaveCount(5);
    await page.locator('[data-profile-history-bulk="collapse"]').click();
    await expect(page.locator('.profile-history-toggle[aria-expanded="true"]')).toHaveCount(0);

    const toggles = page.locator('.profile-history-toggle');
    await toggles.first().focus();
    await page.keyboard.press('ArrowDown');
    await expect(toggles.nth(1)).toBeFocused();
    await page.keyboard.press('End');
    await expect(toggles.nth(4)).toBeFocused();
    await page.keyboard.press('ArrowUp');
    await expect(toggles.nth(3)).toBeFocused();
    await page.keyboard.press('Home');
    await expect(toggles.first()).toBeFocused();
    await page.keyboard.press('Enter');
    await expect(toggles.first()).toHaveAttribute('aria-expanded', 'true');
  });

  test('open rounds, their tab and the filters survive a profile re-render', async ({ page }) => {
    await openHistory(page);
    await page.locator('[data-profile-history-filter="result:win"]').click();
    await page.locator('[data-profile-history-toggle="match-5"]').click();
    await page.locator('#profile-history-details-match-5 [data-profile-history-detail-tab="players"]').click();
    await page.evaluate(async () => { const module = await import('/clientProfileRender.js'); module.renderProfileSummary(); });
    await expect(page.locator('.profile-history-row')).toHaveCount(2);
    await expect(page.locator('[data-profile-history-toggle="match-5"]')).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('#profile-history-details-match-5 [data-profile-history-detail-tab="players"]')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#profile-history-details-match-5 .profile-history-player.is-you')).toContainText('YOU');
    await page.locator('[data-profile-history-filter="clear"]').or(page.locator('[data-profile-history-filter="result:all"]')).first().click();
    await expect(page.locator('.profile-history-row')).toHaveCount(5);
  });

  test('the NET WORTH tab draws a line per player only while it is showing and survives a re-render', async ({ page }) => {
    await openHistory(page);
    await page.locator('[data-profile-history-toggle="match-5"]').click();
    const host = page.locator('#profile-history-details-match-5 .profile-history-chart');
    await expect(host.locator('.pc-svg')).toHaveCount(0);
    await page.locator('#profile-history-details-match-5 [data-profile-history-detail-tab="worth"]').click();
    await expect(host.locator('.pc-svg')).toHaveCount(1);
    await expect(host.locator('path.pc-line')).toHaveCount(2);
    await expect(host.locator('.pc-legend')).toContainText('HISTORY OWNER (you)');
    await expect(host.locator('.pc-legend')).toContainText('RIVAL');
    await expect(page.locator('#profile-history-details-match-5 .profile-history-chart-note').first()).toContainText('FINAL NET WORTH');

    await host.focus();
    await page.keyboard.press('ArrowRight');
    await expect(host.locator('.pc-readout')).toBeVisible();
    await expect(host.locator('.pc-live')).toContainText('R1');
    await page.keyboard.press('Escape');
    await expect(host.locator('.pc-readout')).toHaveCount(0);

    await page.evaluate(async () => { const module = await import('/clientProfileRender.js'); module.renderProfileSummary(); });
    await expect(host.locator('.pc-svg')).toHaveCount(1);
    await expect(page.locator('#profile-history-details-match-5 [data-profile-history-detail-tab="worth"]')).toHaveAttribute('aria-selected', 'true');

    await page.locator('#profile-history-details-match-5 [data-profile-history-detail-tab="summary"]').click();
    await expect(host.locator('.pc-svg')).toHaveCount(0);
    const box = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(box).toBe(0);
  });

  test('rounds recorded before net worth was tracked say so instead of drawing an empty chart', async ({ page }) => {
    const old = { ...HISTORY[0], matchId: 'match-old', netWorthTimeline: undefined };
    await openHistory(page, [old, ...HISTORY.slice(1)]);
    await page.locator('[data-profile-history-toggle="match-old"]').click();
    await page.locator('#profile-history-details-match-old [data-profile-history-detail-tab="worth"]').click();
    await expect(page.locator('#profile-history-details-match-old .profile-history-worth-empty')).toHaveText('NOT RECORDED');
    await expect(page.locator('#profile-history-details-match-old .pc-svg')).toHaveCount(0);
  });

  test('legacy rows without details still list and never claim a cash figure', async ({ page }) => {
    await openHistory(page, [{ completedAt: '2026-10-01T12:00:00.000Z', result: 'WIN' }], 1);
    await expect(page.locator('.profile-history-row')).toHaveCount(1);
    await expect(page.locator('.profile-history-row')).toContainText('DETAILS NOT RECORDED');
    await expect(page.locator('.profile-history-strip')).toContainText('BEST CASH');
    await expect(page.locator('.profile-history-strip svg.pc-spark')).toHaveCount(0);
    await expect(page.locator('.profile-history-bulk')).toHaveCount(1);
  });
});
