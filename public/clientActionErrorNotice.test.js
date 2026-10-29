import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const owners = ['clientRailEvents.js', 'clientAuctionUi.js', 'clientCasinoUi.js', 'clientDealUi.js', 'clientGameModalsUi.js', 'clientMarketUi.js', 'clientSponsorshipUi.js', 'clientTradeUi.js', 'clientDeedDetailUi.js', 'clientLobbyUi.js', 'clientRoomsUi.js'];
const [source, account, socketListeners, ...ownerSources] = await Promise.all([
  readFile(new URL('./main.js', import.meta.url), 'utf8'),
  readFile(new URL('./clientAccountIdentity.js', import.meta.url), 'utf8'),
  readFile(new URL('./clientSocketListeners.js', import.meta.url), 'utf8'),
  ...owners.map(owner => readFile(new URL(`./${owner}`, import.meta.url), 'utf8')),
]);
const report = source.slice(source.indexOf('function reportChatError'), source.indexOf('function homeProfileEditTarget'));
assert.match(source, /announceActionStatus/);
assert.match(source, /statusNode/);
assert.match(source, /function captureActionStatusNode/);
assert.match(source, /statusNode\.textContent = text/);
assert.match(source, /\$\("#error-announcer"\)/);
assert.match(source, /function emitWithChatError\(event, payload, message, statusNode = captureActionStatusNode\(\)\)/);
assert.match(source, /announceActionStatus\(text, statusNode\)/);
assert.doesNotMatch(source, /CHAT_ERRORISH|test\(String\(text\)\)/);
assert.match(source, /function say\(text, who\) \{\s*if \(!who\) return;/);
assert.doesNotMatch(report, /say\(text\)|renderChat\(\)|parlorNotice/);
console.log('PASS keepsRejectionBesideActionAndAnnouncesOnceWithoutChatLine');
assert.ok(ownerSources.every(owner => /host\.announceActionStatus\(/.test(owner)), 'each action owner must announce failures through the shared hook');
assert.ok(ownerSources.every(owner => /captureActionStatusNode\(/.test(owner)), 'each action owner must capture the originating control status node');
assert.ok(ownerSources.every(owner => !/host\.say\(/.test(owner)), 'action owners must not route errors through generic say');
console.log('PASS eachSubmittingControlProvidesItsOwnStatusNode');
assert.match(account, /host\.notice\("ACCOUNT", accountSubmitSuccessMessage\(\)\)/);
assert.match(account, /host\.notice\("ACCOUNT", "Signed out\. Guest mode is active\."\)/);
assert.doesNotMatch(account, /host\.say\(/);
assert.match(account, /host\.announceActionStatus\(message, \$\("#account-form-error"\)\)/);
assert.match(socketListeners, /host\.notice\("ACCOUNT"/);
assert.match(socketListeners, /host\.say\(text, sender/);
assert.doesNotMatch(ownerSources.join('\n'), /host\.say\(/);
console.log('PASS nonConversationUpdatesStayVisibleOutsideChat');
