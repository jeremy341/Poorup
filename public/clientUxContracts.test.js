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
const stateSync = fs.readFileSync(new URL("./clientStateSync.js", import.meta.url), "utf8");
const styles = fs.readFileSync(new URL("./styles.css", import.meta.url), "utf8");

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

console.log(`client UX contract tests: ${passed} passed, ${failed} failed`);
process.exit(failed ? 1 : 0);
