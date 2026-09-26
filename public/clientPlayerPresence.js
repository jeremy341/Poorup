export const VISIBLE_IDLE_MS = 30_000;

const INPUT_EVENTS = ["pointermove", "mousemove", "keydown", "click", "touchstart"];

export function createPresenceMonitor({
  document = globalThis.document,
  window = globalThis.window,
  emit = () => {},
  schedule = setTimeout,
  cancel = clearTimeout,
  idleMs = VISIBLE_IDLE_MS,
} = {}) {
  if (!document || !window) throw new TypeError("A document and window are required");

  let presence = "active";
  let idleTimer = null;
  let destroyed = false;

  const stopIdleTimer = () => {
    if (idleTimer !== null) cancel(idleTimer);
    idleTimer = null;
  };

  const transition = (next, reason) => {
    if (destroyed || presence === next) return;
    presence = next;
    emit("player-presence", reason ? { state: next, reason } : { state: next });
  };

  const startIdleTimer = () => {
    stopIdleTimer();
    if (document.visibilityState !== "visible") return;
    idleTimer = schedule(() => {
      idleTimer = null;
      if (document.visibilityState === "visible") transition("inactive", "idle");
    }, idleMs);
  };

  const onActivity = () => {
    if (document.visibilityState !== "visible") return;
    transition("active");
    startIdleTimer();
  };

  const onVisibilityChange = () => {
    if (document.visibilityState === "hidden") {
      stopIdleTimer();
      transition("inactive", "hidden");
      return;
    }
    transition("active");
    startIdleTimer();
  };

  document.addEventListener("visibilitychange", onVisibilityChange);
  for (const eventName of INPUT_EVENTS) window.addEventListener(eventName, onActivity, { passive: true });
  if (document.visibilityState === "visible") startIdleTimer();
  else transition("inactive", "hidden");

  return {
    destroy() {
      if (destroyed) return;
      destroyed = true;
      stopIdleTimer();
      document.removeEventListener("visibilitychange", onVisibilityChange);
      for (const eventName of INPUT_EVENTS) window.removeEventListener(eventName, onActivity);
    },
    getState() { return presence; },
  };
}
