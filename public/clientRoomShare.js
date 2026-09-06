/* ============================================================
   ROOM SHARE: copy the live room code to the clipboard from the
   top-nav button. Public rooms have no code to share; when the
   async clipboard API is unavailable it falls back to the legacy
   hidden-textarea execCommand path, then announces the outcome to
   the visual system-announcer and flashes the button.
   ============================================================ */
import { $ } from "./clientDom.js";
import { state } from "./clientState.js";

function legacyCopy(code) {
  const helper = document.createElement("textarea");
  helper.value = code;
  helper.setAttribute("readonly", "");
  helper.style.position = "fixed";
  helper.style.opacity = "0";
  document.body.appendChild(helper);
  helper.select();
  try { return document.execCommand("copy"); } catch { return false; } finally { helper.remove(); }
}

async function clipboardCopy(code) {
  if (!navigator.clipboard?.writeText) return false;
  try {
    await navigator.clipboard.writeText(code);
    return true;
  } catch {
    return false;
  }
}

function announceRoomCopy(code, copied) {
  const badge = $("#tn-room-copy");
  const announcer = $("#system-announcer");
  if (!copied) {
    if (announcer) announcer.textContent = "ROOM CODE COULD NOT BE COPIED";
    return;
  }
  if (announcer) announcer.textContent = `ROOM CODE ${code} COPIED`;
  badge?.classList.add("is-copied");
  window.setTimeout(() => badge?.classList.remove("is-copied"), 1000);
}

export async function copyRoomCode() {
  if (state.roomVisibility === "public") return;
  const code = String(state.roomCode || "").trim().toUpperCase();
  if (!code) return;
  const copied = (await clipboardCopy(code)) || legacyCopy(code);
  announceRoomCopy(code, copied);
}
