import assert from "node:assert/strict";

class MemoryStorage {
  constructor(entries = {}) { this.values = new Map(Object.entries(entries)); }
  get length() { return this.values.size; }
  key(index) { return [...this.values.keys()][index] ?? null; }
  getItem(key) { return this.values.has(key) ? this.values.get(key) : null; }
  setItem(key, value) { this.values.set(String(key), String(value)); }
  removeItem(key) { this.values.delete(String(key)); }
}

const storage = new MemoryStorage({
  "poorup.account.session.v1": JSON.stringify({ sessionToken: "tab-session", account: { id: "acct-1", username: "PLAYER", displayName: "Player" } }),
  "poorup.profiles.v1": "signed-profile",
  "poorup.achievements.v1": "signed-achievements",
  "poorup.music.enabled.v1": "1",
  "other-app.state": "retain-me",
});
const listeners = new Map();
globalThis.localStorage = storage;
globalThis.sessionStorage = new MemoryStorage();
globalThis.window = {
  matchMedia: () => ({ matches: false }),
  addEventListener(name, handler) { listeners.set(name, handler); },
};
globalThis.document = {
  querySelector: () => null,
  querySelectorAll: () => [],
};

const { state } = await import("./clientState.js");
const { configureSocketListeners, onStorage } = await import("./clientSocketListeners.js");
const { ACCOUNT_SESSION_KEY, loadAccountSession, persistAccountSession } = await import("./clientSanitize.js");

const migratedSession = loadAccountSession();
assert.equal(migratedSession?.sessionToken, "");
assert.equal(migratedSession?.account?.id, "acct-1");
assert.equal(JSON.parse(storage.getItem(ACCOUNT_SESSION_KEY)).sessionToken, undefined);

persistAccountSession({ sessionToken: "new-bearer-secret", account: migratedSession.account });
const persistedSession = JSON.parse(storage.getItem(ACCOUNT_SESSION_KEY));
assert.equal(persistedSession.sessionToken, undefined);
assert.equal(JSON.stringify(persistedSession).includes("new-bearer-secret"), false);

state.account = migratedSession;
state.profiles = [{ id: "signed", color: "#d74438", avatarGrid: Array.from({ length: 8 }, () => Array(8).fill(null)) }];
state.appearance = "signed";
state.themeId = "spring";
state.profileDraft = { designName: "DRAFT" };
state.editingProfileId = "signed";
state.unlockedAchievements = new Set(["first-deed"]);
state.achievementRecords = new Map([["first-deed", "2026-01-01T00:00:00.000Z"]]);
state.players = [{ id: "p1", name: "SIGNED PLAYER", accountId: "acct-1" }];
state.sound = true;
state.music = true;
state.social = { friends: [{ id: "friend" }] };

const calls = [];
configureSocketListeners(null, {
  renderAll: () => calls.push("renderAll"),
  syncAudioButtons: () => calls.push("syncAudioButtons"),
  syncHomeMusic: () => calls.push("syncHomeMusic"),
  say: (message) => calls.push(message),
});
assert.equal(typeof listeners.get("storage"), "function");

const reconnectHandlers = new Map();
const reconnectEvents = [];
const reconnectSocket = {
  on(event, handler) { reconnectHandlers.set(event, handler); },
};
configureSocketListeners(reconnectSocket, {
  emitServer: event => reconnectEvents.push(event),
  setConnectionStatus() {},
});
reconnectHandlers.get("connect")();
assert.deepEqual(reconnectEvents, ["restore-session"]);

onStorage({ key: "poorup.account.session.v1", oldValue: "signed", newValue: null });

assert.equal(state.account, null);
assert.deepEqual(state.profiles, []);
assert.equal(state.appearance, 0);
assert.equal(state.themeId, "original");
assert.equal(state.profileDraft, null);
assert.equal(state.editingProfileId, null);
assert.equal(state.unlockedAchievements.size, 0);
assert.equal(state.achievementRecords.size, 0);
assert.equal(state.sound, false);
assert.equal(state.music, false);
assert.equal(state.players[0].name, "MARLOWE");
assert.deepEqual(state.social.friends, []);
assert.equal(storage.getItem("other-app.state"), "retain-me");
assert.ok(calls.includes("syncAudioButtons"));
assert.ok(calls.includes("syncHomeMusic"));

console.log("client cross-tab sign-out tests: passed");
