// The shared runtime every socket domain registers against: room state broadcast, the bot, auction, disconnect and inactivity timers,
// the empty-room garbage collector, seat detach and host reassignment, and the invite and cancel flows two domains share. One
// createRuntime() per process: server.js builds the stores and io, then hands them here. Pinned by server/rooms.test.js and server/server.test.js.
// The implementation now lives in the socketRuntime* modules; this barrel keeps the public API identical for every importer.
export { botChatPayload, runRoomTimer, reassignHostIfNeeded } from './socketRuntimeHelpers.js';
export { createRuntime } from './socketRuntimeFactory.js';
