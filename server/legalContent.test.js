import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { LEGAL_DOCUMENTS, renderLegalIndex } from "./legalRoutes.js";

const expectedDocuments = ["acceptable-use", "accessibility", "ai", "licenses", "privacy", "storage", "support", "terms"].sort();
assert.deepEqual(Object.keys(LEGAL_DOCUMENTS).sort(), expectedDocuments);

const hub = renderLegalIndex();
assert.match(hub, /class="legal-shell"/i);
assert.match(hub, /LEGAL DESK/i);
assert.match(hub, /DRAFT[^<]*NOT EFFECTIVE/i);
assert.doesNotMatch(hub, /COPY INJECTION/i);

for (const slug of expectedDocuments) {
  const html = fs.readFileSync(path.join("public", "legal", `${slug}.html`), "utf8");
  assert.equal((html.match(/<h1\b/gi) || []).length, 1, `${slug} must have one h1`);
  assert.match(html, /class="legal-shell"/i, `${slug} must use the shared shell`);
  assert.match(html, /LEGAL DESK/i, `${slug} must expose the legal header`);
  assert.match(html, /name="theme-color"[^>]+#01070a/i, `${slug} must keep the browser chrome color`);
  assert.match(html, /DRAFT[^<]*NOT EFFECTIVE/i, `${slug} must disclose draft status`);
  assert.match(html, /class="legal-outline"/i, `${slug} must expose an outline`);
  assert.match(html, /class="legal-article"/i, `${slug} must expose an article`);
  assert.match(html, /class="legal-related"/i, `${slug} must expose related links`);
  assert.match(html, /class="[^"]*\blegal-ticker\b[^"]*"/i, `${slug} must keep the footer ticker`);
  assert.doesNotMatch(html, /COPY INJECTION/i, `${slug} still contains a placeholder`);
  assert.doesNotMatch(html, /<script\b/i, `${slug} must work without JavaScript`);
}

console.log("legal content contracts: expected documents and complete draft sections are present");
