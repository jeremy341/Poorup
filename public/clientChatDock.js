// CHAT DOCK: the left-rail chat is a closed bar with an unread badge
// until the player opens it. Messages keep rendering into #chat-body
// either way; the dock only owns open/closed and the badge.
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

// Unread messages since the panel was last open; a new room starts from its current count.
function trackUnread(count) {
  if (state.roomCode !== seenRoom) {
    seenRoom = state.roomCode;
    seenCount = count;
  }
  if (open) seenCount = count;
  return Math.max(0, count - seenCount);
}

function syncUnreadBadge(unread) {
  const badge = $("#chat-unread");
  if (!badge) return;
  badge.hidden = open || unread === 0;
  setText(badge, unread > 9 ? "9+" : String(unread));
}

function bindChatToggleOnce(toggle) {
  if (bound) return;
  bound = true;
  toggle.addEventListener("click", () => setOpen(!open));
}

export function renderChatDock() {
  const panel = $(".chat-panel");
  const toggle = $("#chat-toggle");
  if (!panel || !toggle) return;
  const unread = trackUnread(state.messages?.length || 0);
  panel.classList.toggle("is-collapsed", !open);
  toggle.setAttribute("aria-expanded", String(open));
  syncUnreadBadge(unread);
  toggle.setAttribute("aria-label", unread > 0 && !open ? `Parlor chat, ${unread} unread` : "Parlor chat");
  bindChatToggleOnce(toggle);
}
