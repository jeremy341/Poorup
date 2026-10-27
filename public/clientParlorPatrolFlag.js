/* ============================================================
   PARLOR PATROL FLAG: the single client-side switch for the Parlor
   Patrol / Night Shift mini-game. Owner decision (audit F-059): the
   feature is switched off, not removed. Flip this constant (and the
   server constant PARLOR_PATROL_ENABLED in server/accountStore.js) to
   bring it back. Kept free of imports so any module, and the plain-node
   tests, can read it without pulling in the game's DOM wiring.
   ============================================================ */
export const PARLOR_PATROL_ENABLED = false;

/* Show or hide every Patrol-only element of the static markup. They ship
   with `hidden`, so a disabled build never renders or focuses any of them. */
export function syncParlorPatrolAvailability(root = document) {
  root.querySelectorAll("[data-parlor-patrol]").forEach((element) => {
    element.hidden = !PARLOR_PATROL_ENABLED;
  });
}
