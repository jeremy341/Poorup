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
const { configureSocketListeners, onStorage, reconcileSignedOutState } = await import("./clientSocketListeners.js");
const { ACCOUNT_SESSION_KEY, loadAccountSession, persistAccountSession } = await import("./clientSanitize.js");
const {
  ACCOUNT_SESSION_READY_KEY,
  beginAccountAuthTransition,
  bootstrapAccountCookieSession,
  canApplyAccountSocialUpdate,
  configureAccountIdentity,
  getAccountAuthGeneration,
  guardAccountAuthCallback,
  logoutAccount,
  markAccountSocialStateFresh,
  resetAccountScopedClientState,
  updateAccountFromResponse,
} = await import("./clientAccountIdentity.js");

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

const accountRecord = (id, username = id.toUpperCase()) => ({ id, username, displayName: username, color: "#d74438", avatarGrid: null, achievements: [] });
const seedAccountScopedData = () => {
  state.social = { friends: [{ id: "account-a-friend" }], requests: [{ id: "request-a" }], outgoing: [], invites: [], notifications: [{ id: "notice-a" }], recentPlayers: [{ id: "recent-a" }] };
  state.socialSearchResults = [{ id: "search-a" }];
  state.socialSearchQuery = "private-a";
  state.selectedPlayer = { accountId: "selected-a", displayName: "PRIVATE A" };
  state.selectedPlayerRelationship = "accepted";
  state.selectedPlayerHistory = [{ completedAt: "2026-01-01" }];
};
const assertAccountSocialStateCleared = (message) => {
  assert.deepEqual(state.social, { friends: [], requests: [], outgoing: [], invites: [], notifications: [], recentPlayers: [] }, message);
  assert.deepEqual(state.socialSearchResults, [], `${message}: search results`);
  assert.equal(state.socialSearchQuery, "", `${message}: search query`);
  assert.equal(state.selectedPlayer, null, `${message}: selected player`);
  assert.equal(state.selectedPlayerRelationship, "none", `${message}: selected relationship`);
  assert.equal(state.selectedPlayerHistory, null, `${message}: selected history`);
};

let logoutRequest;
const identityNotices = [];
configureAccountIdentity({
  emitServer: (event, payload) => { if (event === "account-logout") logoutRequest = { event, payload }; },
  notice: (...args) => identityNotices.push(args),
  renderSocialSurfaces() {},
});
globalThis.fetch = async (url, options = {}) => {
  if (url === "/account/logout") logoutRequest = { ...logoutRequest, url, options };
  return { ok: true, status: 204, json: async () => ({ success: true }) };
};
state.account = { sessionToken: "legacy-token-a", account: accountRecord("acct-a") };
seedAccountScopedData();
await logoutAccount();
assertAccountSocialStateCleared("normal sign-out clears account-owned social state");
assert.equal(logoutRequest?.payload?.sessionToken, "legacy-token-a", "socket logout keeps the legacy token available");
assert.equal(logoutRequest?.url, "/account/logout");
assert.equal(logoutRequest?.options?.method, "POST");
assert.equal(logoutRequest?.options?.credentials, "include");
assert.equal(logoutRequest?.options?.headers?.["x-poorup-session-token"], "legacy-token-a", "HTTP logout carries the token needed to revoke derived cookie sessions");
assert.equal(state.account, null);

state.account = { sessionToken: "token-a", account: accountRecord("acct-a") };
seedAccountScopedData();
updateAccountFromResponse({ sessionToken: "token-b", account: accountRecord("acct-b") });
assertAccountSocialStateCleared("switching accounts clears the previous account's social state");
assert.equal(state.account?.account?.id, "acct-b");
const refreshedGeneration = getAccountAuthGeneration();
updateAccountFromResponse({ sessionToken: "token-b", account: accountRecord("acct-b") });
assert.equal(getAccountAuthGeneration(), refreshedGeneration, "refreshing the active account does not invalidate its auth generation");
markAccountSocialStateFresh(refreshedGeneration);
assert.equal(canApplyAccountSocialUpdate(), true, "the active account can receive social updates after a successful sync");
let staleSocialResponseApplied = false;
const applyStaleSocialResponse = guardAccountAuthCallback(() => { staleSocialResponseApplied = true; }, refreshedGeneration);
resetAccountScopedClientState();
applyStaleSocialResponse({ success: true, social: { friends: [{ id: "private-a" }] } });
assert.equal(staleSocialResponseApplied, false, "a social response from the prior auth generation is discarded");
assert.equal(canApplyAccountSocialUpdate(), false, "an account switch closes the old socket-push generation until fresh social data arrives");

let resolveLateBootstrap;
let accountRestoreCalls = 0;
let logoutFetchOptions;
globalThis.fetch = (url, options = {}) => {
  if (url === "/account/logout") {
    logoutFetchOptions = options;
    return Promise.resolve({ ok: true, status: 204, json: async () => ({ success: true }) });
  }
  if (url === "/account/session" && options.headers?.["x-poorup-session-token"] === "legacy-late") {
    return new Promise(resolve => { resolveLateBootstrap = resolve; });
  }
  return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
};
state.account = { sessionToken: "legacy-late", account: accountRecord("acct-late") };
const raceHandlers = new Map();
const raceSocket = {
  on(event, handler) { raceHandlers.set(event, handler); },
  emit(event, payload, callback) {
    if (event === "account-restore") accountRestoreCalls += 1;
  },
};
configureSocketListeners(raceSocket, { emitServer() {}, setConnectionStatus() {} });
raceHandlers.get("social-update")({ friends: [{ id: "stale-account-a-friend" }] });
assert.deepEqual(state.social.friends, [], "socket social pushes remain blocked until the current account syncs");
raceHandlers.get("connect")();
for (let attempt = 0; attempt < 10 && !resolveLateBootstrap; attempt += 1) await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(typeof resolveLateBootstrap, "function", "connect starts the held cookie-session bootstrap");
assert.equal(accountRestoreCalls, 0, "a cookie session is not restored with a consumed legacy bearer");
const completedLogout = logoutAccount();
assert.equal(state.account, null, "local private state clears before the server logout completes");
resolveLateBootstrap({ ok: true, status: 200, json: async () => ({ success: true, account: accountRecord("acct-late") }) });
await completedLogout;
assert.equal(logoutFetchOptions?.headers?.["x-poorup-session-token"], "legacy-late", "logout captures the legacy token before clearing it");
updateAccountFromResponse({ sessionToken: "token-b", account: accountRecord("acct-b") });
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(state.account?.account?.id, "acct-b", "late bootstrap and account-restore replies cannot replace a newer login");
assert.equal(loadAccountSession()?.account?.id, "acct-b", "late replies cannot repopulate storage with the prior account");

let logoutAttempts = 0;
identityNotices.length = 0;
globalThis.fetch = async (url) => {
  if (url === "/account/logout") {
    logoutAttempts += 1;
    return { ok: false, status: 503, json: async () => ({ code: "ACCOUNT_LOGOUT_FAILED" }) };
  }
  return { ok: true, status: 200, json: async () => ({ success: true }) };
};
state.account = { sessionToken: "legacy-failed", account: accountRecord("acct-failed") };
seedAccountScopedData();
const failedLogout = await logoutAccount();
assert.equal(failedLogout, false, "a failed server revocation is reported to the caller");
assert.equal(state.account, null, "server revocation failure does not restore local account state");
assertAccountSocialStateCleared("server logout failure still clears local private social state");
assert.equal(logoutAttempts, 2, "a transient logout failure gets one bounded retry");
assert.ok(identityNotices.some(([, message]) => /sign out could not be confirmed/i.test(message)), "a failed revocation is reported through the existing account notice");
assert.equal(identityNotices.some(([, message]) => /^Signed out\./.test(message)), false, "the client does not claim server sign-out after revocation failure");

const sessionRequestOrder = [];
let resolveOrderedLogout;
globalThis.fetch = (url) => {
  sessionRequestOrder.push(url);
  if (url === "/account/logout") return new Promise(resolve => { resolveOrderedLogout = resolve; });
  return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true, account: accountRecord("acct-new") }) });
};
state.account = { sessionToken: "legacy-order", account: accountRecord("acct-order") };
const orderedLogout = logoutAccount();
await Promise.resolve();
updateAccountFromResponse({ sessionToken: "token-new", account: accountRecord("acct-new") });
await Promise.resolve();
const orderHandlers = new Map();
configureSocketListeners({
  on(event, handler) { orderHandlers.set(event, handler); },
  emit() {},
}, { emitServer() {}, setConnectionStatus() {} });
orderHandlers.get("connect")();
await Promise.resolve();
assert.deepEqual(sessionRequestOrder, ["/account/logout"], "new account cookie exchange waits for the pending logout response");
resolveOrderedLogout({ ok: true, status: 204, json: async () => ({ success: true }) });
await orderedLogout;
await new Promise(resolve => setTimeout(resolve, 0));
assert.deepEqual(sessionRequestOrder, ["/account/logout", "/account/session"], "login and reconnect share one cookie exchange after the logout response is applied");

const cookieAccount = accountRecord("acct-cookie");
state.account = { sessionToken: "", logoutToken: "", account: cookieAccount };
persistAccountSession(state.account);
let readinessReconnects = 0;
let serverCookieAccount = cookieAccount;
const cookieSocketHandlers = new Map();
const cookieSocket = { on(event, handler) { cookieSocketHandlers.set(event, handler); }, emit() {} };
configureSocketListeners(cookieSocket, {
  emitServer() {},
  setConnectionStatus() {},
  reconnectSocket() {
    readinessReconnects += 1;
    cookieSocketHandlers.get("connect")?.();
  },
});
const readyValue = JSON.stringify({ accountId: cookieAccount.id, revision: "cookie-exchange" });
storage.setItem(ACCOUNT_SESSION_READY_KEY, readyValue);
globalThis.fetch = async (url) => url === "/account/session"
  ? { ok: true, status: 200, json: async () => ({ success: true, account: serverCookieAccount }) }
  : { ok: true, status: 204 };
onStorage({ key: ACCOUNT_SESSION_READY_KEY, oldValue: null, newValue: readyValue });
assert.equal(readinessReconnects, 1, "a cross-tab completed cookie exchange rebinds this tab's socket");
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(storage.getItem(ACCOUNT_SESSION_READY_KEY), readyValue, "cookie-only bootstrap does not emit another readiness event");
const cookieAccountSync = { ...cookieAccount, displayName: "COOKIE SYNCED" };
serverCookieAccount = cookieAccountSync;
cookieSocketHandlers.get("account-sync")({ account: { ...cookieAccountSync, id: "different-account", displayName: "MISMATCH" } });
assert.equal(state.account.account.displayName, cookieAccount.displayName, "account-sync rejects a mismatched account ID");
cookieSocketHandlers.get("account-sync")({ account: cookieAccountSync });
assert.equal(state.account.account.displayName, "COOKIE SYNCED", "account-sync applies after the cookie session was verified");
assert.equal(readinessReconnects, 1, "cookie-only bootstrap cannot start a cross-tab reconnect loop");
beginAccountAuthTransition();
cookieSocketHandlers.get("account-sync")({ account: { ...cookieAccountSync, displayName: "STALE SYNC" } });
beginAccountAuthTransition();
cookieSocketHandlers.get("connect")();
await new Promise(resolve => setTimeout(resolve, 0));
assert.equal(state.account.account.displayName, "COOKIE SYNCED", "a buffered account-sync from an older auth generation is discarded");
configureAccountIdentity({ reconcileSignedOutState });
const offlineAccount = accountRecord("acct-offline-cookie");
state.account = { sessionToken: "", account: offlineAccount };
persistAccountSession(state.account);
globalThis.fetch = async () => { throw new Error("temporary network failure"); };
assert.equal(await bootstrapAccountCookieSession(), false, "a temporary cookie check failure is reported");
assert.equal(state.account?.account?.id, offlineAccount.id, "a temporary network failure does not falsely sign out the account");
assert.equal(loadAccountSession()?.account?.id, offlineAccount.id, "a temporary network failure preserves the account snapshot");const expiredAccount = accountRecord("acct-expired-cookie");
state.account = { sessionToken: "", account: expiredAccount };
persistAccountSession(state.account);
globalThis.fetch = async () => ({ ok: false, status: 401 });
assert.equal(await bootstrapAccountCookieSession(), false, "an expired cookie session is rejected");
assert.equal(state.account, null, "an expired cookie session clears private client state");
assert.equal(loadAccountSession(), null, "an expired cookie session clears the stored account snapshot");
let publicMythicalNotice = "";
document.querySelector = selector => selector === "#system-announcer"
  ? { set textContent(value) { publicMythicalNotice = value; } }
  : null;
const mythicalHandlers = new Map();
configureSocketListeners({ on(event, handler) { mythicalHandlers.set(event, handler); } }, {});
const mythicalNotice = { kind: "mythical-achievement", title: "MYTHICAL ACHIEVEMENT", body: "A player unlocked a MYTHICAL ACHIEVEMENT." };
state.account = null;
state.social.notifications = [{ id: "private-account-notice" }];
mythicalHandlers.get("mythical-achievement")(mythicalNotice);
assert.equal(publicMythicalNotice, "MYTHICAL ACHIEVEMENT. A player unlocked a MYTHICAL ACHIEVEMENT.", "guests still receive the server-wide public mythical announcement");
assert.deepEqual(state.social.notifications, [{ id: "private-account-notice" }], "guest receipt does not mutate private account notifications");
state.account = { sessionToken: "", account: accountRecord("acct-mythical") };
markAccountSocialStateFresh(getAccountAuthGeneration());
mythicalHandlers.get("mythical-achievement")(mythicalNotice);
assert.deepEqual(state.social.notifications[0], mythicalNotice, "a synchronized current account also stores the private notification");
assert.equal(publicMythicalNotice, "MYTHICAL ACHIEVEMENT. A player unlocked a MYTHICAL ACHIEVEMENT.");
console.log("client cross-tab sign-out tests: passed");
