const MAX_ADMIN_IDS = 32;

function cleanId(value) {
  if (typeof value !== 'string') return '';
  return value.trim().replace(/[^a-zA-Z0-9_-]/g, '').slice(0, 120);
}

export function normalizeAdminIds(value) {
  const values = Array.isArray(value) ? value : String(value || '').split(',');
  return [...new Set(values.map(cleanId).filter(Boolean))].slice(0, MAX_ADMIN_IDS);
}

export function isAdminAccount(accountId, adminIds) {
  const id = cleanId(accountId);
  return Boolean(id && normalizeAdminIds(adminIds).includes(id));
}

export function buildAnalyticsSummary(registry, accountId, adminIds, range = 'hour') {
  if (!isAdminAccount(accountId, adminIds)) return { success: false, status: 403, error: 'Forbidden.' };
  const safeRange = ['hour', 'day', 'week'].includes(String(range)) ? String(range) : 'hour';
  const snapshot = registry?.snapshotMetrics?.(safeRange) || { range: safeRange, generatedAt: new Date(0).toISOString(), metrics: {} };
  return {
    success: true,
    range: snapshot.range || safeRange,
    generatedAt: snapshot.generatedAt,
    metrics: snapshot.metrics && typeof snapshot.metrics === 'object' ? snapshot.metrics : {},
  };
}

export { MAX_ADMIN_IDS };
