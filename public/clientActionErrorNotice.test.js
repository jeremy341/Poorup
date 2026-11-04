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

// Raw error codes: friendly text, server sentences untouched.
const { friendlyActionError } = await import('./clientActionErrorCopy.js');
for (const code of ['OPTION_TERMS_SERVER_REQUIRED', 'REQUEST_ID_EXPIRED', 'MAINTENANCE_DRAINING', 'DELETION_IN_PROGRESS', 'RECOVERY_MAIL_UNAVAILABLE']) {
  const text = friendlyActionError(code);
  assert.notEqual(text, code);
  assert.doesNotMatch(text, /[A-Z]{3,}_[A-Z_]+/, `${code} must not leak through`);
}
assert.equal(friendlyActionError('OPTION_TERMS_SERVER_REQUIRED'), "Options aren't available on this table yet.");
assert.equal(friendlyActionError('Resolve the open sponsorship before managing this property.'), 'Resolve the open sponsorship before managing this property.');
assert.doesNotMatch(friendlyActionError('Another trade is already pending.'), /Another trade is already pending/);
assert.match(friendlyActionError('You cannot message a blocked player in this room.'), /Room chat is paused/);
assert.equal(friendlyActionError(''), '');
assert.match(source, /friendlyActionError\(message \|\| "Action could not be completed\."\)/, 'the shared notice maps codes before showing them');
console.log('PASS rawServerCodesBecomeFriendlyCopy');

// The chat draft survives a failed send and clears only on acknowledgement.
const { createChatSender } = await import('./clientChatSend.js');
function chatHarness(respond) {
  const input = { value: '  hello table  ' };
  const sent = [];
  let acks = [];
  const sender = createChatSender({
    getInput: () => input,
    canSend: () => true,
    send: (text, done) => { sent.push(text); if (respond) done(respond); else acks.push(done); },
    schedule: () => 1,
    cancel: () => {},
  });
  return { input, sent, acks, sender, submit: () => sender({ preventDefault() {} }) };
}
{
  const failed = chatHarness({ success: false, error: 'Please wait before sending another message.' });
  failed.submit();
  assert.equal(failed.input.value, '  hello table  ', 'a rejected send keeps the draft');
  const ok = chatHarness({ success: true });
  ok.submit();
  assert.equal(ok.input.value, '', 'an acknowledged send clears the input');
  const pending = chatHarness(null);
  pending.submit();
  assert.equal(pending.input.value, '  hello table  ', 'the draft stays until the server answers');
  pending.submit();
  assert.deepEqual(pending.sent, ['hello table'], 'no duplicate send while waiting');
  pending.input.value = 'something newer';
  pending.acks[0]({ success: true });
  assert.equal(pending.input.value, 'something newer', 'newer typing is never wiped by an old ack');
}
assert.match(source, /createChatSender\(\{/);
assert.doesNotMatch(source, /input\.value = "";\s*emitWithChatError\("send-chat"/);
console.log('PASS chatDraftSurvivesFailedSend');

// Copy truthfulness (market notice).
const [parlorCopy, socialCopy, marketCopy, casinoCopy, railCopy] = await Promise.all(
  ['clientParlorBindings.js', 'clientSocialSurfaces.js', 'clientMarketUi.js', 'clientCasinoUi.js', 'clientRailRender.js']
    .map(file => readFile(new URL(`./${file}`, import.meta.url), 'utf8')),
);
assert.doesNotMatch(parlorCopy, /parlor moderators/i, 'reports are recorded for review, nobody is promised to act');
assert.match(parlorCopy, /Report recorded for review\./);
assert.match(parlorCopy, /Room chat pauses for you and them while you share a room/, 'block copy states the real room-chat effect');
assert.match(socialCopy, /idle for 3 minutes can be removed by inactivity/, 'turn-time copy quotes the 180 s inactivity removal');
const { PLAYER_INACTIVITY_REMOVAL_MS } = await import('../server/playerPresence.js');
assert.equal(PLAYER_INACTIVITY_REMOVAL_MS, 3 * 60 * 1000, 'copy says 3 minutes; keep it in step with the server constant');
assert.doesNotMatch(`${socialCopy}
${casinoCopy}
${railCopy}`, /fictional (board )?(money|cash)|fictional casino result|fictional market result/i, 'cash games use in-game cash, not a separate currency');
assert.doesNotMatch(marketCopy, /SERVER PRICING POLICY NOT CONFIGURED/);
assert.match(marketCopy, /Options aren't available on this table yet\./);
console.log('PASS copyMatchesWhatTheProductDoes');
