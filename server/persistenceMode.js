// Deployment guard for the planned PostgreSQL migration. JSON stores are safe
// for one process; horizontal mode must not be enabled until a transactional
// authoritative adapter is configured.
function horizontalScaleRequested(env) {
  return String(env?.POORUP_HORIZONTAL_SCALE || '').toLowerCase() === 'true';
}

function postgresConfigured(env) {
  return Boolean(String(env?.POORUP_POSTGRES_URL || '').trim())
    && String(env?.POORUP_PERSISTENCE_ADAPTER || '').trim().toLowerCase() === 'postgres'
    // A URL and adapter name are configuration claims, not proof that a
    // transactional adapter was instantiated and health-checked.
    && String(env?.POORUP_TRANSACTIONAL_ADAPTER_READY || '').trim().toLowerCase() === 'true';
}

function persistenceError(requested, configured) {
  if (requested && !configured) return 'Horizontal scaling requires POORUP_POSTGRES_URL plus POORUP_PERSISTENCE_ADAPTER=postgres and a real, health-checked transactional adapter; URL-only settings are fail-closed.';
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
