// Deployment-only server configuration. Runtime defaults stay permissive for
// local play, while a hosted instance can restrict browser origins explicitly.
export function parseAllowedOrigins(env = process.env) {
  return String(env?.POORUP_ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .map(normalizeOrigin)
    .filter(Boolean);
}

function normalizeOrigin(value) {
  if (value === '*') return value;
  try {
    const url = new URL(value);
    if (!['http:', 'https:'].includes(url.protocol)) return '';
    if (url.pathname !== '/' || url.search || url.hash || url.username || url.password) return '';
    return url.origin;
  } catch {
    return '';
  }
}

function hasMalformedOriginList(env = process.env) {
  const raw = String(env?.POORUP_ALLOWED_ORIGINS || '').split(',').map(origin => origin.trim()).filter(Boolean);
  return raw.some(origin => !normalizeOrigin(origin));
}

export function isOriginAllowed(origin, configuredOrigins = []) {
  if (!origin) return true;
  if (!configuredOrigins.length) return true;
  return configuredOrigins.includes('*') || configuredOrigins.includes(origin);
}

// Socket.IO's allowRequest must apply the same exact-origin policy to every
// transport, including direct WebSocket upgrades. Wildcards are intentionally
// excluded from this admission seam.
export function isAllowedSocketOrigin(origin, allowedOrigins = []) {
  if (!origin) return true;
  const normalized = normalizeOrigin(origin);
  if (!normalized || !Array.isArray(allowedOrigins) || !allowedOrigins.length) return false;
  return allowedOrigins.filter(candidate => candidate !== '*').includes(normalized);
}

// Resolve a socket peer only through an explicitly trusted proxy hop count;
// otherwise attacker-controlled forwarding headers cannot mint fresh limiter
// identities on every reconnect.
export function resolveClientAddress(handshake = {}, trustedProxyHops = 0) {
  const direct = String(handshake.address || handshake.request?.socket?.remoteAddress || handshake.socket?.remoteAddress || 'unknown').trim();
  const hops = Math.max(0, Math.floor(Number(trustedProxyHops) || 0));
  if (!hops) return direct.slice(0, 80);
  const forwarded = handshake.headers?.['x-forwarded-for']
    || handshake.request?.headers?.['x-forwarded-for']
    || handshake.request?.headers?.['X-Forwarded-For'];
  const chain = String(forwarded || '').split(',').map(value => value.trim()).filter(Boolean);
  if (!chain.length) return direct.slice(0, 80);
  const index = Math.max(0, chain.length - hops - 1);
  return String(chain[index] || direct).slice(0, 80);
}

export function createCorsOrigin(env = process.env) {
  const configuredOrigins = parseAllowedOrigins(env);
  const production = String(env?.NODE_ENV || '').trim().toLowerCase() === 'production';
  return (origin, callback) => {
    const allowed = configuredOrigins.length
      ? isAllowedSocketOrigin(origin, configuredOrigins)
      : (!production || !origin);
    callback(null, allowed);
  };
}

export function assertProductionCors(env = process.env) {
  const production = String(env?.NODE_ENV || '').trim().toLowerCase() === 'production';
  const origins = parseAllowedOrigins(env);
  if (production && (!origins.length || origins.includes('*') || hasMalformedOriginList(env))) throw new Error('POORUP_ALLOWED_ORIGINS must be configured with valid origins in production.');
  return true;
}
