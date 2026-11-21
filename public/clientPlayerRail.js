// Left rail: the seated-player list, lobby seat markers and presence dots.
import { $, esc, setHtml } from "./clientDom.js";
import { state } from "./clientState.js";
import { spriteHTML, avatarHTML } from "./clientSprites.js";
import { inactiveBadgeHTML } from "./clientInactivityUi.js";

let host = null;

// Host/lobby markers and server-time offset stay owned by the entry module.
export function configurePlayerRail(deps) {
  host = deps;
}

function lobbyHostIsLocal() {
  const me = state.players[0];
  return Boolean(me && (me.isHost || (me.serverId && me.serverId === state.hostId)));
}

// Before the round starts, the host can add a computer player straight from the empty seat.
function lobbyAddSeatAvailable(seatedCount) {
  return state.phase === "lobby" && lobbyHostIsLocal() && seatedCount < state.settings.maxPlayers;
}

function lobbyAddSeatHTML() {
  return `<button class="player-add-row" type="button" data-add-computer>
    <span class="player-row-avatar" aria-hidden="true">+</span>
    <span class="t-label">Add computer player</span>
  </button>`;
}

function playerRowHTML(p, i, serverNow = host.currentServerTime()) {
  const active = i === state.turnIndex && state.phase === "playing";
  const spectating = isSpectatingPlayer(p);
  const eliminated = Boolean(p.bankrupt);
  const playerId = p.serverId || p.id;
  const status = spectating ? "SPECTATING" : playerStatusLabel(p);
  return `<button class="player-row player-row-action${active ? " is-active" : ""}${spectating ? " is-spectating" : ""}${eliminated ? " is-eliminated" : ""}" type="button" data-player-id="${esc(playerId)}" aria-label="Open player card for ${esc(p.name)}${spectating ? ", spectating" : eliminated ? ", bankrupt" : ""}">
        ${active ? `<span class="player-row-arrow">${spriteHTML("arrow", 3)}</span>` : ""}
        <div class="player-row-avatar${spectating ? " player-row-avatar-spectating" : ""}">${avatarHTML(p, 4, i)}</div>
        <div class="player-row-main">
          <div class="player-row-nameline">
            ${active ? spriteHTML("crown", 2) : ""}
            <span class="t-label player-row-name" style="color:${p.textColor}">${esc(p.name)}</span>
            ${host.lobbyTagHTML(p)}
            ${state.phase === "playing" ? inactiveBadgeHTML(p, serverNow) : ""}
          </div>
          ${spectating ? `<span class="t-micro player-row-spectating-label">SPECTATING</span>` : ""}
          <div class="t-label player-row-cash numeric">$${Number(p.visualCash ?? p.cash ?? 0).toLocaleString()}</div>
        </div>
        <div class="player-row-right">
          ${playerDotHTML(p)}
          <span class="t-micro ink-3">${status}</span>
        </div>
      </button>`;
}

function playerDotHTML(p) {
  if (p.bankrupt) return `<span class="player-row-dot player-row-dot-spectating"></span>`;
  const on = Boolean(p.online);
  const background = on ? "#35a653" : "#3a382a";
  const boxShadow = on ? "0 0 5px rgb(53 166 83 / 60%)" : "none";
  return `<span class="player-row-dot" style="background:${background};box-shadow:${boxShadow}"></span>`;
}

function isSpectatingPlayer(p) {
  if (p.spectating) return true;
  if (!p.bankrupt) return false;
  return !p.bot;
}

function playerStatusLabel(p) {
  if (isSpectatingPlayer(p)) return "SPECTATING";
  if (p.bankrupt) return "BANKRUPT";
  if (!p.online) return "AFK";
  if (p.id === "p1") return "YOU";
  if (p.bot) return `COMPUTER · ${(p.botBrain || "ai").toUpperCase()} · ${(p.botDifficulty || "table").toUpperCase()}`;
  return "ONLINE";
}

export function renderPlayers() {
  const seated = state.players.slice(0, state.settings.maxPlayers);
  const serverNow = host.currentServerTime();
  const rows = seated.map((p, i) => playerRowHTML(p, i, serverNow));
  if (lobbyAddSeatAvailable(seated.length)) rows.push(lobbyAddSeatHTML());
  setHtml($("#player-list"), rows.join(""));
}
