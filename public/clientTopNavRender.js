/* ============================================================
   TOP NAV + CONNECTION STATUS RENDERING: the browser chrome that
   mirrors state.connectionStatus / room identity. Pure DOM output.
   ============================================================ */
import { $ } from "./clientDom.js";
import { state } from "./clientState.js";

export const CONNECTION_COPY = {
  connecting: "CONNECTING…",
  online: "ONLINE",
  reconnecting: "RECONNECTING…",
  offline: "OFFLINE",
};

function connectionView() {
  const status = state.connectionStatus || "offline";
  const copy = CONNECTION_COPY[status] || CONNECTION_COPY.offline;
  return { status, copy };
}

function setDotMode(dot, online) {
  dot.classList.toggle("dot-green", online);
  dot.classList.toggle("dot-red", !online);
  dot.classList.toggle("blink", online);
}

function renderGlobalConnectionLabels(view) {
  const homeLabel = $("#home-connection-label");
  if (homeLabel) homeLabel.textContent = view.copy;
  document.querySelectorAll("[data-global-connection-label]").forEach((label) => {
    label.textContent = view.copy;
  });
}

function topNavOnlineText(view) {
  if (view.status !== "online") return view.copy;
  const count = state.players.filter((p) => p.online).length;
  return `${count} ONLINE`;
}

function renderTopNavConnection(view) {
  const gameLabel = $("#tn-online");
  if (gameLabel) gameLabel.textContent = topNavOnlineText(view);
}

function renderConnectionDots(view) {
  const online = view.status === "online";
  document.querySelectorAll("[data-global-online] .dot, #view-home .online .dot, #home-status-note .dot").forEach((dot) => {
    setDotMode(dot, online);
  });
}

function renderConnectionNote(view) {
  const note = $("#tn-connection-note");
  if (!note) return;
  note.dataset.connection = view.status;
  const text = note.querySelector(".t-micro");
  if (text) text.textContent = view.copy;
  const dot = note.querySelector(".dot");
  if (dot) setDotMode(dot, view.status === "online");
}

function homeConnectionText(view) {
  if (view.status === "online") return "LIVE SERVER · CREATE OR JOIN A ROOM · NO ACCOUNT REQUIRED";
  return `${view.copy} · ROOM ACTIONS WILL RETRY AUTOMATICALLY`;
}

function renderHomeConnectionNote(view) {
  const homeNote = $("#home-status-note");
  if (!homeNote) return;
  homeNote.dataset.connection = view.status;
  const text = homeNote.querySelector(".t-micro");
  if (text) text.textContent = homeConnectionText(view);
}

export function renderConnectionStatus() {
  const view = connectionView();
  renderGlobalConnectionLabels(view);
  renderTopNavConnection(view);
  renderConnectionDots(view);
  renderConnectionNote(view);
  renderHomeConnectionNote(view);
}

function roomCopyLabel(code, isPublic) {
  if (isPublic) return "Public room";
  if (code === "----") return "Room code unavailable";
  return `Copy room code ${code}`;
}

function renderRoomCopy(code, isPublic) {
  const btn = $("#tn-room-copy");
  if (!btn) return;
  btn.classList.toggle("is-public", isPublic);
  btn.disabled = isPublic;
  const label = roomCopyLabel(code, isPublic);
  btn.setAttribute("aria-label", label);
  btn.setAttribute("title", label);
}

function lobbyTagText(code, isPublic) {
  if (isPublic) return "AFTER HOURS · PUBLIC";
  return `AFTER HOURS ${code}`;
}

function turnTagText() {
  if (state.phase === "playing") return state.players[state.turnIndex].name;
  if (state.phase === "lobby") return "LOBBY";
  return "SETUP";
}

export function renderTopNav() {
  const code = state.roomCode || "----";
  const isPublic = state.roomVisibility === "public";
  $("#tn-room").textContent = isPublic ? "PUBLIC" : code;
  renderRoomCopy(code, isPublic);
  $("#tn-lobby").textContent = lobbyTagText(code, isPublic);
  const view = connectionView();
  $("#tn-online").textContent = topNavOnlineText(view);
  $("#tn-turnlabel").textContent = turnTagText();
  renderConnectionStatus();
}
