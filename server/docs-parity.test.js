import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const readmePath = path.join(repoRoot, "README.md");
const readme = fs.readFileSync(readmePath, "utf8");
const markdownTargets = [...readme.matchAll(/\[[^\]]+\]\(([^)]+\.md(?:#[^)]+)?)\)/g)]
  .map(([, target]) => target.split("#", 1)[0]);

assert.ok(markdownTargets.length > 0, "README.md should retain local documentation links");

for (const target of markdownTargets) {
  assert.equal(
    fs.existsSync(path.resolve(repoRoot, target)),
    true,
    `README.md points to a missing repository document: ${target}`,
  );
}

assert.equal(
  fs.existsSync(path.join(repoRoot, "design", "poorup_design_system.md")),
  true,
  "the canonical Poorup design-system source must remain in the repository",
);

console.log(`server docs parity tests: passed (${markdownTargets.length} local README links)`);
