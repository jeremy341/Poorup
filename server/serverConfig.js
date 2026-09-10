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

export function createCorsOrigin(env = process.env) {
  const configuredOrigins = parseAllowedOrigins(env);
  const production = String(env?.NODE_ENV || '').trim().toLowerCase() === 'production';
  return (origin, callback) => {
    const allowed = configuredOrigins.length
      ? isOriginAllowed(origin, configuredOrigins)
      : (!production || !origin);
    callback(null, allowed);
  };
}

export function assertProductionCors(env = process.env) {
  const production = String(env?.NODE_ENV || '').trim().toLowerCase() === 'production';
  if (production && (!parseAllowedOrigins(env).length || hasMalformedOriginList(env))) throw new Error('POORUP_ALLOWED_ORIGINS must be configured with valid origins in production.');
  return true;
}
