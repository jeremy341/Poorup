/* ============================================================
   GLOBAL EVENT BANNER: headline status, effect chips, and the
   voting rail. Byte-identical output to the original monolith.
   ============================================================ */
import { $, esc } from "./clientDom.js";
import { state } from "./clientState.js";

function eventVisible(event) {
  if (state.phase !== "playing") return false;
  return Boolean(event);
}

function globalEventAccent(category) {
  if (category === "CIVIC") return "#d9a62f";
  if (category === "INFRASTRUCTURE") return "#286ea1";
  return "#d74438";
}

function globalEventKicker(event) {
  if (event.phase === "voting") return "TABLE VOTE";
  return `${event.category} · GLOBAL EVENT`;
}

function renderGlobalEventHead(event, banner) {
  banner.style.setProperty("--event-accent", globalEventAccent(event.category));
  $("#global-event-kicker").textContent = globalEventKicker(event);
  $("#global-event-title").textContent = String(event.title || "GLOBAL EVENT");
  $("#global-event-copy").textContent = String(event.summary || "The table is under a global effect.");
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
  cashMultiplier: "CASH",
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

function globalEventEffectHTML([key, value]) {
  return `<span class="global-event-effect t-micro">${esc(effectLabel(key))} · ${esc(effectShownValue(key, value))}</span>`;
}

function renderGlobalEventEffects(event) {
  const effectEl = $("#global-event-effects");
  if (!effectEl) return;
  effectEl.innerHTML = Object.entries(event.effects || {}).map(globalEventEffectHTML).join("");
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
  const disabled = voted ? "disabled" : "";
  const title = choice.description || "Cast your vote";
  return `<button class="global-event-choice" type="button" data-global-choice="${esc(choice.id)}" ${disabled} title="${esc(title)}">${esc(choice.label)}</button>`;
}

function renderGlobalEventChoices(event) {
  const choices = $("#global-event-choices");
  if (!choices) return;
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
  renderGlobalEventHead(event, banner);
  renderGlobalEventEffects(event);
  $("#global-event-rounds").textContent = globalEventRoundsText(event);
  renderGlobalEventChoices(event);
}
