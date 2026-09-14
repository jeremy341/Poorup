import express from "express";
import path from "node:path";
import { fileURLToPath } from "node:url";

const DEFAULT_PUBLIC_DIRECTORY = fileURLToPath(new URL("../public/", import.meta.url));

export const LEGAL_DOCUMENTS = Object.freeze({
  "acceptable-use": "acceptable-use.html",
  accessibility: "accessibility.html",
  ai: "ai.html",
  privacy: "privacy.html",
  terms: "terms.html",
  support: "support.html",
  licenses: "licenses.html",
  storage: "storage.html",
});

const LEGAL_ALIASES = Object.freeze({
  "/legal/acceptable-use": "acceptable-use",
  "/legal/accessibility": "accessibility",
  "/legal/ai": "ai",
  "/legal/privacy": "privacy",
  "/legal/terms": "terms",
  "/legal/support": "support",
  "/legal/licenses": "licenses",
  "/legal/storage": "storage",
});

const DOCUMENT_SUMMARIES = Object.freeze({
  "acceptable-use": "Fair-play and community rules for every table.",
  accessibility: "Keyboard, contrast, motion, and assistive-technology commitments.",
  ai: "How optional bot advisors work and what context they receive.",
  licenses: "Fonts, music, art, and third-party notices used by Poorup.",
  privacy: "What information the parlor can process and how visibility works.",
  storage: "Browser storage, essential preferences, and aggregate telemetry.",
  support: "Bug reports, security reports, recovery, and data-request routes.",
  terms: "The rules for using Poorup, rooms, accounts, and fictional currency.",
});

const DOCUMENT_LABELS = Object.freeze({
  "acceptable-use": "Acceptable use",
  accessibility: "Accessibility",
  ai: "AI and bots",
  licenses: "Licenses",
  privacy: "Privacy",
  storage: "Storage and telemetry",
  support: "Support",
  terms: "Terms",
});

export function renderLegalIndex() {
  const links = Object.keys(LEGAL_DOCUMENTS)
    .sort()
    .map((slug) => `<li><a class="legal-index-link" href="/legal/${slug}">${DOCUMENT_LABELS[slug].toUpperCase()}</a></li>`)
    .join("");
  const sections = Object.keys(LEGAL_DOCUMENTS)
    .sort()
    .map((slug) => `<section id="${slug}"><h2>${DOCUMENT_LABELS[slug]}</h2><p>${DOCUMENT_SUMMARIES[slug]}</p><div class="legal-card-meta"><span>DRAFT · NOT EFFECTIVE</span><a class="legal-index-link" href="/legal/${slug}">OPEN DOCUMENT</a></div></section>`)
    .join("");
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="robots" content="noindex,nofollow">
    <meta name="theme-color" content="#01070a">
    <title>Legal information | Poorup</title>
    <link rel="stylesheet" href="/styles.css">
  </head>
  <body class="legal-page">
    <a class="skip-link" href="#legal-main">Skip to main content</a>
    <div class="legal-shell">
      <header class="hdr legal-header">
        <a class="hdr-brand legal-brand" href="/" aria-label="Return to the Poorup parlor">
          <span class="legal-mark" aria-hidden="true"></span>
          <span class="hdr-brand-text"><span class="hdr-wordmark">Poorup</span><span class="t-micro ink-3 hdr-sub">legal desk</span></span>
        </a>
        <span class="legal-breadcrumb t-micro g400">LEGAL / INDEX</span>
        <div class="hdr-right"><a class="btn-dark legal-back" href="/">BACK TO PARLOR</a></div>
      </header>
      <main class="legal-document-main legal-index-main" id="legal-main" tabindex="-1">
        <section class="legal-hero panel noise">
          <div class="legal-kicker t-micro g400">POORUP INFORMATION</div>
          <h1>Legal information</h1>
          <p class="legal-lede">Clear notices for the after-hours parlor: how the game works, what data it uses, and where to get help.</p>
          <div class="legal-meta-row"><span>DRAFT · NOT EFFECTIVE</span><span>VERSION PENDING</span><span>LAST UPDATED PENDING</span></div>
        </section>
        <section class="legal-draft-banner panel noise" aria-label="Draft status">
          <strong>DRAFT — NOT EFFECTIVE</strong>
          <p>This release contains complete plain-language draft content. It must be reviewed with the Poorup operator’s identity, contact details, retention decisions, and governing law before it is published as binding policy.</p>
        </section>
        <section class="legal-index-section">
          <div class="legal-section-heading"><span class="t-micro g400">DOCUMENTS</span><h2>Choose a notice</h2><span class="hair"></span></div>
          <nav class="legal-nav" aria-label="Legal documents"><ul>${links}</ul></nav>
          <div class="legal-sections">${sections}</div>
        </section>
        <section class="legal-contact panel noise"><h2>Operator and support contact</h2><p>The operator name, postal address, privacy contact, and support channel will be shown here before this document set becomes effective.</p><a class="legal-return" href="/legal/support">OPEN SUPPORT NOTICE</a></section>
      </main>
      <footer class="ticker legal-ticker" aria-label="Poorup footer">
        <span class="t-micro tk"><span class="g400">AFTER-HOURS PARLOR</span></span>
        <span class="t-micro tk"><span class="g800 tk-sep" aria-hidden="true">·</span><span class="g400">live table service</span></span>
        <span class="t-micro tk legal-links" aria-label="Legal information"><a href="/legal#privacy">PRIVACY</a><span aria-hidden="true">·</span><a href="/legal#terms">TERMS</a><span aria-hidden="true">·</span><a href="/legal#support">SUPPORT</a></span>
      </footer>
    </div>
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
  const serve = (slug) => (_req, res, next) => {
    const filePath = resolveDocument(slug, publicDirectory);
    if (!filePath) return next();
    return res.sendFile(filePath, { headers: { "Cache-Control": "public, max-age=300" } }, (error) => {
      if (error) next(error);
    });
  };
  router.get("/acceptable-use", serve("acceptable-use"));
  Object.keys(LEGAL_DOCUMENTS).forEach((slug) => {
    router.get(`/${slug}`, serve(slug));
  });
  Object.entries(LEGAL_ALIASES).forEach(([route, slug]) => {
    router.get(route, serve(slug));
  });
  return router;
}

export { DEFAULT_PUBLIC_DIRECTORY, LEGAL_ALIASES };
