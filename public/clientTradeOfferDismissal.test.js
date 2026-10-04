import assert from "node:assert/strict";
import {
  dismissTradeOffer,
  dismissedTradeOfferId,
  isTradeOfferDismissed,
  reconcileTradeOfferDismissal,
} from "./clientTradeOfferDismissal.js";

const values = new Map();
const storage = {
  getItem: key => values.get(key) ?? null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: key => values.delete(key),
};

assert.equal(dismissTradeOffer("IPAD1", "trade-1", storage), true);
assert.equal(dismissedTradeOfferId("IPAD1", storage), "trade-1");
assert.equal(isTradeOfferDismissed("IPAD1", "trade-1", storage), true, "same offer is suppressed after refresh or reconnect");
assert.equal(isTradeOfferDismissed("OTHER", "trade-1", storage), false, "dismissal state is room scoped");
assert.equal(isTradeOfferDismissed("IPAD1", "trade-2", storage), false, "a counteroffer with a new ID is not suppressed");
assert.equal(dismissedTradeOfferId("IPAD1", storage), null, "new offer clears the resolved prior ID");

dismissTradeOffer("IPAD1", "trade-3", storage);
assert.equal(reconcileTradeOfferDismissal("IPAD1", "trade-3", storage), "trade-3", "authoritative pending snapshot keeps dismissal");
assert.equal(reconcileTradeOfferDismissal("IPAD1", null, storage), null, "resolution clears dismissal");
assert.equal(dismissedTradeOfferId("IPAD1", storage), null);

console.log("trade offer dismissal persistence tests: passed");
