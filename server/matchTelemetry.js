// Telemetry rows a finished or stalled match writes to the telemetry store, plus the rule that classifies a bot decision as a model failure.

export function annotateMatchAchievements(matchRecord, candidates = []) {
  if (!matchRecord || !Array.isArray(matchRecord.participants)) return matchRecord;
  matchRecord.participants.forEach((participant) => {
    const unlocked = candidates
      .filter(candidate => candidate.accountId === participant.accountId)
      .map(candidate => candidate.achievementId)
      .filter(id => typeof id === 'string');
    participant.achievementsUnlocked = [...new Set(unlocked)].slice(0, 32);
    participant.mythicalUnlocked = candidates.some(candidate => candidate.accountId === participant.accountId && candidate.rarity === 'MYTHICAL');
  });
  return matchRecord;
}

export function recordMatchTelemetry(context) {
  const { telemetryStore, matchRecord, telemetryVersions } = context;
  telemetryStore?.record('match-complete', {
    playerCount: matchRecord.playerCount,
    roundCount: matchRecord.roundCount,
    ...(Number.isFinite(Number(matchRecord.durationSeconds)) ? { durationSeconds: Math.max(0, Math.floor(Number(matchRecord.durationSeconds))) } : {}),
    botOnly: matchRecord.participants.every(participant => !participant.accountId)
  }, telemetryVersions);
}

export function recordLoggedTelemetry(context) {
  const { telemetryStore, room, telemetryVersions } = context;
  (room.game.telemetryLog || []).forEach(entry => {
    telemetryStore?.record(entry.kind, { ...(entry.data || {}), roundNumber: entry.roundNumber }, { ...telemetryVersions, eventId: entry.data?.eventId });
  });
}

function recordMarketTelemetry(context) {
  const { telemetryStore, matchRecord, telemetryVersions } = context;
  telemetryStore?.record('market-volatility', {
    marketRows: matchRecord.market.length,
    marketTrades: matchRecord.participants.reduce((sum, participant) => sum + (Number(participant.marketTrades) || 0), 0)
  }, telemetryVersions);
}

function recordBankruptcyTelemetry(context) {
  const { telemetryStore, matchRecord, telemetryVersions } = context;
  const bankruptcies = matchRecord.participants.filter(participant => participant.bankrupt).length;
  if (bankruptcies) telemetryStore?.record('bankruptcy', { count: bankruptcies }, telemetryVersions);
}

function recordAchievementTelemetry(context) {
  const { telemetryStore, candidates, telemetryVersions, matchRecord } = context;
  const botOnly = matchRecord?.botOnly === true;
  candidates.slice(0, 32).forEach(candidate => telemetryStore?.record('achievement-unlocked', { rarity: candidate.rarity, achievementId: candidate.achievementId, botOnly }, telemetryVersions));
}

// A deterministic answer is flagged `fallback` even when the room chose house
// policy on purpose (no-AI rooms, auction/phase rules). Those are not failures
// of the model, so they never count toward the fallback rate.
const BY_DESIGN_HOUSE_REASONS = new Set(['no-ai-mode', 'auction-policy', 'phase-resolution', 'deterministic-advisor', 'shadow-mode', 'deterministic']);

// Which engine a bot decision belongs to, from the room's brain setting:
//   aiRouted   the room asked for AI (botMode 'ai', provider 'ai') or not
//              (botMode 'no-ai', provider 'deterministic'). One match therefore
//              lands in exactly one bot group, so per-group match counts add up.
//   counted    adds to `decisions`: every house decision in a no-AI room, and
//              only the decisions the model was actually asked in an AI room.
//   failed     the model was asked and the house engine answered instead.
export function classifyBotDecision(decision = {}) {
  const brain = decision.brain === 'no-ai' || decision.brain === 'ai' ? decision.brain : null;
  const botMode = decision.botMode || brain || (decision.provider === 'ai' ? 'ai' : 'no-ai');
  const aiRouted = botMode === 'ai';
  const answeredByModel = decision.provider === 'ai';
  const askedModel = aiRouted && (answeredByModel || (decision.fallback === true && !BY_DESIGN_HOUSE_REASONS.has(String(decision.fallbackReason || ''))));
  return {
    botMode,
    provider: aiRouted ? 'ai' : 'deterministic',
    counted: aiRouted ? askedModel : true,
    failed: askedModel && !answeredByModel
  };
}

// The live counterpart of the rollup's fallback rate: one increment per decision the model was asked and the house engine answered
// instead, classified as the rollup does so deliberate house policy never counts. Called once per recorded decision trace;
// metrics must never affect a bot's turn.
export function noteBotFallback(metrics, decision) {
  if (!classifyBotDecision(decision).failed) return false;
  try { metrics?.incrementMetric?.('bot-fallbacks', { scope: 'ai' }); } catch { /* best effort */ }
  return true;
}

export function recordBotTelemetry(context) {
  const { telemetryStore, matchRecord, telemetryVersions } = context;
  const botOnly = matchRecord.botOnly === true || (Array.isArray(matchRecord.participants) && matchRecord.participants.length > 0 && matchRecord.participants.every(participant => !participant.accountId));
  const seenGroups = new Set();
  (matchRecord.botDecisions || []).slice(-200).forEach(decision => {
    const routing = classifyBotDecision(decision);
    const group = `${routing.botMode}|${routing.provider}`;
    const firstOfMatch = !seenGroups.has(group);
    seenGroups.add(group);
    telemetryStore?.record('bot-outcome', {
      provider: routing.provider,
      botMode: routing.botMode,
      botOnly,
      fallback: routing.failed,
      success: decision.success,
      phase: decision.phase,
      actionId: decision.actionId,
      decisions: routing.counted ? 1 : 0,
      ...(firstOfMatch ? { match: true } : {})
    }, telemetryVersions);
  });
}

export function recordMatchStartTelemetry({ telemetryStore, room, telemetryVersions = {} } = {}) {
  const marker = room?.game?.startedAt || true;
  if (!telemetryStore || !room?.game?.started || room.analyticsMatchStartRecorded === marker) return false;
  const result = telemetryStore.record('match-start', { roundNumber: Math.max(0, Math.floor(Number(room.game.roundNumber) || 0)) }, telemetryVersions);
  if (result?.recorded) { room.analyticsMatchStartRecorded = marker; return true; }
  return false;
}

function stalledTelemetryMarker(room) {
  if (!room?.game?.started) return null;
  return room.game.startedAt || true;
}

function recordStalledOnce({ telemetryStore, room, marker, reasonCode, telemetryVersions }) {
  const payload = {
    roundNumber: Math.max(0, Math.floor(Number(room.game.roundNumber) || 0)),
    reasonCode: String(reasonCode || 'unknown').slice(0, 80)
  };
  const result = telemetryStore.record('match-stalled', payload, telemetryVersions);
  if (result?.recorded) { room.analyticsMatchStalledRecorded = marker; return true; }
  return false;
}

export function recordMatchStalledTelemetry({ telemetryStore, room, telemetryVersions = {}, reasonCode = 'room-ended-without-settlement' } = {}) {
  if (!telemetryStore) return false;
  const marker = stalledTelemetryMarker(room);
  if (!marker) return false;
  if (room.analyticsMatchStalledRecorded === marker) return false;
  return recordStalledOnce({ telemetryStore, room, marker, reasonCode, telemetryVersions });
}

const ROOM_TELEMETRY_VERSION_READERS = [
  ['seasonId', room => room?.game?.seasonId || room?.seasonId],
  ['rulesetRevision', room => room?.ruleset?.rulesetRevision || room?.settings?.rulesetRevision],
  ['balanceRevision', room => room?.ruleset?.balanceRevision || room?.settings?.balanceRevision],
  ['boardVariant', room => room?.ruleset?.boardVariant || room?.settings?.boardVariant],
  ['marketComplexity', readRoomMarketComplexity]
];

function readRoomMarketComplexity(room) {
  return room?.ruleset?.effectiveSettings?.marketComplexity || room?.settings?.marketComplexity;
}

export function roomTelemetryVersions(room) {
  return Object.fromEntries(ROOM_TELEMETRY_VERSION_READERS.map(([key, read]) => [key, read(room)]));
}

function settlementTelemetryMatchId(matchRecord, room) {
  const matchId = String(matchRecord?.matchId || '').trim();
  if (!matchId) return false;
  if (room?.analyticsTelemetryMatchId === matchId) return true;
  if (room) room.analyticsTelemetryMatchId = matchId;
  return false;
}

function settlementTelemetryVersions(matchRecord, room) {
  return {
    rulesetRevision: matchRecord.rulesetRevision,
    balanceRevision: matchRecord.balanceRevision,
    boardVariant: matchRecord.boardVariant,
    // The match-start row of the same match carries the market complexity, so
    // the settlement rows carry it too: without it a non-basic match is split
    // over two rollup rows.
    marketComplexity: matchRecord.marketComplexity || readRoomMarketComplexity(room)
  };
}

function recordSettlementTelemetryRows(telemetryContext) {
  recordMatchStartTelemetry(telemetryContext);
  recordMatchTelemetry(telemetryContext);
  recordLoggedTelemetry(telemetryContext);
  recordMarketTelemetry(telemetryContext);
  recordBankruptcyTelemetry(telemetryContext);
  recordAchievementTelemetry(telemetryContext);
  recordBotTelemetry(telemetryContext);
}

export function recordMatchTelemetryOnce(context) {
  const { telemetryStore, room, matchRecord, candidates } = context;
  if (settlementTelemetryMatchId(matchRecord, room)) return false;
  recordSettlementTelemetryRows({
    telemetryStore,
    room,
    matchRecord,
    candidates,
    telemetryVersions: settlementTelemetryVersions(matchRecord, room)
  });
  return true;
}
