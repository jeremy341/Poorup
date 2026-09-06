// Shared building blocks for the socket layer: the crash-safe per-event
// emitter, the ack helpers every handler funnels through, and the factory
// that installs the repetitive room-verb handlers from a definition table
// (the pattern server/rooms.js GAME_PASSTHROUGHS uses for Room methods).
// Behavior here is pinned by server/server.test.js (null-payload storm) and
// the ack-shape checks in server/rooms.test.js.

// Ack payload the room verbs answer with. The property order (success,
// error, then verb-specific extras) is what rooms.test.js string-compares.
function roomVerbAck(result, extras) {
  const extra = extras ? extras(result) : {};
  return { success: result?.success ?? false, error: result?.error, ...extra };
}

function reply(callback, payload) {
  if (typeof callback === 'function') {
    callback(payload);
  }
}

function getRoomForSocket(runtime, socket, callback) {
  const room = runtime.roomManager.getRoomBySocket(socket.id);
  if (!room) {
    reply(callback, { success: false, error: 'Room not found.' });
    return null;
  }
  return room;
}

// sessionToken -> account, for handlers that act on a signed-in socket.
function resolveAccount(accountStore, socket, payload = {}) {
  const account = accountStore.sessionAccount(payload.sessionToken) || accountStore.getPublicAccountById(socket.data?.accountId);
  if (account) socket.data.accountId = account.id;
  return account;
}

function emitResultMessage(io, room, result) {
  if (!result?.message) return;
  io.in(room.roomCode).emit('system-message', { text: result.message });
}

// The propose/respond relays: when the verb succeeded and carried its offer
// object, notify the opposite seat. field doubles as the emitted payload key.
function relayResultOffer(io, room, result, relay) {
  if (!relay) return;
  if (!result?.success) return;
  const offer = result[relay.field];
  if (!offer) return;
  relayOfferToSeat(io, room, offer, relay);
}

function relayOfferToSeat(io, room, offer, relay) {
  const target = room.game.getPlayerById(offer[relay.recipient]);
  if (!target?.socketId) return;
  io.to(target.socketId).emit(relay.event, { [relay.field]: offer });
}

// One handler from a verb definition: resolve the socket's room, run the
// verb, refresh a live auction, broadcast, relay, ack. Definition shape:
// { verb, args, auctionRefresh?, relay?, message?, ackExtras? }.
function makeRoomVerbHandler(socket, runtime, definition) {
  return function roomVerbHandler(payload = {}, callback) {
    const room = runtime.getRoomForSocket(socket, callback);
    if (!room) return;
    const result = room[definition.verb](socket.id, ...definition.args(payload));
    refreshLiveAuction(runtime, definition, room, result);
    runtime.emitRoomState(room);
    announceVerbResult(runtime.io, room, result, definition);
    reply(callback, roomVerbAck(result, definition.ackExtras));
  };
}

function refreshLiveAuction(runtime, definition, room, result) {
  const needed = definition.auctionRefresh?.(result, room);
  if (!needed) return;
  runtime.scheduleAuctionFinish(room);
}

function announceVerbResult(io, room, result, definition) {
  if (definition.message) emitResultMessage(io, room, result);
  relayResultOffer(io, room, result, definition.relay);
}

// Single scaffold for every socket event. Malformed wire payloads
// (null, strings, numbers) used to reach handler bodies written against
// `payload = {}` defaults — which only guard undefined — and a throw
// inside a socket.io listener escapes to the event emitter and kills
// the whole server. This wrapper normalizes the payload, guarantees a
// callable callback, and converts any synchronous or asynchronous
// handler failure into a logged, ack'd error instead of a crash.
function createSafeEmitter(socket) {
  return function on(event, handler) {
    socket.on(event, (rawPayload, rawCallback) => {
      const payload = normalizeWirePayload(rawPayload);
      const callback = normalizeWireCallback(rawCallback);
      runSocketHandler(handler, payload, callback, event);
    });
  };
}

function runSocketHandler(handler, payload, callback, event) {
  try {
    const result = handler(payload, callback);
    if (!isPromiseLike(result)) return;
    result.catch(error => reportHandlerFailure(callback, event, error));
  } catch (error) {
    reportHandlerFailure(callback, event, error);
  }
}

function reportHandlerFailure(callback, event, error) {
  console.error(`Unhandled error in ${event} handler:`, error);
  failSafely(callback);
}

function failSafely(callback) {
  try {
    callback({ success: false, error: 'The server could not process that request.' });
  } catch {
    // The socket is gone; nothing further to do.
  }
}

function normalizeWirePayload(rawPayload) {
  if (rawPayload && typeof rawPayload === 'object') return rawPayload;
  return {};
}

function normalizeWireCallback(rawCallback) {
  if (typeof rawCallback === 'function') return rawCallback;
  return noop;
}

function noop() {}

function isPromiseLike(result) {
  if (!result) return false;
  return typeof result.catch === 'function';
}

export { createSafeEmitter, emitResultMessage, getRoomForSocket, makeRoomVerbHandler, relayResultOffer, reply, resolveAccount, roomVerbAck };
