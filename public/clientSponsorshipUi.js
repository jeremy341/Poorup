/* ============================================================
   SPONSORED PURCHASE SURFACE: a small, escrow-aware contribution flow for
   an open bank purchase. It never moves a player out of the current lobby or
   game surface; the server owns every reservation and forced purchase.
   ============================================================ */
import { $, esc } from "./clientDom.js";
import { state } from "./clientState.js";
import { TILES } from "./clientBoardData.js";
import { closeSurface, openSurface, setSurfaceReturnFocus } from "./clientSurfaces.js";

let host = { emitServer: noop, say: noop, renderChat: noop, createRequestId: null };
let requestPending = false;
let sponsorshipRequestDraft = null;
function noop() {}

export function createSponsorshipActionGate() {
  const pending = new Set();
  return {
    begin(requestId) {
      if (pending.has(requestId)) return false;
      pending.add(requestId);
      return true;
    },
    complete(requestId) { pending.delete(requestId); },
    clear() { pending.clear(); },
  };
}
const sponsorshipActionGate = createSponsorshipActionGate();

export function configureSponsorshipUi(hooks) {
  host = { ...host, ...hooks };
}

function newRequestId() {
  return typeof host.createRequestId === "function"
    ? host.createRequestId("sponsored-purchase")
    : `sponsored-purchase-${globalThis.crypto?.randomUUID?.() || Date.now().toString(36)}`;
}

export function sponsorshipRequestPayload(tileIndex, mode = "gift", sharePct = 10, id = newRequestId()) {
  if (mode !== "equity") return { tileIndex: Number(tileIndex) };
  return { tileIndex: Number(tileIndex), mode: "equity", sharePct: Math.max(5, Math.min(100, Math.floor(Number(sharePct) || 10))), requestId: id };
}

export function sponsorshipFlowPayload(sponsorship) {
  return sponsorship?.mode === "equity" && sponsorship.requestId ? { requestId: sponsorship.requestId } : {};
}

export function sponsorshipContributionPayload(amount, sponsorship) {
  return { amount: Math.floor(Number(amount) || 0), ...sponsorshipFlowPayload(sponsorship) };
}

function localServerId() {
  return state.players[0]?.serverId || null;
}

function localContribution(sponsorship) {
  return sponsorship?.contributions?.find(entry => entry.sponsorId === localServerId()) || null;
}

function sponsorshipCopy(sponsorship, isBuyer, mine) {
  if (sponsorship.mode === "equity") {
    if (isBuyer) return `Investor has reserved $${Number(sponsorship.totalContributed || 0).toLocaleString()} of $${Number(sponsorship.price || 0).toLocaleString()} for ${sponsorship.tileName}. You cover the remainder and grant ${Number(sponsorship.sharePct || 0)}% of collected rent.`;
    if (mine) return `Your $${Number(mine.amount || 0).toLocaleString()} is reserved in escrow. If accepted, you receive ${Number(sponsorship.sharePct || 0)}% of collected rent from ${sponsorship.tileName}.`;
    return `${sponsorship.buyerName} needs $${Number(sponsorship.amountNeeded || 0).toLocaleString()} for ${sponsorship.tileName}. Reserve an investment; the buyer covers the remaining purchase price and you receive ${Number(sponsorship.sharePct || 0)}% of collected rent.`;
  }
  if (isBuyer) return `Sponsors have reserved $${Number(sponsorship.totalContributed || 0).toLocaleString()} of the $${Number(sponsorship.price || 0).toLocaleString()} purchase. Accepting immediately buys ${sponsorship.tileName}.`;
  if (mine) return `Your $${Number(mine.amount || 0).toLocaleString()} is reserved until the buyer accepts or cancels.`;
  return `${sponsorship.buyerName} needs $${Number(sponsorship.amountNeeded || 0).toLocaleString()} more to buy ${sponsorship.tileName}. Contributions are gifts tied to this purchase.`;
}

function contributionsHTML(sponsorship) {
  const rows = (sponsorship.contributions || []).map(entry => `<div class="sponsorship-row"><span class="t-label f11 g100">${esc(entry.sponsorName)}</span><strong class="t-label f12 green">$${Number(entry.amount || 0).toLocaleString()}</strong></div>`).join("");
  return rows || `<p class="t-micro ink-3">NO CONTRIBUTIONS YET.</p>`;
}

function actionsHTML(sponsorship, isBuyer, mine) {
  if (isBuyer) {
    const buyerContribution = Math.max(0, Number(sponsorship.price || 0) - Number(sponsorship.totalContributed || 0));
    const localCash = Number(state.players[0]?.cash || 0);
    const equityReady = sponsorship.mode === "equity" && buyerContribution <= localCash;
    const giftReady = Number(sponsorship.totalContributed || 0) > 0 && Number(sponsorship.amountNeeded || 0) <= 0;
    const enabled = equityReady || giftReady;
    return `<div class="sponsorship-actions"><button class="cta-red" type="button" data-sponsorship-action="accept" ${enabled ? "" : "disabled"}><span class="cta-text cta-text-sm">ACCEPT &amp; BUY</span></button><button class="btn-dark" type="button" data-sponsorship-action="decline"><span class="t-label f11">CANCEL REQUEST</span></button></div>`;
  }
  if (mine) return `<div class="sponsorship-actions"><button class="btn-dark" type="button" data-sponsorship-action="withdraw"><span class="t-label f11">WITHDRAW $${Number(mine.amount || 0).toLocaleString()}</span></button></div>`;
  if (sponsorship.mode === "equity" && (sponsorship.contributions || []).length) {
    return `<p class="t-micro ink-3 sponsorship-investor-locked">ONE INVESTOR HAS RESERVED THIS EQUITY OFFER.</p>`;
  }
  const need = Math.max(1, Number(sponsorship.amountNeeded || 0));
  return `<form class="sponsorship-contribute" data-sponsorship-form><label class="t-label f11 g-muted" for="sponsorship-amount">${sponsorship.mode === "equity" ? "INVESTMENT AMOUNT" : "CONTRIBUTE"}</label><div class="sponsorship-contribute-row"><input class="field" id="sponsorship-amount" name="amount" type="number" min="1" max="${need}" step="1" value="${need}" inputmode="numeric"/><button class="cta-red" type="submit"><span class="cta-text cta-text-sm">${sponsorship.mode === "equity" ? "RESERVE INVESTMENT" : "RESERVE"}</span></button></div></form>`;
}

function renderSponsorshipModal(sponsorship) {
  const card = $("#sponsorship-card");
  if (!card || !sponsorship) return;
  const isBuyer = sponsorship.buyerId === localServerId();
  const mine = localContribution(sponsorship);
  const tile = TILES[Number(sponsorship.tileIndex)] || TILES[0];
  card.innerHTML = `<div class="sponsorship-body"><div class="sponsorship-head"><div><span class="t-micro g400">${sponsorship.mode === "equity" ? "EQUITY PURCHASE · ESCROWED" : "COMMUNITY FINANCE · ESCROWED"}</span><h2 class="t-section g100" id="sponsorship-card-title">${esc(tile?.name || sponsorship.tileName)}</h2></div><button class="btn-dark" type="button" id="sponsorship-close"><span class="t-label f11">CLOSE</span></button></div><div class="sponsorship-meter"><div><span class="t-micro ink-3">PURCHASE PRICE</span><strong class="t-money g100">$${Number(sponsorship.price || 0).toLocaleString()}</strong></div><div><span class="t-micro ink-3">RESERVED</span><strong class="t-money green">$${Number(sponsorship.totalContributed || 0).toLocaleString()}</strong></div><div><span class="t-micro ink-3">STILL NEEDED</span><strong class="t-money ${sponsorship.amountNeeded ? "red" : "green"}">$${Number(sponsorship.amountNeeded || 0).toLocaleString()}</strong></div></div>${sponsorship.mode === "equity" ? `<div class="sponsorship-equity-terms"><span class="t-micro ink-3">INVESTOR RENT SHARE</span><strong class="t-label f13 g100">${Number(sponsorship.sharePct || 0)}%</strong><span class="t-micro ink-3">BUYER CONTRIBUTION AT ACCEPTANCE</span><strong class="t-label f13 g100">$${Math.max(0, Number(sponsorship.price || 0) - Number(sponsorship.totalContributed || 0)).toLocaleString()}</strong></div>` : ""}<p class="t-body ink-2 sponsorship-copy">${esc(sponsorshipCopy(sponsorship, isBuyer, mine))}</p><div class="sponsorship-list"><span class="t-micro g400">${sponsorship.mode === "equity" ? "INVESTOR RESERVATION" : "RESERVATIONS"}</span>${contributionsHTML(sponsorship)}</div>${actionsHTML(sponsorship, isBuyer, mine)}</div>`;
  $("#sponsorship-close")?.addEventListener("click", closeSponsorshipModal);
}

function renderSponsorshipRequestComposer(tileIndex) {
  const card = $("#sponsorship-card");
  const tile = TILES[Number(tileIndex)] || TILES[0];
  if (!card || !tile) return;
  sponsorshipRequestDraft = { tileIndex: Number(tileIndex), requestId: null };
  card.innerHTML = `<div class="sponsorship-body"><div class="sponsorship-head"><div><span class="t-micro g400">PURCHASE FUNDING</span><h2 class="t-section g100" id="sponsorship-card-title">${esc(tile.name)}</h2></div><button class="btn-dark" type="button" id="sponsorship-close"><span class="t-label f11">CLOSE</span></button></div><p class="t-body ink-2">Purchase price <strong>$${Number(tile.price || 0).toLocaleString()}</strong>. Choose gift funding or a single investor for this deed.</p><form class="sponsorship-request-form" data-sponsorship-request-form><fieldset class="sponsorship-mode-options"><legend class="t-label f11 g-muted">FUNDING MODE</legend><label><input type="radio" name="mode" value="gift" checked><span><strong class="t-label f11 g100">GIFT</strong><small class="t-micro ink-3">No ownership or rent share.</small></span></label><label><input type="radio" name="mode" value="equity"><span><strong class="t-label f11 g100">EQUITY INVESTMENT</strong><small class="t-micro ink-3">One investor reserves cash for a passive rent share.</small></span></label></fieldset><label class="financing-field sponsorship-share-field" data-equity-share-field hidden><span class="t-label f11 g-muted">Investor share of collected rent <output id="sponsorship-share-output">10%</output></span><input class="field" type="range" name="sharePct" min="5" max="100" step="5" value="10" disabled></label><p class="t-micro ink-3">If accepted, the bank sells this exact deed to you. An investor's cash stays in escrow until settlement. The buyer pays any remaining price from available cash.</p><div class="sponsorship-actions"><button class="cta-red" type="submit"><span class="cta-text cta-text-sm">REQUEST FUNDING</span></button></div></form></div>`;
  $("#sponsorship-close")?.addEventListener("click", closeSponsorshipModal);
  card.querySelectorAll('[name="mode"]').forEach(input => input.addEventListener("change", updateSponsorshipComposer));
  card.querySelector('[name="sharePct"]')?.addEventListener("input", event => {
    const output = card.querySelector("#sponsorship-share-output");
    if (output) output.textContent = `${event.target.value}%`;
  });
}

function updateSponsorshipComposer(event) {
  const form = event.currentTarget.closest("form");
  const equity = form?.elements?.mode?.value === "equity";
  const share = form?.querySelector('[name="sharePct"]');
  const shareField = form?.querySelector("[data-equity-share-field]");
  if (share) share.disabled = !equity;
  if (shareField) shareField.hidden = !equity;
}

function sendSponsorshipAction(action, button = null) {
  const events = { accept: "accept-sponsored-purchase", decline: "decline-sponsored-purchase", withdraw: "withdraw-sponsored-purchase" };
  const event = events[action];
  if (!event) return;
  const payload = sponsorshipFlowPayload(state.sponsorship);
  const actionKey = payload.requestId || "gift-action";
  if (!sponsorshipActionGate.begin(actionKey)) return;
  if (button) button.disabled = true;
  host.emitServer(event, payload, response => {
    if (response?.success === false) {
      sponsorshipActionGate.complete(actionKey);
      if (button) button.disabled = false;
      host.say(response.error || "The sponsorship could not be updated.");
      host.renderChat();
    }
  });
}

function onSponsorshipClick(event) {
  const action = event.target.closest("[data-sponsorship-action]")?.dataset.sponsorshipAction;
  if (!action) return;
  sendSponsorshipAction(action, event.target.closest("[data-sponsorship-action]"));
}

function onSponsorshipSubmit(event) {
  const requestForm = event.target.closest("[data-sponsorship-request-form]");
  if (requestForm) {
    event.preventDefault();
    if (requestPending || !sponsorshipRequestDraft) return;
    const mode = requestForm.elements.mode.value;
    const sharePct = Number(requestForm.elements.sharePct.value) || 10;
    if (mode === "equity" && !sponsorshipRequestDraft.requestId) sponsorshipRequestDraft.requestId = newRequestId();
    const payload = sponsorshipRequestPayload(sponsorshipRequestDraft.tileIndex, mode, sharePct, sponsorshipRequestDraft.requestId);
    requestPending = true;
    const submit = requestForm.querySelector('[type="submit"]');
    if (submit) submit.disabled = true;
    host.emitServer("request-sponsored-purchase", payload, response => {
      if (response?.success === false) {
        requestPending = false;
        if (submit) submit.disabled = false;
        host.say(response.error || "Sponsorship is unavailable.");
        host.renderChat();
        return;
      }
      sponsorshipRequestDraft = null;
      closeSponsorshipModal();
    });
    return;
  }
  const form = event.target.closest("[data-sponsorship-form]");
  if (!form) return;
  event.preventDefault();
  const amount = Math.floor(Number(form.amount?.value) || 0);
  const payload = sponsorshipContributionPayload(amount, state.sponsorship);
  const actionKey = payload.requestId || "gift-action";
  if (!sponsorshipActionGate.begin(actionKey)) return;
  const submit = form.querySelector('[type="submit"]');
  if (submit) submit.disabled = true;
  host.emitServer("contribute-sponsored-purchase", payload, response => {
    if (response?.success === false) {
      sponsorshipActionGate.complete(actionKey);
      if (submit) submit.disabled = false;
      host.say(response.error || "The contribution could not be reserved.");
      host.renderChat();
    }
  });
}

export function requestSponsorship(tileIndex, trigger = null) {
  if (tileIndex == null) return;
  if (requestPending) return;
  renderSponsorshipRequestComposer(tileIndex);
  openSurface("#sponsorship-modal", "#sponsorship-close");
  if (trigger instanceof HTMLElement) setSurfaceReturnFocus(trigger);
}

export function openSponsorshipModal(sponsorship = state.sponsorship, trigger = null) {
  if (!sponsorship) return;
  renderSponsorshipModal(sponsorship);
  openSurface("#sponsorship-modal", "#sponsorship-close");
  if (trigger instanceof HTMLElement) setSurfaceReturnFocus(trigger);
}

export function closeSponsorshipModal() {
  closeSurface("#sponsorship-modal");
}

export function onSponsorshipUpdate(sponsorship) {
  requestPending = false;
  sponsorshipActionGate.clear();
  state.sponsorship = sponsorship || null;
  if (!sponsorship) {
    closeSponsorshipModal();
    return;
  }
  const modal = $("#sponsorship-modal");
  if (modal?.classList.contains("is-hidden")) openSponsorshipModal(sponsorship);
  else renderSponsorshipModal(sponsorship);
}

export function bindSponsorshipUi() {
  $("#sponsorship-card")?.addEventListener("click", onSponsorshipClick);
  $("#sponsorship-card")?.addEventListener("submit", onSponsorshipSubmit);
  $("#sponsorship-scrim")?.addEventListener("click", closeSponsorshipModal);
}
