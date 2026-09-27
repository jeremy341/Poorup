import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('../public/clientSocketListeners.js', import.meta.url), 'utf8');
assert.match(source, /socket\.on\("system-message", \(\{ text \}\) => \{[\s\S]*?routeActivityNotice\(text\)/);
assert.match(source, /socket\.on\("chat-message", onChatMessage\)/);
assert.match(source, /senderId/);
console.log('PASS lifecycleNoticesReachActivityAndFeedBackedNoticesAreNotEmittedTwice');
