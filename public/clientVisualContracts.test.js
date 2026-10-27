import assert from "node:assert/strict";
import process from "node:process";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { defaultStackOffset, startTileStackOffset } from "./clientBoardStack.js";
import { tileAriaLabel } from "./clientTileLabel.js";
import { fileURLToPath } from "node:url";

// Source-level contracts for the U2 visual lane (typography, targets, shell
// bounds). Browser-measured behaviour lives in qa/visual-contracts.spec.js.
const root = dirname(fileURLToPath(import.meta.url));
const css = readFileSync(join(root, "styles.css"), "utf8");
const responsiveCss = readFileSync(join(root, "game-responsive.css"), "utf8");
const html = readFileSync(join(root, "index.html"), "utf8");

export function rule(selector, source = css) {
  const escaped = selector.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const matches = [...source.matchAll(new RegExp(`(^|[\\n,}]\\s*)${escaped}\\s*(,[^{]*)?\\{([^}]*)\\}`, "g"))];
  assert.ok(matches.length, `missing rule ${selector}`);
  return matches.map((m) => m[3]).join("\n");
}

// F789-13 needs a fake matchMedia before clientDom.js is evaluated.
const reducedMotionListeners = [];
const reducedMotionQuery = { matches: false, addEventListener: (_type, listener) => reducedMotionListeners.push(listener) };
globalThis.window = { matchMedia: () => reducedMotionQuery };
const dom = await import("./clientDom.js");

const checks = [];
function check(name, fn) {
  try { fn(); checks.push({ name, ok: true }); } catch (error) { checks.push({ name, ok: false, error }); }
}

check("F-084: display face is Jersey 15 (uppercase C stays distinct from O) and the wordmark keeps the brand face", () => {
  assert.match(css, /--font-display:\s*"Jersey 15"/);
  assert.ok(existsSync(join(root, "assets/fonts/jersey15-regular.woff2")));
  assert.match(css, /--font-brand:\s*"Pixelify Sans"/);
  assert.match(rule(".wordmark"), /font-family:\s*var\(--font-brand\)/);
  assert.match(rule(".hdr-wordmark"), /font-family:\s*var\(--font-brand\)/);
  assert.match(css, /font-synthesis:\s*none/);
});

check("F-080: stacked tokens on Start stay above the COLLECT / $200 caption and inside the tile", () => {
  for (const [tile, caption, size] of [[88, 0, 30], [74, -6, 26], [120, 10, 30], [60, -2, 22]]) {
    for (let count = 1; count <= 4; count += 1) {
      for (let idx = 0; idx < count; idx += 1) {
        const o = startTileStackOffset({ count, idx, tileWidth: tile, tileHeight: tile, captionTop: caption, pieceSize: size });
        assert.ok(o.y + size / 2 <= caption + 0.5, `tile ${tile} count ${count} idx ${idx}: piece bottom ${o.y + size / 2} below caption ${caption}`);
        assert.ok(o.y - size / 2 >= -tile / 2 - 0.5, `piece top above tile (tile ${tile}, count ${count}, idx ${idx})`);
        assert.ok(Math.abs(o.x) + size / 2 <= tile / 2 + 0.5, `piece leaves tile horizontally (tile ${tile}, count ${count}, idx ${idx})`);
      }
    }
  }
  assert.deepEqual(defaultStackOffset(1, 0), { x: 0, y: 0 });
  assert.deepEqual(defaultStackOffset(3, 1), { x: 11, y: -8 });
});

check("F-086: board tile labels grow at >= 1800px wide", () => {
  const block = css.slice(css.indexOf("/* F-086"));
  assert.ok(block.length < css.length, "F-086 block missing");
  assert.match(block, /@media \(min-width: 1800px\)[\s\S]*?\.tile-name\s*\{[^}]*font-size:\s*clamp\(9px, 1\.3cqw, 14px\)/);
  assert.match(block, /\.tile-price\s*\{[^}]*font-size:\s*clamp\(10px, 1\.35cqw, 15px\)/);
});

check("F-052: tile accessible names carry owner, buildings and mortgage state", () => {
  const rio = { name: "RIO", price: 60 };
  assert.equal(tileAriaLabel(rio), "RIO, price $60");
  assert.equal(tileAriaLabel({ name: "TREASURE" }), "TREASURE");
  assert.equal(tileAriaLabel(rio, { ownerName: "Cora" }), "RIO, price $60, owned by Cora");
  assert.equal(tileAriaLabel(rio, { ownerName: "Cora", houses: 1 }), "RIO, price $60, owned by Cora, 1 house");
  assert.equal(tileAriaLabel(rio, { ownerName: "Cora", houses: 3, mortgaged: true }), "RIO, price $60, owned by Cora, 3 houses, mortgaged");
  assert.equal(tileAriaLabel(rio, { ownerName: "Cora", hotel: true }), "RIO, price $60, owned by Cora, hotel");
  assert.equal(tileAriaLabel(rio, { ownerName: "  " }), "RIO, price $60");
  const render = readFileSync(join(root, "clientBoardRender.js"), "utf8");
  assert.match(render, /function renderBoardTile[\s\S]*renderTileLabel\(el, tile\)/, "labels must refresh on every board render");
});

check("F789-11: live regions use one politeness per element and informational copy is polite", () => {
  const sockets = readFileSync(join(root, "clientSocketListeners.js"), "utf8");
  for (const tag of html.match(/<[^>]*aria-live=[^>]*>/g) || []) {
    const role = /role="(\w+)"/.exec(tag)?.[1];
    const live = /aria-live="(\w+)"/.exec(tag)?.[1];
    if (role === "alert") assert.notEqual(live, "polite", `role=alert must not be polite: ${tag.slice(0, 100)}`);
    if (role === "status") assert.notEqual(live, "assertive", `role=status must not be assertive: ${tag.slice(0, 100)}`);
  }
  assert.match(html, /id="status-announcer" role="status" aria-live="polite"/);
  assert.match(sockets, /\$\("#status-announcer"\)\.textContent = "AI credits are exhausted/);
  assert.doesNotMatch(sockets, /error-announcer"\)\.textContent = "AI credits/);
  assert.doesNotMatch(html, /id="bot-provider-banner"[^>]*role="alert"/);
});

check("F789-12: chat log is a named, focusable log that appends only new rows", () => {
  assert.match(html, /id="chat-body" role="log" aria-label="Parlor chat messages"[^>]*tabindex="0"/);
  const main = readFileSync(join(root, "main.js"), "utf8");
  const fn = main.slice(main.indexOf("function renderChatMessages("), main.indexOf("function syncChatScroll("));
  assert.match(fn, /insertAdjacentHTML\("beforeend"/);
  assert.match(fn, /lastIndexOf\(lastRenderedChatTail\)/);
  assert.match(fn, /body\.innerHTML/, "full render stays the fallback for first render / room change");
});

check("F789-13: reduced motion is read live from matchMedia change events", () => {
  assert.equal(dom.REDUCED_MOTION, false);
  assert.equal(reducedMotionListeners.length, 1, "clientDom subscribes to the media query");
  reducedMotionQuery.matches = true;
  reducedMotionListeners[0]({ matches: true });
  assert.equal(dom.REDUCED_MOTION, true);
  reducedMotionListeners[0]({ matches: false });
  assert.equal(dom.REDUCED_MOTION, false);
});

check("F789-14: toast dismiss target is at least 24x24 CSS px", () => {
  const body = rule(".parlor-toast-close");
  assert.ok(Number(/width:\s*(\d+)px/.exec(body)?.[1]) >= 24, "width");
  assert.ok(Number(/height:\s*(\d+)px/.exec(body)?.[1]) >= 24, "height");
});

check("privacy page, auction tag and rankings empty state are readable and actionable", () => {
  const privacy = readFileSync(join(root, "privacy.html"), "utf8");
  assert.match(privacy, /class="privacy-document-nav"/);
  assert.match(css, /main\.privacy-page-main\s*\{[^}]*overflow-y:\s*auto/);
  assert.match(css, /\.privacy-document \.t-body\s*\{[^}]*font-size:\s*15px[^}]*line-height:\s*1\.7/);
  assert.match(css, /\.privacy-document-nav a\s*\{[^}]*min-height:\s*40px/);
  assert.match(rule(".auction-leader-name"), /font-size:\s*15px/);
  assert.match(rule(".auction-bid-box .t-micro"), /font-size:\s*11px/);
  const social = readFileSync(join(root, "clientSocialSurfaces.js"), "utf8");
  const empty = social.slice(social.indexOf("function ledgerEmptyHTML()"), social.indexOf("function rankingErrorHTML"));
  assert.match(empty, /SHOW ALL-TIME RANKINGS/);
  assert.match(empty, /Sign in and finish a match/);
});

let failed = 0;
for (const result of checks) {
  if (result.ok) console.log(`ok - ${result.name}`);
  else { failed += 1; console.error(`not ok - ${result.name}\n  ${result.error?.message || result.error}`); }
}
void responsiveCss; void html;
if (failed) process.exit(1);
console.log(`${checks.length} visual contract checks passed`);
