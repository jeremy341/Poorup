/* Regression contracts for the client/legal review follow-ups. */
import assert from "node:assert/strict";
import fs from "node:fs";

const root = new URL("./", import.meta.url);
const source = (name) => fs.readFileSync(new URL(name, root), "utf8");
const rail = source("clientRailEvents.js");
const deed = source("clientDeedDetailUi.js");
const deals = source("clientDealUi.js");
const main = source("main.js");
const stateSync = source("clientStateSync.js");
const socketListeners = source("clientSocketListeners.js");
const styles = source("styles.css");

assert.match(rail, /host\.openTradeModal\(node\.dataset\.trade,\s*node\)/);
assert.match(deed, /function openDeedDetail\(tileIdx,\s*trigger\s*=\s*null\)/);
assert.match(deed, /openSurface\("#deed-modal",\s*"#dd-close",\s*\{\s*trigger\s*\}\)/);
assert.match(deed, /openDeedDetail\(Number\(card\.dataset\.deedOpen\),\s*card\)/);
assert.match(deals, /openSurface\("#deal-detail-modal",\s*"#deal-detail-close",\s*\{\s*trigger\s*\}\)/);
assert.match(deals, /activeDealTrigger/);
assert.match(socketListeners, /state\.unlockedAchievements\s*=\s*new Set\(\)/);
assert.match(socketListeners, /state\.achievementRecords\s*=\s*new Map\(\)/);
assert.match(socketListeners, /state\.players\s*=\s*buildPlayers\(/);
assert.match(socketListeners, /host\.syncAudioButtons\(\)/);
assert.match(socketListeners, /host\.syncHomeMusic\(\)/);

assert.match(main, /ready:\s*"Turn parlor music off"/);
assert.match(main, /addEventListener\("error"/);
assert.match(main, /addEventListener\("stalled"/);
assert.match(main, /addEventListener\("ended"/);
assert.match(main, /audioPlayPromise|audioRuntime/);

assert.match(stateSync, /game\.started[\s\S]{0,180}state\.gameOver = null/);
assert.match(stateSync, /gameStarted|newGame|startedTransition/);

assert.match(styles, /\.legal-links\s+a\s*\{[\s\S]*min-height:\s*(?:24|44)px/);
assert.match(styles, /\.legal-links\s+a\s*\{[\s\S]*margin-block/);

console.log("client legal follow-up source contracts: passed");
