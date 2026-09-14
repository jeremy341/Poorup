import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const manifestPath = path.join(repoRoot, "docs", "feature-status.json");

assert.equal(fs.existsSync(manifestPath), true, "docs/feature-status.json must exist");

const manifest = JSON.parse(fs.readFileSync(manifestPath, "utf8"));
assert.equal(manifest.sourceCommit, "151b480");
assert.equal(typeof manifest.generatedAt, "string");
assert.equal(Number.isNaN(Date.parse(manifest.generatedAt)), false);
assert.equal(Array.isArray(manifest.features), true);
assert.ok(manifest.features.length > 0, "manifest must contain at least one feature");

const allowedStatuses = new Set(["active", "complete", "planned", "reference", "deferred"]);
const featureIds = new Set();

for (const feature of manifest.features) {
  assert.equal(typeof feature.id, "string");
  assert.ok(feature.id.length > 0, "feature IDs must be non-empty");
  assert.equal(featureIds.has(feature.id), false, `duplicate feature ID: ${feature.id}`);
  featureIds.add(feature.id);

  assert.equal(allowedStatuses.has(feature.status), true, `unsupported status: ${feature.status}`);
  assert.equal(typeof feature.ownerSurface, "string");
  assert.ok(feature.ownerSurface.length > 0, `ownerSurface missing for ${feature.id}`);
  assert.equal(Array.isArray(feature.evidence), true, `evidence missing for ${feature.id}`);
  assert.ok(feature.evidence.length > 0, `evidence empty for ${feature.id}`);

  for (const evidencePath of feature.evidence) {
    assert.equal(typeof evidencePath, "string");
    assert.equal(path.isAbsolute(evidencePath), false, `evidence must be relative: ${evidencePath}`);
    assert.equal(
      fs.existsSync(path.join(repoRoot, evidencePath)),
      true,
      `missing evidence for ${feature.id}: ${evidencePath}`,
    );
  }
}

console.log(`server docs feature status tests: passed (${manifest.features.length} features)`);
