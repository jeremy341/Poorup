// LOBBY APPEARANCE: the setup-overlay design chooser and its identity/grid rendering.
import { $, esc } from "./clientDom.js";
import { state, activeAppearance, getAppearanceMeta, getProfileById } from "./clientState.js";
import { APPEARANCES, MAX_PROFILES, profileDesignName } from "./clientSanitize.js";
import { avatarHTML } from "./clientSprites.js";

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

// Taken-ness is identity (color plus face), mirroring faceSignature in
// server/appearanceApi.js: same color with a different face is a different
// icon, so only an exact duplicate greys a preset out.
function setupFaceSignature(avatarGrid) {
  if (!Array.isArray(avatarGrid)) return "generic";
  const inked = avatarGrid.some((row) => Array.isArray(row) && row.some((cell) => Boolean(cell)));
  if (!inked) return "generic";
  return JSON.stringify(avatarGrid, (key, value) => (typeof value === "string" ? value.toLowerCase() : value));
}

function setupIdentityKey(color, avatarGrid) {
  return `${String(color || "").toLowerCase()}|${setupFaceSignature(avatarGrid)}`;
}

function setupTakenIdentities() {
  const seated = state.players
    .filter((p) => p.clientId !== state.clientId)
    .filter((p) => p.online !== false)
    .filter((p) => !p.bankrupt);
  return new Set(seated.map((p) => setupIdentityKey(p.color, p.avatarGrid)));
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
  // The active design is the default. The chooser is opt-in, so joining a table
  // never asks the player to make the same identity decision twice.
  const selectedName = selectedDesignName(choice, meta);
  const sourceLabel = state.tableAppearanceOverride == null ? "ACTIVE DESIGN" : "THIS TABLE ONLY";
  const activeName = activeDesignName();
  const activeIsDifferent = tableAppearanceIsDifferent();
  const activeCard = $("#setup-active-card");
  if (activeCard) {
    activeCard.innerHTML = `<div class="setup-active-avatar">${avatarHTML({ color: meta.color, avatarGrid: meta.avatarGrid }, 4, 0)}</div><div class="setup-active-copy"><span class="t-micro ${activeIsDifferent ? "g400" : "green"}">${sourceLabel}</span><strong class="t-label f14 setup-active-name" style="color:${meta.textColor}">${esc(selectedName)}</strong><span class="t-micro ink-3">${activeIsDifferent ? `ACTIVE DESIGN · ${esc(activeName)}` : "READY TO ENTER THE PARLOR"}</span></div>`;
  }
  toggleSetupOverrideButtons(!activeIsDifferent);
  $("#setup-chooser")?.classList.remove("is-hidden");
}

function toggleSetupOverrideButtons(hidden) {
  $("#setup-active-actions")?.classList.toggle("is-hidden", hidden);
  $("#setup-reset-btn")?.classList.toggle("is-hidden", hidden);
  $("#setup-make-active-btn")?.classList.toggle("is-hidden", hidden);
}

function paintSetupTabs() {
  document.querySelectorAll(".setup-tab").forEach((btn) => {
    btn.classList.toggle("is-active", btn.dataset.suTab === state.setupTab);
    btn.setAttribute("aria-selected", String(btn.dataset.suTab === state.setupTab));
  });
  $("#setup-custom-count").textContent = `${state.profiles.length}/${MAX_PROFILES}`;
  $("#setup-grid")?.setAttribute("aria-labelledby", `su-tab-${state.setupTab}`);
}

function paintSetupGrid(choice) {
  if (state.setupTab === "custom") {
    $("#setup-grid").innerHTML = customDesignsHTML(choice);
    return;
  }
  $("#setup-grid").innerHTML = presetDesignsHTML(choice);
}

function customDesignsHTML(choice) {
  if (!state.profiles.length) {
    return `<p class="setup-empty-custom">No custom designs yet. Create one from the home screen, then pick it here.</p>`;
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
  return `<button type="button" class="setup-option setup-option-profile${active ? " is-active" : ""}" data-app="${esc(p.id)}">
              <div class="setup-avatar">${avatarHTML(p, 5, i)}</div>
              <div>
              <div class="t-label f13" style="color:${p.color}">${esc(profileDesignName(p))}</div>
                <div class="t-micro ink-3 setup-state">${status}</div>
              </div>
            </button>`;
}

function presetDesignsHTML(choice) {
  const taken = setupTakenIdentities();
  return APPEARANCES.map((a, i) => presetDesignCardHTML(a, i, choice, taken)).join("");
}

function presetDesignCardHTML(a, i, choice, takenIdentities) {
  const active = choice === i;
  const taken = !active && takenIdentities.has(setupIdentityKey(a.color, null));
  const status = presetStatusText(active, taken, i);
  return `<button type="button" class="setup-option${active ? " is-active" : ""}${taken ? " is-taken" : ""}" data-app="${i}"${taken ? " disabled aria-disabled=\"true\" title=\"This icon is taken at the table\"" : ""}>
      <div class="setup-avatar">${avatarHTML(a, 5, i)}</div>
      <div>
        <div class="t-label f13" style="color:${taken ? "var(--text-muted)" : a.textColor}">${a.label}</div>
        <div class="t-micro ink-3 setup-state">${status}</div>
      </div>
    </button>`;
}

export function renderSetup() {
  const wrap = $("#setup-wrap");
  wrap.classList.toggle("is-hidden", state.phase !== "setup");
  if (state.phase !== "setup") return;

  const entryButton = $("#setup-start-btn");
  if (entryButton) {
    entryButton.disabled = Boolean(state.roomEntryPending);
    const label = entryButton.querySelector(".cta-text");
    if (label) label.textContent = state.roomEntryPending ? "Connecting…" : "Enter Parlor";
  }

  // Server is authoritative for identity: if the table auto-assigned a
  // different colour than the local design, the picker must show the seat
  // colour as the active row, not the (rejected) design choice.
  const choice = setupAppearanceChoice();
  const meta = getAppearanceMeta(choice);
  paintSetupIdentity(choice, meta);
  paintSetupTabs();
  paintSetupGrid(choice);
}
