/* ============================================================
   HOME ENTRY BINDINGS: the "join a table" form, the room-code /
   nickname sanitising inputs and the guest-alias editor. They only
   mutate state.alias via the shared profile helpers; opening the
   parlor and closing the rooms modal are injected by the entry
   module (they live in the rooms/lobby cluster).
   ============================================================ */
import { $ } from "./clientDom.js";
import { state } from "./clientState.js";
import { saveGuestAlias } from "./clientSanitize.js";
import { applyProfileToHomeUI, renderGuestAliasField } from "./clientProfileRender.js";

let host = { closeRoomsModal: noop, enterParlor: noop };

function noop() {}

function setJoinError(message) {
  const error = $("#join-form-error");
  if (error) error.textContent = message;
}

function joinNicknameValue() {
  const nicknameInput = $("#join-nickname");
  const display = state.account?.account?.displayName || nicknameInput?.value || "";
  return String(display).trim().toUpperCase().replace(/[^A-Z0-9 _-]/g, "").slice(0, 12);
}

function resolveJoinCode() {
  const codeInput = $("#room-join");
  const code = String(codeInput?.value || "").trim().toUpperCase();
  if (!/^[A-Z0-9]{6}$/.test(code)) {
    setJoinError("ENTER A 6-CHARACTER ROOM CODE.");
    codeInput?.focus({ preventScroll: true });
    return null;
  }
  return code;
}

function resolveJoinNickname() {
  const nicknameInput = $("#join-nickname");
  const nickname = joinNicknameValue();
  if (!nickname) {
    setJoinError("ENTER THE PLAYER NAME FOR THIS ROOM.");
    nicknameInput?.focus({ preventScroll: true });
    return null;
  }
  return nickname;
}

function commitJoinAlias(nickname) {
  if (state.account?.account) state.alias = state.account.account.displayName;
  else state.alias = saveGuestAlias(nickname);
  applyProfileToHomeUI();
}

function onJoinFormSubmit(event) {
  event.preventDefault();
  const code = resolveJoinCode();
  if (!code) return;
  const nickname = resolveJoinNickname();
  if (!nickname) return;
  setJoinError("");
  commitJoinAlias(nickname);
  host.closeRoomsModal();
  host.enterParlor(code);
}

function onRoomJoinInput(event) {
  const cleaned = String(event.target.value || "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  event.target.value = cleaned.slice(0, 6);
  const error = $("#join-form-error");
  if (!error) return;
  if (cleaned.length > 6) {
    error.textContent = "ROOM CODES ARE 6 CHARACTERS — EXTRA CHARACTERS REMOVED.";
    return;
  }
  if (error.textContent.startsWith("ROOM CODES ARE 6")) error.textContent = "";
}

function onJoinNicknameInput(event) {
  event.target.value = event.target.value.toUpperCase().replace(/[^A-Z0-9 _-]/g, "").slice(0, 12);
  const error = $("#join-form-error");
  if (error) error.textContent = "";
}

function onHomeAliasSubmit(event) {
  event.preventDefault();
  const input = $("#home-alias");
  state.alias = saveGuestAlias(input?.value || "");
  renderGuestAliasField(state.alias ? "" : "CREATE AN ALIAS BEFORE JOINING A TABLE.");
  if (state.alias) $("#open-join-btn")?.focus({ preventScroll: true });
}

function onHomeAliasInput(event) {
  state.alias = String(event.target.value || "").toUpperCase().replace(/[^A-Z0-9 _-]/g, "").slice(0, 12);
  event.target.value = state.alias;
  saveGuestAlias(state.alias);
  renderGuestAliasField("");
  applyProfileToHomeUI();
}

export function bindHomeEntry(hooks) {
  host = { ...host, ...hooks };
  $("#join-form")?.addEventListener("submit", onJoinFormSubmit);
  $("#room-join")?.addEventListener("input", onRoomJoinInput);
  $("#join-nickname")?.addEventListener("input", onJoinNicknameInput);
  $("#home-alias-form")?.addEventListener("submit", onHomeAliasSubmit);
  $("#home-alias")?.addEventListener("input", onHomeAliasInput);
}
