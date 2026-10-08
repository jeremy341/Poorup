import { BOT_MOVEMENT_STEP_MS, HUMAN_MOVEMENT_STEP_MS, LANDING_DELAY_MS, ROLL_LEAD_MS } from '../public/gamePresentationTiming.js';

function cashSnapshot(game) {
  return new Map(game.players.map(player => [player.id, Number(player.cash) || 0]));
}

export function recordPresentationMovement(game, player, to, { cause = 'dice', steps, direction = 1, teleport = false } = {}) {
  const record = game._activePresentation;
  if (!record || record.actorId !== player.id) return;
  const size = game.tiles.length;
  const from = player.position;
  const count = teleport ? 1 : Math.max(0, Math.min(size * 4, Number.isInteger(steps) ? steps : ((to - from) * direction + size) % size));
  const path = teleport ? [to] : Array.from({ length: count }, (_, i) => (from + direction * (i + 1) + size * 4) % size);
  if (path.length) record.segments.push({ from, to, path, cause, teleport, stepMs: player.isBot ? BOT_MOVEMENT_STEP_MS : HUMAN_MOVEMENT_STEP_MS });
}

export function recordPresentationCash(game, cause, pathIndex = null) {
  const record = game._activePresentation;
  if (!record) return;
  const deltas = game.players.map(player => ({ playerId: player.id, amount: (Number(player.cash) || 0) - (record.cashCheckpoint.get(player.id) || 0) }))
    .filter(delta => delta.amount !== 0);
  record.cashCheckpoint = cashSnapshot(game);
  if (deltas.length) record.cashEvents.push({ cause, segmentIndex: Math.max(0, record.segments.length - 1), pathIndex, deltas });
}

export function withRollPresentation(game, player, action) {
  const startedAt = (game.presentationClock || Date.now)();
  const previousSequence = game.diceRollSequence;
  const record = { actorId: player.id, segments: [], cashEvents: [], cashCheckpoint: cashSnapshot(game) };
  game._activePresentation = record;
  try {
    return action();
  } finally {
    if (game.diceRollSequence !== previousSequence) finalizePresentation(game, player, record, startedAt);
    game._activePresentation = null;
  }
}

function finalizePresentation(game, player, record, startedAt) {
    recordPresentationCash(game, 'landing');
    let offsetMs = ROLL_LEAD_MS;
    for (const segment of record.segments) {
      segment.offsetMs = offsetMs;
      segment.durationMs = segment.path.length * segment.stepMs;
      offsetMs += segment.durationMs;
    }
    const durationMs = offsetMs + LANDING_DELAY_MS;
    for (const event of record.cashEvents) {
      const segment = record.segments[event.segmentIndex];
      event.atMs = event.pathIndex != null && segment
        ? segment.offsetMs + (event.pathIndex + 1) * segment.stepMs : durationMs;
    }
    game.presentation = {
      id: game.diceRollSequence,
      gameStartedAt: game.startedAt,
      actorId: player.id,
      dice: [...game.lastDice],
      startedAt, readyAt: startedAt + durationMs,
      segments: record.segments, cashEvents: record.cashEvents,
    };
}
