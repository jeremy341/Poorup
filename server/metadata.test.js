import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import path from "node:path";
import { metadataConfig, renderMetadata, injectMetadata, createMetadataRouter } from "./metadata.js";

const safe = metadataConfig({ origin: "", path: "/" });
assert.equal(safe.indexPolicy, "noindex,nofollow");
assert.doesNotMatch(renderMetadata(safe), /canonical|og:url|https?:\/\//i);
assert.equal(metadataConfig({ origin: "https://play.example", path: "/" }).previewWidth, 1200);
assert.equal(metadataConfig({ origin: "https://play.example", path: "/" }).previewHeight, 630);
assert.match(renderMetadata(metadataConfig({ origin: "https://play.example", path: "/" })), /rel="canonical"/);
assert.match(renderMetadata(metadataConfig({ origin: "https://play.example", path: "/game" })), /noindex,nofollow/);
for (const privatePath of ["/play", "/rooms", "/profile", "/rankings", "/social", "/rules", "/admin/analytics"]) {
  assert.equal(
    metadataConfig({ origin: "https://play.example", indexPolicy: "index,follow", path: privatePath }).indexPolicy,
    "noindex,nofollow",
    `${privatePath} must remain noindex even when the public policy is permissive`,
  );
}
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
  assert.match(body, /rel="canonical" href="https:\/\/play\.example\/"/);
  assert.match(body, /name="robots" content="index,follow"/);
} finally {
  await new Promise((resolve) => server.close(resolve));
}

console.log("server metadata tests: passed");
