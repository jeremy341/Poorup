/* global process */
import assert from "node:assert/strict";
import fs from "node:fs";

globalThis.window = { matchMedia: () => ({ matches: false }) };
globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
globalThis.localStorage = { getItem: () => null, setItem: () => {} };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };

const { socialGuestGateHTML } = await import("./clientSocialSurfaces.js");

const index = fs.readFileSync(new URL("./index.html", import.meta.url), "utf8");
const main = fs.readFileSync(new URL("./main.js", import.meta.url), "utf8");
const panelMenu = fs.readFileSync(new URL("./clientPanelMenu.js", import.meta.url), "utf8");
const lobby = fs.readFileSync(new URL("./clientLobbyUi.js", import.meta.url), "utf8");
const roomsUi = fs.readFileSync(new URL("./clientRoomsUi.js", import.meta.url), "utf8");
const state = fs.readFileSync(new URL("./clientState.js", import.meta.url), "utf8");
const stateSync = fs.readFileSync(new URL("./clientStateSync.js", import.meta.url), "utf8");
const rules = fs.readFileSync(new URL("./clientSocialSurfaces.js", import.meta.url), "utf8");
const gameModalsSource = fs.readFileSync(new URL("./clientGameModalsUi.js", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const { state: liveState } = await import("./clientState.js");
const { turnTagText } = await import("./clientTopNavRender.js");

let passed = 0;
let failed = 0;

function check(name, fn) {
  try {
    fn();
    passed += 1;
    console.log(`ok - ${name}`);
  } catch (error) {
    failed += 1;
    console.error(`not ok - ${name}: ${error.message}`);
  }
}

check("game chrome has no duplicate focus button", () => {
  assert.equal(index.includes('id="focus-btn"'), false);
  assert.equal(main.includes('$("#focus-btn")'), false);
  assert.equal(panelMenu.includes("focus-btn"), false);
});

check("lobby player preview does not manufacture bot rows", () => {
  assert.equal(lobby.includes("const botPreviews = buildBotPreviewPlayers"), false);
  assert.equal(lobby.includes("bot-preview-"), false);
  assert.match(lobby, /state\.players\s*=\s*buildPlayers\(activeAppearance\(\), state\.alias\)\.slice\(0, 1\)/);
  assert.match(stateSync, /isHost:\s*Boolean\(player\.isHost\)/);
  assert.match(lobby, /lobby-host-badge/);
});

check("guest social gate gives a clear account message and inert content contract", () => {
  const html = socialGuestGateHTML();
  assert.match(html, /YOU DO NOT HAVE AN ACCOUNT/);
  assert.match(html, /CREATE ACCOUNT/);
  assert.match(html, /social-guest-gate/);
});

check("social search control aligns to the input row", () => {
  assert.match(styles, /\.social-search-row/);
  assert.match(styles, /\.social-search-submit\s*\{[^}]*align-self:\s*start/);
});

check("board variant is selected only after entering the lobby", () => {
  assert.equal(index.includes('id="rc-board-variant"'), false);
  assert.equal(roomsUi.includes('id === "rc-board-variant"'), false);
  assert.equal(roomsUi.includes("#rc-board-variant"), false);
  assert.match(lobby, /settingRow\("Board Variant"/);
});

check("room creation carries a bounded idempotency key", () => {
  assert.match(lobby, /createRequestId/);
  assert.match(lobby, /requestId/);
  assert.match(state, /roomEntryPending/);
});

check("rejected host settings visibly roll back the optimistic client state", () => {
  assert.match(main, /const previousSettings =/);
  assert.match(main, /settingResult\?\.success !== false/);
  assert.match(main, /state\.settings\[key\] = previousSettings\[key\]/);
  assert.match(main, /parlorNotice\("TABLE SETTINGS"/);
});

check("bot brain exposes only AI/no-AI and a global exhausted notice", () => {
  assert.match(lobby, /botBrainControl/);
  assert.doesNotMatch(lobby, /AUTO · AI/);
  assert.match(index, /id="bot-provider-banner"[^>]*role="alert"/);
  assert.match(state, /botProviderStatus/);
  assert.match(styles, /\.bot-provider-banner/);
});

check("degraded snapshots use a safe turn label instead of throwing", () => {
  const previous = { phase: liveState.phase, players: liveState.players, turnIndex: liveState.turnIndex };
  liveState.phase = "playing";
  liveState.players = [];
  liveState.turnIndex = 0;
  assert.equal(turnTagText(), "SYNCING");
  Object.assign(liveState, previous);
});

check("rules describe the single bankruptcy and spectator lifecycle", () => {
  assert.match(rules, /read-only spectator/i);
  assert.doesNotMatch(rules, /Debt Deal mode can transfer assets and keep the player/i);
});

check("spectators can leave through the existing table action", () => {
  assert.match(stateSync, /spectating/);
  assert.match(stateSync, /LEAVE TABLE/);
  assert.match(gameModalsSource, /spectating/);
});

console.log(`client UX contract tests: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
