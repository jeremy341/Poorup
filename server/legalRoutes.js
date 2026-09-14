import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PUBLIC_DIRECTORY = fileURLToPath(new URL("../public/", import.meta.url));

export const LEGAL_DOCUMENTS = Object.freeze({
  privacy: "privacy.html",
  terms: "terms.html",
  support: "support.html",
  licenses: "licenses.html",
});

const LEGAL_ALIASES = Object.freeze({
  "/legal/privacy": "privacy",
  "/legal/terms": "terms",
  "/legal/support": "support",
  "/legal/licenses": "licenses",
});

export function renderLegalIndex() {
  const links = Object.keys(LEGAL_DOCUMENTS)
    .map((slug) => `<li><a class="legal-index-link" href="/legal/${slug}">${slug.toUpperCase()}</a></li>`)
    .join("");
  const sections = Object.keys(LEGAL_DOCUMENTS)
    .map((slug) => `<section id="${slug}"><h2>${slug.toUpperCase()}</h2><p class="legal-slot" data-copy-slot="${slug}-summary">[COPY INJECTION: APPROVED ${slug.toUpperCase()} SUMMARY]</p><a class="legal-index-link" href="/legal/${slug}">Open ${slug}</a></section>`)
    .join("");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="robots" content="noindex,nofollow">
    <title>Legal information | Poorup</title>
    <link rel="stylesheet" href="/styles.css">
  </head>
  <body class="legal-page">
    <a class="skip-link" href="#legal-main">Skip to main content</a>
    <main class="legal-main" id="legal-main">
      <div class="legal-kicker t-micro g400">POORUP INFORMATION</div>
      <h1>Legal information</h1>
      <p class="legal-slot" data-copy-slot="legal-index-intro">[COPY INJECTION: APPROVED LEGAL HUB INTRODUCTION]</p>
      <nav class="legal-nav" aria-label="Legal documents"><ul>${links}</ul></nav>
      <div class="legal-sections">${sections}</div>
      <p class="legal-updated t-micro ink-3">LAST UPDATED: <time data-copy-slot="last-updated">[COPY INJECTION: LAST UPDATED DATE]</time></p>
      <p><a class="legal-return" href="/">Return to the parlor</a></p>
    </main>
    <footer class="ticker legal-ticker" aria-label="Poorup footer">
      <span class="t-micro tk"><span class="g400">AFTER-HOURS PARLOR</span></span>
      <span class="t-micro tk"><span class="g800 tk-sep" aria-hidden="true">·</span><span class="g400">live table service</span></span>
      <span class="t-micro tk legal-links" aria-label="Legal information"><a href="/legal#privacy">PRIVACY</a><span aria-hidden="true">·</span><a href="/legal#terms">TERMS</a><span aria-hidden="true">·</span><a href="/legal#support">SUPPORT</a></span>
    </footer>
  </body>
</html>`;
}

function resolveDocument(slug, publicDirectory) {
  const fileName = LEGAL_DOCUMENTS[slug];
  return fileName ? path.join(publicDirectory, "legal", fileName) : "";
}

export function createLegalRouter({ publicDirectory = DEFAULT_PUBLIC_DIRECTORY } = {}) {
  const router = express.Router();
  router.get("/legal", (_req, res) => res.type("html").send(renderLegalIndex()));
  router.get("/acceptable-use", (_req, res) => res.redirect(302, "/terms#acceptable-use"));
  const serve = (slug) => (_req, res, next) => {
    const filePath = resolveDocument(slug, publicDirectory);
    if (!filePath) return next();
    return res.sendFile(filePath, { headers: { "Cache-Control": "public, max-age=300" } }, next);
  };
  Object.keys(LEGAL_DOCUMENTS).forEach((slug) => {
    router.get(`/${slug}`, serve(slug));
  });
  Object.entries(LEGAL_ALIASES).forEach(([route, slug]) => {
    router.get(route, serve(slug));
  });
  return router;
}

export { DEFAULT_PUBLIC_DIRECTORY, LEGAL_ALIASES };
