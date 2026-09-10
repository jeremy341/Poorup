// Profile collection renderer. Cosmetics are visual metadata only and never
// enter the board or economy legality paths.
import { $, esc } from './clientDom.js';
import { state } from './clientState.js';

let host = { emitServer: noop, announce: noop };
function noop() {}

export function configureCosmetics(hooks) { host = { ...host, ...hooks }; }

export function requestCosmetics(target = '#profile-collection-content') {
  const root = $(target);
  if (root) root.innerHTML = '<p class="t-body ink-3 collection-empty">LOADING COLLECTION…</p>';
  state.cosmetics.loading = true;
  host.emitServer('get-cosmetics', {}, response => {
    state.cosmetics.loading = false;
    if (!response?.success || !response.cosmetics) {
      state.cosmetics.error = response?.error || 'Collection is available after sign-in.';
      state.cosmetics.catalog = [];
    } else {
      state.cosmetics.error = '';
      state.cosmetics = { ...state.cosmetics, ...response.cosmetics };
    }
    renderCollection(target);
  });
}

function cosmeticClass(item, owned) {
  return `collection-item rarity-${String(item.rarity || 'common').toLowerCase()}${owned ? ' is-owned' : ''}`;
}

function itemGlyph(item) {
  const type = String(item.type || 'cosmetic');
  const asset = type === 'board-skin' ? '/assets/market-complexity.svg' : '/assets/season-reward.svg';
  return `<span class="collection-glyph" aria-hidden="true"><img src="${asset}" alt="" width="24" height="24" loading="lazy"></span>`;
}

function previewHTML(item, owned, equipped) {
  if (!item) return "";
  const paid = Number(item.cost || 0) > 0;
  return `<section class="collection-preview panel noise" aria-labelledby="collection-preview-title"><div class="collection-preview-mark">${itemGlyph(item)}</div><div class="collection-preview-copy"><span class="t-micro g400">ITEM DETAIL · ${esc(String(item.type || "COSMETIC").replaceAll("-", " ").toUpperCase())}</span><h3 class="t-section g100" id="collection-preview-title">${esc(item.name || item.id)}</h3><p class="t-body ink-2">${esc(item.description || "Cosmetic item.")}</p><span class="t-micro ${owned ? "green" : "g300"}">${equipped ? "EQUIPPED" : owned ? "OWNED" : paid ? `${item.cost} PARLOR TOKENS` : "VERIFIED SEASON REWARD"}</span></div><button class="btn-dark" type="button" data-cosmetic-preview-close aria-label="Close cosmetic details"><span class="t-label f11">CLOSE</span></button></section>`;
}

export function renderCollection(target = '#profile-collection-content') {
  const root = $(target);
  if (!root) return;
  const data = state.cosmetics || {};
  renderCollectionContent(root, data);
}

function renderCollectionContent(root, data) {
  const status = collectionStatusHTML(data);
  if (status) { root.innerHTML = status; return; }
  const owned = new Set(data.owned || []);
  const catalog = Array.isArray(data.catalog) ? data.catalog : [];
  updateCollectionCount(owned);
  root.innerHTML = collectionCatalogHTML({ data, owned, catalog, ...collectionPreviewState(data, catalog, owned) });
}

function updateCollectionCount(owned) {
  const count = $('#profile-collection-count');
  if (count) count.textContent = String(owned.size);
}

function collectionPreviewState(data, catalog, owned) {
  const preview = catalog.find(item => item.id === state.cosmeticPreviewId) || null;
  return {
    preview,
    previewOwned: Boolean(preview && owned.has(preview.id)),
    previewEquipped: Boolean(preview && Object.values(data.equipped || {}).includes(preview.id))
  };
}

function collectionStatusHTML(data) {
  if (data.loading) return '<p class="t-body ink-3 collection-empty">LOADING COLLECTION…</p>';
  if (data.error) return `<div class="collection-empty"><span class="t-micro g400">COLLECTION LOCKED</span><p class="t-body ink-2">${esc(data.error)}</p></div>`;
  return '';
}

function collectionEmptyHTML() {
  return '<div class="collection-empty"><span class="t-micro g400">NO COSMETICS SYNCED</span><p class="t-body ink-2">Sign in to earn Parlor Tokens and keep your visual collection between tables.</p></div>';
}

function cosmeticActionHTML(item, isOwned, equipped, tokens) {
  if (isOwned) return `<button class="btn-dark" type="button" data-cosmetic-equip="${esc(item.id)}" data-cosmetic-slot="${esc(item.type || '')}"><span class="t-label f11">${equipped ? 'EQUIPPED' : 'EQUIP'}</span></button>`;
  if (Number(item.cost || 0) > 0) return `<button class="btn-dark" type="button" data-cosmetic-claim="${esc(item.id)}" ${tokens < item.cost ? 'disabled' : ''}><span class="t-label f11">CLAIM</span></button>`;
  return '<button class="btn-dark" type="button" disabled title="Earn this item from a verified season reward"><span class="t-label f11">EARN</span></button>';
}

function collectionItemHTML(item, owned, equippedIds, tokens) {
  const isOwned = owned.has(item.id);
  const equipped = equippedIds.has(item.id);
  const paid = Number(item.cost || 0) > 0;
  const action = cosmeticActionHTML(item, isOwned, equipped, tokens);
  const status = equipped ? 'EQUIPPED' : isOwned ? 'OWNED' : paid ? `${item.cost} TOKENS` : 'SEASON REWARD';
  return `<article class="${cosmeticClass(item, isOwned)}"><div class="collection-item-head">${itemGlyph(item)}<span class="rarity-label">${esc(item.rarity || 'COMMON')}</span></div><strong class="t-label f12 g100">${esc(item.name || item.id)}</strong><p class="t-micro ink-3">${esc(item.description || '')}</p><div class="collection-item-foot"><button class="btn-dark" type="button" data-cosmetic-preview="${esc(item.id)}"><span class="t-label f11">DETAILS</span></button><span class="t-micro ${isOwned ? 'green' : 'g300'}">${status}</span>${action}</div></article>`;
}

function collectionCatalogHTML({ data, owned, catalog, preview, previewOwned, previewEquipped }) {
  if (!catalog.length) return collectionEmptyHTML();
  const equippedIds = new Set(Object.values(data.equipped || {}));
  const tokens = Number(data.tokens || 0);
  const grid = catalog.map(item => collectionItemHTML(item, owned, equippedIds, tokens)).join('');
  return `<div class="collection-toolbar"><div><span class="t-micro g400">PARLOR TOKENS</span><strong class="t-label f20 g300">${tokens.toLocaleString()}</strong></div><span class="t-micro ink-3">${owned.size}/${catalog.length} OWNED · COSMETICS NEVER CHANGE GAMEPLAY</span></div>${previewHTML(preview, previewOwned, previewEquipped)}<div class="collection-grid">${grid}</div>`;
}

function cosmeticPreviewAction(event, target) {
  const closePreview = event.target.closest('[data-cosmetic-preview-close]');
  if (closePreview) {
    state.cosmeticPreviewId = null;
    renderCollection(target);
    return true;
  }
  const preview = event.target.closest('[data-cosmetic-preview]');
  if (preview) {
    state.cosmeticPreviewId = preview.dataset.cosmeticPreview || null;
    renderCollection(target);
    return true;
  }
  return false;
}

function cosmeticMutationTarget(event) {
  const claim = event.target.closest('[data-cosmetic-claim]');
  const equip = event.target.closest('[data-cosmetic-equip]');
  if (!claim && !equip) return null;
  const source = claim || equip;
  const id = claim ? claim.dataset.cosmeticClaim : equip.dataset.cosmeticEquip;
  return {
    id,
    eventName: claim ? 'claim-cosmetic' : 'equip-cosmetic',
    payload: claim ? { cosmeticId: id, claimKey: `shop:${id}` } : { cosmeticId: id, slot: source.dataset?.cosmeticSlot }
  };
}

function submitCosmeticMutation(action, target) {
  const { eventName, payload } = action;
  host.emitServer(eventName, payload, response => {
    if (!response?.success) host.announce(response?.error || 'Cosmetic action could not be completed.');
    else state.cosmetics = { ...state.cosmetics, ...(response.snapshot || {}) };
    renderCollection(target);
  });
}

export function handleCosmeticClick(event, target = '#profile-collection-content') {
  if (cosmeticPreviewAction(event, target)) return true;
  const action = cosmeticMutationTarget(event);
  if (!action) return false;
  submitCosmeticMutation(action, target);
  return true;
}
