import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import path from "node:path";
import { metadataConfig, renderMetadata, injectMetadata, createMetadataRouter, gateIndexEnv, indexingApproved } from "./metadata.js";

const safe = metadataConfig({ origin: "", path: "/" });
assert.equal(safe.indexPolicy, "noindex,nofollow");
assert.doesNotMatch(renderMetadata(safe), /canonical|og:url|https?:\/\//i);
assert.equal(metadataConfig({ origin: "https://play.example", path: "/" }).previewWidth, 1200);
assert.equal(metadataConfig({ origin: "https://play.example", path: "/" }).previewHeight, 630);
assert.match(renderMetadata(metadataConfig({ origin: "https://play.example", path: "/" })), /rel="canonical"/);
assert.match(renderMetadata(metadataConfig({ origin: "https://play.example", path: "/" })), /og:image" content="https:\/\/play\.example\/assets\/social\/poorup-og-1200x630\.png"/);
assert.match(renderMetadata(metadataConfig({ origin: "https://play.example", previewPath: "/assets/social/poorup-og-1200x630.png" })), /og:image/);
assert.match(renderMetadata(metadataConfig({ origin: "https://play.example", path: "/" })), /twitter:card" content="summary_large_image"/);
assert.match(renderMetadata(metadataConfig({ origin: "https://play.example", previewPath: "/assets/social/poorup-og-1200x630.png" })), /twitter:card" content="summary_large_image"/);
assert.match(renderMetadata(metadataConfig({ origin: "https://play.example", path: "/game" })), /noindex,nofollow/);
for (const privatePath of ["/play", "/rooms", "/profile", "/rankings", "/social", "/admin/analytics"]) {
  assert.equal(
    metadataConfig({ origin: "https://play.example", indexPolicy: "index,follow", path: privatePath }).indexPolicy,
    "noindex,nofollow",
    `${privatePath} must remain noindex even when the public policy is permissive`,
  );
}
// Public pages: own title and description, indexable, structured data only when indexable.
for (const publicPath of ["/", "/about", "/rules"]) {
  const config = metadataConfig({ origin: "https://play.example", path: publicPath });
  assert.equal(config.indexPolicy, "index,follow", `${publicPath} is public`);
  assert.ok(config.title.length > 20 && config.title.length <= 70, `${publicPath} has a search-sized title`);
  assert.ok(config.description.length > 80 && config.description.length <= 170, `${publicPath} has a search-sized description`);
}
assert.match(renderMetadata(metadataConfig({ origin: "https://play.example", path: "/" })), /application\/ld\+json/);
assert.doesNotMatch(renderMetadata(metadataConfig({ origin: "https://play.example", path: "/rules" })), /application\/ld\+json/);
assert.doesNotMatch(renderMetadata(metadataConfig({ origin: "", path: "/" })), /application\/ld\+json/);
assert.match(renderMetadata(metadataConfig({ origin: "https://play.example", path: "/", googleVerification: "abcdefghij12345" })), /google-site-verification" content="abcdefghij12345"/);
assert.doesNotMatch(renderMetadata(metadataConfig({ origin: "https://play.example", path: "/", googleVerification: "<script>" })), /google-site-verification/);
assert.match(injectMetadata("<html><head><title>Old</title></head></html>", { origin: "https://play.example", path: "/about" }), /<title>About Poorup/);

assert.doesNotMatch(injectMetadata("<html><head></head></html>", { origin: "", path: "/" }), /canonical|og:url|https?:\/\//i);
assert.doesNotMatch(renderMetadata({
  origin: "not-a-url",
  path: "/",
  canonicalUrl: "https://evil.example/private",
  previewUrl: "https://evil.example/card.png",
  previewWidth: 1200,
  previewHeight: 630,
  indexPolicy: "index,follow",
}), /evil\.example|rel="canonical"|og:url|og:image/i);
assert.match(renderMetadata({ origin: "not-a-url", path: "/", indexPolicy: "index,follow" }), /name="robots" content="noindex,nofollow"/);
assert.match(injectMetadata("<html><head><meta name=\"robots\" content=\"noindex,nofollow\" data-metadata-robots></head></html>", { origin: "https://play.example", path: "/" }), /rel="canonical"/);
assert.match(injectMetadata("<html><head><meta name=\"robots\" content=\"noindex,nofollow\" data-metadata-robots></head></html>", { origin: "https://play.example", path: "/" }), /name="robots" content="index,follow"/);
assert.equal(typeof createMetadataRouter, "function");

const app = express();
app.use(createMetadataRouter({ env: { POORUP_PUBLIC_ORIGIN: "https://play.example" }, indexFile: path.resolve("public/index.html") }));
const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, resolve));
const { port } = server.address();
try {
  const response = await fetch(`http://127.0.0.1:${port}/`);
  const body = await response.text();
  assert.equal(response.status, 200);
  assert.match(body, /og:image/);
  assert.match(body, /twitter:card" content="summary_large_image"/);
  assert.match(body, /rel="canonical" href="https:\/\/play\.example\/"/);
  assert.match(body, /name="robots" content="index,follow"/);
} finally {
  await new Promise((resolve) => server.close(resolve));
}

// Replacement patterns in operator text ($&, $', $$) are copied, not interpreted.
{
  const injected = injectMetadata("<html><head><title>T</title></head><body>B</body></html>", { origin: "https://play.example", path: "/rules", description: "Win $& pay $' rent $$ `x`" });
  assert.equal(injected.match(/<\/head>/gi).length, 1, "the document is not spliced into an attribute");
  assert.match(injected, /name="description" content="Win \$&amp; pay \$' rent \$\$ `x`"/);
}

// Indexing needs the public origin AND the explicit policy; pages and robots.txt agree.
{
  assert.equal(indexingApproved({ POORUP_PUBLIC_ORIGIN: "https://play.example" }), false);
  assert.equal(indexingApproved({ POORUP_PUBLIC_ORIGIN: "https://play.example", POORUP_INDEX_POLICY: "noindex,nofollow" }), false);
  assert.equal(indexingApproved({ POORUP_INDEX_POLICY: "index,follow" }), false);
  assert.equal(indexingApproved({ POORUP_PUBLIC_ORIGIN: "https://play.example", POORUP_INDEX_POLICY: "index,follow" }), true);
  const pending = { POORUP_PUBLIC_ORIGIN: "https://play.example" };
  assert.equal(metadataConfig({ env: gateIndexEnv(pending), path: "/rules" }).indexPolicy, "noindex,nofollow");
  assert.equal(metadataConfig({ env: gateIndexEnv({ ...pending, POORUP_INDEX_POLICY: "garbage" }), path: "/" }).indexPolicy, "noindex,nofollow");
  const approved = { ...pending, POORUP_INDEX_POLICY: "index,follow" };
  assert.equal(metadataConfig({ env: gateIndexEnv(approved), path: "/rules" }).indexPolicy, "index,follow");
}

console.log("server metadata tests: passed");
