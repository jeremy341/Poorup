import { test, expect } from '@playwright/test';

test('profile distinguishes legacy and verified Patrol records', async ({ page }) => {
  await page.goto('/');
  await page.evaluate(async () => {
    const { state } = await import('/clientState.js');
    const { renderProfileStatistics } = await import('/clientProfileRender.js');
    state.account = { account: { id: 'a', username: 'test', stats: { patrolBest: 900, patrolAceRuns: 3, patrolVerifiedBest: 125, patrolVerifiedAceRuns: 1 } } };
    renderProfileStatistics();
  });
  const panel = page.locator('#profile-stat-panel-economy');
  await expect(panel).toContainText('PATROL VERIFIED BEST');
  await expect(panel).toContainText('PATROL LEGACY BEST');
  await expect(panel).toContainText('PATROL VERIFIED ACE RUNS');
  await expect(panel).toContainText('PATROL LEGACY ACE RUNS');
});
