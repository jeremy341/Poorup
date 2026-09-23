import assert from "node:assert/strict";
import { readFileSync } from "node:fs";

const index = readFileSync(new URL("./index.html", import.meta.url), "utf8");
const styles = readFileSync(new URL("./styles.css", import.meta.url), "utf8");
const analytics = readFileSync(new URL("./clientAnalytics.js", import.meta.url), "utf8");
const auction = readFileSync(new URL("./clientAuctionUi.js", import.meta.url), "utf8");
const gameModals = readFileSync(new URL("./clientGameModalsUi.js", import.meta.url), "utf8");
const surfaces = readFileSync(new URL("./clientSurfaces.js", import.meta.url), "utf8");
const socket = readFileSync(new URL("./clientSocketListeners.js", import.meta.url), "utf8");
const sanitize = readFileSync(new URL("./clientSanitize.js", import.meta.url), "utf8");
const home = readFileSync(new URL("./clientHomeEntryBindings.js", import.meta.url), "utf8");
const stateSync = readFileSync(new URL("./clientStateSync.js", import.meta.url), "utf8");
const main = readFileSync(new URL("./main.js", import.meta.url), "utf8");

const ticker = index.match(/<div class="ticker">([\s\S]*?)<\/div>/i)?.[1] || "";
assert.doesNotMatch(ticker, /href="\/(?:legal|privacy)/i);
assert.doesNotMatch(ticker, /legal-links/i);
assert.doesNotMatch(ticker, /<button[\s\S]*<a|<a[\s\S]*<button/i);

assert.match(surfaces, /options\.trigger|setSurfaceReturnFocus\(options\.trigger\)/);
assert.match(styles, /\.popup-card\s*\{[^}]*overscroll-behavior:\s*contain/i);
assert.match(styles, /prefers-reduced-motion:\s*reduce[\s\S]*?\.auction-bar-fill[^}]*transition:\s*none/i);
assert.match(home, /pasted|paste|6-CHARACTER ROOM CODE/i);
assert.match(sanitize, /createdAt:\s*cleanCreatedAt/);
assert.match(index, /id="home-alias"[^>]*name="/i);
assert.match(index, /id="room-join"[^>]*inputmode="text"/i);
assert.match(socket, /clearLocalPlayerData/);
assert.match(socket, /storage/);
assert.match(socket, /isExplicitSessionInvalidation/);
assert.match(sanitize, /export function clearLocalPlayerData/);
assert.match(main, /setDocumentMeta/);
assert.match(main, /createMusicPlayer/);
assert.match(main, /resetToThemeTrack/);
assert.match(main, /controller\.stop\?\./);
assert.match(main, /const snapshot = ensureMusicController\(\)\?\.snapshot/);
assert.doesNotMatch(main, /#home-music|audioRuntime|AUDIO_LABELS|mediaFailureState/);
assert.match(stateSync, /state\.gameOver\s*=\s*null/);

assert.doesNotMatch(index, /<title>[^<]*[—–]|POORUP\s+[—–]|[—–]\s+LOBBIES/i);
assert.doesNotMatch(analytics, /[—–]/, "analytics UI still contains em/en-dash separators");
assert.doesNotMatch(auction, /[—–]/, "auction UI still contains em/en-dash separators");
assert.doesNotMatch(gameModals, /[—–]/, "game modal UI still contains em/en-dash separators");

const { clearLocalPlayerData, sanitizeAccountSession } = await import("./clientSanitize.js");
const cleanedAccount = sanitizeAccountSession({ sessionToken: "session", account: { id: "acct", username: "player", displayName: "Player", createdAt: "2026-01-02T03:04:05.000Z" } });
assert.equal(cleanedAccount.account.createdAt, "2026-01-02T03:04:05.000Z");
const values = new Map([
  ["poorup.account.session.v1", "session"],
  ["poorup.profile.v1", "profile"],
  ["other-app.preference", "keep"],
]);
const storage = {
  get length() { return values.size; },
  key(index) { return [...values.keys()][index] || null; },
  removeItem(key) { values.delete(key); },
};
clearLocalPlayerData(storage);
assert.equal(values.has("poorup.account.session.v1"), false);
assert.equal(values.has("poorup.profile.v1"), false);
assert.equal(values.get("other-app.preference"), "keep");

console.log("client interaction regression tests: passed");
