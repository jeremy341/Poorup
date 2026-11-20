// HTTP-layer security policy: response headers, request guards (method, Host), a guard for files that must never be served, and
// connection timeouts. server.js wires these in once. Policy write-up: docs/security-headers.md. Tests: server/http-security-headers.test.js.
import { answerHttpError } from './httpErrors.js';

// PATCH and DELETE are used by the AI provider admin routes (aiProviderRoutes.js); nothing else in the app needs another method.
export const ALLOWED_METHODS = Object.freeze(['GET', 'HEAD', 'POST', 'PATCH', 'DELETE', 'OPTIONS']);
const HEALTH_PATHS = new Set(['/healthz', '/readyz']);
const SOCKET_PATH = '/socket.io/';
// A Host header is a hostname or IPv4/bracketed IPv6 with an optional port. Anything else is malformed before it is compared to anything.
const HOST_SYNTAX = /^(?:\[[0-9a-f:.]+\]|[a-z0-9._-]+)(?::\d{1,5})?$/i;
// Test suites, source maps and editor or backup copies. None of them is part of the client, and a test file leaks its fixtures.
const PRIVATE_STATIC = /\.(?:test\.(?:m?js|cjs)|map|bak|orig|old|swp)$|~$/i;
const HSTS = 'max-age=31536000; includeSubDomains';
const PERMISSIONS_POLICY = 'camera=(), microphone=(), geolocation=(), payment=(), usb=(), bluetooth=(), serial=(), accelerometer=(), gyroscope=(), magnetometer=()';

// Directive order is not significant; each one is here for a reason noted in docs/security-headers.md. The client has no inline
// <script> or on* attributes and no <style> elements (checked by the test suite); style="" attributes are still used by the markup,
// so inline style attributes stay allowed while inline style elements are not.
export function buildContentSecurityPolicy(connectSources = ["'self'"]) {
  return [
    "default-src 'self'",
    "script-src 'self'",
    "script-src-attr 'none'",
    "style-src 'self' 'unsafe-inline'",
    "style-src-elem 'self'",
    "style-src-attr 'unsafe-inline'",
    "img-src 'self' data:",
    "font-src 'self'",
    "media-src 'self'",
    `connect-src ${connectSources.join(' ')}`,
    "manifest-src 'self'",
    "worker-src 'none'",
    "frame-src 'none'",
    "object-src 'none'",
    "base-uri 'self'",
    "form-action 'self'",
    "frame-ancestors 'none'",
  ].join('; ');
}

export function securityHeaders({ connectSources } = {}) {
  const csp = buildContentSecurityPolicy(connectSources);
  return (req, res, next) => {
    res.setHeader('Content-Security-Policy', csp);
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('X-Permitted-Cross-Domain-Policies', 'none');
    res.setHeader('Referrer-Policy', 'same-origin');
    // Process isolation: keeps this app's windows and documents out of other sites' reach, and blocks cross-site reads of its responses.
    res.setHeader('Cross-Origin-Opener-Policy', 'same-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Origin-Agent-Cluster', '?1');
    res.setHeader('Permissions-Policy', PERMISSIONS_POLICY);
    // HSTS is a claim about an HTTPS origin. req.secure is true only for a direct TLS connection or, with POORUP_TRUST_PROXY_HOPS set,
    // a proxy hop that reports https. Browsers ignore HSTS over plain HTTP anyway, so it is not sent there.
    if (req.secure) res.setHeader('Strict-Transport-Security', HSTS);
    return next();
  };
}

// Socket.IO answers its own requests before Express sees them, so its responses (including the 403 for a refused origin) need their
// own headers. The listener is prepended so the headers are set before socket.io writes the response head.
export function attachSocketHttpHeaders(server) {
  server.prependListener('request', (req, res) => {
    if (!String(req.url || '').startsWith(SOCKET_PATH)) return;
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy', "default-src 'none'; frame-ancestors 'none'");
  });
  return server;
}

// Slowloris: a client that trickles headers or a body is cut off well before Node's defaults (60 s for headers, 300 s for the whole
// request). Both timers cover receiving the request only; a response that is still being produced (a long poll) is not interrupted.
// Node checks these timers once per connectionsCheckingInterval (30 s by default), so the interval is set to match the limits.
export function hardenHttpServer(server, { headersTimeoutMs = 15_000, requestTimeoutMs = 30_000, checkIntervalMs = 5_000 } = {}) {
  server.headersTimeout = headersTimeoutMs;
  server.requestTimeout = requestTimeoutMs;
  server.connectionsCheckingInterval = checkIntervalMs;
  return server;
}

export function parseAllowedHosts(value) {
  return String(value || '')
    .split(',')
    .map(entry => hostnameOf(entry.trim()))
    .filter(Boolean);
}

function hostnameOf(value) {
  try {
    return new URL(`http://${value}`).hostname.toLowerCase();
  } catch {
    return '';
  }
}

// Case-sensitive on purpose: "get" is not a method the router would route either.
export function isAllowedMethod(method) {
  return ALLOWED_METHODS.includes(method);
}

export function isPrivateStaticPath(requestPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(String(requestPath || ''));
  } catch {
    return false;
  }
  return PRIVATE_STATIC.test(decoded);
}

function guardMethod(errorPage) {
  return (req, res, next) => {
    if (isAllowedMethod(req.method)) return next();
    res.setHeader('Allow', ALLOWED_METHODS.join(', '));
    return answerHttpError(req, res, 405, errorPage);
  };
}

// Host validation. A malformed Host is refused always. When POORUP_ALLOWED_HOSTS lists hostnames, any other Host is refused too,
// except on the health probes (a probe may address the pod by its IP). Forwarded host headers are never read here.
function guardHost({ allowedHosts, errorPage }) {
  return (req, res, next) => {
    const raw = req.headers.host;
    if (raw === undefined) return next();
    if (!HOST_SYNTAX.test(raw)) return answerHttpError(req, res, 400, errorPage);
    if (!allowedHosts.length || HEALTH_PATHS.has(req.path)) return next();
    if (allowedHosts.includes(hostnameOf(raw))) return next();
    return answerHttpError(req, res, 421, errorPage);
  };
}

function guardPrivateStatic(errorPage) {
  return (req, res, next) => {
    if (!isPrivateStaticPath(req.path)) return next();
    return answerHttpError(req, res, 404, errorPage);
  };
}

// Everything that runs before static files and routes, in order. Mount with app.use(...createSecurityMiddleware(...)).
export function createSecurityMiddleware({ connectSources, allowedHosts = '', errorPage } = {}) {
  return [
    securityHeaders({ connectSources }),
    guardMethod(errorPage),
    guardHost({ allowedHosts: parseAllowedHosts(allowedHosts), errorPage }),
    guardPrivateStatic(errorPage),
  ];
}
