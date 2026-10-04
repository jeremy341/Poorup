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

export function showDiceRollTotal(total) {
  const boardArea = document.querySelector("#view-game .board-area");
  if (!boardArea) return;

  let announcement = boardArea.querySelector(".dice-roll-total");
  if (!announcement) {
    announcement = document.createElement("div");
    announcement.className = "dice-roll-total";
    announcement.setAttribute("role", "status");
    announcement.setAttribute("aria-live", "polite");
    boardArea.append(announcement);
  }

  window.clearTimeout(hideTimer);
  announcement.textContent = String(total);
  announcement.setAttribute("aria-label", `Dice total: ${total}`);
  announcement.classList.remove("is-visible");
  void announcement.offsetWidth;
  announcement.classList.add("is-visible");
  hideTimer = window.setTimeout(() => announcement.classList.remove("is-visible"), 1900);
}
