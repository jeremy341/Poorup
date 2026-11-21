import { test, expect } from "@playwright/test";

const DESKTOP_ONLY = "One desktop browser project proves the account flow.";
const CLEARED_SESSION_COOKIE = "poorup_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax";

function accountRecord({ id, username, displayName, color = "#d74438" }) {
  return { id, username, displayName, color, avatarGrid: null, achievements: [], stats: {}, history: [], privacy: {} };
}

function sessionCookie(value) {
  return `poorup_session=${value}; Path=/; HttpOnly; SameSite=Lax`;
}

function jsonHeaders(cookie) {
  return cookie ? { "content-type": "application/json", "Set-Cookie": cookie } : { "content-type": "application/json" };
}

function sessionReply(account) {
  return JSON.stringify({ success: true, account });
}

function signal() {
  let fire;
  const promise = new Promise(resolve => { fire = resolve; });
  return { promise, fire };
}

function gate() {
  let open;
  const promise = new Promise(resolve => { open = resolve; });
  return { promise, open };
}

async function readSessionCookie(context) {
  return (await context.cookies()).find(cookie => cookie.name === "poorup_session")?.value;
}

// Page-side seeds. Playwright serialises these functions, so they must not
// reference anything defined outside their own bodies.

async function seedLateReplyTab(accountA) {
  const [{ state, saveAccountSession }, identity, social, listeners] = await Promise.all([
    import("/clientState.js"),
    import("/clientAccountIdentity.js"),
    import("/clientSocialSurfaces.js"),
    import("/clientSocketListeners.js"),
  ]);
  window.__accountA = accountA;
  const originalFetch = window.fetch.bind(window);
  window.__logoutSessionHeader = "";
  const routeAccountFetch = (url, options = {}) => {
    const token = options.headers?.["x-poorup-session-token"];
    if (url === "/account/session" && token === "legacy-a") {
      return new Promise(resolve => { window.__resolveLateSession = resolve; });
    }
    if (url === "/account/logout") {
      window.__logoutSessionHeader = token || "";
      return Promise.resolve({ ok: true, status: 204, json: async () => ({ success: true }) });
    }
    if (url === "/account/session") return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
    return originalFetch(url, options);
  };
  window.fetch = routeAccountFetch;
  identity.configureAccountIdentity({ emitServer() {} });
  social.configureSocialSurfaces({ emitServer() {}, showView() {} });
  saveAccountSession({ sessionToken: "legacy-a", account: accountA });
  state.social = {
    friends: [{ id: "friend-a", username: "privatefriend", displayName: "PRIVATE FRIEND" }],
    requests: [], outgoing: [], invites: [], notifications: [{ id: "notice-a", title: "PRIVATE NOTICE", body: "Account A only." }], recentPlayers: [],
  };
  social.renderSocialSurface("#social-page-content");
  window.__accountAVisibleBeforeLogout = document.querySelector("#social-page-content").textContent.includes("PRIVATE FRIEND");

  const socketHandlers = new Map();
  const socket = {
    on(event, handler) { socketHandlers.set(event, handler); },
    emit() {},
  };
  listeners.configureSocketListeners(socket, { emitServer() {}, setConnectionStatus() {}, renderAll() {} });
  socketHandlers.get("connect")();
  window.__startLogout = () => { window.__logoutPromise = identity.logoutAccount(); };
  window.__updateAccount = identity.updateAccountFromResponse;
}

async function seedCrossTabOwner(accountA) {
  const [{ state }, identity, sanitize, listeners] = await Promise.all([
    import("/clientState.js"), import("/clientAccountIdentity.js"), import("/clientSanitize.js"), import("/clientSocketListeners.js"),
  ]);
  state.account = { sessionToken: "", account: accountA };
  sanitize.persistAccountSession({ sessionToken: "", account: accountA });
  state.social = { friends: [{ id: "friend-a" }], requests: [], outgoing: [], invites: [], notifications: [], recentPlayers: [] };
  state.selectedPlayer = { accountId: "selected-a", displayName: "PRIVATE A" };
  identity.configureAccountIdentity({ emitServer() {}, notice() {} });
  window.__accountReadyReconnects = 0;
  listeners.configureSocketListeners(null, {
    renderAll() {}, syncAudioButtons() {}, syncHomeMusic() {}, renderSocialSurfaces() {}, closePlayerSurface() {},
    reconnectSocket() { window.__accountReadyReconnects += 1; },
  });
}

async function seedCrossTabWatcher({ accountA, accountB }) {
  const [{ state }, identity, sanitize] = await Promise.all([
    import("/clientState.js"), import("/clientAccountIdentity.js"), import("/clientSanitize.js"),
  ]);
  state.account = { sessionToken: "", account: sanitize.loadAccountSession()?.account || accountA };
  identity.configureAccountIdentity({ emitServer() {}, notice() {} });
  window.__accountB = accountB;
  window.__switchToB = () => identity.updateAccountFromResponse({ sessionToken: "legacy-b", account: window.__accountB });
}

async function seedLogoutTab(accountA) {
  const [{ state }, identity, sanitize, listeners] = await Promise.all([
    import("/clientState.js"), import("/clientAccountIdentity.js"), import("/clientSanitize.js"), import("/clientSocketListeners.js"),
  ]);
  state.account = { sessionToken: "", account: accountA };
  sanitize.persistAccountSession({ sessionToken: "", account: accountA });
  identity.configureAccountIdentity({ emitServer() {}, notice() {} });
  listeners.configureSocketListeners(null, { renderAll() {}, syncAudioButtons() {}, syncHomeMusic() {}, renderSocialSurfaces() {}, closePlayerSurface() {} });
  window.__startLogout = () => { window.__logoutPromise = identity.logoutAccount(); };
}

async function seedWaitingWatcher({ accountA, accountB }) {
  const [{ state }, identity, sanitize] = await Promise.all([
    import("/clientState.js"), import("/clientAccountIdentity.js"), import("/clientSanitize.js"),
  ]);
  state.account = { sessionToken: "", account: sanitize.loadAccountSession()?.account || accountA };
  window.__accountB = accountB;
  identity.configureAccountIdentity({ emitServer() {}, notice() {} });
  window.__startLoginB = () => identity.updateAccountFromResponse({ sessionToken: "logout-legacy-b", account: accountB });
}

async function seedStalledCookieTab({ accountA, accountB }) {
  const identity = await import("/clientAccountIdentity.js");
  const nativeFetch = window.fetch.bind(window);
  window.__sessionAbortCount = 0;
  window.__sessionFetchHadSignal = false;
  window.fetch = (url, options = {}) => {
    if (url === "/account/session") {
      window.__sessionFetchHadSignal = Boolean(options.signal);
      options.signal?.addEventListener("abort", () => { window.__sessionAbortCount += 1; }, { once: true });
    }
    return nativeFetch(url, options);
  };
  identity.configureAccountIdentity({ emitServer() {}, notice() {}, reconnectSocket() {} });
  window.__logoutTimedOutAccount = () => { window.__logoutPromise = identity.logoutAccount(); };
  window.__loginCookieAccountB = () => identity.updateAccountFromResponse({ sessionToken: "legacy-timeout-b", account: accountB });
  identity.updateAccountFromResponse({ sessionToken: "legacy-timeout-a", account: accountA });
}

// Runs in the page: exchanges a legacy token, reconnects the socket and reads
// social data again, returning what the account state looked like afterwards.
async function probeLegacyTokenReconnect() {
  const [{ state }, identity, listeners] = await Promise.all([
    import("/clientState.js"), import("/clientAccountIdentity.js"), import("/clientSocketListeners.js"),
  ]);
  const socket = window.io({ autoConnect: false, reconnection: false });
  window.__probeSocket = socket;
  window.__exchangeStatus = null;
  const realFetch = window.fetch.bind(window);
  window.fetch = (url, options) => {
    const request = realFetch(url, options);
    if (url !== "/account/session") return request;
    return request.then((response) => {
      window.__exchangeStatus = response.status;
      return response;
    });
  };
  const relayRestore = (event, payload, callback) => {
    if (event === "restore-session") socket.emit(event, { ...payload, clientId: state.clientId }, callback);
  };
  const ack = (event, payload) => new Promise((resolve) => socket.emit(event, payload, resolve));
  identity.configureAccountIdentity({
    emitServer: relayRestore,
    notice() {},
    reconnectSocket() { window.__reconnectRequested = true; },
  });
  listeners.configureSocketListeners(socket, {
    emitServer: relayRestore,
    setConnectionStatus() {},
    renderAll() {},
    syncAudioButtons() {},
    syncHomeMusic() {},
    renderSocialSurfaces() {},
    closePlayerSurface() {},
  });
  await new Promise((resolve) => { socket.once("connect", resolve); socket.connect(); });
  const username = "recon" + Date.now().toString(36).slice(-8);
  const registration = await ack("account-register", { username, displayName: "Reconnect Probe", password: "reconnect-probe-password" });
  if (!registration?.success) throw new Error("Account registration failed: " + JSON.stringify(registration));
  const login = await ack("account-login", { username, password: "reconnect-probe-password" });
  if (!login?.success) throw new Error("Account login failed: " + JSON.stringify(login));
  window.__legacyToken = login.sessionToken;
  identity.updateAccountFromResponse(login);
  await new Promise((resolve, reject) => {
    const deadline = Date.now() + 5_000;
    const check = () => {
      if (window.__exchangeStatus === 200) return resolve();
      if (Date.now() >= deadline) return reject(new Error("Cookie exchange did not return 200: " + window.__exchangeStatus));
      setTimeout(check, 10);
    };
    check();
  });
  await new Promise((resolve) => setTimeout(resolve, 100));
  const accountId = login.account.id;
  const tokenAfterExchange = state.account?.sessionToken || "";
  const socialBeforeReconnect = await ack("get-social-data", {});
  const reconnected = new Promise((resolve) => socket.once("connect", resolve));
  socket.disconnect();
  socket.connect();
  await reconnected;
  await new Promise((resolve) => setTimeout(resolve, 150));
  const social = await ack("get-social-data", {});
  return {
    accountId,
    accountAfterReconnect: state.account?.account?.id || null,
    tokenAfterExchange,
    legacyToken: window.__legacyToken,
    reconnectRequested: window.__reconnectRequested === true,
    socialBeforeReconnect: socialBeforeReconnect?.success === true,
    socialSuccess: social?.success === true,
  };
}

test("lost account acknowledgements release registration and account submit gates", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440x900", DESKTOP_ONLY);
  await page.goto("/");
  await page.clock.install();
  await page.evaluate(async () => {
    const { configureAccountIdentity, openAccountModal } = await import("/clientAccountIdentity.js");
    window.__accountEvents = [];
    window.__replyAccountRegister = false;
    const originalFetch = window.fetch.bind(window);
    window.fetch = (url, options) => url === "/account/session"
      ? Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) })
      : originalFetch(url, options);
    configureAccountIdentity({
      emitServer(event, payload, callback) {
        window.__accountEvents.push(event);
        if (event === "account-register" && window.__replyAccountRegister) {
          callback({
            success: true,
            sessionToken: "browser-test-token",
            account: {
              id: "browser-test-account", username: "clock_test", displayName: "Clock Test",
              color: "#d74438", avatarGrid: null, achievements: [], stats: {}, history: [], privacy: {},
            },
          });
        }
      },
    });
    openAccountModal("register");
  });

  await page.locator("#account-username-input").fill("clock_test");
  await page.locator("#account-password-input").fill("clock-test-password-1");
  await page.locator("#account-display-input").fill("Clock Test");
  await page.clock.fastForward(180);
  expect(await page.evaluate(() => window.__accountEvents)).toContain("check-username");
  await page.clock.fastForward(8_000);
  await expect(page.locator("#account-username-status")).toContainText("Could not check now");
  await expect(page.locator('#account-form button[type="submit"]')).toBeEnabled();

  await page.locator("#account-form").evaluate((form) => form.requestSubmit());
  await expect(page.locator('#account-form button[type="submit"]')).toBeDisabled();
  await page.clock.fastForward(8_000);
  await expect(page.locator("#account-form-error")).toContainText("timed out");
  await expect(page.locator('#account-form button[type="submit"]')).toBeEnabled();

  await page.evaluate(() => { window.__replyAccountRegister = true; });
  await page.locator("#account-form").evaluate((form) => form.requestSubmit());
  await expect.poll(() => page.evaluate(async () => (await import("/clientState.js")).state.account?.account?.id)).toBe("browser-test-account");
  expect(await page.evaluate(() => window.__accountEvents.filter((event) => event === "account-register").length)).toBe(2);
});

test("late bootstrap and restore replies cannot restore signed-out account data", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440x900", DESKTOP_ONLY);
  await page.goto("/");
  const accountA = accountRecord({ id: "browser-account-a", username: "privatea", displayName: "PRIVATEA" });
  await page.evaluate(seedLateReplyTab, accountA);

  expect(await page.evaluate(() => window.__accountAVisibleBeforeLogout)).toBe(true);
  await expect.poll(() => page.evaluate(() => typeof window.__resolveLateSession)).toBe("function");
  await page.evaluate(() => window.__startLogout());
  expect(await page.evaluate(async () => (await import("/clientState.js")).state.account)).toBeNull();
  await page.evaluate(() => window.__resolveLateSession({ ok: true, status: 200, json: async () => ({ success: true, account: window.__accountA }) }));
  await page.evaluate(() => window.__logoutPromise);
  expect(await page.evaluate(() => window.__logoutSessionHeader)).toBe("legacy-a");
  await page.evaluate(() => window.__updateAccount({
    sessionToken: "token-b",
    account: { id: "browser-account-b", username: "privateb", displayName: "PRIVATE B", color: "#d74438", avatarGrid: null, achievements: [], stats: {}, history: [], privacy: {} },
  }));
  await new Promise(resolve => setTimeout(resolve, 0));
  await expect.poll(() => page.evaluate(async () => (await import("/clientState.js")).state.account?.account?.id)).toBe("browser-account-b");
  await expect(page.locator("#social-page-content")).not.toContainText("PRIVATE FRIEND");
  await expect(page.locator("#social-page-content")).not.toContainText("PRIVATE NOTICE");
  expect(await page.evaluate(async () => (await import("/clientSanitize.js")).loadAccountSession()?.account?.id)).toBe("browser-account-b");
});

test("a non-null cross-tab account replacement clears the previous account state", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440x900", DESKTOP_ONLY);
  const context = await browser.newContext();
  const pageA = await context.newPage();
  const pageB = await context.newPage();
  const accountA = accountRecord({ id: "browser-account-a", username: "privatea", displayName: "PRIVATE A" });
  const accountB = accountRecord({ id: "browser-account-b", username: "privateb", displayName: "PRIVATE B" });
  const logoutStarted = signal();
  const logoutGate = gate();
  const bSessionStarted = signal();
  const bSessionGate = gate();
  let sessionCalls = 0;
  await context.route("**/account/logout", async route => {
    logoutStarted.fire();
    await logoutGate.promise;
    await route.fulfill({ status: 204, headers: { "Set-Cookie": CLEARED_SESSION_COOKIE }, body: "" });
  });
  await context.route("**/account/session", async route => {
    sessionCalls += 1;
    if (sessionCalls !== 1) {
      await route.fulfill({ status: 200, headers: jsonHeaders(), body: sessionReply(accountB) });
      return;
    }
    bSessionStarted.fire();
    await bSessionGate.promise;
    await route.fulfill({ status: 200, headers: jsonHeaders(sessionCookie("account-b")), body: sessionReply(accountB) });
  });
  try {
    await Promise.all([pageA.goto("/"), pageB.goto("/")]);
    await context.addCookies([{ name: "poorup_session", value: "account-a", url: new URL(pageA.url()).origin }]);
    await pageA.evaluate(seedCrossTabOwner, accountA);
    await pageB.evaluate(seedCrossTabWatcher, { accountA, accountB });
    await pageB.evaluate(() => window.__switchToB());
    await logoutStarted.promise;
    await expect.poll(() => pageA.evaluate(async () => (await import("/clientState.js")).state.account)).toBeNull();
    expect(await pageA.evaluate(async () => {
      const { state } = await import("/clientState.js");
      return { friends: state.social.friends, selectedPlayer: state.selectedPlayer, stored: JSON.parse(localStorage.getItem("poorup.account.session.v1"))?.account?.id };
    })).toEqual({ friends: [], selectedPlayer: null, stored: "browser-account-b" });
    expect(sessionCalls).toBe(0);
    logoutGate.open();
    await bSessionStarted.promise;
    expect(await pageA.evaluate(async () => (await import("/clientState.js")).state.account)).toBeNull();
    expect((await context.cookies()).some(cookie => cookie.name === "poorup_session")).toBe(false);
    bSessionGate.open();
    await expect.poll(() => pageA.evaluate(async () => (await import("/clientState.js")).state.account?.account?.id)).toBe("browser-account-b");
    expect(await pageA.evaluate(() => window.__accountReadyReconnects)).toBe(1);
    expect(await readSessionCookie(context)).toBe("account-b");
  } finally {
    await context.close();
  }
});

test("another tab waits for a pending logout before exchanging its new session cookie", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440x900", DESKTOP_ONLY);
  const context = await browser.newContext();
  const pageA = await context.newPage();
  const pageB = await context.newPage();
  const accountA = accountRecord({ id: "logout-account-a", username: "logouta", displayName: "LOGOUT A" });
  const accountB = accountRecord({ id: "logout-account-b", username: "logoutb", displayName: "LOGOUT B" });
  const logoutStarted = signal();
  const sessionStarted = signal();
  const logoutGateway = gate();
  let sessionCalls = 0;
  await context.route("**/account/logout", async route => {
    logoutStarted.fire();
    await logoutGateway.promise;
    await route.fulfill({ status: 204, headers: { "Set-Cookie": CLEARED_SESSION_COOKIE }, body: "" });
  });
  await context.route("**/account/session", async route => {
    sessionCalls += 1;
    if (sessionCalls === 1) sessionStarted.fire();
    const cookie = sessionCalls === 1 ? sessionCookie("account-b") : undefined;
    await route.fulfill({ status: 200, headers: jsonHeaders(cookie), body: sessionReply(accountB) });
  });
  try {
    await Promise.all([pageA.goto("/"), pageB.goto("/")]);
    await context.addCookies([{ name: "poorup_session", value: "account-a", url: new URL(pageA.url()).origin }]);
    await pageA.evaluate(seedLogoutTab, accountA);
    await pageB.evaluate(seedWaitingWatcher, { accountA, accountB });

    await pageA.evaluate(() => window.__startLogout());
    await logoutStarted.promise;
    await pageB.evaluate(() => window.__startLoginB());
    await pageB.waitForTimeout(150);
    expect(sessionCalls).toBe(0);
    logoutGateway.open();
    await sessionStarted.promise;
    await expect.poll(() => pageA.evaluate(async () => (await import("/clientState.js")).state.account?.account?.id)).toBe("logout-account-b");
    expect(sessionCalls).toBeGreaterThanOrEqual(1);
    expect(await readSessionCookie(context)).toBe("account-b");
  } finally {
    await context.close();
  }
});

test("an auth transition still releases an interrupted account submit", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440x900", DESKTOP_ONLY);
  await page.goto("/");
  await page.clock.install();
  await page.evaluate(async () => {
    const { configureAccountIdentity, openAccountModal, beginAccountAuthTransition } = await import("/clientAccountIdentity.js");
    window.__beginAuthTransition = beginAccountAuthTransition;
    configureAccountIdentity({ emitServer() {} });
    openAccountModal("login");
  });
  await page.locator("#account-username-input").fill("clock_test");
  await page.locator("#account-password-input").fill("clock-test-password-1");
  await page.locator("#account-form").evaluate((form) => form.requestSubmit());
  const submit = page.locator('#account-form button[type="submit"]');
  await expect(submit).toBeDisabled();
  await page.evaluate(() => window.__beginAuthTransition());
  await page.clock.fastForward(8_000);
  await expect(submit).toBeEnabled();
});

test("direct logout drops a private profile draft and its edit target", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440x900", DESKTOP_ONLY);
  await page.goto("/");
  const result = await page.evaluate(async () => {
    const [{ state }, identity] = await Promise.all([import("/clientState.js"), import("/clientAccountIdentity.js")]);
    state.account = { sessionToken: "legacy-draft", account: {
      id: "draft-account", username: "draft", displayName: "DRAFT", color: "#d74438", avatarGrid: null, achievements: [],
    } };
    state.profileDraft = {
      designName: "PRIVATE DRAFT", color: "#d74438", paintColor: "#222222", tool: "paint",
      grid: Array.from({ length: 8 }, () => Array(8).fill(null)),
    };
    state.editingProfileId = "private-profile";
    identity.configureAccountIdentity({ emitServer() {}, notice() {} });
    window.fetch = async () => ({ ok: true, status: 204 });
    await identity.logoutAccount();
    return { draft: state.profileDraft, editingProfileId: state.editingProfileId };
  });
  expect(result).toEqual({ draft: null, editingProfileId: null });
});

test("a stalled cookie-session fetch aborts and releases queued cookie work", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440x900", "One desktop browser project proves the cookie queue.");
  const accountA = accountRecord({ id: "timeout-account-a", username: "timeouta", displayName: "TIMEOUT A" });
  const accountB = accountRecord({ id: "timeout-account-b", username: "timeoutb", displayName: "TIMEOUT B", color: "#2255ee" });
  const context = await browser.newContext();
  const page = await context.newPage();
  const firstStarted = signal();
  const secondStarted = signal();
  const logoutStarted = signal();
  const lateAttempted = signal();
  const lateGate = gate();
  await context.route("**/account/session", async route => {
    const token = await route.request().headerValue("x-poorup-session-token");
    if (token === "legacy-timeout-a") {
      firstStarted.fire();
      await lateGate.promise;
      try {
        await route.fulfill({ status: 200, headers: jsonHeaders(sessionCookie("late-a")), body: sessionReply(accountA) });
      } catch { /* the request should already be aborted */ }
      lateAttempted.fire();
      return;
    }
    if (token === "legacy-timeout-b") {
      secondStarted.fire();
      await route.fulfill({ status: 200, headers: jsonHeaders(sessionCookie("account-b")), body: sessionReply(accountB) });
      return;
    }
    await route.fulfill({ status: 401, headers: jsonHeaders(), body: JSON.stringify({ success: false }) });
  });
  await context.route("**/account/logout", async route => {
    logoutStarted.fire();
    await route.fulfill({ status: 204, headers: { "Set-Cookie": CLEARED_SESSION_COOKIE }, body: "" });
  });
  try {
    await page.goto("/");
    await page.clock.install();
    await page.evaluate(seedStalledCookieTab, { accountA, accountB });
    await firstStarted.promise;
    await page.evaluate(() => window.__logoutTimedOutAccount());
    await page.evaluate(() => window.__loginCookieAccountB());
    expect(await page.evaluate(() => window.__sessionFetchHadSignal)).toBe(true);
    await page.clock.fastForward(8_000);
    await expect.poll(() => page.evaluate(() => window.__sessionAbortCount), { timeout: 3_000 }).toBe(1);
    await logoutStarted.promise;
    await page.evaluate(() => window.__logoutPromise);
    await secondStarted.promise;
    await expect.poll(() => page.evaluate(async () => {
      const { state } = await import("/clientState.js");
      return state.account?.account?.id === "timeout-account-b" && state.account.sessionToken === "";
    })).toBe(true);
    expect(await readSessionCookie(context)).toBe("account-b");
    lateGate.open();
    await lateAttempted.promise;
    expect(await readSessionCookie(context)).toBe("account-b");
  } finally {
    lateGate.open();
    await context.close();
  }
});

test("a consumed legacy token does not invalidate the cookie session after socket reconnect", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440x900", DESKTOP_ONLY);
  await page.goto("/");
  const outcome = await page.evaluate(probeLegacyTokenReconnect);
  expect(outcome.accountAfterReconnect).toBe(outcome.accountId);
  expect(outcome.tokenAfterExchange).toBe("");
  expect(outcome.legacyToken).not.toBe("");
  expect(outcome.reconnectRequested).toBe(true);
  expect(outcome.socialBeforeReconnect).toBe(false);
  expect(outcome.socialSuccess).toBe(true);
});
