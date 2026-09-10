// Presentation-only roulette reel. The server has already settled the pocket;
// this module receives only that result and an opaque seed, so animation can
// never become a second source of randomness or cash mutation.
const RED_POCKETS = new Set([1, 3, 5, 7, 9, 12, 14, 16, 18, 19, 21, 23, 25, 27, 30, 32, 34, 36]);
const REEL_LENGTH = 45;
const activeReels = new WeakMap();

function pocketColor(pocket) {
  if (pocket === 0) return "green";
  return RED_POCKETS.has(pocket) ? "red" : "black";
}

function seeded(seed) {
  let hash = 2166136261;
  String(seed || "poorup-reel").split("").forEach(char => {
    hash ^= char.charCodeAt(0);
    hash = Math.imul(hash, 16777619);
  });
  return () => {
    hash = Math.imul(hash ^ (hash >>> 15), 2246822519);
    hash = Math.imul(hash ^ (hash >>> 13), 3266489917);
    return ((hash ^= hash >>> 16) >>> 0) / 4294967296;
  };
}

function safeNumber(value, fallback = 0) {
  const number = Number(value);
  return Number.isFinite(number) ? number : fallback;
}

function resultText(result) {
  const color = String(result?.resultColor || pocketColor(safeNumber(result?.pocket))).toUpperCase();
  const pocket = safeNumber(result?.pocket);
  const net = safeNumber(result?.net);
  return "SETTLED · " + color + " " + pocket + " · " + (net >= 0 ? "+" : "") + "$" + net.toLocaleString();
}

function pocketCardHTML(pocket, target) {
  const color = pocketColor(pocket);
  const label = pocket === 0 ? "00" : String(pocket);
  return '<span class="casino-reel-card casino-reel-card-' + color + (target ? " is-target" : "") + '" data-pocket="' + label + '"><strong>' + label + '</strong><small>' + color.toUpperCase() + '</small></span>';
}

function reelTargetIndex(result) {
  return Math.max(18, Math.min(REEL_LENGTH - 8, Math.floor(safeNumber(result?.presentation?.targetIndex, 32))));
}

function reelWinningPocket(result) {
  return Math.max(0, Math.min(36, Math.floor(safeNumber(result?.pocket))));
}

function reelPockets(result) {
  const targetIndex = reelTargetIndex(result);
  const random = seeded(result?.presentation?.reelSeed || result?.transactionId || result?.spinId);
  const winningPocket = reelWinningPocket(result);
  const pockets = Array.from({ length: REEL_LENGTH }, () => Math.floor(random() * 37));
  pockets[targetIndex] = winningPocket;
  return { pockets, targetIndex };
}

export function casinoReelHTML(result) {
  const { pockets, targetIndex } = reelPockets(result);
  const cards = pockets.map((pocket, index) => pocketCardHTML(pocket, index === targetIndex)).join("");
  return '<section class="casino-reel" data-casino-reel data-reel-spin="' + String(result?.spinId || result?.transactionId || "") + '" data-reel-target="' + targetIndex + '" aria-label="Roulette reveal">' +
    '<div class="casino-reel-viewport"><div class="casino-reel-track">' + cards + '</div><span class="casino-reel-pointer" aria-hidden="true"><img src="/assets/casino-reel-pointer.svg" alt="" width="16" height="16"></span></div>' +
    '<div class="casino-reel-status"><span class="t-micro g400">SERVER SETTLED · REVEAL ONLY</span><p class="t-body ink-2" data-casino-reel-result aria-live="polite">Result committed. Revealing the pocket…</p><button class="btn-dark casino-reel-skip" type="button" data-casino-skip><span class="t-label f11">SKIP REVEAL</span></button></div>' +
    '</section>';
}

function prefersReducedMotion() {
  return Boolean(typeof window !== "undefined" && window.matchMedia?.("(prefers-reduced-motion: reduce)").matches);
}

export function stopCasinoReel(root) {
  const active = root && activeReels.get(root);
  active?.finish(true);
}

function reelParts(root) {
  const track = root.querySelector(".casino-reel-track");
  const viewport = root.querySelector(".casino-reel-viewport");
  const cards = [...root.querySelectorAll(".casino-reel-card")];
  const status = root.querySelector("[data-casino-reel-result]");
  if (!reelPartsComplete(track, viewport, cards, status)) return null;
  return { track, viewport, cards, status };
}

function reelPartsComplete(track, viewport, cards, status) {
  if (!track) return false;
  if (!viewport) return false;
  if (!cards.length) return false;
  return Boolean(status);
}

function clearReelTimer(context) {
  if (context.tickTimer) clearTimeout(context.tickTimer);
}

function applyReelFinalOffset(context, skipped) {
  if (skipped && context.finalOffset) context.track.style.transform = "translate3d(" + context.finalOffset + "px, 0, 0)";
}

function completeReelSkipButton(context) {
  if (!context.skipButton) return;
  context.skipButton.disabled = true;
  context.skipButton.querySelector(".t-label")?.replaceChildren(document.createTextNode("REVEAL COMPLETE"));
}

function finishCasinoReel(context, skipped = false) {
  if (context.complete) return;
  context.complete = true;
  clearReelTimer(context);
  document.removeEventListener("visibilitychange", context.onVisibility);
  context.animation?.cancel?.();
  applyReelFinalOffset(context, skipped);
  context.form?.querySelectorAll("input, button").forEach(control => { control.disabled = false; });
  completeReelSkipButton(context);
  context.root.dataset.reelState = skipped ? "skipped" : "settled";
  context.root.setAttribute("aria-busy", "false");
  context.root.classList.toggle("is-skipped", skipped);
  context.status.textContent = resultText(context.result);
  context.onDone?.();
}

function reelOffset(parts, root) {
  const cardWidth = parts.cards[0].getBoundingClientRect().width;
  const gap = safeNumber(parseFloat(getComputedStyle(parts.track).gap), 6);
  const step = cardWidth + gap;
  const targetIndex = Math.max(0, Math.min(parts.cards.length - 1, Math.floor(safeNumber(root.dataset.reelTarget, 32))));
  const paddingLeft = safeNumber(parseFloat(getComputedStyle(parts.track).paddingLeft), 0);
  const offset = (parts.viewport.clientWidth / 2) - (paddingLeft + targetIndex * step + cardWidth / 2);
  return { offset, targetIndex };
}

function shouldSkipReel(context) {
  return Date.now() >= context.deadline || prefersReducedMotion() || typeof context.track.animate !== "function";
}

function presentReelImmediately(context, offset) {
  if (prefersReducedMotion()) context.root.classList.add("is-reduced-motion");
  context.track.style.transform = "translate3d(" + offset + "px, 0, 0)";
  context.finish(true);
}

function scheduleReelTicks(context) {
  let lastBoundary = -1;
  const tickLoop = () => {
    if (context.complete) return;
    const progress = Math.min(1, Math.max(0, 1 - ((context.deadline - Date.now()) / context.duration)));
    const eased = 1 - Math.pow(1 - progress, 3);
    const boundary = Math.min(context.targetIndex, Math.floor(eased * context.targetIndex));
    if (boundary > lastBoundary) {
      lastBoundary = boundary;
      context.playTick?.();
    }
    context.tickTimer = setTimeout(tickLoop, 45 + Math.round(progress * 150));
  };
  tickLoop();
}

function animateReel(context, offset) {
  context.track.style.transform = "translate3d(0, 0, 0)";
  context.animation = context.track.animate(
    [{ transform: "translate3d(0, 0, 0)" }, { transform: "translate3d(" + offset + "px, 0, 0)" }],
    { duration: context.duration, easing: "cubic-bezier(0.23, 1, 0.32, 1)", fill: "forwards" }
  );
  context.animation.onfinish = () => context.finish(false);
  document.addEventListener("visibilitychange", context.onVisibility);
  scheduleReelTicks(context);
}

function createReelContext({ root, result, parts, playTick, onDone }) {
  const duration = Math.max(1200, Math.min(4200, Math.floor(safeNumber(result?.presentation?.durationMs, 4200))));
  const deadline = Math.max(Date.now(), Math.floor(safeNumber(result?.presentation?.revealDeadline, Date.now() + duration)));
  const context = {
    ...parts,
    parts,
    root,
    result,
    duration,
    deadline,
    form: root.closest(".casino-modal-body")?.querySelector("[data-casino-desk-form]"),
    skipButton: root.querySelector("[data-casino-skip]"),
    playTick,
    onDone,
    complete: false,
    tickTimer: null,
    animation: null,
    finalOffset: 0,
    targetIndex: 0,
    onVisibility: null,
    finish: null,
  };
  context.onVisibility = () => {
    if (!document.hidden && Date.now() >= context.deadline) context.finish(true);
  };
  context.finish = skipped => finishCasinoReel(context, skipped);
  return context;
}

function prepareReel(context) {
  const { root, parts } = context;
  context.form?.querySelectorAll("input, button").forEach(control => { control.disabled = true; });
  root.dataset.reelState = "presenting";
  root.setAttribute("aria-busy", "true");
  context.skipButton?.addEventListener("click", () => context.finish(true), { once: true });
  const measurements = reelOffset(parts, root);
  context.finalOffset = measurements.offset;
  context.targetIndex = measurements.targetIndex;
  return measurements.offset;
}

export function startCasinoReel(root, result, { playTick, onDone } = {}) {
  if (!root) return;
  stopCasinoReel(root);
  const parts = reelParts(root);
  if (!parts) {
    onDone?.();
    return;
  }
  const context = createReelContext({ root, result, parts, playTick, onDone });
  activeReels.set(root, context);
  const offset = prepareReel(context);
  if (shouldSkipReel(context)) {
    presentReelImmediately(context, offset);
    return;
  }
  animateReel(context, offset);
}
