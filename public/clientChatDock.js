/* ============================================================
   CHAT DOCK: the left-rail chat is a closed bar with an unread badge
   until the player opens it. Messages keep rendering into #chat-body
   either way; this module only owns open/closed and the badge.
   ============================================================ */
import { $, setText } from "./clientDom.js";
import { state } from "./clientState.js";

const STORAGE_KEY = "poorup.chatOpen";
let open = readStoredOpen();
let seenCount = 0;
let seenRoom = null;
let bound = false;

function readStoredOpen() {
  try {
    return globalThis.sessionStorage?.getItem(STORAGE_KEY) === "1";
  } catch {
    return false;
  }
}

function storeOpen(value) {
  try {
    globalThis.sessionStorage?.setItem(STORAGE_KEY, value ? "1" : "0");
  } catch {
    /* private mode: the dock simply starts closed next time */
  }
}

function setOpen(next) {
  open = next;
  storeOpen(next);
  renderChatDock();
  if (next) $("#chat-input")?.focus({ preventScroll: true });
}

export function renderChatDock() {
  const panel = $(".chat-panel");
  const toggle = $("#chat-toggle");
  if (!panel || !toggle) return;
  const count = state.messages?.length || 0;
  if (state.roomCode !== seenRoom) {
    seenRoom = state.roomCode;
    seenCount = count;
  }
  if (open) seenCount = count;
  const unread = Math.max(0, count - seenCount);
  panel.classList.toggle("is-collapsed", !open);
  toggle.setAttribute("aria-expanded", String(open));
  const badge = $("#chat-unread");
  if (badge) {
    badge.hidden = open || unread === 0;
    setText(badge, unread > 9 ? "9+" : String(unread));
  }
  toggle.setAttribute("aria-label", unread > 0 && !open ? `Parlor chat, ${unread} unread` : "Parlor chat");
  if (!bound) {
    bound = true;
    toggle.addEventListener("click", () => setOpen(!open));
  }
}
