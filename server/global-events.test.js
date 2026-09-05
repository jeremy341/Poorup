// Characterization suite for the global-event lifecycle in gameLogic.js.
// Pinned BEFORE refactoring activateGlobalEvent / maybeTriggerGlobalEvent /
// resolveGlobalEventVote / applyGlobalEventActivationSettlements: every
// observable (event ids, phases, effect snapshots, feed messages, vote
// tallies, settlement cash deltas, RNG consumption) must survive verbatim.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';

function makeEventRoom({ globalEvents = true, players = 2 } = {}) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A' });
  if (players >= 2) room.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B' });
  if (players >= 3) room.addOrReconnectPlayer({ socketId: 'socket-c', clientId: 'client-c', nickname: 'C' });
  if (globalEvents) room.setRoomSetting('globalEvents', true);
  assert.equal(room.startGame().success, true);
  return room;
}

function feedTexts(game) {
  return game.feed.map(entry => entry.text);
}

function ownsTile(game, player, index) {
  const tile = game.getTile(index);
  tile.ownerId = player.id;
  player.properties.push(index);
}

function ownsFullBrownGroup(game, player) {
  ownsTile(game, player, 1);
  ownsTile(game, player, 3);
}

// RNG control. randomFloat() is crypto.randomInt(0, 1_000_000) / 1e6 and
// randomInt(a, b) is crypto.randomInt(a, b + 1). Queued probabilities fire
// in call order per (min, max) signature; everything else stays real.
async function stubRng({ floats = [], ints = {} } = {}) {
  const nodeCrypto = (await import('crypto')).default;
  const original = nodeCrypto.randomInt;
  const floatQueue = floats.map(probability => Math.round(probability * 1_000_000));
  const intQueues = Object.fromEntries(Object.entries(ints).map(([key, values]) => [key, [...values]]));
  nodeCrypto.randomInt = (min, max) => {
    if (min === 0 && max === 1_000_000 && floatQueue.length) return floatQueue.shift();
    const queue = intQueues[`${min},${max}`];
    if (queue && queue.length) return queue.shift();
    return original(min, max);
  };
  return () => { nodeCrypto.randomInt = original; };
}

async function testActivateWarningSnapshot() {
  const room = makeEventRoom();
  const game = room.game;
  const definition = game.globalEventDefinition('tourism-boom');
  game.roundNumber = 1;
  game.activateGlobalEvent(definition);
  const event = game.globalEvent;
  assert.equal(event.id, 'tourism-boom');
  assert.equal(event.title, 'TOURISM BOOM');
  assert.equal(event.category, 'INFRASTRUCTURE');
  assert.equal(event.phase, 'warning');
  assert.equal(event.startedRound, 1);
  assert.equal(event.voteRound, null);
  assert.equal(event.durationRounds, 6);
  assert.equal(event.roundsRemaining, 1);
  assert.equal(event.choices, null);
  assert.deepEqual(event.votes, {});
  assert.equal(event.resolvedChoice, null);
  assert.equal(event.targetPlayerId, null);
  assert.equal(event.comboId, null);
  assert.deepEqual(event.effects, { airportRentMultiplier: 1.75, premiumRentMultiplier: 1.3, marketPriceMultiplier: 1.15 });
  assert.notEqual(event.effects, definition.effects);
  assert.equal(game.globalEventsTriggered, 1);
  game.players.forEach(player => assert.equal(player.globalEventsExperienced, 1));
  assert.equal(game.feed[0].text, 'TOURISM BOOM is building. The table has one round to prepare.');
  assert.equal(typeof game.feed[0].timestamp, 'number');
  // warning -> active -> recovery -> off phase ladder via advanceRound
  game.advanceRound();
  assert.equal(game.globalEvent.phase, 'active');
  assert.equal(game.globalEvent.startedRound, 2);
  assert.equal(game.globalEvent.roundsRemaining, 6);
  assert.equal(game.feed[0].text, 'TOURISM BOOM is now active for 6 rounds.');
  for (let i = 0; i < 6; i += 1) game.advanceRound();
  assert.equal(game.globalEvent.phase, 'recovery');
  assert.equal(game.feed[0].text, 'TOURISM BOOM has ended. The table enters recovery.');
  game.advanceRound();
  assert.equal(game.globalEvent, null);
  assert.equal(game.globalEventCooldown, 3);
  assert.deepEqual(game.globalEventHistory, [{
    id: 'tourism-boom', title: 'TOURISM BOOM', comboId: null, startedRound: 2, endedRound: 9
  }]);
  game.players.forEach(player => assert.equal(player.globalEventsSurvived, 1));
}

function testActivateDurationScaling() {
  const room = makeEventRoom();
  const game = room.game;
  // 2 active players -> expectedRounds = max(12, 16) = 16.
  game.roundNumber = 1; // progress 0 -> <= 0.6
  game.activateGlobalEvent(game.globalEventDefinition('housing-bubble'));
  assert.equal(game.globalEvent.durationRounds, 7);
  game.globalEvent = null;
  game.roundNumber = 11; // progress 10/16 > 0.6
  game.activateGlobalEvent(game.globalEventDefinition('housing-bubble'));
  assert.equal(game.globalEvent.durationRounds, 8);
  game.globalEvent = null;
  game.activateGlobalEvent(game.globalEventDefinition('city-election'));
  assert.equal(game.globalEvent.durationRounds, 7);
  game.globalEvent = null;
  game.roundNumber = 1;
  game.activateGlobalEvent(game.globalEventDefinition('tax-audit'));
  assert.equal(game.globalEvent.durationRounds, 6);
}

function testActivateVotingChoices() {
  const room = makeEventRoom();
  const game = room.game;
  const definition = game.globalEventDefinition('city-election');
  game.roundNumber = 4;
  game.activateGlobalEvent(definition);
  const event = game.globalEvent;
  assert.equal(event.phase, 'voting');
  assert.equal(event.voteRound, 4);
  assert.equal(event.roundsRemaining, 1);
  assert.deepEqual(event.choices.map(choice => choice.id), ['low-tax', 'public-works', 'bank-first']);
  assert.notEqual(event.choices[0], definition.choices[0]);
  assert.deepEqual(event.choices[0], { id: 'low-tax', label: 'LOW TAX PLATFORM', description: 'Taxes fall, but card rewards are reduced.' });
  assert.equal(event.targetPlayerId, null);
  assert.equal(game.feed[0].text, 'CITY ELECTION is live. The table votes before the next round.');
}

function testActivateTargetSelection() {
  const room = makeEventRoom();
  const game = room.game;
  const [a, b] = game.players;
  ownsFullBrownGroup(game, a);
  ownsTile(game, b, 11); // Pink
  ownsTile(game, b, 16); // Orange
  game.roundNumber = 5;
  game.activateGlobalEvent(game.globalEventDefinition('anti-monopoly'));
  assert.equal(game.globalEvent.id, 'anti-monopoly');
  assert.equal(game.globalEvent.targetPlayerId, b.id); // two groups beats one
  assert.deepEqual(game.globalEvent.effects, { leaderRentMultiplier: 0.6, marketPriceMultiplier: 0.9 });
  game.globalEvent = null;
  a.cash = 2500;
  b.cash = 1200;
  game.activateGlobalEvent(game.globalEventDefinition('tax-audit'));
  assert.equal(game.globalEvent.targetPlayerId, a.id); // richest active player
  assert.equal(game.globalEvent.phase, 'warning');
}

function testActivateAirportStrikeFlags() {
  const room = makeEventRoom();
  const game = room.game;
  const [a, b] = game.players;
  ownsTile(game, a, 5); // ACC Airport
  game.activateGlobalEvent(game.globalEventDefinition('airport-strike'));
  assert.equal(a.airportOwnedDuringStrike, true);
  assert.equal(b.airportOwnedDuringStrike, false);
  assert.equal(game.globalEvent.phase, 'warning');
}

function testActivateCombo() {
  const room = makeEventRoom();
  const game = room.game;
  game.roundNumber = 8;
  game.globalEventsTriggered = 1;
  game.activateGlobalEvent(game.globalEventDefinition('credit-freeze'), {
    id: 'foreclosure-spiral',
    title: 'FORECLOSURE SPIRAL',
    summary: 'The property crash meets a locked credit market.',
    effects: { constructionBlocked: true, bankLoansBlocked: true, mortgagesBlocked: true, rentMultiplier: 0.55 },
    duration: 8
  });
  const event = game.globalEvent;
  assert.equal(event.id, 'foreclosure-spiral');
  assert.equal(event.comboId, 'foreclosure-spiral');
  assert.equal(event.title, 'FORECLOSURE SPIRAL');
  assert.equal(event.category, 'COMBINATION');
  assert.equal(event.phase, 'warning');
  assert.equal(event.durationRounds, 8);
  assert.deepEqual(event.effects, {
    bankLoansBlocked: true, mortgagesBlocked: true, marketPriceMultiplier: 0.8, tradingEnabled: false, casinoMaxBet: 350,
    constructionBlocked: true, rentMultiplier: 0.55
  });
  game.players.forEach(player => assert.equal(player.comboExperienced, true));
  assert.equal(game.globalEventsTriggered, 2);
  assert.equal(game.feed[0].text, 'FORECLOSURE SPIRAL is building. The table has one round to prepare.');
}

async function testMaybeTriggerGating() {
  // Settings off.
  const off = makeEventRoom({ globalEvents: false });
  off.game.roundNumber = 10;
  off.game.maybeTriggerGlobalEvent();
  assert.equal(off.game.globalEvent, null);
  // Not started.
  const fresh = new RoomManager().createRoom({ socketId: 'socket-a', clientId: 'client-a', nickname: 'A' });
  fresh.addOrReconnectPlayer({ socketId: 'socket-b', clientId: 'client-b', nickname: 'B' });
  fresh.setRoomSetting('globalEvents', true);
  fresh.game.roundNumber = 10;
  fresh.game.maybeTriggerGlobalEvent();
  assert.equal(fresh.game.globalEvent, null);
  // 'rare' is an accepted truthy setting; here the one-headline cap bites first.
  const rare = makeEventRoom({ globalEvents: false });
  rare.game.settings.globalEvents = 'rare';
  rare.game.roundNumber = 3;
  rare.game.globalEventsTriggered = 1;
  rare.game.maybeTriggerGlobalEvent();
  assert.equal(rare.game.globalEvent, null);
  // Active event blocks.
  const busy = makeEventRoom();
  busy.game.roundNumber = 8;
  busy.game.activateGlobalEvent(busy.game.globalEventDefinition('tourism-boom'));
  const before = busy.game.globalEvent;
  busy.game.maybeTriggerGlobalEvent();
  assert.equal(busy.game.globalEvent, before);
  // Cooldown blocks.
  const cooled = makeEventRoom();
  cooled.game.roundNumber = 8;
  cooled.game.globalEventCooldown = 2;
  cooled.game.maybeTriggerGlobalEvent();
  assert.equal(cooled.game.globalEvent, null);
  // Early rounds are gated out (progress < 0.18 -> zero chance, even 0.0).
  const early = makeEventRoom();
  early.game.roundNumber = 3;
  const restoreEarly = await stubRng({ floats: [0, 0] });
  try {
    early.game.maybeTriggerGlobalEvent();
  } finally {
    restoreEarly();
  }
  assert.equal(early.game.globalEvent, null);
  // One headline per match unless it completes a combination.
  const capped = makeEventRoom();
  capped.game.roundNumber = 8;
  capped.game.globalEventsTriggered = 1;
  const restoreCapped = await stubRng({ floats: [0, 0, 0, 0] });
  try {
    capped.game.maybeTriggerGlobalEvent();
    capped.game.maybeTriggerGlobalEvent('surprise');
  } finally {
    restoreCapped();
  }
  assert.equal(capped.game.globalEvent, null);
}

async function testMaybeTriggerChanceAndSelection() {
  // Fresh 2-player room at round 8: eligible pool in definition order is
  // [city-election, tourism-boom, public-works, convention-week, tax-audit]
  // (weights all 1, so roll = f * 5 selects index ceil(roll) - 1 style).
  // round 8 -> progress 0.4375: boundary chance 0.025, surprise 0.05.
  const miss = makeEventRoom();
  miss.game.roundNumber = 8;
  let restore = await stubRng({ floats: [0.025] });
  try {
    miss.game.maybeTriggerGlobalEvent();
  } finally {
    restore();
  }
  assert.equal(miss.game.globalEvent, null); // 0.025 >= 0.025
  const hit = makeEventRoom();
  hit.game.roundNumber = 8;
  restore = await stubRng({ floats: [0.024, 0.3] });
  try {
    hit.game.maybeTriggerGlobalEvent();
  } finally {
    restore();
  }
  assert.equal(hit.game.globalEvent.id, 'tourism-boom'); // roll 1.5 lands on index 1
  assert.equal(hit.game.globalEvent.comboId, null);
  assert.equal(hit.game.globalEventsTriggered, 1);
  const first = makeEventRoom();
  first.game.roundNumber = 8;
  restore = await stubRng({ floats: [0.024, 0.1] });
  try {
    first.game.maybeTriggerGlobalEvent();
  } finally {
    restore();
  }
  assert.equal(first.game.globalEvent.id, 'city-election'); // roll 0.5 -> index 0
  assert.equal(first.game.globalEvent.phase, 'voting');
  // Late progress: round 14 -> 0.8125: boundary 0.04, surprise 0.07.
  const late = makeEventRoom();
  late.game.roundNumber = 14;
  restore = await stubRng({ floats: [0.04] });
  try {
    late.game.maybeTriggerGlobalEvent();
  } finally {
    restore();
  }
  assert.equal(late.game.globalEvent, null); // 0.04 >= 0.04
  const surprise = makeEventRoom();
  surprise.game.roundNumber = 14;
  restore = await stubRng({ floats: [0.039, 0.1] });
  try {
    surprise.game.maybeTriggerGlobalEvent('surprise');
  } finally {
    restore();
  }
  assert.equal(surprise.game.globalEvent.id, 'city-election'); // 0.039 < 0.07
}

async function testMaybeTriggerComboPath() {
  const room = makeEventRoom();
  const game = room.game;
  game.roundNumber = 8;
  game.globalEventsTriggered = 1;
  game.globalEventHistory = [{ id: 'housing-bubble', title: 'HOUSING BUBBLE POP', comboId: null, startedRound: 1, endedRound: 7 }];
  game.players[0].bankLoan = { status: 'active', remaining: 300 };
  const restore = await stubRng({ floats: [0.01, 0.5] });
  try {
    game.maybeTriggerGlobalEvent('surprise');
  } finally {
    restore();
  }
  assert.equal(game.globalEvent.id, 'foreclosure-spiral');
  assert.equal(game.globalEvent.comboId, 'foreclosure-spiral');
  assert.equal(game.globalEvent.phase, 'warning');
  assert.equal(game.globalEvent.durationRounds, 8);
  // A combo already consumed in history cannot chain.
  const second = makeEventRoom();
  second.game.roundNumber = 8;
  second.game.globalEventsTriggered = 1;
  second.game.globalEventHistory = [{ id: 'housing-bubble', title: 'HOUSING BUBBLE POP', comboId: 'foreclosure-spiral', startedRound: 1, endedRound: 7 }];
  second.game.players[0].bankLoan = { status: 'active', remaining: 300 };
  const restoreSecond = await stubRng({ floats: [0.01, 0.5] });
  try {
    second.game.maybeTriggerGlobalEvent('surprise');
  } finally {
    restoreSecond();
  }
  assert.equal(second.game.globalEvent, null);
  // Combos are surprise-only; the round boundary cannot chain.
  const boundary = makeEventRoom();
  boundary.game.roundNumber = 8;
  boundary.game.globalEventsTriggered = 1;
  boundary.game.globalEventHistory = [{ id: 'housing-bubble', title: 'HOUSING BUBBLE POP', comboId: null, startedRound: 1, endedRound: 7 }];
  boundary.game.players[0].bankLoan = { status: 'active', remaining: 300 };
  const restoreBoundary = await stubRng({ floats: [0.01, 0.5] });
  try {
    boundary.game.maybeTriggerGlobalEvent();
  } finally {
    restoreBoundary();
  }
  assert.equal(boundary.game.globalEvent, null);
}

function testVoteGuards() {
  const room = makeEventRoom();
  const game = room.game;
  assert.deepEqual(game.voteGlobalEvent('socket-a', 'low-tax'), { success: false, error: 'There is no active global vote.' });
  game.activateGlobalEvent(game.globalEventDefinition('housing-bubble'));
  assert.deepEqual(game.voteGlobalEvent('socket-a', 'low-tax'), { success: false, error: 'There is no active global vote.' });
  game.globalEvent = null;
  game.activateGlobalEvent(game.globalEventDefinition('city-election'));
  assert.deepEqual(game.voteGlobalEvent('socket-zzz', 'low-tax'), { success: false, error: 'There is no active global vote.' });
  assert.deepEqual(game.voteGlobalEvent('socket-a', 'anarchy'), { success: false, error: 'That policy is not available.' });
  assert.equal(game.voteGlobalEvent('socket-a', 'low-tax').success, true);
  assert.equal(game.globalEvent.votes[game.players[0].id], 'low-tax');
  assert.equal(game.feed[0].text, 'A cast a vote in the city election.');
  assert.deepEqual(game.voteGlobalEvent('socket-a', 'low-tax'), { success: false, error: 'You already voted in this election.' });
  const b = game.players[1];
  b.disconnected = true;
  assert.deepEqual(game.voteGlobalEvent('socket-b', 'bank-first'), { success: false, error: 'Only active players can vote.' });
  b.disconnected = false;
}

function testResolveVotePreconditions() {
  const room = makeEventRoom();
  const game = room.game;
  game.resolveGlobalEventVote();
  assert.equal(game.globalEvent, null);
  game.activateGlobalEvent(game.globalEventDefinition('housing-bubble'));
  game.resolveGlobalEventVote();
  assert.equal(game.globalEvent.phase, 'warning');
  assert.deepEqual(feedTexts(game).slice(0, 2), [
    'HOUSING BUBBLE POP is building. The table has one round to prepare.',
    'The game begins. Players take turns clockwise.'
  ]);
}

function testResolveVoteUnanimous() {
  const room = makeEventRoom();
  const game = room.game;
  game.roundNumber = 4;
  game.activateGlobalEvent(game.globalEventDefinition('city-election'));
  const event = game.globalEvent;
  assert.equal(game.voteGlobalEvent('socket-a', 'low-tax').success, true);
  assert.equal(game.voteGlobalEvent('socket-b', 'low-tax').success, true);
  // Full turnout auto-resolves.
  assert.equal(event.phase, 'active');
  assert.equal(event.resolvedChoice, 'low-tax');
  assert.equal(event.startedRound, 4);
  assert.equal(event.roundsRemaining, event.durationRounds);
  game.players.forEach(player => {
    assert.equal(player.lastVoteChoice, 'low-tax');
    assert.equal(player.councilWins, 1);
    assert.equal(player.unanimousVote, true);
  });
  assert.equal(game.feed[0].text, 'CITY ELECTION resolved: LOW TAX.');
}

async function testResolveVoteTieAndTimeout() {
  // Three players so a 1-1 tie can reach resolve without full turnout.
  const room = makeEventRoom({ players: 3 });
  const game = room.game;
  const [a, b, c] = game.players;
  game.roundNumber = 4;
  game.activateGlobalEvent(game.globalEventDefinition('city-election'));
  const event = game.globalEvent;
  game.voteGlobalEvent('socket-a', 'low-tax');
  game.voteGlobalEvent('socket-b', 'public-works');
  assert.equal(event.phase, 'voting'); // C abstained -> no auto-resolve
  const restore = await stubRng({ ints: { '0,2': [1] } });
  try {
    game.resolveGlobalEventVote();
  } finally {
    restore();
  }
  assert.equal(event.resolvedChoice, 'public-works'); // coin flip index 1 of [low-tax, public-works]
  assert.equal(event.phase, 'active');
  assert.equal(a.lastVoteChoice, 'low-tax');
  assert.equal(a.councilWins, 0);
  assert.equal(b.councilWins, 1);
  assert.equal(c.lastVoteChoice, null);
  assert.equal(a.unanimousVote, false);
  assert.equal(game.feed[0].text, 'CITY ELECTION resolved: PUBLIC WORKS.');
  // Zero-turnout timeout via advanceRound: all three options tie at 0.
  const idle = makeEventRoom();
  idle.game.roundNumber = 6;
  idle.game.activateGlobalEvent(idle.game.globalEventDefinition('city-election'));
  const idleEvent = idle.game.globalEvent;
  const restoreIdle = await stubRng({ ints: { '0,3': [2] } });
  try {
    idle.game.advanceRound();
  } finally {
    restoreIdle();
  }
  assert.equal(idleEvent.phase, 'active');
  assert.equal(idleEvent.resolvedChoice, 'bank-first');
  assert.equal(idleEvent.startedRound, 7);
  idle.game.players.forEach(player => {
    assert.equal(player.councilWins, 0);
    assert.equal(player.unanimousVote, false);
  });
  assert.equal(idle.game.feed[0].text, 'CITY ELECTION resolved: BANK FIRST.');
}

async function testResolveVoteAntiMonopolyAndLegitimacy() {
  const room = makeEventRoom();
  const game = room.game;
  const [a, b] = game.players;
  ownsFullBrownGroup(game, a);
  ownsTile(game, b, 11); // Pink
  ownsTile(game, b, 16); // Orange
  game.roundNumber = 5;
  game.activateGlobalEvent(game.globalEventDefinition('anti-monopoly'));
  const event = game.globalEvent;
  assert.equal(event.targetPlayerId, b.id);
  assert.equal(event.phase, 'voting');
  // Full turnout auto-resolves inside the final ballot, so arm the coin
  // flip first: enforce (index 0) wins the 1-1 tie.
  const restore = await stubRng({ ints: { '0,2': [0] } });
  try {
    game.voteGlobalEvent('socket-a', 'enforce');
    game.voteGlobalEvent('socket-b', 'dismiss');
  } finally {
    restore();
  }
  assert.equal(event.resolvedChoice, 'enforce');
  assert.equal(b.publicEnemy, true); // leader voted against the outcome
  assert.equal(a.publicEnemy, false);
  // A target that voted with the outcome escapes the label.
  const second = makeEventRoom();
  const [c, d] = second.game.players;
  ownsFullBrownGroup(second.game, c);
  ownsTile(second.game, d, 16); // Orange
  ownsTile(second.game, d, 26); // Yellow
  second.game.roundNumber = 5;
  second.game.activateGlobalEvent(second.game.globalEventDefinition('anti-monopoly'));
  assert.equal(second.game.globalEvent.targetPlayerId, d.id);
  const restoreSecond = await stubRng({ ints: { '0,2': [0] } });
  try {
    second.game.voteGlobalEvent('socket-a', 'dismiss');
    second.game.voteGlobalEvent('socket-b', 'enforce');
  } finally {
    restoreSecond();
  }
  assert.equal(second.game.globalEvent.resolvedChoice, 'enforce');
  assert.equal(d.publicEnemy, false);
  assert.equal(c.publicEnemy, false); // the label only ever hits the target

  const combo = {
    id: 'legitimacy-crisis',
    title: 'LEGITIMACY CRISIS',
    summary: 'The policy vote is now part of the investigation.',
    choices: [
      { id: 'publish-audit', label: 'PUBLISH THE AUDIT', description: 'Expose the books and keep the policy under review.' },
      { id: 'bury-audit', label: 'Bury the audit', description: 'End the investigation quietly and accept the political fallout.' }
    ],
    effects: { taxMultiplier: 1.35, rentCap: 90, tradingEnabled: false },
    duration: 7
  };
  const third = makeEventRoom();
  third.game.roundNumber = 5;
  third.game.activateGlobalEvent(third.game.globalEventDefinition('city-election'), combo);
  const crisis = third.game.globalEvent;
  assert.equal(crisis.id, 'legitimacy-crisis');
  const restoreThird = await stubRng({ ints: { '0,2': [1] } });
  try {
    third.game.voteGlobalEvent('socket-a', 'bury-audit');
    third.game.voteGlobalEvent('socket-b', 'publish-audit');
  } finally {
    restoreThird();
  }
  assert.equal(crisis.resolvedChoice, 'bury-audit');
  assert.equal(third.game.players[0].compromisedCouncil, true);
  assert.equal(third.game.players[1].compromisedCouncil, false);
  assert.equal(third.game.feed[0].text, 'LEGITIMACY CRISIS resolved: BURY AUDIT.');
}

function testRentControlStipendSettlement() {
  const room = makeEventRoom();
  const game = room.game;
  const [a, b] = game.players;
  ownsFullBrownGroup(game, a);
  a.cash = 500;
  b.cash = 700;
  game.roundNumber = 5;
  game.activateGlobalEvent(game.globalEventDefinition('rent-control'));
  // Warning phase applies no settlements yet.
  assert.equal(a.cash, 500);
  game.advanceRound();
  assert.equal(game.globalEvent.phase, 'active');
  assert.equal(a.cash, 525);
  assert.equal(b.cash, 700);
  assert.equal(game.feed[1].text, 'A received a $25 rent-control stipend.');
  assert.equal(game.feed[0].text, 'RENT CONTROL ORDINANCE is now active for 6 rounds.');
  // settlementApplied latch: re-activation settles nothing further.
  game.applyGlobalEventActivationSettlements();
  game.advanceRound();
  assert.equal(a.cash, 525);
}

function testCurrencyDevaluationSettlement() {
  const room = makeEventRoom();
  const game = room.game;
  const [a, b] = game.players;
  a.cash = 1000;
  b.cash = 0;
  game.roundNumber = 5;
  game.activateGlobalEvent(game.globalEventDefinition('currency-devaluation'));
  game.advanceRound();
  assert.equal(a.cash, 920);
  assert.equal(b.cash, 0);
  assert.equal(b.zeroCashReached, true);
  assert.ok(feedTexts(game).includes('CURRENCY DEVALUATION settled a visible cash adjustment across the table.'));
}

function testBankRunBailoutSettlement() {
  const room = makeEventRoom();
  const game = room.game;
  const [a, b] = game.players;
  a.cash = 100;
  a.bankLoan = { status: 'active', remaining: 450 };
  b.cash = 1200;
  game.roundNumber = 5;
  game.activateGlobalEvent(game.globalEventDefinition('bank-run'));
  game.voteGlobalEvent('socket-a', 'emergency-bailout');
  game.voteGlobalEvent('socket-b', 'emergency-bailout');
  const event = game.globalEvent;
  assert.equal(event.phase, 'active');
  assert.equal(event.resolvedChoice, 'emergency-bailout');
  assert.equal(a.cash, 250);
  assert.equal(b.cash, 1200);
  assert.equal(a.bailoutReceived, true);
  assert.equal(a.moralHazard, true);
  assert.equal(b.bailoutReceived, false);
  assert.ok(feedTexts(game).includes('A received a $150 emergency bailout.'));
  assert.ok(feedTexts(game).includes('BANK RUN resolved: EMERGENCY BAILOUT.'));
  const activeRound = game.roundNumber;
  game.advanceRound();
  assert.equal(a.cash, 250); // latch held across the next active round
  assert.equal(game.globalEvent.startedRound, activeRound);
}

function testLetTheLedgerRunAndTaxAuditSettlement() {
  const room = makeEventRoom();
  const game = room.game;
  const [a] = game.players;
  a.cash = 100;
  game.roundNumber = 5;
  game.activateGlobalEvent(game.globalEventDefinition('bank-run'));
  game.voteGlobalEvent('socket-a', 'let-the-ledger-run');
  game.voteGlobalEvent('socket-b', 'let-the-ledger-run');
  assert.equal(game.globalEvent.resolvedChoice, 'let-the-ledger-run');
  assert.equal(a.cash, 100);
  assert.equal(a.bailoutReceived, false);
  assert.ok(!feedTexts(game).some(text => text.includes('emergency bailout')));

  const audit = makeEventRoom();
  const auditGame = audit.game;
  const [x] = auditGame.players;
  x.cash = 2000;
  auditGame.roundNumber = 6;
  auditGame.activateGlobalEvent(auditGame.globalEventDefinition('tax-audit'));
  auditGame.advanceRound();
  assert.equal(auditGame.globalEvent.phase, 'active');
  assert.equal(x.cash, 1800);
  assert.equal(auditGame.vacationPool, 200);
  assert.equal(x.taxAuditCount, 1);
  assert.equal(auditGame.feed[1].text, 'A paid $200 after the tax scandal audit.');
  // A zero-cash target settles nothing (the early return still latches).
  auditGame.globalEvent.settlementApplied = false;
  x.cash = 0;
  auditGame.applyGlobalEventActivationSettlements();
  assert.equal(x.cash, 0);
  assert.equal(x.taxAuditCount, 1);
  // Small balances pay the full remainder, capped by cash on hand.
  const small = makeEventRoom();
  small.game.roundNumber = 6;
  const [s, t] = small.game.players;
  s.cash = 10;
  t.cash = 10;
  small.game.activateGlobalEvent(small.game.globalEventDefinition('tax-audit'));
  small.game.advanceRound();
  assert.equal(s.cash, 0);
  assert.equal(s.zeroCashReached, true);
  assert.ok(feedTexts(small.game).includes('A paid $10 after the tax scandal audit.'));
  assert.equal(t.cash, 10);
}

function testHousingBubbleSurvivorFlags() {
  const room = makeEventRoom();
  const game = room.game;
  const [a, b] = game.players;
  ownsFullBrownGroup(game, a);
  game.getTile(1).houseCount = 2;
  game.roundNumber = 5;
  game.activateGlobalEvent(game.globalEventDefinition('housing-bubble'));
  game.advanceRound(); // -> active
  assert.equal(game.globalEvent.settlementApplied, true);
  for (let i = 0; i < game.globalEvent.durationRounds; i += 1) game.advanceRound();
  assert.equal(game.globalEvent.phase, 'recovery');
  assert.equal(a.bubbleSurvivor, true);
  assert.equal(a.housingBubbleEnded, true);
  assert.equal(b.bubbleSurvivor, false);
  assert.equal(b.housingBubbleEnded, true);
  game.players.forEach(player => assert.equal(player.globalEventsSurvived, 1));
}

function testActivePhaseEffectQueries() {
  const room = makeEventRoom();
  const game = room.game;
  game.roundNumber = 5;
  game.activateGlobalEvent(game.globalEventDefinition('housing-bubble'));
  assert.equal(game.globalEventActive('housing-bubble'), false);
  assert.deepEqual(game.activeEventEffects(), {});
  game.advanceRound();
  assert.equal(game.globalEventActive('housing-bubble'), true);
  assert.equal(game.isConstructionBlocked(), true);
  // housing-bubble casinoMaxBet 300 applies regardless of the casino toggle.
  assert.equal(game.casinoLimits().maxBet, 300);
  assert.equal(game.globalEventDefinition('nope'), null);
  assert.equal(game.globalEventActive('bank-run'), false);
}

const CONTRACT_SUITES = [
  ['activate — warning snapshot + phase ladder', testActivateWarningSnapshot],
  ['activate — duration scaling (housing-bubble vs others)', testActivateDurationScaling],
  ['activate — voting choices copy', testActivateVotingChoices],
  ['activate — anti-monopoly leader / tax-audit target', testActivateTargetSelection],
  ['activate — airport-strike ownership flags', testActivateAirportStrikeFlags],
  ['activate — combo merge + comboExperienced', testActivateCombo],
  ['maybeTrigger — settings/started/active/cooldown/round/cap gates', testMaybeTriggerGating],
  ['maybeTrigger — chance thresholds + weighted selection', testMaybeTriggerChanceAndSelection],
  ['maybeTrigger — surprise combination chaining', testMaybeTriggerComboPath],
  ['vote — guards and tallies', testVoteGuards],
  ['resolveVote — preconditions', testResolveVotePreconditions],
  ['resolveVote — unanimous + full-turnout auto-resolve', testResolveVoteUnanimous],
  ['resolveVote — tie coin flip + zero-turnout timeout', testResolveVoteTieAndTimeout],
  ['resolveVote — publicEnemy + compromisedCouncil', testResolveVoteAntiMonopolyAndLegitimacy],
  ['settlements — rent-control stipend + latch', testRentControlStipendSettlement],
  ['settlements — currency devaluation + zero-cash flag', testCurrencyDevaluationSettlement],
  ['settlements — bank-run bailout', testBankRunBailoutSettlement],
  ['settlements — ledger-run no-op + tax-audit amounts', testLetTheLedgerRunAndTaxAuditSettlement],
  ['phases — housing-bubble survivor flags', testHousingBubbleSurvivorFlags],
  ['effects — active-phase queries', testActivePhaseEffectQueries]
];

let passedCount = 0;
const failedSuites = [];
for (const [name, fn] of CONTRACT_SUITES) {
  try {
    await fn();
    passedCount += 1;
    console.log(`PASS — ${name}`);
  } catch (error) {
    failedSuites.push([name, error]);
    console.error(`FAIL — ${name}: ${error && error.message}`);
  }
}
const total = passedCount + failedSuites.length;
console.log(`global-events tests: ${total} suites — ${passedCount} passed, ${failedSuites.length} failed`);
if (failedSuites.length) {
  process.exitCode = 1;
}
