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
assert.match(configuredHtml, /og:image/);
assert.match(configuredHtml, /twitter:card" content="summary_large_image"/);
const previewHtml = renderDocumentMeta(metadataConfig({ origin: "https://play.example", previewPath: "/assets/social/poorup-og-1200x630.png" }));
assert.match(previewHtml, /property="og:image"/);
assert.match(previewHtml, /twitter:card" content="summary_large_image"/);
assert.match(previewHtml, /property="og:image:width" content="1200"/);
assert.match(previewHtml, /property="og:image:height" content="630"/);
assert.match(previewHtml, /property="og:image:type" content="image\/png"/);

const privateHtml = renderDocumentMeta(metadataConfig({ origin: "https://play.example", path: "/admin/analytics" }));
assert.match(privateHtml, /name="robots" content="noindex,nofollow"/);
const permissivePrivateHtml = renderDocumentMeta(metadataConfig({ origin: "https://play.example", indexPolicy: "index,follow", path: "/profile" }));
assert.match(permissivePrivateHtml, /name="robots" content="noindex,nofollow"/);

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

// The server writes the search-facing title and description for the public
// pages (server/metadata.js). The client keeps the served title on the URL it
// was served for and still gives every other view its own in-app title.
{
  const publicPages = [
    ["/", "home", "Poorup \u2013 Free Online Monopoly-Style Game, No Signup", "Poorup | Home"],
    ["/about", "about", "About Poorup \u2013 Free Online Property Trading Board Game", "Poorup | About"],
    ["/rules", "rules", "Poorup Rules \u2013 How to Play the Online Property Board Game", "Poorup | Rules"],
  ];
  for (const [pathname, view, serverTitle, appTitle] of publicPages) {
    globalThis.location = { pathname };
    globalThis.document = { title: serverTitle, querySelector: () => null };
    // A fresh module instance re-reads the served title, as a page load does.
    const served = await import(`./clientDocumentMeta.js?served=${view}`);
    // Boot asks for "home" before the About/Rules surface opens; the served
    // page title must survive that first call too.
    assert.equal(served.setDocumentMeta({ view: "home" }).title, serverTitle, `${pathname} keeps its server title at boot`);
    const result = served.setDocumentMeta({ view });
    assert.equal(result.title, serverTitle, `${pathname} keeps its server title`);
    assert.equal(globalThis.document.title, serverTitle, `${pathname} document title is untouched`);
    // The live announcement stays short even when the title is search copy.
    assert.equal(result.announcement, appTitle, `${pathname} announces its in-app name`);
    // A different in-app view on another URL is not stuck with the served title.
    globalThis.location = { pathname: "/profile" };
    assert.equal(served.setDocumentMeta({ view: "profile" }).title, "Poorup | Profile", `${pathname} does not leak its title to other views`);
  }
  delete globalThis.location;
}

console.log("client document metadata tests: passed");
