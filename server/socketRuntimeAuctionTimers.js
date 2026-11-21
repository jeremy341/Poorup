// Auction finish timers and the watchdog that closes windows left open without an armed deadline.

import { AUCTION_DURATION_MS } from './gameLogic.js';
import { presentationRemainingMs } from '../public/gamePresentationTiming.js';
import { runRoomTimer } from './socketRuntimeHelpers.js';

export function createAuctionTimersDomain(ctx) {
  const { roomManager, now, setTimeoutFn, clearTimeoutFn } = ctx;

  function clearAuctionTimer(room) {
    const timer = ctx.auctionTimers.get(room.roomCode);
    if (timer) {
      clearTimeoutFn(timer);
    }
    ctx.auctionTimers.delete(room.roomCode);
  }

  function scheduleAuctionFinish(room) {
    const auction = room?.game.auction;
    if (!auction?.active || room.destroyed) return;
    const roomCode = room.roomCode;
    clearAuctionTimer(room);
    const currentTime = now();
    const presentationDeadline = currentTime + presentationRemainingMs(room.game, currentTime);
    const minimumVisibleWindowEnd = presentationDeadline + AUCTION_DURATION_MS;
    const endsAt = Math.max(Number(auction.endsAt) || 0, minimumVisibleWindowEnd);
    auction.endsAt = endsAt;
    const delay = Math.max(0, endsAt - now());
    // Capture the auction object itself, not just the room code. A stale
    // callback that survives clearTimeout must never finish a newer auction in
    // the same room.
    const timer = setTimeoutFn(() => {
      // The handle has fired, so it arms nothing. Left registered it
      // would make the watchdog skip the room even if this callback returns
      // early or throws before it clears the entry.
      if (ctx.auctionTimers.get(roomCode) === timer) ctx.auctionTimers.delete(roomCode);
      runRoomTimer('auction-finish', roomCode, () => finishAuctionIfStillActive(roomCode, auction));
    }, delay);
    ctx.auctionTimers.set(roomCode, timer);
  }

  function auctionFinishStatus(room, expectedAuction) {
    const auction = room?.game.auction;
    if (!auction?.active) return 'missing';
    if (expectedAuction && auction !== expectedAuction) return 'replaced';
    return 'active';
  }

  function finishAuctionIfStillActive(roomCode, expectedAuction) {
    const currentRoom = roomManager.getRoom(roomCode);
    const status = auctionFinishStatus(currentRoom, expectedAuction);
    // Do not clear a timer for a newer auction when an older callback fires.
    if (status === 'replaced') return;
    if (status === 'missing') {
      clearAuctionTimer({ roomCode });
      return;
    }
    const remaining = Number(expectedAuction?.endsAt) - now();
    if (Number.isFinite(remaining) && remaining > 0) {
      scheduleAuctionFinish(currentRoom);
      return;
    }
    currentRoom.game.finishAuction();
    ctx.auctionEvaluations.delete(roomCode);
    ctx.clearBotAuctionTimersForRoom(roomCode);
    ctx.emitRoomState(currentRoom);
    clearAuctionTimer(currentRoom);
  }

  // Safety net for any path that leaves an auction open with no finish armed:
  // once its window has passed, close it exactly as the timer would.
  function auctionWatchdogTick() {
    for (const [roomCode, room] of roomManager.rooms.entries()) {
      const auction = ctx.activeAuction(room);
      if (!auction || ctx.auctionTimers.has(roomCode)) continue;
      if (Number(auction.endsAt) > now()) continue;
      finishAuctionIfStillActive(roomCode, auction);
    }
  }

  Object.assign(ctx, {
    clearAuctionTimer,
    scheduleAuctionFinish,
    auctionWatchdogTick
  });
}
