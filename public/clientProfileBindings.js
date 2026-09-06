/* ============================================================
   PROFILE BINDINGS: the profile/account/achievements surface
   bindings plus the design-editor state machine (draft, save,
   delete, face painting). showView and emitServer are injected by
   the entry module; every selector, string and payload is the
   exact old main.js code.
   ============================================================ */
import { $ } from "./clientDom.js";
import { state, getProfileById, upsertProfile, deleteProfile } from "./clientState.js";
import { MAX_PROFILES, profileDesignName } from "./clientSanitize.js";
import { emptyFaceGrid, faceGridFromPreset, cloneFaceGrid } from "./clientSprites.js";
import {
  renderProfileSummary,
  renderProfileLibrary,
  renderProfileEditor,
  updateProfilePreview,
  paintFaceCell,
  renderAccountPanel,
} from "./clientProfileRender.js";
import { openConfirmModal } from "./clientSurfaces.js";
import {
  renderAchievements,
  openAchievementModal,
  closeAchievementModal,
  setAchievementFilter,
  setAchievementDateFilter,
  setAchievementRarityFilter,
  updateAccountFromResponse,
  openAccountModal,
  closeAccountModal,
  logoutAccount,
} from "./clientAccountIdentity.js";
import { setActiveAppearance, renderSetup, renderLobbyRail, leaveRoomForHome } from "./clientLobbyUi.js";
import { closeRoomsModal, renderHome } from "./clientRoomsUi.js";

let host = { showView: noop, emitServer: noop };

function noop() {}

export function configureProfileBindings(hooks) {
  host = { ...host, ...hooks };
}

function setProfileTab(tab = "designs", focus = false) {
  const allowed = ["overview", "stats", "designs", "history", "achievements", "account"];
  const next = allowed.includes(tab) ? tab : "designs";
  state.profileTab = next;
  const root = $("#view-profile");
  if (root) root.dataset.profileTab = next;
  document.querySelectorAll("#profile-tabs [data-profile-tab]").forEach((button) => {
    const active = button.dataset.profileTab === next;
    button.classList.toggle("is-active", active);
    button.setAttribute("aria-selected", String(active));
    button.tabIndex = active ? 0 : -1;
  });
  document.querySelectorAll("#view-profile .profile-tab-panel").forEach((panel) => {
    panel.classList.toggle("is-hidden", panel.id !== `profile-panel-${next}`);
  });
  renderProfileSummary();
  if (focus) {
    const panel = $(`#profile-panel-${next}`);
    panel?.focus({ preventScroll: true });
  }
}

/** Open editor. Pass a profile id to edit, or nothing to create a new one. */
function draftFromSource(source) {
  return {
    designName: profileDesignName(source),
    color: source.color,
    grid: cloneFaceGrid(source.avatarGrid),
    tool: "paint",
    paintColor: source.color,
  };
}

function draftFromAccount(account) {
  const color = account?.color || "#d74438";
  const grid = account?.avatarGrid
    ? cloneFaceGrid(account.avatarGrid)
    : faceGridFromPreset(0, color);
  return { designName: "", color, grid, tool: "paint", paintColor: "#f0d9ac" };
}

function openProfileEditor(fromPhase, profileId) {
  closeRoomsModal();
  state.homeReturnView = fromPhase === "setup" ? "setup-return" : "home";
  state.editingProfileId = profileId || null;
  const existing = profileId ? getProfileById(profileId) : null;
  state.profileDraft = existing ? draftFromSource(existing) : draftFromAccount(state.account?.account);
  state.profileTab = "designs";
  renderProfileEditor();
  renderAccountPanel();
  renderProfileLibrary();
  host.showView("profile");
  setProfileTab(state.profileTab);
}

function announceProfileSave(message) {
  const status = $("#profile-save-status");
  if (status) status.textContent = message;
}

function draftProfilePayload(d, asNew) {
  const hasInk = d.grid.some((row) => row.some((c) => c));
  return {
    id: !asNew && state.editingProfileId ? state.editingProfileId : `pf_${Math.random().toString(36).slice(2, 9)}`,
    designName: String(d.designName || "").trim().slice(0, 12).toUpperCase() || "UNTITLED DESIGN",
    color: d.color,
    avatarGrid: hasInk ? d.grid : faceGridFromPreset(0, d.color),
  };
}

function accountUpdateAck(response) {
  if (response?.success) {
    updateAccountFromResponse(response);
    return;
  }
  const error = response?.error;
  if (!error) return;
  const announcer = $("#error-announcer");
  if (announcer) announcer.textContent = error;
}

function syncSavedDesignToAccount(saved) {
  if (!state.account?.sessionToken) return;
  host.emitServer("account-update", {
    sessionToken: state.account.sessionToken,
    color: saved.color,
    avatarGrid: saved.avatarGrid,
  }, accountUpdateAck);
}

function stayAfterSave(saved) {
  state.editingProfileId = saved.id;
  state.profileDraft = draftFromSource(saved);
  renderProfileEditor();
  renderProfileLibrary();
  setProfileTab("designs");
  announceProfileSave(`Saved "${profileDesignName(saved)}" as a new design.`);
}

function saveProfileDesign({ asNew = false, stay = false } = {}) {
  const d = state.profileDraft;
  if (!d) return null;
  const designName = String(d.designName || "").trim().slice(0, 12).toUpperCase() || "UNTITLED DESIGN";
  const saved = upsertProfile(draftProfilePayload(d, asNew));
  if (saved === "limit") {
    announceProfileSave(`You can only save up to ${MAX_PROFILES} designs. Delete one to make room.`);
    return saved;
  }
  if (!saved) return null;
  setActiveAppearance(saved.id);
  syncSavedDesignToAccount(saved);
  if (stay) stayAfterSave(saved);
  return saved;
}

function closeProfileEditor(save) {
  if (save) {
    const saved = saveProfileDesign({ asNew: !state.editingProfileId });
    if (saved === "limit" || !saved) return;
  }
  state.profileDraft = null;
  state.editingProfileId = null;
  if (state.homeReturnView === "setup-return") host.showView("game");
  else leaveRoomForHome();
  if (state.homeReturnView === "setup-return") {
    renderSetup();
    renderLobbyRail();
  } else {
    renderHome();
  }
}

function deleteCurrentProfile() {
  if (!state.editingProfileId) { closeProfileEditor(false); return; }
  deleteProfile(state.editingProfileId);
  state.profileDraft = null;
  state.editingProfileId = null;
  if (state.homeReturnView === "setup-return") host.showView("game");
  else leaveRoomForHome();
  if (state.homeReturnView === "setup-return") {
    renderSetup();
    renderLobbyRail();
  } else {
    renderHome();
  }
}

function confirmDeleteProfileDesign(id, onConfirm) {
  const profile = getProfileById(id);
  if (!profile) return;
  openConfirmModal({
    title: "Delete saved design?",
    message: `Delete “${profileDesignName(profile)}”? This cannot be undone.`,
    confirmLabel: "DELETE DESIGN",
    onConfirm,
  });
}

const PROFILE_TAB_KEYS = ["ArrowRight", "ArrowDown", "ArrowLeft", "ArrowUp", "Home", "End"];

function profileTabHomeIndex(current, key, length) {
  if (key === "Home") return 0;
  if (key === "End") return length - 1;
  const forward = ["ArrowRight", "ArrowDown"].includes(key);
  if (forward) return (current + 1) % length;
  return (current - 1 + length) % length;
}

function onProfileTabsKeydown(e) {
  const tabs = [...document.querySelectorAll("#profile-tabs [data-profile-tab]")];
  const current = tabs.indexOf(e.target.closest("[data-profile-tab]"));
  if (current < 0) return;
  if (!PROFILE_TAB_KEYS.includes(e.key)) return;
  e.preventDefault();
  const next = tabs[profileTabHomeIndex(current, e.key, tabs.length)];
  setProfileTab(next.dataset.profileTab);
  next.focus();
}

function onProfileHeroAccountClick() {
  if (state.account?.account) openAccountModal("edit");
  else openAccountModal("register");
}

function onPlNewClick() {
  if (state.profiles.length >= MAX_PROFILES) {
    alert(`You can only save up to ${MAX_PROFILES} custom designs. Delete one to make room.`);
    return;
  }
  openProfileEditor("home");
}

function confirmProfileDeleteFromLibrary(id) {
  if (state.editingProfileId === id) deleteCurrentProfile();
  else {
    deleteProfile(id);
    renderProfileLibrary();
    renderProfileSummary();
  }
}

function onProfileListDelete(e, deleteBtn) {
  e.stopPropagation();
  const id = deleteBtn.dataset.profileDelete;
  confirmDeleteProfileDesign(id, () => confirmProfileDeleteFromLibrary(id));
}

function onProfileListEdit(e, editBtn) {
  e.stopPropagation();
  openProfileEditor("home", editBtn.dataset.profileEdit);
}

function onProfileListSelect(tile) {
  const p = getProfileById(tile.dataset.profileSelect);
  if (p) setActiveAppearance(p.id);
}

function onProfileListClick(e) {
  const deleteBtn = e.target.closest("[data-profile-delete]");
  if (deleteBtn) { onProfileListDelete(e, deleteBtn); return; }
  const editBtn = e.target.closest("[data-profile-edit]");
  if (editBtn) { onProfileListEdit(e, editBtn); return; }
  const tile = e.target.closest("[data-profile-select]");
  if (tile) onProfileListSelect(tile);
}

function onProfileDeleteBtnClick() {
  if (!state.editingProfileId) return;
  confirmDeleteProfileDesign(state.editingProfileId, () => deleteCurrentProfile());
}

function onActiveProfileEditClick() {
  const activeId = typeof state.appearance === "string" ? state.appearance : null;
  openProfileEditor("home", activeId);
}

let isPainting = false;

function onFaceMouseDown(e) {
  const cell = e.target.closest(".face-cell");
  if (!cell) return;
  isPainting = true;
  paintFaceCell(Number(cell.dataset.x), Number(cell.dataset.y));
}

function onFaceMouseOver(e) {
  if (!isPainting) return;
  const cell = e.target.closest(".face-cell");
  if (!cell) return;
  paintFaceCell(Number(cell.dataset.x), Number(cell.dataset.y));
}

export function bindProfileUi() {
  // profile editor — entry points
  document.querySelectorAll("[data-global-profile-trigger]").forEach((button) => {
    button.addEventListener("click", onActiveProfileEditClick);
  });
  $("#profile-hero-account-btn")?.addEventListener("click", onProfileHeroAccountClick);
  $("#profile-overview-edit-btn")?.addEventListener("click", () => {
    setProfileTab("designs");
    $("#profile-name")?.focus({ preventScroll: true });
  });
  $("#profile-tabs")?.addEventListener("click", (e) => {
    const button = e.target.closest("[data-profile-tab]");
    if (button) setProfileTab(button.dataset.profileTab);
  });
  $("#profile-tabs")?.addEventListener("keydown", onProfileTabsKeydown);
  $("#chair-edit-btn")?.addEventListener("click", onActiveProfileEditClick);
  $("#pl-new-btn")?.addEventListener("click", onPlNewClick);
  $("#achievements-filters")?.addEventListener("click", (e) => {
    const button = e.target.closest("[data-achievement-filter]");
    if (button) setAchievementFilter(button.dataset.achievementFilter);
  });
  $("#achievement-date-filter")?.addEventListener("change", (e) => setAchievementDateFilter(e.target.value));
  $("#achievement-rarity-filter")?.addEventListener("change", (e) => setAchievementRarityFilter(e.target.value));
  $("#achievements-grid")?.addEventListener("click", (e) => {
    const card = e.target.closest("[data-achievement-id]");
    if (card) openAchievementModal(card.dataset.achievementId, card);
  });
  $("#achievement-scrim")?.addEventListener("click", closeAchievementModal);
  $("#pl-save-btn")?.addEventListener("click", () => {
    saveProfileDesign({ asNew: true, stay: true });
  });
  $("#pl-list")?.addEventListener("click", onProfileListClick);
  $("#account-register-btn")?.addEventListener("click", () => openAccountModal("register"));
  $("#account-login-btn")?.addEventListener("click", () => openAccountModal("login"));
  $("#account-edit-btn")?.addEventListener("click", () => openAccountModal("edit"));
  $("#account-logout-btn")?.addEventListener("click", logoutAccount);
  $("#account-scrim")?.addEventListener("click", closeAccountModal);

  // profile editor — delete
  $("#profile-delete-btn")?.addEventListener("click", onProfileDeleteBtnClick);

  // profile editor — identity
  $("#profile-name")?.addEventListener("input", (e) => {
    state.profileDraft.designName = e.target.value.toUpperCase().slice(0, 12);
    updateProfilePreview();
  });
  $("#profile-swatches")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-color]");
    if (!btn) return;
    state.profileDraft.color = btn.dataset.color;
    renderProfileEditor();
  });
  $("#profile-color-picker")?.addEventListener("input", (e) => {
    state.profileDraft.color = e.target.value;
    renderProfileEditor();
  });

  // profile editor — face canvas painting (click + drag)
  const faceCanvasEl = $("#face-canvas");
  faceCanvasEl?.addEventListener("mousedown", onFaceMouseDown);
  faceCanvasEl?.addEventListener("mouseover", onFaceMouseOver);
  window.addEventListener("mouseup", () => { isPainting = false; });
  faceCanvasEl?.addEventListener("dragstart", (e) => e.preventDefault());

  // profile editor — ink palette + tools
  $("#face-palette")?.addEventListener("click", (e) => {
    const btn = e.target.closest("[data-ink]");
    if (!btn) return;
    state.profileDraft.tool = "paint";
    state.profileDraft.paintColor = btn.dataset.ink;
    renderProfileEditor();
  });
  $("#face-color-picker")?.addEventListener("input", (e) => {
    state.profileDraft.tool = "paint";
    state.profileDraft.paintColor = e.target.value;
    renderProfileEditor();
  });
  $("#face-tool-paint")?.addEventListener("click", () => {
    state.profileDraft.tool = "paint";
    renderProfileEditor();
  });
  $("#face-tool-erase")?.addEventListener("click", () => {
    state.profileDraft.tool = "erase";
    renderProfileEditor();
  });
  $("#face-clear-btn")?.addEventListener("click", () => {
    state.profileDraft.grid = emptyFaceGrid();
    renderProfileEditor();
  });
  $("#face-default-btn")?.addEventListener("click", () => {
    state.profileDraft.grid = faceGridFromPreset(0, state.profileDraft.color);
    renderProfileEditor();
  });

  // profile editor — save / cancel / back
  $("#profile-save-btn")?.addEventListener("click", () => closeProfileEditor(true));
  $("#profile-cancel-btn")?.addEventListener("click", () => closeProfileEditor(false));
  $("#profile-back-btn")?.addEventListener("click", () => closeProfileEditor(false));
}

export { openProfileEditor, closeProfileEditor };
