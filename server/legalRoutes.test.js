import assert from "node:assert/strict";
import express from "express";
import http from "node:http";
import path from "node:path";
import fs from "node:fs";
import { LEGAL_DOCUMENTS, createLegalRouter, renderLegalIndex } from "./legalRoutes.js";

assert.deepEqual(Object.keys(LEGAL_DOCUMENTS).sort(), ["licenses", "privacy", "support", "terms"]);
const index = renderLegalIndex();
assert.match(index, /<h1[^>]*>Legal information<\/h1>/i);
for (const slug of Object.keys(LEGAL_DOCUMENTS)) assert.match(index, new RegExp(`/legal/${slug}`));
for (const slug of Object.keys(LEGAL_DOCUMENTS)) assert.match(index, new RegExp(`id="${slug}"`));
assert.match(index, /href="\/"[^>]*>Return to the parlor/i);
assert.equal(typeof createLegalRouter, "function");
for (const fileName of Object.values(LEGAL_DOCUMENTS)) {
  const html = fs.readFileSync(path.join("public", "legal", fileName), "utf8");
  assert.equal((html.match(/<h1\b/gi) || []).length, 1);
  assert.match(html, /class="skip-link"/);
  assert.match(html, /<nav[^>]+aria-label=/i);
  assert.match(html, /data-copy-slot="last-updated"/);
  assert.match(html, /class="legal-return"[^>]+href="\/"/);
  assert.doesNotMatch(html, /<script\b/i);
}

const router = createLegalRouter({ publicDirectory: path.resolve("public") });
assert.equal(typeof router, "function");

const app = express();
app.use(router);
const server = http.createServer(app);
await new Promise((resolve) => server.listen(0, resolve));
const { port } = server.address();
try {
  const indexResponse = await fetch(`http://127.0.0.1:${port}/legal`);
  const indexBody = await indexResponse.text();
  assert.equal(indexResponse.status, 200);
  assert.match(indexBody, /<h1[^>]*>Legal information<\/h1>/i);
  for (const slug of Object.keys(LEGAL_DOCUMENTS)) {
    const response = await fetch(`http://127.0.0.1:${port}/${slug}`);
    const body = await response.text();
    assert.equal(response.status, 200);
    assert.match(body, /<h1[^>]*>/i);
    assert.match(body, /Skip to main content/);
  }
} finally {
  await new Promise((resolve) => server.close(resolve));
}

console.log("legal route tests: passed");
