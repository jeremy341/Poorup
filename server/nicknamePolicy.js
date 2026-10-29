// Player-visible text policy shared by room nicknames, account display names, chat and notification copy, so every surface strips
// the same hidden characters and counts length the same way. Nicknames become engine feed lines ("<name> wins ..."), so they keep to
// a plain character set, and bot seat names and system labels are reserved so a human cannot wear them.

// Seat names the server gives bots (rooms.js ensureBots). Reserved for humans
// too, so a player cannot make a chat or feed line look like a bot's.
export const LOBBY_BOT_NAMES = Object.freeze([
  'Dice Goblin',
  'Mossy Roll',
  'Penny Arcade',
  'Lady Luck',
  'Coin Flip',
  'Bailiff Bob',
  'Rent Reaper',
  'Tax Goblin',
  'Vault Dweller',
  'Chance Sprite'
]);

const RESERVED_LABELS = ['SYSTEM', 'ADMIN', 'SERVER'];
const RESERVED_KEYS = new Set([...RESERVED_LABELS, ...LOBBY_BOT_NAMES].map(name => name.toLowerCase()));

// Line and paragraph breaks and tabs become spaces so words stay apart.
const BREAK_CHARS_RE = /[\t\n\v\f\r\u0085\u2028\u2029]/g;
// C0 and C1 controls, the Arabic letter mark, zero-width and bidi format
// characters (U+200B-U+200F, U+202A-U+202E, U+2060-U+206F), and the BOM.
const HIDDEN_CHARS_RE = /[\u0000-\u001f\u007f-\u009f\u061c\u200b-\u200f\u202a-\u202e\u2060-\u206f\ufeff]/g;
// Letters, marks, digits, spaces, and a few name punctuation marks only.
const NAME_DISALLOWED_RE = /[^\p{L}\p{M}\p{N} _.'-]/gu;

// Caps a string by code point, so an astral character is never cut in half.
export function sliceCodePoints(value, max) {
  return Array.from(value).slice(0, max).join('');
}

// Compatibility folding (NFKC) runs first so a lookalike is judged on its
// plain form; breaks become spaces, then hidden and bidi characters go.
export function cleanDisplayText(value) {
  if (typeof value !== 'string') return '';
  return value.normalize('NFKC').replace(BREAK_CHARS_RE, ' ').replace(HIDDEN_CHARS_RE, '');
}

// A player-facing name: cleaned, reduced to the plain character set, single
// spaced, then capped by code point.
export function cleanPlayerName(value, max) {
  const plain = cleanDisplayText(value).replace(NAME_DISALLOWED_RE, '').replace(/\s+/g, ' ').trim();
  return sliceCodePoints(plain, max).trim();
}

export function isReservedName(name) {
  return RESERVED_KEYS.has(name.toLowerCase());
}

// The rejection message for a cleaned, non-empty name a seat cannot take at
// this table, or null. The seat itself is excluded so a player may restyle
// their own name; uniqueness is case-insensitive.
export function nicknameRejection(players, name, self = null) {
  if (isReservedName(name)) return 'That nickname is reserved.';
  const key = name.toLowerCase();
  const taken = players.some(player => player !== self
    && typeof player.nickname === 'string'
    && player.nickname.toLowerCase() === key);
  return taken ? 'That nickname is already taken at this table.' : null;
}
