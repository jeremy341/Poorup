// TRADE: the player-to-player trade proposer modal (deeds and cash both ways) and trade negotiation.
import { $, esc, clamp } from "./clientDom.js";
import { closeButtonHTML } from "./clientCloseButton.js";
import { state } from "./clientState.js";
import { TILES, GROUP_COLOR } from "./clientBoardData.js";
import { spriteHTML, avatarHTML } from "./clientSprites.js";
import { openSurface, closeSurface } from "./clientSurfaces.js";
import { host, financingMyServerId, tradeBuildingBlockReason } from "./clientDealHost.js";
import { dropdownHTML, bindDropdowns } from "./clientParlorDropdown.js";

let tradeInitialDeedIndex = null;

export function tradeDeedRowHTML(tile, side, selected, readOnly = false) {
  const rail = tile.group ? GROUP_COLOR[tile.group] : tile.kind === "railroad" ? "#5c5033" : "#3e7d7b";
  const mortgaged = !!state.mortgaged[tile.i];
  if (readOnly) {
    const value = Number.isFinite(tile.price) ? `$${tile.price.toLocaleString()}` : "-";
    return `<li class="trade-deed offer-deed"><span class="trade-deed-rail" style="background:${rail}"></span><span class="trade-deed-name">${esc(tile.name)}${mortgaged ? '<span class="t-micro red"> · MORTGAGED</span>' : ""}</span><span class="trade-deed-price">${value}</span></li>`;
  }
  const buildingReason = tradeBuildingBlockReason(tile);
  const authority = side === "me" ? state.serverTiles.find(entry => Number(entry.index) === Number(tile.i))?.propertyActions?.tradeDeed : null;
  const authorityReason = authority?.enabled === false ? (authority.reason || "This deed cannot be traded right now.") : "";
  const blockedReason = buildingReason || authorityReason;
  return `<button type="button" class="trade-deed${selected ? " is-selected" : ""}${mortgaged ? " is-mortgaged" : ""}" data-side="${side}" data-deed="${tile.i}" ${blockedReason ? `disabled aria-label="${esc(tile.name)}. ${esc(blockedReason)}" title="${esc(blockedReason)}"` : ""}>
    <span class="trade-deed-rail" style="background:${rail}"></span>
    <span class="trade-deed-name">${esc(tile.name)}${blockedReason ? `<span class="trade-deed-block-reason">${esc(blockedReason)}</span>` : ""}</span>
    ${mortgaged ? '<span class="t-micro red trade-deed-mortgage-badge">MORTGAGED</span>' : ""}
    <span class="trade-deed-price">$${tile.price}</span>
    <span class="trade-deed-check"></span>
  </button>`;
}

export function tradeReviewSideHTML({ player, seed, heading, cash, deedIndexes }) {
  const indexes = [...new Set(Array.isArray(deedIndexes) ? deedIndexes : [])];
  const deeds = indexes.map(index => TILES[Number(index)] || { i: index, name: `Deed ${index}` });
  const rows = deeds.length
    ? `<ul class="trade-deed-list thin-scroll" tabindex="0" aria-label="${esc(heading)} deeds">${deeds.map(tile => tradeDeedRowHTML(tile, "", false, true)).join("")}</ul>`
    : '<p class="t-body trade-empty">No deeds</p>';
  return `<section class="trade-side offer-side" aria-label="${esc(heading)}"><div class="trade-side-head"><div class="trade-player-avatar">${avatarHTML(player, 4, seed)}</div><div><h3 class="t-label f13 g100">${esc(heading)}</h3><span class="t-micro ink-2">${esc(player.name)}</span></div></div><div class="offer-cash"><span class="t-label f11 ink-2">CASH</span><strong class="t-label f20 g100">$${Math.max(0, Number(cash) || 0).toLocaleString()}</strong></div><div class="offer-deeds"><span class="t-label f11 ink-2">DEEDS · ${deeds.length}</span>${rows}</div></section>`;
}

function tradeSummaryText(deedSet, cash) {
  return `<span class="num">${deedSet.size}</span> deed${deedSet.size === 1 ? "" : "s"} + <span class="num">$${cash.toLocaleString()}</span>`;
}

function updateTradeSummary() {
  const sendEl = $("#trade-send-summary");
  const receiveEl = $("#trade-receive-summary");
  if (sendEl) sendEl.innerHTML = tradeSummaryText(state.tradeMyDeeds, state.tradeMyCash);
  if (receiveEl) receiveEl.innerHTML = tradeSummaryText(state.tradeTheirDeeds, state.tradeTheirCash);
}

function tradeSideHTML({ player, seed, side, deeds, selectedSet, cashValue, cashMax, inputId, cashLabel, emptyText }) {
  const rows = deeds.length
    ? deeds.map((t) => tradeDeedRowHTML(t, side, selectedSet.has(t.i))).join("")
    : `<p class="t-body trade-empty">${emptyText}</p>`;
  return `
        <div class="trade-side">
          <div class="trade-side-head">
            <div class="trade-player-avatar">${avatarHTML(player, 4, seed)}</div>
            <div>
              <span class="t-label f13" style="color:${player.textColor}">${esc(player.name)}</span>
              <span class="t-micro ink-3 trade-cash-label">CASH ON HAND <span class="num">$${player.cash.toLocaleString()}</span>
            </div>
          </div>
          <div class="trade-deed-list thin-scroll" role="group" tabindex="0" aria-label="${side === "me" ? "Deeds to offer" : "Deeds to request"}">
            ${rows}
          </div>
          <label class="trade-cash-field">
            <span class="t-label f11 g-muted" id="${inputId}-label">${cashLabel} (max <span class="num">$${Number(cashMax) || 0}</span>)</span>
            <input type="number" min="0" max="${cashMax}" step="10" class="field" id="${inputId}" value="${cashValue}" aria-labelledby="${inputId}-label" />
          </label>
          <input type="range" class="trade-range" id="${inputId}-range" min="0" max="${Number(cashMax) || 0}" step="10" value="${cashValue}" aria-label="${cashLabel} slider" />
        </div>`;
}

function tradeModalHTML({ me, other, otherSeed, myDeeds, theirDeeds }) {
  const negotiating = Boolean(state.tradeCounterId || state.tradeAdjustId);
  const adjustment = Boolean(state.tradeAdjustId);
  const recipientOptions = state.players.filter((p) => p.id !== "p1").map((p) => ({ value: p.id, label: p.name }));
  const mySide = tradeSideHTML({ player: me, seed: 0, side: "me", deeds: myDeeds, selectedSet: state.tradeMyDeeds, cashValue: state.tradeMyCash, cashMax: me.cash, inputId: "trade-my-cash", cashLabel: "CASH TO OFFER", emptyText: "NO DEEDS TO OFFER" });
  const theirSide = tradeSideHTML({ player: other, seed: otherSeed, side: "them", deeds: theirDeeds, selectedSet: state.tradeTheirDeeds, cashValue: state.tradeTheirCash, cashMax: other.cash, inputId: "trade-their-cash", cashLabel: "CASH TO REQUEST", emptyText: "NO DEEDS TO REQUEST" });
  return `
    <div class="trade-body">
      <div class="trade-head">
        <div class="section-title" style="margin-bottom:0">
          ${spriteHTML("diamond", 3)}
          <h2 class="t-section g300" id="trade-card-title">${adjustment ? "Adjust Trade" : negotiating ? "Negotiate Trade" : "Propose Trade"}</h2>
        </div>
        ${closeButtonHTML({ id: "trade-close", label: "Close trade dialog" })}
      </div>
      ${negotiating ? `<div class="trade-fixed-recipient"><span class="t-micro g400">${adjustment ? "ADJUSTING FOR" : "NEGOTIATING WITH"}</span><span class="t-label f12 g100">${esc(other.name)}</span></div>` : recipientOptions.length > 1 ? dropdownHTML({ id: "trade-recipient", label: "Send trade to", value: state.tradeWith, className: "trade-recipient-dropdown", options: recipientOptions }) : ""}

      <div class="trade-cols">
        ${mySide}

        ${theirSide}
      </div>

      <div class="trade-summary">
        <span class="t-micro ink-3">YOU SEND</span>
        <span class="t-label f12 g300" id="trade-send-summary">${tradeSummaryText(state.tradeMyDeeds, state.tradeMyCash)}</span>
        <span class="trade-arrow">⇄</span>
        <span class="t-micro ink-3">YOU RECEIVE</span>
        <span class="t-label f12 green" id="trade-receive-summary">${tradeSummaryText(state.tradeTheirDeeds, state.tradeTheirCash)}</span>
      </div>

      <div class="trade-actions">
        <button class="btn-dark trade-cancel" id="trade-cancel"><span class="t-label f12">Cancel</span></button>
        <button class="cta-red trade-send" id="trade-send"><span class="cta-text cta-text-sm">${adjustment ? "Send Adjustment" : negotiating ? "Send Counter" : "Send Trade"}</span></button>
      </div>
    </div>`;
}

function resetTradeSelection(playerId, initialDeedIndex = null) {
  state.tradeWith = playerId;
  state.tradeCounterId = null;
  state.tradeAdjustId = null;
  state.tradeMyDeeds = new Set();
  state.tradeTheirDeeds = new Set();
  state.tradeMyCash = 0;
  state.tradeTheirCash = 0;
  if (initialDeedIndex != null && Number.isInteger(Number(initialDeedIndex)) && state.owners[initialDeedIndex] === "p1") {
    state.tradeMyDeeds.add(Number(initialDeedIndex));
  }
}

function tradeRecipientValid(value) {
  return state.players.some((p) => p.id === value && p.id !== "p1");
}

function onTradeRecipientSelect(id, value) {
  if (id !== "trade-recipient") return;
  if (!tradeRecipientValid(value)) return;
  resetTradeSelection(value, tradeInitialDeedIndex);
  renderTradeModal();
  $("#trade-recipient-trigger")?.focus({ preventScroll: true });
}

function tradeCashInput(player, key) {
  return (e) => {
    let v = Math.round(Number(e.target.value) || 0);
    v = clamp(v, 0, player.cash);
    if (String(v) !== e.target.value) e.target.value = String(v);
    const slider = document.getElementById(`${e.target.id}-range`);
    if (slider) {
      slider.value = String(v);
      paintSlider(slider);
    }
    state[key] = v;
    updateTradeSummary();
  };
}

function toggleTradeDeed(event) {
  const btn = event.currentTarget;
  const set = btn.dataset.side === "me" ? state.tradeMyDeeds : state.tradeTheirDeeds;
  const idx = Number(btn.dataset.deed);
  if (set.has(idx)) set.delete(idx);
  else set.add(idx);
  btn.classList.toggle("is-selected");
  updateTradeSummary();
}

/* The slider drives the number field, which owns clamping and the summary. */
function paintSlider(slider) {
  const max = Number(slider.max) || 0;
  const share = max > 0 ? Math.min(100, Math.max(0, (Number(slider.value) / max) * 100)) : 0;
  slider.style.setProperty("--fill", `${share}%`);
}

function bindCashSlider(inputId) {
  const number = document.getElementById(inputId);
  const slider = document.getElementById(`${inputId}-range`);
  if (!number || !slider) return;
  paintSlider(slider);
  slider.addEventListener("input", () => {
    number.value = slider.value;
    paintSlider(slider);
    number.dispatchEvent(new Event("input", { bubbles: true }));
  });
}
function wireTradeModal(me, other) {
  $("#trade-close").addEventListener("click", closeTradeModal);
  $("#trade-cancel").addEventListener("click", closeTradeModal);
  $("#trade-send").addEventListener("click", sendTrade);
  bindDropdowns($("#trade-card"), onTradeRecipientSelect);
  $("#trade-my-cash").addEventListener("input", tradeCashInput(me, "tradeMyCash"));
  $("#trade-their-cash").addEventListener("input", tradeCashInput(other, "tradeTheirCash"));
  for (const id of ["trade-my-cash", "trade-their-cash"]) bindCashSlider(id);
  $("#trade-card").querySelectorAll(".trade-deed").forEach((btn) => btn.addEventListener("click", toggleTradeDeed));
}

export function renderTradeModal() {
  if (!state.tradeWith) return;
  const me = state.players[0];
  const other = state.players.find((p) => p.id === state.tradeWith);
  if (!other) { closeTradeModal(); return; }
  const myDeeds = TILES.filter((t) => state.owners[t.i] === "p1");
  const theirDeeds = TILES.filter((t) => state.owners[t.i] === other.id);
  const otherSeed = state.players.indexOf(other);
  $("#trade-card").innerHTML = tradeModalHTML({ me, other, otherSeed, myDeeds, theirDeeds });
  wireTradeModal(me, other);
}

export function openTradeModal(playerId, trigger = null) {
  if (state.phase !== "playing") return;
  if (!state.settings.trading) {
    host.announceActionStatus("Trading is disabled for this round.", host.captureActionStatusNode(trigger || document.activeElement));
    return;
  }
  const other = state.players.find((p) => p.id === playerId);
  if (!other) return;
  tradeInitialDeedIndex = null;
  resetTradeSelection(playerId);
  renderTradeModal();
  openSurface("#trade-modal", "#trade-close", { trigger });
}

export function beginTradeFromDeed(tileIndex) {
  const recipient = state.players.find(player => player.id !== "p1");
  const index = Number(tileIndex);
  if (!recipient || !Number.isInteger(index) || state.owners[index] !== "p1") return false;
  const tile = TILES[index];
  const authority = state.serverTiles.find(entry => Number(entry.index) === index)?.propertyActions?.tradeDeed;
  if (!tile || tradeBuildingBlockReason(tile) || authority?.enabled === false) return false;
  tradeInitialDeedIndex = index;
  resetTradeSelection(recipient.id, index);
  return recipient;
}

export function openTradeModalForDeed(tileIndex, trigger = null) {
  if (state.phase !== "playing") return;
  if (!state.settings.trading) {
    host.announceActionStatus("Trading is disabled for this round.", host.captureActionStatusNode(trigger || document.activeElement));
    return;
  }
  const recipient = beginTradeFromDeed(tileIndex);
  if (!recipient) return;
  renderTradeModal();
  openSurface("#trade-modal", "#trade-close", { trigger });
}

export function closeTradeModal() {
  state.tradeWith = null;
  state.tradeCounterId = null;
  state.tradeAdjustId = null;
  tradeInitialDeedIndex = null;
  closeSurface("#trade-modal");
}

function blockTrade(message, control = document.activeElement) {
  host.announceActionStatus(message, host.captureActionStatusNode(control));
}

function tradeIsBlank(myCash, theirCash) {
  if (state.tradeMyDeeds.size > 0) return false;
  if (state.tradeTheirDeeds.size > 0) return false;
  if (myCash > 0) return false;
  return theirCash === 0;
}

function tradeMyDeedBlocked(i) {
  const tile = TILES[i];
  const buildingReason = tile && tradeBuildingBlockReason(tile);
  if (buildingReason) {
    blockTrade(buildingReason);
    return true;
  }
  const authority = state.serverTiles.find(entry => Number(entry.index) === Number(i))?.propertyActions?.tradeDeed;
  if (authority?.enabled === false) {
    blockTrade(authority.reason || "This deed cannot be traded right now.");
    return true;
  }
  return false;
}

function tradeTheirDeedBlocked(i) {
  const tile = TILES[i];
  const reason = tile && tradeBuildingBlockReason(tile);
  if (!reason) return false;
  blockTrade(reason);
  return true;
}

function myDeedsValidationBlocked() {
  for (const i of state.tradeMyDeeds) {
    if (tradeMyDeedBlocked(i)) return true;
  }
  return false;
}

function theirDeedsValidationBlocked() {
  for (const i of state.tradeTheirDeeds) {
    if (tradeTheirDeedBlocked(i)) return true;
  }
  return false;
}

function tradeValidationBlocked() {
  if (myDeedsValidationBlocked()) return true;
  return theirDeedsValidationBlocked();
}

function tradeRejected(response) {
  return response?.success === false;
}

function tradeIndexes(trade, key) {
  return trade[key] || [];
}

function tradeCashOf(trade, key) {
  return Number(trade[key] || 0);
}

function tradeCounterpart(trade, sender) {
  const serverId = sender ? trade.toPlayerId : trade.fromPlayerId;
  return state.players.find(player => player.serverId === serverId);
}

function applyNegotiatedTrade(trade, sender, other) {
  state.tradeWith = other.id;
  state.tradeCounterId = sender ? null : trade.id;
  state.tradeAdjustId = sender ? trade.id : null;
  state.tradeMyDeeds = new Set(sender ? tradeIndexes(trade, "givePropertyIndexes") : tradeIndexes(trade, "requestPropertyIndexes"));
  state.tradeTheirDeeds = new Set(sender ? tradeIndexes(trade, "requestPropertyIndexes") : tradeIndexes(trade, "givePropertyIndexes"));
  state.tradeMyCash = sender ? tradeCashOf(trade, "giveCash") : tradeCashOf(trade, "requestCash");
  state.tradeTheirCash = sender ? tradeCashOf(trade, "requestCash") : tradeCashOf(trade, "giveCash");
}

function tradeEventName() {
  if (state.tradeCounterId) return "counter-trade";
  if (state.tradeAdjustId) return "adjust-trade";
  return "propose-trade";
}

function emitTradeOffer(other, myCash, theirCash, statusNode) {
  const tradeId = state.tradeCounterId || state.tradeAdjustId;
  const giveDeeds = [...state.tradeMyDeeds];
  const wantDeeds = [...state.tradeTheirDeeds];
  host.emitServer(tradeEventName(), {
    ...(tradeId ? { tradeId } : {}),
    requestId: host.createRequestId("trade"),
    toPlayerId: other.serverId || other.id,
    givePropertyIndexes: giveDeeds,
    requestPropertyIndexes: wantDeeds,
    giveCash: myCash,
    requestCash: theirCash,
  }, (response) => {
    if (tradeRejected(response)) {
      host.announceActionStatus(response.error || "Trade could not be sent.", statusNode);
      return;
    }
    state.tradeCounterId = null;
    closeTradeModal();
  });
}

export function openTradeNegotiation(trade, trigger = null) {
  if (!trade) return;
  state.offers = (state.offers || []).filter(offer => offer.id !== trade.id);
  const sender = trade.fromPlayerId === financingMyServerId();
  const other = tradeCounterpart(trade, sender);
  if (!other) return;
  applyNegotiatedTrade(trade, sender, other);
  renderTradeModal();
  openSurface("#trade-modal", "#trade-close", { trigger });
}

function sendTrade(event) {
  if (!state.tradeWith) return;
  const me = state.players[0];
  const other = state.players.find((p) => p.id === state.tradeWith);
  if (!other) return;
  const statusNode = host.captureActionStatusNode(event?.currentTarget || document.activeElement);
  const myCash = clamp(state.tradeMyCash, 0, me.cash);
  const theirCash = clamp(state.tradeTheirCash, 0, other.cash);
  if (tradeIsBlank(myCash, theirCash)) {
    host.announceActionStatus("Add at least one deed or cash amount before sending a trade.", statusNode);
    return;
  }
  if (tradeValidationBlocked()) return;
  emitTradeOffer(other, myCash, theirCash, statusNode);
}
