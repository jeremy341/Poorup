/* ============================================================
   GAME MODAL SURFACES: the forced-buy choice card, the bot trade
   offer inbox, the bankruptcy / voluntary-exit / round-over cards,
   and the Chance/Chest card reveal + gallery (plus the ?preview=
   design hook). emitServer, say, renderChat, renderAll, buyTile
   and startGame are injected by the entry module; markup and
   socket payloads are the exact old main.js templates.
   ============================================================ */
import { $, esc } from "./clientDom.js";
import { state } from "./clientState.js";
import { TILES, CHANCE_EVENTS, CHEST_EVENTS } from "./clientBoardData.js";
import { cardFaceHTML } from "./clientCardsRender.js";
import { avatarHTML } from "./clientSprites.js";
import { closeSurface, openSurface, syncSurfaceA11y } from "./clientSurfaces.js";
import { accentOf, kindLabel, popIconHTML, popRow } from "./clientPopupUi.js";
import { startAuction } from "./clientAuctionUi.js";
import { renderTradeModal } from "./clientTradeUi.js";
import { goHome } from "./clientLobbyUi.js";

let host = {
  emitServer: noop,
  say: noop,
  renderChat: noop,
  renderAll: noop,
  buyTile: noop,
  startGame: noop,
};

function noop() {}

export function configureGameModals(hooks) {
  host = { ...host, ...hooks };
}

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
      </div>
      <p class="t-body ink-2 choice-copy">${auctionMode ? "You landed on an unowned lot. Buy it at the listed price, or send it to auction." : "You landed on an unowned lot. Buy it or pass."}</p>
      <div class="choice-rows">
        ${popRow("PRICE", `$${price}`, "g300")}
        ${popRow("YOUR CASH", `$${me.cash.toLocaleString()}`, canAfford ? "green" : "red")}
      </div>
      <div class="choice-actions">
        <button class="cta-red choice-btn choice-buy" id="choice-buy" ${canAfford ? "" : "disabled"}>
          <span class="t-label">BUY</span>
          <span class="t-micro">${auctionMode ? "BUY DEED" : `$${price}`}</span>
        </button>
        ${auctionMode
          ? `<button class="btn-dark choice-btn" id="choice-auction">
              <span class="t-label">AUCTION</span>
              <span class="t-micro">OPEN BIDDING</span>
            </button>`
          : `<button class="btn-dark choice-btn" id="choice-pass">
              <span class="t-label">PASS</span>
              <span class="t-micro">DECLINE</span>
            </button>`
        }
      </div>
      <p class="t-micro ink-3 choice-note">${auctionMode ? (canAfford ? "YOU MUST CHOOSE ONE TO CONTINUE" : "TOO POOR TO BUY — MUST AUCTION") : "Click outside or press ESC to revisit this choice."}</p>
    </div>`;

  openSurface("#choice-modal", "#choice-buy");
  const scrim = $("#choice-scrim");
  if (scrim) {
    scrim.classList.toggle("popup-scrim-locked", auctionMode);
    scrim.onclick = auctionMode ? null : closeChoiceModalAsPass;
  }
  const buyBtn = $("#choice-buy");
  if (buyBtn) buyBtn.addEventListener("click", () => {
    host.buyTile(tile);
    state.pendingBuyTile = null;
    closeSurface("#choice-modal");
    afterLandingResolved();
  });

  if (auctionMode) {
    $("#choice-auction").addEventListener("click", () => {
      state.pendingBuyTile = null;
      closeSurface("#choice-modal");
      startAuction(tile);
    });
  } else {
    $("#choice-pass").addEventListener("click", closeChoiceModalAsPass);
  }
}

function afterLandingResolved() {
  host.renderAll();
}

function closeChoiceModalAsPass() {
  if (state.settings.auction) return;
  const tile = state.pendingBuyTile != null ? TILES[state.pendingBuyTile] : null;
  const me = state.players[0];
  if (tile) {
    host.emitServer("decline-property", { tileIndex: tile.i }, (response) => {
      if (response?.success === false) {
        host.say(response.error || "The deed could not be declined.");
        host.renderChat();
      }
    });
    state.pendingBuyTile = null;
    closeSurface("#choice-modal");
    return;
  }
  state.pendingBuyTile = null;
  closeSurface("#choice-modal");
  afterLandingResolved();
}

function openOfferModal(offer) {
  const from = state.players.find((p) => p.id === offer.from || p.serverId === offer.from);
  if (!from) return;
  const wantNames = offer.wantDeeds.map((i) => TILES[i].name).join(", ") || "nothing";
  $("#offer-card").innerHTML = `
    <div class="offer-rail" style="background:${from.color}"></div>
    <div class="offer-body">
      <div class="offer-head">
        <div class="offer-av">${avatarHTML(from, 4, state.players.indexOf(from))}</div>
        <div>
          <div class="t-micro g400">TRADE OFFER</div>
          <h3 class="t-section offer-title" id="offer-card-title" style="color:${from.textColor}">${esc(from.name)}</h3>
        </div>
      </div>
      <p class="t-body ink-2 offer-rows" style="margin-top:14px">
        ${from.name} will give you <span class="green">$${offer.giveCash.toLocaleString()}</span>
        and wants <span class="g300">${esc(wantNames)}</span>.
      </p>
      <div class="offer-actions">
        <button class="cta-red offer-btn" id="offer-accept"><span class="cta-text cta-text-sm">Accept</span></button>
        <button class="btn-dark offer-btn" id="offer-counter"><span class="t-label f12">Counter</span></button>
        <button class="btn-dark offer-btn" id="offer-reject"><span class="t-label f12">Reject</span></button>
      </div>
      <p class="t-micro ink-3 offer-note">Trades only transfer cash or deeds offered here.</p>
    </div>`;
  openSurface("#offer-modal", "#offer-accept");
  $("#offer-accept").addEventListener("click", () => {
    const o = state.offers.find((x) => x === offer);
    if (o) state.offers.splice(state.offers.indexOf(o), 1);
    host.emitServer("respond-trade", { tradeId: offer.id, accept: true }, (response) => {
        if (response?.success === false) {
          host.say(response.error || "Trade could not be accepted.");
          host.renderChat();
          return;
        }
      });
      closeSurface("#offer-modal");
      return;
  });
  $("#offer-counter").addEventListener("click", () => {
    // swap into the trade editor pre-loaded with the bot's proposal
    state.tradeWith = offer.from;
    state.tradeMyDeeds = new Set(offer.wantDeeds);
    state.tradeTheirDeeds = new Set(offer.giveDeeds);
    state.tradeMyCash = offer.wantCash;
    state.tradeTheirCash = offer.giveCash;
    const o = state.offers.find((x) => x === offer);
    if (o) state.offers.splice(state.offers.indexOf(o), 1);
    closeSurface("#offer-modal");
    renderTradeModal();
    openSurface("#trade-modal", "#trade-close");
  });
  $("#offer-reject").addEventListener("click", rejectOpenOffer);
}

function rejectOpenOffer() {
  const offer = state.offers.shift();
  if (offer) {
    host.emitServer("respond-trade", { tradeId: offer.id, accept: false }, () => {});
    closeSurface("#offer-modal");
    return;
  }
  closeSurface("#offer-modal");
  host.renderChat();
}

function bankruptPlayer(idx, creditorId) {
  host.emitServer("declare-bankruptcy", {}, (response) => {
      if (response?.success === false) {
        host.say(response.error || "Bankruptcy could not be declared.");
        host.renderChat();
      }
    });
    return;
}

function showGameOver(winnerName, winnerId) {
  state.gameOver = { winnerName, winnerId };
  const ranking = state.players
    .slice()
    .sort((x, y) => (y.cash + totalAssets(y)) - (x.cash + totalAssets(x)));
  const summary = ranking
    .map((p, i) => {
      const deeds = TILES.filter((t) => state.owners[t.i] === p.id).length;
      const crown = p.id === winnerId || i === 0 ? ' <span class="t-micro g300">★ WINNER</span>' : "";
      return `<div class="go-summary-row${p.id === winnerId ? " is-winner" : ""}">
        <span class="go-kicker">${String(i + 1).padStart(2, "0")}</span>
        <span class="t-label f13" style="color:${p.textColor};flex:1">${esc(p.name)}${crown}</span>
        <span class="t-label f12 g-muted">${deeds} DEED${deeds === 1 ? "" : "S"}</span>
        <span class="t-label f13 green">$${p.cash.toLocaleString()}</span>
      </div>`;
    })
    .join("");

  $("#gameover-card").innerHTML = `
    <div class="bank-body">
      <div class="bank-head" style="justify-content:center;text-align:center">
        <div>
          <div class="go-kicker g400">ROUND OVER</div>
          <h3 class="go-name" id="gameover-card-title">${esc(winnerName)} WINS</h3>
        </div>
      </div>
      <div class="go-summary">${summary}</div>
      <div class="go-actions">
        <button class="cta-red bank-btn" id="go-rematch"><span class="cta-text cta-text-sm">Rematch</span></button>
        <button class="btn-dark bank-btn" id="go-home"><span class="t-label f13">Back to Lobby</span></button>
      </div>
    </div>`;
  openSurface("#gameover-modal", "#go-rematch");
  $("#go-rematch").addEventListener("click", () => {
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

function totalAssets(p) {
  return TILES.filter((t) => state.owners[t.i] === p.id)
    .reduce((sum, t) => sum + (state.mortgaged[t.i] ? 0 : t.price || 0), 0);
}

function openBankruptcyModal(idx, amount, creditorId, label) {
  const p = state.players[idx];
  const creditor = creditorId ? state.players.find((x) => x.id === creditorId) : null;
  $("#bankruptcy-card").innerHTML = `
    <div class="bank-body">
      <div class="bank-head">
        <span class="bank-icon">!</span>
        <div>
          <div class="t-micro red">CAN'T COVER IT</div>
          <h3 class="t-section bank-title" id="bankruptcy-card-title">$${amount} due</h3>
        </div>
      </div>
      <p class="t-body ink-2 bank-copy">${esc(label)}. You're $${amount - p.cash} short. Sell houses and mortgage deeds — or hand everything to ${creditor ? esc(creditor.name) : "the bank"} and bow out.</p>
      <div class="bank-actions">
        <button class="cta-red bank-btn" id="bank-liquidate"><span class="cta-text cta-text-sm">Liquidate & Pay</span></button>
        <button class="btn-dark bank-btn" id="bank-declare"><span class="t-label f12">Declare Bankruptcy</span></button>
      </div>
    </div>`;
  openSurface("#bankruptcy-modal", "#bank-liquidate");
  $("#bank-liquidate").addEventListener("click", () => {
    closeSurface("#bankruptcy-modal");
      host.say("Use Holdings to sell houses or mortgage deeds, then the debt will settle automatically.");
      host.renderChat();
      return;
  });
  $("#bank-declare").addEventListener("click", () => bankruptPlayer(idx, creditorId));
}

function openVoluntaryExitModal() {
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
      <p class="t-body ink-2 bank-copy">You hold ${deedLabel} and $${me.cash.toLocaleString()}. Retiring hands everything back to the market unencumbered and ends your round — it cannot be undone. You can still raise funds instead by selling, mortgaging, trading, or taking a loan.</p>
      <div class="bank-actions">
        <button class="cta-red bank-btn" id="bank-retire-confirm"><span class="cta-text cta-text-sm">Declare Bankruptcy</span></button>
        <button class="btn-dark bank-btn" id="bank-retire-cancel"><span class="t-label f12">Keep Playing</span></button>
      </div>
    </div>`;
  openSurface("#bankruptcy-modal", "#bank-retire-cancel");
  $("#bank-retire-cancel").addEventListener("click", () => closeSurface("#bankruptcy-modal"));
  $("#bank-retire-confirm").addEventListener("click", () => {
    closeSurface("#bankruptcy-modal");
    bankruptPlayer(0, null);
  });
}

function openCardReveal(tile, ev) {
  $("#card-reveal").innerHTML = cardFaceHTML(tile, ev, { buttonId: "cr-ok" });
  openSurface("#card-modal", "#cr-ok");
  $("#cr-ok").addEventListener("click", () => {
    state.card = null;
    closeSurface("#card-modal");
  });
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
  requestAnimationFrame(() => openCardReveal(tile, { ...event, cash }));
}

function isMyOwnDebt(debt) {
  if (!debt) return false;
  return debt.playerId === state.players[0]?.serverId;
}

function onRetireClick() {
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
  $("#offer-scrim")?.addEventListener("click", rejectOpenOffer);

  $("#game-retire-btn")?.addEventListener("click", onRetireClick);

  $("#card-scrim").addEventListener("click", closeCardModalFromScrim);
  $("#card-gallery-close")?.addEventListener("click", closeCardGallery);
  $("#card-gallery .card-gallery-scrim")?.addEventListener("click", closeCardGallery);
}

export { openChoiceModal, openCardReveal, openOfferModal, openBankruptcyModal, showGameOver, closeChoiceModalAsPass, rejectOpenOffer, openCardGallery, closeCardGallery, openCardPreviewFromUrl };
