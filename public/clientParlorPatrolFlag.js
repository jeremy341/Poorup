// PARLOR PATROL FLAG: the single client-side switch for the Parlor Patrol / Night Shift mini-game.
// Keep it aligned with the server's PARLOR_PATROL_ENABLED constant. No imports, so any module and
// plain-node tests can read it without pulling in the game's DOM wiring.
// The mini-game is resting while it is being fixed: all Patrol-only markup stays hidden, the
// homepage shows no entry point, and every guarded client path is a no-op. Nothing is deleted.
export const PARLOR_PATROL_ENABLED = false;

/* Show or hide every Patrol-only element of the static markup. They ship
   with `hidden`, so a disabled build never renders or focuses any of them. */
export function syncParlorPatrolAvailability(root = document) {
  root.querySelectorAll("[data-parlor-patrol]").forEach((element) => {
    element.hidden = !PARLOR_PATROL_ENABLED;
  });
}
