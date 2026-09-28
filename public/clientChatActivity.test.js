import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const [state, socket, sync, main] = await Promise.all([
  readFile(new URL('./clientState.js', import.meta.url), 'utf8'),
  readFile(new URL('./clientSocketListeners.js', import.meta.url), 'utf8'),
  readFile(new URL('./clientStateSync.js', import.meta.url), 'utf8'),
  readFile(new URL('./main.js', import.meta.url), 'utf8'),
]);

function test(name, run) { run(); console.log(`PASS ${name}`); }
test('removesGenericStartupChatLines', () => {
  assert.doesNotMatch(state, /TABLE OPENED\. CHOOSE YOUR APPEARANCE|JOIN A ROOM TO GET STARTED/);
});
test('keepsHumanAndIntentionalBotMessagesWithSender', () => {
  assert.match(socket, /socket\.on\("chat-message", onChatMessage\)/);
  assert.match(socket, /findChatSender\(nickname, senderId\)/);
  assert.match(socket, /host\.say\(text, sender/);
});
test('routesBotDiagnosticsAndConnectionChangesOutOfChat', () => {
  assert.doesNotMatch(socket, /host\.say\(`\$\{status\.nickname\} chose/);
  assert.match(socket, /host\.setConnectionStatus\("reconnecting", true\)/);
  assert.match(main, /if \(announce\)[\s\S]*?setConnectionStatus/);
});
test('preservesSingleActivityEntryForFeedBackedSystemNotice', () => {
  assert.match(state, /activityNotices: \[\]/);
  assert.match(sync, /export function syncLog/);
  assert.match(sync, /arrayOr\(state\.activityNotices\)/);
  assert.match(socket, /routeActivityNotice/);
});
test('lifecycleNoticesReachActivityAndFeedBackedNoticesAreNotEmittedTwice', () => {
  assert.match(socket, /host\.addActivityNotice\(text\)/);
  assert.doesNotMatch(socket, /system-message"\s*,\s*\(\{ text \}\) => \{ host\.say/);
});
