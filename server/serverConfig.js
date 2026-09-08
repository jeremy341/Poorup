// Deployment-only server configuration. Runtime defaults stay permissive for
// local play, while a hosted instance can restrict browser origins explicitly.
export function parseAllowedOrigins(env = process.env) {
  return String(env?.POORUP_ALLOWED_ORIGINS || '')
    .split(',')
    .map(origin => origin.trim())
    .filter(Boolean);
}

export function isOriginAllowed(origin, configuredOrigins = []) {
  if (!origin) return true;
  if (!configuredOrigins.length) return true;
  return configuredOrigins.includes('*') || configuredOrigins.includes(origin);
}

export function createCorsOrigin(env = process.env) {
  const configuredOrigins = parseAllowedOrigins(env);
  return (origin, callback) => callback(null, isOriginAllowed(origin, configuredOrigins));
}
