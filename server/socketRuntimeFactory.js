// Builds one socket runtime per process and wires its domain modules into the object the socket handlers consume.

import { createMaintenanceGate } from './maintenanceGate.js';
import { createRoomPresenceRuntime } from './roomPresenceRuntime.js';
import { createRoomVoteKickRuntime } from './roomVoteKickRuntime.js';
import { safeBotProviderStatus } from './botStatus.js';
import { reassignHostIfNeeded, runRoomTimer } from './socketRuntimeHelpers.js';
import {
  AUCTION_WATCHDOG_INTERVAL_MS,
  DISCONNECT_GRACE_MS,
  EMPTY_ROOM_GC_INTERVAL_MS,
  IDLE_SEAT_SWEEP_INTERVAL_MS,
  TRADE_EXPIRY_SWEEP_INTERVAL_MS
} from './socketRuntimeConstants.js';
import { createBroadcastDomain } from './socketRuntimeBroadcast.js';
import { createSeatsDomain } from './socketRuntimeSeats.js';
import { createBotsDomain } from './socketRuntimeBots.js';
import { createAuctionTimersDomain } from './socketRuntimeAuctionTimers.js';
import { createInvitesDomain } from './socketRuntimeInvites.js';

function createRuntime(deps) {
  const { io, roomManager, accountStore, socialStore, matchStore, achievementStore, telemetryStore, botAdvisor, social, maintenance, maintenanceAccess, metrics, authoritativeStore, pubsubAdapter } = deps;
  const setTimeoutFn = deps.setTimeout || globalThis.setTimeout;
  const clearTimeoutFn = deps.clearTimeout || globalThis.clearTimeout;
  const setIntervalFn = deps.setInterval || globalThis.setInterval;
  const clearIntervalFn = deps.clearInterval || globalThis.clearInterval;
  const now = deps.now || (() => Date.now());
  const configuredDisconnectGrace = Number(deps.disconnectGraceMs);
  const disconnectGraceMs = Number.isFinite(configuredDisconnectGrace) && configuredDisconnectGrace > 0
    ? Math.max(1, Math.floor(configuredDisconnectGrace))
    : DISCONNECT_GRACE_MS;

  // One shared context carries the injected dependencies, the timer registries
  // and every domain method; domains call each other through it so no module
  // needs to import another and no import cycle can form.
  const ctx = {
    io, roomManager, accountStore, socialStore, matchStore, achievementStore,
    telemetryStore, botAdvisor, social, maintenance, maintenanceAccess, metrics,
    authoritativeStore, pubsubAdapter,
    setTimeoutFn, clearTimeoutFn, setIntervalFn, clearIntervalFn, now, disconnectGraceMs,
    auctionTimers: new Map(),
    disconnectTimers: new Map(),
    botTimers: new Map(),
    // Room code: the token of the decision that owns the lock.
    botDecisionLocks: new Map(),
    // Room code: the watchdog timer of the decision that holds the lock, so a
    // room teardown can stop it.
    botDecisionWatchdogs: new Map(),
    // Room code: the one-shot re-check of a bot buyer's open sponsorship.
    sponsorshipRechecks: new Map(),
    // Auction decisions belong to a specific bot AND auction instance. A room-wide
    // lock serialized remote AI calls, letting one 4s request starve other bots
    // during the 5s bid window.
    auctionBotTimers: new Map(),
    auctionDecisionLocks: new Set(),
    auctionEvaluations: new Map(),
    auctionIds: new WeakMap(),
    nextAuctionId: 0,
    roomsUpdatedTimer: null
  };

  createBroadcastDomain(ctx);
  createSeatsDomain(ctx);
  createBotsDomain(ctx);
  createAuctionTimersDomain(ctx);
  createInvitesDomain(ctx);

  ctx.roomPresenceRuntime = createRoomPresenceRuntime({
    roomManager,
    runRoomTimer,
    setTimeoutFn,
    clearTimeoutFn,
    now,
    emitRoomState: ctx.emitRoomState,
    removeSeatForReason: ctx.removeSeatForReason,
  });

  ctx.roomVoteKickRuntime = createRoomVoteKickRuntime({
    io,
    roomManager,
    runRoomTimer,
    setTimeoutFn,
    clearTimeoutFn,
    now,
    removeSeatForReason: ctx.removeSeatForReason,
  });

  const unsubscribeBotProviderStatus = typeof botAdvisor?.subscribeProviderStatus === 'function'
    ? botAdvisor.subscribeProviderStatus(status => io.emit('bot-provider-status', safeBotProviderStatus(status)))
    : null;

  const {
    maintenanceSnapshot, maintenanceBypass, canCreateRoom, canStartRound, canJoinRoom,
    maintenanceStateFor, emitMaintenanceState, broadcastMaintenanceState, lockoutRefusal
  } = createMaintenanceGate({ io, maintenance, maintenanceAccess, social, getAdminIds: () => runtime.adminIds });

  Object.assign(ctx, {
    maintenanceSnapshot, maintenanceBypass, canCreateRoom, canStartRound, canJoinRoom,
    maintenanceStateFor, emitMaintenanceState, broadcastMaintenanceState, lockoutRefusal
  });

  const runtime = {
    acceptRoomInvite: ctx.acceptRoomInvite,
    accountStore,
    authoritativeStore,
    achievementStore,
    cachedContractCancel: ctx.cachedContractCancel,
    cacheContractCancel: ctx.cacheContractCancel,
    clearDisconnectTimer: ctx.clearDisconnectTimer,
    destroyRoom: ctx.destroyRoom,
    detachSocketFromOtherRoom: ctx.detachSocketFromOtherRoom,
    releaseSocketSeats: ctx.releaseSocketSeats,
    getRoomForSocket: ctx.getRoomForSocket,
    handleSocketDisconnect: ctx.handleSocketDisconnect,
    resolveSeatExitObligations: ctx.resolveSeatExitObligations,
    io,
    leaveAllGameRooms: ctx.leaveAllGameRooms,
    matchStore,
    metrics,
    maintenance,
    pubsubAdapter,
    maintenanceSnapshot,
    maintenanceBypass,
    maintenanceStateFor,
    emitMaintenanceState,
    broadcastMaintenanceState,
    lockoutRefusal,
    canCreateRoom,
    canStartRound,
    canJoinRoom,
    botProviderStatus: ctx.botProviderStatus,
    unsubscribeBotProviderStatus,
    // Shutdown hook: stops every background interval (rooms GC, auction watchdog, idle seats, trade expiry).
    dispose: stopBackgroundTimers,
    now,
    telemetryStore,
    reassignHostIfNeeded,
    roomManager,
    scheduleAuctionFinish: ctx.scheduleAuctionFinish,
    scheduleBotAuction: ctx.scheduleBotAuction,
    scheduleBotTurn: ctx.scheduleBotTurn,
    scheduleRoomsUpdated: ctx.scheduleRoomsUpdated,
    social,
    socialStore,
    emitPendingInteractions: ctx.emitPendingInteractions,
    emitRoomState: ctx.emitRoomState,
    setPlayerPresence: ctx.roomPresenceRuntime.setPlayerPresence,
    noteSocketEvent: ctx.roomPresenceRuntime.noteSocketEvent,
    sweepIdleSeats: ctx.roomPresenceRuntime.sweepIdleSeats,
    startRoomVoteKick: ctx.roomVoteKickRuntime.startRoomVoteKick,
    castRoomVoteKick: ctx.roomVoteKickRuntime.castRoomVoteKick
  };
  ctx.runtime = runtime;

  roomManager.setRoomDestroyer?.(ctx.destroyRoom);
  const emptyRoomGcTimer = setIntervalFn(() => runRoomTimer('empty-room-gc', '*', ctx.emptyRoomGcTick), EMPTY_ROOM_GC_INTERVAL_MS);
  emptyRoomGcTimer?.unref?.();
  const auctionWatchdogTimer = setIntervalFn(() => runRoomTimer('auction-watchdog', '*', ctx.auctionWatchdogTick), AUCTION_WATCHDOG_INTERVAL_MS);
  auctionWatchdogTimer?.unref?.();
  const idleSeatSweepTimer = setIntervalFn(() => runRoomTimer('idle-seat-sweep', '*', () => ctx.roomPresenceRuntime.sweepIdleSeats()), IDLE_SEAT_SWEEP_INTERVAL_MS);
  idleSeatSweepTimer?.unref?.();
  const tradeExpirySweepTimer = setIntervalFn(() => runRoomTimer('trade-expiry-sweep', '*', ctx.tradeExpirySweepTick), TRADE_EXPIRY_SWEEP_INTERVAL_MS);
  tradeExpirySweepTimer?.unref?.();

  function stopBackgroundTimers() {
    [emptyRoomGcTimer, auctionWatchdogTimer, idleSeatSweepTimer, tradeExpirySweepTimer].forEach(timer => clearIntervalFn(timer));
  }

  return runtime;
}

export { createRuntime };
