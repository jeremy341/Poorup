import assert from "node:assert/strict";
import { metadataConfig, renderDocumentMeta, setDocumentMeta } from "./clientDocumentMeta.js";

const missingOrigin = metadataConfig({ origin: "", path: "/" });
assert.equal(missingOrigin.indexPolicy, "noindex,nofollow");
assert.equal(missingOrigin.origin, "");
assert.equal(renderDocumentMeta({ origin: "", path: "/", title: "Poorup" }).includes('rel="canonical"'), false);
assert.equal(renderDocumentMeta({ origin: "", path: "/", title: "Poorup" }).includes("og:url"), false);
assert.equal(renderDocumentMeta({ origin: "", path: "/", title: "Poorup" }).includes("https://"), false);

const configured = metadataConfig({
  origin: "https://play.example",
  path: "/",
  title: "Poorup",
  description: "A configured description.",
});
assert.equal(configured.origin, "https://play.example");
assert.equal(configured.previewWidth, 1200);
assert.equal(configured.previewHeight, 630);
assert.equal(configured.previewPath, "/assets/social/poorup-og-1200x630.png");
const configuredHtml = renderDocumentMeta(configured);
assert.match(configuredHtml, /rel="canonical" href="https:\/\/play\.example\/"/);
assert.match(configuredHtml, /property="og:image:width" content="1200"/);
assert.match(configuredHtml, /property="og:image:height" content="630"/);
assert.match(configuredHtml, /property="og:image:type" content="image\/png"/);

const privateHtml = renderDocumentMeta(metadataConfig({ origin: "https://play.example", path: "/admin/analytics" }));
assert.match(privateHtml, /name="robots" content="noindex,nofollow"/);

const invalidPrecomputed = renderDocumentMeta({
  origin: "not-a-url",
  path: "/",
  canonicalUrl: "https://evil.example/private",
  previewUrl: "https://evil.example/card.png",
  previewWidth: 1200,
  previewHeight: 630,
  indexPolicy: "index,follow",
});
assert.doesNotMatch(invalidPrecomputed, /evil\.example|rel="canonical"|og:url|og:image/i);
assert.match(invalidPrecomputed, /name="robots" content="noindex,nofollow"/);

const announcer = { textContent: "" };
globalThis.document = {
  title: "",
  querySelector(selector) { return selector === "[data-document-announcer]" ? announcer : null; },
};
const viewMeta = setDocumentMeta({ view: "game", status: "Your turn", roomCode: "ab12cd" });
assert.equal(viewMeta.title, "Poorup | Table | AB12CD");
assert.equal(globalThis.document.title, viewMeta.title);
assert.match(announcer.textContent, /Your turn/);

console.log("client document metadata tests: passed");
