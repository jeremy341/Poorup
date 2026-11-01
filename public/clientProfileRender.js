// PROFILE SURFACES: identity display, profile summary, statistics deck, history rows, library
// tiles, face editor canvas renderers and the guest-alias field. Socket-backed saves and view
// switching stay in the entry module. The achievements renderer is a host callback.
import { $, esc } from "./clientDom.js";
import { state, getProfileById, getAppearanceMeta } from "./clientState.js";
import { spriteFromGrid, avatarHTML } from "./clientSprites.js";
import { CONNECTION_COPY } from "./clientTopNavRender.js";
import { MAX_PROFILES, profileDesignName } from "./clientSanitize.js";
import { renderAccountRights } from "./clientAccountRights.js";

import { renderProfileStatistics, renderProfileHistory } from "./clientProfileHistory.js";
export { historyNetWorthChartSpec } from "./clientProfileHistoryDetails.js";
export { formatStatDate, profileHistoryToggleAccessibleName, profileHistoryRowHTML, setProfileHistoryExpanded, selectProfileHistoryDetailTab, profileHistorySummary, filterProfileHistory, profileHistoryCountLabel, historyPanelHTML, setProfileHistoryFilter, setAllProfileHistoryRowsExpanded, profileStatisticsHTML, renderProfileStatistics, renderProfileHistory } from "./clientProfileHistory.js";

const PROFILE_SWATCHES = ["#d74438", "#286ea1", "#d9a62f", "#35a653", "#a04e6f", "#3e7d7b", "#7b5029", "#cfa75f"];
const FACE_PALETTE = ["#f0d9ac", "#e8d3ab", "#cfa75f", "#c88f2e", "#9b783d", "#5c5033", "#01070a", "#ffffff", "#d74438", "#35a653", "#286ea1", "#d9a62f"];

function noop() {}
function noopNull() { return null; }

let host = { renderAchievements: noop, loadSavedGame: noopNull, renderHomeSignals: noop };

export function configureProfileRender(hooks) {
  host = { ...host, ...hooks };
}

export function setText(sel, value) {
  const el = $(sel);
  if (el) el.textContent = value;
}

function setHTML(sel, value) {
  const el = $(sel);
  if (el) el.innerHTML = value;
}

export function replaceText(sel, value) {
  $(sel)?.replaceChildren(document.createTextNode(value));
}

export function accountRate(stats = {}) {
  const games = Number(stats.gamesPlayed) || 0;
  return games ? `${Math.round(((Number(stats.wins) || 0) / games) * 100)}%` : "0%";
}

function sourceName(account) {
  if (account?.displayName) return account.displayName;
  return state.alias || "PLAYER";
}

export function selectedProfile() {
  if (typeof state.appearance !== "string") return null;
  return getProfileById(state.appearance) || null;
}

function sourceColor(draft, profile, account, activeMeta) {
  if (draft?.color) return draft.color;
  if (profile?.color) return profile.color;
  if (account?.color) return account.color;
  if (activeMeta.color) return activeMeta.color;
  return "#d74438";
}

function sourceGrid(draft, profile, account) {
  if (draft?.grid) return draft.grid;
  if (profile?.avatarGrid) return profile.avatarGrid;
  return account?.avatarGrid || null;
}

export function profileDisplaySource() {
  const subject = state.profileSubject;
  if (subject) return { account: null, profile: null, subject, name: subject.name, color: "#286ea1", grid: null, designName: null };
  const account = state.account?.account || null;
  const draft = state.profileDraft || null;
  const profile = draft || selectedProfile();
  const activeMeta = getAppearanceMeta(state.appearance);
  const name = sourceName(account);
  const color = sourceColor(draft, profile, account, activeMeta);
  const grid = sourceGrid(draft, profile, account);
  const designName = profile ? profileDesignName(profile) : activeMeta.label;
  return { account, profile, name, color, grid, designName };
}

function heroAvatarMarkup(grid, color, size) {
  if (grid) return spriteFromGrid(grid, size);
  return avatarHTML({ color }, size, 0);
}

function renderProfileHero(source, displayName) {
  const { account, grid, color } = source;
  setHTML("#profile-hero-avatar", heroAvatarMarkup(grid, color, 6));
  setHTML("#profile-overview-avatar", heroAvatarMarkup(grid, color, 5));
  replaceText("#profile-hero-name", displayName);
  replaceText("#profile-overview-name", displayName);
  // The hero names the player; the subtitle also carries the design name, so a just-saved design is visible here.
  const designLabel = source.designName ? String(source.designName).toUpperCase() : "";
  if (source.subject) {
    setText("#profile-hero-handle", `COMPUTER · ${String(source.subject.difficulty || "table").toUpperCase()}`);
    const subjectState = $("#profile-hero-state");
    if (subjectState) {
      subjectState.textContent = "COMPUTER PLAYER · RECORD KEPT APART FROM ACCOUNTS";
      subjectState.classList.remove("is-account");
    }
    return;
  }
  const base = account ? `@${account.username}` : "GUEST MODE";
  setText("#profile-hero-handle", designLabel ? `${base} · ${designLabel}` : base);
  const stateLabel = $("#profile-hero-state");
  if (stateLabel) {
    stateLabel.textContent = account
      ? "ACCOUNT PLAYER · STATS SYNCED AFTER COMPLETED ROUNDS"
      : "LOCAL PLAYER · READY FOR THE NEXT TABLE";
    stateLabel.classList.toggle("is-account", Boolean(account));
  }
  const heroAction = $("#profile-hero-account-btn");
  if (heroAction) {
    heroAction.querySelector(".t-label").textContent = account ? "EDIT ACCOUNT" : "CREATE ACCOUNT";
  }
}

function profileStatCells(account) {
  const accountStats = account?.stats || {};
  return {
    games: Number(accountStats.gamesPlayed) || 0,
    wins: Number(accountStats.wins) || 0,
    rate: accountRate(accountStats),
    bankruptcies: Number(accountStats.bankruptcies) || 0,
  };
}

function joinedLabel(account) {
  if (!account?.createdAt) return "GUEST";
  const opts = { month: "short", year: "numeric" };
  return new Date(account.createdAt).toLocaleDateString(undefined, opts).toUpperCase();
}

function renderProfileStats(source) {
  if (source.subject) {
    const { gamesPlayed, wins } = source.subject;
    replaceText("#profile-stat-games", String(gamesPlayed));
    replaceText("#profile-stat-wins", String(wins));
    replaceText("#profile-stat-rate", accountRate({ gamesPlayed, wins }));
    replaceText("#profile-stat-bankruptcies", "-");
    setText("#profile-stat-joined", "COMPUTER");
    return;
  }
  const account = source.account;
  const stats = profileStatCells(account);
  replaceText("#profile-stat-games", String(stats.games));
  replaceText("#profile-stat-wins", String(stats.wins));
  replaceText("#profile-stat-rate", stats.rate);
  replaceText("#profile-stat-bankruptcies", String(stats.bankruptcies));
  setText("#profile-stat-joined", joinedLabel(account));
}

function overviewStatusText() {
  if (state.connectionStatus === "online") return "READY";
  return (CONNECTION_COPY[state.connectionStatus] || "OFFLINE").toUpperCase();
}

function renderProfileOverview(source) {
  const account = source.account;
  if (source.subject) {
    const grid = $("#view-profile .profile-overview-grid");
    if (grid && !grid.querySelector(".computer-profile-note")) {
      grid.insertAdjacentHTML("beforeend", `<p class="t-body ink-2 computer-profile-note">A computer player. Its games, wins and unlocks are kept apart from accounts, friends and rankings.</p>`);
    }
    return;
  }
  $("#view-profile .computer-profile-note")?.remove();
  replaceText("#profile-overview-mode", account ? `@${account.username}` : "GUEST MODE");
  setText("#profile-overview-status", overviewStatusText());
  setText("#profile-overview-sync", account ? "ACCOUNT SYNC" : "LOCAL ONLY");
}

function renderProfileToggles() {
  setText("#profile-sound-state", state.sound ? "SOUND ON" : "SOUND OFF");
  setText("#profile-music-state", state.music ? "MUSIC ON" : "MUSIC OFF");
}

export function renderProfileSummary() {
  const source = profileDisplaySource();
  const safeName = String(source.name || "PLAYER").trim() || "PLAYER";
  const displayName = safeName.toUpperCase();
  renderProfileHero(source, displayName);
  renderProfileStats(source);
  renderProfileOverview(source);
  renderProfileToggles();
  renderProfileStatistics();
  renderProfileHistory();
  host.renderAchievements();
}

function accountAvatarMarkup(visual) {
  if (visual.grid) return spriteFromGrid(visual.grid, 4);
  return avatarHTML({ color: visual.color }, 4, 0);
}

function renderSignedAccountPanel(account) {
  const visual = profileDisplaySource();
  setHTML("#account-avatar", accountAvatarMarkup(visual));
  replaceText("#account-display-name", account.displayName);
  replaceText("#account-username", `@${account.username}`);
  replaceText("#account-games", String(account.stats?.gamesPlayed || 0));
  replaceText("#account-wins", String(account.stats?.wins || 0));
  replaceText("#account-rate", accountRate(account.stats));
  const pending = account.accountDeactivated === true;
  const editButton = $("#account-edit-btn");
  if (editButton) {
    editButton.disabled = pending;
    editButton.setAttribute("aria-disabled", String(pending));
  }
  const badge = $("#account-panel-badge");
  if (badge) badge.textContent = pending ? "DELETION PENDING" : "ACCOUNT ACTIVE";
  renderAccountRights(account);
}

function syncAccountPanelVisibility(signedIn) {
  $("#account-guest-state")?.classList.toggle("is-hidden", signedIn);
  $("#account-signed-state")?.classList.toggle("is-hidden", !signedIn);
  setText("#account-panel-title", signedIn ? `@${state.account.account.username}` : "Guest mode");
}

function accountPendingDeletion(signedIn) {
  return signedIn && state.account.account.accountDeactivated === true;
}

function applyPendingDeletionLock() {
  const profileRoot = $("#view-profile");
  state.profileTab = "account";
  if (profileRoot) profileRoot.dataset.profileTab = "account";
  document.querySelectorAll("#profile-tabs [data-profile-tab]").forEach((button) => {
    const active = button.dataset.profileTab === "account";
    button.disabled = !active;
    button.setAttribute("aria-disabled", String(!active));
    button.setAttribute("aria-selected", String(active));
  });
  document.querySelectorAll("#view-profile .profile-tab-panel").forEach((panel) => panel.classList.toggle("is-hidden", panel.id !== "profile-panel-account"));
}

function clearPendingDeletionLock() {
  document.querySelectorAll("#profile-tabs [data-profile-tab]").forEach((button) => {
    button.disabled = false;
    button.removeAttribute("aria-disabled");
  });
}

export function renderAccountPanel() {
  const signedIn = Boolean(state.account?.account);
  syncAccountPanelVisibility(signedIn);
  const pending = accountPendingDeletion(signedIn);
  setText("#account-panel-badge", signedIn ? (pending ? "DELETION PENDING" : "ACCOUNT ACTIVE") : "LOCAL ONLY");
  if (pending) applyPendingDeletionLock();
  else clearPendingDeletionLock();
  renderProfileSummary();
  if (!signedIn) return;
  renderSignedAccountPanel(state.account.account);
}

function configureDesignButtons(atCap) {
  const newBtn = $("#pl-new-btn");
  if (newBtn) {
    newBtn.disabled = atCap;
    newBtn.querySelector(".t-label").textContent = atCap ? `MAX ${MAX_PROFILES} DESIGNS` : "+ NEW DESIGN";
  }
  const saveBtn = $("#pl-save-btn");
  if (saveBtn) {
    saveBtn.disabled = !state.profileDraft || atCap;
    saveBtn.querySelector(".cta-text").textContent = atCap ? `MAX ${MAX_PROFILES} DESIGNS` : "SAVE DESIGN";
  }
}

function emptyLibraryMessage() {
  return `<p class="pl-empty">No custom designs yet. Press <strong style="color:var(--gold-300)">+ NEW DESIGN</strong> to draw your first player.</p>`;
}

function draftCard() {
  const draft = state.profileDraft;
  if (!draft || state.editingProfileId) return null;
  return { id: "draft", designName: draft.designName || "UNTITLED DESIGN", color: draft.color, avatarGrid: draft.grid, isDraft: true };
}

function cardForProfile(profile, i, draft) {
  if (!draft || state.editingProfileId !== profile.id) {
    return { ...profile, designName: profileDesignName(profile), isEditing: false, seed: i };
  }
  return {
    ...profile,
    designName: draft.designName || "UNTITLED DESIGN",
    color: draft.color,
    avatarGrid: draft.grid,
    isEditing: true,
    seed: i,
  };
}

function tileClasses(p, selected) {
  const cls = ["pl-tile"];
  if (selected) cls.push("is-active");
  if (p.isDraft) cls.push("is-draft");
  if (p.isEditing) cls.push("is-editing");
  return cls.join(" ");
}

function tileStateLabel(selected, editing) {
  if (editing) return `<span class="t-micro ink-3">EDITING · LIVE PREVIEW</span>`;
  if (selected) return `<span class="t-micro ink-3">ACTIVE DESIGN</span>`;
  return `<span class="t-micro ink-3">TAP TO SELECT</span>`;
}

function tileSelectHTML(p, i, selected) {
  const entity = { color: p.color, avatarGrid: p.avatarGrid };
  const name = `<span class="pl-name-row"><span class="pl-name-chip" style="background:${p.color}" aria-hidden="true"></span><span class="t-label pl-tile-name">${esc(p.designName)}</span></span>`;
  const av = `<span class="pl-tile-av">${avatarHTML(entity, 3, i)}</span>`;
  if (p.isDraft) {
    return `<div class="pl-tile-select pl-tile-draft" aria-label="Unsaved design preview">${av}<span class="pl-tile-info">${name}<span class="t-micro g400">UNSAVED DRAFT · LIVE PREVIEW</span></span></div>`;
  }
  const status = tileStateLabel(selected, Boolean(p.isEditing));
  return `<button class="pl-tile-select" type="button" data-profile-select="${esc(p.id)}" aria-pressed="${selected}">${av}<span class="pl-tile-info">${name}${status}</span></button>`;
}

function tileActionsHTML(p) {
  if (p.isDraft) {
    return `<div class="pl-tile-actions"><span class="t-micro g400 pl-draft-badge">DRAFT</span></div>`;
  }
  return `<div class="pl-tile-actions"><button class="btn-dark" type="button" data-profile-edit="${esc(p.id)}"><span class="t-label">EDIT</span></button><button class="btn-dark pl-delete" type="button" data-profile-delete="${esc(p.id)}"><span class="t-label">DELETE</span></button></div>`;
}

function libraryTileHTML(p, i, activeId) {
  const selected = !p.isDraft && p.id === activeId;
  return `<div class="${tileClasses(p, selected)}">
      ${tileSelectHTML(p, i, selected)}
      ${tileActionsHTML(p)}
    </div>`;
}

export function renderProfileLibrary() {
  const atCap = state.profiles.length >= MAX_PROFILES;
  configureDesignButtons(atCap);
  const list = $("#pl-list");
  if (!list) return;
  if (!state.profiles.length) {
    if (!state.profileDraft) {
      list.innerHTML = emptyLibraryMessage();
      return;
    }
  }
  const activeId = typeof state.appearance === "string" ? state.appearance : null;
  const draft = state.profileDraft;
  const cards = state.profiles.map((profile, i) => cardForProfile(profile, i, draft));
  const draftEntry = draftCard();
  if (draftEntry) cards.unshift(draftEntry);
  list.innerHTML = cards.map((p, i) => libraryTileHTML(p, i, activeId)).join("");
}

function homeColor(saved, account, preset) {
  if (saved?.color) return saved.color;
  if (account?.color) return account.color;
  if (preset.color) return preset.color;
  return "#d74438";
}

function homeAvatarHTML(source, color, size) {
  if (source?.avatarGrid) return spriteFromGrid(source.avatarGrid, size);
  return avatarHTML({ color }, size, 0);
}

export function applyProfileToHomeUI() {
  const saved = selectedProfile();
  const account = state.account?.account || null;
  const name = sourceName(account);
  const color = homeColor(saved, account, getAppearanceMeta(state.appearance));
  const avatarSource = saved || account;

  document.querySelectorAll("[data-global-you-name]").forEach((nameNode) => {
    nameNode.textContent = name;
  });
  document.querySelectorAll("[data-global-you-avatar]").forEach((avatarNode) => {
    avatarNode.innerHTML = homeAvatarHTML(avatarSource, color, 3);
  });

  setText("#chair-name", `that's you, ${name}`);
  setHTML("#chair-avatar", homeAvatarHTML(avatarSource, color, 4));

  const resumeBtn = $("#resume-btn");
  if (resumeBtn) resumeBtn.classList.toggle("is-hidden", !host.loadSavedGame());
  renderGuestAliasField();
  host.renderHomeSignals();
}

function syncAliasInput(input, signedIn) {
  if (!input) return;
  if (signedIn) return;
  if (input.value === state.alias) return;
  input.value = state.alias;
}

export function renderGuestAliasField(errorText = "") {
  const signedIn = Boolean(state.account?.account);
  $("#home-alias-form")?.classList.toggle("is-hidden", signedIn);
  const aliasInput = $("#home-alias");
  syncAliasInput(aliasInput, signedIn);
  setText("#home-alias-error", errorText);
  if (aliasInput) {
    if (errorText) aliasInput.setAttribute("aria-describedby", "home-alias-error");
    else aliasInput.removeAttribute("aria-describedby");
  }
}

export function requireGuestAlias() {
  if (state.account?.account) return true;
  const alias = String(state.alias || "").trim();
  if (alias) return true;
  renderGuestAliasField("CREATE AN ALIAS BEFORE JOINING A TABLE.");
  $("#home-alias")?.focus({ preventScroll: true });
  return false;
}

function swatchHTML(c, d) {
  const active = c.toLowerCase() === d.color.toLowerCase();
  return `<button type="button" class="profile-swatch${active ? " is-active" : ""}" style="background:${c}" data-color="${c}" title="${c}" aria-label="Player color ${c}" aria-pressed="${active}"></button>`;
}

function faceSwatchHTML(c, d) {
  const active = d.tool === "paint" && c.toLowerCase() === d.paintColor.toLowerCase();
  return `<button type="button" class="face-swatch${active ? " is-active" : ""}" style="background:${c}" data-ink="${c}" title="${c}" aria-label="Paint color ${c}" aria-pressed="${active}"></button>`;
}

// One tab stop for the whole face grid (roving focus): the cell last focused, moved with the arrow keys.
let faceFocus = { x: 0, y: 0 };
export function setFaceFocus(x, y) { faceFocus = { x, y }; }

function faceCellHTML(c, x, y) {
  const style = c ? `background-color:${c};background-image:none` : "";
  const tab = x === faceFocus.x && y === faceFocus.y ? 0 : -1;
  return `<button type="button" class="face-cell" tabindex="${tab}" data-x="${x}" data-y="${y}" style="${style}" aria-label="Paint pixel row ${y + 1} column ${x + 1}"></button>`;
}

export function renderProfileEditor() {
  const d = state.profileDraft;
  if (!d) return;
  const deleteBtn = $("#profile-delete-btn");
  if (deleteBtn) deleteBtn.classList.toggle("is-hidden", !state.editingProfileId);
  const saveLabel = $("#pl-save-btn")?.querySelector(".cta-text");
  if (saveLabel) saveLabel.textContent = state.editingProfileId ? "Save Changes" : "Save Design";
  $("#profile-swatches").innerHTML = PROFILE_SWATCHES.map((c) => swatchHTML(c, d)).join("");
  $("#profile-color-picker").value = d.color;
  $("#profile-name").value = d.designName;

  $("#face-palette").innerHTML = FACE_PALETTE.map((c) => faceSwatchHTML(c, d)).join("");
  $("#face-color-picker").value = d.paintColor;
  $("#face-tool-paint").classList.toggle("is-active", d.tool === "paint");
  $("#face-tool-erase").classList.toggle("is-active", d.tool === "erase");

  const canvas = $("#face-canvas");
  canvas.innerHTML = d.grid
    .map((row, y) => row.map((c, x) => faceCellHTML(c, x, y)).join(""))
    .join("");

  updateProfilePreview();
  renderProfileSummary();
}

export function updateProfilePreview() {
  const d = state.profileDraft;
  if (!d) return;
  const av = $("#profile-preview-av");
  if (av) av.innerHTML = spriteFromGrid(d.grid, 6);
  const nameEl = $("#profile-preview-name");
  if (nameEl) nameEl.textContent = (d.designName || "UNTITLED DESIGN").toUpperCase();
  const chipEl = $("#profile-preview-chip");
  if (chipEl) chipEl.style.background = d.color;
  renderProfileLibrary();
  renderProfileSummary();
}

export function paintFaceCell(x, y) {
  const d = state.profileDraft;
  if (!d) return;
  const color = d.tool === "erase" ? null : d.paintColor;
  if (d.grid[y][x] === color) return;
  d.grid[y][x] = color;
  const cell = $(`#face-canvas .face-cell[data-x="${x}"][data-y="${y}"]`);
  if (cell) {
    cell.style.backgroundColor = color || "";
    cell.style.backgroundImage = color ? "none" : "";
  }
  updateProfilePreview();
}
