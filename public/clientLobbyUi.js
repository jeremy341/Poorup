/* ============================================================
   LOBBY UI: the setup-overlay appearance chooser, the lobby
   settings rail and the parlor navigation (enter a room, go home).
   emitServer, updateServerSetting, showView, renderAll, say,
   renderChat, clearSave, renderPlayers and closeRoomsModal are
   injected by the entry module.
   ============================================================ */
import { $, esc, clamp } from "./clientDom.js";
import {
  state,
  activeAppearance,
  syncLocalAppearance,
  buildPlayers,
  getAppearanceMeta,
  getProfileById,
} from "./clientState.js";
import {
  APPEARANCES,
  MAX_PROFILES,
  profileDesignName,
  saveActiveDesignId,
} from "./clientSanitize.js";
import { avatarHTML } from "./clientSprites.js";
import { placePieces } from "./clientBoardRender.js";
import { renderTopNav } from "./clientTopNavRender.js";
import {
  applyProfileToHomeUI,
  renderAccountPanel,
  renderProfileLibrary,
  requireGuestAlias,
} from "./clientProfileRender.js";
import { closeAllSurfaces, focusSurface } from "./clientSurfaces.js";
import { parlorNotice } from "./clientSocialSurfaces.js";
import { stopAuctionTimer } from "./clientAuctionUi.js";
import { stopTurnCountdown } from "./clientHudRender.js";

let host = {
  emitServer: noop,
  updateServerSetting: noop,
  showView: noop,
  renderAll: noop,
  say: noop,
  renderChat: noop,
  clearSave: noop,
  renderPlayers: noop,
  closeRoomsModal: noop,
};

function noop() {}

export function configureLobbyUi(hooks) {
  host = { ...host, ...hooks };
}

function setActiveAppearance(choice) {
  state.appearance = choice;
  state.tableAppearanceOverride = null;
  saveActiveDesignId(choice);
  syncLocalAppearance();
  applyProfileToHomeUI();
  renderAccountPanel();
  renderProfileLibrary();
}

function setTableAppearanceOverride(choice) {
  state.tableAppearanceOverride = choice === state.appearance ? null : choice;
  syncLocalAppearance();
  host.renderPlayers();
  renderSetup();
  renderLobbyRail();
  syncServerAppearance();
}

function clearTableAppearanceOverride() {
  state.tableAppearanceOverride = null;
  syncLocalAppearance();
  host.renderPlayers();
  renderSetup();
  renderLobbyRail();
  syncServerAppearance();
}

function renderSetup() {
  const wrap = $("#setup-wrap");
  wrap.classList.toggle("is-hidden", state.phase !== "setup");
  if (state.phase !== "setup") return;

  // Server is authoritative for identity: if the table auto-assigned a
  // different colour than the local design, the picker must show the seat
  // colour as the active row, not the (rejected) design choice.
  const choice = setupAppearanceChoice();
  const meta = getAppearanceMeta(choice);
  paintSetupIdentity(choice, meta);
  paintSetupTabs();
  paintSetupGrid(choice);
}

function setupSeatColor() {
  const seat = state.players.find((p) => p.clientId === state.clientId);
  return String(seat?.color || "").toLowerCase();
}

function setupAppearanceChoice() {
  const seatColor = setupSeatColor();
  // Identity first: a custom design is its own identity and must never
  // collapse onto a color-matching preset. When the local design already
  // explains the seat color, it IS the choice.
  const local = activeAppearance();
  const localColor = String(getAppearanceMeta(local).color || "").toLowerCase();
  if (localColor && localColor === seatColor) return local;
  // Server-authoritative fallback: the table assigned a color the local
  // design does not explain, so the seat color shows as the active row.
  const seatPreset = APPEARANCES.findIndex((a) => String(a.color).toLowerCase() === seatColor);
  if (seatPreset >= 0) return seatPreset;
  return local;
}

function setupTakenColors() {
  const seated = state.players
    .filter((p) => p.clientId !== state.clientId)
    .filter((p) => p.online !== false)
    .filter((p) => !p.bankrupt);
  return new Set(seated.map((p) => String(p.color || "").toLowerCase()));
}

function selectedDesignName(choice, meta) {
  if (typeof choice !== "string") return meta.label;
  const selectedProfile = getProfileById(choice);
  if (!selectedProfile) return meta.label;
  return profileDesignName(selectedProfile);
}

function activeDesignName() {
  if (typeof state.appearance !== "string") return getAppearanceMeta(state.appearance).label;
  const activeProfile = getProfileById(state.appearance);
  if (!activeProfile) return getAppearanceMeta(state.appearance).label;
  return profileDesignName(activeProfile);
}

function tableAppearanceIsDifferent() {
  const override = state.tableAppearanceOverride;
  if (override == null) return false;
  return override !== state.appearance;
}

function paintSetupIdentity(choice, meta) {
  // The active design is the default. The chooser is deliberately opt-in so
  // joining a table never asks the player to make the same identity decision twice.
  const selectedName = selectedDesignName(choice, meta);
  const sourceLabel = state.tableAppearanceOverride == null ? "ACTIVE DESIGN" : "THIS TABLE ONLY";
  const activeName = activeDesignName();
  const activeIsDifferent = tableAppearanceIsDifferent();
  const activeCard = $("#su-active-card");
  if (activeCard) {
    activeCard.innerHTML = `<div class="su-active-avatar">${avatarHTML({ color: meta.color, avatarGrid: meta.avatarGrid }, 4, 0)}</div><div class="su-active-copy"><span class="t-micro ${activeIsDifferent ? "g400" : "green"}">${sourceLabel}</span><strong class="t-label f14 su-active-name" style="color:${meta.textColor}">${esc(selectedName)}</strong><span class="t-micro ink-3">${activeIsDifferent ? `ACTIVE DESIGN · ${esc(activeName)}` : "READY TO ENTER THE PARLOR"}</span></div>`;
  }
  toggleSetupOverrideButtons(!activeIsDifferent);
  $("#su-chooser")?.classList.remove("is-hidden");
}

function toggleSetupOverrideButtons(hidden) {
  $("#su-active-actions")?.classList.toggle("is-hidden", hidden);
  $("#su-reset-btn")?.classList.toggle("is-hidden", hidden);
  $("#su-make-active-btn")?.classList.toggle("is-hidden", hidden);
}

function paintSetupTabs() {
  document.querySelectorAll(".su-tab").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.suTab === state.setupTab);
    btn.setAttribute("aria-selected", String(btn.dataset.suTab === state.setupTab));
  });
  $("#su-custom-count").textContent = `${state.profiles.length}/${MAX_PROFILES}`;
  $("#su-grid")?.setAttribute("aria-labelledby", `su-tab-${state.setupTab}`);
}

function paintSetupGrid(choice) {
  if (state.setupTab === "custom") {
    $("#su-grid").innerHTML = customDesignsHTML(choice);
    return;
  }
  $("#su-grid").innerHTML = presetDesignsHTML(choice);
}

function customDesignsHTML(choice) {
  if (!state.profiles.length) {
    return `<p class="su-empty-custom">No custom designs yet. Create one from the home screen, then pick it here.</p>`;
  }
  return state.profiles
    .map((p, i) => customDesignCardHTML(p, choice === p.id, i))
    .join("");
}

function customStatusText(active, id) {
  if (active) return tableOrActiveDesign();
  if (id === state.appearance) return "ACTIVE DESIGN";
  return "AVAILABLE";
}

function presetStatusText(active, taken, index) {
  if (active) return tableOrActiveDesign();
  if (taken) return "TAKEN";
  if (state.appearance === index) return "ACTIVE DESIGN";
  return "AVAILABLE";
}

function tableOrActiveDesign() {
  if (tableAppearanceIsDifferent()) return "THIS TABLE";
  return "ACTIVE DESIGN";
}

function customDesignCardHTML(p, active, i) {
  const status = customStatusText(active, p.id);
  return `<button type="button" class="su-opt su-opt-profile${active ? " is-active" : ""}" data-app="${p.id}">
              <div class="su-av">${avatarHTML(p, 5, i)}</div>
              <div>
              <div class="t-label f13" style="color:${p.color}">${esc(profileDesignName(p))}</div>
                <div class="t-micro ink-3 su-state">${status}</div>
              </div>
            </button>`;
}

function presetDesignsHTML(choice) {
  const takenColors = setupTakenColors();
  return APPEARANCES.map((a, i) => presetDesignCardHTML(a, i, choice, takenColors)).join("");
}

function presetDesignCardHTML(a, i, choice, takenColors) {
  const active = choice === i;
  const taken = !active && takenColors.has(String(a.color).toLowerCase());
  const status = presetStatusText(active, taken, i);
  return `<button type="button" class="su-opt${active ? " is-active" : ""}${taken ? " is-taken" : ""}" data-app="${i}"${taken ? " disabled aria-disabled=\"true\" title=\"This colour is taken at the table\"" : ""}>
      <div class="su-av">${avatarHTML(a, 5, i)}</div>
      <div>
        <div class="t-label f13" style="color:${taken ? "var(--text-muted)" : a.textColor}">${a.label}</div>
        <div class="t-micro ink-3 su-state">${status}</div>
      </div>
    </button>`;
}

function tog(id, value) {
  const label = id.replace(/([A-Z])/g, " $1").replace(/^./, (c) => c.toUpperCase());
  return `<button class="tog${value ? " is-on" : ""}" data-setting="${id}" aria-label="${label}" aria-pressed="${value}" title="${label}"></button>`;
}

function stepper(id, value, min, max) {
  return `<div class="stepper">
    <button class="stepper-btn" data-step="${id}" data-dir="-1" ${value <= min ? "disabled" : ""}>−</button>
    <div class="stepper-val">${value}</div>
    <button class="stepper-btn" data-step="${id}" data-dir="1" ${value >= max ? "disabled" : ""}>+</button>
  </div>`;
}

function sel(id, value, options) {
  return `<select class="setting-select" data-setting="${id}">
    ${options.map(([v, l]) => `<option value="${v}" ${String(v) === String(value) ? "selected" : ""}>${l}</option>`).join("")}
  </select>`;
}

function settingRow(label, desc, control) {
  return `<div class="setting-row">
    <div class="setting-label">
      <span class="t-label f12 g100">${label}</span>
      <span class="setting-desc">${desc}</span>
    </div>
    ${control}
  </div>`;
}

function settingRowNum(label, desc, control) {
  return `<div class="setting-row-num">
    <div class="setting-label">
      <span class="t-label f12 g100">${label}</span>
      <span class="setting-desc">${desc}</span>
    </div>
    ${control}
  </div>`;
}

function lobbySection(title, rows) {
  return `<div class="lobby-section">
    <div class="lobby-section-head">
      <span class="t-label">${title}</span>
    </div>
    ${rows.join("")}
  </div>`;
}

function lobbyPlayerRowHTML(p, seed) {
  const isYou = p.id === "p1" || p.id === "preview";
  // deterministic per-player "ready" flag instead of Math.random(), so the
  // dot doesn't flicker on every unrelated re-render (typing, toggling, etc.)
  const ready = isYou || !!p.online;
  return `<div class="lobby-player-row${isYou ? " lobby-player-you" : ""}">
    <div class="lobby-av">${avatarHTML(p, 3, seed)}</div>
    <div class="lobby-player-info">
      <div class="t-label lobby-player-name" style="color:${p.textColor}">${esc(p.name)}</div>
      <div class="lobby-player-sub">${isYou ? "you" : p.bot ? `cpu · ${(p.personality || "survivor").toUpperCase()}` : "player"} · $${p.cash.toLocaleString()}</div>
    </div>
    <span class="lobby-ready-dot" style="background:${ready ? "#35a653" : "#3a382a"};box-shadow:${ready ? "0 0 5px rgb(53 166 83/60%)" : "none"}"></span>
  </div>`;
}

function renderLobbyRail() {
  // the settings rail owns the right column for both "setup" (choosing
  // appearance) and "lobby" (configuring rules) — the in-game Holdings
  // rail should only ever appear once a round is actually live.
  const preGame = state.phase === "setup" || state.phase === "lobby";
  const locked = state.phase === "setup";
  $("#right-rail-game").classList.toggle("is-hidden", preGame);
  $("#right-rail-lobby").classList.toggle("is-hidden", !preGame);
  if (!preGame) return;

  const s = state.settings;
  const seated = locked ? [buildPreviewSelf()] : state.players.slice(0, s.maxPlayers);
  const existingBots = seated.filter((p) => p.bot).length;
  const botPreviews = buildBotPreviewPlayers(Math.max(0, s.bots - existingBots));
  const previewPlayers = [...seated, ...botPreviews].slice(0, s.maxPlayers);

  $("#lobby-settings-body").innerHTML = [
    locked
      ? `<div class="settings-rule lobby-lock-note">
          <strong style="color:var(--gold-300)">FINISH SETUP TO CONTINUE</strong><br>
          Your active design is ready. Press "Enter Parlor" on the left to seat the table, or change it there for this table only.
        </div>`
      : "",
    lobbySection("Players At Table", previewPlayers.map((p, i) => lobbyPlayerRowHTML(p, i))),
    lobbySection("Table Rules", [
      settingRowNum("Max Players", "Seats at the table.", stepper("maxPlayers", s.maxPlayers, 2, 4)),
      settingRowNum("Bots", "Reserve CPU seats for Solo Dev Mode.", stepper("bots", s.bots, 0, Math.max(0, s.maxPlayers - 1))),
      settingRow("Bot Personality", "Choose the table instinct used by every CPU seat.", sel("botPersonality", s.botPersonality, [["survivor","SURVIVOR"],["builder","BUILDER"],["shark","SHARK"],["speculator","SPECULATOR"],["diplomat","DIPLOMAT"],["chaos","CHAOS"]])),
      settingRowNum("Starting Cash", "Bank hands this to each player at start.", sel("startingCash", s.startingCash, [["500","$500"],["1000","$1,000"],["1500","$1,500"],["2000","$2,000"],["2500","$2,500"],["3000","$3,000"]])),
      settingRow("Vacation Pool", "Taxes fill free parking. First to land claims it.", tog("vacationPool", s.vacationPool)),
      settingRow("Double GO", "Landing exactly on GO pays $400 instead of $200.", tog("doubleGo", s.doubleGo)),
    ]),
    lobbySection("Economy", [
      settingRow("Trading", "Players may propose trades.", tog("trading", s.trading)),
      settingRow("Auction", "Unowned deeds go to auction if buyer passes.", tog("auction", s.auction)),
      settingRow("No Rent In Jail", "Owner in jail can't collect rent that turn.", tog("noRentInJail", s.noRentInJail)),
      settingRow("Bankruptcy", "How to handle a bust player.", sel("bankruptMode", s.bankruptMode, [["elim","ELIMINATE"],["debt","DEBT DEAL"]])),
      settingRow("Bank Loans", "Emergency credit with collateral and a hard maturity.", tog("bankLoans", s.bankLoans)),
      settingRow("Loan Severity", "Premium applied to emergency bank credit.", sel("bankLoanSeverity", s.bankLoanSeverity, [["fair","FAIR"],["predatory","PREDATORY"],["extreme","EXTREME"]])),
      settingRow("Casino Access", "Virtual-money European roulette. No cash-out or loan-funded bets.", tog("casino", s.casino)),
      settingRow("Market Access", "Fictional indexes with visible prices and a small trading fee.", tog("market", s.market)),
    ]),
    lobbySection("Global Events", [
      settingRow("Global Events", "Rare, escalating headlines. Timing and severity scale with the round.", tog("globalEvents", Boolean(s.globalEvents))),
    ]),
    lobbySection("Building", [
      settingRowNum("House Limit", "Total houses in the bank.", sel("houseLimit", s.houseLimit, [["10","10 HOUSES"],["20","20 HOUSES"],["32","32 HOUSES"]])),
      settingRowNum("Hotel Limit", "Total hotels in the bank.", sel("hotelLimit", s.hotelLimit, [["6","6 HOTELS"],["12","12 HOTELS"]])),
    ]),
    lobbySection("Turn Timer", [
      settingRow("Timer Per Turn", "Seconds allowed per move (0 = off).", sel("turnTimer", s.turnTimer, [["0","OFF"],["30","30 SEC"],["60","60 SEC"],["120","2 MIN"]])),
    ]),
    `<div class="settings-rule">
      <strong style="color:var(--gold-300)">Active rules snapshot</strong><br>
      ${s.maxPlayers} players · $${Number(s.startingCash).toLocaleString()} start ·
      ${s.vacationPool ? "pool on" : "no pool"} ·
      ${s.trading ? "trading on" : "no trades"} ·
      ${s.auction ? "auction on" : "no auction"} ·
      ${s.bankLoans ? `${String(s.bankLoanSeverity).toLowerCase()} bank loans` : "bank loans off"} ·
      ${s.globalEvents ? "global events on" : "global events off"} ·
     ${s.casino ? "casino on" : "casino off"} ·
     ${s.market ? "market on" : "market off"} ·
      ${s.bots ? `bot instinct ${String(s.botPersonality || "survivor").toLowerCase()}` : "no bots"} ·
      ${s.turnTimer ? s.turnTimer + "s timer" : "no timer"} ·
      ${s.bankruptMode === "elim" ? "eliminate busted" : "debt deals"}
    </div>`,
  ].join("");

  const startBtn = $("#lobby-start-btn");
  startBtn.disabled = locked;
  startBtn.querySelector(".cta-text").textContent = locked ? "Finish Setup First" : "Start Round";
}

function buildPreviewSelf() {
  const a = getAppearanceMeta(activeAppearance());
  return {
    id: "preview",
    name: (state.alias.trim() || a.baseName).toUpperCase(),
    color: a.color,
    textColor: a.textColor,
    cash: Number(state.settings.startingCash),
    bot: false,
    avatarGrid: a.avatarGrid || undefined,
  };
}

function buildBotPreviewPlayers(count) {
  const localBots = buildPlayers(activeAppearance(), state.alias).slice(1, 4);
  return localBots.slice(0, Math.max(0, count)).map((bot, index) => ({
    ...bot,
    id: `bot-preview-${index + 1}`,
    name: `BOT ${index + 1}`,
   online: true,
   bot: true,
    personality: state.settings.botPersonality || "survivor",
 }));
}

function syncServerAppearance() {
  const meta = getAppearanceMeta(activeAppearance());
  host.emitServer("set-player-appearance", {
    nickname: state.alias.trim() || meta.baseName,
    color: meta.color,
    avatarGrid: meta.avatarGrid || null,
  }, (response) => {
    if (response?.success === false) {
      // Audit #24: the rejection also has to reach players stuck on the home
      // screen, where the chat transcript is invisible.
      parlorNotice("APPEARANCE", response.error || "Appearance could not be updated.");
      host.say(response.error || "Appearance could not be updated.");
      host.renderChat();
    }
  });
}

function entryRoomVisibility(requestedCode) {
  if (state.pendingRoomMeta?.visibility) return state.pendingRoomMeta.visibility;
  return requestedCode ? "private" : "public";
}

function resetTableForEntry(requestedCode) {
  state.suppressRoomUpdates = false;
  state.roomCode = requestedCode;
  state.roomVisibility = entryRoomVisibility(requestedCode);
  state.phase = "setup";
  state.tableAppearanceOverride = null;
  state.setupTab = typeof state.appearance === "string" ? "custom" : "preset";
  // always start the setup/lobby screens from a clean board — otherwise a
  // finished game's deed ownership, houses and token positions would still
  // be visible behind the setup overlay after going home and rejoining.
  state.players = buildPlayers(activeAppearance(), state.alias);
  state.owners = {};
  state.houses = {};
  state.pool = 0;
  state.turnIndex = 0;
  state.dice = [3, 5];
  state.rolling = false;
  state.busy = false;
  state.turnStage = "roll";
  state.highlight = null;
  state.selectedTile = null;
  state.tradeWith = null;
  state.profileDraft = null;
  state.pendingBuyTile = null;
  state.auction = null;
  state.mortgaged = {};
  state.offers = [];
  state.deedDetail = null;
  stopAuctionTimer();
  host.clearSave();
  closeAllSurfaces();
  state.log = ["ACTIVE DESIGN READY — ENTER THE PARLOR."];
  host.showView("game");
  host.renderAll();
  focusSurface("#setup-wrap", "#su-start");
  requestAnimationFrame(() => placePieces());
}

function parlorEntryPayload(event, requestedCode, meta) {
  return {
    roomCode: requestedCode || undefined,
    nickname: state.alias.trim() || meta.baseName,
    color: meta.color,
    avatarGrid: meta.avatarGrid || null,
    ...parlorPendingRoomMeta(event),
  };
}

function parlorPendingRoomMeta(event) {
  if (event !== "create-room") return {};
  return state.pendingRoomMeta || {};
}

function rejectParlorEntry(response) {
  // Surface the rejection on the visible toast stack before bouncing
  // home — say() alone lands in the hidden chat panel (A1/A3).
  parlorNotice("TABLE NOTICE", response.error || "Room could not be entered.");
  host.say(response.error || "Room could not be entered.");
  state.phase = "home";
  host.showView("home");
  host.renderAll();
}

function applyParlorEntryAck(response) {
  if (Object.prototype.hasOwnProperty.call(response || {}, "roomCode")) state.roomCode = response.roomCode || "";
  if (response?.visibility) state.roomVisibility = response.visibility === "public" ? "public" : "private";
  state.phase = "setup";
  host.renderAll();
  renderTopNav();
  syncServerAppearance();
  applyPendingRoomSettings();
  state.pendingRoomMeta = null;
}

function applyPendingRoomSettings() {
  if (!state.pendingRoomSettings) return;
  Object.entries(state.pendingRoomSettings).forEach(([key, value]) => host.updateServerSetting(key, value));
  state.pendingRoomSettings = null;
}

function onParlorEntryResponse(response, event) {
  if (response?.success === false) {
    rejectParlorEntry(response);
    return;
  }
  applyParlorEntryAck(response);
}

export function enterParlor(code) {
  if (!requireGuestAlias()) return;
  const requestedCode = String(code || "").trim().toUpperCase();
  resetTableForEntry(requestedCode);
  const meta = getAppearanceMeta(activeAppearance());
  const event = requestedCode ? "join-room" : "create-room";
  host.emitServer(event, parlorEntryPayload(event, requestedCode, meta), (response) => onParlorEntryResponse(response, event));
}

function enterLobby() {
  // called from the setup overlay "Enter Parlor" button
  if (!requireGuestAlias()) return;
  syncServerAppearance();
    state.phase = "lobby";
    host.renderAll();
    requestAnimationFrame(() => placePieces());
    return;
}

export function goHome() {
  // Release the seat on the server so the room can GC and peers stop
  // counting a home-screen player as online (A4-F3: ghost seats).
  if (state.phase !== "home") host.emitServer("leave-room", {}, () => {});
  stopAuctionTimer();
  state.busy = false;
  state.rolling = false;
  state.turnStage = "roll";
  state.selectedTile = null;
  state.highlight = null;
  state.tradeWith = null;
  state.profileDraft = null;
  state.pendingBuyTile = null;
  state.auction = null;
  state.offers = [];
  state.deedDetail = null;
  state.jail = {};
  state.card = null;
  state.gameOver = null;
  // Audit #16: home must not keep the previous room's transcript or activity
  // log. Rejoining a room re-seeds both from the server's next snapshot, so
  // emptying here never leaves stale content behind.
  state.messages = [];
  state.log = [];
  stopTurnCountdown();
  state.phase = "home";
  state.roomVisibility = "private";
  state.suppressRoomUpdates = true;
  closeAllSurfaces();
  $("#log-drawer").classList.remove("is-open");
  $("#view-game").classList.remove("is-focus");
  host.closeRoomsModal();
  // reset right rail visibility to game mode
  $("#right-rail-game").classList.remove("is-hidden");
  $("#right-rail-lobby").classList.add("is-hidden");
  host.showView("home");
}

// Audit 7.5: one door back to the homescreen. goHome() releases the room
// seat; a raw showView("home") from a page/rail handler used to leave the
// seat (and the room's stale transcript) behind when the user was mid-room.
export function leaveRoomForHome() {
  if (inRoomSession()) goHome();
  else host.showView("home");
}

function inRoomSession() {
  return ["setup", "lobby", "playing"].includes(state.phase);
}

function onLobbySettingsClick(e) {
  const togBtn = e.target.closest("[data-setting]");
  if (togBtn?.classList.contains("tog")) {
    onToggleSetting(togBtn);
    return;
  }
  const stepBtn = e.target.closest("[data-step]");
  if (isStepperEnabled(stepBtn)) onStepperSetting(stepBtn);
}

function isStepperEnabled(stepBtn) {
  if (!stepBtn) return false;
  return !stepBtn.disabled;
}

function onToggleSetting(togBtn) {
  const key = togBtn.dataset.setting;
  state.settings[key] = !state.settings[key];
  host.updateServerSetting(key, state.settings[key]);
  renderLobbyRail();
}

function stepperLimits(key) {
  if (key === "maxPlayers") return [2, 4];
  if (key === "bots") return [0, Math.max(0, Number(state.settings.maxPlayers) - 1)];
  return [0, 999];
}

function onStepperSetting(stepBtn) {
  const key = stepBtn.dataset.step;
  const dir = Number(stepBtn.dataset.dir);
  const [mn, mx] = stepperLimits(key);
  state.settings[key] = clamp((Number(state.settings[key]) || 0) + dir, mn, mx);
  if (key === "maxPlayers") clampBotsToSeats();
  host.updateServerSetting(key, state.settings[key]);
  renderLobbyRail();
}

function clampBotsToSeats() {
  state.settings.bots = clamp(Number(state.settings.bots) || 0, 0, Math.max(0, state.settings.maxPlayers - 1));
}

const NUMERIC_SETTING_KEYS = ["startingCash", "houseLimit", "hotelLimit", "turnTimer"];

function applyNumericSettingField(key, value) {
  if (value.trim() === "") return false;
  const parsed = Number(value);
  if (!Number.isFinite(parsed)) return false;
  if (parsed < 0) return false;
  state.settings[key] = Math.floor(parsed);
  return true;
}

function isSettingField(el) {
  if (!el) return false;
  if (el.tagName === "SELECT") return true;
  return el.matches("input[data-setting]");
}

const applySettingField = (e) => {
  const sel = e.target.closest("[data-setting]");
  if (!isSettingField(sel)) return;
  const key = sel.dataset.setting;
  if (NUMERIC_SETTING_KEYS.includes(key)) {
    if (!applyNumericSettingField(key, sel.value)) return;
  } else {
    state.settings[key] = sel.matches("input[type=checkbox]") ? sel.checked : sel.value;
  }
  host.updateServerSetting(key, state.settings[key]);
  renderLobbyRail();
};

export function bindLobbyUi() {
  $("#su-tabs")?.addEventListener("click", (e) => {
    const tabBtn = e.target.closest("[data-su-tab]");
    if (!tabBtn) return;
    state.setupTab = tabBtn.dataset.suTab;
    renderSetup();
  });
  $("#su-reset-btn")?.addEventListener("click", () => {
    clearTableAppearanceOverride();
    focusSurface("#setup-wrap", "#su-start");
  });
  $("#su-make-active-btn")?.addEventListener("click", () => {
    const choice = activeAppearance();
    state.appearance = choice;
    saveActiveDesignId(choice);
    state.tableAppearanceOverride = null;
    applyProfileToHomeUI();
    renderAccountPanel();
    renderProfileLibrary();
    renderSetup();
    renderLobbyRail();
    syncServerAppearance();
    focusSurface("#setup-wrap", "#su-start");
  });
  $("#su-grid").addEventListener("click", (e) => {
    const btn = e.target.closest("[data-app]");
    if (!btn) return;
    if (btn.disabled) return;
    const raw = btn.dataset.app;
    // preset appearance = "0".."3"; custom profile ids look like "pf_xxxx"
    const choice = /^\d+$/.test(raw) ? Number(raw) : raw;
    setTableAppearanceOverride(choice);
  });
  $("#su-start").addEventListener("click", enterLobby);

  // quick table: starts a default-rules round immediately
  $("#quick-table-btn")?.addEventListener("click", () => {
    if (!requireGuestAlias()) return;
    state.quickJoin = true;
    state.settings.vacationPool = true;
    state.settings.trading = true;
    state.settings.auction = false;
    state.pendingRoomSettings = { vacationPool: true, trading: true, auction: false };
      enterParlor();
      return;
  });

  // lobby settings interactions
  $("#lobby-settings-body").addEventListener("click", onLobbySettingsClick);
  $("#lobby-settings-body").addEventListener("change", applySettingField);
}

export { renderSetup, renderLobbyRail, buildBotPreviewPlayers, setActiveAppearance };
