function readSequence(snapshot) {
  const sequence = Number(snapshot.sequence);
  return Number.isSafeInteger(sequence) && sequence >= 0
    ? { roomCode: String(snapshot.roomCode || ''), sequence }
    : null;
}

function validDieFace(face) {
  return Number.isInteger(face) && face >= 1 && face <= 6;
}

function readDiceTotal(dice) {
  if (!Array.isArray(dice) || dice.length !== 2 || !dice.every(validDieFace)) return null;
  return dice[0] + dice[1];
}

function advanceRollSequence(next, current) {
  if (current.roomCode !== next.roomCode || current.sequence === null) {
    current.roomCode = next.roomCode;
    current.sequence = next.sequence;
    return false;
  }
  if (next.sequence <= current.sequence) return false;
  current.sequence = next.sequence;
  return true;
}

function announceRoll(dice, onRoll) {
  const total = readDiceTotal(dice);
  if (total === null) return null;
  onRoll(total);
  return total;
}

export function createDiceRollSequenceTracker(onRoll = () => {}) {
  const current = { roomCode: null, sequence: null };

  return {
    receive(snapshot = {}) {
      const next = readSequence(snapshot);
      if (!next || !advanceRollSequence(next, current)) return null;
      return announceRoll(snapshot.dice, onRoll);
    },
  };
}

let hideTimer = null;
const LIVE_REGION_REGISTER_MS = 60;

export function showDiceRollTotal(total) {
  const boardArea = document.querySelector("#view-game .board-area");
  if (!boardArea) return;

  let announcement = boardArea.querySelector(".dice-roll-total");
  let created = false;
  if (!announcement) {
    announcement = document.createElement("div");
    announcement.className = "dice-roll-total";
    announcement.setAttribute("role", "status");
    announcement.setAttribute("aria-live", "polite");
    boardArea.append(announcement);
    created = true;
  }

  window.clearTimeout(hideTimer);
  // A live region that is created and filled in the same tick is often never registered by the
  // screen reader, so the first roll of a session would be silent. Give a fresh region one beat to
  // register before its content changes; an existing region updates immediately.
  const reveal = () => {
    announcement.textContent = String(total);
    announcement.setAttribute("aria-label", `Dice total: ${total}`);
    announcement.classList.remove("is-visible");
    void announcement.offsetWidth;
    announcement.classList.add("is-visible");
    // The 900ms review hold matches the CSS `dice-total-review` animation and its
    // test pin: the total stays through the opening of the walk, then clears.
    hideTimer = window.setTimeout(() => announcement.classList.remove("is-visible"), 900);
  };
  if (created) hideTimer = window.setTimeout(reveal, LIVE_REGION_REGISTER_MS);
  else reveal();
}
