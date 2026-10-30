import assert from 'node:assert/strict';

globalThis.window = { matchMedia: () => ({ matches: false, addEventListener() {} }) };
const { state } = await import('./clientState.js');
const wallet = await import('./clientWalletUi.js');
const deal = await import('./clientDealUi.js');
const key = { itemId: 'key-1', catalogId: 'prison-key', name: 'Prison Key', description: 'Leave prison using one key.', quantity: 1, sellValue: 25, canUse: false, canSell: true, actionLabel: 'USE', useReason: 'Use on your turn in prison.' };
const bond = { itemId: 'bond-1', catalogId: 'parlor-bond', name: 'Parlor Bond', description: 'Redeem after two rounds.', quantity: 1, sellValue: 50, redeemValue: 100, maturesRound: 9, canUse: false, canSell: true, actionLabel: 'REDEEM', useReason: 'Matures in round 9.' };
const keepsake = { itemId: 'silver-1', catalogId: 'silver-keepsake', name: 'Silver Keepsake', description: 'A collectible.', quantity: 1, sellValue: 75, canUse: false, canSell: true };
state.roundNumber = 7;
for (const [item, value, glyph] of [[key, 25, 'prison-key'], [bond, 50, 'parlor-bond'], [keepsake, 75, 'silver-keepsake']]) {
  const row = wallet.itemRowHTML(item, null);
  assert.match(row, new RegExp(item.name.toUpperCase()));
  assert.match(row, new RegExp(`BANK \\$${value}`));
  assert.match(row, new RegExp(`SELL \\$${value}`));
  assert.ok(row.includes(`href="/assets/item-icons.svg#${glyph}"`));
  assert.match(row, /<svg[^>]*viewBox="0 0 24 24"[^>]*aria-hidden="true"[^>]*focusable="false"/);
  assert.doesNotMatch(row, /TRADE|EXCHANGE|PERSISTENT|COMMON|✦/);
}
assert.match(wallet.itemRowHTML(key, null), /data-wallet-item-action="use"[^>]*disabled/);
assert.match(wallet.itemRowHTML(key, null), /Use on your turn in prison/);
assert.match(wallet.itemRowHTML(bond, null), /MATURES ROUND 9/);
assert.doesNotMatch(wallet.itemRowHTML(bond, null), /class="t-micro ink-3">Matures in round 9\./);
assert.match(wallet.itemRowHTML({ ...bond, useReason: 'It is not your turn.' }, null), /It is not your turn/);
assert.match(wallet.itemRowHTML(bond, null), /class="wallet-item-maturity">MATURES ROUND 9/);
assert.match(wallet.itemRowHTML({ ...bond, canUse: true }, null), /REDEEM \$100/);
assert.doesNotMatch(wallet.itemRowHTML(keepsake, null), /data-wallet-item-action="use"/);
assert.match(wallet.itemRowHTML({ ...keepsake, canSell: false, sellReason: 'It is not your turn.' }, null), /data-wallet-item-action="sell"[^>]*disabled/);
assert.match(wallet.itemRowHTML({ ...key, redeemValue: 0 }, null), />USE</);
const classicKey = { ...key, sellValue: undefined, bankSellValue: 0, canSell: false, sellReason: 'This prison card cannot be sold under classic rules.' };
assert.match(wallet.itemRowHTML(classicKey, null), /NOT FOR SALE/);
assert.doesNotMatch(wallet.itemRowHTML(classicKey, null), /BANK \$0/);
assert.match(wallet.itemRowHTML({ ...keepsake, sellValue: 0 }, null), /BANK \$0/);
assert.match(wallet.itemRowHTML(key, null), /BANK \$25/);
assert.match(wallet.itemRowHTML({ ...key, sellValue: undefined }, null), /BANK VALUE UNAVAILABLE/);
assert.doesNotMatch(wallet.itemRowHTML({ ...key, sellValue: undefined }, null), /SELL \$0|BANK \$0/);
assert.match(wallet.itemRowHTML({ ...key, name: '<img onerror=x>', useReason: '<script>' }, null), /&lt;img onerror=x&gt;/i);

const card = { innerHTML: '', querySelector: () => null, querySelectorAll: () => [] };
globalThis.document = { querySelector: selector => selector === '#wallet-card' ? card : null };
state.players = [{ id: 'p1', items: [key, bond, keepsake] }];
state.walletView = 'items';
const sent = [];
let refreshes = 0;
wallet.configureWalletUi({ emitServer: (event, payload, ack) => sent.push({ event, payload, ack }), createRequestId: () => 'item-request', refreshWalletSnapshot: () => { refreshes += 1; } });
assert.equal(wallet.submitWalletItemAction('use', key.itemId), false, 'eligibility guards even a stale control');
assert.equal(wallet.submitWalletItemAction('trade', keepsake.itemId), false);
assert.equal(wallet.submitWalletItemAction('sell', keepsake.itemId), true);
assert.equal(wallet.submitWalletItemAction('sell', keepsake.itemId), false, 'double click reaches server once');
assert.deepEqual(sent[0].payload, { itemId: 'silver-1', requestId: 'item-request' });
assert.equal(sent[0].event, 'sell-item');
assert.match(card.innerHTML, /PROCESSING/);
sent[0].ack({ success: false, error: 'Item already used.' });
assert.match(card.innerHTML, /Item already used/);
assert.equal(wallet.submitWalletItemAction('sell', keepsake.itemId), true, 'error releases guard');
sent[1].ack({ success: true, action: 'sell', cashReceived: 75 });
assert.match(card.innerHTML, /Sold for \$75/);
assert.equal(refreshes, 2);

const realSetTimeout = globalThis.setTimeout;
const realClearTimeout = globalThis.clearTimeout;
let expire;
globalThis.setTimeout = callback => { expire = callback; return 1; };
globalThis.clearTimeout = () => {};
assert.equal(wallet.submitWalletItemAction('sell', bond.itemId), true);
expire();
assert.match(card.innerHTML, /could not be confirmed/i);
assert.equal(wallet.submitWalletItemAction('sell', bond.itemId), true);
assert.equal(sent.at(-1).payload.requestId, sent.at(-2).payload.requestId, 'retry preserves the idempotency key');
sent.at(-2).ack({ success: true, cashReceived: 50 });
assert.match(card.innerHTML, /PROCESSING/, 'late acknowledgement cannot settle a retry');
sent.at(-1).ack({ success: true, cashReceived: 50 });
// A response from a previous room must not settle or refresh the current wallet.
state.roomCode = 'OLD';
state.clientId = 'old-client';
state.players = [{ id: 'p1', serverId: 'old-player', items: [keepsake] }];
assert.equal(wallet.submitWalletItemAction('sell', keepsake.itemId), true);
const oldResponse = sent.at(-1);
state.roomCode = 'NEW';
state.clientId = 'new-client';
state.players = [{ id: 'p1', serverId: 'new-player', items: [keepsake] }];
assert.equal(wallet.submitWalletItemAction('sell', keepsake.itemId), true, 'new room can act on the same item id');
const currentResponse = sent.at(-1);
const refreshBeforeOldResponse = refreshes;
oldResponse.ack({ success: true, cashReceived: 75 });
assert.match(card.innerHTML, /PROCESSING/, 'old acknowledgement cannot change the new status');
assert.equal(refreshes, refreshBeforeOldResponse, 'old acknowledgement cannot refresh the new room');
currentResponse.ack({ success: true, cashReceived: 75 });
assert.match(card.innerHTML, /Sold for \$75/);

state.roomCode = 'OLD';
state.players = [{ id: 'p1', serverId: 'old-player', items: [bond] }];
assert.equal(wallet.submitWalletItemAction('sell', bond.itemId), true);
const oldTimeout = expire;
state.roomCode = 'NEW';
state.players = [{ id: 'p1', serverId: 'new-player', items: [bond] }];
assert.equal(wallet.submitWalletItemAction('sell', bond.itemId), true);
const refreshBeforeOldTimeout = refreshes;
oldTimeout();
assert.match(card.innerHTML, /PROCESSING/, 'old timeout cannot change the new status');
assert.equal(refreshes, refreshBeforeOldTimeout, 'old timeout cannot refresh the new room');
sent.at(-1).ack({ success: true, cashReceived: 50 });

// Changing account in the same room also isolates requests, even if returning.
let nextRequest = 0;
wallet.configureWalletUi({ createRequestId: () => `context-request-${++nextRequest}` });
state.roomCode = 'SHARED';
state.account = { account: { id: 'account-a' } };
state.players = [{ id: 'p1', serverId: 'same-player', items: [keepsake] }];
assert.equal(wallet.submitWalletItemAction('sell', keepsake.itemId), true);
const firstAccountRequest = sent.at(-1);
state.account = { account: { id: 'account-b' } };
state.players = [{ id: 'p1', serverId: 'same-player', items: [keepsake] }];
assert.equal(wallet.submitWalletItemAction('sell', keepsake.itemId), true);
const secondAccountRequest = sent.at(-1);
assert.notEqual(firstAccountRequest.payload.requestId, secondAccountRequest.payload.requestId);
state.account = { account: { id: 'account-a' } };
state.players = [{ id: 'p1', serverId: 'same-player', items: [keepsake] }];
assert.equal(wallet.submitWalletItemAction('sell', keepsake.itemId), true);
const returnedAccountRequest = sent.at(-1);
const refreshBeforeReturnedResponse = refreshes;
firstAccountRequest.ack({ success: true, cashReceived: 75 });
assert.match(card.innerHTML, /PROCESSING/, 'returning to an account does not revive an old callback');
assert.equal(refreshes, refreshBeforeReturnedResponse);
secondAccountRequest.ack({ success: false, error: 'Old account error' });
assert.match(card.innerHTML, /PROCESSING/);
returnedAccountRequest.ack({ success: true, cashReceived: 75 });

globalThis.setTimeout = realSetTimeout;
globalThis.clearTimeout = realClearTimeout;

state.clientId = 'self';
state.players = [{ clientId: 'self', serverId: 'p1' }];
state.settings.playerFinance = true;
const legacy = { id: 'legacy', kind: 'hybrid', rulesVersion: 1, fromPlayerId: 'p2', toPlayerId: 'p1', amount: 200 };
const actionOrder = html => [...html.matchAll(/data-deal-action="([^"]+)"/g)].map(match => match[1]);
const legacyHTML = deal.contractDetailHTML(legacy);
assert.match(legacyHTML, /DECLINE/);
assert.doesNotMatch(legacyHTML, /data-deal-action="back"/);
assert.match(legacyHTML, /earlier rules/i);
assert.doesNotMatch(legacyHTML, />ACCEPT<|>NEGOTIATE<|Enable Player Finance/i);
const oldLoan = { ...legacy, kind: 'loan', counterDepth: 0 };
const oldLoanRecipientHTML = deal.contractDetailHTML(oldLoan);
assert.deepEqual(actionOrder(oldLoanRecipientHTML), ['decline', 'negotiate']);
assert.match(oldLoanRecipientHTML, /class="cta-red"[^>]*data-deal-action="negotiate"/);
assert.match(oldLoanRecipientHTML, /update the terms before sending/i);
assert.doesNotMatch(oldLoanRecipientHTML, /data-deal-action="accept"/);
assert.match(oldLoanRecipientHTML, /data-deal-action="decline"/);
const oldLoanSenderHTML = deal.contractDetailHTML({ ...oldLoan, lastProposerId: 'p1', counterDepth: 1 });
assert.deepEqual(actionOrder(oldLoanSenderHTML), ['cancel', 'adjust']);
assert.match(oldLoanSenderHTML, /class="cta-red"[^>]*data-deal-action="adjust"/);
assert.match(oldLoanSenderHTML, /data-deal-action="cancel"/);
const limitedHTML = deal.contractDetailHTML({ ...oldLoan, counterDepth: 2 });
assert.doesNotMatch(limitedHTML, /data-deal-action="negotiate"|data-deal-action="adjust"/);
assert.match(limitedHTML, /class="cta-red"[^>]*data-deal-action="decline"/);
for (const kind of ['equity', 'equity-transfer', 'hybrid']) {
  assert.doesNotMatch(deal.contractDetailHTML({ ...oldLoan, kind }), /data-deal-action="negotiate"|data-deal-action="adjust"/);
}
const validHTML = deal.contractDetailHTML({ ...legacy, kind: 'loan', rulesVersion: 2 });
assert.deepEqual(actionOrder(validHTML), ['decline', 'negotiate', 'accept']);
assert.deepEqual(actionOrder(deal.contractDetailHTML({ ...legacy, kind: 'loan', rulesVersion: 2, lastProposerId: 'p1' })), ['cancel', 'adjust']);
assert.match(validHTML, />ACCEPT</);
assert.match(validHTML, />NEGOTIATE</);
assert.match(validHTML, />DECLINE</);
assert.match(validHTML, /class="cta-red"[^>]*data-deal-action="accept"/);
const currentLimitHTML = deal.contractDetailHTML({ ...legacy, kind: 'loan', rulesVersion: 2, counterDepth: 2 });
assert.deepEqual(actionOrder(currentLimitHTML), ['decline', 'negotiate', 'accept']);
assert.match(currentLimitHTML, /data-deal-action="negotiate"[^>]*disabled/);
assert.match(currentLimitHTML, /class="cta-red"[^>]*data-deal-action="accept"/);
assert.match(currentLimitHTML, /negotiation limit/i);
const currentLimitSenderHTML = deal.contractDetailHTML({ ...legacy, kind: 'loan', rulesVersion: 2, counterDepth: 2, lastProposerId: 'p1' });
assert.match(currentLimitSenderHTML, /data-deal-action="adjust"[^>]*disabled/);
assert.match(currentLimitSenderHTML, /class="cta-red"[^>]*data-deal-action="cancel"/);
for (const identity of ['outsider', null]) {
  state.players = identity ? [{ clientId: 'self', serverId: identity }] : [];
  for (const offer of [oldLoan, { ...legacy, kind: 'loan', rulesVersion: 2 }, legacy]) {
    const html = deal.contractDetailHTML(offer);
    assert.deepEqual(actionOrder(html), []);
    assert.match(html, /id="deal-detail-close"/);
  }
}
state.players = [{ clientId: 'self', serverId: 'p1' }];
state.settings.playerFinance = false;
const disabledFinanceHTML = deal.contractDetailHTML({ ...legacy, kind: 'loan', rulesVersion: 2 });
assert.match(disabledFinanceHTML, /Player Finance is off\. Decline or cancel this offer\./);
assert.deepEqual(actionOrder(disabledFinanceHTML), ['accept', 'negotiate', 'decline']);
assert.doesNotMatch(disabledFinanceHTML, /data-deal-action="back"/);
for (const action of ['accept', 'negotiate']) {
  assert.match(disabledFinanceHTML, new RegExp(`data-deal-action="${action}"[^>]*disabled[^>]*aria-describedby="deal-unavailable-reason"[^>]*title="Player Finance is off`));
}
assert.match(disabledFinanceHTML, /class="cta-red"[^>]*data-deal-action="decline"/);
const disabledSenderHTML = deal.contractDetailHTML({ ...legacy, kind: 'loan', rulesVersion: 2, lastProposerId: 'p1' });
assert.deepEqual(actionOrder(disabledSenderHTML), ['adjust', 'cancel']);
assert.match(disabledSenderHTML, /data-deal-action="adjust"[^>]*disabled/);
assert.match(disabledSenderHTML, /class="cta-red"[^>]*data-deal-action="cancel"/);
assert.doesNotMatch(disabledFinanceHTML, /ask the host to enable/i);
console.log('real item rows, lifecycle, eligibility, replay retry and unavailable offer checks passed');

const { renderLobbyRail } = await import('./clientLobbyUi.js');
const lobbyBody = { innerHTML: '', querySelectorAll: () => [] };
const startButton = { querySelector: () => ({ textContent: '' }) };
const rail = { classList: { toggle() {} } };
globalThis.document = { querySelector: selector => selector === '#lobby-settings-body' ? lobbyBody : selector === '#lobby-start-btn' ? startButton : rail };
state.phase = 'lobby';
state.players = [{ isHost: true }];
for (const rulesProfile of ['standard', 'advanced']) {
  state.settings.rulesProfile = rulesProfile;
  state.settings.itemRewards = true;
  renderLobbyRail();
  assert.match(lobbyBody.innerHTML, /data-setting="itemRewards"[^>]*aria-pressed="true"/);
  assert.match(lobbyBody.innerHTML, /item rewards on/);
}
const { renderRulesSurface } = await import('./clientSocialSurfaces.js');
const rulesRoot = { innerHTML: '', querySelectorAll: () => [] };
globalThis.document = { querySelector: () => rulesRoot };
state.rulesSection = 'wallet-items';
renderRulesSurface();
for (const term of ['PRISON KEY', 'PARLOR BOND', 'SILVER KEEPSAKE', 'SELL $25', 'SELL $400', 'SELL $600', 'two rounds', 'debt rescue', 'reconnects restore']) assert.ok(rulesRoot.innerHTML.includes(term), term);
state.rulesSection = 'rulesets-market';
renderRulesSurface();
assert.match(rulesRoot.innerHTML, /Both presets allow every optional economy system/);
assert.doesNotMatch(rulesRoot.innerHTML, /Advanced unlocks configurable optional economy systems/);
console.log('independent lobby item setting and complete item rules checks passed');
