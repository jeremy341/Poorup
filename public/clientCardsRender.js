/* ============================================================
   CARD FACE RENDERING: the Surprise/Treasure card art used by the
   reveal modal and the full-deck gallery.
   ============================================================ */
import { esc } from "./clientDom.js";
import { tileIconHTML } from "./clientBoardRender.js";

const VARIABLE_ACTIONS = ["repairs", "payEach", "collectFromEach", "nearestRailroad", "nearestUtility"];

function cardDeckMeta(kind) {
  if (kind === "chance") return { label: "SURPRISE", color: "#d74438" };
  return { label: "TREASURE", color: "#cfa75f" };
}

function outcomeLabelFor(action) {
  if (["repairs", "payEach"].includes(action)) return "PAID TOTAL";
  if (action === "collectFromEach") return "COLLECTED TOTAL";
  if (["nearestRailroad", "nearestUtility"].includes(action)) return "SUPPORT RENT";
  if (action === "pay") return "PAID";
  if (["collect", "collectStart"].includes(action)) return "COLLECTED";
  return "RESULT";
}

function amountLabelFor(amount, variableAction) {
  if (amount > 0) return `+$${amount}`;
  if (amount < 0) return `−$${Math.abs(amount)}`;
  if (variableAction) return "VARIABLE";
  return "RESOLVED";
}

function amountClass(amount) {
  if (amount > 0) return "positive";
  if (amount < 0) return "negative";
  return "neutral";
}

function cardTitleHTML(titleId, text) {
  if (!titleId) return `<h3 class="t-section cr-name">${esc(text)}</h3>`;
  return `<h3 class="t-section cr-name" id="${titleId}">${esc(text)}</h3>`;
}

function cardButtonHTML(buttonId) {
  if (!buttonId) return "";
  return `<button class="cr-btn" id="${buttonId}" type="button"><span class="t-micro">TAP TO CONTINUE</span></button>`;
}

function outcomeHTML(amount, action) {
  const variable = VARIABLE_ACTIONS.includes(action);
  if (amount === 0 && !variable) return "";
  return `<div class="cr-outcome">
        <span class="cr-outcome-label t-micro ink-3">${outcomeLabelFor(action)}</span>
        <strong class="cr-amount ${amountClass(amount)}">${amountLabelFor(amount, variable)}</strong>
      </div>`;
}

function sequenceHTML(index, total) {
  const isSequence = Number.isInteger(index) && Number.isInteger(total);
  if (!isSequence) return "";
  return `<span class="cr-sequence t-micro ink-3">${String(index + 1).padStart(2, "0")} / ${String(total).padStart(2, "0")}</span>`;
}

export function cardFaceHTML(tile, ev, { index = null, total = null, buttonId = null } = {}) {
  const amount = Number(ev.cash) || 0;
  const meta = cardDeckMeta(tile.kind);
  const titleId = buttonId ? "card-reveal-title" : "";
  return `<article class="cr-card" data-deck="${tile.kind}" data-tone="${amountClass(amount)}" style="--cr-accent:${meta.color}">
    <div class="cr-rail"></div>
    <div class="cr-body">
      <div class="cr-top">
        <div class="cr-icon" aria-hidden="true">${tileIconHTML(tile)}</div>
        <span class="cr-kind t-micro">${meta.label}</span>
        ${sequenceHTML(index, total)}
      </div>
      ${cardTitleHTML(titleId, ev.text)}
      <div class="cr-foot">
        ${outcomeHTML(amount, ev.action)}
        ${cardButtonHTML(buttonId)}
      </div>
    </div>
  </article>`;
}
