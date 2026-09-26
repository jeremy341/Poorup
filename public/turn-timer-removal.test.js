import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const root = path.dirname(fileURLToPath(import.meta.url));
for (const file of ['clientHudRender.js', 'clientState.js', 'clientStateSync.js', 'main.js', 'index.html', 'styles.css']) {
  const source = fs.readFileSync(path.join(root, file), 'utf8');
  assert.doesNotMatch(source, /turnTimer|turnDeadline|hud-timer|Turn timer/i, `${file} retains per-turn timer UI state`);
}

console.log('per-turn client timer removal contract: passed');
