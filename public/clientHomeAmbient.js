/* ============================================================
   HOME AMBIENT: the parlor-patrol easter egg (a helicopter fly-by you
   can tag), the home local-time clock and the SFX ping. Purely visual
   and timer-based; reads clientState only. hitHomeHelicopter is wired
   from the home bindings; the clock/helicopter controls are shared with
   the surface navigation and the night-shift host.
   ============================================================ */
import { $, REDUCED_MOTION } from "./clientDom.js";
import { state } from "./clientState.js";

const PATROL_BEST_KEY = "poorup.parlor-patrol.best.v1";
let homeHelicopterTimer = null;
let homeHelicopterFlightTimer = null;
let homePatrolStatusTimer = null;
let homeClockTimer = null;
let patrolHitAudio = null;
const patrolState = { score: 0, best: 0, active: false };
try { patrolState.best = Number(localStorage.getItem(PATROL_BEST_KEY)) || 0; } catch { /* storage unavailable */ }

export function renderPatrolHud(status = "STANDBY · FLY-BYS OCCASIONAL") {
  const score = $("#home-patrol-score");
  const label = $("#home-patrol-status");
  if (score) score.textContent = String(patrolState.score).padStart(3, "0");
  if (label) label.textContent = status;
}

export function renderHomeLocalTime() {
  const clock = $("#home-local-time");
  if (!clock) return;
  const now = new Date();
  clock.textContent = now.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", hour12: false });
  clock.dateTime = now.toISOString();
}

export function startHomeClock() {
  clearInterval(homeClockTimer);
  renderHomeLocalTime();
  homeClockTimer = setInterval(renderHomeLocalTime, 15000);
}

export function stopHomeClock() {
  clearInterval(homeClockTimer);
  homeClockTimer = null;
}

export function playPatrolHitSound() {
  if (!state.sound) return;
  try {
    patrolHitAudio = patrolHitAudio || new Audio("/assets/audio/parlor-patrol/pixel-hit-pack-cc0.wav");
    patrolHitAudio.volume = 0.32;
    patrolHitAudio.currentTime = 0;
    patrolHitAudio.play().catch(() => { /* browser gesture policy */ });
  } catch { /* audio unavailable */ }
}

function clearPatrolEffect(selector) {
  const effect = $(selector);
  if (!effect) return;
  effect.classList.remove("is-burst");
  effect.style.removeProperty("left");
  effect.style.removeProperty("top");
}

function hideHomeHelicopter() {
  const helicopter = $("#home-helicopter");
  if (!helicopter) return;
  helicopter.classList.remove("is-flying", "is-hit", "home-helicopter-left");
  const art = $("#home-helicopter-art");
  if (art) art.src = "/assets/parlor-patrol/helicopter-16-frames.svg";
  helicopter.setAttribute("aria-hidden", "true");
  helicopter.tabIndex = -1;
  helicopter.blur();
}

export function stopHomeHelicopter() {
  clearTimeout(homeHelicopterTimer);
  clearTimeout(homeHelicopterFlightTimer);
  clearTimeout(homePatrolStatusTimer);
  homeHelicopterTimer = null;
  homeHelicopterFlightTimer = null;
  homePatrolStatusTimer = null;
  patrolState.active = false;
  hideHomeHelicopter();
  clearPatrolEffect("#home-patrol-impact");
  clearPatrolEffect("#home-patrol-smoke");
}

function setHomeHelicopterArt(direction) {
  const art = $("#home-helicopter-art");
  if (!art) return;
  art.src = direction === "left"
    ? "/assets/parlor-patrol/helicopter-left-16-frames.svg"
    : "/assets/parlor-patrol/helicopter-16-frames.svg";
}

function endHomeHelicopterFlight() {
  if (!patrolState.active) return;
  patrolState.active = false;
  hideHomeHelicopter();
  renderPatrolHud("FLY-BY MISSED · NEXT ONE SOON");
  homePatrolStatusTimer = setTimeout(() => renderPatrolHud(), 2200);
  scheduleHomeHelicopter(12000);
}

function launchHomeHelicopter() {
  if (state.phase !== "home") return;
  const helicopter = $("#home-helicopter");
  if (!helicopter) return;
  patrolState.active = true;
  const direction = Math.random() < 0.5 ? "left" : "right";
  setHomeHelicopterArt(direction);
  helicopter.classList.toggle("home-helicopter-left", direction === "left");
  helicopter.style.top = `${[12, 17, 22, 27, 32][Math.floor(Math.random() * 5)]}%`;
  helicopter.setAttribute("aria-hidden", "false");
  helicopter.tabIndex = 0;
  helicopter.classList.remove("is-hit", "is-flying");
  void helicopter.offsetWidth;
  helicopter.classList.add("is-flying");
  renderPatrolHud("FLY-BY ACTIVE · CLICK TO TAG");
  homeHelicopterFlightTimer = setTimeout(endHomeHelicopterFlight, REDUCED_MOTION ? 6000 : 18000);
}

export function scheduleHomeHelicopter(delay = 4000) {
  clearTimeout(homeHelicopterTimer);
  homeHelicopterTimer = null;
  if (state.phase !== "home") return;
  homeHelicopterTimer = setTimeout(launchHomeHelicopter, delay);
}

export function hitHomeHelicopter() {
  if (!patrolState.active || state.phase !== "home") return;
  const helicopter = $("#home-helicopter");
  const atmosphere = $(".home-sky-atmosphere");
  if (!helicopter || !atmosphere) return;
  patrolState.active = false;
  clearTimeout(homeHelicopterFlightTimer);
  homeHelicopterFlightTimer = null;
  const targetRect = helicopter.getBoundingClientRect();
  const atmosphereRect = atmosphere.getBoundingClientRect();
  const effectLeft = targetRect.left - atmosphereRect.left + targetRect.width / 2;
  const effectTop = targetRect.top - atmosphereRect.top + targetRect.height / 2;
  const impact = $("#home-patrol-impact");
  const smoke = $("#home-patrol-smoke");
  if (impact) {
    impact.style.left = `${Math.round(effectLeft - 32)}px`;
    impact.style.top = `${Math.round(effectTop - 32)}px`;
    impact.classList.remove("is-burst");
    void impact.offsetWidth;
    impact.classList.add("is-burst");
  }
  if (smoke) {
    smoke.style.left = `${Math.round(effectLeft - 40)}px`;
    smoke.style.top = `${Math.round(effectTop - 30)}px`;
    smoke.classList.remove("is-burst");
    void smoke.offsetWidth;
    smoke.classList.add("is-burst");
  }
  patrolState.score += 100;
  patrolState.best = Math.max(patrolState.best, patrolState.score);
  try { localStorage.setItem(PATROL_BEST_KEY, String(patrolState.best)); } catch { /* storage unavailable */ }
  playPatrolHitSound();
  hideHomeHelicopter();
  renderPatrolHud(`TAGGED +100 · BEST ${String(patrolState.best).padStart(3, "0")}`);
  homePatrolStatusTimer = setTimeout(() => renderPatrolHud(), 2400);
  setTimeout(() => {
    clearPatrolEffect("#home-patrol-impact");
    clearPatrolEffect("#home-patrol-smoke");
  }, 900);
  scheduleHomeHelicopter(9000);
}
