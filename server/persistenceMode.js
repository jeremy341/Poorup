// Deployment guard for the planned PostgreSQL migration. JSON stores are safe
// for one process; horizontal mode must not be enabled until a transactional
// authoritative adapter is configured.
function horizontalScaleRequested(env) {
  return String(env?.POORUP_HORIZONTAL_SCALE || '').toLowerCase() === 'true';
}

function postgresConfigured(env, adapter) {
  if (!String(env?.POORUP_POSTGRES_URL || '').trim()) return false;
  if (String(env?.POORUP_PERSISTENCE_ADAPTER || '').trim().toLowerCase() !== 'postgres') return false;
  // Environment flags are claims only. Horizontal mode requires the actual
  // transactional adapter instance and a synchronous startup health result.
  if (!adapter || typeof adapter.transaction !== 'function' || typeof adapter.healthCheck !== 'function') return false;
  try {
    const health = adapter.healthCheck();
    return health === true || health?.ready === true;
  } catch {
    return false;
  }
}

function persistenceError(requested, configured) {
  if (requested && !configured) return 'Horizontal scaling requires POORUP_POSTGRES_URL plus POORUP_PERSISTENCE_ADAPTER=postgres and a real, health-checked transactional adapter; URL-only settings are fail-closed.';
  return null;
}

export function persistenceMode(env = process.env, adapter = null) {
  const requested = horizontalScaleRequested(env);
  const configured = postgresConfigured(env, adapter);
  return {
    mode: configured ? 'postgres-ready' : 'json-single-process',
    horizontalRequested: requested,
    ready: !requested || configured,
    error: persistenceError(requested, configured)
  };
}

export function assertPersistenceMode(env = process.env, adapter = null) {
  const mode = persistenceMode(env, adapter);
  if (!mode.ready) throw new Error(mode.error);
  return mode;
}

// Non-secret readiness projection for bootstrap/readiness routes. Callers
// supply actual store and backup verification results; no credentials, paths,
// or raw adapter diagnostics cross this boundary.
export function buildReadinessProjection({ storeLoaded = false, backupFresh = false, maintenance = 'normal' } = {}) {
  const state = ['normal', 'maintenance', 'draining'].includes(maintenance) ? maintenance : 'maintenance';
  const loaded = storeLoaded === true;
  const fresh = backupFresh === true;
  return { ready: loaded && fresh && state === 'normal', storeLoaded: loaded, backupFresh: fresh, maintenance: state };
}
