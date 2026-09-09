/* ============================================================
   ROOMS UI: the browse/create/join rooms modal, the public table
   directory and the home screen. lobbyState is the single owner of
   the rooms-modal mutables (importers mutate its properties, never
   rebind it). emitServer, say, renderChat and enterParlor are
   injected by the entry module.
   ============================================================ */
import { $ } from "./clientDom.js";
import { state } from "./clientState.js";
import { hydrateSprites, spriteHTML } from "./clientSprites.js";
import { SKYLINE, paintSkyline } from "./clientBoardRender.js";
import { renderConnectionStatus } from "./clientTopNavRender.js";
import { applyProfileToHomeUI, renderAccountPanel, requireGuestAlias } from "./clientProfileRender.js";
import { closeSurface, openSurface } from "./clientSurfaces.js";
import { parlorNotice } from "./clientSocialSurfaces.js";
import { renderHomeLocalTime, renderPatrolHud } from "./clientHomeAmbient.js";
import { saveRulesetPreset } from "./clientSanitize.js";

export const lobbyState = {
  roomsDirectory: [],
  roomsLoading: false,
  roomsDirectoryLoaded: false,
  roomsDirectoryFetchedAt: 0,
  roomsDirectoryRequestId: 0,
  roomsDirectoryTimeout: null,
  roomsFilter: "all",
  roomModalTab: "browse", // "browse" | "create" | "join"
  createRoomSettings: {
    name: "",
    visibility: "public", // "public" | "private"
    code: "",
    rulesetPreset: "classic",
    boardVariant: "standard-40",
  },
};

let host = { emitServer: noop, say: noop, renderChat: noop, enterParlor: noop };

function noop() {}

export function configureRoomsUi(hooks) {
  host = { ...host, ...hooks };
}

function roomStateColor(stateName) {
  if (stateName === "live") return "#35a653";
  if (stateName === "full") return "#d9a62f";
  return "#3a382a";
}

function filteredRooms() {
  if (lobbyState.roomsFilter === "open") return lobbyState.roomsDirectory.filter((r) => r.seats < r.cap);
  if (lobbyState.roomsFilter === "live") return lobbyState.roomsDirectory.filter((r) => r.state === "live");
  return lobbyState.roomsDirectory;
}

function roomRowHTML(r) {
  const full = r.seats >= r.cap;
  const open = r.cap - r.seats;
  const isPrivate = r.visibility === "private";
  const visLabel = isPrivate ? "PRIVATE" : "PUBLIC · DIRECT JOIN";
  return `<div class="room-row">
    <div class="room-main">
      <div class="room-top">
        ${isPrivate ? `<span class="t-label f12 room-code">${r.code}</span>` : `<span class="t-label f12 room-code room-code-public">OPEN TABLE</span>`}
        <span class="t-label f13 room-name">${r.name}</span>
        <span class="t-micro g400" style="margin-left:4px">${visLabel}</span>
        <span class="room-meta-item room-state-tag"><span class="st-dot" style="background:${roomStateColor(r.state)}"></span><span class="t-micro ink-3">${r.state}</span></span>
      </div>
      <div class="room-meta">
        <span class="t-micro ink-3 room-meta-item">SEATS ${r.seats}/${r.cap}</span>
        <span class="t-micro ink-3 room-meta-item">OPEN ${open}</span>
        <span class="t-micro ink-3 room-meta-item">BANK ${r.bank}</span>
        <span class="t-micro g400 room-meta-item">${String(r.rulesetPreset || "classic").toUpperCase()}</span>
        <span class="t-micro g400 room-meta-item">${String(r.boardVariant || "standard-40").toUpperCase()}</span>
        <span class="t-micro ink-3 room-meta-item">${Array.isArray(r.addOns) && r.addOns.length ? r.addOns.join(" · ") : "NO ADD-ONS"}</span>
        <span class="t-micro g-muted room-meta-item">${r.note}</span>
      </div>
    </div>
    <div class="room-actions">
      <button class="btn-dark" data-join="${r.code}" ${full ? "disabled" : ""}>
        <span class="t-label f11">${full ? "FULL" : "JOIN"}</span>
      </button>
      ${isPrivate ? `<button class="btn-dark" data-copy="${r.code}" title="Copy code"><span class="t-label f11">COPY</span></button>` : ""}
    </div>
  </div>`;
}

function renderRoomsList() {
  const list = $("#rooms-list");
  if (!list) return;
  const rooms = filteredRooms();
  list.innerHTML = lobbyState.roomsLoading
    ? `<div class="rooms-empty t-body">CHECKING PUBLIC TABLES…</div>`
    : rooms.length
    ? rooms.map(roomRowHTML).join("")
    : `<div class="rooms-empty t-body">NO PUBLIC TABLES RIGHT NOW. HOST ONE OR ENTER A CODE.</div>`;

  document.querySelectorAll(".rooms-filter").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.filter === lobbyState.roomsFilter);
  });

}

function updateCreateRoomUI() {
  const settings = lobbyState.createRoomSettings;
  const isPrivate = settings.visibility === "private";
  const codeField = $("#rc-private-code-field");
  if (codeField) codeField.classList.toggle("is-hidden", !isPrivate);
  const codeInput = $("#rc-room-code");
  syncCreateRoomCode(codeInput, settings);
  const codeValid = /^[A-Z0-9]{6}$/.test(settings.code);
  paintCreateCodeStatus(isPrivate, codeValid, settings);
  if (codeInput) codeInput.setAttribute("aria-invalid", String(isPrivate && !codeValid));
  const createButton = $("#rc-create-btn");
  if (createButton) createButton.disabled = isPrivate && !codeValid;
  document.querySelectorAll("#rc-vis-selector .rc-vis-opt").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.vis === lobbyState.createRoomSettings.visibility);
  });
  const preset = $("#rc-ruleset-preset");
  if (preset && preset.value !== lobbyState.createRoomSettings.rulesetPreset) preset.value = lobbyState.createRoomSettings.rulesetPreset;
  const board = $("#rc-board-variant");
  if (board && board.value !== lobbyState.createRoomSettings.boardVariant) board.value = lobbyState.createRoomSettings.boardVariant;
}

function syncCreateRoomCode(codeInput, settings) {
  if (!codeInput) return;
  if (codeInput.value === settings.code) return;
  codeInput.value = settings.code;
}

function paintCreateCodeStatus(isPrivate, codeValid, settings) {
  const codeStatus = $("#rc-code-status");
  if (!codeStatus) return;
  codeStatus.textContent = !isPrivate ? "NOT NEEDED FOR PUBLIC TABLES" : codeValid ? "READY" : `${lobbyState.createRoomSettings.code.length}/6 CHARACTERS`;
  codeStatus.classList.toggle("is-valid", isPrivate && codeValid);
  codeStatus.classList.toggle("is-invalid", isPrivate && !codeValid);
}

function switchRoomModalTab(tab) {
  lobbyState.roomModalTab = tab;
  const isBrowse = tab === "browse";
  const isCreate = tab === "create";
  const isJoin = tab === "join";
  paintRoomTabButton("#rm-tab-browse", isBrowse);
  paintRoomTabButton("#rm-tab-create", isCreate);
  paintRoomTabButton("#rm-tab-join", isJoin);
  setRoomPanel("#rm-panel-browse", !isBrowse);
  setRoomPanel("#rm-panel-create", !isCreate);
  setRoomPanel("#rm-panel-join", !isJoin);
  paintRoomModalTitle(isBrowse, isJoin);
  selectRoomModalPanel(isBrowse, isCreate, isJoin);
}

function paintRoomTabButton(selector, selected) {
  const btn = $(selector);
  if (!btn) return;
  btn.classList.toggle("is-active", selected);
  btn.setAttribute("aria-selected", String(selected));
}

function setRoomPanel(selector, hidden) {
  const panel = $(selector);
  if (panel) panel.classList.toggle("is-hidden", hidden);
}

function paintRoomModalTitle(isBrowse, isJoin) {
  const titleText = $("#rooms-title-text");
  if (titleText) titleText.textContent = isBrowse ? "Available Rooms" : isJoin ? "Join Room" : "Create Custom Room";
  $("#rooms-modal")?.setAttribute("aria-describedby", isJoin ? "join-room-description" : "rooms-description");
}

function selectRoomModalPanel(isBrowse, isCreate, isJoin) {
  if (isBrowse) {
    renderRoomsList();
    return;
  }
  if (isCreate) {
    updateCreateRoomUI();
    return;
  }
  if (isJoin) paintJoinRoomPanel();
}

function paintJoinRoomPanel() {
  const signedIn = Boolean(state.account?.account);
  const code = $("#room-join");
  if (code) code.value = cleanJoinCodeValue(code.value);
  paintJoinNickname($("#join-nickname"), signedIn);
  $("#join-nickname-field")?.classList.toggle("is-hidden", signedIn);
  paintJoinDescription(signedIn);
  $("#join-form-error")?.replaceChildren();
}

function cleanJoinCodeValue(value) {
  return String(value || "").toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
}

function paintJoinNickname(nickname, signedIn) {
  if (!nickname) return;
  nickname.value = signedIn ? state.account.account.displayName : (nickname.value || state.alias || "");
  nickname.required = !signedIn;
  nickname.disabled = signedIn;
}

function paintJoinDescription(signedIn) {
  const description = $("#join-room-description");
  if (description) description.textContent = signedIn
  ? "Enter the room code. Your account display name will be used at the table."
  : "Enter the room code and the name you want to use at the table.";
}

export function requestRoomsDirectory() {
  const requestId = ++lobbyState.roomsDirectoryRequestId;
  lobbyState.roomsLoading = true;
  renderHomeSignals();
  renderRoomsList();
  clearTimeout(lobbyState.roomsDirectoryTimeout);
  lobbyState.roomsDirectoryTimeout = setTimeout(() => {
    lobbyState.roomsDirectoryTimeout = null;
    if (!lobbyState.roomsLoading || requestId !== lobbyState.roomsDirectoryRequestId) return;
    lobbyState.roomsLoading = false;
    renderHomeSignals();
    renderRoomsList();
    parlorNotice("BROWSE", "Public tables could not be loaded — try again.");
  }, 5000);
  host.emitServer("list-rooms", {}, (response) => applyRoomsDirectoryResponse(response, requestId));
}

function applyRoomsDirectoryResponse(response, requestId = lobbyState.roomsDirectoryRequestId) {
  if (requestId !== lobbyState.roomsDirectoryRequestId) return;
  clearTimeout(lobbyState.roomsDirectoryTimeout);
  lobbyState.roomsDirectoryTimeout = null;
  lobbyState.roomsLoading = false;
  if (response?.success === false) {
    failRoomsDirectory(response);
  } else {
    lobbyState.roomsDirectory = Array.isArray(response?.rooms) ? response.rooms : [];
    lobbyState.roomsDirectoryLoaded = true;
    lobbyState.roomsDirectoryFetchedAt = Date.now();
  }
  renderHomeSignals();
  renderRoomsList();
}

function failRoomsDirectory(response) {
  if (!lobbyState.roomsDirectoryLoaded) lobbyState.roomsDirectory = [];
  parlorNotice("BROWSE", response.error || "Public tables could not be loaded.");
  host.say(response.error || "Public tables could not be loaded.");
  host.renderChat();
}

export function applyRoomsUpdated(payload) {
  lobbyState.roomsDirectory = Array.isArray(payload?.rooms) ? payload.rooms : lobbyState.roomsDirectory;
  lobbyState.roomsDirectoryLoaded = true;
  lobbyState.roomsDirectoryFetchedAt = Date.now();
  renderHomeSignals();
  if (!$("#rooms-modal").classList.contains("is-hidden")) renderRoomsList();
}

export function openRoomsModal(tab = "browse") {
  lobbyState.roomsFilter = "all";
  switchRoomModalTab(tab);
  openSurface("#rooms-modal", tab === "join" ? "#room-join" : "#rooms-close");
  if (tab === "browse") requestRoomsDirectory();
}

export function closeRoomsModal() {
  closeSurface("#rooms-modal");
  if (state.phase === "home") setHomeTab("play");
}

export function renderHome() {
  setHomeTab("play");
  renderHomeLocalTime();
  renderPatrolHud();
  paintSkyline($("#home-skyline"), SKYLINE);
  paintSkyline($("#home-skyline-copy"), SKYLINE);
  buildMiniBoard();
  renderRoomsList();
  renderHomeSignals();
  refreshHomeDirectory();
  renderAccountPanel();
  applyProfileToHomeUI();
  renderConnectionStatus();
  renderHomeSignals();
  hydrateSprites();
}

export function refreshHomeDirectory() {
  if (state.phase !== "home" || state.connectionStatus !== "online" || lobbyState.roomsLoading) return;
  const stale = Date.now() - Number(lobbyState.roomsDirectoryFetchedAt || 0) > 15000;
  if (!lobbyState.roomsDirectoryLoaded || stale) requestRoomsDirectory();
}

const MINI_GROUPS = ["#7b5029", "#3e7d7b", "#a04e6f", "#87231e", "#4b853d", "#286ea1"];

function buildMiniBoard() {
  const grid = $("#mini-grid");
  if (!grid) return;
  if (grid.dataset.built) return;
  grid.insertAdjacentHTML("afterbegin", miniBoardCellsHTML());
  grid.dataset.built = "1";
}

function miniBoardCellsHTML() {
  let cells = "";
  for (let i = 0; i < 64; i++) cells += miniBoardCellHTML(i);
  return cells;
}

function miniBoardCellHTML(i) {
  const x = i % 8;
  const y = Math.floor(i / 8);
  if (!isBoardEdge(x, y)) return "<span></span>";
  const corner = isBoardCorner(x, y);
  return `<span class="mini-cell${corner ? " is-corner" : ""}">${
    corner ? spriteHTML("diamond", 2) : `<span class="strip" style="background:${MINI_GROUPS[(x + y) % MINI_GROUPS.length]}"></span>`
  }</span>`;
}

function isBoardEdge(x, y) {
  return edgeColumn(x) || edgeRow(y);
}

function isBoardCorner(x, y) {
  return edgeColumn(x) && edgeRow(y);
}

function edgeColumn(x) {
  return x === 0 || x === 7;
}

function edgeRow(y) {
  return y === 0 || y === 7;
}

export function setHomeTab(tab = "play") {
  const next = ["play", "rooms", "profile"].includes(tab) ? tab : "play";
  state.homeTab = next;
  document.querySelectorAll("[data-global-nav] [data-home-tab]").forEach((button) => {
    const active = button.dataset.homeTab === next;
    button.classList.toggle("is-active", active);
    if (active) button.setAttribute("aria-current", "page");
    else button.removeAttribute("aria-current");
  });
}

export function syncGlobalNavigation(surface = "home") {
  const activeHomeTab = surface === "home" ? state.homeTab : surface;
  document.querySelectorAll("[data-global-nav]").forEach((nav) => {
    nav.querySelectorAll("[data-home-tab], [data-top-surface]").forEach((button) => {
      const active = globalNavActive(button, surface, activeHomeTab);
      button.classList.toggle("is-active", active);
      if (active) button.setAttribute("aria-current", "page");
      else button.removeAttribute("aria-current");
    });
  });
}

function globalNavActive(button, surface, activeHomeTab) {
  if (button.dataset.homeTab) return homeTabActive(button, surface, activeHomeTab);
  return button.dataset.topSurface === surface;
}

function homeTabActive(button, surface, activeHomeTab) {
  if (surface === "rankings") return false;
  if (surface === "social") return false;
  return button.dataset.homeTab === activeHomeTab;
}

function onRoomTabsClick(e) {
  const tabBtn = e.target.closest("[data-rm-tab]");
  if (!tabBtn) return;
  const tab = tabBtn.dataset.rmTab;
  switchRoomModalTab(tab);
  // Re-selecting BROWSE inside an open modal must re-fetch, not replay the
  // cached directory (A2-1: the list only loaded on modal open).
  if (tab === "browse") requestRoomsDirectory();
}

function onRoomsListClick(e) {
  const copyBtn = e.target.closest("[data-copy]");
  if (copyBtn) {
    try { navigator.clipboard?.writeText(copyBtn.dataset.copy); } catch { /* no clipboard */ }
    copyBtn.querySelector("span").textContent = "COPIED";
    setTimeout(() => { copyBtn.querySelector("span").textContent = "COPY"; }, 900);
    return;
  }
  const btn = e.target.closest("[data-join]");
  if (canJoinRoomRow(btn)) {
    closeRoomsModal();
    host.enterParlor(btn.dataset.join);
  }
}

function canJoinRoomRow(btn) {
  if (!btn) return false;
  return !btn.disabled;
}

function onRoomsFilterClick(btn) {
  lobbyState.roomsFilter = btn.dataset.filter || "all";
  renderRoomsList();
}

function onVisibilityPick(e) {
  const btn = e.target.closest("[data-vis]");
  if (!btn) return;
  const vis = btn.dataset.vis;
  if (lobbyState.createRoomSettings.visibility !== vis) {
    lobbyState.createRoomSettings.visibility = vis;
    lobbyState.createRoomSettings.code = "";
    updateCreateRoomUI();
  }
}

function onRoomCodeInput(e) {
  e.target.value = e.target.value.toUpperCase().replace(/[^A-Z0-9]/g, "").slice(0, 6);
  lobbyState.createRoomSettings.code = e.target.value;
  updateCreateRoomUI();
}

function onCreateRoomClick() {
  const name = createRoomName();
  const vis = lobbyState.createRoomSettings.visibility;
  const code = lobbyState.createRoomSettings.code || "";
  if (needsGuestAlias()) {
    closeRoomsModal();
    requireGuestAlias();
    return;
  }
  if (invalidPrivateCode()) {
    updateCreateRoomUI();
    $("#rc-room-code")?.focus();
    return;
  }
  state.alias = createRoomAlias();
  state.pendingRoomMeta = createRoomMeta(name, vis, code);
  closeRoomsModal();
  // The backend generates the authoritative room code; the ZIP's local
  // preview code remains a visual hint until the room is created.
  host.enterParlor();
}

function createRoomName() {
  const nameInput = $("#rc-name");
  return (nameInput?.value || "").trim().toUpperCase().slice(0, 18) || "AFTER HOURS #12";
}

function createRoomAlias() {
  return (state.account?.account?.displayName || state.alias || state.profiles[0]?.name || "").slice(0, 12);
}

function needsGuestAlias() {
  if (state.account?.account) return false;
  return !String(state.alias || "").trim();
}

function invalidPrivateCode() {
  return lobbyState.createRoomSettings.visibility === "private"
    && !/^[A-Z0-9]{6}$/.test(lobbyState.createRoomSettings.code);
}

function createRoomMeta(name, vis, code) {
  const meta = {
    roomName: name,
    visibility: vis,
    // Room creation defaults to the documented Classic baseline. The richer
    // preset controls live in the existing in-room settings rail.
    rulesetPreset: lobbyState.createRoomSettings.rulesetPreset || "classic",
    boardVariant: lobbyState.createRoomSettings.boardVariant || "standard-40",
  };
  if (vis === "private") meta.roomCode = code;
  return meta;
}

const HOME_CONNECTION_SIGNAL = {
  connecting: "CONNECTING…",
  online: "LIVE SERVER",
  reconnecting: "RECONNECTING…",
  offline: "OFFLINE",
};

/** Paint the compact home status strip without rebuilding the home page. */
export function renderHomeSignals() {
  const entry = $("[data-home-signal=entry]");
  const sync = $("[data-home-signal=sync]");
  const lobbies = $("[data-home-signal=lobbies]");
  const account = state.account?.account || null;
  const displayName = String(account?.displayName || "").trim();
  const username = String(account?.username || "").trim();
  if (entry) {
    const value = entry.querySelector("#home-signal-entry-value");
    const signedIn = Boolean(account);
    if (value) value.textContent = signedIn ? (displayName || (username ? `@${username}` : "ACCOUNT")) : "NO ACCOUNT";
    entry.dataset.signedIn = String(signedIn);
    entry.title = signedIn ? `Open account @${username || displayName}` : "Open guest profile or create an account";
    entry.setAttribute("aria-label", signedIn
      ? `Open account ${displayName || username}${username ? `, @${username}` : ""}`
      : "Open guest profile or create an account");
  }
  const status = state.connectionStatus || "offline";
  if (sync) {
    const value = sync.querySelector("#home-signal-sync-value");
    if (value) value.textContent = HOME_CONNECTION_SIGNAL[status] || "OFFLINE";
    sync.dataset.connection = status;
    sync.setAttribute("aria-label", `Refresh live room directory · ${HOME_CONNECTION_SIGNAL[status] || "OFFLINE"}`);
  }
  if (lobbies) {
    const value = lobbies.querySelector("#home-signal-lobbies-value");
    const copy = lobbyState.roomsLoading && !lobbyState.roomsDirectoryLoaded
      ? "SYNCING…"
      : lobbyState.roomsDirectoryLoaded
        ? `${lobbyState.roomsDirectory.length} LOBBIES`
        : "— LOBBIES";
    if (value) value.textContent = copy;
    lobbies.dataset.loaded = String(lobbyState.roomsDirectoryLoaded);
    lobbies.setAttribute("aria-label", lobbyState.roomsDirectoryLoaded
      ? `Browse ${lobbyState.roomsDirectory.length} public lobbies`
      : "Browse public lobbies");
  }
}

function onRulesetInput(e) {
  if (e.target.id === "rc-ruleset-preset") {
    lobbyState.createRoomSettings.rulesetPreset = e.target.value;
    saveRulesetPreset(e.target.value);
  }
  if (e.target.id === "rc-board-variant") lobbyState.createRoomSettings.boardVariant = e.target.value;
}

function bindRoomsOpeners() {
  $("#open-create-btn")?.addEventListener("click", () => openRoomsModal("create"));
  $("#open-join-btn")?.addEventListener("click", () => openRoomsModal("join"));
  $("#rooms-close")?.addEventListener("click", closeRoomsModal);
  $("#rooms-scrim")?.addEventListener("click", closeRoomsModal);
}

function bindRoomsModal() {
  // modal tab switching
  $("#rm-tabs")?.addEventListener("click", onRoomTabsClick);

  // rooms directory list interactions
  $("#rooms-list")?.addEventListener("click", onRoomsListClick);

  document.querySelectorAll(".rooms-filter").forEach((btn) => {
    btn.addEventListener("click", () => onRoomsFilterClick(btn));
  });

  // room creation form interactions
  $("#rc-vis-selector")?.addEventListener("click", onVisibilityPick);
  $("#rc-room-code")?.addEventListener("input", onRoomCodeInput);
  $("#rc-ruleset-preset")?.addEventListener("change", onRulesetInput);
  $("#rc-board-variant")?.addEventListener("change", onRulesetInput);
  $("#rc-create-btn")?.addEventListener("click", onCreateRoomClick);
}

export function bindRoomsUi() {
  bindRoomsOpeners();
  bindRoomsModal();
}
