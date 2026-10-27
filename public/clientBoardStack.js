/* ============================================================
   BOARD TOKEN STACKING: where pieces sit on a shared tile.
   Pure geometry so it can be unit-tested without a DOM.
   ============================================================ */

export const DEFAULT_STACK_OFFSETS = Object.freeze([
  Object.freeze({ x: 0, y: 0 }),
  Object.freeze({ x: 11, y: -8 }),
  Object.freeze({ x: -11, y: 8 }),
  Object.freeze({ x: 11, y: 8 }),
]);

/** Offset of piece `idx` in a stack of `count` on an ordinary tile. */
export function defaultStackOffset(count, idx) {
  if (count <= 1) return { x: 0, y: 0 };
  const off = DEFAULT_STACK_OFFSETS[idx];
  return off ? { x: off.x, y: off.y } : { x: 0, y: 0 };
}

/**
 * F-080: on the Start corner the tokens must stay clear of the COLLECT / $200
 * caption. They are packed into the band between the tile's top edge and the
 * caption, overlapping each other (not the caption) when the band is short.
 * All numbers are px relative to the tile centre. `captionTop` is the caption's
 * top edge relative to the tile centre.
 */
export function startTileStackOffset({ count, idx, tileWidth, tileHeight, captionTop, pieceSize }) {
  const n = Math.max(1, Math.floor(count) || 1);
  const size = Math.max(8, pieceSize || 26);
  const top = -tileHeight / 2 + 2;
  const bottom = Math.min(captionTop - 2, tileHeight / 2 - 2);
  const bandHeight = Math.max(size, bottom - top);
  const centerY = top + bandHeight / 2;
  if (n === 1) return { x: 0, y: Math.round(centerY) };
  const cols = 2;
  const rows = Math.ceil(n / cols);
  const pitchX = Math.min(size + 2, Math.max(4, tileWidth - 4 - size));
  const pitchY = rows > 1 ? Math.min(size, Math.max(0, (bandHeight - size) / (rows - 1))) : 0;
  const col = idx % cols;
  const row = Math.floor(idx / cols);
  const rowsInThisRow = row === rows - 1 ? n - row * cols : cols;
  const x = rowsInThisRow === 1 ? 0 : (col === 0 ? -pitchX / 2 : pitchX / 2);
  const y = centerY + (row - (rows - 1) / 2) * pitchY;
  return { x: Math.round(x), y: Math.round(y) };
}
