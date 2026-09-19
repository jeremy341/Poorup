/* ============================================================
   GLOBAL EVENT BANNER: headline status, effect chips, and the
   voting rail. Dual-state compact/expand HUD inside center-field.
   ============================================================ */
import { $, esc } from "./clientDom.js";
import { state } from "./clientState.js";
import { spriteHTML } from "./clientSprites.js";

let isCompact = Boolean(state.globalEventCompact);
let listenerAttached = false;

function eventVisible(event) {
  if (state.phase !== "playing") return false;
  return Boolean(event);
}

function globalEventAccent(category) {
  if (category === "CIVIC") return "#d9a62f";
  if (category === "INFRASTRUCTURE") return "#286ea1";
  return "#d74438";
}

function categorySpriteName(category) {
  if (category === "CIVIC") return "civic";
  if (category === "INFRASTRUCTURE") return "infrastructure";
  return "crisis";
}

function globalEventKicker(event) {
  if (event.phase === "voting") return "TABLE VOTE";
  return `${event.category} · GLOBAL EVENT`;
}

function renderGlobalEventHead(event, banner) {
  banner.style.setProperty("--event-accent", globalEventAccent(event.category));
  const emblemEl = $("#global-event-emblem");
  if (emblemEl) emblemEl.innerHTML = spriteHTML(categorySpriteName(event.category), 2);
  $("#global-event-kicker").textContent = globalEventKicker(event);
  $("#global-event-title").textContent = String(event.title || "GLOBAL EVENT");
  $("#global-event-copy").textContent = String(event.summary || "The table is under a global effect.");
}

function renderGlobalEventTimer() {
  const timerIcon = $("#global-event-timer-icon");
  if (timerIcon && !timerIcon.hasChildNodes()) {
    timerIcon.innerHTML = spriteHTML("hourglass", 2);
  }
}

const EFFECT_LABELS = {
  rentMultiplier: "RENTS",
  constructionBlocked: "BUILDING FROZEN",
  buildingSaleMultiplier: "BUILDING SALES",
  propertyValueMultiplier: "PROPERTY VALUE",
  bankLoansBlocked: "BANK LOANS",
  mortgagesBlocked: "MORTGAGES",
  taxMultiplier: "TAXES",
  buildingCostMultiplier: "BUILDING COST",
  loanPremiumMultiplier: "LOAN PREMIUM",
  airportRentMultiplier: "AIRPORT RENT",
  airportCardsBlocked: "AIRPORT CARDS",
  premiumRentMultiplier: "PREMIUM RENT",
  leaderRentMultiplier: "LEADER RENT",
  rentCap: "RENT CAP",
  buildingLimitPerTurn: "BUILD LIMIT",
  bankActionsBlocked: "BANK ACTIONS",
  auctionBlocked: "AUCTIONS",
  utilityRentMultiplier: "UTILITY RENT",
  marketPriceMultiplier: "MARKET PRICE",
  marketVolatility: "MARKET VOLATILITY",
  casinoMaxBet: "CASINO MAX BET",
  casinoEntryFee: "CASINO FEE",
  tradingEnabled: "MARKET TRADING",
  loanSettlementMultiplier: "LOAN SETTLEMENT",
  rentControlStipend: "RENT STIPEND",
  cashMultiplier: "CASH RESERVES",
};

const FIXED_EFFECT_KEYS = ["rentCap", "buildingLimitPerTurn", "casinoMaxBet", "casinoEntryFee", "buildingMaintenance", "rentControlStipend"];
const CURRENCY_EFFECT_KEYS = ["casinoMaxBet", "casinoEntryFee", "buildingMaintenance", "rentControlStipend"];

function effectLabel(key) {
  const label = EFFECT_LABELS[key];
  if (label) return label;
  return key.replaceAll(/([A-Z])/g, " $1").toUpperCase();
}

function booleanEffectText(value) {
  if (value) return "ON";
  return "OFF";
}

function percentEffectText(value) {
  const delta = Math.round((Number(value) - 1) * 100);
  if (delta === 0) return "100%";
  const sign = delta > 0 ? "+" : "";
  return `${sign}${delta}%`;
}

function effectShownValue(key, value) {
  if (typeof value === "boolean") return booleanEffectText(value);
  if (!FIXED_EFFECT_KEYS.includes(key)) return percentEffectText(value);
  if (CURRENCY_EFFECT_KEYS.includes(key)) return "$" + Number(value).toLocaleString();
  return String(value);
}

function directionSprite(key, value) {
  if (typeof value === "boolean") return "";
  const num = Number(value);
  if (Number.isNaN(num)) return "";
  if (num > 1) return `<span class="global-event-trend mod-up" aria-hidden="true">${spriteHTML("trendUp", 1)}</span> `;
  if (num < 1) return `<span class="global-event-trend mod-down" aria-hidden="true">${spriteHTML("trendDown", 1)}</span> `;
  return "";
}

function globalEventEffectHTML([key, value]) {
  const dir = directionSprite(key, value);
  return `<span class="global-event-effect t-micro">${dir}${esc(effectLabel(key))} · ${esc(effectShownValue(key, value))}</span>`;
}

function globalEventCompactEffectHTML([key, value]) {
  const dir = directionSprite(key, value);
  return `<span class="global-event-compact-chip t-micro">${dir}${esc(effectLabel(key))} ${esc(effectShownValue(key, value))}</span>`;
}

function renderGlobalEventEffects(event) {
  const effectEl = $("#global-event-effects");
  if (!effectEl) return;
  effectEl.innerHTML = Object.entries(event.effects || {}).map(globalEventEffectHTML).join("");
}

function renderCompactRow(event) {
  const compactTitle = $("#global-event-compact-title");
  if (compactTitle) compactTitle.textContent = String(event.title || "EVENT");
  const compactEffects = $("#global-event-compact-effects");
  if (compactEffects) {
    compactEffects.innerHTML = Object.entries(event.effects || {}).slice(0, 3).map(globalEventCompactEffectHTML).join("");
  }
  const compactVote = $("#global-event-compact-vote");
  if (compactVote) {
    if (event.phase === "voting") {
      compactVote.classList.remove("is-hidden");
      compactVote.innerHTML = `<span class="global-event-vote-icon" aria-hidden="true">${spriteHTML("ballot", 2)}</span> VOTE REQUIRED`;
    } else {
      compactVote.classList.add("is-hidden");
      compactVote.innerHTML = "";
    }
  }
}

function globalEventRoundsText(event) {
  if (event.phase === "voting") return "VOTE BEFORE NEXT ROUND";
  if (event.phase === "warning") return "ACTIVATES NEXT ROUND";
  if (event.phase === "recovery") return "RECOVERY · EFFECTS TAPERING";
  return `${event.roundsRemaining || 0} ROUNDS LEFT`;
}

function voterHasVoted(event) {
  const me = state.players[0];
  const voterId = me?.serverId || me?.id;
  if (!voterId) return false;
  return Boolean(event.votes?.[voterId]);
}

function globalEventChoiceHTML(choice, voted) {
  const disabled = voted || state.globalEventVotePending ? "disabled" : "";
  const title = choice.description || "Cast your vote";
  return `<button class="global-event-choice" type="button" data-global-choice="${esc(choice.id)}" ${disabled} title="${esc(title)}">${esc(choice.label)}</button>`;
}

function choiceFocusKey(active) {
  const choice = active?.closest?.("[data-global-choice]");
  return choice?.dataset.globalChoice || "";
}

function restoreChoiceFocus(choices, key) {
  if (!key) return;
  const target = [...choices.querySelectorAll("[data-global-choice]")]
    .find(choice => choice.dataset.globalChoice === key);
  target?.focus({ preventScroll: true });
}

function renderGlobalEventChoices(event) {
  const choices = $("#global-event-choices");
  if (!choices) return;
  const focusKey = choiceFocusKey(document.activeElement);
  if (event.phase !== "voting") {
    choices.innerHTML = "";
    return;
  }
  if (!Array.isArray(event.choices)) {
    choices.innerHTML = "";
    return;
  }
  const voted = voterHasVoted(event);
  choices.innerHTML = event.choices.map((choice) => globalEventChoiceHTML(choice, voted)).join("");
  restoreChoiceFocus(choices, focusKey);
}

function updateCompactState(banner) {
  banner.classList.toggle("is-compact", isCompact);
  const toggleBtn = $("#global-event-toggle");
  const toggleLabel = $("#global-event-toggle-label");
  const toggleIcon = $("#global-event-toggle-icon");
  const bodyWrap = $("#global-event-body-wrap");
  const compactRow = $("#global-event-compact-row");

  if (toggleBtn) {
    toggleBtn.setAttribute("aria-expanded", String(!isCompact));
    toggleBtn.title = isCompact ? "Expand event details [H]" : "Hide event details [H]";
  }
  if (toggleLabel) toggleLabel.textContent = isCompact ? "SHOW" : "HIDE";
  if (toggleIcon) toggleIcon.innerHTML = spriteHTML(isCompact ? "chevronDown" : "chevronUp", 2);
  if (bodyWrap) bodyWrap.classList.toggle("is-hidden", isCompact);
  if (compactRow) compactRow.classList.toggle("is-hidden", !isCompact);
}

function toggleCompactMode() {
  isCompact = !isCompact;
  state.globalEventCompact = isCompact;
  const banner = $("#global-event-banner");
  if (banner) updateCompactState(banner);
}

function bindGlobalEventControls() {
  if (listenerAttached) return;
  const toggleBtn = $("#global-event-toggle");
  if (toggleBtn) {
    toggleBtn.addEventListener("click", (e) => {
      e.stopPropagation();
      toggleCompactMode();
    });
  }
  const compactVote = $("#global-event-compact-vote");
  if (compactVote) {
    compactVote.addEventListener("click", () => {
      if (isCompact) toggleCompactMode();
    });
  }
  window.addEventListener("keydown", (e) => {
    if (e.key === "h" || e.key === "H") {
      const tag = document.activeElement?.tagName;
      if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return;
      if (state.globalEvent && eventVisible(state.globalEvent)) {
        toggleCompactMode();
      }
    }
  });
  listenerAttached = true;
}

export function renderGlobalEvent() {
  const banner = $("#global-event-banner");
  if (!banner) return;
  const event = state.globalEvent;
  if (!eventVisible(event)) {
    banner.classList.toggle("is-hidden", true);
    return;
  }
  banner.classList.toggle("is-hidden", false);
  bindGlobalEventControls();
  renderGlobalEventHead(event, banner);
  renderGlobalEventTimer();
  renderGlobalEventEffects(event);
  renderCompactRow(event);
  $("#global-event-rounds").textContent = globalEventRoundsText(event);
  renderGlobalEventChoices(event);
  updateCompactState(banner);
}
