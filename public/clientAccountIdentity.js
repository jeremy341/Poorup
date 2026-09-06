/* ============================================================
   ACCOUNT IDENTITY: optional Poorup accounts and the achievement
   collection. Socket calls and chat announcements are injected by
   the entry module; profile/home renderers are imported directly.
   ============================================================ */
import { $, esc } from "./clientDom.js";
import { ACHIEVEMENTS, achievementIconHTML } from "./clientAchievements.js";
import { state, saveAccountSession, saveUnlockedAchievements, activeAppearance, buildPlayers } from "./clientState.js";
import { loadActiveDesignId, saveActiveDesignId, loadGuestAlias, saveGuestAlias } from "./clientSanitize.js";
import { openSurface, closeSurface, focusSurface, setSurfaceReturnFocus } from "./clientSurfaces.js";
import { renderAccountPanel, applyProfileToHomeUI, renderProfileEditor, formatStatDate } from "./clientProfileRender.js";

function noop() {}
let host = { emitServer: noop, say: noop };

export function configureAccountIdentity(hooks) {
  host = { ...host, ...hooks };
}

let accountModalMode = "register";

function unlockedSet() {
  return state.unlockedAchievements || new Set();
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
    button.setAttribute("aria-selected", String(active));
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
  let visible = ACHIEVEMENTS.filter((achievement) => categoryMatches(achievement, state.achievementFilter));
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
  const total = ACHIEVEMENTS.length;
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
  openSurface("#achievement-modal", "#achievement-detail-close");
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
  const token = response.sessionToken || state.account?.sessionToken;
  if (!token) return;
  saveAccountSession({ sessionToken: token, account: response.account });
  state.alias = response.account.displayName;
  state.unlockedAchievements = new Set();
  state.achievementRecords = new Map();
  applyAccountAchievements(response.account);
  saveUnlockedAchievements();
  renderAccountPanel();
  renderAchievements();
  applyProfileToHomeUI();
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
  return `<div class="account-modal-tabs" role="tablist" aria-label="Account actions"><button class="rm-tab${register ? " is-active" : ""}" id="account-tab-register" type="button" role="tab" aria-selected="${register}"><span class="t-label f12">CREATE ACCOUNT</span></button><button class="rm-tab${register ? "" : " is-active"}" id="account-tab-login" type="button" role="tab" aria-selected="${!register}"><span class="t-label f12">SIGN IN</span></button></div>`;
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
        <button class="btn-dark" id="account-modal-close" type="button"><span class="t-label f11">CLOSE</span></button>
      </div>
      <p class="t-body ink-2" id="account-modal-description">${description}</p>
      ${accountTabsHTML(edit, register)}
      <form class="account-form" id="account-form">
        ${accountUsernameFieldHTML(edit, register, account)}
       ${accountDisplayNameFieldHTML(register, edit, account)}
        ${accountPrivacyHTML(edit, account)}
        ${accountPasswordFieldHTML(edit, register)}
        <p class="account-form-error" id="account-form-error" role="alert" aria-live="assertive"></p>
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
      host.emitServer("check-username", { username: value }, (response) => checkAck(response, value, version));
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
  const announcer = $("#error-announcer");
  if (announcer) announcer.textContent = message;
  gate.restoreSubmitDisabled();
}

function accountSubmitAck(response, gate) {
  if (!response?.success) {
    accountSubmitFailure(response, gate);
    return;
  }
  updateAccountFromResponse(response);
  closeAccountModal();
  host.say(accountSubmitSuccessMessage());
}

function accountFormSubmit(event, gate) {
  event.preventDefault();
  const form = event.currentTarget;
  const payload = Object.fromEntries(new FormData(form).entries());
  if (accountModalMode === "edit") editPrivacyPayload(payload);
  gate.setError("");
  if (accountModalMode === "register" && gate.availability() === false) {
    gate.setError("Choose an available username before creating your account.");
    gate.focusUsername();
    return;
  }
  if (accountModalMode === "register" && gate.pending()) {
    gate.setError("Wait for the username availability check to finish.");
    return;
  }
  const eventName = accountSubmitEventName();
  gate.setSubmitDisabled(true);
  host.emitServer(eventName, payload, (response) => accountSubmitAck(response, gate));
}

export function openAccountModal(mode = "register") {
  accountModalMode = mode;
  const card = $("#account-card");
  if (!card) return;
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
  const token = state.account?.sessionToken;
  if (token) host.emitServer("account-logout", { sessionToken: token }, noop);
  saveAccountSession(null);
  state.unlockedAchievements = new Set();
  state.achievementRecords = new Map();
  saveUnlockedAchievements();
  state.tableAppearanceOverride = null;
  state.appearance = loadActiveDesignId(state.profiles);
  saveActiveDesignId(state.appearance);
  state.alias = loadGuestAlias();
  saveGuestAlias(state.alias);
  state.players = buildPlayers(activeAppearance(), state.alias);
  renderAccountPanel();
  applyProfileToHomeUI();
  renderProfileEditor();
  host.say("Signed out. Guest mode is active.");
}
