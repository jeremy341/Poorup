import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { createRuntime } from './socketRuntime.js';
import { registerGameSocketHandlers } from './serverSocketGame.js';
import { VOTE_KICK_COOLDOWN_MS, VOTE_KICK_DURATION_MS, VOTE_KICK_TARGET_COOLDOWN_MS } from './roomVoteKick.js';

function makeHarness() {
  let currentTime = 10_000;
  let timerId = 0;
  const timers = new Map();
  const sockets = new Map();
  const broadcasts = [];
  const io = {
    sockets: { sockets },
    on() {},
    emit() {},
    in(roomCode) { return { emit(event, payload) { broadcasts.push({ roomCode, event, payload }); } }; },
    to() { return { emit() {} }; },
  };
  const manager = new RoomManager();
  const runtime = createRuntime({
    io,
    roomManager: manager,
    social: { chatLastSent: new Map(), patrolRuns: new Map(), socketsForAccount: () => [], accountForSocket: () => null },
    setInterval: () => 0,
    now: () => currentTime,
    setTimeout(callback, delay) {
      const handle = { id: ++timerId, callback, deadline: currentTime + delay, delay };
      timers.set(handle.id, handle);
      return handle;
    },
    clearTimeout(handle) { if (handle) timers.delete(handle.id); },
  });
  function addSocket(socketId, clientId, nickname, existingRoom = null) {
    const handlers = new Map();
    const socket = {
      id: socketId,
      rooms: new Set([socketId]),
      data: {},
      on(event, handler) { handlers.set(event, handler); },
      use() {},
      emit() {},
      join(roomCode) { this.rooms.add(roomCode); },
      leave(roomCode) { this.rooms.delete(roomCode); },
      handlers,
    };
    let room = existingRoom || manager.getRoomBySocket(socketId);
    if (!room) room = manager.createRoom({ socketId, clientId, nickname });
    else {
      room.addOrReconnectPlayer({ socketId, clientId, nickname });
      manager.socketRoom.set(socketId, room);
    }
    socket.join(room.roomCode);
    sockets.set(socketId, socket);
    registerGameSocketHandlers((event, handler) => socket.on(event, handler), socket, runtime);
    return { socket, room, ask(event, payload = {}) {
      return new Promise(resolve => handlers.get(event)?.(payload, resolve));
    } };
  }
  return {
    manager,
    runtime,
    timers,
    broadcasts,
    addSocket,
    setTime(value) { currentTime = value; },
    runTimers() {
      const due = [...timers.values()].filter(timer => timer.deadline <= currentTime);
      due.forEach(timer => { timers.delete(timer.id); timer.callback(); });
    },
  };
}

{
  const harness = makeHarness();
  const host = harness.addSocket('host-socket', 'host-client', 'Host');
  const target = harness.addSocket('target-socket', 'target-client', 'Target', host.room);
  const voter = harness.addSocket('voter-socket', 'voter-client', 'Voter', host.room);
  const targetId = target.room.game.players.find(player => player.clientId === 'target-client').id;
  assert.equal(typeof host.socket.handlers.get('room-votekick-start'), 'function');
  const started = await host.ask('room-votekick-start', { targetPlayerId: targetId, requestId: 'start-1' });
  assert.equal(started.success, true);
  assert.equal(started.vote.eligibleCount, 2);
  assert.equal('voterIds' in started.vote, false, 'public vote state exposes counts without voter identities');
  const repeat = await host.ask('room-votekick-cast', { voteId: started.vote.voteId, choice: 'yes', requestId: 'cast-1' });
  assert.equal(repeat.success, false, 'initiator cannot cast a second ballot');
  const result = await voter.ask('room-votekick-cast', { voteId: started.vote.voteId, choice: 'yes', requestId: 'cast-2' });
  assert.equal(result.success, true);
  assert.equal(result.vote.status, 'passed');
  assert.equal(host.room.game.players.some(player => player.id === targetId), false);
  assert.equal(target.room.addOrReconnectPlayer({ socketId: 'target-retry', clientId: 'target-client', nickname: 'Target' }).success, false);
}

{
  const harness = makeHarness();
  const host = harness.addSocket('timeout-host', 'timeout-host-client', 'Host');
  harness.addSocket('timeout-target', 'timeout-target-client', 'Target', host.room);
  harness.addSocket('timeout-voter', 'timeout-voter-client', 'Voter', host.room);
  const targetId = host.room.game.players.find(player => player.clientId === 'timeout-target-client').id;
  const started = await host.ask('room-votekick-start', { targetPlayerId: targetId, requestId: 'timeout-start-1' });
  assert.equal(started.success, true);
  harness.setTime(40_000);
  harness.runTimers();
  assert.equal(host.room.voteKickSnapshot.status, 'expired');
  const cooledDown = await host.ask('room-votekick-start', { targetPlayerId: targetId, requestId: 'timeout-start-2' });
  assert.equal(cooledDown.success, false, 'the initiator cooldown outlasts an early timeout');
  harness.setTime(70_000);
  // The expired vote also put its target on the per-target cooldown (D2b-09),
  // so the post-cooldown restart is aimed at the other human seat.
  const voterId = host.room.game.players.find(player => player.clientId === 'timeout-voter-client').id;
  const afterCooldown = await host.ask('room-votekick-start', { targetPlayerId: voterId, requestId: 'timeout-start-3' });
  assert.equal(afterCooldown.success, true, 'the same initiator may start again once the full cooldown expires');
}

{
  // D2b-09: a failed vote puts its target on a per-target cooldown, so another
  // human cannot re-open the same target straight away. The injected clock
  // drives the cooldown end.
  const harness = makeHarness();
  const host = harness.addSocket('cool-host', 'cool-host-client', 'Host');
  harness.addSocket('cool-target', 'cool-target-client', 'Target', host.room);
  const voterOne = harness.addSocket('cool-voter-1', 'cool-voter-1-client', 'VoterOne', host.room);
  const voterTwo = harness.addSocket('cool-voter-2', 'cool-voter-2-client', 'VoterTwo', host.room);
  const targetId = host.room.game.getPlayerByClient('cool-target-client').id;
  const started = await host.ask('room-votekick-start', { targetPlayerId: targetId, requestId: 'cool-start' });
  assert.equal(started.success, true);
  const firstNo = await voterOne.ask('room-votekick-cast', { voteId: started.vote.voteId, choice: 'no', requestId: 'cool-no-1' });
  assert.equal(firstNo.vote.status, 'open');
  const secondNo = await voterTwo.ask('room-votekick-cast', { voteId: started.vote.voteId, choice: 'no', requestId: 'cool-no-2' });
  assert.equal(secondNo.vote.status, 'failed');
  harness.setTime(10_000 + VOTE_KICK_TARGET_COOLDOWN_MS - 1);
  const blocked = await voterOne.ask('room-votekick-start', { targetPlayerId: targetId, requestId: 'cool-retry-1' });
  assert.equal(blocked.success, false, 'the same target cannot be re-opened inside the per-target cooldown');
  const otherTarget = await voterOne.ask('room-votekick-start', { targetPlayerId: host.room.game.getPlayerByClient('cool-voter-2-client').id, requestId: 'cool-other' });
  assert.equal(otherTarget.success, true, 'the cooldown is per target, so another seat can still be voted on');
  harness.setTime(10_000 + VOTE_KICK_TARGET_COOLDOWN_MS - 1 + VOTE_KICK_DURATION_MS);
  harness.runTimers();
  harness.setTime(10_000 + VOTE_KICK_TARGET_COOLDOWN_MS + VOTE_KICK_DURATION_MS);
  // The host reopens: voterOne's own initiator cooldown from the other-target
  // vote would otherwise be the reason this start is refused.
  const reopened = await host.ask('room-votekick-start', { targetPlayerId: targetId, requestId: 'cool-retry-2' });
  assert.equal(reopened.success, true, 'the target can be voted on again once its cooldown ends');
}

{
  // F-070: a seat that goes bankrupt mid-vote was in the electorate when the
  // vote opened, and its earlier yes must stop counting once it is eliminated.
  // Five humans: electorate of four, threshold of three. The classic board
  // seats four, so the table moves to metro-52 (six seats) first.
  const harness = makeHarness();
  const host = harness.addSocket('bankrupt-host', 'bankrupt-host-client', 'Host');
  host.room.setRoomSetting('boardVariant', 'metro-52');
  host.room.setRoomSetting('maxPlayers', 6);
  const bankruptVoter = harness.addSocket('bankrupt-voter', 'bankrupt-voter-client', 'Bankrupt', host.room);
  const steady = harness.addSocket('steady-voter', 'steady-voter-client', 'Steady', host.room);
  const third = harness.addSocket('third-voter', 'third-voter-client', 'Third', host.room);
  harness.addSocket('vote-target', 'vote-target-client', 'Target', host.room);
  assert.equal(host.room.startGame().success, true);
  const targetId = host.room.game.getPlayerByClient('vote-target-client').id;
  const started = await host.ask('room-votekick-start', { targetPlayerId: targetId, requestId: 'bankrupt-start' });
  assert.equal(started.success, true);
  assert.equal(started.vote.eligibleCount, 4);
  assert.equal(started.vote.requiredYes, 3);
  const earlyYes = await bankruptVoter.ask('room-votekick-cast', { voteId: started.vote.voteId, choice: 'yes', requestId: 'bankrupt-cast-0' });
  assert.equal(earlyYes.success, true);
  host.room.game.handleBankruptcy(host.room.game.getPlayerByClient('bankrupt-voter-client'));
  const steadyYes = await steady.ask('room-votekick-cast', { voteId: started.vote.voteId, choice: 'yes', requestId: 'bankrupt-cast-1' });
  assert.equal(steadyYes.success, true);
  assert.equal(steadyYes.vote.status, 'open', 'the eliminated seat earlier yes no longer counts toward the threshold');
  assert.equal(steadyYes.vote.yesCount, 2);
  assert.equal(host.room.game.players.some(player => player.clientId === 'vote-target-client'), true, 'no pass yet, so the target stays seated');
  const decisive = await third.ask('room-votekick-cast', { voteId: started.vote.voteId, choice: 'yes', requestId: 'bankrupt-cast-2' });
  assert.equal(decisive.vote.status, 'passed');
  assert.equal(host.room.game.players.some(player => player.clientId === 'vote-target-client'), false);
}

{
  // Same shape, but the bankrupt seat votes after its elimination: rejected,
  // and it cannot push the vote to the threshold.
  const harness = makeHarness();
  const host = harness.addSocket('late-host', 'late-host-client', 'Host');
  const lateVoter = harness.addSocket('late-voter', 'late-voter-client', 'Late', host.room);
  harness.addSocket('late-steady', 'late-steady-client', 'Steady', host.room);
  harness.addSocket('late-target', 'late-target-client', 'Target', host.room);
  assert.equal(host.room.startGame().success, true);
  const targetId = host.room.game.getPlayerByClient('late-target-client').id;
  const started = await host.ask('room-votekick-start', { targetPlayerId: targetId, requestId: 'late-start' });
  assert.equal(started.success, true);
  host.room.game.handleBankruptcy(host.room.game.getPlayerByClient('late-voter-client'));
  const rejected = await lateVoter.ask('room-votekick-cast', { voteId: started.vote.voteId, choice: 'yes', requestId: 'late-cast' });
  assert.equal(rejected.success, false, 'an eliminated seat cannot cast');
  assert.equal(host.room.voteKick.status, 'open');
  assert.equal(host.room.game.players.some(player => player.clientId === 'late-target-client'), true, 'the target is not removed by a rejected ballot');
}

{
  // F-071: endGame clears a vote opened in the finished match, so the rematch
  // starts with no vote and the old ballot cannot decide it.
  const harness = makeHarness();
  const host = harness.addSocket('end-host', 'end-host-client', 'Host');
  harness.addSocket('end-target', 'end-target-client', 'Target', host.room);
  const voter = harness.addSocket('end-voter', 'end-voter-client', 'Voter', host.room);
  assert.equal(host.room.startGame().success, true);
  const targetId = host.room.game.getPlayerByClient('end-target-client').id;
  const started = await host.ask('room-votekick-start', { targetPlayerId: targetId, requestId: 'end-start' });
  assert.equal(started.success, true);
  host.room.game.endGame();
  assert.equal(host.room.voteKick, null, 'endGame clears the open vote');
  assert.equal(host.room.getRoomSummary(null).voteKick, null, 'the room summary no longer shows the finished match vote');
  assert.equal(host.room.startGame().success, true, 'the rematch starts');
  assert.equal(host.room.voteKick, null, 'a rematch start carries no vote over');
  const stale = await voter.ask('room-votekick-cast', { voteId: started.vote.voteId, choice: 'yes', requestId: 'end-stale' });
  assert.equal(stale.success, false, 'a ballot on the finished match vote is refused in the rematch');
  assert.equal(host.room.game.players.some(player => player.clientId === 'end-target-client'), true, 'the target is not removed by the stale vote');
}

{
  // F-071: a vote opened in the lobby does not survive into the first match.
  const harness = makeHarness();
  const host = harness.addSocket('lobby-host', 'lobby-host-client', 'Host');
  harness.addSocket('lobby-target', 'lobby-target-client', 'Target', host.room);
  harness.addSocket('lobby-voter', 'lobby-voter-client', 'Voter', host.room);
  const targetId = host.room.game.getPlayerByClient('lobby-target-client').id;
  const lobbyVote = await host.ask('room-votekick-start', { targetPlayerId: targetId, requestId: 'lobby-start' });
  assert.equal(lobbyVote.success, true);
  assert.equal(host.room.getRoomSummary(null).voteKick.status, 'open');
  assert.equal(host.room.startGame().success, true);
  assert.equal(host.room.voteKick, null, 'starting the game clears the lobby vote');
}

{
  // D2b-11: a target who leaves mid-vote closes the vote with a notice. It is
  // never reported as passed, and nothing is removed for it.
  const harness = makeHarness();
  const host = harness.addSocket('left-host', 'left-host-client', 'Host');
  harness.addSocket('left-target', 'left-target-client', 'Target', host.room);
  const voter = harness.addSocket('left-voter', 'left-voter-client', 'Voter', host.room);
  harness.addSocket('left-third', 'left-third-client', 'Third', host.room);
  const targetId = host.room.game.getPlayerByClient('left-target-client').id;
  const started = await host.ask('room-votekick-start', { targetPlayerId: targetId, requestId: 'left-start' });
  assert.equal(started.success, true);
  harness.manager.leaveRoomByClient('left-target-client', 'left-target', host.room);
  harness.runtime.emitRoomState(host.room);
  assert.equal(host.room.voteKick.status, 'closed', 'the departure closes the vote');
  assert.equal(host.room.getRoomSummary(null).voteKick.status, 'closed');
  const notices = harness.broadcasts.filter(entry => entry.event === 'system-message').map(entry => entry.payload.text);
  assert.ok(notices.includes('Target left; vote closed.'), 'the room is told the vote closed');
  const late = await voter.ask('room-votekick-cast', { voteId: started.vote.voteId, choice: 'yes', requestId: 'left-cast' });
  assert.equal(late.success, false, 'a ballot after the target left is refused, not counted as a pass');
  assert.notEqual(late.vote?.status, 'passed');
  assert.equal(notices.filter(text => text.includes('removed')).length, 0, 'no removal notice is produced for a vote that never passed');
}

{
  // E19-07: the start replay cache keeps a short digest of the request's
  // fields, never the payload, and an oversized vote-kick payload is refused
  // before it can be cached.
  const harness = makeHarness();
  const host = harness.addSocket('replay-host', 'replay-host-client', 'Host');
  harness.addSocket('replay-target', 'replay-target-client', 'Target', host.room);
  const voter = harness.addSocket('replay-voter', 'replay-voter-client', 'Voter', host.room);
  const targetId = host.room.game.getPlayerByClient('replay-target-client').id;
  const padded = await host.ask('room-votekick-start', { targetPlayerId: targetId, requestId: 'replay-padded', padding: 'x'.repeat(4096) });
  assert.equal(padded.success, false);
  assert.match(padded.error, /too large/);
  assert.equal(host.room.voteKick, undefined, 'a refused payload opens no vote');
  assert.equal(host.room.voteKickReplays?.size ?? 0, 0, 'and is not cached');
  const started = await host.ask('room-votekick-start', { targetPlayerId: targetId, requestId: 'replay-start' });
  assert.equal(started.success, true);
  const paddedCast = await voter.ask('room-votekick-cast', { voteId: started.vote.voteId, choice: 'no', requestId: 'replay-cast', padding: 'x'.repeat(4096) });
  assert.equal(paddedCast.success, false);
  assert.match(paddedCast.error, /too large/);
  const voterId = host.room.game.getPlayerByClient('replay-voter-client').id;
  assert.equal(host.room.voteKick.ballots[voterId], undefined, 'a refused ballot is not counted');
  const repeated = await host.ask('room-votekick-start', { targetPlayerId: targetId, requestId: 'replay-start' });
  assert.deepEqual(repeated, started, 'a repeated request returns the cached result');
  const changed = await host.ask('room-votekick-start', { targetPlayerId: 'someone-else', requestId: 'replay-start' });
  assert.equal(changed.error, 'That request ID was already used.');
  assert.equal(host.room.voteKickReplays.size, 1);
  for (const entry of host.room.voteKickReplays.values()) {
    assert.match(entry.fingerprint, /^[0-9a-f]{24}$/, 'the cache keeps a fixed-size digest, not the request payload');
  }
}

{
  // D2b-10, documented limit: a vote-kick blocks the removed seat's clientId
  // and accountId only. A guest who comes back with a fresh clientId takes a
  // new seat at once. The room keeps no client address to block, so this pins
  // the current behaviour and is not a guarantee.
  const harness = makeHarness();
  const host = harness.addSocket('rejoin-host', 'rejoin-host-client', 'Host');
  harness.addSocket('rejoin-target', 'rejoin-target-client', 'Target', host.room);
  const voter = harness.addSocket('rejoin-voter', 'rejoin-voter-client', 'Voter', host.room);
  const targetId = host.room.game.getPlayerByClient('rejoin-target-client').id;
  const started = await host.ask('room-votekick-start', { targetPlayerId: targetId, requestId: 'rejoin-start' });
  const passed = await voter.ask('room-votekick-cast', { voteId: started.vote.voteId, choice: 'yes', requestId: 'rejoin-cast' });
  assert.equal(passed.vote.status, 'passed');
  assert.equal(host.room.addOrReconnectPlayer({ socketId: 'rejoin-same', clientId: 'rejoin-target-client', nickname: 'Target' }).success, false, 'the removed clientId is blocked');
  assert.equal(host.room.addOrReconnectPlayer({ socketId: 'rejoin-fresh', clientId: 'rejoin-fresh-client', nickname: 'Target' }).success, true, 'pinned: a fresh clientId can take a new seat');
}

{
  // F-031 / D2b-04: a kick removes a started-game seat through the same exit
  // settlement as a leave, so the kicked seat's cash goes to the bank with a
  // feed line instead of stranding on the removed seat.
  const harness = makeHarness();
  const host = harness.addSocket('kick-cash-host', 'kick-cash-host-client', 'Host');
  const voter = harness.addSocket('kick-cash-voter', 'kick-cash-voter-client', 'Voter', host.room);
  harness.addSocket('kick-cash-target', 'kick-cash-target-client', 'Target', host.room);
  host.room.setRoomSetting('bots', 0);
  assert.equal(host.room.startGame().success, true);
  const target = host.room.game.getPlayerByClient('kick-cash-target-client');
  target.cash = 400;
  const started = await host.ask('room-votekick-start', { targetPlayerId: target.id, requestId: 'kick-cash-start' });
  assert.equal(started.success, true);
  const passed = await voter.ask('room-votekick-cast', { voteId: started.vote.voteId, choice: 'yes', requestId: 'kick-cash-cast' });
  assert.equal(passed.vote.status, 'passed');
  assert.equal(host.room.game.getPlayerByClient('kick-cash-target-client'), undefined, 'the target is removed');
  assert.equal(target.cash, 0, 'the kicked seat no longer holds its cash');
  assert.ok(host.room.game.feed.some(entry => entry.text === 'Target forfeits $400 to the bank.'), 'the forfeit is announced');
}

{
  // S02-F3: every accepted ballot replaces room.voteKick with a new object, so the
  // expiry timer must act on the live vote, not the one captured at start. A vote
  // that got one non-deciding ballot used to stay open forever and block every
  // later vote in the room.
  const harness = makeHarness();
  const host = harness.addSocket('ballot-host', 'ballot-host-client', 'Host');
  harness.addSocket('ballot-target', 'ballot-target-client', 'Target', host.room);
  const voterOne = harness.addSocket('ballot-voter-1', 'ballot-voter-1-client', 'VoterOne', host.room);
  harness.addSocket('ballot-voter-2', 'ballot-voter-2-client', 'VoterTwo', host.room);
  const targetId = host.room.game.getPlayerByClient('ballot-target-client').id;
  const started = await host.ask('room-votekick-start', { targetPlayerId: targetId, requestId: 'ballot-start' });
  assert.equal(started.success, true);
  const firstNo = await voterOne.ask('room-votekick-cast', { voteId: started.vote.voteId, choice: 'no', requestId: 'ballot-no' });
  assert.equal(firstNo.vote.status, 'open', 'one non-deciding ballot leaves the vote open');
  harness.setTime(10_000 + VOTE_KICK_DURATION_MS + 1);
  harness.runTimers();
  assert.equal(host.room.voteKick.status, 'expired', 'the expiry timer closes a vote that already received a ballot');
  assert.equal(host.room.voteKickSnapshot.status, 'expired', 'and clients are told');
  harness.setTime(10_000 + VOTE_KICK_COOLDOWN_MS + 1);
  const retarget = await voterOne.ask('room-votekick-start', { targetPlayerId: targetId, requestId: 'ballot-retry' });
  assert.equal(retarget.success, false, 'the expired vote put its target on the per-target cooldown');
  const otherId = host.room.game.getPlayerByClient('ballot-voter-2-client').id;
  const other = await voterOne.ask('room-votekick-start', { targetPlayerId: otherId, requestId: 'ballot-other' });
  assert.equal(other.success, true, 'an expired vote no longer blocks a new vote on another seat');
}

{
  // X13: the replay cache and the cooldowns belong to the match they were
  // opened in. A request id from the finished match is not answered from the
  // cache in the rematch (it answered with a stale {status:'open'}), and a
  // cooldown does not bleed into the next match.
  const harness = makeHarness();
  const host = harness.addSocket('x13-host', 'x13-host-client', 'Host');
  harness.addSocket('x13-target', 'x13-target-client', 'Target', host.room);
  harness.addSocket('x13-voter', 'x13-voter-client', 'Voter', host.room);
  assert.equal(host.room.startGame().success, true);
  const targetId = host.room.game.getPlayerByClient('x13-target-client').id;
  const started = await host.ask('room-votekick-start', { targetPlayerId: targetId, requestId: 'x13-start' });
  assert.equal(started.success, true);
  assert.equal(host.room.voteKickReplays.size, 1, 'the start is cached for replay');
  assert.equal(host.room.voteKickCooldowns.size, 1, 'and the initiator is on cooldown');
  harness.setTime(10_000 + VOTE_KICK_DURATION_MS + 1);
  harness.runTimers();
  assert.equal(host.room.voteKickTargetCooldowns.size, 1, 'the expired vote puts its target on a cooldown');
  host.room.game.endGame();
  assert.equal(host.room.voteKickReplays.size, 0, 'the replay cache dies with the match');
  assert.equal(host.room.voteKickCooldowns.size, 0, 'the initiator cooldown dies with the match');
  assert.equal(host.room.voteKickTargetCooldowns.size, 0, 'the target cooldown dies with the match');
  assert.equal(host.room.startGame().success, true, 'the rematch starts');
  const restarted = await host.ask('room-votekick-start', { targetPlayerId: targetId, requestId: 'x13-start' });
  assert.equal(restarted.success, true, 'the reused request id opens a fresh vote in the rematch');
  assert.notEqual(restarted.vote.voteId, started.vote.voteId, 'the stale vote is not replayed');
}

{
  // D7: a finished match is not mutable. The vote-kick cannot be opened and no
  // seat is removed once the match is over. A lobby that never played keeps
  // the vote (the room-management vote is a lobby action).
  const harness = makeHarness();
  const host = harness.addSocket('ended-host', 'ended-host-client', 'Host');
  harness.addSocket('ended-target', 'ended-target-client', 'Target', host.room);
  harness.addSocket('ended-voter', 'ended-voter-client', 'Voter', host.room);
  const targetId = host.room.game.getPlayerByClient('ended-target-client').id;
  assert.equal(host.room.startGame().success, true);
  host.room.game.endGame();
  const blocked = await host.ask('room-votekick-start', { targetPlayerId: targetId, requestId: 'ended-start' });
  assert.equal(blocked.success, false, 'a vote-kick cannot be opened after the match ended');
  assert.equal(host.room.game.players.some(player => player.clientId === 'ended-target-client'), true, 'no seat is removed for a finished match');
  assert.equal(host.room.startGame().success, true, 'the rematch starts');
  const restarted = await host.ask('room-votekick-start', { targetPlayerId: targetId, requestId: 'ended-start-2' });
  assert.equal(restarted.success, true, 'the rematch accepts a vote-kick again');
}

console.log('room vote-kick runtime: 12 scenarios passed');
