/* ============================================================
   GAME MODAL SURFACES: the forced-buy choice card, the bot trade
   offer inbox, the bankruptcy / voluntary-exit / round-over cards,
   and the Chance/Chest card reveal + gallery (plus the ?preview=
   design hook). emitServer, say, renderChat, renderAll, buyTile
   and startGame are injected by the entry module; markup and
   socket payloads are the exact old main.js templates.
   ============================================================ */
import { $, esc } from "./clientDom.js";
import { closeButtonHTML } from "./clientCloseButton.js";
import { state } from "./clientState.js";
import { playerFinanceEnabled } from "./clientFinanceRules.js";
import { TILES, CHANCE_EVENTS, CHEST_EVENTS } from "./clientBoardData.js";
import { cardFaceHTML } from "./clientCardsRender.js";
import { closeSurface, focusSurface, openConfirmModal, openSurface, syncSurfaceA11y } from "./clientSurfaces.js";
import { emitIntent } from "./clientRequestController.js";
import { accentOf, kindLabel, popIconHTML, popRow } from "./clientPopupUi.js";
import { startAuction } from "./clientAuctionUi.js";
import { goHome } from "./clientLobbyUi.js";
import { dismissTradeOffer, isTradeOfferDismissed } from "./clientTradeOfferDismissal.js";
import { tradeReviewSideHTML } from "./clientTradeUi.js";
import { rankGameOverPlayers, gameOverScore, gameOverPlayerStatus } from "./clientGameResults.js";

let host = {
  emitServer: noop,
  say: noop,
  renderChat: noop,
  renderAll: noop,
  buyTile: noop,
  openHoldings: noop,
  openTradeForDebt: noop,
  openFinancingForDebt: noop,
  openTradeNegotiation: noop,
  openSponsorshipRequest: noop,
  startGame: noop,
  captureActionStatusNode: () => null,
  announceActionStatus: noop,
  recordActivity: noop,
};
let activeOffer = null;
let inlineChoiceTile = null;

function noop() {}

export function configureGameModals(hooks) {
  host = { ...host, ...hooks };
}

/** Human landed on a vacant lot: auto-show choice modal.
 *  - Auction mode: locked, BUY or AUCTION only.
 *  - Normal mode: dismissible, BUY or PASS.
 */
function openChoiceModal(tile) {
  const me = state.players[0];
  const price = tile.price ?? 0;
  const canAfford = me.cash >= price;
  const auctionMode = state.settings.auction;

  $("#choice-card").innerHTML = `
    <div class="pop-rail" style="background:${accentOf(tile)}"></div>
    <div class="choice-body">
      <div class="choice-head">
        <div class="choice-icon">${popIconHTML(tile)}</div>
        <div class="pop-headtext">
          <div class="t-micro g400">${kindLabel(tile)}</div>
          <h3 class="t-section choice-title" id="choice-card-title">${tile.name}</h3>
        </div>
        <button class="btn-dark choice-dismiss" id="choice-dismiss" type="button" aria-label="Close choice; the decision stays pending"><span class="t-label f11">X</span></button>
      </div>
      <p class="t-body ink-2 choice-copy">${auctionMode ? "You landed on an unowned lot. Buy it at the listed price, or send it to auction." : "You landed on an unowned lot. Buy it or pass."}</p>
      <div class="choice-rows">
        ${popRow("PRICE", `$${price}`, "g300")}
        ${popRow("YOUR CASH", `$${me.cash.toLocaleString()}`, canAfford ? "green" : "red")}
      </div>
      <div class="choice-actions">
        ${auctionMode
          ? `<button class="btn-dark choice-btn" id="choice-auction">
              <span class="t-label">AUCTION</span>
              <span class="t-micro">OPEN BIDDING</span>
            </button>`
          : `<button class="btn-dark choice-btn" id="choice-pass">
              <span class="t-label">PASS</span>
              <span class="t-micro">DECLINE</span>
            </button>${tile.canSeekSponsorship && playerFinanceEnabled(state.settings) ? `<button class="btn-dark choice-btn" id="choice-sponsor"><span class="t-label">PURCHASE FUNDING</span><span class="t-micro">GIFT OR RENT SHARE</span></button>` : ""}`
        }
      </div>
      <p class="t-micro ink-3 choice-note">${auctionMode ? (canAfford ? "YOU MUST CHOOSE ONE TO CONTINUE" : "TOO POOR TO BUY · MUST AUCTION") : "Close this card to revisit the choice; PASS is the explicit decline."}</p>
    </div>`;

  openSurface("#choice-modal", "#choice-buy");
  const scrim = $("#choice-scrim");
  if (scrim) {
    scrim.classList.toggle("popup-scrim-locked", auctionMode);
    // Even a locked auction choice can be intentionally dismissed after the
    // shared controller confirms that the required decision remains pending.
    scrim.onclick = closeChoiceModalWithoutAction;
  }
  $("#choice-dismiss").addEventListener("click", closeChoiceModalWithoutAction);
  const buyBtn = $("#choice-buy");
  if (buyBtn) buyBtn.addEventListener("click", event => {
    const statusNode = host.captureActionStatusNode(event.currentTarget);
    host.buyTile(tile, statusNode, () => {
      state.pendingBuyTile = null;
      closeSurface("#choice-modal");
      afterLandingResolved();
    });
  });

  if (auctionMode) {
    $("#choice-auction").addEventListener("click", event => {
      state.pendingBuyTile = null;
      closeSurface("#choice-modal");
      startAuction(tile, event.currentTarget, () => {
        state.pendingBuyTile = tile.i;
        openChoiceModal(tile);
        return host.captureActionStatusNode($("#choice-buy"));
      });
    });
  } else {
    $("#choice-pass").addEventListener("click", closeChoiceModalAsPass);
    $("#choice-sponsor")?.addEventListener("click", () => {
      const tileIndex = state.pendingBuyTile;
      closeSurface("#choice-modal");
      host.openSponsorshipRequest(tileIndex);
    });
  }
}

/* ---- inline purchase choice -------------------------------------------
   Live play resolves a vacant-lot landing from a button row in the board
   centre (BUY | AUCTION or PASS) instead of a dimming modal. The modal
   above stays for the design-capture fixtures. */
function pendingChoiceTile() {
  if (state.pendingBuyTile == null) return null;
  if (inlineChoiceTile?.i === state.pendingBuyTile) return inlineChoiceTile;
  return TILES[state.pendingBuyTile] || null;
}

export function presentPurchaseChoice(tile) {
  inlineChoiceTile = tile;
  host.renderAll();
  $("#hud-choice-buy")?.focus({ preventScroll: true });
}

function choiceRowHTML(tile) {
  const me = state.players[0];
  const price = tile.price ?? 0;
  const canAfford = Number(me?.cash ?? 0) >= price;
  const auctionMode = Boolean(state.settings?.auction);
  const buy = `<button class="cta-red hud-choice-btn" id="hud-choice-buy" type="button" data-choice="buy" ${canAfford ? "" : "disabled"}><span class="t-label">BUY $${price.toLocaleString()}</span></button>`;
  const second = auctionMode
    ? '<button class="btn-dark hud-choice-btn" id="hud-choice-auction" type="button" data-choice="auction"><span class="t-label">AUCTION</span></button>'
    : '<button class="btn-dark hud-choice-btn" id="hud-choice-pass" type="button" data-choice="pass"><span class="t-label">PASS</span></button>';
  const sponsor = !auctionMode && tile.canSeekSponsorship && playerFinanceEnabled(state.settings)
    ? '<button class="btn-dark hud-choice-btn" id="hud-choice-sponsor" type="button" data-choice="sponsor"><span class="t-label">FUNDING</span></button>'
    : "";
  const label = `<p class="hud-choice-title t-label">${esc(tile.name)}${canAfford || !auctionMode ? "" : " · TOO POOR TO BUY"}</p>`;
  return label + '<div class="hud-choice-buttons">' + buy + second + sponsor + '</div>';
}

function settleInlineChoice() {
  state.pendingBuyTile = null;
  inlineChoiceTile = null;
  closeSurface("#choice-modal");
  renderInlineChoice();
  afterLandingResolved();
}

function onInlineChoiceClick(event) {
  const button = event.target.closest("[data-choice]");
  const tile = pendingChoiceTile();
  if (!button || !tile || button.disabled) return;
  const kind = button.dataset.choice;
  if (kind === "buy") {
    const statusNode = host.captureActionStatusNode(button);
    host.buyTile(tile, statusNode, settleInlineChoice);
  } else if (kind === "auction") {
    state.pendingBuyTile = null;
    renderInlineChoice();
    startAuction(tile, button, () => {
      state.pendingBuyTile = tile.i;
      presentPurchaseChoice(tile);
      return host.captureActionStatusNode($("#hud-choice-buy"));
    });
  } else if (kind === "pass") {
    closeChoiceModalAsPass();
  } else if (kind === "sponsor") {
    host.openSponsorshipRequest(state.pendingBuyTile);
  }
}

let renderedChoiceSignature = "";
let choiceRowBound = false;

export function renderInlineChoice() {
  const row = $("#hud-choice-row");
  const roll = $("#roll-btn");
  if (!row) return;
  const tile = pendingChoiceTile();
  const show = Boolean(tile) && state.phase === "playing" && !state.auction && !state.sponsorship;
  row.hidden = !show;
  if (roll) roll.hidden = show;
  if (!choiceRowBound) {
    choiceRowBound = true;
    row.addEventListener("click", onInlineChoiceClick);
  }
  if (!show) { renderedChoiceSignature = ""; return; }
  const me = state.players[0];
  const signature = [tile.i, tile.price, Number(me?.cash ?? 0) >= (tile.price ?? 0), state.settings?.auction, tile.canSeekSponsorship].join("|");
  if (signature === renderedChoiceSignature) return;
  renderedChoiceSignature = signature;
  row.innerHTML = choiceRowHTML(tile);
}

/** After a buy/auction decision the human's turn continues normally. */
function afterLandingResolved() {
  host.renderAll();
}

function closeChoiceModalAsPass() {
  if (state.settings.auction) return;
  const statusNode = host.captureActionStatusNode(document.activeElement);
  const tile = state.pendingBuyTile != null ? TILES[state.pendingBuyTile] : null;
  if (tile) {
    // One PASS per intent: a double click / Enter repeat must not send a second
    // decline whose failure would reopen a card for an already-resolved deed.
    emitIntent(host.emitServer, `decline-property:${tile.i}`, "decline-property", { tileIndex: tile.i }, {
      onResponse: (response) => {
        if (response?.success === false) {
          // Only reopen while the purchase is still genuinely pending.
          if (state.pendingBuyTile !== tile.i) return;
          presentPurchaseChoice(tile);
          host.announceActionStatus(response.error || "The deed could not be declined.", host.captureActionStatusNode($("#choice-pass") || document.activeElement) || statusNode);
          return;
        }
        state.pendingBuyTile = null;
        inlineChoiceTile = null;
        closeSurface("#choice-modal");
        afterLandingResolved();
      },
      onTimeout: () => host.announceActionStatus("The pass could not be confirmed. Try again.", statusNode),
    });
    return;
  }
  state.pendingBuyTile = null;
  closeSurface("#choice-modal");
  afterLandingResolved();
}

function closeChoiceModalWithoutAction() {
  // Dismissal is intentionally neutral: leave the pending purchase in place
  // so only the explicit PASS control can decline the deed.
  closeSurface("#choice-modal");
}

function acceptTradeOffer(offer) {
  const button = $("#offer-accept");
  const statusNode = host.captureActionStatusNode(button);
  button.disabled = true;
  button.querySelector(".cta-text")?.replaceChildren(document.createTextNode("PROCESSING…"));
  $("#offer-counter").disabled = true;
  $("#offer-decline").disabled = true;
  state.offers = (state.offers || []).filter((x) => x?.id !== offer.id);
  emitIntent(host.emitServer, `respond-trade:${offer.id}`, "respond-trade", { tradeId: offer.id, accept: true }, {
    onResponse: (response) => {
      if (response?.success === false) {
        state.offers = [offer, ...(state.offers || []).filter((x) => x?.id !== offer.id)];
        openOfferModal(offer);
        showOfferFailure(response.error || "Trade could not be accepted.", statusNode);
        return;
      }
      activeOffer = null;
      closeSurface("#offer-modal");
    },
    onTimeout: () => {
      state.offers = [offer, ...(state.offers || []).filter((x) => x?.id !== offer.id)];
      openOfferModal(offer);
      showOfferFailure("The trade could not be confirmed. Try again.", statusNode);
    },
  });
}

function showOfferFailure(message, fallbackStatusNode) {
  const statusNode = $("#offer-card")?.querySelector("[data-offer-review-status]") || fallbackStatusNode;
  if (statusNode) statusNode.textContent = message;
  host.announceActionStatus(message, statusNode);
}

function openOfferModal(offer) {
  if (!offer?.id || isTradeOfferDismissed(state.roomCode, offer.id)) return;
  activeOffer = offer;
  const from = state.players.find((p) => p.id === offer.from || p.serverId === offer.from);
  if (!from) return;
  const recipient = state.players.find(player => player.id === (offer.to || offer.toPlayerId) || player.serverId === (offer.to || offer.toPlayerId)) || state.players[0];
  if (!recipient) return;
  const receive = tradeReviewSideHTML({ player: from, seed: state.players.indexOf(from), heading: "You receive", cash: offer.giveCash, deedIndexes: offer.giveDeeds || offer.givePropertyIndexes });
  const give = tradeReviewSideHTML({ player: recipient, seed: state.players.indexOf(recipient), heading: "You give", cash: offer.wantCash ?? offer.requestCash, deedIndexes: offer.wantDeeds || offer.requestPropertyIndexes });
  $("#offer-card").innerHTML = `
    <div class="trade-body offer-review">
      <div class="trade-head">
        <div class="section-title"><img src="/assets/negotiation.svg" width="28" height="28" alt=""/><h2 class="t-section g300" id="offer-card-title">Trade offer</h2></div>
        ${closeButtonHTML({ id: "offer-close", label: "Close offer and keep it pending" })}
      </div>
      <p class="t-body ink-2 trade-copy">${esc(from.name)} sent this offer. Review both sides before accepting.</p>
      <div class="trade-cols offer-columns">${receive}${give}</div>
      <p class="t-body ink-2 offer-note">Accept transfers the cash and deeds listed on both sides. Negotiate opens this offer in the trade builder.</p>
      <p class="t-body red offer-review-status" data-offer-review-status role="status" aria-live="off"></p>
    </div>
    <div class="trade-actions offer-review-actions">
      <button class="btn-dark offer-btn" id="offer-decline" type="button"><span class="t-label f12">Decline</span></button>
      <button class="btn-dark offer-btn" id="offer-counter" type="button"><span class="t-label f12">Negotiate</span></button>
      <button class="cta-red offer-btn" id="offer-accept" type="button"><span class="cta-text cta-text-sm">Accept trade</span></button>
    </div>`;
  openSurface("#offer-modal", "#offer-close");
  $("#offer-close").addEventListener("click", closeOfferWithoutResponse);
  $("#offer-accept").addEventListener("click", () => acceptTradeOffer(offer));
  $("#offer-counter").addEventListener("click", () => {
    activeOffer = null;
    closeSurface("#offer-modal");
    host.openTradeNegotiation(offer);
  });
  $("#offer-decline").addEventListener("click", () => {
    const statusNode = host.captureActionStatusNode($("#offer-decline"));
    emitIntent(host.emitServer, `respond-trade:${offer.id}`, "respond-trade", { tradeId: offer.id, accept: false }, {
      onResponse: (response) => {
        if (response?.success === false) {
          showOfferFailure(response.error || "Trade could not be declined.", statusNode);
          return;
        }
        activeOffer = null;
        closeSurface("#offer-modal");
      },
      onTimeout: () => showOfferFailure("The decline could not be confirmed. Try again.", statusNode),
    });
  });
}

/** Close the offer card once the offer is gone (proposer cancelled, expired,
 *  or answered elsewhere); otherwise Accept/Decline are dead and just error. */
const OFFER_WITHDRAWAL_GRACE_MS = 2000;
export function closeOfferIfWithdrawn() {
  if (!activeOffer?.id || $("#offer-modal")?.classList.contains("is-hidden")) return;
  const listed = (state.offers || []).some((offer) => offer?.id === activeOffer.id);
  const stale = Date.now() - (Number(activeOffer.receivedAt) || 0) > OFFER_WITHDRAWAL_GRACE_MS;
  const stillPending = state.pendingTrade?.id === activeOffer.id;
  if (listed && (stillPending || !stale)) return;
  activeOffer = null;
  closeSurface("#offer-modal");
}

function closeOfferWithoutResponse() {
  if (activeOffer?.id) dismissTradeOffer(state.roomCode, activeOffer.id);
  activeOffer = null;
  closeSurface("#offer-modal");
}

function bankruptPlayer(idx, creditorId, statusNode = host.captureActionStatusNode(document.activeElement)) {
  emitIntent(host.emitServer, "declare-bankruptcy", "declare-bankruptcy", {}, {
    onResponse: (response) => {
      if (response?.success === false) {
        host.announceActionStatus(response.error || "Bankruptcy could not be declared.", statusNode);
        return;
      }
      closeSurface("#bankruptcy-modal", { force: true });
    },
    onTimeout: () => host.announceActionStatus("Bankruptcy could not be confirmed. Try again.", statusNode),
  });
}

/** The server only lets the host start a game; offering Rematch to anyone else
 *  closes the card and then fails with "Only the host can start the game." */
function canStartRematch() {
  const me = state.players[0];
  if (!me) return false;
  return Boolean(me.isHost) || Boolean(me.serverId && me.serverId === state.hostId);
}

function showGameOver(winnerName, winnerId, endReason = null) {
  state.gameOver = { winnerName, winnerId, endReason };
  const ranking = rankGameOverPlayers(state.players, state.finalPlacements, winnerId);
  const canRematch = canStartRematch();
  const summary = ranking
    .map((p, i) => {
      const isWinner = p.isWinner;
      return `<div class="go-summary-row${isWinner ? " is-winner" : ""}">
        <span class="go-kicker">${String(p.placement || i + 1).padStart(2, "0")}</span>
        <span class="go-player"><span class="t-label f13" style="color:${p.textColor}">${esc(p.name)}</span></span>
        <span class="t-label f13 ${isWinner ? 'green' : 'ink-2'}">${gameOverPlayerStatus(p)}</span>
      </div>`;
    })
    .join("");
  const scoreRows = ranking.map(player => {
    const score = gameOverScore(player, endReason);
    return `<div><dt class="t-label f11">${esc(player.name)}</dt><dd class="t-label f12">${score.value === null ? 'N/A' : '$' + score.value.toLocaleString()}</dd></div>`;
  }).join('');

  $("#gameover-card").innerHTML = `
    <div class="bank-body">
      <div class="bank-head" style="justify-content:center;text-align:center">
        <div>
          <div class="go-kicker g400">ROUND OVER</div>
          <h3 class="go-name" id="gameover-card-title">${esc(winnerName)} WINS</h3>
          <p class="t-body ink-2" id="go-end-reason">${endReason === "round-limit" ? "Round limit reached. Ranked by net worth." : "Last active player. Everyone else is out."}</p>
        </div>
      </div>
      <div class="go-summary">${summary}</div>
      <details class="go-score-details"><summary>Final scores</summary><div class="go-score-heading t-micro ink-3">${endReason === 'round-limit' ? 'FINAL NET WORTH' : 'FINAL CASH'}</div><dl class="go-final-scores">${scoreRows}</dl></details>
      <div class="go-actions">
        <button class="cta-red bank-btn" id="go-rematch" ${canRematch ? '' : 'disabled aria-describedby="go-rematch-note"'}><span class="cta-text cta-text-sm">Rematch</span></button>
        <button class="btn-dark bank-btn" id="go-home"><span class="t-label f13">Back to Lobby</span></button>
        <p class="t-micro ink-3" id="go-rematch-note">${canRematch ? '' : 'The host starts the rematch.'}</p>
      </div>
    </div>`;
  openSurface("#gameover-modal", canStartRematch() ? "#go-rematch" : "#go-home");
  $("#go-rematch")?.addEventListener("click", () => {
    if (!canStartRematch()) return;
    closeSurface("#gameover-modal");
    state.gameOver = null;
    host.startGame();
  });
  $("#go-home").addEventListener("click", () => {
    closeSurface("#gameover-modal");
    state.gameOver = null;
    goHome();
  });
}

function openBankruptcyModal(idx, amount, creditorId, label) {
  state.debtRescueDismissed = false;
  const p = state.players[idx];
  const creditor = creditorId ? state.players.find((x) => x.id === creditorId) : null;
  // "Can't cover it" is only true when cash really falls short of the bill.
  const shortfall = Math.max(0, (Number(amount) || 0) - Number(p?.cash || 0));
  const creditorName = creditor ? esc(creditor.name) : "the bank";
  const bankCopy = shortfall > 0
    ? `${esc(label)}. You’re $<span class="numeric">${shortfall.toLocaleString()}</span> short. Review your holdings, trades, and financing before deciding whether to leave the table. Creditor: ${creditorName}.`
    : `${esc(label)}. Your cash covers this payment. Creditor: ${creditorName}.`;
  $("#bankruptcy-card").innerHTML = `
    <div class="bank-body">
      <div class="bank-head">
        <span class="bank-icon">!</span>
        <div>
          <div class="t-micro red">${shortfall > 0 ? "CAN'T COVER IT" : "PAYMENT DUE"}</div>
          <h3 class="t-section bank-title" id="bankruptcy-card-title">$<span class="numeric">${Number(amount || 0).toLocaleString()}</span> due</h3>
        </div>
      </div>
      <button class="btn-dark bank-dismiss" id="bank-dismiss" type="button" aria-label="CLOSE: return to the table">CLOSE</button>
      <p class="t-body ink-2 bank-copy">${bankCopy}</p>
      <div class="bank-actions">
        <button class="btn-dark bank-btn" id="bank-liquidate" type="button"><span class="t-label f12">Holdings</span></button>
        <button class="btn-dark bank-btn" id="bank-trade" type="button"><span class="t-label f12">Trade</span></button>
        <button class="btn-dark bank-btn" id="bank-financing" type="button"><span class="t-label f12">Financing</span></button>
        <button class="cta-red bank-btn" id="bank-declare" type="button"><span class="t-label f12">Declare Bankruptcy</span></button>
      </div>
    </div>`;
  openSurface("#bankruptcy-modal", "#bank-liquidate");
  $("#bank-dismiss").addEventListener("click", dismissBankruptcyModal);
  $("#bank-liquidate").addEventListener("click", () => {
      dismissBankruptcyModal();
      host.openHoldings();
      host.recordActivity("Holdings is open. Sell houses or mortgage deeds, then return here to settle the debt.");
  });
  $("#bank-trade").addEventListener("click", () => {
    dismissBankruptcyModal();
    host.openTradeForDebt();
  });
  $("#bank-financing").addEventListener("click", () => {
    dismissBankruptcyModal();
    host.openFinancingForDebt();
  });
  $("#bank-declare").addEventListener("click", event => {
    // Debt bankruptcy is irreversible: require an explicit second tap,
    // mirroring the voluntary-exit confirm. No accidental eliminations.
    const actions = $("#bankruptcy-modal .bank-actions");
    if (actions && !actions.dataset.armed) {
      actions.dataset.armed = "1";
      // Name the consequence before the irreversible confirm (sweepCashToCreditor, forfeitOrReleaseProperties, clearQuitObligations).
      const copy = $("#bankruptcy-modal .bank-copy");
      if (copy) copy.textContent = "Declaring ends your round now. Your cash and properties pass to the creditor or the bank, your items are sold, and open trades and contracts are cancelled. This cannot be undone.";
      actions.innerHTML = `<button class="cta-red bank-btn" id="bank-declare-confirm"><span class="cta-text cta-text-sm">Confirm Bankruptcy</span></button>
        <button class="btn-dark bank-btn" id="bank-declare-cancel"><span class="t-label f12">Keep Playing</span></button>`;
      // The focused Declare button was just replaced: move focus to the safe
      // default so an irreversible decision never drops focus to <body>.
      focusSurface("#bankruptcy-modal", "#bank-declare-cancel");
      $("#bank-declare-cancel").addEventListener("click", () => closeSurface("#bankruptcy-modal", { force: true }));
      $("#bank-declare-confirm").addEventListener("click", event => bankruptPlayer(idx, creditorId, host.captureActionStatusNode(event.currentTarget)));
      return;
    }
    bankruptPlayer(idx, creditorId, host.captureActionStatusNode(event.currentTarget));
  });
}

export function dismissBankruptcyModal() {
  state.debtRescueDismissed = true;
  const actions = $("#bankruptcy-modal .bank-actions");
  if (actions) delete actions.dataset.armed;
  closeSurface("#bankruptcy-modal", { force: true });
}

export function openVoluntaryExitModal() {
  const me = state.players[0];
  if (!me) return;
  const heldDeeds = TILES.filter((tile) => (state.owners || {})[tile.i] === me.id).length;
  const deedLabel = `${heldDeeds} deed${heldDeeds === 1 ? "" : "s"}`;
  $("#bankruptcy-card").innerHTML = `
    <div class="bank-body">
      <div class="bank-head">
        <span class="bank-icon">!</span>
        <div>
          <div class="t-micro red">VOLUNTARY EXIT</div>
          <h3 class="t-section bank-title" id="bankruptcy-card-title">Leave the table?</h3>
        </div>
      </div>
      <p class="t-body ink-2 bank-copy">You hold ${deedLabel} and $${me.cash.toLocaleString()}. Retiring hands everything back to the market unencumbered and ends your round. It cannot be undone. You can still raise funds instead by selling, mortgaging, trading, or taking a loan.</p>
      <div class="bank-actions">
        <button class="cta-red bank-btn" id="bank-retire-confirm"><span class="cta-text cta-text-sm">Retire / Hand Over Assets</span></button>
        <button class="btn-dark bank-btn" id="bank-retire-cancel"><span class="t-label f12">Keep Playing</span></button>
      </div>
    </div>`;
  openSurface("#bankruptcy-modal", "#bank-retire-cancel");
  $("#bank-retire-cancel").addEventListener("click", () => closeSurface("#bankruptcy-modal", { force: true }));
  const confirmRetire = event => {
    const statusNode = host.captureActionStatusNode(event.currentTarget);
    closeSurface("#bankruptcy-modal", { force: true });
    bankruptPlayer(0, null, statusNode);
  };
  $("#bank-retire-confirm").addEventListener("click", event => {
    // Retiring is irreversible: the first tap arms it, the second confirms, as with bankruptcy.
    const actions = $("#bankruptcy-modal .bank-actions");
    if (actions && !actions.dataset.armed) {
      actions.dataset.armed = "1";
      actions.innerHTML = `<button class="cta-red bank-btn" id="bank-retire-confirm"><span class="cta-text cta-text-sm">Confirm Retire</span></button>
        <button class="btn-dark bank-btn" id="bank-retire-cancel"><span class="t-label f12">Keep Playing</span></button>`;
      focusSurface("#bankruptcy-modal", "#bank-retire-cancel");
      $("#bank-retire-cancel").addEventListener("click", () => closeSurface("#bankruptcy-modal", { force: true }));
      $("#bank-retire-confirm").addEventListener("click", confirmRetire);
      return;
    }
    confirmRetire(event);
  });
}

function openCardReveal(tile, ev, options = {}) {
  $("#card-reveal").innerHTML = cardFaceHTML(tile, ev, { buttonId: "cr-ok" });
  openSurface("#card-modal", "#cr-ok", options);
  const dismiss = () => {
    state.card = null;
    closeSurface("#card-modal");
  };
  // The whole card is the dismiss target; #cr-ok stays a real button for keyboards and screen readers.
  $("#cr-ok").addEventListener("click", dismiss);
  $("#card-reveal .cr-card")?.addEventListener("click", dismiss);
}

function closeCardGallery() {
  const gallery = $("#card-gallery");
  if (!gallery) return;
  gallery.classList.add("is-hidden");
  gallery.setAttribute("aria-hidden", "true");
  syncSurfaceA11y();
}

function openCardGallery() {
  const gallery = $("#card-gallery");
  const grid = $("#card-gallery-grid");
  if (!gallery || !grid) return;
  const cards = [
    ...CHANCE_EVENTS.map((event) => ({ tile: TILES.find((entry) => entry.kind === "chance"), event, kind: "chance" })),
    ...CHEST_EVENTS.map((event) => ({ tile: TILES.find((entry) => entry.kind === "chest"), event, kind: "chest" })),
  ];
  grid.innerHTML = cards.map(({ tile, event }, index) => cardFaceHTML(tile, event, { index, total: cards.length })).join("");
  gallery.classList.remove("is-hidden");
  gallery.setAttribute("aria-hidden", "false");
  syncSurfaceA11y();
  requestAnimationFrame(() => $("#card-gallery-close")?.focus({ preventScroll: true }));
}

const CARD_PREVIEW_KINDS = { surprise: "chance", treasure: "chest" };

function openCardPreviewFromUrl() {
  const preview = new URLSearchParams(window.location.search).get("preview");
  if (preview === "cards") {
    requestAnimationFrame(openCardGallery);
    return;
  }
  const kind = CARD_PREVIEW_KINDS[preview];
  if (!kind) return;
  openCardPreviewCard(kind);
}

function openCardPreviewCard(kind) {
  const tile = TILES.find((entry) => entry.kind === kind);
  if (!tile) return;
  const deck = kind === "chance" ? CHANCE_EVENTS : CHEST_EVENTS;
  const event = deck.find((entry) => entry.action === "moveTo") || deck[0];
  if (!event) return;
  const cash = Number(event.cash) || 0;
  requestAnimationFrame(() => openCardReveal(tile, { ...event, cash }, { allowHome: true }));
}

function isMyOwnDebt(debt) {
  if (!debt) return false;
  return debt.playerId === state.players[0]?.serverId;
}

function onRetireClick() {
  const me = state.players[0];
  if (me?.spectating) {
    openConfirmModal({
      title: "Leave this table?",
      message: "Leaving releases your spectator seat and returns you to the homescreen.",
      confirmLabel: "LEAVE TABLE",
      onConfirm: () => goHome(),
    });
    return;
  }
  if (me?.bankrupt) {
    goHome();
    return;
  }
  const debt = state.pendingDebt;
  if (isMyOwnDebt(debt)) {
    openBankruptcyModal(0, Number(debt.amountRemaining) || 0, debt.creditorId, debt.reason || "This payment is due.");
    return;
  }
  openVoluntaryExitModal();
}

function closeCardModalFromScrim() {
  state.card = null;
  closeSurface("#card-modal");
}

export function bindGameModalSurfaces() {
  // trade offer inbox
  $("#offer-scrim")?.addEventListener("click", closeOfferWithoutResponse);

  $("#game-retire-btn")?.addEventListener("click", onRetireClick);

  $("#card-scrim").addEventListener("click", closeCardModalFromScrim);
  $("#card-gallery-close")?.addEventListener("click", closeCardGallery);
  $("#card-gallery .card-gallery-scrim")?.addEventListener("click", closeCardGallery);
}

export { openChoiceModal, openCardReveal, openOfferModal, openBankruptcyModal, showGameOver, closeChoiceModalAsPass, closeChoiceModalWithoutAction, closeOfferWithoutResponse, openCardGallery, closeCardGallery, openCardPreviewFromUrl };
