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

function reelPockets(result) {
  const targetIndex = Math.max(18, Math.min(REEL_LENGTH - 8, Math.floor(safeNumber(result?.presentation?.targetIndex, 32))));
  const random = seeded(result?.presentation?.reelSeed || result?.transactionId || result?.spinId);
  const winningPocket = Math.max(0, Math.min(36, Math.floor(safeNumber(result?.pocket))));
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

export function startCasinoReel(root, result, { playTick, onDone } = {}) {
  if (!root) return;
  stopCasinoReel(root);
  const track = root.querySelector(".casino-reel-track");
  const viewport = root.querySelector(".casino-reel-viewport");
  const cards = [...root.querySelectorAll(".casino-reel-card")];
  const status = root.querySelector("[data-casino-reel-result]");
  if (!track || !viewport || !cards.length) {
    onDone?.();
    return;
  }
  let complete = false;
  let tickTimer = null;
  let animation = null;
  let finalOffset = 0;
  const form = root.closest(".casino-modal-body")?.querySelector("[data-casino-desk-form]");
  const skipButton = root.querySelector("[data-casino-skip]");
  const duration = Math.max(1200, Math.min(4200, Math.floor(safeNumber(result?.presentation?.durationMs, 4200))));
  const deadline = Math.max(Date.now(), Math.floor(safeNumber(result?.presentation?.revealDeadline, Date.now() + duration)));
  const finish = (skipped = false) => {
    if (complete) return;
    complete = true;
    if (tickTimer) clearTimeout(tickTimer);
    document.removeEventListener("visibilitychange", onVisibility);
    animation?.cancel?.();
    if (skipped && finalOffset) track.style.transform = "translate3d(" + finalOffset + "px, 0, 0)";
    form?.querySelectorAll("input, button").forEach(control => { control.disabled = false; });
    if (skipButton) {
      skipButton.disabled = true;
      skipButton.querySelector(".t-label")?.replaceChildren(document.createTextNode("REVEAL COMPLETE"));
    }
    root.dataset.reelState = skipped ? "skipped" : "settled";
    root.setAttribute("aria-busy", "false");
    root.classList.toggle("is-skipped", skipped);
    status.textContent = resultText(result);
    onDone?.();
  };
  const onVisibility = () => {
    if (!document.hidden && Date.now() >= deadline) finish(true);
  };
  activeReels.set(root, { finish });
  form?.querySelectorAll("input, button").forEach(control => { control.disabled = true; });
  root.dataset.reelState = "presenting";
  root.setAttribute("aria-busy", "true");
  skipButton?.addEventListener("click", () => finish(true), { once: true });
  const cardWidth = cards[0].getBoundingClientRect().width;
  const gap = safeNumber(parseFloat(getComputedStyle(track).gap), 6);
  const step = cardWidth + gap;
  const targetIndex = Math.max(0, Math.min(cards.length - 1, Math.floor(safeNumber(root.dataset.reelTarget, 32))));
  const paddingLeft = safeNumber(parseFloat(getComputedStyle(track).paddingLeft), 0);
  const offset = (viewport.clientWidth / 2) - (paddingLeft + targetIndex * step + cardWidth / 2);
  finalOffset = offset;
  if (Date.now() >= deadline || prefersReducedMotion() || typeof track.animate !== "function") {
    if (prefersReducedMotion()) root.classList.add("is-reduced-motion");
    track.style.transform = "translate3d(" + offset + "px, 0, 0)";
    finish(true);
    return;
  }
  track.style.transform = "translate3d(0, 0, 0)";
  animation = track.animate(
    [{ transform: "translate3d(0, 0, 0)" }, { transform: "translate3d(" + offset + "px, 0, 0)" }],
    { duration, easing: "cubic-bezier(0.23, 1, 0.32, 1)", fill: "forwards" }
  );
  animation.onfinish = () => finish(false);
  document.addEventListener("visibilitychange", onVisibility);
  let lastBoundary = -1;
  const tickLoop = () => {
    if (complete) return;
    const progress = Math.min(1, Math.max(0, 1 - ((deadline - Date.now()) / duration)));
    const eased = 1 - Math.pow(1 - progress, 3);
    const boundary = Math.min(targetIndex, Math.floor(eased * targetIndex));
    if (boundary > lastBoundary) {
      lastBoundary = boundary;
      playTick?.();
    }
    tickTimer = setTimeout(tickLoop, 45 + Math.round(progress * 150));
  };
  tickLoop();
}
