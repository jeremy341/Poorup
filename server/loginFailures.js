// Sign-in failure accounting. Failures are counted per (username, source) so
// one address cannot lock an account out for everyone else, and a second,
// higher cap per username still bounds guessing spread across many addresses.
// Unknown usernames are counted exactly like known ones, so the lock response
// cannot tell registered names from unregistered ones.
export const SOURCE_FAILURE_LIMIT = 10;
export const ACCOUNT_FAILURE_LIMIT = 50;
const WINDOW_MS = 15 * 60_000;
const MAX_NAMES = 20_000;
const MAX_SOURCES_PER_NAME = 50;

export class LoginFailureTracker {
  constructor({ now = Date.now, sourceLimit = SOURCE_FAILURE_LIMIT, accountLimit = ACCOUNT_FAILURE_LIMIT, windowMs = WINDOW_MS, maxNames = MAX_NAMES } = {}) {
    this.now = now;
    this.sourceLimit = sourceLimit;
    this.accountLimit = accountLimit;
    this.windowMs = windowMs;
    this.maxNames = maxNames;
    // handle -> { total: { startedAt, count }, sources: Map(source -> { startedAt, count }) }
    this.names = new Map();
  }

  get size() { return this.names.size; }

  #live(entry) {
    return Boolean(entry) && this.now() - entry.startedAt < this.windowMs;
  }

  // This source has used up its tries for this username.
  sourceLocked(handle, source) {
    const entry = this.names.get(handle)?.sources.get(source);
    return this.#live(entry) && entry.count >= this.sourceLimit;
  }

  // Failures from all sources together have used up the username's cap.
  accountLocked(handle) {
    const total = this.names.get(handle)?.total;
    return this.#live(total) && total.count >= this.accountLimit;
  }

  recordFailure(handle, source) {
    const now = this.now();
    let record = this.names.get(handle);
    if (!record) {
      if (this.names.size >= this.maxNames) this.names.delete(this.names.keys().next().value);
      record = { total: { startedAt: now, count: 0 }, sources: new Map() };
      this.names.set(handle, record);
    }
    const bump = entry => (this.#live(entry) ? entry : { startedAt: now, count: 0 });
    record.total = bump(record.total);
    record.total.count += 1;
    let sourceEntry = record.sources.get(source);
    if (!sourceEntry && record.sources.size >= MAX_SOURCES_PER_NAME) record.sources.delete(record.sources.keys().next().value);
    sourceEntry = bump(sourceEntry);
    sourceEntry.count += 1;
    record.sources.set(source, sourceEntry);
  }

  // A correct password clears only that source's failures, so the owner signing
  // in cannot lift a lock another address earned.
  recordSuccess(handle, source) {
    const record = this.names.get(handle);
    const entry = record?.sources.get(source);
    if (!entry) return;
    record.sources.delete(source);
    if (this.#live(entry) && this.#live(record.total)) record.total.count = Math.max(0, record.total.count - entry.count);
    if (!record.sources.size) this.names.delete(handle);
  }

  // A password reset clears the username's whole history.
  clear(handle) {
    this.names.delete(handle);
  }
}
