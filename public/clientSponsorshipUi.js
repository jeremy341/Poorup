/* ============================================================
   SPONSORED PURCHASE SURFACE: a small, escrow-aware contribution flow for
   an open bank purchase. It never moves a player out of the current lobby or
   game surface; the server owns every reservation and forced purchase.
   ============================================================ */
import { $, esc } from "./clientDom.js";
import { state } from "./clientState.js";
import { TILES } from "./clientBoardData.js";
import { closeSurface, openSurface, setSurfaceReturnFocus } from "./clientSurfaces.js";

let host = { emitServer: noop, say: noop, renderChat: noop };
function noop() {}

export function configureSponsorshipUi(hooks) {
  host = { ...host, ...hooks };
}

function localServerId() {
  return state.players[0]?.serverId || null;
}

function localContribution(sponsorship) {
  return sponsorship?.contributions?.find(entry => entry.sponsorId === localServerId()) || null;
}

function sponsorshipCopy(sponsorship, isBuyer, mine) {
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
    const enabled = Number(sponsorship.totalContributed || 0) > 0 && Number(sponsorship.amountNeeded || 0) <= 0;
    return `<div class="sponsorship-actions"><button class="cta-red" type="button" data-sponsorship-action="accept" ${enabled ? "" : "disabled"}><span class="cta-text cta-text-sm">ACCEPT &amp; BUY</span></button><button class="btn-dark" type="button" data-sponsorship-action="decline"><span class="t-label f11">CANCEL REQUEST</span></button></div>`;
  }
  if (mine) return `<div class="sponsorship-actions"><button class="btn-dark" type="button" data-sponsorship-action="withdraw"><span class="t-label f11">WITHDRAW $${Number(mine.amount || 0).toLocaleString()}</span></button></div>`;
  const need = Math.max(1, Number(sponsorship.amountNeeded || 0));
  return `<form class="sponsorship-contribute" data-sponsorship-form><label class="t-label f11 g-muted" for="sponsorship-amount">CONTRIBUTE</label><div class="sponsorship-contribute-row"><input class="field" id="sponsorship-amount" name="amount" type="number" min="1" max="${need}" step="1" value="${need}" inputmode="numeric"/><button class="cta-red" type="submit"><span class="cta-text cta-text-sm">RESERVE</span></button></div></form>`;
}

function renderSponsorshipModal(sponsorship) {
  const card = $("#sponsorship-card");
  if (!card || !sponsorship) return;
  const isBuyer = sponsorship.buyerId === localServerId();
  const mine = localContribution(sponsorship);
  const tile = TILES[Number(sponsorship.tileIndex)] || TILES[0];
  card.innerHTML = `<div class="sponsorship-body"><div class="sponsorship-head"><div><span class="t-micro g400">COMMUNITY FINANCE · ESCROWED</span><h2 class="t-section g100" id="sponsorship-card-title">${esc(tile?.name || sponsorship.tileName)}</h2></div><button class="btn-dark" type="button" id="sponsorship-close"><span class="t-label f11">CLOSE</span></button></div><div class="sponsorship-meter"><div><span class="t-micro ink-3">PURCHASE PRICE</span><strong class="t-money g100">$${Number(sponsorship.price || 0).toLocaleString()}</strong></div><div><span class="t-micro ink-3">RESERVED</span><strong class="t-money green">$${Number(sponsorship.totalContributed || 0).toLocaleString()}</strong></div><div><span class="t-micro ink-3">STILL NEEDED</span><strong class="t-money ${sponsorship.amountNeeded ? "red" : "green"}">$${Number(sponsorship.amountNeeded || 0).toLocaleString()}</strong></div></div><p class="t-body ink-2 sponsorship-copy">${esc(sponsorshipCopy(sponsorship, isBuyer, mine))}</p><div class="sponsorship-list"><span class="t-micro g400">RESERVATIONS</span>${contributionsHTML(sponsorship)}</div>${actionsHTML(sponsorship, isBuyer, mine)}</div>`;
  $("#sponsorship-close")?.addEventListener("click", closeSponsorshipModal);
}

function sendSponsorshipAction(action, payload = {}) {
  const events = { accept: "accept-sponsored-purchase", decline: "decline-sponsored-purchase", withdraw: "withdraw-sponsored-purchase" };
  const event = events[action];
  if (!event) return;
  host.emitServer(event, payload, response => {
    if (response?.success === false) {
      host.say(response.error || "The sponsorship could not be updated.");
      host.renderChat();
    }
  });
}

function onSponsorshipClick(event) {
  const action = event.target.closest("[data-sponsorship-action]")?.dataset.sponsorshipAction;
  if (!action) return;
  sendSponsorshipAction(action);
}

function onSponsorshipSubmit(event) {
  const form = event.target.closest("[data-sponsorship-form]");
  if (!form) return;
  event.preventDefault();
  const amount = Math.floor(Number(form.amount?.value) || 0);
  host.emitServer("contribute-sponsored-purchase", { amount }, response => {
    if (response?.success === false) {
      host.say(response.error || "The contribution could not be reserved.");
      host.renderChat();
    }
  });
}

export function requestSponsorship(tileIndex, trigger = null) {
  if (tileIndex == null) return;
  host.emitServer("request-sponsored-purchase", { tileIndex: Number(tileIndex) }, response => {
    if (response?.success === false) {
      host.say(response.error || "Sponsorship is unavailable.");
      host.renderChat();
      return;
    }
    if (trigger instanceof HTMLElement) setSurfaceReturnFocus(trigger);
  });
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
