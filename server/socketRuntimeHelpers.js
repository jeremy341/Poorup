// Dependency-free helpers the socket runtime re-exports and its domains share.

import { ensureRoomHost } from './roomSeat.js';
import { normalizeChatText } from './roomSetup.js';

// Table talk from a bot is player text, so it takes the same cleaning as a
// human message before it reaches the room. Text that is empty after cleaning
// is not sent.
export function botChatPayload(bot, botChat) {
  const text = normalizeChatText(botChat);
  if (!text) return null;
  return { text, nickname: bot.nickname, senderId: bot.id, bot: true };
}

// Room-local timer failures must not escape into the process-level exception
// path. Keep the wrapper dependency-free so each timer callback remains easy
// to test and teardown.
export function runRoomTimer(label, roomCode, callback, onError = console.error) {
  try {
    callback();
    return true;
  } catch (error) {
    try { onError(error, { label, roomCode }); } catch { /* logging must not throw */ }
    return false;
  }
}

export function reassignHostIfNeeded(room, departedPlayerId) {
  if (!room) return;
  if (room.hostId !== departedPlayerId) return;
  ensureRoomHost(room, departedPlayerId);
}
