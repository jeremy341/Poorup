/* ============================================================
   WALLET & ITEMS: one focused workbench for private round resources.
   The shell is client-owned, while every future mutation is delegated to
   the server through the injected action seam.
   ============================================================ */
import { $, esc } from "./clientDom.js";
import { state } from "./clientState.js";
import { closeSurface, openSurface, setSurfaceReturnFocus } from "./clientSurfaces.js";
import { emitWithTimeout } from "./clientRequestController.js";

let host = { emitServer: noop, renderRightRail: noop, renderHud: noop };
function noop() {}

const TIER_NAMES = {
  1: "STANDARD",
  2: "SPARKASSE PREMIUM",
  3: "AMERICAN EXPRESS BLACK",
};

function localPlayer() {
  return state.players?.[0] || {};
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

function accountTier(player, account) {
  return Math.max(1, Math.floor(Number(account.tier ?? player.bankAccountTier) || 1));
}

function accountEnabled(player, account) {
  return Boolean(account.enabled || player.bankAccountUpgrade || state.settings.bankAccountUpgrades);
}

function accountNextTier(player, account) {
  return account.nextTier || player.bankAccountUpgrade?.nextTier || null;
}

function accountCashbackCap(account) {
  return account.cashbackCap == null ? "NOT ACTIVE" : `$${Number(account.cashbackCap || 0).toLocaleString()} USED`;
}

function accountTierCopy(enabled, tierName) {
  return enabled ? `${tierName} · ROUND ACCOUNT` : "STANDARD · ACCOUNT TIERS OFF";
}

function accountNextCopy(next, enabled) {
  if (!next) return enabled ? "NO HIGHER TIER AVAILABLE" : "ENABLE BANK ACCOUNT UPGRADES IN TABLE RULES";
  const name = String(next.name || TIER_NAMES[Number(next.tier)] || "NEXT TIER");
  return `${esc(name)} · $${Number(next.cost || 0).toLocaleString()}`;
}

function walletAccountState(player) {
  const account = player.bankAccount || {};
  const tier = accountTier(player, account);
  const tierName = TIER_NAMES[tier] || `TIER ${tier}`;
  const enabled = accountEnabled(player, account);
  const next = accountNextTier(player, account);
  return {
    account,
    enabled,
    next,
    cap: accountCashbackCap(account),
    tierCopy: accountTierCopy(enabled, tierName),
    nextCopy: accountNextCopy(next, enabled)
  };
}

function accountUpgradeHTML(next) {
  if (next?.available !== true || typeof host.upgradeBankAccount !== "function") return "";
  return `<button class="cta-red wallet-primary" type="button" data-wallet-upgrade><span class="cta-text cta-text-sm">UPGRADE ACCOUNT</span></button>`;
}

function accountLedgerHTML(account) {
  const ledger = Array.isArray(account.ledger) ? account.ledger.slice(0, 5) : [];
  return ledger.length
    ? ledger.map(entry => `<div class="wallet-ledger-row"><span class="t-micro ink-3">${esc(String(entry.label || entry.type || "LEDGER").toUpperCase())}</span><strong class="t-label f11 ${Number(entry.amount) >= 0 ? "green" : "red"}">${Number(entry.amount) >= 0 ? "+" : "−"}$${Math.abs(Number(entry.amount) || 0).toLocaleString()}</strong></div>`).join("")
    : `<p class="t-micro ink-3">NO WALLET ENTRIES THIS ROUND.</p>`;
}

function accountView(player) {
  const { account, next, cap, tierCopy, nextCopy } = walletAccountState(player);
  const upgradeAction = accountUpgradeHTML(next);
  const ledgerHTML = accountLedgerHTML(account);
  return `<section class="wallet-view" id="wallet-view-account" role="tabpanel" aria-labelledby="wallet-tab-account"><div class="wallet-balance-grid"><div><span class="t-micro ink-3">CASH ON HAND</span><strong class="t-label f20 green">$${Number(player.cash || 0).toLocaleString()}</strong></div><div><span class="t-micro ink-3">RESERVED</span><strong class="t-label f16 g300">$${Number(player.reservedCash || 0).toLocaleString()}</strong></div><div><span class="t-micro ink-3">ACCOUNT</span><strong class="t-label f12 g100">${esc(tierCopy)}</strong></div><div><span class="t-micro ink-3">CASHBACK CAP</span><strong class="t-label f12 g300">${esc(cap)}</strong></div></div><div class="wallet-upgrade-panel"><div><span class="t-micro g400">NEXT LEDGER TIER</span><strong class="t-label f12 g100">${nextCopy}</strong><p class="t-micro ink-3">Benefits apply only to disclosed optional services. Rent, taxes, loans, wagers, and the upgrade cost never receive cashback.</p></div>${upgradeAction}</div><section class="wallet-ledger"><div class="rail-section-head"><span class="t-micro g400">RECENT WALLET LEDGER</span><span class="t-micro ink-3">SERVER SYNCED</span></div>${ledgerHTML}</section></section>`;
}

function itemActionHTML(item) {
  const actions = [];
  if (item.canUse === true) actions.push(`<button class="btn-dark" type="button" data-wallet-item-action="use" data-wallet-item-id="${esc(item.itemId || item.id || "")}"><span class="t-label f11">USE</span></button>`);
  if (item.tradeable !== false && item.canTrade === true) actions.push(`<button class="btn-dark" type="button" data-wallet-item-action="trade" data-wallet-item-id="${esc(item.itemId || item.id || "")}"><span class="t-label f11">TRADE</span></button>`);
  if (item.canExchange === true) actions.push(`<button class="btn-dark" type="button" data-wallet-item-action="exchange" data-wallet-item-id="${esc(item.itemId || item.id || "")}"><span class="t-label f11">EXCHANGE</span></button>`);
  if (item.canSell !== false) actions.push(`<button class="btn-dark" type="button" data-wallet-item-action="sell" data-wallet-item-id="${esc(item.itemId || item.id || "")}"><span class="t-label f11">SELL</span></button>`);
  return actions.length ? `<div class="wallet-item-actions">${actions.join("")}</div>` : "";
}

function itemDetailHTML(item) {
  if (!item) return "";
  const value = Number(item.sellValue ?? item.bankSellValue ?? 0);
  return `<div class="wallet-item-detail"><span class="t-micro g400">ITEM DETAILS</span><strong class="t-label f12 g100">${esc(itemLabel(item))}</strong><p class="t-body ink-2">${esc(item.description || "Server-resolved item from the table reward ledger.")}</p><span class="t-micro ink-3">BANK VALUE · $${Math.max(0, Math.floor(value)).toLocaleString()}</span></div>`;
}

function itemRowHTML(item, selected) {
  const itemId = String(item.itemId || item.id || "");
  const selectedClass = selected && String(selected.itemId || selected.id || "") === itemId ? " is-selected" : "";
  const uses = Number(item.usesRemaining ?? 0) > 0 ? `${Number(item.usesRemaining)} USES` : "PERSISTENT";
  const meta = `QTY ${Math.max(0, Math.floor(Number(item.quantity) || 0))} · ${esc(String(item.rarity || "COMMON").toUpperCase())} · ${uses}`;
  return `<article class="wallet-item-row${selectedClass}"><button class="wallet-item-select" type="button" data-wallet-item-select="${esc(itemId)}" aria-label="View details for ${esc(itemLabel(item))}"><span class="holding-item-glyph" aria-hidden="true">✦</span><span class="wallet-item-copy"><strong class="t-label f12 g100">${esc(itemLabel(item))}</strong><span class="t-micro ink-3">${meta}</span></span></button>${itemActionHTML(item)}</article>`;
}

function itemsView(player) {
  const items = itemEntries(player);
  if (!items.length) return `<section class="wallet-view" id="wallet-view-items" role="tabpanel" aria-labelledby="wallet-tab-items"><div class="wallet-empty"><span class="holding-item-glyph" aria-hidden="true">✦</span><strong class="t-label f13 g100">NO ITEMS THIS ROUND</strong><p class="t-body ink-3">Surprise and Treasure rewards appear here. Earned items can be used, traded, exchanged, or sold to the bank when the table rules allow it.</p></div></section>`;
  const selected = items.find(item => String(item.itemId || item.id || "") === String(state.walletItemId || "")) || null;
  const rows = items.map(item => itemRowHTML(item, selected)).join("");
  return `<section class="wallet-view" id="wallet-view-items" role="tabpanel" aria-labelledby="wallet-tab-items"><div class="wallet-items-head"><span class="t-micro g400">ROUND INVENTORY</span><span class="t-micro ink-3">${items.reduce((sum, item) => sum + Math.max(0, Math.floor(Number(item.quantity) || 0)), 0)} HELD</span></div><div class="wallet-items-list thin-scroll">${rows}</div>${itemDetailHTML(selected)}</section>`;
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
    host.handleItemAction?.(button.dataset.walletItemAction, button.dataset.walletItemId, button);
  }));
}

function resetUpgradeButton(button) {
  button.disabled = false;
  button.removeAttribute("aria-busy");
  button.querySelector(".cta-text")?.replaceChildren(document.createTextNode("UPGRADE ACCOUNT"));
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
  const card = $("#wallet-card");
  if (!card) return;
  const player = localPlayer();
  const view = normalizeView(state.walletView);
  state.walletView = view;
  card.innerHTML = `<div class="wallet-modal-body"><div class="wallet-modal-head"><div><span class="t-micro g400">PRIVATE ROUND LEDGER</span><h2 class="t-section g100" id="wallet-modal-title">Wallet &amp; Items</h2><p class="t-body ink-2" id="wallet-modal-description">Your cash, account tier, and earned items stay in one place.</p></div><button class="btn-dark" id="wallet-modal-close" type="button"><span class="t-label f11">CLOSE</span></button></div><div class="wallet-tabs" role="tablist" aria-label="Wallet views"><button class="wallet-tab${view === "account" ? " is-active" : ""}" id="wallet-tab-account" type="button" role="tab" aria-selected="${view === "account"}" aria-controls="wallet-view-account" data-wallet-view="account"><span class="t-label f11">ACCOUNT</span></button><button class="wallet-tab${view === "items" ? " is-active" : ""}" id="wallet-tab-items" type="button" role="tab" aria-selected="${view === "items"}" aria-controls="wallet-view-items" data-wallet-view="items"><span class="t-label f11">ITEMS</span><span class="t-micro ink-3">${itemEntries(player).length}</span></button></div>${view === "account" ? accountView(player) : itemsView(player)}</div>`;
  card.querySelector("#wallet-modal-close")?.addEventListener("click", closeWalletModal);
  bindWalletTabs(card);
  bindWalletItems(card);
  bindWalletUpgrade(card);
}

export function configureWalletUi(hooks) {
  host = { ...host, ...hooks };
}

export function openWalletModal(view = "account", trigger = null) {
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
