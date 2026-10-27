/* ============================================================
   SPONSORED PURCHASE SURFACE: a small, escrow-aware contribution flow for
   an open bank purchase. It never moves a player out of the current lobby or
   game surface; the server owns every reservation and forced purchase.
   ============================================================ */
import { $, esc } from "./clientDom.js";
import { formatMoney } from "./clientMoney.js";
import { spriteHTML } from "./clientSprites.js";
import { state } from "./clientState.js";
import { playerFinanceEnabled, rentShareDisclosure } from "./clientFinanceRules.js";
import { TILES } from "./clientBoardData.js";
import { closeSurface, openSurface, setSurfaceReturnFocus } from "./clientSurfaces.js";

let host = { emitServer: noop, say: noop, recordActivity: noop, captureActionStatusNode: () => null, announceActionStatus: noop, renderChat: noop, createRequestId: null };
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

export function sponsorshipRequestPayload(tileIndex, mode = "gift", sharePct = 10, id = newRequestId(), durationRounds = 3) {
  if (mode !== "equity") return { tileIndex: Number(tileIndex) };
  return { tileIndex: Number(tileIndex), mode: "equity", sharePct: Math.max(5, Math.min(100, Math.floor(Number(sharePct) || 10))), requestId: id, durationRounds: Math.max(1, Math.min(20, Math.floor(Number(durationRounds) || 3))) };
}

export function sponsorshipFlowPayload(sponsorship) {
  return sponsorship?.mode === "equity" && sponsorship.requestId ? { requestId: sponsorship.requestId } : {};
}

export function sponsorshipContributionPayload(amount, sponsorship, contributionId = null) {
  return {
    amount: Math.floor(Number(amount) || 0),
    ...sponsorshipFlowPayload(sponsorship),
    ...(contributionId ? { contributionId } : {}),
  };
}

// One id per contribution attempt: a resend of the same attempt (same
// sponsorship, same amount, no confirmed reply yet) reuses it so the server
// replays instead of reserving twice; a confirmed contribution clears it so the
// next top-up gets a fresh id.
export function createContributionAttemptTracker(makeId) {
  let attempt = null;
  return {
    idFor(sponsorship, amount) {
      const scope = `${sponsorship?.id ?? sponsorship?.requestId ?? ""}:${amount}`;
      if (!attempt || attempt.scope !== scope) attempt = { scope, id: makeId() };
      return attempt.id;
    },
    settle() { attempt = null; },
  };
}
const contributionAttempts = createContributionAttemptTracker(() => newRequestId());

function localServerId() {
  return state.players[0]?.serverId || null;
}

export function sponsorshipAudienceNames(players = state.players, buyerId = localServerId()) {
  const recipientId = buyerId == null ? null : String(buyerId);
  return (Array.isArray(players) ? players : [])
    .filter(player => player
      && String(player.serverId || player.id || "") !== recipientId
      && !player.bankrupt
      && player.online !== false
      && !player.disconnected
      && !player.spectating)
    .map(player => String(player.name || player.nickname || player.displayName || "").trim())
    .filter(Boolean);
}

export function sponsorshipFundingSummary(mode, sharePct = 10, durationRounds = 3) {
  if (mode !== "equity") return "GIFT FUNDING · NO OWNERSHIP OR RENT SHARE";
  const share = Math.max(5, Math.min(100, Math.floor(Number(sharePct) || 10)));
  return `RENT SHARE · ${share}% OF COLLECTED RENT · ${Math.max(1, Math.min(20, Math.floor(Number(durationRounds) || 3)))} ROUNDS`;
}

function sponsorshipFundingTypeHTML(sponsorship) {
  const equity = sponsorship.mode === "equity";
  const detail = equity ? "ONE INVESTOR · BUYER COVERS ANY REMAINDER" : "CONTRIBUTIONS STAY IN ESCROW UNTIL SETTLEMENT";
  return `<div class="sponsorship-funding-type${equity ? " is-equity" : " is-gift"}"><span class="t-micro ink-3">FUNDING TYPE</span><strong class="t-label f12 g100">${esc(sponsorshipFundingSummary(sponsorship.mode, sponsorship.sharePct, sponsorship.durationRounds))}</strong><span class="t-micro ink-3">${detail}</span></div>`;
}

function localContribution(sponsorship) {
  return sponsorship?.contributions?.find(entry => entry.sponsorId === localServerId()) || null;
}

function sponsorshipCopy(sponsorship, isBuyer, mine) {
  if (sponsorship.mode === "equity") {
    if (isBuyer) return `Accept to buy now. You pay the remaining $${Math.max(0, Number(sponsorship.price || 0) - Number(sponsorship.totalContributed || 0)).toLocaleString()}.`;
    if (mine) return `Your $${Number(mine.amount || 0).toLocaleString()} stays in escrow until acceptance or cancellation.`;
    return `Reserve cash to fund ${sponsorship.buyerName}'s purchase.`;
  }
  if (isBuyer) return `Sponsors have reserved $${Number(sponsorship.totalContributed || 0).toLocaleString()} of the $${Number(sponsorship.price || 0).toLocaleString()} purchase. Accepting immediately buys ${sponsorship.tileName}.`;
  if (mine) return `Your $${Number(mine.amount || 0).toLocaleString()} is reserved until the buyer accepts or cancels.`;
  return `${sponsorship.buyerName} needs $${Number(sponsorship.amountNeeded || 0).toLocaleString()} more to buy ${sponsorship.tileName}. Contributions are gifts tied to this purchase.`;
}

function contributionsHTML(sponsorship) {
  const rows = (sponsorship.contributions || []).map(entry => `<div class="sponsorship-row"><span class="t-label f11 g100">${esc(entry.sponsorName)}</span><strong class="t-label f12 green">$${Number(entry.amount || 0).toLocaleString()}</strong></div>`).join("");
  return rows || `<p class="t-micro ink-3">NO CONTRIBUTIONS YET.</p>`;
}

function buyerCanAcceptEquity(sponsorship, buyerContribution, localCash) {
  return sponsorship.mode === "equity" && buyerContribution <= localCash;
}

function buyerCanAcceptGift(sponsorship) {
  return Number(sponsorship.totalContributed || 0) > 0 && Number(sponsorship.amountNeeded || 0) <= 0;
}

function buyerActionsHTML(sponsorship) {
  const buyerContribution = Math.max(0, Number(sponsorship.price || 0) - Number(sponsorship.totalContributed || 0));
  const localCash = Number(state.players[0]?.cash || 0);
  const enabled = playerFinanceEnabled(state.settings) && (buyerCanAcceptEquity(sponsorship, buyerContribution, localCash) || buyerCanAcceptGift(sponsorship));
  return `<div class="sponsorship-actions"><button class="btn-dark" type="button" data-sponsorship-action="decline"><span class="t-label f11">CANCEL REQUEST</span></button><button class="cta-red" type="button" data-sponsorship-action="accept" ${enabled ? "" : "disabled"}><span class="cta-text cta-text-sm">ACCEPT &amp; BUY</span></button></div>`;
}

function contributorWithdrawalHTML(mine) {
  return `<div class="sponsorship-actions"><button class="btn-dark" type="button" data-sponsorship-action="withdraw"><span class="t-label f11">WITHDRAW ${formatMoney(mine.amount)}</span></button></div>`;
}

function investorReservationLocked(sponsorship) {
  return sponsorship.mode === "equity" && (sponsorship.contributions || []).length > 0;
}

function contributionFormHTML(sponsorship) {
  const need = Math.max(1, Number(sponsorship.amountNeeded || 0));
  return `<form class="sponsorship-contribute" data-sponsorship-form><label class="t-label f11 g-muted" for="sponsorship-amount">${sponsorship.mode === "equity" ? "INVESTMENT AMOUNT" : "CONTRIBUTE"}</label><div class="sponsorship-contribute-row"><input class="field" id="sponsorship-amount" name="amount" type="number" min="1" max="${need}" step="1" value="${need}" inputmode="numeric"/><button class="cta-red" type="submit"><span class="cta-text cta-text-sm">${sponsorship.mode === "equity" ? "RESERVE INVESTMENT" : "RESERVE"}</span></button></div></form>`;
}

function actionsHTML(sponsorship, isBuyer, mine) {
  if (!playerFinanceEnabled(state.settings)) return '<p class="t-micro ink-3">Enable Player Finance in the lobby to request new funding.</p>' + (mine ? contributorWithdrawalHTML(mine) : (isBuyer ? buyerActionsHTML(sponsorship) : ""));
  if (isBuyer) return buyerActionsHTML(sponsorship);
  if (mine) return contributorWithdrawalHTML(mine);
  if (investorReservationLocked(sponsorship)) return `<p class="t-micro ink-3 sponsorship-investor-locked">ONE INVESTOR HAS RESERVED THIS RENT SHARE OFFER.</p>`;
  return contributionFormHTML(sponsorship);
}

function renderSponsorshipModal(sponsorship) {
  const card = $("#sponsorship-card");
  if (!card || !sponsorship) return;
  const isBuyer = sponsorship.buyerId === localServerId();
  const mine = localContribution(sponsorship);
  const tile = TILES[Number(sponsorship.tileIndex)] || TILES[0];
  const reservedPct = Math.max(0, Math.min(100, Math.round((Number(sponsorship.totalContributed || 0) / Math.max(1, Number(sponsorship.price || 0))) * 100)));
  card.innerHTML = `<div class="slip-rail slip-rail-gold"></div><div class="sponsorship-body"><div class="sponsorship-head"><div class="slip-head"><span class="slip-icon" aria-hidden="true">${spriteHTML("chest", 5)}</span><div><span class="t-micro g400">${sponsorship.mode === "equity" ? "RENT SHARE PURCHASE · ESCROWED" : "COMMUNITY FINANCE · ESCROWED"}</span><h2 class="t-section g100" id="sponsorship-card-title">${esc(tile?.name || sponsorship.tileName)}</h2></div></div><button class="btn-dark" type="button" id="sponsorship-close"><span class="t-label f11">CLOSE</span></button></div><div class="sponsorship-bar" role="img" aria-label="${reservedPct}% of the price reserved" style="--fill:${reservedPct}%"><span></span></div><div class="sponsorship-meter"><div><span class="t-micro ink-3">PURCHASE PRICE</span><strong class="t-money g100">$${Number(sponsorship.price || 0).toLocaleString()}</strong></div><div><span class="t-micro ink-3">RESERVED</span><strong class="t-money green">$${Number(sponsorship.totalContributed || 0).toLocaleString()}</strong></div><div><span class="t-micro ink-3">STILL NEEDED</span><strong class="t-money ${sponsorship.amountNeeded ? "red" : "green"}">$${Number(sponsorship.amountNeeded || 0).toLocaleString()}</strong></div></div>${sponsorship.mode === "equity" ? `<div class="sponsorship-equity-terms"><span class="t-micro ink-3">INVESTOR RENT SHARE</span><strong class="t-label f13 g100">${Number(sponsorship.sharePct || 0)}%</strong><span class="t-micro ink-3">BUYER CONTRIBUTION AT ACCEPTANCE</span><strong class="t-label f13 g100">$${Math.max(0, Number(sponsorship.price || 0) - Number(sponsorship.totalContributed || 0)).toLocaleString()}</strong></div>` : ""}<p class="t-body ink-2 sponsorship-copy">${esc(sponsorshipCopy(sponsorship, isBuyer, mine))}</p>${sponsorship.mode === "equity" ? `<p class="t-micro ink-3">${esc(rentShareDisclosure(sponsorship))}</p>` : ""}<div class="sponsorship-list"><span class="t-micro g400">${sponsorship.mode === "equity" ? "INVESTOR RESERVATION" : "RESERVATIONS"}</span>${contributionsHTML(sponsorship)}</div>${actionsHTML(sponsorship, isBuyer, mine)}</div>`;
  card.querySelector(".sponsorship-head")?.insertAdjacentHTML("afterend", sponsorshipFundingTypeHTML(sponsorship));
  $("#sponsorship-close")?.addEventListener("click", closeSponsorshipModal);
}

function renderSponsorshipRequestComposer(tileIndex) {
  const card = $("#sponsorship-card");
  const tile = TILES[Number(tileIndex)] || TILES[0];
  if (!card || !tile) return;
  sponsorshipRequestDraft = { tileIndex: Number(tileIndex), requestId: null };
  card.innerHTML = `<div class="slip-rail slip-rail-gold"></div><div class="sponsorship-body"><div class="sponsorship-head"><div class="slip-head"><span class="slip-icon" aria-hidden="true">${spriteHTML("chest", 5)}</span><div><span class="t-micro g400">PURCHASE FUNDING</span><h2 class="t-section g100" id="sponsorship-card-title">${esc(tile.name)}</h2></div></div><button class="btn-dark" type="button" id="sponsorship-close"><span class="t-label f11">CLOSE</span></button></div><p class="t-body ink-2">Price <strong>$${Number(tile.price || 0).toLocaleString()}</strong>. Ask the table to chip in.</p><form class="sponsorship-request-form" data-sponsorship-request-form><fieldset class="sponsorship-mode-options"><legend class="t-label f11 g-muted">FUNDING MODE</legend><label><input type="radio" name="mode" value="gift" checked><span><strong class="t-label f11 g100">GIFT</strong><small class="t-micro ink-3">No ownership or rent share.</small></span></label><label><input type="radio" name="mode" value="equity"><span><strong class="t-label f11 g100">RENT SHARE</strong><small class="t-micro ink-3">One investor reserves cash for a passive rent share.</small></span></label></fieldset><label class="financing-field sponsorship-share-field" data-equity-share-field hidden><span class="t-label f11 g-muted">Investor share of collected rent <output id="sponsorship-share-output">10%</output></span><input class="field" type="range" name="sharePct" min="5" max="100" step="5" value="10" disabled></label><label class="financing-field sponsorship-share-field" data-equity-duration-field hidden><span class="t-label f11 g-muted">Duration in rounds</span><input class="field" name="durationRounds" type="number" min="1" max="20" step="1" value="3" disabled></label><p class="t-micro ink-3" data-sponsorship-rent-terms hidden>${esc(rentShareDisclosure())}</p><p class="t-micro ink-3">Cash stays in escrow until you accept. You pay any remainder.</p><div class="sponsorship-actions"><button class="cta-red" type="submit"><span class="cta-text cta-text-sm">REQUEST FUNDING</span></button></div></form></div>`;
  card.querySelector('[name="durationRounds"]')?.addEventListener("input", event => updateSponsorshipModePreview(event.currentTarget.closest("form")));
  const requestForm = card.querySelector(".sponsorship-request-form");
  requestForm?.insertAdjacentHTML("afterbegin", `<div class="sponsorship-mode-preview" aria-live="polite"><span class="t-micro ink-3">FUNDING SUMMARY</span><strong class="t-label f12 g100" data-sponsorship-mode-summary>${esc(sponsorshipFundingSummary("gift"))}</strong></div>`);
  $("#sponsorship-close")?.addEventListener("click", closeSponsorshipModal);
  card.querySelectorAll('[name="mode"]').forEach(input => input.addEventListener("change", updateSponsorshipComposer));
  card.querySelector('[name="sharePct"]')?.addEventListener("input", event => {
    const output = card.querySelector("#sponsorship-share-output");
    if (output) output.textContent = `${event.target.value}%`;
    updateSponsorshipModePreview(event.currentTarget.closest("form"));
  });
}

function updateSponsorshipComposer(event) {
  const form = event.currentTarget.closest("form");
  const equity = form?.elements?.mode?.value === "equity";
  const share = form?.querySelector('[name="sharePct"]');
  const shareField = form?.querySelector("[data-equity-share-field]");
  if (share) share.disabled = !equity;
  if (shareField) shareField.hidden = !equity;
  const duration = form?.querySelector('[name="durationRounds"]');
  if (duration) duration.disabled = !equity;
  const durationField = form?.querySelector("[data-equity-duration-field]");
  if (durationField) durationField.hidden = !equity;
  const terms = form?.querySelector("[data-sponsorship-rent-terms]");
  if (terms) terms.hidden = !equity;
  updateSponsorshipModePreview(form);
}

function updateSponsorshipModePreview(form) {
  const preview = form?.querySelector("[data-sponsorship-mode-summary]");
  if (!preview) return;
  preview.textContent = sponsorshipFundingSummary(form.elements.mode?.value, form.elements.sharePct?.value, form.elements.durationRounds?.value);
  const terms = form.querySelector("[data-sponsorship-rent-terms]");
  if (terms) terms.textContent = rentShareDisclosure({ durationRounds: form.elements.durationRounds?.value });
}

function handleSponsorshipActionResponse(response, actionKey, button, statusNode) {
  if (response?.success !== false) return;
  sponsorshipActionGate.complete(actionKey);
  if (button) button.disabled = false;
  host.announceActionStatus(response.error || "The sponsorship could not be updated.", statusNode);
}

function sendSponsorshipAction(action, button = null) {
  const events = { accept: "accept-sponsored-purchase", decline: "decline-sponsored-purchase", withdraw: "withdraw-sponsored-purchase" };
  const eventName = events[action];
  if (!eventName || (action === "accept" && !playerFinanceEnabled(state.settings))) return;
  const payload = sponsorshipFlowPayload(state.sponsorship);
  const actionKey = payload.requestId || "gift-action";
  if (!sponsorshipActionGate.begin(actionKey)) return;
  const statusNode = host.captureActionStatusNode(button || document.activeElement);
  if (button) button.disabled = true;
  host.emitServer(eventName, payload, response => handleSponsorshipActionResponse(response, actionKey, button, statusNode));
}

function onSponsorshipClick(event) {
  const action = event.target.closest("[data-sponsorship-action]")?.dataset.sponsorshipAction;
  if (!action) return;
  sendSponsorshipAction(action, event.target.closest("[data-sponsorship-action]"));
}

function handleSponsorshipRequestResponse(response, submit, statusNode) {
  if (response?.success === false) {
    requestPending = false;
    if (submit) submit.disabled = false;
    host.announceActionStatus(response.error || "Sponsorship is unavailable.", statusNode);
    return;
  }
  sponsorshipRequestDraft = null;
  closeSponsorshipModal();
}

function submitSponsorshipRequest(event, requestForm) {
  event.preventDefault();
  if (requestPending || !playerFinanceEnabled(state.settings)) return;
  if (!sponsorshipRequestDraft) return;
  const mode = requestForm.elements.mode.value;
  const sharePct = Number(requestForm.elements.sharePct.value) || 10;
  if (mode === "equity" && !sponsorshipRequestDraft.requestId) sponsorshipRequestDraft.requestId = newRequestId();
  const payload = sponsorshipRequestPayload(sponsorshipRequestDraft.tileIndex, mode, sharePct, sponsorshipRequestDraft.requestId, requestForm.elements.durationRounds?.value);
  requestPending = true;
  const submit = requestForm.querySelector('[type="submit"]');
  if (submit) submit.disabled = true;
  const statusNode = host.captureActionStatusNode(submit || requestForm);
  host.emitServer("request-sponsored-purchase", payload, response => handleSponsorshipRequestResponse(response, submit, statusNode));
}

function handleContributionResponse(response, actionKey, submit, statusNode) {
  if (response?.success === true) contributionAttempts.settle();
  if (response?.success !== false) return;
  sponsorshipActionGate.complete(actionKey);
  if (submit) submit.disabled = false;
  host.announceActionStatus(response.error || "The contribution could not be reserved.", statusNode);
}

function submitSponsorshipContribution(event, form) {
  event.preventDefault();
  if (!playerFinanceEnabled(state.settings)) return;
  const amount = Math.floor(Number(form.amount?.value) || 0);
  const payload = sponsorshipContributionPayload(amount, state.sponsorship, contributionAttempts.idFor(state.sponsorship, amount));
  const actionKey = payload.requestId || "gift-action";
  if (!sponsorshipActionGate.begin(actionKey)) return;
  const submit = form.querySelector('[type="submit"]');
  if (submit) submit.disabled = true;
  const statusNode = host.captureActionStatusNode(submit || form);
  host.emitServer("contribute-sponsored-purchase", payload, response => handleContributionResponse(response, actionKey, submit, statusNode));
}

function onSponsorshipSubmit(event) {
  const requestForm = event.target.closest("[data-sponsorship-request-form]");
  if (requestForm) return submitSponsorshipRequest(event, requestForm);
  const form = event.target.closest("[data-sponsorship-form]");
  if (!form) return;
  submitSponsorshipContribution(event, form);
}

export function requestSponsorship(tileIndex, trigger = null) {
  if (tileIndex == null || !playerFinanceEnabled(state.settings)) return;
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
