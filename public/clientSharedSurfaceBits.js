// SHARED SURFACE BITS: small DOM helpers and focus/return-bar fragments used by
// the social, rankings and game-opening surface modules.
import { $, esc } from "./clientDom.js";
import { avatarHTML } from "./clientSprites.js";
import { state } from "./clientState.js";

export function surfaceCard(target, fallback) {
  const card = $(target) || $(fallback);
  if (!card) return null;
  return card;
}

function pageFocusCanMove() {
  const active = document.activeElement;
  if (!active || active === document.body) return true;
  const owner = active.closest?.(".view");
  return Boolean(owner?.classList.contains("is-hidden"));
}

export function focusSocialPage() {
  if (!pageFocusCanMove()) return;
  requestAnimationFrame(() => {
    const gate = $("#social-page-content [data-social-guest-gate]");
    const target = gate || $("#social-page-content .social-feed");
    target?.focus({ preventScroll: true });
  });
}

export function focusRankingsPage() {
  if (!pageFocusCanMove()) return;
  requestAnimationFrame(() => $("#rankings-page-content [data-ranking-stage]")?.focus({ preventScroll: true }));
}

export function socialPlayerRowHTML(player, actionLabel = "VIEW") {
  if (!player) return "";
  const id = player.id || player.accountId;
  const mutual = Number(player.mutualFriends) || 0;
  const line = player.computer
    ? `COMPUTER · ${esc(String(player.difficulty || "table").toUpperCase())}`
    : `@${esc(player.username || "guest")}${mutual ? ` · ${mutual} MUTUAL` : ""}`;
  return `<div class="social-player-row"><div class="social-player-avatar">${avatarHTML(player, 3, 0)}</div><div class="social-player-main"><strong class="t-label f12 g100">${esc(player.displayName || player.name || "PLAYER")}</strong><span class="t-micro ink-3">${line}</span></div><button class="btn-dark social-player-open" type="button" data-social-player="${esc(id)}"><span class="t-label f11">${actionLabel}</span></button></div>`;
}

// Inside a game, Rankings and Social render the same content as their pages. Only the exit
// differs: pages leave through the site header, while the in-game copy returns to the table.
// Closing it never leaves the room. The seat, connection, turn timer and pending prompt stay put.
export function tableReturnBarHTML(closeId, label) {
  const room = state.roomCode ? ` · ROOM ${esc(state.roomCode)}` : "";
  return `<div class="table-return-bar"><button class="btn-dark social-close table-return-btn" id="${closeId}" type="button" aria-label="Back to table. Closes ${label}; your seat and the game keep running."><span class="table-return-arrow" aria-hidden="true">‹</span><span class="t-label f11">BACK TO TABLE</span></button><span class="t-micro ink-3 table-return-note">TABLE STAYS LIVE${room} · YOUR SEAT AND TURN ARE UNAFFECTED</span></div>`;
}
