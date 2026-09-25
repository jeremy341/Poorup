// Match history currently has a durable MatchStore record and a legacy
// AccountStore snapshot. Keep the compatibility merge in one read adapter so
// every reader applies the same precedence and ordering until migration is
// complete.

function recordsOrEmpty(value) {
  return Array.isArray(value) ? value : [];
}

function mergeMatchRecords(legacyRecords = [], storedRecords = []) {
  const merged = new Map();
  [...recordsOrEmpty(legacyRecords), ...recordsOrEmpty(storedRecords)].forEach(record => {
    if (!record?.matchId) return;
    // MatchStore is the newer source during the compatibility window, so it
    // intentionally overwrites a legacy record with the same match ID.
    merged.set(record.matchId, record);
  });
  return [...merged.values()]
    .sort((a, b) => String(b.completedAt || '').localeCompare(String(a.completedAt || '')));
}

function listMatchRecordsForAccount({ accountId, accountStore, matchStore, limit = 50 } = {}) {
  if (!accountId) return [];
  const boundedLimit = Math.max(1, Math.min(100, Number(limit) || 50));
  const storedRecords = matchStore?.listForAccount?.(accountId, boundedLimit) || [];
  const legacyRecords = accountStore?.getMatchHistory?.(accountId) || [];
  return mergeMatchRecords(legacyRecords, storedRecords).slice(0, boundedLimit);
}

export { listMatchRecordsForAccount, mergeMatchRecords };
