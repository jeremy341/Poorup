import assert from 'node:assert/strict';
import { buildAccountExport } from './accountExport.js';

const document = buildAccountExport({
  account: {
    id: 'acct-secret', username: 'owner', displayName: 'Owner', color: '#123456',
    passwordHash: 'hash', passwordSalt: 'salt', sessionTokenHash: 'session-hash',
    recoveryEmail: 'owner@example.test', recoveryEmailToken: 'token',
    stats: { wins: 2 }, history: [{ matchId: 'm1' }], matchHistory: [{ matchId: 'm1', participants: [{ accountId: 'acct-secret' }] }],
    achievements: [{ id: 'first-deed' }], designs: [{ id: 'pf_1', designName: 'ONE' }]
  },
  social: { friends: ['acct-other'], requests: [{ accountId: 'acct-other' }], notifications: [{ body: 'hello' }] },
  retiredData: { cosmetics: { tokens: 75, owned: ['frame-copper'], equipped: {} } },
  matches: [{ matchId: 'm2', privateLoanTerms: 'secret', chat: 'raw chat' }],
  now: () => Date.parse('2026-09-17T12:00:00.000Z')
});
const serialized = JSON.stringify(document);
assert.equal(document.schemaVersion, 1);
assert.equal(document.profile.username, 'owner');
assert.equal(document.recoveryEmail.address, 'owner@example.test');
assert.equal(serialized.includes('passwordHash'), false);
assert.equal(serialized.includes('passwordSalt'), false);
assert.equal(serialized.includes('sessionToken'), false);
assert.equal(serialized.includes('acct-secret'), false);
assert.equal(serialized.includes('privateLoanTerms'), false);
assert.equal(serialized.includes('raw chat'), false);
assert.deepEqual(document.retiredData, { cosmetics: { tokens: 75, owned: ['frame-copper'], equipped: {} } });
assert.ok(document.statistics);

// Placement and property count live on the account's participant entry.
const exported = buildAccountExport({
  account: {
    id: 'acct-p', username: 'placer',
    matchHistory: [{ matchId: 'g1', participants: [{ accountId: 'acct-x', finalPlacement: 3, propertyCount: 9 }, { accountId: 'acct-p', finalPlacement: 1, propertyCount: 2 }] }]
  },
  now: () => Date.parse('2026-09-17T12:00:00.000Z')
});
assert.equal(exported.matchHistory[0].finalPlacement, 1, 'the export carries the exporter\'s own placement');
assert.equal(exported.matchHistory[0].propertyCount, 2, 'the export carries the exporter\'s own property count');
assert.equal(JSON.stringify(exported).includes('acct-x'), false, 'other participants are not exported');
console.log('account export: 8 passed, 0 failed');
