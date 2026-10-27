import test from 'node:test';
import assert from 'node:assert/strict';
import { GameState, RoomManager } from './gameLogic.js';
import { createRulesetDigest, normalizeOverrides, resolveRuleset } from './rulesetRegistry.js';
import { playerFinanceEnabled } from './financeRules.js';

test('Standard starts optional systems off and honors independent explicit overrides', () => {
  const room = new RoomManager().createRoom({ socketId: 'p', clientId: 'p', nickname: 'Host' });
  for (const settings of [room.settings, room.game.settings, room.ruleset.effectiveSettings, room.getRoomSummary().settings]) {
    assert.equal(settings.rulesProfile, 'standard');
    for (const key of ['playerFinance', 'bankLoans', 'casino', 'market', 'globalEvents', 'flights', 'bankAccountUpgrades']) assert.equal(settings[key], false);
  }
  const game = new GameState({ rulesProfile: 'standard', playerFinance: true, bankLoans: true, casino: true, rulesetOverrides: [{ key: 'bankLoans', value: true }] });
  assert.equal(game.settings.bankLoans, true);
  assert.equal(game.settings.casino, false);
  assert.equal(playerFinanceEnabled(game), true);
});

test('Standard mixed choices survive profile changes, reconnect, summaries and game start', () => {
  const selected = { playerFinance: true, bankLoans: true, casino: false, market: true, globalEvents: false, flights: true, bankAccountUpgrades: false, marketComplexity: 'shorting' };
  const room = new RoomManager().createRoom({ socketId: 'custom-host', clientId: 'custom-host', nickname: 'Host', rulesProfile: 'standard', rulesetOverrides: selected });
  room.addOrReconnectPlayer({ socketId: 'custom-guest', clientId: 'custom-guest', nickname: 'Guest' });
  const assertChoices = expected => {
    for (const settings of [room.settings, room.game.settings, room.ruleset.effectiveSettings, room.getRoomSummary().settings, room.game.getGameSummary().ruleset.effectiveSettings]) {
      for (const [key, value] of Object.entries(expected)) assert.equal(settings[key], value, `${key} retains its own choice`);
    }
  };
  assertChoices(selected);
  for (const profile of ['advanced', 'standard']) {
    assert.equal(room.setRoomSetting('rulesProfile', profile).rejected, false);
    assertChoices(selected);
  }
  // Exercise every module through the setter as well as the creation map.
  for (const key of Object.keys(selected).filter(key => key !== 'marketComplexity')) {
    assert.equal(room.setRoomSetting(key, !selected[key]).rejected, false);
    selected[key] = !selected[key];
    assertChoices(selected);
  }
  assert.equal(room.setRoomSetting('playerFinance', true).rejected, false);
  selected.playerFinance = true;
  assert.equal(room.reconnectPlayer(room.game.players[0], { socketId: 'custom-reconnected', clientId: 'custom-host', nickname: 'Host' }).success, true);
  assertChoices(selected);
  assert.equal(room.startGame().success, true);
  assertChoices(selected);
  const digest = room.rulesetDigest;
  for (const [key, value] of [['rulesProfile', 'advanced'], ['playerFinance', false], ['market', true]]) assert.equal(room.setRoomSetting(key, value).rejected, true);
  assert.equal(room.rulesetDigest, digest);
  assertChoices(selected);
});

test('Advanced defaults player finance on while other addons require explicit opt in', () => {
  const rules = resolveRuleset({ settings: { rulesProfile: 'advanced', market: true } });
  assert.equal(rules.effectiveSettings.playerFinance, true);
  assert.equal(rules.effectiveSettings.market, false);
  assert.equal(resolveRuleset({ settings: { rulesProfile: 'advanced', playerFinance: false } }).effectiveSettings.playerFinance, false);
  const room = new RoomManager().createRoom({ socketId: 'a', clientId: 'a', nickname: 'Host' });
  assert.equal(room.setRoomSetting('rulesProfile', 'invalid').rejected, true);
  assert.equal(room.setRoomSetting('rulesProfile', 'advanced').rejected, false);
  assert.equal(room.game.settings.playerFinance, true);
  room.setRoomSetting('market', true);
  assert.equal(room.settings.market, true);
  room.setRoomSetting('playerFinance', false);
  assert.equal(playerFinanceEnabled(room.game), false);
  room.setRoomSetting('rulesProfile', 'standard');
  assert.equal(room.settings.market, true);
  assert.equal(room.settings.playerFinance, false);
  room.setRoomSetting('rulesProfile', 'advanced');
  assert.equal(room.settings.playerFinance, false, 'a profile switch preserves explicit finance-off');
  room.setRoomSetting('rulesProfile', 'standard');
  assert.deepEqual(room.settings, room.game.settings);
  assert.deepEqual(room.getRoomSummary().ruleset.effectiveSettings, room.game.getGameSummary().ruleset.effectiveSettings);
  room.game.started = true;
  assert.equal(room.setRoomSetting('rulesProfile', 'advanced').rejected, true);
});

test('profile switches preserve finance explicitly supplied at room creation', () => {
  for (const playerFinance of [false, true]) {
    const room = new RoomManager().createRoom({ socketId: 'explicit-host', clientId: 'explicit-host', nickname: 'Host', rulesProfile: 'standard', playerFinance });
    for (const profile of ['advanced', 'standard']) {
      assert.equal(room.setRoomSetting('rulesProfile', profile).rejected, false);
      assert.equal(room.settings.playerFinance, playerFinance);
    }
  }
});

test('trusted restored rooms retain optional intent without changing new-room defaults', () => {
  const room = new RoomManager().createRoom({ socketId: 'r', clientId: 'r', nickname: 'Host' });
  delete room.settings.rulesProfile;
  delete room.settings.playerFinance;
  room.settings.rulesetOverrides = [{ key: 'market', value: true }];
  room.refreshRuleset();
  assert.equal(room.settings.rulesProfile, 'advanced');
  assert.equal(room.settings.market, true);
  assert.equal(room.game.settings.market, true);
  assert.equal(playerFinanceEnabled(room.game), true);
});


test('profile cannot be forged through unknown overrides and finance values normalize safely', () => {
  const standard = resolveRuleset({ rulesetOverrides: [{ key: 'rulesProfile', value: 'advanced' }, { key: 'playerFinance', value: true }, { key: 'unknown', value: true }] });
  assert.equal(standard.effectiveSettings.rulesProfile, 'standard');
  assert.equal(createRulesetDigest({ effectiveSettings: { rulesProfile: 'standard', bankLoans: true } }),
    createRulesetDigest({ settings: { rulesProfile: 'standard', bankLoans: false } }));
  assert.equal(standard.effectiveSettings.playerFinance, true);
  assert.deepEqual(standard.rulesetOverrides, [{ key: 'playerFinance', value: true }]);
  assert.equal(new GameState({ rulesProfile: 'advanced', playerFinance: 'false' }).settings.playerFinance, false);
  assert.equal(new GameState({ rulesProfile: 'advanced', playerFinance: 'true' }).settings.playerFinance, true);
  assert.equal(new GameState({ rulesProfile: 'standard', playerFinance: 'false' }).settings.playerFinance, false);
  assert.equal(new GameState({ rulesProfile: 'standard', playerFinance: 'true' }).settings.playerFinance, true);
  assert.equal(resolveRuleset({ settings: { rulesProfile: 'standard', playerFinance: false }, rulesetOverrides: { playerFinance: true } }).effectiveSettings.playerFinance, true);
  assert.equal(resolveRuleset({ settings: { rulesProfile: 'advanced', playerFinance: true }, rulesetOverrides: { playerFinance: false } }).effectiveSettings.playerFinance, false);
  const advanced = new GameState({ rulesProfile: 'advanced' });
  assert.equal(advanced.getGameSummary().ruleset.effectiveSettings.playerFinance, true);
  assert.notEqual(advanced.rulesetDigest, new GameState({ rulesProfile: 'standard' }).rulesetDigest);
});


test('opaque and omitted override values are rejected consistently at creation and the setter', () => {
  const room = new RoomManager().createRoom({ socketId: 'opaque-host', clientId: 'opaque-host', nickname: 'Host', rulesProfile: 'advanced' });
  for (const key of ['globalEvents', 'playerFinance', 'casino', 'botBrain', 'bankLoanSeverity', 'startingCash', 'bots']) {
    for (const value of [undefined, null, [], {}, Number.NaN, Number.POSITIVE_INFINITY]) {
      const before = room.settings[key];
      assert.equal(Object.hasOwn(normalizeOverrides([{ key, value }]), key), false);
      assert.equal(room.setRoomSetting(key, value).rejected, true, `${key} rejects opaque values`);
      assert.equal(room.settings[key], before);
    }
  }
});
