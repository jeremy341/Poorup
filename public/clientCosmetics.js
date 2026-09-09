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

export function renderCollection(target = '#profile-collection-content') {
  const root = $(target);
  if (!root) return;
  const data = state.cosmetics || {};
  if (data.loading) { root.innerHTML = '<p class="t-body ink-3 collection-empty">LOADING COLLECTION…</p>'; return; }
  if (data.error) { root.innerHTML = `<div class="collection-empty"><span class="t-micro g400">COLLECTION LOCKED</span><p class="t-body ink-2">${esc(data.error)}</p></div>`; return; }
  const owned = new Set(data.owned || []);
  const catalog = Array.isArray(data.catalog) ? data.catalog : [];
  const count = $('#profile-collection-count');
  if (count) count.textContent = String(owned.size);
  if (!catalog.length) { root.innerHTML = '<div class="collection-empty"><span class="t-micro g400">NO COSMETICS SYNCED</span><p class="t-body ink-2">Sign in to earn Parlor Tokens and keep your visual collection between tables.</p></div>'; return; }
  root.innerHTML = `<div class="collection-toolbar"><div><span class="t-micro g400">PARLOR TOKENS</span><strong class="t-label f20 g300">${Number(data.tokens || 0).toLocaleString()}</strong></div><span class="t-micro ink-3">${owned.size}/${catalog.length} OWNED · COSMETICS NEVER CHANGE GAMEPLAY</span></div><div class="collection-grid">${catalog.map(item => { const isOwned = owned.has(item.id); const equipped = Object.values(data.equipped || {}).includes(item.id); const paid = Number(item.cost || 0) > 0; const action = isOwned ? `<button class="btn-dark" type="button" data-cosmetic-equip="${esc(item.id)}" data-cosmetic-slot="${esc(item.type || '')}"><span class="t-label f11">${equipped ? 'EQUIPPED' : 'EQUIP'}</span></button>` : paid ? `<button class="btn-dark" type="button" data-cosmetic-claim="${esc(item.id)}" ${Number(data.tokens || 0) < item.cost ? 'disabled' : ''}><span class="t-label f11">CLAIM</span></button>` : `<button class="btn-dark" type="button" disabled title="Earn this item from a verified season reward"><span class="t-label f11">EARN</span></button>`; return `<article class="${cosmeticClass(item, isOwned)}"><div class="collection-item-head">${itemGlyph(item)}<span class="rarity-label">${esc(item.rarity || 'COMMON')}</span></div><strong class="t-label f12 g100">${esc(item.name || item.id)}</strong><p class="t-micro ink-3">${esc(item.description || '')}</p><div class="collection-item-foot"><span class="t-micro ${isOwned ? 'green' : 'g300'}">${equipped ? 'EQUIPPED' : isOwned ? 'OWNED' : paid ? `${item.cost} TOKENS` : 'SEASON REWARD'}</span>${action}</div></article>`; }).join('')}</div>`;
}

export function handleCosmeticClick(event, target = '#profile-collection-content') {
  const claim = event.target.closest('[data-cosmetic-claim]');
  const equip = event.target.closest('[data-cosmetic-equip]');
  if (!claim && !equip) return false;
  const id = (claim || equip).dataset.cosmeticClaim || (claim || equip).dataset.cosmeticEquip;
  const eventName = claim ? 'claim-cosmetic' : 'equip-cosmetic';
  const payload = claim ? { cosmeticId: id, claimKey: `shop:${id}` } : { cosmeticId: id, slot: (equip || {}).dataset?.cosmeticSlot };
  host.emitServer(eventName, payload, response => {
    if (!response?.success) host.announce(response?.error || 'Cosmetic action could not be completed.');
    else state.cosmetics = { ...state.cosmetics, ...(response.snapshot || {}) };
    renderCollection(target);
  });
  return true;
}
