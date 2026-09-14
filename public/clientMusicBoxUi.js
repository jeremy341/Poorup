const ACTIONS = Object.freeze({ previous: "previous", play: "togglePlay", next: "next", shuffle: "toggleShuffle", repeat: "toggleLoop" });

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
  const setOpen = (element, button, open) => { element.hidden = !open; button?.setAttribute("aria-expanded", String(open)); if (open) lastOpener = button; };
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
    if (position) { root.dataset.position = position.dataset.musicPosition; setOpen(positionMenu, positionButton, false); }
  });
  root.addEventListener("input", (event) => { if (event.target.matches("#music-volume")) { player?.setVolume?.(event.target.value); render(); } });
  root.addEventListener("keydown", (event) => {
    if (event.key !== "Escape") return;
    const open = !volumePopover.hidden || !positionMenu.hidden;
    if (!open) return;
    setOpen(volumePopover, volumeButton, false); setOpen(positionMenu, positionButton, false); lastOpener?.focus?.(); event.stopPropagation();
  });
  root.querySelectorAll("audio[data-music-audio]").forEach((audio) => audio.addEventListener("timeupdate", render));
  render();
  return { setController(next) { player = next; render(); }, render, root };
}

if (typeof document !== "undefined") mountMusicBoxUi();
import { createMusicPlayer } from "./clientMusicPlayer.js";
