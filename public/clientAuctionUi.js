/* ============================================================
   AUCTION: the forced-buy/auction flow's bidding UI. Renders the
   auction card and its live countdown, and owns the interval that
   drives it. The tile-popup render helpers are imported; the
   socket-bound calls (emitServer, say, renderChat) arrive via
   configureAuctionUi. renderAuction's markup is the exact old
   main.js template.
   ============================================================ */
import { $, esc } from "./clientDom.js";
import { state } from "./clientState.js";
import { avatarHTML } from "./clientSprites.js";
import { AUCTION_MS } from "./clientStateSync.js";
import { accentOf, popIconHTML, kindLabel } from "./clientPopupUi.js";

let host = { emitServer: noop, say: noop, renderChat: noop };

function noop() {}

export function configureAuctionUi(hooks) {
  host = { ...host, ...hooks };
}

const BID_STEPS = [1, 20, 100];
// Audit #18: single clock for auction deadlines. Matches the server's frame
// once a snapshot has arrived (offset 0 before the first one).
function serverNow() { return Date.now() + (state.serverTimeOffset || 0); }
let auctionTimer = null;

export function startAuctionTimer() {
  clearInterval(auctionTimer);
  auctionTimer = setInterval(tickAuction, 60);
}

export function stopAuctionTimer() {
  clearInterval(auctionTimer);
  auctionTimer = null;
}

export function startAuction(tile) {
  host.emitServer("decline-property", { tileIndex: tile.i }, (response) => {
    if (response?.success === false) {
      host.say(response.error || "The auction could not be opened.");
      host.renderChat();
    }
  });
}

function humanBid(inc) {
  const a = state.auction;
  if (!a) return;
  const me = state.players[0];
  if (a.passed.p1) return;
  if (me.cash < a.bid + inc) return; // can't cover the raise
  host.emitServer("auction-bid", { amount: a.bid + inc }, (response) => {
    if (response?.success === false) {
      host.say(response.error || "Bid rejected.");
      host.renderChat();
    }
  });
}

function humanPassAuction() {
  const a = state.auction;
  if (!a) return;
  host.emitServer("auction-pass", {}, (response) => {
    if (response?.success === false) {
      host.say(response.error || "You cannot pass this auction.");
      host.renderChat();
    }
  });
}

function tickAuction() {
  const a = state.auction;
  if (!a) return;
  const remaining = a.deadline - serverNow();

  // Live auctions are finalized by the server. The client only keeps the
  // countdown visually current until the authoritative update arrives.
  updateAuctionLive();
  if (remaining <= 0) stopAuctionTimer();
}

function renderAuction() {
  const a = state.auction;
  if (!a) return;
  const tile = TILES[a.tileIndex];
  $("#auction-card").innerHTML = `
    <div class="auction-rail" style="background:${accentOf(tile)}"></div>
    <div class="auction-body">
      <div class="auction-head">
        <div class="auction-icon">${popIconHTML(tile)}</div>
        <div class="pop-headtext">
          <div class="t-micro g400">AUCTION · ${kindLabel(tile)}</div>
          <h3 class="t-section auction-title" id="auction-card-title">${tile.name}</h3>
        </div>
      </div>

      <div class="auction-bid-box">
        <div>
          <div class="t-micro ink-3">HIGH BID</div>
          <div class="auction-bid-val" id="auction-bid">$0</div>
        </div>
        <div class="auction-leader">
          <div class="t-micro ink-3">LEADER</div>
          <div class="t-label auction-leader-name" id="auction-leader">NO BIDS YET</div>
        </div>
      </div>

      <div class="auction-timer-wrap">
        <div class="auction-timer-top">
          <span class="t-micro g400">TIME LEFT</span>
          <span class="t-label f12 g-muted" id="auction-timer">5.0s</span>
        </div>
        <div class="auction-bar-track"><div class="auction-bar-fill" id="auction-bar"></div></div>
      </div>

      <div class="auction-bids">
        ${BID_STEPS.map((inc) => `
          <button class="cta-red auction-bid-btn" data-bid="${inc}">
            <span class="t-label">+${inc}</span>
            <span class="t-micro">RAISE</span>
          </button>`).join("")}
      </div>

      <div class="auction-pass">
        <button class="btn-dark auction-pass-btn" id="auction-pass"><span class="t-label f12">PASS — STAND DOWN</span></button>
      </div>

      <div class="auction-players" id="auction-players"></div>

      <p class="t-micro ink-3 auction-foot">EACH BID RESETS THE 5s CLOCK · LAST BIDDER WINS</p>
    </div>`;

  $("#auction-card").querySelectorAll("[data-bid]").forEach((btn) => {
    btn.addEventListener("click", () => humanBid(Number(btn.dataset.bid)));
  });
  $("#auction-pass").addEventListener("click", humanPassAuction);
  updateAuctionLive();
}

function renderAuctionBar(remaining, pct) {
  const bar = $("#auction-bar");
  if (!bar) return;
  bar.style.transform = `scaleX(${pct / 100})`;
  bar.classList.toggle("is-low", remaining <= 2000);
}

function renderAuctionTimer(remaining) {
  const timerEl = $("#auction-timer");
  if (timerEl) timerEl.textContent = `${(remaining / 1000).toFixed(1)}s`;
}

function renderAuctionBid(a) {
  const bidEl = $("#auction-bid");
  if (bidEl) bidEl.textContent = `${a.bid}`;
}

function findAuctionLeader(a) {
  if (!a.leaderId) return null;
  return state.players.find((p) => p.id === a.leaderId);
}

function renderAuctionLeader(a) {
  const leaderEl = $("#auction-leader");
  if (!leaderEl) return;
  const leader = findAuctionLeader(a);
  leaderEl.textContent = leader ? leader.name : "NO BIDS YET";
  leaderEl.style.color = leader ? leader.textColor : "var(--text-muted)";
}

function disableAuctionBids(me, a) {
  $("#auction-card")?.querySelectorAll("[data-bid]").forEach((btn) => {
    const inc = Number(btn.dataset.bid);
    btn.disabled = me.cash < a.bid + inc;
  });
}

function renderAuctionPass(a) {
  const passBtn = $("#auction-pass");
  if (passBtn) passBtn.disabled = !!a.passed?.p1;
}

function auctionPlayerBroke(p, a) {
  if (p.cash < BID_STEPS[0]) return true;
  if (p.id === "p1") return false;
  return p.cash < a.bid + BID_STEPS[0];
}

function auctionPlayerStatus(p, a) {
  if (p.id === a.leaderId) return { status: "LEADING", cls: "g300" };
  if (a.passed[p.id]) return { status: "PASSED", cls: "ink-3" };
  if (auctionPlayerBroke(p, a)) return { status: "BROKE", cls: "red" };
  return { status: "BIDDING", cls: "green" };
}

function auctionPlayerRow(p, a) {
  const { status, cls } = auctionPlayerStatus(p, a);
  const leading = p.id === a.leaderId ? " is-leading" : "";
  return `<div class="auction-player${leading}">
        <span class="ap-av">${avatarHTML(p, 2, state.players.indexOf(p))}</span>
        <span class="t-label ap-name" style="color:${p.textColor}">${esc(p.name)}</span>
        <span class="t-micro ap-st ${cls}">${status}</span>
      </div>`;
}

function renderAuctionPlayers(a) {
  const listEl = $("#auction-players");
  if (!listEl) return;
  listEl.innerHTML = state.players.map((p) => auctionPlayerRow(p, a)).join("");
}

function updateAuctionLive() {
  const a = state.auction;
  if (!a) return;
  const me = state.players[0];
  const remaining = Math.max(0, a.deadline - serverNow());
  const pct = Math.max(0, Math.min(100, (remaining / AUCTION_MS) * 100));
  renderAuctionBar(remaining, pct);
  renderAuctionTimer(remaining);
  renderAuctionBid(a);
  renderAuctionLeader(a);
  disableAuctionBids(me, a);
  renderAuctionPass(a);
  renderAuctionPlayers(a);
}

