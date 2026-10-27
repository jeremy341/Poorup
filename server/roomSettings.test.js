import test from 'node:test';
import assert from 'node:assert/strict';
import { DEFAULT_ROOM_SETTINGS, ROOM_SETTING_NORMALIZERS, SETTING_REJECTED } from './roomSettings.js';
import { GameState, RoomManager } from './gameLogic.js';
import { KNOWN_OVERRIDE_KEYS, HISTORICAL_OVERRIDE_KEYS, resolveRuleset } from './rulesetRegistry.js';
import { buildCreateRoomRequest, toRoomCreationOptions } from './roomSetup.js';
import { buildBotStrategicContext } from './botStrategicContext.js';

test('new room settings and snapshots omit per-turn timers', () => {
  assert.equal('turnTimer' in DEFAULT_ROOM_SETTINGS, false);
  const room = new RoomManager().createRoom({ socketId: 'settings-host', clientId: 'settings-client', nickname: 'Host' });
  assert.equal('turnTimer' in room.settings, false);
  assert.equal(room.setRoomSetting('turnTimer', 90).rejected, true);
  assert.equal('turnTimer' in room.getRoomSummary().settings, false);
  assert.equal('turnDeadline' in room.game.getGameSummary(), false);
});

test('bot behavior is configured by brain and difficulty; legacy personality is ignored', () => {
  assert.equal('botPersonality' in DEFAULT_ROOM_SETTINGS, false);
  const room = new RoomManager().createRoom({
    socketId: 'bot-settings-host',
    clientId: 'bot-settings-client',
    nickname: 'Host',
  });
  assert.equal('botPersonality' in room.settings, false);
  assert.equal(room.setRoomSetting('botPersonality', 'builder').rejected, true);
  assert.equal('botPersonality' in room.getRoomSummary().settings, false);
  room.setRoomSetting('bots', 1);
  room.setRoomSetting('botBrain', 'no-ai');
  room.setRoomSetting('botDifficulty', 'expert');
  assert.equal(room.startGame().success, true);
  const bot = room.game.players.find(player => player.isBot);
  assert.equal('personality' in bot, false);
  assert.equal(room.settings.botBrain, 'no-ai');
  assert.equal(room.settings.botDifficulty, 'expert');
});

test('historical ruleset timer metadata remains readable without enabling a live setting', () => {
  assert.equal(KNOWN_OVERRIDE_KEYS.has('turnTimer'), false);
  assert.equal(HISTORICAL_OVERRIDE_KEYS.has('turnTimer'), true);
  const historical = resolveRuleset({
    rulesetPreset: 'custom',
    rulesetBase: 'classic',
    rulesetOverrides: [{ key: 'turnTimer', value: 120 }],
    settings: {},
  });
  assert.equal(historical.effectiveSettings.turnTimer, 120);
  assert.deepEqual(historical.rulesetOverrides, [{ key: 'turnTimer', value: 120 }]);
});

test('new room creation ignores preset and arbitrary override inputs', () => {
  const request = buildCreateRoomRequest({
    nickname: 'Host',
    visibility: 'public',
    rulesetPreset: 'after-hours',
    rulesetBase: 'after-hours',
    rulesetOverrides: [{ key: 'turnTimer', value: 120 }],
    boardVariant: 'metro-52',
  });
  assert.equal('rulesetPreset' in request, false);
  assert.equal('rulesetBase' in request, false);
  assert.equal('rulesetOverrides' in request, false);
  assert.equal(request.boardVariant, 'metro-52');
  const options = toRoomCreationOptions(request, 'client', 'socket');
  assert.equal('rulesetOverrides' in options, false);
});

test('startingCash refuses null, blank and non-numeric input instead of storing zero (E1-02)', () => {
  const normalize = ROOM_SETTING_NORMALIZERS.startingCash;
  for (const value of [null, '', '   ', true, [], {}, 'abc', Number.NaN, Infinity]) {
    assert.equal(normalize(value), SETTING_REJECTED, `startingCash ${String(value)} must be refused`);
  }
  assert.equal(normalize(0), 0, 'an explicit zero is still a legal starting cash');
  assert.equal(normalize('2500'), 2500);
  assert.equal(normalize(1.5), 1);
});

test('rulesetRevision accepts only positive whole numbers (E19-12)', () => {
  const normalize = ROOM_SETTING_NORMALIZERS.rulesetRevision;
  for (const value of [0, -1, 1.5, Number.NaN, null, '', 'abc', true, { revision: 2 }, ['2'], 'x'.repeat(100_000)]) {
    assert.equal(normalize(value), SETTING_REJECTED, `rulesetRevision ${String(value).slice(0, 20)} must be refused`);
  }
  assert.equal(normalize(1), 1);
  assert.equal(normalize('7'), 7);
});

test('rulesetOverrides keeps only room-allowed keys with primitive values (E6-08)', () => {
  const normalize = ROOM_SETTING_NORMALIZERS.rulesetOverrides;
  assert.deepEqual(normalize([
    { key: 'casino', value: true },
    { key: 'botPersonality', value: 'chaos' },
    { key: ' mortgage ', value: false },
    { key: 'startingCash', value: { nested: true } },
    { key: 'market', value: ['x'] },
    { key: 'houseLimit', value: null },
    { key: 'marketComplexity', value: `  ${'m'.repeat(120)}  ` }
  ]), [
    { key: 'casino', value: true },
    { key: 'mortgage', value: false },
    { key: 'marketComplexity', value: 'm'.repeat(80) }
  ]);
  assert.deepEqual(normalize('casino'), []);
});

test('the room override allow-list mirrors the ruleset registry', () => {
  const stored = ROOM_SETTING_NORMALIZERS.rulesetOverrides([...HISTORICAL_OVERRIDE_KEYS].map(key => ({ key, value: true })));
  assert.deepEqual(stored.map(entry => entry.key).sort(), [...HISTORICAL_OVERRIDE_KEYS].sort());
});

test('house and hotel supply settings are removed from defaults, overrides, setters, and projections', () => {
  const room = new RoomManager().createRoom({ socketId: 'limits-host', clientId: 'limits-client', nickname: 'Host' });
  for (const key of ['houseLimit', 'hotelLimit']) {
    assert.equal(Object.hasOwn(DEFAULT_ROOM_SETTINGS, key), false);
    assert.equal(Object.hasOwn(room.settings, key), false);
    assert.equal(room.setRoomSetting(key, 'unlimited').rejected, true);
    assert.equal(Object.hasOwn(room.settings, key), false);
  }
  const summary = room.getRoomSummary();
  assert.equal(Object.hasOwn(summary.settings, 'houseLimit'), false);
  assert.equal(Object.hasOwn(summary.settings, 'hotelLimit'), false);
  assert.equal(Object.hasOwn(summary.ruleset.effectiveSettings, 'houseLimit'), false);
  assert.equal(Object.hasOwn(summary.ruleset.effectiveSettings, 'hotelLimit'), false);
});

test('trusted legacy settings drop only retired building limits before restore and room projection', () => {
  const restoredGame = new GameState({ houseLimit: 64, hotelLimit: 'unlimited', startingCash: 2800, rulesProfile: 'advanced', rulesetOverrides: [{ key: 'casino', value: true }] });
  assert.equal(Object.hasOwn(restoredGame.settings, 'houseLimit'), false);
  assert.equal(Object.hasOwn(restoredGame.settings, 'hotelLimit'), false);
  assert.equal(restoredGame.settings.startingCash, 2800);
  assert.equal(restoredGame.settings.casino, true);
  const room = new RoomManager().createRoom({
    socketId: 'legacy-host',
    clientId: 'legacy-client',
    nickname: 'Legacy',
    rulesProfile: 'advanced',
    rulesetOverrides: [{ key: 'casino', value: true }]
  });
  room.settings.houseLimit = 64;
  room.settings.hotelLimit = 'unlimited';
  room.game.settings.houseLimit = 64;
  room.game.settings.hotelLimit = 'unlimited';
  room.settings.rulesetOverrides.push(
    { key: 'houseLimit', value: 64 },
    { key: 'hotelLimit', value: 'unlimited' },
    { key: 'casino', value: true }
  );
  room.refreshRuleset();
  assert.equal(Object.hasOwn(room.settings, 'houseLimit'), false);
  assert.equal(Object.hasOwn(room.settings, 'hotelLimit'), false);
  assert.equal(Object.hasOwn(room.game.settings, 'houseLimit'), false);
  assert.equal(Object.hasOwn(room.game.settings, 'hotelLimit'), false);
  const botRules = buildBotStrategicContext(room.game, room.game.players[0]).rulesDigest;
  assert.equal(Object.hasOwn(botRules, 'houseLimit'), false);
  assert.equal(Object.hasOwn(botRules, 'hotelLimit'), false);
  assert.equal(room.ruleset.effectiveSettings.casino, true);
  assert.equal(room.getRoomSummary().ruleset.effectiveSettings.casino, true);
  assert.equal(Object.hasOwn(room.getRoomSummary().settings, 'houseLimit'), false);
  assert.equal(Object.hasOwn(room.getRoomSummary().settings, 'hotelLimit'), false);
});

test('raw legacy keys cannot be set or exposed before refresh and unrelated settings survive', () => {
  const room = new RoomManager().createRoom({
    socketId: 'raw-legacy-host',
    clientId: 'raw-legacy-client',
    nickname: 'Raw legacy',
    rulesetOverrides: [{ key: 'casino', value: true }]
  });
  room.settings.houseLimit = 1;
  room.settings.hotelLimit = 2;
  room.settings.startingCash = 2800;
  room.game.settings.startingCash = 2800;
  room.settings.rulesetOverrides = [
    ...room.settings.rulesetOverrides,
    { key: 'houseLimit', value: 1 },
    { key: 'hotelLimit', value: 2 },
    { key: 'evenBuild', value: false }
  ];
  room.game.settings.houseLimit = 1;
  room.game.settings.hotelLimit = 2;
  room.ruleset = {
    ...room.ruleset,
    rulesetOverrides: [...room.ruleset.rulesetOverrides, { key: 'houseLimit', value: 1 }],
    effectiveSettings: {
      ...room.ruleset.effectiveSettings,
      houseLimit: 1,
      hotelLimit: 2,
      startingCash: 2800,
      evenBuild: false
    }
  };

  const result = room.setRoomSetting('houseLimit', 64);
  assert.equal(result.rejected, true);
  assert.equal(result.changed, false);
  assert.equal(result.value, undefined);
  assert.equal(Object.hasOwn(result.effectiveSettings, 'houseLimit'), false);
  assert.equal(Object.hasOwn(result.effectiveSettings, 'hotelLimit'), false);
  assert.equal(result.effectiveSettings.startingCash, room.settings.startingCash);
  assert.equal(result.effectiveSettings.evenBuild, false);

  room.settings.rulesetOverrides = { houseLimit: 1, hotelLimit: 2, bankLoans: true };
  const summary = room.getRoomSummary();
  assert.equal(Object.hasOwn(summary.settings, 'houseLimit'), false);
  assert.equal(Object.hasOwn(summary.settings, 'hotelLimit'), false);
  assert.equal(Object.hasOwn(summary.ruleset.effectiveSettings, 'houseLimit'), false);
  assert.equal(Object.hasOwn(summary.ruleset.effectiveSettings, 'hotelLimit'), false);
  assert.equal(summary.ruleset.overrides.some(entry => ['houseLimit', 'hotelLimit'].includes(entry.key)), false);
  assert.equal(summary.settings.startingCash, room.settings.startingCash);
  assert.equal(summary.settings.evenBuild, true);
  assert.equal(summary.ruleset.effectiveSettings.evenBuild, false);
  assert.deepEqual(summary.settings.rulesetOverrides, { bankLoans: true });
});

test('game summary strips raw legacy caps in both ruleset modes and preserves other values', () => {
  const room = new RoomManager().createRoom({
    socketId: 'game-summary-legacy-host',
    clientId: 'game-summary-legacy-client',
    nickname: 'Game summary legacy',
    rulesetOverrides: [{ key: 'casino', value: true }]
  });
  const game = room.game;
  game.settings.houseLimit = 0;
  game.settings.hotelLimit = 0;
  game.settings.startingCash = 2800;
  game.settings.evenBuild = false;

  for (const legacyRuleset of [true, false]) {
    game.legacyRuleset = legacyRuleset;
    game.ruleset = {
      ...room.ruleset,
      rulesetOverrides: [
        { key: 'houseLimit', value: 0 },
        { key: 'hotelLimit', value: 0 },
        { key: 'casino', value: true }
      ],
      effectiveSettings: {
        ...room.ruleset.effectiveSettings,
        houseLimit: 0,
        hotelLimit: 0,
        startingCash: 2800,
        evenBuild: false
      }
    };
    const projected = game.getGameSummary().ruleset;
    assert.equal(Object.hasOwn(projected.effectiveSettings, 'houseLimit'), false);
    assert.equal(Object.hasOwn(projected.effectiveSettings, 'hotelLimit'), false);
    assert.equal(projected.overrides.some(entry => ['houseLimit', 'hotelLimit'].includes(entry.key)), false);
    assert.equal(projected.overrides.some(entry => entry.key === 'casino'), true);
    assert.equal(projected.effectiveSettings.startingCash, 2800);
    assert.equal(projected.effectiveSettings.evenBuild, false);
  }
});
