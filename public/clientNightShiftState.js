// Night Shift shared state: the run record, target and offer maps, and the
// tuning constants. The other Night Shift modules read and write this one copy
// of the run through nightRun, so there is no second source of truth.

export const nightRun = {
  nightShiftWaveTimer: null,
  nightShiftTickTimer: null,
  nightShiftStartTimer: null,
  nightShiftResultTimer: null,
  nightShiftResultEndsAt: 0,
  nightShiftSpawnTimers: [],
  nightShiftWaveHeld: false,
  nightShiftGuestCleanWave: false,
  nightShiftPausedAt: 0,
  nightShiftSuppressSnapshot: false,
  nightShiftGeneration: 0,
  nightShiftVisibilityGeneration: 0,
  nightShiftServerRevision: 0,
  nightShiftServerRun: false,
  nightShiftClockOffset: null,
  nightShiftClockRtt: Infinity,
  nightShiftSettlement: null,
  host: {},
};
export const NIGHT_SHIFT_WAVE_MS = 60000;
export const NIGHT_SHIFT_START_HEARTS = 3;
export const NIGHT_SHIFT_BEST_KEY = "poorup.night-shift.best.v1";
export const nightShiftTargetTimers = new Map();
export const nightShiftServerGates = new Map();
export const nightShiftServerOffers = new Map();
export const nightShiftGuestWaves = new Map();
export const nightShiftState = { active: false, wave: 0, score: 0, best: 0, endsAt: 0, targetSeq: 0, hearts: NIGHT_SHIFT_START_HEARTS, misses: 0, serverRunToken: null, serverRunSubmitted: false, serverRunError: null };

try { nightShiftState.best = Number(localStorage.getItem(NIGHT_SHIFT_BEST_KEY)) || 0; } catch { /* storage unavailable */ }
