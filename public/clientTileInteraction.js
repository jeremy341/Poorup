/** Corner spaces are display-only; board actions live on the game controls. */
export function tileSupportsInspection(tile) {
  return !String(tile?.kind || "").startsWith("corner-");
}
