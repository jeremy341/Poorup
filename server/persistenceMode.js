// Deployment guard for the planned PostgreSQL migration. JSON stores are safe
// for one process; horizontal mode must not be enabled until a transactional
// authoritative adapter is configured.
export function persistenceMode(env = process.env) {
  const requested = String(env?.POORUP_HORIZONTAL_SCALE || '').toLowerCase() === 'true';
  const postgresConfigured = Boolean(String(env?.POORUP_POSTGRES_URL || '').trim());
  return {
    mode: postgresConfigured ? 'postgres-ready' : 'json-single-process',
    horizontalRequested: requested,
    ready: !requested || postgresConfigured,
    error: requested && !postgresConfigured ? 'Horizontal scaling requires POORUP_POSTGRES_URL and the transactional store migration.' : null
  };
}

export function assertPersistenceMode(env = process.env) {
  const mode = persistenceMode(env);
  if (!mode.ready) throw new Error(mode.error);
  return mode;
}
