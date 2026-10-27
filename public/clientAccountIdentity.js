/* ============================================================
   ACCOUNT IDENTITY: optional Poorup accounts and the achievement
   collection. Socket calls and chat announcements are injected by
   the entry module; profile/home renderers are imported directly.
   ============================================================ */
import { $, esc } from "./clientDom.js";
import { ACHIEVEMENTS, achievementIconHTML } from "./clientAchievements.js";
import { PARLOR_PATROL_ENABLED } from "./clientParlorPatrolFlag.js";
import { state, saveAccountSession, saveUnlockedAchievements, activeAppearance, buildPlayers } from "./clientState.js";
import { clearLocalPlayerData, loadGuestAlias } from "./clientSanitize.js";
import { DEFAULT_THEME_ID } from "./clientThemeData.js";
import { openSurface, closeSurface, focusSurface, setSurfaceReturnFocus } from "./clientSurfaces.js";
import { adoptAccountAppearance } from "./clientAccountAppearance.js";
import { renderAccountPanel, applyProfileToHomeUI, renderProfileEditor, renderProfileLibrary, formatStatDate } from "./clientProfileRender.js";
import { closeButtonHTML } from "./clientCloseButton.js";

function noop() {}
let host = { emitServer: noop, say: noop, notice: noop, announceActionStatus: noop, syncAudioButtons: noop, syncHomeMusic: noop, reconcileSignedOutState: noop };
let accountAuthGeneration = 0;
let socialStateGeneration = -1;
const ACCOUNT_ACK_TIMEOUT_MS = 8_000;
const ACCOUNT_SESSION_TIMEOUT_MS = 8_000;
const ACCOUNT_LOGOUT_TIMEOUT_MS = 8_000;
export const ACCOUNT_SESSION_READY_KEY = "poorup.account.session.ready.v1";
let pendingAccountLogout = Promise.resolve(true);
let pendingCookieMutation = Promise.resolve();
let pendingSessionExchange = null;
let cookieMutationSequence = 0;
const COOKIE_MUTATION_LOCK_NAME = "poorup.account.cookie-session.v1";
const COOKIE_MUTATION_WAIT_MS = 20_000;
const COOKIE_MUTATION_TTL_MS = 90_000;
const COOKIE_MUTATION_PREFIX = "poorup.account.cookie-mutation.v1:";
const LOGOUT_BARRIER_PREFIX = "poorup.account.logout-pending.v1:";
const COOKIE_MUTATION_OWNER = `${String(state.clientId || "tab")}:${Math.random().toString(36).slice(2)}`;

export function configureAccountIdentity(hooks) {
  host = { ...host, ...hooks };
}

export function getAccountAuthGeneration() {
  return accountAuthGeneration;
}

export function isAccountAuthGenerationCurrent(generation) {
  return generation === accountAuthGeneration;
}

export function guardAccountAuthCallback(callback, generation = accountAuthGeneration) {
  return (...args) => {
    if (!isAccountAuthGenerationCurrent(generation)) return undefined;
    return callback(...args);
  };
}

export function beginAccountAuthTransition() {
  accountAuthGeneration += 1;
  return accountAuthGeneration;
}

export function markAccountSocialStateFresh(generation) {
  if (isAccountAuthGenerationCurrent(generation) && state.account?.account?.id) {
    socialStateGeneration = generation;
  }
}

export function canApplyAccountSocialUpdate() {
  return Boolean(state.account?.account?.id) && socialStateGeneration === accountAuthGeneration;
}

export function resetAccountScopedClientState() {
  beginAccountAuthTransition();
  socialStateGeneration = -1;
  state.social = { friends: [], requests: [], outgoing: [], invites: [], notifications: [], recentPlayers: [] };
  state.socialSearchResults = [];
  state.socialSearchQuery = "";
  state.socialSearchLoading = false;
  state.socialSearchError = "";
  state.socialLoading = false;
  state.socialError = "";
  state.socialStale = false;
  state.selectedPlayer = null;
  state.selectedPlayerRelationship = "none";
  state.selectedPlayerView = "profile";
  state.selectedPlayerHistory = null;
  state.selectedPlayerHistoryScope = "all";
  state.rankingSearchQuery = "";
  state.rankingSearchResults = [];
  state.rankingSearchExpanded = false;
  state.rankingSearchLoading = false;
  state.rankingSearchError = "";
  state.leaderboard = {
    ...state.leaderboard,
    rows: [],
    snapshots: {},
    generatedAt: null,
    loading: false,
    error: "",
    stale: false,
    requestId: (state.leaderboard?.requestId || 0) + 1,
  };
  return accountAuthGeneration;
}

function emitAccountRequest(eventName, payload, callback, generation = null, onStaleResponse = null) {
  let settled = false;
  const finish = (response) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    if (generation !== null && !isAccountAuthGenerationCurrent(generation)) {
      onStaleResponse?.(response);
      return;
    }
    callback(response && typeof response === "object" ? response : { success: false, error: "Account request failed." });
  };
  const timeout = setTimeout(() => finish({
    success: false,
    code: "ACK_TIMEOUT",
    error: "Account request timed out. Please try again.",
  }), ACCOUNT_ACK_TIMEOUT_MS);
  try {
    host.emitServer(eventName, payload, finish);
  } catch {
    finish({ success: false, error: "Account request failed. Please try again." });
  }
}

function postAccountLogout(token) {
  if (typeof fetch !== "function") return Promise.resolve(false);
  const options = { method: "POST", credentials: "include" };
  if (token) options.headers = { "x-poorup-session-token": token };
  const controller = typeof AbortController === "function" ? new AbortController() : null;
  if (controller) options.signal = controller.signal;
  const timeout = controller ? setTimeout(() => controller.abort(), ACCOUNT_LOGOUT_TIMEOUT_MS) : null;
  return fetch("/account/logout", options)
    .then((response) => response?.ok === true)
    .catch(() => false)
    .finally(() => { if (timeout !== null) clearTimeout(timeout); });
}

function removeStorageMarker(key) {
  if (!key) return;
  try { localStorage.removeItem(key); } catch { /* cross-tab coordination is best effort */ }
}

function addStorageMarker(prefix, value) {
  const key = `${prefix}${COOKIE_MUTATION_OWNER}:${++cookieMutationSequence}`;
  try {
    localStorage.setItem(key, JSON.stringify({ ...value, expiresAt: Date.now() + COOKIE_MUTATION_TTL_MS }));
    return key;
  } catch { return ""; }
}

function readActiveStorageMarkers(prefix) {
  const active = [];
  try {
    const now = Date.now();
    for (let index = localStorage.length - 1; index >= 0; index -= 1) {
      const key = localStorage.key(index);
      if (typeof key !== "string" || !key.startsWith(prefix)) continue;
      let marker = null;
      try { marker = JSON.parse(localStorage.getItem(key) || "null"); } catch { /* a malformed marker is removed */ }
      if (!Number.isFinite(Number(marker?.expiresAt)) || Number(marker.expiresAt) <= now) {
        removeStorageMarker(key);
        continue;
      }
      active.push({ key, startedAt: Number(marker.startedAt) || 0 });
    }
  } catch { return null; }
  return active;
}

function beginAccountLogoutBarrier() {
  return addStorageMarker(LOGOUT_BARRIER_PREFIX, { startedAt: Date.now() });
}

async function waitForCrossTabLogoutBarrier() {
  const deadline = Date.now() + COOKIE_MUTATION_WAIT_MS;
  while (true) {
    const markers = readActiveStorageMarkers(LOGOUT_BARRIER_PREFIX);
    if (markers === null || markers.length === 0) return true;
    const remaining = deadline - Date.now();
    if (remaining <= 0) return false;
    await new Promise(resolve => setTimeout(resolve, Math.min(50, remaining)));
  }
}

async function acquireFallbackCookieMutation() {
  const startedAt = Date.now();
  const key = `${COOKIE_MUTATION_PREFIX}${COOKIE_MUTATION_OWNER}:${++cookieMutationSequence}`;
  try {
    localStorage.setItem(key, JSON.stringify({ startedAt, expiresAt: startedAt + COOKIE_MUTATION_TTL_MS }));
  } catch { return null; }
  const deadline = startedAt + COOKIE_MUTATION_WAIT_MS;
  while (Date.now() < deadline) {
    const active = readActiveStorageMarkers(COOKIE_MUTATION_PREFIX);
    if (active === null) {
      removeStorageMarker(key);
      return null;
    }
    active.sort((left, right) => left.startedAt - right.startedAt || left.key.localeCompare(right.key));
    if (active[0]?.key === key) return () => removeStorageMarker(key);
    await new Promise(resolve => setTimeout(resolve, 50));
  }
  removeStorageMarker(key);
  return null;
}

function withAccountCookieMutation(operation) {
  const run = async () => {
    const locks = globalThis.navigator?.locks;
    if (typeof locks?.request === "function" && typeof AbortController === "function") {
      const controller = new AbortController();
      let acquired = false;
      const timeout = setTimeout(() => controller.abort(), COOKIE_MUTATION_WAIT_MS);
      try {
        return await locks.request(COOKIE_MUTATION_LOCK_NAME, { mode: "exclusive", signal: controller.signal }, async () => {
          acquired = true;
          clearTimeout(timeout);
          return operation();
        });
      } catch (error) {
        if (!acquired && controller.signal.aborted) return null;
        throw error;
      } finally {
        clearTimeout(timeout);
      }
    }
    const release = await acquireFallbackCookieMutation();
    if (!release) return null;
    try { return await operation(); } finally { release(); }
  };
  const queued = pendingCookieMutation.then(run, run);
  pendingCookieMutation = queued.then(() => undefined, () => undefined);
  return queued;
}

function queueAccountLogout(token) {
  const clearBarrier = beginAccountLogoutBarrier();
  const request = () => withAccountCookieMutation(() => postAccountLogout(token)).then(result => result === true);
  const queued = pendingAccountLogout.then(request, request)
    .then(confirmed => confirmed ? true : request())
    .catch(() => false)
    .finally(() => removeStorageMarker(clearBarrier));
  pendingAccountLogout = queued;
  return queued;
}

export function afterPendingAccountLogout(operation) {
  const run = async () => {
    if (!await waitForCrossTabLogoutBarrier()) return null;
    return operation();
  };
  return pendingAccountLogout.then(run, run);
}

function isCurrentAccountExchange(token, accountId, generation) {
  return isAccountAuthGenerationCurrent(generation)
    && state.account?.account?.id === accountId
    && (state.account?.sessionToken === token || state.account?.logoutToken === token);
}

function saveCookieSessionCredential(token, account = state.account?.account) {
  if (!account) return;
  saveAccountSession({ sessionToken: "", logoutToken: token, account });
}

function publishAccountSessionReady(accountId) {
  if (!accountId) return;
  try {
    localStorage.setItem(ACCOUNT_SESSION_READY_KEY, JSON.stringify({ accountId, revision: `${Date.now()}-${Math.random().toString(36).slice(2)}` }));
  } catch { /* a tab without storage can still use its cookie session */ }
}

function sessionRequest(token = "") {
  if (typeof fetch !== "function" || typeof AbortController !== "function") return Promise.reject(new Error("Account session requests are unavailable."));
  const controller = new AbortController();
  const options = { credentials: "include", signal: controller.signal };
  if (token) options.headers = { "x-poorup-session-token": token };
  const request = fetch("/account/session", options).then(async response => {
    let payload = null;
    if (response?.ok) {
      try { payload = await response.json(); } catch { /* invalid payload is treated as an auth failure */ }
    }
    return { response, payload };
  });
  let timeout = null;
  const deadline = new Promise((_, reject) => {
    timeout = setTimeout(() => {
      controller.abort();
      const error = new Error("Account session request timed out.");
      error.name = "TimeoutError";
      reject(error);
    }, ACCOUNT_SESSION_TIMEOUT_MS);
  });
  return Promise.race([request, deadline]).finally(() => clearTimeout(timeout));
}
function acceptCookieAccount(account, token, accountId, generation) {
  if (!account || account.id !== accountId || !isCurrentAccountExchange(token, accountId, generation)) return false;
  updateAccountFromResponse({ account, sessionToken: "", logoutToken: token });
  publishAccountSessionReady(accountId);
  host.reconnectSocket?.();
  return true;
}

async function exchangeCookieSession(token, accountId, generation, previousAccountId = null, previousLogoutToken = "") {
  if (!isCurrentAccountExchange(token, accountId, generation) || typeof fetch !== "function") return null;
  saveCookieSessionCredential(token);
  let result;
  try { result = await sessionRequest(token); } catch { return false; }
  if (!isCurrentAccountExchange(token, accountId, generation)) return null;
  if (result?.response?.ok && result.payload?.success && result.payload.account?.id === accountId) {
    return acceptCookieAccount(result.payload.account, token, accountId, generation);
  }
  if (result?.response?.ok && result.payload?.success && result.payload.account?.id && result.payload.account.id !== accountId) {
    // A still-valid cookie wins over the legacy header on /account/session.
    // Clear that cookie before retrying the new account's unconsumed bearer.
    saveAccountSession({ sessionToken: token, logoutToken: token, account: state.account.account });
    const oldProof = previousAccountId && previousAccountId !== accountId ? previousLogoutToken : "";
    if (!await postAccountLogout(oldProof) || !isCurrentAccountExchange(token, accountId, generation)) return false;
    saveCookieSessionCredential(token);
    try { result = await sessionRequest(token); } catch { return false; }
    if (!isCurrentAccountExchange(token, accountId, generation)) return null;
    if (result?.response?.ok && result.payload?.success && result.payload.account?.id === accountId) {
      return acceptCookieAccount(result.payload.account, token, accountId, generation);
    }
    return false;
  }
  if (result?.response?.status === 401 && isCurrentAccountExchange(token, accountId, generation)) {
    // The token may already have been consumed by a request whose response was
    // lost. The cookie is the authoritative credential after an exchange.
    let cookieResult;
    try { cookieResult = await sessionRequest(); } catch { return false; }
    if (!isCurrentAccountExchange(token, accountId, generation)) return null;
    if (cookieResult?.response?.ok && cookieResult.payload?.success && cookieResult.payload.account?.id === accountId) {
      return acceptCookieAccount(cookieResult.payload.account, token, accountId, generation);
    }
  }
  return false;
}

function startCookieSessionExchange(token, accountId, generation, transitionLogout = null, previousAccountId = null, previousLogoutToken = "") {
  if (!token || typeof fetch !== "function") return Promise.resolve(null);
  if (pendingSessionExchange?.token === token && pendingSessionExchange.accountId === accountId && pendingSessionExchange.generation === generation) {
    return pendingSessionExchange.promise;
  }
  const promise = afterPendingAccountLogout(async () => {
    if (!isCurrentAccountExchange(token, accountId, generation)) return null;
    if (transitionLogout && !await transitionLogout) {
      host.notice("ACCOUNT", "The previous account session could not be cleared. Reconnect and try again.");
      return false;
    }
    return withAccountCookieMutation(() => exchangeCookieSession(token, accountId, generation, previousAccountId, previousLogoutToken));
  }).finally(() => {
    if (pendingSessionExchange?.promise === promise) pendingSessionExchange = null;
  });
  pendingSessionExchange = { token, accountId, generation, promise };
  return promise;
}

export function bootstrapAccountCookieSession() {
  const session = state.account;
  const accountId = session?.account?.id || null;
  if (!session || !accountId || typeof fetch !== "function") return Promise.resolve(null);
  const generation = getAccountAuthGeneration();
  if (session.sessionToken) return startCookieSessionExchange(session.sessionToken, accountId, generation);
  if (pendingSessionExchange?.accountId === accountId && pendingSessionExchange.generation === generation) return pendingSessionExchange.promise;
  const logoutToken = session.logoutToken || "";
  return afterPendingAccountLogout(() => withAccountCookieMutation(async () => {
    const current = () => isAccountAuthGenerationCurrent(generation) && state.account?.account?.id === accountId && !state.account?.sessionToken;
    if (!current()) return null;
    let result;
    try { result = await sessionRequest(); } catch { return false; }
    if (!current()) return null;
    if (result?.response?.ok && result.payload?.success && result.payload.account?.id === accountId) {
      updateAccountFromResponse({ account: result.payload.account, sessionToken: "", logoutToken });
      return true;
    }
    if (result?.response?.ok && result.payload?.success && result.payload.account?.id && result.payload.account.id !== accountId) {
      await postAccountLogout("");
      if (current()) host.reconcileSignedOutState("This account session changed in another tab.", { persistSession: false });
      return false;
    }
    if (result?.response?.status === 401 && current()) host.reconcileSignedOutState("Account session expired. Sign in again.");
    return false;
  }));
}

let accountModalMode = "register";

function unlockedSet() {
  return state.unlockedAchievements || new Set();
}

/* Parlor Patrol is switched off: its badges can no longer be earned, so they
   are listed only for players who already hold them (stored data stays readable). */
function listedAchievements(unlocked) {
  return ACHIEVEMENTS.filter((achievement) => PARLOR_PATROL_ENABLED || achievement.category !== "minigame" || unlocked.has(achievement.id));
}

function unlockedCount(unlocked) {
  return ACHIEVEMENTS.filter((achievement) => unlocked.has(achievement.id)).length;
}

function setCountText(sel, value) {
  $(sel)?.replaceChildren(document.createTextNode(value));
}

function syncAchievementFilterButtons() {
  document.querySelectorAll("#achievements-filters [data-achievement-filter]").forEach((button) => {
    const active = button.dataset.achievementFilter === state.achievementFilter;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-pressed", String(active));
  });
}

function syncAchievementSelects() {
  const dateSelect = $("#achievement-date-filter");
  const raritySelect = $("#achievement-rarity-filter");
  if (dateSelect) dateSelect.value = state.achievementDateFilter;
  if (raritySelect) raritySelect.value = state.achievementRarityFilter;
}

function categoryMatches(achievement, filter) {
  if (filter === "all") return true;
  if (achievement.category === filter) return true;
  return filter === "secret" && achievement.secret;
}

function rarityMatches(achievement, rarityFilter) {
  if (rarityFilter === "all") return true;
  return achievement.rarity.toLowerCase() === rarityFilter;
}

function recordedMs(id) {
  return Date.parse(state.achievementRecords?.get(id) || "");
}

function recentWindowMs(dateFilter) {
  if (dateFilter === "recent") return 7 * 24 * 60 * 60 * 1000;
  return 30 * 24 * 60 * 60 * 1000;
}

function withinWindow(achievement, dateFilter, now) {
  const recorded = recordedMs(achievement.id);
  if (!Number.isFinite(recorded)) return false;
  return now - recorded <= recentWindowMs(dateFilter);
}

function sortFloor(dateFilter) {
  if (dateFilter === "newest") return 0;
  return Number.MAX_SAFE_INTEGER;
}

function sortRecorded(dateFilter, a, b) {
  const aDate = recordedMs(a.id) || sortFloor(dateFilter);
  const bDate = recordedMs(b.id) || sortFloor(dateFilter);
  if (dateFilter === "newest") return bDate - aDate;
  return aDate - bDate;
}

function dateFiltered(visible, dateFilter, now) {
  if (dateFilter === "recent" || dateFilter === "month") {
    return visible.filter((achievement) => withinWindow(achievement, dateFilter, now));
  }
  if (dateFilter === "newest" || dateFilter === "oldest") {
    return [...visible].sort((a, b) => sortRecorded(dateFilter, a, b));
  }
  return visible;
}

function visibleAchievements() {
  let visible = listedAchievements(unlockedSet()).filter((achievement) => categoryMatches(achievement, state.achievementFilter));
  visible = visible.filter((achievement) => rarityMatches(achievement, state.achievementRarityFilter));
  return dateFiltered(visible, state.achievementDateFilter, Date.now());
}

function unlockedStateLabel(unlocked, lockedKind) {
  if (unlocked) return "UNLOCKED";
  if (lockedKind) return "HIDDEN";
  return "LOCKED";
}

function achievementCardHTML(achievement, isUnlocked) {
  const isSecretLocked = Boolean(achievement.secret && !isUnlocked);
  const title = isSecretLocked ? "SECRET ACHIEVEMENT" : achievement.title;
  const short = isSecretLocked ? "A hidden parlor record" : achievement.short;
  const stateLabel = unlockedStateLabel(isUnlocked, isSecretLocked);
  return `<button class="achievement-card rarity-${achievement.rarity.toLowerCase()}${isUnlocked ? " is-unlocked" : ""}${isSecretLocked ? " is-secret" : ""}" type="button" data-achievement-id="${esc(achievement.id)}" aria-haspopup="dialog" aria-label="${esc(`${title}, ${stateLabel}. Open details.`)}"><span class="achievement-icon-wrap">${achievementIconHTML(achievement.id)}</span><span class="achievement-card-main"><span class="achievement-card-top"><span class="t-micro achievement-category">${achievement.category.toUpperCase()}</span><span class="t-micro achievement-rarity rarity-${achievement.rarity.toLowerCase()}">${achievement.rarity}</span></span><strong class="t-label f13 achievement-title">${esc(title)}</strong><span class="t-micro ink-3 achievement-short">${esc(short)}</span></span></button>`;
}

function emptyAchievementsHTML() {
  return `<p class="t-body ink-3 achievements-empty">NO ACHIEVEMENTS IN THIS FILTER.</p>`;
}

export function renderAchievements() {
  const root = $("#achievements-grid");
  if (!root) return;
  const unlocked = unlockedSet();
  const total = listedAchievements(unlocked).length;
  root.setAttribute("aria-label", "Achievement collection, " + total + " items");
  const count = `${unlockedCount(unlocked)}/${total}`;
  setCountText("#profile-achievement-count", count);
  setCountText("#achievements-progress-value", count);
  syncAchievementFilterButtons();
  syncAchievementSelects();
  const visible = visibleAchievements();
  root.innerHTML = visible.map((achievement) => achievementCardHTML(achievement, unlocked.has(achievement.id))).join("");
  if (!visible.length) root.innerHTML = emptyAchievementsHTML();
}

function achievementAccent(achievement) {
  if (achievement.category === "global") return "#d74438";
  if (achievement.category === "social") return "#286ea1";
  if (achievement.category === "minigame") return "#35a653";
  return "#d9a62f";
}

function achievementRecordedNote(recordedAt) {
  if (!recordedAt) return "RECORDED IN YOUR PARLOR LOG";
  return `RECORDED · ${formatStatDate(recordedAt)}`;
}

function achievementDetailNote(unlocked, hidden, recordedAt) {
  if (unlocked) return achievementRecordedNote(recordedAt);
  if (hidden) return "UNLOCK CONDITION HIDDEN";
  return "KEEP PLAYING TO UNLOCK";
}

function achievementDetailBits(achievement, unlocked) {
  const hidden = Boolean(achievement.secret && !unlocked);
  return {
    hidden,
    lockCls: hidden ? " is-locked" : "",
    title: hidden ? "SECRET ACHIEVEMENT" : achievement.title,
    copy: hidden ? achievement.clue : achievement.detail,
    status: unlockedStateLabel(unlocked, hidden),
    accent: achievementAccent(achievement),
    note: achievementDetailNote(unlocked, hidden, state.achievementRecords?.get(achievement.id)),
  };
}

export function openAchievementModal(id, trigger = null) {
  const achievement = ACHIEVEMENTS.find((entry) => entry.id === id);
  if (!achievement) return;
  const bits = achievementDetailBits(achievement, state.unlockedAchievements.has(achievement.id));
  const card = $("#achievement-detail-card");
  if (!card) return;
  card.innerHTML = `<div class="achievement-modal-rail" style="--achievement-accent:${bits.accent}"></div><div class="achievement-detail-body"><div class="achievement-detail-head"><div class="achievement-detail-icon rarity-${achievement.rarity.toLowerCase()}${bits.lockCls}">${achievementIconHTML(achievement.id)}</div><div><div class="achievement-detail-kicker"><span class="t-micro g400">${esc(achievement.category.toUpperCase())}</span><span class="t-micro rarity-${achievement.rarity.toLowerCase()}">${esc(achievement.rarity)}</span></div><h2 class="t-section achievement-detail-title" id="achievement-detail-title">${esc(bits.title)}</h2></div><span class="achievement-detail-state t-micro">${bits.status}</span></div><div class="achievement-detail-copy"><p class="t-body ink-2" id="achievement-detail-description">${esc(bits.copy)}</p><p class="t-micro achievement-detail-note">${bits.note}</p></div><button class="cta-red achievement-detail-close" id="achievement-detail-close" type="button"><span class="cta-text cta-text-sm">CLOSE DETAILS</span></button></div>`;
  if (trigger instanceof HTMLElement) setSurfaceReturnFocus(trigger);
  openSurface("#achievement-modal", "#achievement-detail-close", { trigger });
  $("#achievement-detail-close")?.addEventListener("click", closeAchievementModal);
}

export function closeAchievementModal() {
  closeSurface("#achievement-modal");
}

export function setAchievementFilter(filter = "all") {
  const allowed = ["all", "visible", "global", "social", "secret", "minigame"];
  state.achievementFilter = allowed.includes(filter) ? filter : "all";
  renderAchievements();
}

export function setAchievementDateFilter(filter = "all") {
  state.achievementDateFilter = ["all", "recent", "month", "newest", "oldest"].includes(filter) ? filter : "all";
  renderAchievements();
}

export function setAchievementRarityFilter(filter = "all") {
  const allowed = ["all", "common", "uncommon", "rare", "epic", "legendary", "mythical"];
  state.achievementRarityFilter = allowed.includes(filter) ? filter : "all";
  renderAchievements();
}

export function unlockAchievement(id) {
  if (!ACHIEVEMENTS.some((achievement) => achievement.id === id)) return false;
  // Signed-in accounts accept unlocks only from the server evaluator. Guest
  // sessions may keep their temporary local collection.
  if (state.account?.account) return false;
  if (state.unlockedAchievements.has(id)) return false;
  state.unlockedAchievements.add(id);
  state.achievementRecords.set(id, new Date().toISOString());
  saveUnlockedAchievements();
  renderAchievements();
  const achievement = ACHIEVEMENTS.find((entry) => entry.id === id);
  const announcer = $("#system-announcer");
  if (announcer && achievement) announcer.textContent = `ACHIEVEMENT UNLOCKED: ${achievement.title}`;
  return true;
}


function applyAccountAchievements(account) {
  (account.achievements || []).forEach((entry) => {
    if (!ACHIEVEMENTS.some((achievement) => achievement.id === entry.id)) return;
    state.unlockedAchievements.add(entry.id);
    state.achievementRecords.set(entry.id, entry.unlockedAt || null);
  });
}

export function updateAccountFromResponse(response) {
  if (!response?.account) return;
  const previousSession = state.account;
  const previousAccountId = previousSession?.account?.id || null;
  const nextAccountId = response.account.id || null;
  const accountChanged = previousAccountId !== nextAccountId;
  if (accountChanged) resetAccountScopedClientState();
  const hasResponseToken = typeof response.sessionToken === "string";
  const token = hasResponseToken
    ? response.sessionToken
    : accountChanged ? "" : previousSession?.sessionToken || "";
  const previousProof = previousSession?.logoutToken || previousSession?.sessionToken || "";
  const logoutToken = typeof response.logoutToken === "string"
    ? response.logoutToken
    : accountChanged
      ? token
      : token && token !== previousSession?.sessionToken
        ? token
        : previousSession?.logoutToken || token;
  const transitionLogout = accountChanged && previousSession && token
    ? queueAccountLogout(previousProof)
    : null;
  saveAccountSession({ sessionToken: token, logoutToken, account: response.account });
  if (token) startCookieSessionExchange(token, nextAccountId, getAccountAuthGeneration(), transitionLogout, previousAccountId, previousProof);
  state.alias = response.account.displayName;
  adoptAccountAppearance(response.account);
  state.unlockedAchievements = new Set();
  state.achievementRecords = new Map();
  applyAccountAchievements(response.account);
  saveUnlockedAchievements();
  renderAccountPanel();
  renderAchievements();
  applyProfileToHomeUI();
  if (accountChanged) {
    host.renderSocialSurfaces?.();
    host.closePlayerSurface?.();
  }
}

const ACCOUNT_USERNAME_RE = /^[A-Za-z0-9_]{3,16}$/;

function accountModalTitle(edit, register) {
  if (edit) return "Edit Account";
  if (register) return "Create account";
  return "Sign in";
}

function accountModalDescription(edit, register) {
  if (edit) return "Update the account display name used at every table. Your saved designs keep their own names.";
  if (register) return "Choose a unique username friends can find, then save your player identity and stats across rooms.";
  return "Sign in to load your saved display name, face, color, and game record.";
}

function accountSubmitLabel(edit, register) {
  if (edit) return "Save Account";
  if (register) return "Create Account";
  return "Sign In";
}

function accountTabsHTML(edit, register) {
  if (edit) return "";
  return `<div class="account-modal-tabs" role="toolbar" aria-label="Account actions"><button class="rm-tab${register ? " is-active" : ""}" id="account-tab-register" type="button" aria-pressed="${register}"><span class="t-label f12">CREATE ACCOUNT</span></button><button class="rm-tab${register ? "" : " is-active"}" id="account-tab-login" type="button" aria-pressed="${!register}"><span class="t-label f12">SIGN IN</span></button></div>`;
}

function accountUsernameFieldHTML(edit, register, account) {
  if (edit) return `<label class="account-field"><span class="t-label f12 g-muted">Username</span><input class="field" id="account-username-input" value="${esc(account?.username || "")}" readonly aria-readonly="true" /></label>`;
  return `<label class="account-field" id="account-username-field"><span class="t-label f12 g-muted">Username</span><input class="field" id="account-username-input" name="username" maxlength="16" minlength="3" pattern="[A-Za-z0-9_]{3,16}" autocomplete="username"${register ? ` aria-describedby="account-username-status"` : ""} required placeholder="night_player" />${register ? `<span class="account-username-status t-micro ink-3" id="account-username-status" role="status" aria-live="polite">3–16 letters, numbers, or underscores</span>` : ""}</label>`;
}

function accountDisplayNameFieldHTML(register, edit, account) {
  if (!((register || edit))) return "";
  return `<label class="account-field"><span class="t-label f12 g-muted">Display Name</span><input class="field" id="account-display-input" name="displayName" maxlength="18" autocomplete="nickname" required placeholder="Marlowe" value="${edit ? esc(account?.displayName || "") : ""}" /></label>`;
}

function accountPrivacyHTML(edit, account) {
  if (!(edit)) return "";
  return `<div class="account-privacy-grid"><label class="account-field"><span class="t-label f12 g-muted">Match History</span><select class="setting-select" name="historyVisibility"><option value="public" ${account?.privacy?.history === "public" ? "selected" : ""}>PUBLIC</option><option value="friends" ${account?.privacy?.history !== "public" && account?.privacy?.history !== "private" ? "selected" : ""}>FRIENDS</option><option value="private" ${account?.privacy?.history === "private" ? "selected" : ""}>PRIVATE</option></select></label><label class="account-field"><span class="t-label f12 g-muted">Achievements</span><select class="setting-select" name="achievementsVisibility"><option value="friends" ${account?.privacy?.achievements !== "private" ? "selected" : ""}>FRIENDS</option><option value="private" ${account?.privacy?.achievements === "private" ? "selected" : ""}>PRIVATE</option></select></label><label class="account-field"><span class="t-label f12 g-muted">Friend Requests</span><select class="setting-select" name="friendRequestsVisibility"><option value="everyone" ${account?.privacy?.friendRequests !== "friends" && account?.privacy?.friendRequests !== "nobody" ? "selected" : ""}>EVERYONE</option><option value="friends" ${account?.privacy?.friendRequests === "friends" ? "selected" : ""}>FRIENDS OF FRIENDS</option><option value="nobody" ${account?.privacy?.friendRequests === "nobody" ? "selected" : ""}>NOBODY</option></select></label><label class="account-field"><span class="t-label f12 g-muted">Room Invites</span><select class="setting-select" name="roomInvitesVisibility"><option value="friends" ${account?.privacy?.roomInvites !== "nobody" ? "selected" : ""}>FRIENDS</option><option value="nobody" ${account?.privacy?.roomInvites === "nobody" ? "selected" : ""}>NOBODY</option></select></label></div>`;
}

function accountPasswordFieldHTML(edit, register) {
  if (edit) return "";
  return `<label class="account-field"><span class="t-label f12 g-muted">Password</span><input class="field" id="account-password-input" name="password" type="password" minlength="8" maxlength="72" autocomplete="${register ? "new-password" : "current-password"}" required placeholder="8 characters minimum" /></label>`;
}

function accountModalHTML(mode) {
  const register = mode === "register";
  const edit = mode === "edit";
  const account = state.account?.account || null;
  const title = accountModalTitle(edit, register);
  const description = accountModalDescription(edit, register);
  return `
    <div class="account-modal-body">
      <div class="account-modal-head">
        <div>
          <div class="t-micro g400">POORUP IDENTITY</div>
          <h2 class="t-section g100" id="account-modal-title">${title}</h2>
        </div>
        ${closeButtonHTML({ id: "account-modal-close", label: "Close account dialog" })}
      </div>
      <p class="t-body ink-2" id="account-modal-description">${description}</p>
      ${accountTabsHTML(edit, register)}
      <form class="account-form" id="account-form">
        ${accountUsernameFieldHTML(edit, register, account)}
       ${accountDisplayNameFieldHTML(register, edit, account)}
        ${accountPrivacyHTML(edit, account)}
        ${accountPasswordFieldHTML(edit, register)}
        <p class="account-form-error" id="account-form-error" aria-live="off"></p>
        <button class="cta-red account-submit" type="submit"><span class="cta-text cta-text-sm">${accountSubmitLabel(edit, register)}</span></button>
      </form>
      <p class="t-micro ink-3 account-modal-foot">Guest play remains available without an account. Passwords are never shown in the game UI.</p>
    </div>`;
}

function accountFocusTarget(mode) {
  if (mode === "edit") return "#account-display-input";
  return "#account-username-input";
}

function accountSubmitEventName() {
  if (accountModalMode === "register") return "account-register";
  if (accountModalMode === "edit") return "account-update";
  return "account-login";
}

function accountSubmitSuccessMessage() {
  if (accountModalMode === "register") return "Account created. Your identity is saved.";
  if (accountModalMode === "edit") return "Account name updated.";
  return "Signed in. Your identity is ready.";
}

function editPrivacyPayload(payload) {
  payload.privacy = { history: payload.historyVisibility, achievements: payload.achievementsVisibility, friendRequests: payload.friendRequestsVisibility, roomInvites: payload.roomInvitesVisibility };
  delete payload.historyVisibility;
  delete payload.achievementsVisibility;
  delete payload.friendRequestsVisibility;
  delete payload.roomInvitesVisibility;
}

function createUsernameGate(mode) {
  let checkTimer = null;
  let checkVersion = 0;
  let availability = mode !== "register";
  let pending = false;
  const usernameInput = $("#account-username-input");
  const usernameStatus = $("#account-username-status");
  const accountForm = $("#account-form");
  const submit = accountForm?.querySelector("button[type=submit]");
  const setError = (message) => {
    const error = $("#account-form-error");
    if (error) error.textContent = message;
  };
  const setUsernameStatus = (kind, message) => {
    if (!usernameStatus) return;
    usernameStatus.classList.remove("is-checking", "is-available", "is-taken", "is-invalid");
    if (kind) usernameStatus.classList.add(`is-${kind}`);
    usernameStatus.textContent = message;
    usernameInput?.setAttribute("aria-invalid", String(kind === "taken" || kind === "invalid"));
    usernameInput?.setAttribute("aria-busy", String(kind === "checking"));
  };
  const syncSubmit = () => {
    if (!submit || mode !== "register") return;
    submit.disabled = pending || availability === false;
  };
  const markInvalid = (message) => {
    availability = false;
    pending = false;
    setUsernameStatus("invalid", message);
    syncSubmit();
  };
  const availableKind = (response) => {
    if (response.available) return "available";
    if (response.reason === "invalid") return "invalid";
    return "taken";
  };
  const availableMessage = (response) => {
    if (response.available) return "[OK] Username is available.";
    return `[X] ${response.message || "That username is already taken."}`;
  };
  const checkAck = (response, value, version) => {
    if (version !== checkVersion) return;
    if (usernameInput.value.trim() !== value) return;
    pending = false;
    if (!response?.success) {
      availability = null;
      setUsernameStatus("checking", "[·] Could not check now. The server will verify it on submit.");
      syncSubmit();
      return;
    }
    availability = response.available === true;
    setUsernameStatus(availableKind(response), availableMessage(response));
    syncSubmit();
  };
  const check = () => {
    if (mode !== "register") return;
    if (!usernameInput || !usernameStatus) return;
    clearTimeout(checkTimer);
    const value = usernameInput.value.trim();
    const version = ++checkVersion;
    if (!value) {
      markInvalid("[!] Enter a username to check.");
      return;
    }
    if (!ACCOUNT_USERNAME_RE.test(value)) {
      markInvalid("[!] Use 3–16 letters, numbers, or underscores.");
      return;
    }
    availability = null;
    pending = true;
    setUsernameStatus("checking", "[·] Checking username availability…");
    syncSubmit();
    checkTimer = window.setTimeout(() => {
      emitAccountRequest("check-username", { username: value }, (response) => checkAck(response, value, version));
    }, 180);
  };
  return {
    availability: () => availability,
    pending: () => pending,
    setError,
    focusUsername: () => usernameInput?.focus({ preventScroll: true }),
    setSubmitDisabled: (off) => {
      if (submit) submit.disabled = off;
    },
    restoreSubmitDisabled: () => {
      if (submit) submit.disabled = accountModalMode === "register" && availability === false;
    },
    markUsernameTaken: () => {
      availability = false;
      setUsernameStatus("taken", "[X] That username is already taken.");
    },
    installCheck: () => {
      usernameInput?.addEventListener("input", check);
      check();
    },
    installSubmit: (onSubmit) => accountForm?.addEventListener("submit", onSubmit),
  };
}

function markTakenIfRejected(response, gate) {
  if (accountModalMode !== "register") return;
  const error = String(response?.error || "");
  if (!/already taken/i.test(error)) return;
  gate.markUsernameTaken();
}

function accountSubmitFailure(response, gate) {
  const message = response?.error || "Account action failed.";
  gate.setError(message);
  markTakenIfRejected(response, gate);
  host.announceActionStatus(message, $("#account-form-error"));
  gate.restoreSubmitDisabled();
}

function accountSubmitAck(response, gate) {
  if (!response?.success) {
    accountSubmitFailure(response, gate);
    return;
  }
  updateAccountFromResponse(response);
  closeAccountModal();
  host.notice("ACCOUNT", accountSubmitSuccessMessage());
}

function accountFormSubmit(event, gate) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form).entries());
  if (accountModalMode === "edit") editPrivacyPayload(payload);
  gate.setError("");
  if (accountModalMode === "register" && gate.availability() === false) {
    const message = "Choose an available username before creating your account.";
    gate.setError(message);
    host.announceActionStatus(message, $("#account-form-error"));
    gate.focusUsername();
    return;
  }
  if (accountModalMode === "register" && gate.pending()) {
    const message = "Wait for the username availability check to finish.";
    gate.setError(message);
    host.announceActionStatus(message, $("#account-form-error"));
    return;
  }
  const eventName = accountSubmitEventName();
  gate.setSubmitDisabled(true);
  const generation = eventName === "account-login" || eventName === "account-register"
    ? beginAccountAuthTransition()
    : getAccountAuthGeneration();
  emitAccountRequest(eventName, payload, (response) => accountSubmitAck(response, gate), generation, () => gate.restoreSubmitDisabled());
}

export function openAccountModal(mode = "register", trigger = null) {
  accountModalMode = mode;
  const card = $("#account-card");
  if (!card) return;
  if (trigger instanceof HTMLElement && !trigger.closest("#account-modal")) setSurfaceReturnFocus(trigger);
  card.innerHTML = accountModalHTML(mode);
  openSurface("#account-modal", accountFocusTarget(mode));
  $("#account-modal-close")?.addEventListener("click", closeAccountModal);
  $("#account-tab-register")?.addEventListener("click", () => openAccountModal("register"));
  $("#account-tab-login")?.addEventListener("click", () => openAccountModal("login"));
  const gate = createUsernameGate(mode);
  gate.installCheck();
  gate.installSubmit((event) => accountFormSubmit(event, gate));
  focusSurface("#account-modal", accountFocusTarget(mode));
}

export function closeAccountModal() {
  closeSurface("#account-modal");
}

export function logoutAccount() {
  const token = state.account?.logoutToken || state.account?.sessionToken || "";
  const logoutGeneration = resetAccountScopedClientState();
  if (token) host.emitServer("account-logout", { sessionToken: token }, noop);
  const serverLogout = queueAccountLogout(token);
  clearLocalPlayerData();
  saveAccountSession(null);
  state.profiles = [];
  state.appearance = 0;
  state.themeId = DEFAULT_THEME_ID;
  state.sound = false;
  state.music = false;
  state.unlockedAchievements = new Set();
  state.achievementRecords = new Map();
  state.profileDraft = null;
  state.editingProfileId = null;
  state.tableAppearanceOverride = null;
  state.alias = loadGuestAlias();
  state.players = buildPlayers(activeAppearance(), state.alias);
  renderAccountPanel();
  applyProfileToHomeUI();
  renderProfileLibrary();
  renderProfileEditor();
  host.renderSocialSurfaces?.();
  host.closePlayerSurface?.();
  host.syncAudioButtons();
  host.syncHomeMusic();
  return serverLogout.then((confirmed) => {
    if (!confirmed) host.notice("ACCOUNT", "Sign out could not be confirmed. Reconnect and try again.");
    else if (isAccountAuthGenerationCurrent(logoutGeneration)) host.notice("ACCOUNT", "Signed out. Guest mode is active.");
    return confirmed;
  });
}
