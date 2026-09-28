import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
const source = await readFile(new URL('./main.js', import.meta.url), 'utf8');
const chat = source.slice(source.indexOf('function chatRenderPlan('), source.indexOf('function renderStep('));
const chatView = await import('./clientChatView.js').catch(() => null);
function test(name, run) { run(); console.log(`PASS ${name}`); }
test('preservesReaderOffsetWhenScrolledUp', () => assert.match(chat, /wasNearBottom[\s\S]*scrollTop/));
test('followsReaderWhenNearBottom', () => assert.match(chat, /wasNearBottom[\s\S]*scrollHeight/));
test('showsNewMessageAffordanceWithoutTakingFocus', () => {
  assert.match(chat, /new-message/);
  assert.doesNotMatch(chat, /\.focus\(/);
});
test('boundedChatRolloverDefersRenderPreservingAnchor', () => {
  const getChatRenderPlan = chatView?.getChatRenderPlan;
  assert.equal(typeof getChatRenderPlan, 'function', 'chat rendering needs a tested bounded-window decision helper');
  assert.match(chat, /getChatRenderPlan\(/);
  assert.match(chat, /if \(renderPlan\.updateContent\) renderChatMessages\(body\)/);
  assert.match(chat, /function renderChatMessages\(body\)[\s\S]*?body\.innerHTML/);
  let mountedRows = Array.from({ length: 60 }, (_, index) => index + 1);
  let scrollTop = 240;
  const currentRows = Array.from({ length: 61 }, (_, index) => index + 1);
  const rollover = getChatRenderPlan({ isFirstRender: false, isNearBottom: false, roomChanged: false, hasNewMessages: true });
  if (rollover.updateContent) mountedRows = currentRows.slice(-60);
  if (rollover.followBottom) scrollTop = 999;
  assert.deepEqual(mountedRows, Array.from({ length: 60 }, (_, index) => index + 1), 'an off-bottom reader keeps the original first visible row mounted');
  assert.equal(scrollTop, 240, 'off-bottom chat rendering does not move the reader');
  assert.deepEqual(rollover, { updateContent: false, followBottom: false, showNewMessages: true });

  const follow = getChatRenderPlan({ isFirstRender: false, isNearBottom: true, roomChanged: false, hasNewMessages: true });
  if (follow.updateContent) mountedRows = currentRows.slice(-60);
  if (follow.followBottom) scrollTop = 999;
  assert.deepEqual(mountedRows, currentRows.slice(-60), 'following replaces the bounded window with the latest 60 rows');
  assert.equal(scrollTop, 999, 'following returns the reader to the bottom');
  assert.deepEqual(follow, { updateContent: true, followBottom: true, showNewMessages: false });
});
