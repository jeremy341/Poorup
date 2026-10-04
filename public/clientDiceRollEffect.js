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

export function createDiceRollSequenceTracker(onRoll = () => {}) {
  let roomCode = null;
  let sequence = null;

  return {
    receive(snapshot = {}) {
      const next = readSequence(snapshot);
      if (!next) return null;

      if (roomCode !== next.roomCode || sequence === null) {
        roomCode = next.roomCode;
        sequence = next.sequence;
        return null;
      }

      if (next.sequence <= sequence) return null;
      sequence = next.sequence;

      const total = readDiceTotal(snapshot.dice);
      if (total === null) return null;
      onRoll(total);
      return total;
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
