import { createMusicPlayer } from "./clientMusicPlayer.js";

export const MUSIC_POSITIONS = Object.freeze(["top-left", "top-right", "bottom-left", "bottom-right"]);
const ACTIONS = Object.freeze({ previous: "previous", play: "togglePlay", next: "next", shuffle: "toggleShuffle", repeat: "toggleLoop" });
const POSITION_KEY = "poorup.music.position.v1";

export function sanitizeMusicPosition(value) {
  return MUSIC_POSITIONS.includes(value) ? value : "bottom-left";
}

export function snapMusicPosition(x, y, width, height, margin = 16) {
  const horizontal = Number(x) <= Number(width) / 2 ? "left" : "right";
  const vertical = Number(y) <= Number(height) / 2 ? "top" : "bottom";
  return sanitizeMusicPosition(`${vertical}-${horizontal}`);
}

const formatTime = (seconds) => {
  const value = Math.max(0, Number(seconds) || 0);
  return `${String(Math.floor(value / 60)).padStart(2, "0")}:${String(Math.floor(value % 60)).padStart(2, "0")}`;
};

export function mountMusicBoxUi(root = document.querySelector("[data-music-box]"), controller = null) {
  if (!root) return null;
  const audioA = root.querySelector('audio[data-music-audio="a"]');
  const audioB = root.querySelector('audio[data-music-audio="b"]');
  let player = controller || createMusicPlayer({
    audioA,
    audioB,
    storage: typeof localStorage === "undefined" ? {} : localStorage,
    announce: (message) => { const status = root.querySelector("[data-music-status]"); if (status) status.textContent = message; },
  });
  const volumeButton = root.querySelector('[data-music-action="volume"]');
  const volumePopover = root.querySelector("#music-volume-popover");
  const positionButton = root.querySelector('[data-music-action="position"]');
  const positionMenu = root.querySelector("#music-position-menu");
  let lastOpener = null;
  let dragStart = null;
  const storage = typeof localStorage === "undefined" ? null : localStorage;
  const savedPosition = (() => { try { return storage?.getItem(POSITION_KEY); } catch { return null; } })();
  root.dataset.position = sanitizeMusicPosition(savedPosition || root.dataset.position);
  const setOpen = (element, button, open) => { element.hidden = !open; button?.setAttribute("aria-expanded", String(open)); if (open) lastOpener = button; };
  const closePopovers = () => { setOpen(volumePopover, volumeButton, false); setOpen(positionMenu, positionButton, false); };
  const setPosition = (value) => {
    const position = sanitizeMusicPosition(value);
    root.dataset.position = position;
    try { storage?.setItem(POSITION_KEY, position); } catch { /* storage can be unavailable */ }
    setOpen(positionMenu, positionButton, false);
  };
  const render = () => {
    const state = player?.snapshot?.();
    if (!state) return;
    root.querySelector("[data-music-title]").textContent = String(state.title || "PONDERING THE COSMOS").toUpperCase();
    root.querySelector("[data-music-mode]").textContent = `${state.mode || "AUTO THEME"} · ${String(state.theme || "original").toUpperCase()}`;
    root.querySelector("[data-music-elapsed]").textContent = formatTime(state.currentTime);
    root.querySelector("[data-music-status]").textContent = state.status === "autoplay-blocked" ? "CLICK TO START MUSIC" : String(state.status || "");
    root.querySelector('[data-music-action="shuffle"]').setAttribute("aria-pressed", String(Boolean(state.shuffle)));
    root.querySelector('[data-music-action="repeat"]').setAttribute("aria-pressed", String(Boolean(state.loop)));
    const audio = root.querySelector('audio[data-music-audio="a"]');
    const duration = Number(audio?.duration) || 0;
    root.querySelector("[data-music-remaining]").textContent = formatTime(Math.max(0, duration - (state.currentTime || 0)));
  };
  root.addEventListener("click", (event) => {
    const button = event.target.closest?.("button[data-music-action]");
    if (button) {
      const action = button.dataset.musicAction;
      if (action === "volume") { setOpen(volumePopover, volumeButton, volumePopover.hidden); setOpen(positionMenu, positionButton, false); return; }
      if (action === "position") { setOpen(positionMenu, positionButton, positionMenu.hidden); setOpen(volumePopover, volumeButton, false); return; }
      if (action === "play") {
        if (player?.togglePlay) player.togglePlay(); else root.dispatchEvent(new CustomEvent("music-box-play", { bubbles: true }));
      } else if (player?.[ACTIONS[action]]) player[ACTIONS[action]]();
      render(); return;
    }
    const position = event.target.closest?.("[data-music-position]");
    if (position) setPosition(position.dataset.musicPosition);
  });
  root.addEventListener("input", (event) => { if (event.target.matches("#music-volume")) { player?.setVolume?.(event.target.value); render(); } });
  root.addEventListener("keydown", (event) => {
    if (event.target.matches?.("#music-volume")) {
      const input = event.target;
      const step = Number(input.step) || 0.01;
      const current = Number(input.value) || 0;
      if (["ArrowUp", "ArrowRight", "ArrowDown", "ArrowLeft", "Home", "End"].includes(event.key)) {
        if (event.key === "ArrowUp" || event.key === "ArrowRight") input.value = String(Math.min(Number(input.max) || 1, current + step));
        if (event.key === "ArrowDown" || event.key === "ArrowLeft") input.value = String(Math.max(Number(input.min) || 0, current - step));
        if (event.key === "Home") input.value = input.min;
        if (event.key === "End") input.value = input.max;
        player?.setVolume?.(input.value); render(); event.preventDefault();
      }
    }
    if (!positionMenu.hidden && event.target.matches?.('[role="menuitem"]')) {
      const items = [...positionMenu.querySelectorAll('[role="menuitem"]')];
      const index = items.indexOf(event.target);
      if (event.key === "ArrowDown" || event.key === "ArrowRight") { event.preventDefault(); items[(index + 1) % items.length]?.focus(); }
      if (event.key === "ArrowUp" || event.key === "ArrowLeft") { event.preventDefault(); items[(index - 1 + items.length) % items.length]?.focus(); }
      if (event.key === "Home" || event.key === "End") { event.preventDefault(); items[event.key === "Home" ? 0 : items.length - 1]?.focus(); }
      if (event.key === "Enter" || event.key === " ") { event.preventDefault(); setPosition(event.target.dataset.musicPosition); lastOpener?.focus?.(); }
    }
  });
  root.addEventListener("pointerdown", (event) => {
    if (event.target.closest?.("[data-music-action=position]")) dragStart = { x: event.clientX, y: event.clientY };
  });
  root.addEventListener("pointerup", (event) => {
    if (!dragStart) return;
    const moved = Math.abs(event.clientX - dragStart.x) + Math.abs(event.clientY - dragStart.y);
    if (moved > 8) setPosition(snapMusicPosition(event.clientX, event.clientY, window.innerWidth, window.innerHeight));
    dragStart = null;
  });
  document.addEventListener("pointerdown", (event) => {
    if (!root.contains(event.target) && (!volumePopover.hidden || !positionMenu.hidden)) { closePopovers(); }
  });
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const open = !volumePopover.hidden || !positionMenu.hidden;
    if (!open) return;
    closePopovers(); lastOpener?.focus?.(); event.stopPropagation();
  });
  root.querySelectorAll("audio[data-music-audio]").forEach((audio) => audio.addEventListener("timeupdate", render));
  render();
  return { setController(next) { player = next; render(); }, render, root };
}

if (typeof document !== "undefined") mountMusicBoxUi();
