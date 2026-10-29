// WALLET & ITEMS: one focused workbench for private round resources.
// The shell is client-owned; item mutations and eligibility belong to
// the server through the injected action seam.
import { $, esc } from "./clientDom.js";
import { state } from "./clientState.js";
import { closeSurface, openSurface, setSurfaceReturnFocus } from "./clientSurfaces.js";
import { emitWithTimeout } from "./clientRequestController.js";
import { spriteHTML } from "./clientSprites.js";
import { closeButtonHTML } from "./clientCloseButton.js";

let host = { emitServer: noop, renderRightRail: noop, renderHud: noop };
const pendingItems = new Set();
const itemRequestIds = new Map();
let itemStatus = "";
let itemContext = null;
let itemContextGeneration = {};
function noop() {}

const TIER_NAMES = {
  1: "STANDARD",
  2: "PARLOR PREMIUM",
  3: "PARLOR BLACK",
};

function localPlayer() {
  return state.players?.[0] || {};
}

function syncItemContext() {
  const player = localPlayer();
  const current = JSON.stringify([state.roomCode, state.clientId, state.account?.account?.id, player.serverId ?? player.id, player.accountId]);
  if (current !== itemContext) {
    itemContext = current;
    itemContextGeneration = {};
    pendingItems.clear();
    itemRequestIds.clear();
    itemStatus = "";
  }
  return itemContextGeneration;
}

function normalizeView(view) {
  return view === "items" ? "items" : "account";
}

function itemEntries(player) {
  const source = player?.items;
  if (Array.isArray(source)) return source.filter(item => item && typeof item === "object");
  if (!source || typeof source !== "object") return [];
  return Object.entries(source).map(([itemId, item]) => ({ itemId, ...(item || {}) }));
}

function itemLabel(item) {
  return String(item.name || item.itemId || item.id || "ITEM").replaceAll("-", " ").toUpperCase();
}

// The server sends each owner their account: tier, rebate, cap and what can be
// bought next. Nothing here is computed on the client.
function walletAccount(player) {
  const raw = player.bankAccount || {};
  const enabled = Boolean(raw.enabled ?? state.settings.bankAccountUpgrades);
  const tier = Math.max(1, Math.floor(Number(raw.tier ?? player.bankAccountTier) || 1));
  return {
    enabled,
    tier,
    name: String(raw.name || TIER_NAMES[tier] || `TIER ${tier}`).toUpperCase(),
    rebatePct: Number(raw.rebatePct) || 0,
    earned: Number(raw.cashbackEarned) || 0,
    next: raw.nextTier || null,
    ledger: Array.isArray(raw.ledger) ? raw.ledger : [],
  };
}

function money(value) {
  return `$${Number(value || 0).toLocaleString()}`;
}

function accountLedgerHTML(ledger) {
  const rows = ledger.slice(0, 5);
  return rows.length
    ? rows.map(entry => `<div class="wallet-ledger-row"><span class="t-micro ink-3">${esc(String(entry.label || entry.type || "LEDGER").toUpperCase())}</span><strong class="t-label f11 ${Number(entry.amount) >= 0 ? "green" : "red"}">${Number(entry.amount) >= 0 ? "+" : "−"}$${Math.abs(Number(entry.amount) || 0).toLocaleString()}</strong></div>`).join("")
    : `<p class="t-micro ink-3">NO WALLET ENTRIES THIS ROUND.</p>`;
}

function accountCardHTML(account) {
  if (!account.enabled) {
    return `<div class="wallet-account-card is-off"><div class="slip-head"><span class="slip-icon" aria-hidden="true">${spriteHTML("note", 4)}</span><div><strong class="t-label f13 g100">BANK ACCOUNTS ARE OFF</strong><span class="t-micro ink-3">THE HOST CAN SWITCH THEM ON IN TABLE RULES</span></div></div></div>`;
  }
  const rebate = account.rebatePct ? `${account.rebatePct}% OF FEES` : "NONE YET";
  return `<div class="wallet-account-card"><div class="slip-head"><span class="slip-icon" aria-hidden="true">${spriteHTML("note", 4)}</span><div><span class="t-micro g400">BANK ACCOUNT · TIER ${account.tier}</span><h3 class="t-label f16 g100">${esc(account.name)}</h3></div></div><dl class="wallet-account-rows"><div><dt class="t-micro ink-3">REBATE</dt><dd class="t-label f12 g100">${rebate}</dd></div><div><dt class="t-micro ink-3">CASHBACK EARNED</dt><dd class="t-label f12 g100">${money(account.earned)}</dd></div></dl><p class="t-micro ink-3">Rebates apply to market and flight fees only.</p></div>`;
}

function accountUpgradeHTML(account) {
  if (!account.enabled) return "";
  const next = account.next;
  if (!next) return `<p class="t-micro ink-3 wallet-upgrade-done">TOP TIER · NOTHING LEFT TO BUY</p>`;
  const reason = next.available || !next.reason ? "" : `<p class="t-micro red wallet-upgrade-reason" role="status">${esc(next.reason)}</p>`;
  return `<div class="wallet-upgrade-row"><div class="wallet-upgrade-copy"><span class="t-micro g400">NEXT TIER</span><strong class="t-label f13 g100">${esc(String(next.name || "NEXT TIER").toUpperCase())}</strong><span class="t-micro ink-3">${Number(next.rebatePct) || 0}% REBATE ON FEES</span></div><button class="cta-red wallet-primary" type="button" data-wallet-upgrade ${next.available ? "" : "disabled"}><span class="cta-text cta-text-sm">UPGRADE ${money(next.cost)}</span></button></div>${reason}`;
}

function accountView(player) {
  const account = walletAccount(player);
  return `<section class="wallet-view" id="wallet-view-account" role="tabpanel" aria-labelledby="wallet-tab-account"><div class="wallet-balance-grid"><div><span class="t-micro ink-3">CASH ON HAND</span><strong class="t-label f20 green">${money(player.cash)}</strong></div><div><span class="t-micro ink-3">RESERVED</span><strong class="t-label f16 g300">${money(player.reservedCash)}</strong></div></div>${accountCardHTML(account)}${accountUpgradeHTML(account)}<section class="wallet-ledger"><div class="rail-section-head"><span class="t-micro g400">RECENT WALLET LEDGER</span></div>${accountLedgerHTML(account.ledger)}</section></section>`;
}

function itemBankValue(item) {
  const value = item.sellValue ?? item.bankSellValue;
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;
}

function itemActionHTML(item) {
  const id = String(item.itemId || item.id || "");
  const busy = pendingItems.has(id);
  const actions = [];
  const button = (action, label, available, reason) => `<button class="btn-dark" type="button" data-wallet-item-action="${action}" data-wallet-item-id="${esc(id)}" ${available && !busy ? "" : "disabled"} ${busy ? 'aria-busy="true"' : ""} ${reason ? `title="${esc(reason)}"` : ""}><span class="t-label f11">${busy ? "PROCESSING…" : esc(label)}</span></button>`;
  if (item.catalogId === "prison-key" || item.catalogId === "parlor-bond" || item.canUse === true) {
    const label = String(item.actionLabel || "USE").toUpperCase();
    const payout = typeof item.redeemValue === "number" && Number.isFinite(item.redeemValue) && item.redeemValue > 0 ? ` ${money(item.redeemValue)}` : "";
    actions.push(button("use", `${label}${payout}`, item.canUse === true, item.useReason));
  }
  const value = itemBankValue(item);
  if (value !== null && value > 0) actions.push(button("sell", `SELL ${money(value)}`, item.canSell === true, item.sellReason));
  return actions.length ? `<div class="wallet-item-actions">${actions.join("")}</div>` : "";
}

function itemDetailHTML(item) {
  if (!item) return "";
  return `<div class="wallet-item-detail"><span class="t-micro g400">ITEM DETAILS</span><strong class="t-label f12 g100">${esc(itemLabel(item))}</strong><p class="t-body ink-2">${esc(item.description || "No item description available.")}</p><span class="t-micro ink-3">${itemValueLabel(item)}</span></div>`;
}

function itemValueLabel(item) {
  if (item.catalogId === "prison-key" && item.sellReason === "This prison card cannot be sold under classic rules.") return "NOT FOR SALE";
  const value = itemBankValue(item);
  return value === null ? "BANK VALUE UNAVAILABLE" : `BANK ${money(value)}`;
}

function itemGlyphHTML(item) {
  const icons = ["prison-key", "parlor-bond", "silver-keepsake"];
  if (!icons.includes(item.catalogId)) return spriteHTML("chest", 3);
  return `<svg width="24" height="24" viewBox="0 0 24 24" aria-hidden="true" focusable="false"><use href="/assets/item-icons.svg#${item.catalogId}"/></svg>`;
}

export function itemRowHTML(item, selected) {
  const itemId = String(item.itemId || item.id || "");
  const selectedClass = selected && String(selected.itemId || selected.id || "") === itemId ? " is-selected" : "";
  const maturity = Number.isFinite(item.maturesRound) ? `<span class="wallet-item-maturity">${state.roundNumber >= item.maturesRound ? "MATURE SINCE" : "MATURES"} ROUND ${item.maturesRound}</span>` : "";
  const reason = item.canUse === false && ["prison-key", "parlor-bond"].includes(item.catalogId) ? item.useReason : "";
  const saleReason = item.canSell === false ? item.sellReason : "";
  const maturityReason = Number.isFinite(item.maturesRound) ? `Matures in round ${item.maturesRound}.` : "";
  const note = [...new Set([reason === maturityReason ? "" : reason, saleReason].filter(Boolean))].join(" ");
  return `<article class="wallet-item-row${selectedClass}"><button class="wallet-item-select" type="button" data-wallet-item-select="${esc(itemId)}" aria-label="View details for ${esc(itemLabel(item))}"><span class="holding-item-glyph" aria-hidden="true">${itemGlyphHTML(item)}</span><span class="wallet-item-copy"><strong class="t-label f12 g100">${esc(itemLabel(item))}</strong><span class="wallet-item-meta t-micro g300"><span>${itemValueLabel(item)}</span>${maturity}</span>${note ? `<span class="t-micro ink-3">${esc(note)}</span>` : ""}</span></button>${itemActionHTML(item)}</article>`;
}

function itemsView(player) {
  const items = itemEntries(player);
  const status = `<p class="wallet-item-status t-body ink-2" id="wallet-item-status" tabindex="-1" role="status" aria-live="polite">${esc(itemStatus)}</p>`;
  if (!items.length) return `<section class="wallet-view" id="wallet-view-items" role="tabpanel" aria-labelledby="wallet-tab-items"><div class="wallet-empty"><span class="holding-item-glyph" aria-hidden="true">${spriteHTML("chest", 4)}</span><strong class="t-label f13 g100">NO ITEMS THIS ROUND</strong><p class="t-body ink-3">${state.settings.itemRewards ? "Surprise and Treasure can award bonds and keepsakes." : "Item rewards are off. Prison cards still appear here when earned."}</p></div>${status}</section>`;
  const selected = items.find(item => String(item.itemId || item.id || "") === String(state.walletItemId || "")) || null;
  const rows = items.map(item => itemRowHTML(item, selected)).join("");
  return `<section class="wallet-view" id="wallet-view-items" role="tabpanel" aria-labelledby="wallet-tab-items"><div class="wallet-items-head"><span class="t-micro g400">ROUND INVENTORY</span><span class="t-micro ink-3">${items.length} HELD</span></div><div class="wallet-items-list thin-scroll" id="wallet-items-list" tabindex="0" aria-label="Your items">${rows}</div>${itemDetailHTML(selected)}${status}</section>`;
}

function bindWalletTabs(card) {
  card.querySelectorAll("[data-wallet-view]").forEach(button => button.addEventListener("click", () => {
    state.walletView = normalizeView(button.dataset.walletView);
    renderWalletModal();
    card.querySelector(`#wallet-tab-${state.walletView}`)?.focus({ preventScroll: true });
  }));
  card.querySelector(".wallet-tabs")?.addEventListener("keydown", event => {
    const current = event.target.closest("[role=tab]");
    if (!current) return;
    const tabs = [...card.querySelectorAll(".wallet-tabs [role=tab]")];
    let index = tabs.indexOf(current);
    if (event.key === "ArrowRight" || event.key === "ArrowDown") index = (index + 1) % tabs.length;
    else if (event.key === "ArrowLeft" || event.key === "ArrowUp") index = (index - 1 + tabs.length) % tabs.length;
    else return;
    event.preventDefault();
    tabs[index].click();
  });
}

function bindWalletItems(card) {
  card.querySelectorAll("[data-wallet-item-select]").forEach(button => button.addEventListener("click", () => {
    state.walletView = "items";
    state.walletItemId = button.dataset.walletItemSelect || null;
    renderWalletModal();
    [...card.querySelectorAll("[data-wallet-item-select]")]
      .find(node => node.dataset.walletItemSelect === state.walletItemId)
      ?.focus({ preventScroll: true });
  }));
  card.querySelectorAll("[data-wallet-item-action]").forEach(button => button.addEventListener("click", () => {
    submitWalletItemAction(button.dataset.walletItemAction, button.dataset.walletItemId);
  }));
}

export function submitWalletItemAction(action, itemId) {
  const context = syncItemContext();
  const item = itemEntries(localPlayer()).find(entry => String(entry.itemId || entry.id) === String(itemId));
  if (!item || !["use", "sell"].includes(action) || pendingItems.has(String(itemId))) return false;
  if (action === "use" ? item.canUse !== true : item.canSell !== true || itemBankValue(item) === null) return false;
  const key = `${action}:${itemId}`;
  const requestId = itemRequestIds.get(key) || host.createRequestId?.("item") || `item-${Date.now()}-${Math.random().toString(36).slice(2)}`;
  itemRequestIds.set(key, requestId);
  pendingItems.add(String(itemId));
  itemStatus = "PROCESSING…";
  renderWalletModal();
  const finish = message => {
    if (syncItemContext() !== context) return;
    pendingItems.delete(String(itemId));
    itemStatus = message;
    renderWalletModal();
    host.refreshWalletSnapshot?.();
    host.renderRightRail();
    host.renderHud();
  };
  emitWithTimeout(host.emitServer, `${action}-item`, { itemId, requestId }, {
    onResponse: response => {
      if (syncItemContext() !== context) return;
      itemRequestIds.delete(key);
      if (response?.success !== true) return finish(response?.error || "The item action could not be completed. Try again.");
      const payout = Number.isFinite(response.cashReceived) ? ` for ${money(response.cashReceived)}` : "";
      finish(action === "sell" ? `Sold${payout}.` : item.catalogId === "parlor-bond" ? `Redeemed${payout}.` : "Prison Key used.");
    },
    onTimeout: () => finish("The item action could not be confirmed. Retry to check the same request."),
  });
  return true;
}

function resetUpgradeButton(button) {
  button.disabled = false;
  button.removeAttribute("aria-busy");
  button.querySelector(".cta-text")?.replaceChildren(document.createTextNode(button.dataset.label || "UPGRADE"));
}

function walletUpgradeResponse(button, response) {
  if (response?.success === false) {
    resetUpgradeButton(button);
    host.notice?.(response.error || "Account upgrade could not be completed.");
    return;
  }
  renderWalletModal();
  host.renderRightRail();
  host.renderHud();
}

function submitWalletUpgrade(button) {
  if (!button || button.disabled) return;
  button.dataset.label = button.querySelector(".cta-text")?.textContent || "UPGRADE";
  button.disabled = true;
  button.setAttribute("aria-busy", "true");
  button.querySelector(".cta-text")?.replaceChildren(document.createTextNode("PROCESSING…"));
  const requestId = host.createRequestId?.("bank-account");
  emitWithTimeout(host.emitServer, "upgrade-bank-account", { requestId }, {
    onResponse: response => walletUpgradeResponse(button, response),
    onTimeout: () => {
      resetUpgradeButton(button);
      host.notice?.("Account upgrade timed out. Your wallet will refresh when the connection returns.");
    }
  });
}

function bindWalletUpgrade(card) {
  card.querySelector("[data-wallet-upgrade]")?.addEventListener("click", () => {
    submitWalletUpgrade(card.querySelector("[data-wallet-upgrade]"));
  });
}

function renderWalletModal() {
  syncItemContext();
  const card = $("#wallet-card");
  if (!card) return;
  const focused = card.contains?.(document.activeElement) ? document.activeElement : null;
  const focusId = focused?.id;
  const focusItemId = focused?.dataset?.walletItemSelect || focused?.dataset?.walletItemId;
  const focusAction = focused?.dataset?.walletItemAction;
  const scrollTop = card.querySelector(".wallet-items-list")?.scrollTop || 0;
  const player = localPlayer();
  const view = normalizeView(state.walletView);
  state.walletView = view;
  card.innerHTML = `<div class="wallet-modal-body"><div class="wallet-modal-head"><div><span class="t-micro g400">PRIVATE ROUND LEDGER</span><h2 class="t-section g100" id="wallet-modal-title">Wallet &amp; Items</h2><p class="sr-only" id="wallet-modal-description">Your cash, account tier, and earned items stay in one place.</p></div>${closeButtonHTML({ id: "wallet-modal-close", label: "Close wallet and items" })}</div><div class="wallet-tabs" role="tablist" aria-label="Wallet views"><button class="wallet-tab${view === "account" ? " is-active" : ""}" id="wallet-tab-account" type="button" role="tab" aria-selected="${view === "account"}" aria-controls="wallet-view-account" data-wallet-view="account"><span class="t-label f11">ACCOUNT</span></button><button class="wallet-tab${view === "items" ? " is-active" : ""}" id="wallet-tab-items" type="button" role="tab" aria-selected="${view === "items"}" aria-controls="wallet-view-items" data-wallet-view="items"><span class="t-label f11">ITEMS</span><span class="t-micro ink-3">${itemEntries(player).length}</span></button></div>${view === "account" ? accountView(player) : itemsView(player)}</div>`;
  card.querySelector("#wallet-modal-close")?.addEventListener("click", closeWalletModal);
  bindWalletTabs(card);
  bindWalletItems(card);
  bindWalletUpgrade(card);
  const list = card.querySelector(".wallet-items-list");
  if (list) list.scrollTop = scrollTop;
  if (focused) {
    const itemControl = [...card.querySelectorAll("[data-wallet-item-select], [data-wallet-item-action]")].find(node =>
      focusAction ? node.dataset.walletItemId === focusItemId && node.dataset.walletItemAction === focusAction : node.dataset.walletItemSelect === focusItemId);
    const nextFocus = focusId ? card.querySelector(`#${focusId}`) : itemControl;
    (nextFocus && !nextFocus.disabled ? nextFocus : card.querySelector("#wallet-item-status"))?.focus({ preventScroll: true });
  }
}

export function configureWalletUi(hooks) {
  host = { ...host, ...hooks };
}

export function openWalletModal(view = "account", trigger = null) {
  syncItemContext();
  if (!pendingItems.size) itemStatus = "";
  state.walletView = normalizeView(view);
  state.walletItemId = trigger?.dataset?.walletItem || null;
  renderWalletModal();
  if (trigger instanceof HTMLElement) setSurfaceReturnFocus(trigger);
  openSurface("#wallet-modal", `#wallet-tab-${state.walletView}`);
}

export function closeWalletModal() {
  closeSurface("#wallet-modal");
}

export function renderWalletModalIfOpen() {
  if (!$("#wallet-modal") || $("#wallet-modal").classList.contains("is-hidden")) return;
  renderWalletModal();
}

export function bindWalletUi() {
  $("#wallet-scrim")?.addEventListener("click", closeWalletModal);
}
