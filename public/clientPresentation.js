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
  async function run() {
    if (running) return;
    running = true;
    const revision = generation;
    while (pending.length && revision === generation) {
      const entry = pending[0];
      const record = entry.record;
      const cashTasks = record.cashEvents.map((_event, index) => showCash(entry, index, revision));
      setRolling(now() < record.startedAt + DICE_ROLL_MS);
      await waitUntil(record.startedAt + DICE_ROLL_MS);
      if (revision !== generation) return;
      setRolling(false);
      if (now() < record.readyAt) announceTotal(record.dice[0] + record.dice[1], record.dice);
      for (const segment of record.segments) {
        await waitUntil(record.startedAt + segment.offsetMs);
        if (revision !== generation) return;
        if (now() < record.startedAt + segment.offsetMs + segment.durationMs) {
          try { await animateSegment(segment, record); } catch { /* Reconcile the authoritative destination if a visual walk fails. */ }
        }
        await waitUntil(record.startedAt + segment.offsetMs + segment.durationMs);
        if (revision !== generation) return;
        positions.set(record.actorId, segment.to);
        notify();
      }
      await waitUntil(record.readyAt);
      await Promise.all(cashTasks);
      if (revision !== generation) return;
      pending.shift();
      if (!pending.some(item => item.record.actorId === record.actorId)) positions.delete(record.actorId);
      notify();
    }
    if (revision !== generation) return;
    running = false;
    notify();
    idleResolvers.splice(0).forEach(resolve => resolve());
  }
  function receive(roomCode, record, gameStartedAt = record?.gameStartedAt ?? 0) {
    if (roomCode !== room || gameStartedAt !== gameGeneration) {
      reset();
      room = roomCode;
      gameGeneration = gameStartedAt;
      lastId = Number(record?.id) || 0;
      return false; // Joining/reconnecting establishes a baseline, not a replay.
    }
    if (pending.length && now() >= pending.at(-1).record.readyAt) reset();
    if (!record || !Number.isSafeInteger(record.id) || record.id <= lastId) return false;
    lastId = record.id;
    if (!Number.isFinite(record.readyAt) || record.readyAt <= now()) return false;
    if (!Number.isFinite(record.startedAt) || record.readyAt - record.startedAt > 120000) return false;
    if (!Array.isArray(record.dice) || record.dice.length !== 2 || !record.dice.every(n => Number.isInteger(n) && n >= 1 && n <= 6)) return false;
    const segments = (Array.isArray(record.segments) ? record.segments : []).filter(segment =>
      Array.isArray(segment.path) && segment.path.length <= 208 && segment.path.every(Number.isInteger)
      && [segment.from, segment.to, segment.offsetMs, segment.durationMs, segment.stepMs].every(Number.isFinite));
    const cashEvents = (Array.isArray(record.cashEvents) ? record.cashEvents : []).slice(0, 64).filter(event => Number.isFinite(event.atMs) && event.atMs >= 0 && event.atMs <= record.readyAt - record.startedAt)
      .map(event => ({ ...event, deltas: (Array.isArray(event.deltas) ? event.deltas : []).filter(delta => typeof delta.playerId === 'string' && Number.isFinite(delta.amount)) }));
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
    reconcile() { if (pending.length && now() >= pending.at(-1).record.readyAt) reset(); },
  };
}
