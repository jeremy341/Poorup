// Deployment guard for the planned PostgreSQL migration. JSON stores are safe
// for one process; horizontal mode must not be enabled until a transactional
// authoritative adapter is configured.
function horizontalScaleRequested(env) {
  return String(env?.POORUP_HORIZONTAL_SCALE || '').toLowerCase() === 'true';
}

function postgresConfigured(env) {
  return Boolean(String(env?.POORUP_POSTGRES_URL || '').trim());
}

function persistenceError(requested, configured) {
  if (requested && !configured) return 'Horizontal scaling requires POORUP_POSTGRES_URL and the transactional store migration.';
  return null;
}

export function persistenceMode(env = process.env) {
  const requested = horizontalScaleRequested(env);
  const configured = postgresConfigured(env);
  return {
    mode: configured ? 'postgres-ready' : 'json-single-process',
    horizontalRequested: requested,
    ready: !requested || configured,
    error: persistenceError(requested, configured)
  };
}

export function assertPersistenceMode(env = process.env) {
  const mode = persistenceMode(env);
  if (!mode.ready) throw new Error(mode.error);
  return mode;
}
