// Roll presentation: while a dice roll resolves, record every pawn move and cash change, then publish them on game.presentation
// with millisecond offsets so every client can replay the roll on the same timeline (pacing constants are shared with the client
// in public/gamePresentationTiming.js). It describes what happened; it never changes game state.
import { BOT_MOVEMENT_STEP_MS, HUMAN_MOVEMENT_STEP_MS, LANDING_DELAY_MS, ROLL_LEAD_MS, walkStepDurationsMs } from '../public/gamePresentationTiming.js';

function cashSnapshot(game) {
  return new Map(game.players.map(player => [player.id, Number(player.cash) || 0]));
}

// Longest path a single move can animate, as a multiple of the board length (guards against a runaway step count).
const MAX_LAPS_PER_MOVE = 4;

export function recordPresentationMovement(game, player, to, { cause = 'dice', steps, direction = 1, teleport = false } = {}) {
  const record = game._activePresentation;
  if (!record || record.actorId !== player.id) return;
  const size = game.tiles.length;
  const from = player.position;
  const maxSteps = size * MAX_LAPS_PER_MOVE;
  const count = teleport ? 1 : Math.max(0, Math.min(maxSteps, Number.isInteger(steps) ? steps : ((to - from) * direction + size) % size));
  const path = teleport ? [to] : Array.from({ length: count }, (_, i) => (from + direction * (i + 1) + maxSteps) % size);
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

// Turns the recorded moves into a timeline: each segment starts when the previous one ends, and each cash change is
// stamped with the moment its pawn reaches the tile that caused it (or the end of the roll if it has no tile).
function finalizePresentation(game, player, record, startedAt) {
  recordPresentationCash(game, 'landing');
  let offsetMs = ROLL_LEAD_MS;
  const stepEnds = new Map();
  for (const segment of record.segments) {
    const ends = walkStepDurationsMs(segment.path.length, segment.stepMs);
    segment.offsetMs = offsetMs;
    // Accelerated pacing: full pace for the opening tiles, faster beyond, a longer settle on the landing tile.
    // The client renders the same curve; cash offsets follow the real step ends.
    segment.pacing = 'accelerated';
    segment.durationMs = ends.reduce((sum, ms) => sum + ms, 0);
    stepEnds.set(segment, ends);
    offsetMs += segment.durationMs;
  }
  const durationMs = offsetMs + LANDING_DELAY_MS;
  for (const event of record.cashEvents) {
    const segment = record.segments[event.segmentIndex];
    const ends = segment ? stepEnds.get(segment) : null;
    event.atMs = event.pathIndex != null && ends
      ? segment.offsetMs + ends[event.pathIndex] : durationMs;
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
