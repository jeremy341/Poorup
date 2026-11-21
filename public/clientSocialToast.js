// SOCIAL TOASTS: the parlor notification announcer, toast element factory and
// hover/focus-aware auto-dismiss lifecycle shared by every surface.
import { $ } from "./clientDom.js";
import { announceSystemLine } from "./clientAnnouncer.js";

export function announceSocialNotification(n) {
  const kind = notificationKind(n);
  const copy = notificationCopy(n);
  announceToScreenReaders(copy.label, copy.detail, kind.isError);
  const stack = $("#toast-stack");
  if (!stack) return;
  mountParlorToast(stack, kind.kind, copy, kind.isError);
}

function notificationKind(n) {
  const kind = String(n?.kind || "");
  return { kind, isError: kind === "parlor-error" };
}

function notificationCopy(n) {
  const label = String(n?.title || "Parlor Notice").toUpperCase();
  const detail = String(n?.message || n?.body || "").replace(/\s+/g, " ");
  return { label, detail };
}

function announcementText(label, detail) {
  if (!detail) return label;
  return `${label}. ${detail}`;
}

// The toast stack is not a live region, so this is the only path screen readers hear a notice on:
// errors go to the assertive announcer alone, everything else to the queued polite announcer.
function announceToScreenReaders(label, detail, isError) {
  const text = announcementText(label, detail);
  if (!isError) {
    announceSystemLine(text);
    return;
  }
  const errorAnnouncer = $("#error-announcer");
  if (errorAnnouncer) errorAnnouncer.textContent = text;
}

function toastClass(kind, isError) {
  const mythical = kind === "mythical-achievement" ? " is-mythical" : "";
  const errorCls = isError ? " is-error" : "";
  const warningCls = kind === "parlor-warning" ? " is-warning" : "";
  return `parlor-toast${mythical}${errorCls}${warningCls}`;
}

function toastEl(tag, cls) {
  const node = document.createElement(tag);
  if (cls) node.className = cls;
  return node;
}

function toastTitleEl(label, isError) {
  const title = toastEl("strong", "t-label f11 parlor-toast-title");
  if (isError) title.appendChild(toastGlyphEl());
  title.append(document.createTextNode(label));
  return title;
}

function toastGlyphEl() {
  const glyph = toastEl("span", "parlor-toast-glyph");
  glyph.setAttribute("aria-hidden", "true");
  glyph.innerHTML = '<svg viewBox="0 0 12 12" focusable="false" shape-rendering="crispEdges"><path fill="currentColor" fill-rule="evenodd" d="M5 1h2l1 2 1 2 1 2 1 2 1 3H0l1-3 1-2 1-2 1-2zM5 4h2v3H5zm0 4h2v2H5z"/></svg>';
  return glyph;
}

function toastBodyEl(detail) {
  const body = toastEl("span", "t-body f12 parlor-toast-body");
  body.textContent = detail;
  return body;
}

function toastDismissEl() {
  const dismiss = toastEl("button", "parlor-toast-close");
  dismiss.type = "button";
  dismiss.setAttribute("aria-label", "Dismiss notification");
  dismiss.textContent = "×";
  return dismiss;
}

// Errors never auto-dismiss: they stay until the player closes them. Returns null for "no timer".
function autoDismissMs(kind, isError) {
  if (isError) return null;
  if (kind === "mythical-achievement") return 6500;
  return 4200;
}

// A dismissed-on-a-timer toast that is being read must not vanish. Hover or focus anywhere inside
// the toast pauses the countdown; leaving resumes it with the time that was left (never less than
// TOAST_MIN_RESUME_MS, so it does not blink out the instant the pointer leaves).
const TOAST_MIN_RESUME_MS = 1200;

function armToastTimer(toast, dismissToast) {
  clearTimeout(toast._autoTimer);
  toast._autoTimer = null;
  if (toast._remainingMs == null) return;
  toast._armedAt = Date.now();
  toast._autoTimer = setTimeout(dismissToast, toast._remainingMs);
}

function pauseToastTimer(toast) {
  if (toast._autoTimer == null) return;
  clearTimeout(toast._autoTimer);
  toast._autoTimer = null;
  toast._remainingMs = Math.max(TOAST_MIN_RESUME_MS, toast._remainingMs - (Date.now() - toast._armedAt));
}

function bindToastPause(toast, dismissToast) {
  let hovered = false;
  let focused = false;
  const sync = () => {
    if (hovered || focused) pauseToastTimer(toast);
    else if (toast._autoTimer == null && !toast.classList.contains("is-leaving")) armToastTimer(toast, dismissToast);
  };
  toast.addEventListener("mouseenter", () => { hovered = true; sync(); });
  toast.addEventListener("mouseleave", () => { hovered = false; sync(); });
  toast.addEventListener("focusin", () => { focused = true; sync(); });
  toast.addEventListener("focusout", (event) => {
    if (event.relatedTarget && toast.contains(event.relatedTarget)) return;
    focused = false;
    sync();
  });
}

// Keep in step with the 150ms parlor-toast-out animation in public/css/17-popups-rules-social-and-rankings.css. The node is removed on
// animationend; the timer is the safety net for reduced motion, background tabs and no-CSS runs.
const TOAST_EXIT_SAFETY_MS = 220;

function dismissToastLater(toast) {
  if (!toast.isConnected) return;
  if (toast.classList.contains("is-leaving")) return;
  clearTimeout(toast._autoTimer);
  toast.classList.add("is-leaving");
  syncToastStack();
  let safety = null;
  const remove = () => {
    clearTimeout(safety);
    toast.remove();
  };
  toast.addEventListener("animationend", (event) => {
    if (event.target === toast && event.animationName === "parlor-toast-out") remove();
  });
  safety = setTimeout(remove, TOAST_EXIT_SAFETY_MS);
}

function trimToastStack(stack) {
  while (stack.children.length > 4) stack.firstElementChild.remove();
}

function mountParlorToast(stack, kind, copy, isError) {
  const toast = toastEl("div");
  toast.className = toastClass(kind, isError);
  const title = toastTitleEl(copy.label, isError);
  const body = toastBodyEl(copy.detail);
  const dismiss = toastDismissEl();
  const dismissToast = () => dismissToastLater(toast);
  toast.append(title, body, dismiss);
  toast.addEventListener("click", dismissToast);
  dismiss.addEventListener("click", (event) => {
    event.stopPropagation();
    dismissToast();
  });
  stack.append(toast);
  trimToastStack(stack);
  syncToastStack();
  toast._remainingMs = autoDismissMs(kind, isError);
  armToastTimer(toast, dismissToast);
  bindToastPause(toast, dismissToast);
}

function syncToastStack() {
  const stack = $("#toast-stack");
  if (!stack) return;
  Array.from(stack.children)
    .filter((toast) => !toast.classList.contains("is-leaving"))
    .forEach((toast, index) => toast.style.setProperty("--toasts-before", String(index)));
}

// Severity is explicit: info is the neutral default, warning is amber, and error is always red.
const NOTICE_KIND_BY_SEVERITY = { info: "parlor-info", warning: "parlor-warning", error: "parlor-error" };

export function parlorNotice(title, message, severity = "info") {
  announceSocialNotification({ kind: NOTICE_KIND_BY_SEVERITY[severity] || NOTICE_KIND_BY_SEVERITY.info, title, message });
}
