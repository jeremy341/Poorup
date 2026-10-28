// ACCOUNT APPEARANCE: a signed-in player's face and color live on the server account.
// adoptAccountAppearance() makes that face the active design on this browser, and
// accountAppearancePayload() builds what to send when a design is saved. Extra local designs stay per browser.
import { state, upsertProfile, getAppearanceMeta, syncLocalAppearance, buildPlayers, saveAccountSession } from "./clientState.js";
import { saveActiveDesignId, APPEARANCES } from "./clientSanitize.js";
import { faceGridFromPreset } from "./clientSprites.js";

const ACCOUNT_DESIGN_ID = "pf_account";

function sameFace(color, grid, otherColor, otherGrid) {
  if (String(color).toLowerCase() !== String(otherColor).toLowerCase()) return false;
  return JSON.stringify(grid) === JSON.stringify(otherGrid);
}

function activeFace() {
  const meta = getAppearanceMeta(state.appearance);
  const choice = state.appearance;
  const grid = meta.avatarGrid || faceGridFromPreset(typeof choice === "number" ? choice : 0, meta.color);
  return { color: meta.color, grid };
}

/** What the server account should store for the design the player just chose. */
export function accountAppearancePayload(choice) {
  const meta = getAppearanceMeta(choice);
  const index = typeof choice === "number" && choice >= 0 && choice < APPEARANCES.length ? choice : 0;
  return { color: meta.color, avatarGrid: meta.avatarGrid || faceGridFromPreset(index, meta.color) };
}

/** Returns true when the active design changed. Safe to call on every account payload. */
export function adoptAccountAppearance(account) {
  if (!account || !Array.isArray(account.avatarGrid) || !account.color) return false;
  const current = activeFace();
  if (sameFace(current.color, current.grid, account.color, account.avatarGrid)) return false;

  let target = state.profiles.find(profile => sameFace(profile.color, profile.avatarGrid, account.color, account.avatarGrid));
  if (!target) {
    const saved = upsertProfile({ id: ACCOUNT_DESIGN_ID, designName: "MY FACE", color: account.color, avatarGrid: account.avatarGrid });
    if (!saved || saved === "limit") return false;
    target = saved;
  }
  state.appearance = target.id;
  state.tableAppearanceOverride = null;
  saveActiveDesignId(target.id);
  syncLocalAppearance();
  if (state.phase === "home" || state.phase === "setup") state.players = buildPlayers(state.appearance, state.alias);
  return true;
}

/** Saves a face to the signed-in account over the cookie-authenticated endpoint. */
export async function saveFaceToAccount(face) {
  if (!state.account || typeof fetch !== "function") return { success: false, skipped: true };
  const headers = { "content-type": "application/json" };
  if (state.account.sessionToken) headers["x-poorup-session-token"] = state.account.sessionToken;
  try {
    const response = await fetch("/account/profile", {
      method: "POST",
      credentials: "include",
      headers,
      body: JSON.stringify({ color: face.color, avatarGrid: face.avatarGrid }),
    });
    const payload = await response.json().catch(() => null);
    if (response.ok && payload?.success && payload.account) {
      saveAccountSession({ sessionToken: state.account.sessionToken || "", account: payload.account });
      return { success: true };
    }
    return { success: false, error: payload?.error || "Could not save your face to the account." };
  } catch {
    return { success: false, error: "Could not reach the server to save your face." };
  }
}
