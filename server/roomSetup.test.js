// Unit suite for roomSetup.js: every pure shape the room handlers now
// delegate to. Each assertion mirrors the exact behavior of the expression
// it replaced in server.js (check order, error strings, normalization
// limits, and viewer-scoped projection fields).
import assert from 'assert';
import {
  normalizeNickname,
  normalizeRoomCode,
  normalizeRoomName,
  normalizeVisibility,
  normalizeColor,
  normalizeAvatarGrid,
  normalizeChatText,
  buildRoomParticipant,
  buildCreateRoomRequest,
  validateCreateRoomRequest,
  validateJoinRoomRequest,
  toRoomCreationOptions,
  toJoinPlayerInfo,
  matchHistoryPrivacyError,
  summarizeMatchHistoryRecordForViewer,
  buildMatchRecordOptions
} from './roomSetup.js';

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

const HEX = '#A1B2C3';
const AVATAR_OK = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => HEX));

check('normalizeNickname trims, caps at 24, and rejects non-strings', () => {
  assert.strictEqual(normalizeNickname('  Space Name  '), 'Space Name');
  assert.strictEqual(normalizeNickname('x'.repeat(40)), 'x'.repeat(24));
  assert.strictEqual(normalizeNickname(42), '');
  assert.strictEqual(normalizeNickname(undefined), '');
});

check('normalizeRoomCode strips non-alphanumerics, uppercases, caps at 6', () => {
  assert.strictEqual(normalizeRoomCode('ab 12cd!'), 'AB12CD');
  assert.strictEqual(normalizeRoomCode('ABCDEFGH'), 'ABCDEF');
  assert.strictEqual(normalizeRoomCode(null), '');
});

check('normalizeRoomName falls back to AFTER HOURS and strips unsafe chars', () => {
  assert.strictEqual(normalizeRoomName(undefined), 'AFTER HOURS');
  assert.strictEqual(normalizeRoomName('   '), 'AFTER HOURS');
  assert.strictEqual(normalizeRoomName('Night Shift!!'), 'Night Shift');
  assert.strictEqual(normalizeRoomName('x'.repeat(30)), 'x'.repeat(24));
});

check('normalizeVisibility only ever returns private or public', () => {
  assert.strictEqual(normalizeVisibility('private'), 'private');
  assert.strictEqual(normalizeVisibility('garbage'), 'public');
  assert.strictEqual(normalizeVisibility(undefined), 'public');
});

check('normalizeColor accepts exactly six-digit hex', () => {
  assert.strictEqual(normalizeColor('#a1b2c3'), '#a1b2c3');
  assert.strictEqual(normalizeColor('#ABCDEF'), '#ABCDEF');
  assert.strictEqual(normalizeColor('blue'), '');
  assert.strictEqual(normalizeColor('#12345'), '');
});

check('normalizeAvatarGrid requires an 8x8 grid of hex cells', () => {
  assert.deepStrictEqual(normalizeAvatarGrid(AVATAR_OK), AVATAR_OK.map(row => row.map(c => c.toLowerCase())));
  assert.strictEqual(normalizeAvatarGrid(null), null);
  assert.strictEqual(normalizeAvatarGrid(AVATAR_OK.slice(0, 7)), null);
  assert.strictEqual(normalizeAvatarGrid(AVATAR_OK.map(row => row.slice(0, 7))), null);
  const withBadCell = AVATAR_OK.map((row, i) => i === 3 ? row.map((c, j) => j === 3 ? 'zzz' : c) : row);
  assert.strictEqual(withBadCell[3][3], 'zzz');
  assert.strictEqual(normalizeAvatarGrid(withBadCell)[3][3], null);
  const withNulls = AVATAR_OK.map((row, i) => i === 0 ? [null, '', ...row.slice(2)] : row);
  assert.deepStrictEqual(normalizeAvatarGrid(withNulls)[0].slice(0, 2), [null, null]);
});

check('normalizeChatText trims, caps at 250, rejects non-strings', () => {
  assert.strictEqual(normalizeChatText('  hello  '), 'hello');
  assert.strictEqual(normalizeChatText('y'.repeat(300)).length, 250);
  assert.strictEqual(normalizeChatText(7), '');
});

check('buildRoomParticipant prefers account identity over payload', () => {
  const account = { id: 'acct_1', displayName: ' Alice ', color: '#111111', avatarGrid: AVATAR_OK };
  const participant = buildRoomParticipant({ nickname: 'Payload', color: '#222222' }, account);
  assert.strictEqual(participant.nickname, 'Alice');
  assert.strictEqual(participant.color, '#111111');
  assert.strictEqual(participant.accountId, 'acct_1');
  const anon = buildRoomParticipant({ nickname: ' Payload Two ', color: 'nope' }, null);
  assert.strictEqual(anon.nickname, 'Payload Two');
  assert.strictEqual(anon.color, '');
  assert.strictEqual(anon.accountId, null);
  assert.strictEqual(anon.avatarGrid, null);
});

check('buildCreateRoomRequest pins visibility and only codes private rooms', () => {
  const request = buildCreateRoomRequest({ nickname: 'Host', visibility: 'private', roomCode: 'ab 12cd!' }, null);
  assert.strictEqual(request.visibility, 'private');
  assert.strictEqual(request.requestedRoomCode, 'AB12CD');
  assert.strictEqual(request.roomName, 'AFTER HOURS');
  const publicRequest = buildCreateRoomRequest({ nickname: 'Host', visibility: 'junk', roomCode: 'ZZZZZZ', roomName: 'Parlor' }, null);
  assert.strictEqual(publicRequest.requestedRoomCode, '');
  assert.strictEqual(publicRequest.roomName, 'Parlor');
});

check('validateCreateRoomRequest checks nickname first, then private code length', () => {
  assert.strictEqual(validateCreateRoomRequest({ nickname: '', visibility: 'private', requestedRoomCode: 'AB' }), 'Nickname is required.');
  assert.strictEqual(validateCreateRoomRequest({ nickname: 'Solo', visibility: 'private', requestedRoomCode: 'ABCDE' }), 'Private rooms need a unique 6-character invite code.');
  assert.strictEqual(validateCreateRoomRequest({ nickname: 'Solo', visibility: 'private', requestedRoomCode: 'ABCDEF' }), null);
  assert.strictEqual(validateCreateRoomRequest({ nickname: 'Solo', visibility: 'public', requestedRoomCode: '' }), null);
});

check('validateJoinRoomRequest checks room code first, then nickname', () => {
  assert.strictEqual(validateJoinRoomRequest({ roomCode: '', nickname: '' }), 'Room code is required.');
  assert.strictEqual(validateJoinRoomRequest({ roomCode: 'ABCDEF', nickname: '' }), 'Nickname is required.');
  assert.strictEqual(validateJoinRoomRequest({ roomCode: 'ABCDEF', nickname: 'Solo' }), null);
});

check('toRoomCreationOptions blanks empty colors and empty codes', () => {
  const options = toRoomCreationOptions({ nickname: 'H', color: '', avatarGrid: null, accountId: null, roomName: 'AFTER HOURS', visibility: 'public', requestedRoomCode: '' }, 'c1', 'sock1');
  assert.deepStrictEqual(options, { clientId: 'c1', socketId: 'sock1', nickname: 'H', color: undefined, avatarGrid: null, accountId: null, roomName: 'AFTER HOURS', visibility: 'public', roomCode: undefined });
  const privateOptions = toRoomCreationOptions({ nickname: 'H', color: HEX, avatarGrid: null, accountId: 'acct_1', roomName: 'X', visibility: 'private', requestedRoomCode: 'AB12CD' }, 'c1', 'sock1');
  assert.strictEqual(privateOptions.color, HEX);
  assert.strictEqual(privateOptions.roomCode, 'AB12CD');
});

check('toJoinPlayerInfo blanks empty colors', () => {
  const info = toJoinPlayerInfo({ nickname: 'G', color: '', avatarGrid: AVATAR_OK, accountId: 'acct_2' }, 'c9', 'sock9');
  assert.deepStrictEqual(info, { clientId: 'c9', socketId: 'sock9', nickname: 'G', color: undefined, avatarGrid: AVATAR_OK, accountId: 'acct_2' });
});

check('matchHistoryPrivacyError walks the original gate order', () => {
  const owner = { id: 'acct_a', privacy: { history: 'friends' } };
  const friend = { id: 'acct_b', privacy: { history: 'friends' } };
  assert.deepStrictEqual(matchHistoryPrivacyError(owner, owner, null), { canSeePrivateHistory: true, error: null });
  assert.deepStrictEqual(matchHistoryPrivacyError(friend, owner, { status: 'accepted' }), { canSeePrivateHistory: true, error: null });
  assert.deepStrictEqual(
    matchHistoryPrivacyError({ id: 'acct_c' }, owner, { status: 'requested' }),
    { canSeePrivateHistory: false, error: 'Match history is visible to the owner and accepted friends.' }
  );
  assert.deepStrictEqual(
    matchHistoryPrivacyError(undefined, { id: 'acct_d', privacy: { history: 'public' } }, null),
    { canSeePrivateHistory: false, error: null }
  );
  assert.deepStrictEqual(
    matchHistoryPrivacyError(friend, { id: 'acct_a', privacy: { history: 'private' } }, { status: 'accepted' }),
    { canSeePrivateHistory: true, error: 'This player keeps match history private.' }
  );
  const selfPrivate = matchHistoryPrivacyError({ id: 'acct_a', privacy: { history: 'private' } }, { id: 'acct_a', privacy: { history: 'private' } }, null);
  assert.strictEqual(selfPrivate.error, null);
});

check('summarizeMatchHistoryRecordForViewer projects the exact viewer fields', () => {
  const record = {
    matchId: 'm1',
    completedAt: '2026-01-01T00:00:00.000Z',
    roundCount: 9,
    roomVisibility: 'public',
    participants: [
      { displayNameAtMatch: 'Alice', finalPlacement: 1, propertyCount: 7, bankrupt: false, accountId: 'acct_a' },
      { displayNameAtMatch: 'Berta', finalPlacement: 2, propertyCount: 3, bankrupt: true, accountId: 'acct_b' },
      { displayNameAtMatch: 'Cara', finalPlacement: 3, propertyCount: 0, bankrupt: false, accountId: undefined }
    ],
    globalEvents: ['E1'],
    eventCombinations: ['C1'],
    tradesCompleted: 2,
    auctionsCompleted: 1,
    casino: [{ secret: true }]
  };
  const summary = summarizeMatchHistoryRecordForViewer(record, 'acct_b', 'acct_a');
  assert.strictEqual('casino' in summary, false);
  assert.deepStrictEqual(summary.participants.map(p => p.isViewedPlayer), [true, false, false]);
  assert.deepStrictEqual(summary.participants.map(p => p.sharedWithViewer), [true, true, true]);
  assert.strictEqual(summary.matchId, 'm1');
  assert.strictEqual(summary.tradesCompleted, 2);
  const noViewer = summarizeMatchHistoryRecordForViewer(record, undefined, 'acct_a');
  assert.deepStrictEqual(noViewer.participants.map(p => p.sharedWithViewer), [false, false, false]);
});

function fakeSettledRoom() {
  const players = [
    { accountId: 'acct_a', casinoLedger: [1, 2], casinoNet: '-5', marketPositions: { bonds: { quantity: '3', realizedPnl: 'bad' } } },
    { accountId: null }
  ];
  const game = {
    startedAt: 1000,
    roundNumber: 12,
    tradesCompleted: 4,
    auctionsCompleted: 2,
    players,
    globalEventHistory: [{ id: 'e1', title: 'Tide', comboId: 'c1' }, { id: 'e2', title: 'Heat' }],
    globalEvent: { id: 'e3', title: 'Bonus', comboId: 'c2' },
    playerContracts: [
      { id: 'pc1', kind: 'loan', fromPlayerId: 'p1', toPlayerId: 'p2', amount: 50, premiumRate: 0.2, equityShare: null, collateralTileIndex: 7, status: 'active' },
      { id: 'pc2', kind: 'equity', fromPlayerId: 'p9', toPlayerId: 'pX', amount: 10, premiumRate: null, equityShare: 0.1, collateralTileIndex: null, status: 'settled' }
    ],
    getPlayerById: id => (id === 'p1' ? { accountId: 'acct_a' } : id === 'p2' ? { accountId: null } : null)
  };
  return { roomCode: 'R1', visibility: 'private', game };
}

check('buildMatchRecordOptions matches the emitRoomState settlement shape', () => {
  const options = buildMatchRecordOptions(fakeSettledRoom());
  assert.match(options.gameId, /^match_R1_1000$/);
  assert.strictEqual(typeof options.durationSeconds, 'number');
  assert.strictEqual(options.roundCount, 12);
  assert.strictEqual(options.roomVisibility, 'private');
  assert.deepStrictEqual(options.globalEvents, ['Tide', 'Heat', 'Bonus']);
  assert.deepStrictEqual(options.eventCombinations, ['c1', 'c2']);
  assert.strictEqual(options.tradesCompleted, 4);
  assert.strictEqual(options.auctionsCompleted, 2);
  assert.deepStrictEqual(options.casino, [
    { accountId: 'acct_a', bets: 2, net: -5 },
    { accountId: null, bets: 0, net: 0 }
  ]);
  assert.deepStrictEqual(options.market[0], { accountId: 'acct_a', positions: { bonds: { quantity: 3, realizedPnl: 0 } } });
  assert.strictEqual(options.playerContracts.length, 2);
  assert.deepStrictEqual(options.playerContracts[0], {
    id: 'pc1', kind: 'loan', fromPlayerId: 'p1', toPlayerId: 'p2',
    fromAccountId: 'acct_a', toAccountId: null, amount: 50, premiumRate: 0.2,
    equityShare: null, collateralTileIndex: 7, status: 'active'
  });
  assert.strictEqual(options.playerContracts[1].collateralTileIndex, null);
});

check('buildMatchRecordOptions defaults a never-started room and caps event lists', () => {
  const room = fakeSettledRoom();
  room.game.startedAt = null;
  room.game.tradesCompleted = undefined;
  room.game.auctionsCompleted = undefined;
  room.game.globalEventHistory = Array.from({ length: 25 }, (_, i) => ({ id: `h${i}`, title: `H${i}`, comboId: `k${i}` }));
  room.game.globalEvent = { id: 'h0', title: 'Dup', comboId: 'k0' };
  const options = buildMatchRecordOptions(room);
  assert.match(options.gameId, /^match_R1_\d+$/);
  assert.strictEqual(options.durationSeconds, 0);
  assert.strictEqual(options.tradesCompleted, 0);
  assert.strictEqual(options.auctionsCompleted, 0);
  assert.strictEqual(options.globalEvents.length, 20);
  assert.strictEqual(options.eventCombinations.length, 10);
});

check('buildMatchRecordOptions appends a live event missing from history only', () => {
  const room = fakeSettledRoom();
  room.game.globalEvent = { id: 'e1', title: 'Tide', comboId: 'c1' };
  const options = buildMatchRecordOptions(room);
  assert.deepStrictEqual(options.globalEvents, ['Tide', 'Heat']);
  assert.deepStrictEqual(options.eventCombinations, ['c1']);
});

console.log(`\n${passed} roomSetup checks passed`);
