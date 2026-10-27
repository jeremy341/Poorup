import { test, expect } from "@playwright/test";

test("lost account acknowledgements release registration and account submit gates", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440x900", "One desktop browser project proves the account flow.");
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
  test.skip(testInfo.project.name !== "desktop-1440x900", "One desktop browser project proves the account flow.");
  await page.goto("/");
  await page.evaluate(async () => {
    const [{ state, saveAccountSession }, identity, social, listeners] = await Promise.all([
      import("/clientState.js"),
      import("/clientAccountIdentity.js"),
      import("/clientSocialSurfaces.js"),
      import("/clientSocketListeners.js"),
    ]);
    const account = (id, username) => ({
      id, username, displayName: username.toUpperCase(), color: "#d74438", avatarGrid: null,
      achievements: [], stats: {}, history: [], privacy: {},
    });
    window.__accountA = account("browser-account-a", "privatea");
    const accountA = window.__accountA;
    const originalFetch = window.fetch.bind(window);
    window.__logoutSessionHeader = "";
    window.fetch = (url, options = {}) => {
      if (url === "/account/session" && options.headers?.["x-poorup-session-token"] === "legacy-a") {
        return new Promise(resolve => { window.__resolveLateSession = resolve; });
      }
      if (url === "/account/logout") {
        window.__logoutSessionHeader = options.headers?.["x-poorup-session-token"] || "";
        return Promise.resolve({ ok: true, status: 204, json: async () => ({ success: true }) });
      }
      if (url === "/account/session") return Promise.resolve({ ok: true, status: 200, json: async () => ({ success: true }) });
      return originalFetch(url, options);
    };
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
  });

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
  test.skip(testInfo.project.name !== "desktop-1440x900", "One desktop browser project proves the account flow.");
  const context = await browser.newContext();
  const pageA = await context.newPage();
  const pageB = await context.newPage();
  let releaseOldLogout;
  let releaseBSession;
  let sessionCalls = 0;
  let signalLogoutStarted;
  let signalBSessionStarted;
  const logoutStarted = new Promise(resolve => { signalLogoutStarted = resolve; });
  const bSessionStarted = new Promise(resolve => { signalBSessionStarted = resolve; });
  const logoutGate = new Promise(resolve => { releaseOldLogout = resolve; });
  const bSessionGate = new Promise(resolve => { releaseBSession = resolve; });
  await context.route("**/account/logout", async route => {
    signalLogoutStarted();
    await logoutGate;
    await route.fulfill({ status: 204, headers: { "Set-Cookie": "poorup_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax" }, body: "" });
  });
  await context.route("**/account/session", async route => {
    sessionCalls += 1;
    if (sessionCalls === 1) {
      signalBSessionStarted();
      await bSessionGate;
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json", "Set-Cookie": "poorup_session=account-b; Path=/; HttpOnly; SameSite=Lax" },
        body: JSON.stringify({ success: true, account: { id: "browser-account-b", username: "privateb", displayName: "PRIVATE B", color: "#d74438", avatarGrid: null, achievements: [], stats: {}, history: [], privacy: {} } }),
      });
      return;
    }
    await route.fulfill({ status: 200, headers: { "content-type": "application/json" }, body: JSON.stringify({ success: true, account: { id: "browser-account-b", username: "privateb", displayName: "PRIVATE B", color: "#d74438", avatarGrid: null, achievements: [], stats: {}, history: [], privacy: {} } }) });
  });
  try {
    await Promise.all([pageA.goto("/"), pageB.goto("/")]);
    await context.addCookies([{ name: "poorup_session", value: "account-a", url: new URL(pageA.url()).origin }]);
    await pageA.evaluate(async () => {
      const [{ state }, identity, sanitize, listeners] = await Promise.all([
        import("/clientState.js"), import("/clientAccountIdentity.js"), import("/clientSanitize.js"), import("/clientSocketListeners.js"),
      ]);
      const accountA = { id: "browser-account-a", username: "privatea", displayName: "PRIVATE A", color: "#d74438", avatarGrid: null, achievements: [], stats: {}, history: [], privacy: {} };
      state.account = { sessionToken: "", account: accountA };
      sanitize.persistAccountSession({ sessionToken: "", account: accountA });
      state.social = { friends: [{ id: "friend-a" }], requests: [], outgoing: [], invites: [], notifications: [], recentPlayers: [] };
      state.selectedPlayer = { accountId: "selected-a", displayName: "PRIVATE A" };
      identity.configureAccountIdentity({ emitServer() {}, notice() {} });
      window.__accountReadyReconnects = 0;
      listeners.configureSocketListeners(null, { renderAll() {}, syncAudioButtons() {}, syncHomeMusic() {}, renderSocialSurfaces() {}, closePlayerSurface() {}, reconnectSocket() { window.__accountReadyReconnects += 1; } });
    });
    await pageB.evaluate(async () => {
      const [{ state }, identity, sanitize] = await Promise.all([
        import("/clientState.js"), import("/clientAccountIdentity.js"), import("/clientSanitize.js"),
      ]);
      const accountA = { id: "browser-account-a", username: "privatea", displayName: "PRIVATE A", color: "#d74438", avatarGrid: null, achievements: [], stats: {}, history: [], privacy: {} };
      state.account = { sessionToken: "", account: sanitize.loadAccountSession()?.account || accountA };
      identity.configureAccountIdentity({ emitServer() {}, notice() {} });
      window.__accountB = { id: "browser-account-b", username: "privateb", displayName: "PRIVATE B", color: "#d74438", avatarGrid: null, achievements: [], stats: {}, history: [], privacy: {} };
      window.__switchToB = () => identity.updateAccountFromResponse({ sessionToken: "legacy-b", account: window.__accountB });
    });
    await pageB.evaluate(() => window.__switchToB());
    await logoutStarted;
    await expect.poll(() => pageA.evaluate(async () => (await import("/clientState.js")).state.account)).toBeNull();
    expect(await pageA.evaluate(async () => {
      const { state } = await import("/clientState.js");
      return { friends: state.social.friends, selectedPlayer: state.selectedPlayer, stored: JSON.parse(localStorage.getItem("poorup.account.session.v1"))?.account?.id };
    })).toEqual({ friends: [], selectedPlayer: null, stored: "browser-account-b" });
    expect(sessionCalls).toBe(0);
    releaseOldLogout();
    await bSessionStarted;
    expect(await pageA.evaluate(async () => (await import("/clientState.js")).state.account)).toBeNull();
    expect((await context.cookies()).some(cookie => cookie.name === "poorup_session")).toBe(false);
    releaseBSession();
    await expect.poll(() => pageA.evaluate(async () => (await import("/clientState.js")).state.account?.account?.id)).toBe("browser-account-b");
    expect(await pageA.evaluate(() => window.__accountReadyReconnects)).toBe(1);
    expect((await context.cookies()).find(cookie => cookie.name === "poorup_session")?.value).toBe("account-b");
  } finally {
    await context.close();
  }
});

test("another tab waits for a pending logout before exchanging its new session cookie", async ({ browser }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440x900", "One desktop browser project proves the account flow.");
  const context = await browser.newContext();
  const pageA = await context.newPage();
  const pageB = await context.newPage();
  let releaseLogoutResponse;
  let signalLogoutStarted;
  let signalSessionStarted;
  let sessionCalls = 0;
  const logoutStarted = new Promise(resolve => { signalLogoutStarted = resolve; });
  const sessionStarted = new Promise(resolve => { signalSessionStarted = resolve; });
  const logoutGate = new Promise(resolve => { releaseLogoutResponse = resolve; });
  await context.route("**/account/logout", async route => {
    signalLogoutStarted();
    await logoutGate;
    await route.fulfill({ status: 204, headers: { "Set-Cookie": "poorup_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax" }, body: "" });
  });
  await context.route("**/account/session", async route => {
    sessionCalls += 1;
    if (sessionCalls === 1) signalSessionStarted();
    await route.fulfill({
      status: 200,
      headers: sessionCalls === 1
        ? { "content-type": "application/json", "Set-Cookie": "poorup_session=account-b; Path=/; HttpOnly; SameSite=Lax" }
        : { "content-type": "application/json" },
      body: JSON.stringify({ success: true, account: { id: "logout-account-b", username: "logoutb", displayName: "LOGOUT B", color: "#d74438", avatarGrid: null, achievements: [], stats: {}, history: [], privacy: {} } }),
    });
  });
  try {
    await Promise.all([pageA.goto("/"), pageB.goto("/")]);
    await context.addCookies([{ name: "poorup_session", value: "account-a", url: new URL(pageA.url()).origin }]);
    await pageA.evaluate(async () => {
      const [{ state }, identity, sanitize, listeners] = await Promise.all([
        import("/clientState.js"), import("/clientAccountIdentity.js"), import("/clientSanitize.js"), import("/clientSocketListeners.js"),
      ]);
      const accountA = { id: "logout-account-a", username: "logouta", displayName: "LOGOUT A", color: "#d74438", avatarGrid: null, achievements: [], stats: {}, history: [], privacy: {} };
      state.account = { sessionToken: "", account: accountA };
      sanitize.persistAccountSession({ sessionToken: "", account: accountA });
      identity.configureAccountIdentity({ emitServer() {}, notice() {} });
      listeners.configureSocketListeners(null, { renderAll() {}, syncAudioButtons() {}, syncHomeMusic() {}, renderSocialSurfaces() {}, closePlayerSurface() {} });
      window.__startLogout = () => { window.__logoutPromise = identity.logoutAccount(); };
    });
    await pageB.evaluate(async () => {
      const [{ state }, identity, sanitize] = await Promise.all([
        import("/clientState.js"), import("/clientAccountIdentity.js"), import("/clientSanitize.js"),
      ]);
      const accountA = { id: "logout-account-a", username: "logouta", displayName: "LOGOUT A", color: "#d74438", avatarGrid: null, achievements: [], stats: {}, history: [], privacy: {} };
      const accountB = { id: "logout-account-b", username: "logoutb", displayName: "LOGOUT B", color: "#d74438", avatarGrid: null, achievements: [], stats: {}, history: [], privacy: {} };
      state.account = { sessionToken: "", account: sanitize.loadAccountSession()?.account || accountA };
      window.__sessionStarted = false;
      window.__accountB = accountB;
      identity.configureAccountIdentity({ emitServer() {}, notice() {} });
      window.__startLoginB = () => identity.updateAccountFromResponse({ sessionToken: "logout-legacy-b", account: accountB });
    });

    await pageA.evaluate(() => window.__startLogout());
    await logoutStarted;
    await pageB.evaluate(() => window.__startLoginB());
    await pageB.waitForTimeout(150);
    expect(sessionCalls).toBe(0);
    releaseLogoutResponse();
    await sessionStarted;
    await expect.poll(() => pageA.evaluate(async () => (await import("/clientState.js")).state.account?.account?.id)).toBe("logout-account-b");
    expect(sessionCalls).toBeGreaterThanOrEqual(1);
    expect((await context.cookies()).find(cookie => cookie.name === "poorup_session")?.value).toBe("account-b");
  } finally {
    await context.close();
  }
});

test("an auth transition still releases an interrupted account submit", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440x900", "One desktop browser project proves the account flow.");
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
  test.skip(testInfo.project.name !== "desktop-1440x900", "One desktop browser project proves the account flow.");
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
  const context = await browser.newContext();
  const page = await context.newPage();
  let releaseLateSession;
  let signalFirstSessionStarted;
  let signalLogoutStarted;
  let signalSecondSessionStarted;
  let signalLateResponseAttempted;
  const firstSessionStarted = new Promise(resolve => { signalFirstSessionStarted = resolve; });
  const logoutStarted = new Promise(resolve => { signalLogoutStarted = resolve; });
  const secondSessionStarted = new Promise(resolve => { signalSecondSessionStarted = resolve; });
  const lateResponseAttempted = new Promise(resolve => { signalLateResponseAttempted = resolve; });
  const lateSessionGate = new Promise(resolve => { releaseLateSession = resolve; });
  await context.route("**/account/session", async route => {
    const token = await route.request().headerValue("x-poorup-session-token");
    if (token === "legacy-timeout-a") {
      signalFirstSessionStarted();
      await lateSessionGate;
      try {
        await route.fulfill({
          status: 200,
          headers: { "content-type": "application/json", "Set-Cookie": "poorup_session=late-a; Path=/; HttpOnly; SameSite=Lax" },
          body: JSON.stringify({ success: true, account: { id: "timeout-account-a", username: "timeouta", displayName: "TIMEOUT A", color: "#d74438", avatarGrid: null, achievements: [], stats: {}, history: [], privacy: {} } }),
        });
      } catch { /* the request should already be aborted */ }
      signalLateResponseAttempted();
      return;
    }
    if (token === "legacy-timeout-b") {
      signalSecondSessionStarted();
      await route.fulfill({
        status: 200,
        headers: { "content-type": "application/json", "Set-Cookie": "poorup_session=account-b; Path=/; HttpOnly; SameSite=Lax" },
        body: JSON.stringify({ success: true, account: { id: "timeout-account-b", username: "timeoutb", displayName: "TIMEOUT B", color: "#2255ee", avatarGrid: null, achievements: [], stats: {}, history: [], privacy: {} } }),
      });
      return;
    }
    await route.fulfill({ status: 401, headers: { "content-type": "application/json" }, body: JSON.stringify({ success: false }) });
  });
  await context.route("**/account/logout", async route => {
    signalLogoutStarted();
    await route.fulfill({ status: 204, headers: { "Set-Cookie": "poorup_session=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax" }, body: "" });
  });
  try {
    await page.goto("/");
    await page.clock.install();
    await page.evaluate(async () => {
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
      window.__loginCookieAccountB = () => identity.updateAccountFromResponse({
        sessionToken: "legacy-timeout-b",
        account: { id: "timeout-account-b", username: "timeoutb", displayName: "TIMEOUT B", color: "#2255ee", avatarGrid: null, achievements: [], stats: {}, history: [], privacy: {} },
      });
      identity.updateAccountFromResponse({
        sessionToken: "legacy-timeout-a",
        account: { id: "timeout-account-a", username: "timeouta", displayName: "TIMEOUT A", color: "#d74438", avatarGrid: null, achievements: [], stats: {}, history: [], privacy: {} },
      });
    });
    await firstSessionStarted;
    await page.evaluate(() => window.__logoutTimedOutAccount());
    await page.evaluate(() => window.__loginCookieAccountB());
    expect(await page.evaluate(() => window.__sessionFetchHadSignal)).toBe(true);
    await page.clock.fastForward(8_000);
    await expect.poll(() => page.evaluate(() => window.__sessionAbortCount), { timeout: 3_000 }).toBe(1);
    await logoutStarted;
    await page.evaluate(() => window.__logoutPromise);
    await secondSessionStarted;
    await expect.poll(() => page.evaluate(async () => {
      const { state } = await import("/clientState.js");
      return state.account?.account?.id === "timeout-account-b" && state.account.sessionToken === "";
    })).toBe(true);
    expect((await context.cookies()).find(cookie => cookie.name === "poorup_session")?.value).toBe("account-b");
    releaseLateSession();
    await lateResponseAttempted;
    expect((await context.cookies()).find(cookie => cookie.name === "poorup_session")?.value).toBe("account-b");
  } finally {
    releaseLateSession?.();
    await context.close();
  }
});
test("a consumed legacy token does not invalidate the cookie session after socket reconnect", async ({ page }, testInfo) => {
  test.skip(testInfo.project.name !== "desktop-1440x900", "One desktop browser project proves the account flow.");
  await page.goto("/");
  const outcome = await page.evaluate(async () => {
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
    identity.configureAccountIdentity({
      emitServer(event, payload, callback) {
        if (event === "restore-session") socket.emit(event, { ...payload, clientId: state.clientId }, callback);
      },
      notice() {},
      reconnectSocket() { window.__reconnectRequested = true; },
    });
    listeners.configureSocketListeners(socket, {
      emitServer(event, payload, callback) {
        if (event === "restore-session") socket.emit(event, { ...payload, clientId: state.clientId }, callback);
      },
      setConnectionStatus() {},
      renderAll() {},
      syncAudioButtons() {},
      syncHomeMusic() {},
      renderSocialSurfaces() {},
      closePlayerSurface() {},
    });
    await new Promise((resolve) => { socket.once("connect", resolve); socket.connect(); });
    const username = "recon" + Date.now().toString(36).slice(-8);
    const registration = await new Promise((resolve) => socket.emit("account-register", {
      username, displayName: "Reconnect Probe", password: "reconnect-probe-password",
    }, resolve));
    if (!registration?.success) throw new Error("Account registration failed: " + JSON.stringify(registration));
    const login = await new Promise((resolve) => socket.emit("account-login", {
      username, password: "reconnect-probe-password",
    }, resolve));
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
    const socialBeforeReconnect = await new Promise((resolve) => socket.emit("get-social-data", {}, resolve));
    const reconnected = new Promise((resolve) => socket.once("connect", resolve));
    socket.disconnect();
    socket.connect();
    await reconnected;
    await new Promise((resolve) => setTimeout(resolve, 150));
    const social = await new Promise((resolve) => socket.emit("get-social-data", {}, resolve));
    return {
      accountId,
      accountAfterReconnect: state.account?.account?.id || null,
      tokenAfterExchange,
      legacyToken: window.__legacyToken,
      reconnectRequested: window.__reconnectRequested === true,
      socialBeforeReconnect: socialBeforeReconnect?.success === true,
      socialSuccess: social?.success === true,
    };
  });
  expect(outcome.accountAfterReconnect).toBe(outcome.accountId);
  expect(outcome.tokenAfterExchange).toBe("");
  expect(outcome.legacyToken).not.toBe("");
  expect(outcome.reconnectRequested).toBe(true);
  expect(outcome.socialBeforeReconnect).toBe(false);
  expect(outcome.socialSuccess).toBe(true);
});
