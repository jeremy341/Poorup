import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import process from "node:process";

globalThis.window = { matchMedia: () => ({ matches: false }) };
const { bankLoanConfirmationHTML, configureBankLoanUi, openBankLoanOffer, bindBankLoanUi } = await import("./clientBankLoanUi.js");

const rail = readFileSync(new URL("./clientRailRender.js", import.meta.url), "utf8");
const offer = { available: true, principal: 300, premium: 60, totalDue: 360, dueRound: 4, cureRound: 5, collateralName: "Boardwalk", severity: "fair" };

function check(name, assertion) {
  try {
    assertion();
    console.log(`PASS ${name}`);
  } catch (error) {
    console.error(`FAIL ${name}: ${error.message}`);
    process.exitCode = 1;
  }
}

function makeCard() {
  const status = { textContent: "" };
  const cancel = { dataset: {}, disabled: false };
  const confirm = {
    dataset: {}, disabled: false, attributes: {},
    setAttribute(name, value) { this.attributes[name] = value; },
    removeAttribute(name) { delete this.attributes[name]; },
    closest() { return card; },
  };
  const card = {
    dataset: {}, innerHTML: "", listener: null,
    addEventListener(_name, listener) { this.listener = listener; },
    querySelector(selector) { return selector.includes("status") ? status : null; },
    status, cancel, confirm,
  };
  return card;
}

function installDocument(card) {
  const surface = { listener: null, addEventListener(_name, listener) { this.listener = listener; } };
  globalThis.document = { querySelector: selector => selector.includes("modal") ? surface : card };
  return surface;
}

check("offerButtonOpensConfirmationWithCurrentTerms", () => {
  const card = makeCard();
  const opened = [];
  installDocument(card);
  configureBankLoanUi({ getOffer: () => offer, openSurface: (...args) => opened.push(args) });
  const trigger = {};
  assert.equal(openBankLoanOffer(trigger), true);
  for (const term of ["$300", "$60 · 20%", "$360", "4", "5", "FAIR", "Boardwalk"]) assert.ok(card.innerHTML.includes(term));
  assert.match(card.innerHTML, /pledged deed is seized|seizes Boardwalk/);
  assert.match(bankLoanConfirmationHTML({ ...offer, collateralName: "NONE" }), /collects what it can; any remaining balance enters bank debt settlement/);
  assert.equal(opened[0][0], "#bank-loan-modal");
  assert.equal(opened[0][2].trigger, trigger);
});

check("unavailableOfferShowsServerReason", () => {
  const reason = "A global event has closed new lending.";
  configureBankLoanUi({ getOffer: () => ({ available: false, reason }) });
  assert.match(rail, /data-bank-offer-reason/);
  assert.equal(bankLoanConfirmationHTML({ available: false, reason }), "");
  assert.ok(rail.includes("esc(offer.reason)"));
});

check("cancelRestoresFocusToRailTrigger", () => {
  const html = readFileSync(new URL("./index.html", import.meta.url), "utf8");
  assert.match(html, /id="bank-loan-modal"[\s\S]*id="bank-loan-card"/);
  const card = makeCard();
  let closed = null;
  installDocument(card);
  configureBankLoanUi({ getOffer: () => offer, openSurface: () => {}, closeSurface: selector => { closed = selector; } });
  const trigger = {};
  openBankLoanOffer(trigger);
  bindBankLoanUi();
  card.listener({ target: { closest: selector => selector.includes("cancel") ? card.cancel : null } });
  assert.equal(closed, "#bank-loan-modal");
});

check("confirmUsesAnIdempotentServerRequestAndShowsStaleTermRejection", () => {
  let sent;
  const card = makeCard();
  installDocument(card);
  configureBankLoanUi({ getOffer: () => offer, openSurface: () => {}, emitServer: (event, payload, ack) => { sent = { event, payload, ack }; }, createRequestId: () => "request-1" });
  openBankLoanOffer({});
  bindBankLoanUi();
  card.listener({ target: { closest: selector => selector.includes("confirm") ? card.confirm : null } });
  assert.equal(sent.event, "take-bank-loan");
  assert.deepEqual(sent.payload, { requestId: "request-1" });
  sent.ack({ success: false, error: "The offer changed; refresh the table." });
  assert.equal(card.confirm.disabled, false);
  assert.equal(card.confirm.attributes["aria-busy"], undefined);
  assert.equal(card.status.textContent, "The offer changed; refresh the table.");
});

check("successfulConfirmationRefreshesTheWalletAndClosesTheOffer", () => {
  let acknowledge;
  let refreshes = 0;
  let closed = null;
  const card = makeCard();
  installDocument(card);
  configureBankLoanUi({
    getOffer: () => offer,
    openSurface: () => {},
    closeSurface: selector => { closed = selector; },
    emitServer: (_event, _payload, ack) => { acknowledge = ack; },
    createRequestId: () => "request-success",
    refreshEconomySnapshot: () => { refreshes += 1; },
  });
  openBankLoanOffer({});
  bindBankLoanUi();
  card.listener({ target: { closest: selector => selector.includes("confirm") ? card.confirm : null } });
  acknowledge({ success: true });
  assert.equal(refreshes, 1);
  assert.equal(closed, "#bank-loan-modal");
});

check("rejectionAppearsBesideDialogActionAndAnnouncesOnce", () => {
  let ack;
  const messages = [];
  const card = makeCard();
  installDocument(card);
  configureBankLoanUi({ getOffer: () => offer, openSurface: () => {}, emitServer: (_event, _payload, callback) => { ack = callback; }, createRequestId: () => "request-2", announceActionStatus: (message, node) => messages.push([message, node]) });
  openBankLoanOffer({});
  bindBankLoanUi();
  card.listener({ target: { closest: selector => selector.includes("confirm") ? card.confirm : null } });
  ack({ success: false, error: "The offer changed; refresh the table." });
  ack({ success: false, error: "The offer changed; refresh the table." });
  assert.equal(card.status.textContent, "The offer changed; refresh the table.");
  assert.equal(messages.length, 1);
  assert.equal(messages[0][1], card.status);
});
