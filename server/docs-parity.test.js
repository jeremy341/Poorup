import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "..");
const read = relativePath => fs.readFileSync(path.join(repoRoot, relativePath), "utf8");

const readme = read("README.md");
const showcase = read("SHOWCASE.md");
const instructions = read("Instructions.md");
const accountDesign = read(".ulpi/design/ACCOUNT-PROFILE.md");
const homeDesign = read(".ulpi/design/HOME-PROFILE-REDESIGN.md");
const themeDesign = read(".ulpi/design/THEME-FIVE-VISUAL-BRAINSTORM.md");
const nightShiftDesign = read(".ulpi/design/NIGHT-SHIFT-MICROGAME-PLAN.md");
const refactorRoadmap = read("docs/REFACTOR-ROADMAP.md");
const inGamePlan = read("docs/plans/IN-GAME-UX-IMPLEMENTATION-PLAN.md");
const branchPlan = read("docs/superpowers/plans/2026-09-13-branch-release-maintenance-analytics.md");
const productionHardening = read("docs/production-hardening.md");

assert.doesNotMatch(readme, /no downloads?\s+(?:or\s+)?accounts?\s+required/i);
assert.doesNotMatch(showcase, /no downloads,\s*no accounts?\b/i);
assert.doesNotMatch(`${readme}\n${showcase}`, /\bv2\.4\.1\b/i);
assert.match(readme, /accounts?\s+(?:are|remain)\s+optional/i);
assert.match(showcase, /accounts?\s+(?:are|remain)\s+optional/i);

assert.doesNotMatch(homeDesign, /profileViewState/i);
assert.doesNotMatch(accountDesign, /expired sessions fail closed/i);
assert.doesNotMatch(themeDesign, /use native `?320[×x]180` masters\. all assets/i);
assert.doesNotMatch(nightShiftDesign, /debris-6-frames\.svg.*used only at the border/i);
assert.doesNotMatch(branchPlan, /Expected: current branch is codex\/codescene-cleanup, latest commit is 94eb1b0/i);

assert.match(readme, /Metro-52/i);
for (const feature of ["rulesets", "bots", "events", "contracts", "seasons", "market"]) {
  assert.match(instructions, new RegExp(feature, "i"), `Instructions.md should name ${feature}`);
}

for (const currentDoc of [refactorRoadmap, inGamePlan, branchPlan, productionHardening]) {
  assert.match(currentDoc, /docs\/feature-status\.json/);
}

console.log("server docs parity tests: passed");
