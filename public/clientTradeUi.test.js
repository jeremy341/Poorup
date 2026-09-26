import assert from "node:assert/strict";

globalThis.window = { matchMedia: () => ({ matches: false }) };
globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
globalThis.localStorage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };

const { equityTransferControlsHTML, equityTransferPayload } = await import("./clientTradeUi.js");
assert.deepEqual(equityTransferPayload({
  fromPlayerId: "seller-seat",
  toPlayerId: "buyer-seat",
  contractId: "equity-contract",
  sharePct: 15,
  price: 225,
  requestId: "equity-transfer-1",
}), {
  fromPlayerId: "seller-seat",
  toPlayerId: "buyer-seat",
  contractId: "equity-contract",
  sharePct: 15,
  price: 225,
  requestId: "equity-transfer-1",
});
const transferControls = equityTransferControlsHTML(20);
assert.match(transferControls, /name="sharePct" min="5" max="20"/);
assert.match(transferControls, /name="price" min="1" step="1" value="1"/);
assert.equal(equityTransferControlsHTML(4), "", "a share below the server minimum has no transfer form");

console.log("client equity transfer UI tests: passed");
