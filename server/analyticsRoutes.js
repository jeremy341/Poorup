// Admin analytics JSON endpoints (summary, balance, drilldown). Each answers only to an admin account and is never cached.
import { buildAnalyticsBalance, buildAnalyticsDrilldown, buildAnalyticsSummary, setAnalyticsNoStoreHeaders } from './analyticsApi.js';

export function registerAnalyticsRoutes(app, { requestAccount, accountStore, metrics, analyticsRollupStore, adminIds }) {
  // An analytics call can be the first to trade a legacy bearer token for a cookie
  // session; the cookie must reach the caller or the token is spent for nothing.
  function analyticsAccount(req, res) {
    const account = requestAccount(req) || accountStore.sessionAccount(req.get('x-poorup-session-token') || '');
    if (req.sessionCookie) res.setHeader('Set-Cookie', req.sessionCookie);
    return account;
  }
  app.get('/admin/analytics/summary', (req, res) => {
    const account = analyticsAccount(req, res);
    const result = buildAnalyticsSummary(metrics, account?.id, adminIds, req.query?.range);
    setAnalyticsNoStoreHeaders(res);
    return res.status(result.success ? 200 : result.status).json(result);
  });
  app.get('/admin/analytics/balance', (req, res) => {
    const account = analyticsAccount(req, res);
    const result = buildAnalyticsBalance({
      rollup: analyticsRollupStore,
      registry: metrics,
      accountId: account?.id,
      adminIds: adminIds,
      query: req.query
    });
    setAnalyticsNoStoreHeaders(res);
    return res.status(result.success ? 200 : result.status).json(result);
  });
  app.get('/admin/analytics/drilldown', (req, res) => {
    const account = analyticsAccount(req, res);
    const result = buildAnalyticsDrilldown({
      rollup: analyticsRollupStore,
      accountId: account?.id,
      adminIds: adminIds,
      query: req.query
    });
    setAnalyticsNoStoreHeaders(res);
    return res.status(result.success ? 200 : result.status).json(result);
  });
}
