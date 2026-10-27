/* ============================================================
   PARLOR PATROL FLAG: the single client-side switch for the Parlor
   Patrol / Night Shift mini-game. Keep it aligned with the server's
   PARLOR_PATROL_ENABLED constant. Kept free of imports so any module,
   and the plain-node
   tests, can read it without pulling in the game's DOM wiring.
   ============================================================ */
export const PARLOR_PATROL_ENABLED = true;

/* Show or hide every Patrol-only element of the static markup. They ship
   with `hidden`, so a disabled build never renders or focuses any of them. */
export function syncParlorPatrolAvailability(root = document) {
  root.querySelectorAll("[data-parlor-patrol]").forEach((element) => {
    element.hidden = !PARLOR_PATROL_ENABLED;
  });
}
