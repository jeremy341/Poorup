import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('.', import.meta.url));
const index = readFileSync(join(root, 'index.html'), 'utf8');
const styles = readFileSync(join(root, 'styles.css'), 'utf8');
const source = readFileSync(join(root, 'clientAdminAiProvider.js'), 'utf8');

assert.match(index, /data-admin-console-tabs/);
assert.match(index, /data-admin-console-tab="provider"/);
assert.match(index, /data-admin-provider-workspace/);
assert.match(index, /data-admin-provider-field="baseUrl"[^>]*type="url"/);
assert.match(index, /data-admin-provider-field="apiKey"[^>]*type="password"[^>]*autocomplete="new-password"/);
assert.match(index, /data-admin-provider-field="protocol"/);
assert.match(index, /data-admin-provider-field="model"/);
assert.doesNotMatch(index, /data-admin-provider-field="apiKey"[^>]*value=/i);
assert.match(styles, /\.admin-provider-workspace/);
assert.match(styles, /@keyframes admin-provider-in/);
assert.match(styles, /prefers-reduced-motion:\s*reduce[\s\S]*?admin-provider-workspace/);
assert.match(source, /x-poorup-session-token/);
assert.match(source, /cache:\s*['"]no-store['"]/);
assert.match(source, /credentials are write-only|write-only/i);
assert.match(source, /ArrowLeft|ArrowRight/);
assert.match(source, /poorup-bot-provider-status/);
assert.doesNotMatch(source, /localStorage/);

console.log('admin AI provider client contract: passed');
