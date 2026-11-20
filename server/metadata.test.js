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
assert.doesNotMatch(renderMetadata(metadataConfig({ origin: "", path: "/" })), /application\/ld\+json/);

// Structured data is a single @graph per indexable page. Parse it and walk the nodes.
function structuredGraph(options) {
  const html = renderMetadata(metadataConfig(options));
  const match = html.match(/<script type="application\/ld\+json">([\s\S]*?)<\/script>/);
  assert.ok(match, "a structured data block is emitted");
  const data = JSON.parse(match[1]);
  assert.equal(data["@context"], "https://schema.org");
  assert.ok(Array.isArray(data["@graph"]));
  const types = data["@graph"].map(node => node["@type"]);
  return { data, types };
}
{
  // One publisher (Organization), one WebSite and one game (VideoGame that is also a
  // WebApplication) on every indexable page, with @ids that tie them together.
  const entities = ["Organization", "WebSite", ["VideoGame", "WebApplication"]];
  const home = structuredGraph({ origin: "https://play.example", path: "/" });
  assert.deepEqual(home.types, entities);
  const [organization, website, game] = home.data["@graph"];
  assert.equal(organization["@id"], "https://play.example/#organization");
  assert.equal(website.publisher["@id"], organization["@id"]);
  assert.equal(game.publisher["@id"], organization["@id"]);
  assert.equal(website.url, "https://play.example/");
  assert.deepEqual([game.numberOfPlayers.minValue, game.numberOfPlayers.maxValue], [2, 6], "player counts match boardRegistry (2-4 standard, up to 6 Metro-52)");
  assert.equal(game.isAccessibleForFree, true);
  assert.equal(typeof game.description, "string", "the home page describes the game");
  const about = structuredGraph({ origin: "https://play.example", path: "/about" });
  assert.deepEqual(about.types, [...entities, "BreadcrumbList"]);
  assert.equal(about.data["@graph"][3].itemListElement[0].item, "https://play.example/");
  assert.equal("description" in about.data["@graph"][2], false, "the game's description is the home page's, so other pages do not repeat it");
  const rules = structuredGraph({ origin: "https://play.example", path: "/rules" });
  assert.deepEqual(rules.types, [...entities, "BreadcrumbList", "TechArticle"]);
  assert.match(rules.data["@graph"][4].url, /^https:\/\/play\.example\/rules$/);
  assert.equal(rules.data["@graph"][4].publisher["@id"], organization["@id"]);
  assert.ok(!about.types.includes("FAQPage") && !rules.types.includes("FAQPage"), "FAQPage is served only by /about, which holds the Q&A");
  const noindex = renderMetadata(metadataConfig({ origin: "https://play.example", path: "/", indexPolicy: "noindex,nofollow" }));
  assert.doesNotMatch(noindex, /application\/ld\+json/);
}
// POORUP_META_DESCRIPTION is the home-page description only; /about and /rules keep their own.
{
  const env = { POORUP_PUBLIC_ORIGIN: "https://play.example", POORUP_INDEX_POLICY: "index,follow", POORUP_META_DESCRIPTION: "A custom home description for the operator." };
  assert.equal(metadataConfig({ env, path: "/" }).description, "A custom home description for the operator.");
  assert.notEqual(metadataConfig({ env, path: "/about" }).description, env.POORUP_META_DESCRIPTION);
  assert.notEqual(metadataConfig({ env, path: "/rules" }).description, env.POORUP_META_DESCRIPTION);
  assert.equal(metadataConfig({ origin: "https://play.example", path: "/rules", description: "Explicit per-call text." }).description, "Explicit per-call text.", "an explicit option still applies to its own page");
}
// /about and /rules point at their Markdown copies only when indexing is approved.
{
  const approved = renderMetadata(metadataConfig({ origin: "https://play.example", path: "/about", indexPolicy: "index,follow" }));
  assert.match(approved, /<link rel="alternate" type="text\/markdown" href="https:\/\/play\.example\/about\.md">/);
  assert.match(renderMetadata(metadataConfig({ origin: "https://play.example", path: "/rules", indexPolicy: "index,follow" })), /href="https:\/\/play\.example\/rules\.md"/);
  assert.doesNotMatch(renderMetadata(metadataConfig({ origin: "https://play.example", path: "/about", indexPolicy: "noindex,nofollow" })), /text\/markdown/);
  assert.doesNotMatch(renderMetadata(metadataConfig({ origin: "https://play.example", path: "/" , indexPolicy: "index,follow" })), /text\/markdown/);
}
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
