// Per-identity budgets for the abuse-prone actions that the global socket and HTTP limiters do not single out: account writes and exports,
// room creation, and the HTTP routes that send mail, check tokens or aggregate data. Limits come from readAbuseLimits (serverConfig.js),
// so tests and operators override them the same way. Every budget keeps its state in a bounded map (rateBuckets.js).
import { createHttpRateLimiter } from './httpRateLimiter.js';
import { createActionBudget } from './rateBuckets.js';
import { readAbuseLimits } from './serverConfig.js';

// The socket budgets. Each one is created once per runtime and shared by every socket, so a reconnect cannot reset it.
export function createAbuseBudgets(limits = readAbuseLimits({})) {
  const budgets = {};
  for (const [name, { limit, windowMs }] of Object.entries(limits)) {
    budgets[name] = createActionBudget({ limit, windowMs });
  }
  return budgets;
}

// HTTP route budgets: the global per-IP limiter still applies on top of these. A route is matched by path prefix, case-insensitively,
// because Express routing is case-insensitive by default.
const HTTP_ROUTE_BUDGETS = Object.freeze({
  recoveryRequest: ['/account/recovery/request'],
  recoveryVerify: ['/account/recovery/verify', '/account/recovery/reset'],
  accountExport: ['/account/export'],
  profileWrite: ['/account/profile'],
  internalToken: ['/internal/maintenance', '/internal/retention/run'],
  analytics: ['/admin/analytics'],
});

function matchesRoute(requestPath, prefix) {
  return requestPath === prefix || requestPath.startsWith(`${prefix}/`);
}

export function createHttpRouteBudgets({ limits = readAbuseLimits({}), trustProxy = false } = {}) {
  const routes = Object.entries(HTTP_ROUTE_BUDGETS).flatMap(([name, prefixes]) => {
    const budget = limits[name] || {};
    const limiter = createHttpRateLimiter({ max: budget.limit, windowMs: budget.windowMs, trustProxy });
    return prefixes.map(prefix => ({ prefix, limiter }));
  });
  return function httpRouteBudget(req, res, next) {
    const requestPath = String(req.path || '').toLowerCase();
    const route = routes.find(({ prefix }) => matchesRoute(requestPath, prefix));
    if (!route) return next();
    return route.limiter(req, res, next);
  };
}
