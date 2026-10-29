import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";

globalThis.window = { matchMedia: () => ({ matches: false }) };
globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
const storage = { getItem: () => null, setItem: () => {}, removeItem: () => {} };
globalThis.localStorage = storage;
globalThis.sessionStorage = storage;

const { equityTransferControlsHTML, equityTransferPayload } = await import("./clientTradeUi.js");
const tradeUiSource = await readFile(new URL("./clientTradeUi.js", import.meta.url), "utf8");

function functionSource(name) {
  const declaration = tradeUiSource.indexOf(`function ${name}(`);
  assert.notEqual(declaration, -1, `${name} exists`);
  const nextFunction = /\n(?:export )?(?:async )?function \w+\(/g;
  nextFunction.lastIndex = declaration + 1;
  const nextDeclaration = nextFunction.exec(tradeUiSource)?.index ?? tradeUiSource.length;
  return tradeUiSource.slice(declaration, nextDeclaration);
}

function test(name, run) {
  try {
    run();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}`);
    throw error;
  }
}

test("feedBackedTradeAndContractSuccessesDoNotWriteDuplicateLocalNotices", () => {
  for (const name of ["sendFinancingContract", "sendFinancingNegotiation", "sendFinancingRepay", "emitTradeOffer"]) {
    const source = functionSource(name);
    assert.doesNotMatch(source, /host\.record(?:Activity)?\s*\(/, `${name} relies on the server feed instead of adding a duplicate local log/activity row`);
    assert.match(source, /host\.announceActionStatus\(/, `${name} keeps failures beside the submitting action`);
  }
});

test("equityTransferProposalKeepsItsUniqueLocalActivityNotice", () => {
  const source = functionSource("onEquityTransferSubmit");
  assert.match(source, /host\.recordActivity\("Equity transfer offer sent\./);
});

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
