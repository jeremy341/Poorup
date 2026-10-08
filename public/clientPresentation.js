import { DICE_ROLL_MS } from './gamePresentationTiming.js';

// The live snapshot remains authoritative. This queue owns only presentation.
export function createPresentationQueue({ now = Date.now, setTimer = setTimeout, clearTimer = clearTimeout, onChange = () => {}, announceTotal = () => {}, setRolling = () => {}, animateSegment = () => Promise.resolve(), cancelMovement = () => {} } = {}) {
  let room = null;
  let gameGeneration = null;
  let lastId = 0;
  let generation = 0;
  let running = false;
  const pending = [];
  const positions = new Map();
  const waits = new Map();
  let idleResolvers = [];

  function presentationFinished(queue, currentTime) {
    const lastEntry = queue.at(-1);
    return Boolean(lastEntry && currentTime >= lastEntry.record.readyAt);
  }

  function reconcileFinishedPresentation() {
    if (!presentationFinished(pending, now())) return false;
    reset();
    return true;
  }

  function notify() { onChange(); }
  function waitUntil(deadline) {
    const ms = Math.max(0, deadline - now());
    if (!ms) return Promise.resolve();
    return new Promise(resolve => {
      const timer = setTimer(() => { waits.delete(timer); resolve(); }, ms);
      waits.set(timer, resolve);
    });
  }
  function reset() {
    generation++;
    for (const [timer, resolve] of waits) { clearTimer(timer); resolve(); }
    waits.clear();
    pending.length = 0;
    positions.clear();
    running = false;
    cancelMovement();
    setRolling(false);
    idleResolvers.splice(0).forEach(resolve => resolve());
    notify();
  }
  function pendingCashFor(playerId) {
    return pending.reduce((sum, entry) => sum + entry.record.cashEvents.reduce((amount, event, index) => {
      if (entry.shown.has(index)) return amount;
      return amount + event.deltas.reduce((value, delta) => value + (delta.playerId === playerId ? delta.amount : 0), 0);
    }, 0), 0);
  }
  async function showCash(entry, index, revision) {
    await waitUntil(entry.record.startedAt + entry.record.cashEvents[index].atMs);
    if (revision !== generation) return;
    entry.shown.add(index);
    notify();
  }

  async function waitForCurrent(deadline, revision) {
    await waitUntil(deadline);
    return revision === generation;
  }

  async function playSegment(segment, record, revision) {
    if (!await waitForCurrent(record.startedAt + segment.offsetMs, revision)) return false;
    const segmentEndsAt = record.startedAt + segment.offsetMs + segment.durationMs;
    if (now() < segmentEndsAt) {
      let animationResult;
      try { animationResult = await animateSegment(segment, record); } catch { /* Reconcile the authoritative destination if a visual walk fails. */ }
      if (animationResult?.motionSkipped) {
        positions.set(record.actorId, segment.to);
        notify();
      }
    }
    if (!await waitForCurrent(segmentEndsAt, revision)) return false;
    positions.set(record.actorId, segment.to);
    notify();
    return true;
  }

  async function presentEntry(entry, revision) {
    const record = entry.record;
    const cashTasks = record.cashEvents.map((_event, index) => showCash(entry, index, revision));
    setRolling(now() < record.startedAt + DICE_ROLL_MS);
    if (!await waitForCurrent(record.startedAt + DICE_ROLL_MS, revision)) return false;
    setRolling(false);
    if (now() < record.readyAt) announceTotal(record.dice[0] + record.dice[1], record.dice);
    for (const segment of record.segments) {
      if (!await playSegment(segment, record, revision)) return false;
    }
    if (!await waitForCurrent(record.readyAt, revision)) return false;
    await Promise.all(cashTasks);
    return revision === generation;
  }

  async function run() {
    if (running) return;
    running = true;
    const revision = generation;
    while (pending.length && revision === generation) {
      const entry = pending[0];
      if (!await presentEntry(entry, revision)) return;
      pending.shift();
      if (!pending.some(item => item.record.actorId === entry.record.actorId)) positions.delete(entry.record.actorId);
      notify();
    }
    if (revision !== generation) return;
    running = false;
    notify();
    idleResolvers.splice(0).forEach(resolve => resolve());
  }

  function acceptsRecord(record, currentTime) {
    if (!record || !Number.isSafeInteger(record.id) || record.id <= lastId) return false;
    if (!Number.isFinite(record.readyAt) || record.readyAt <= currentTime) return false;
    if (!Number.isFinite(record.startedAt) || record.readyAt - record.startedAt > 120000) return false;
    return Array.isArray(record.dice) && record.dice.length === 2 && record.dice.every(value => Number.isInteger(value) && value >= 1 && value <= 6);
  }

  function isValidSegment(segment) {
    return Array.isArray(segment.path) && segment.path.length <= 208 && segment.path.every(Number.isInteger)
      && [segment.from, segment.to, segment.offsetMs, segment.durationMs, segment.stepMs].every(Number.isFinite);
  }

  function normalizeSegments(record) {
    return (Array.isArray(record.segments) ? record.segments : []).filter(isValidSegment);
  }

  function isValidCashEvent(event, durationMs) {
    return Number.isFinite(event.atMs) && event.atMs >= 0 && event.atMs <= durationMs;
  }

  function normalizeCashDeltas(event) {
    return (Array.isArray(event.deltas) ? event.deltas : [])
      .filter(delta => typeof delta.playerId === 'string' && Number.isFinite(delta.amount));
  }

  function normalizeCashEvents(record) {
    const durationMs = record.readyAt - record.startedAt;
    return (Array.isArray(record.cashEvents) ? record.cashEvents : []).slice(0, 64)
      .filter(event => isValidCashEvent(event, durationMs))
      .map(event => ({ ...event, deltas: normalizeCashDeltas(event) }));
  }

  function receive(roomCode, record, gameStartedAt = record?.gameStartedAt ?? 0) {
    if (roomCode !== room || gameStartedAt !== gameGeneration) {
      reset();
      room = roomCode;
      gameGeneration = gameStartedAt;
      lastId = Number(record?.id) || 0;
      return false; // Joining/reconnecting establishes a baseline, not a replay.
    }
    reconcileFinishedPresentation();
    if (!acceptsRecord(record, now())) return false;
    lastId = record.id;
    const segments = normalizeSegments(record);
    const cashEvents = normalizeCashEvents(record);
    const normalized = { ...record, segments, cashEvents };
    pending.push({ record: normalized, shown: new Set() });
    if (!positions.has(record.actorId) && segments.length) positions.set(record.actorId, segments[0].from);
    notify();
    void run();
    return true;
  }
  return {
    receive, reset, pendingCashFor,
    positionFor: playerId => positions.get(playerId),
    get busy() { return running || pending.length > 0; },
    whenIdle: () => running || pending.length ? new Promise(resolve => idleResolvers.push(resolve)) : Promise.resolve(),
    reconcile: reconcileFinishedPresentation,
  };
}
