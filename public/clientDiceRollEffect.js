export function createDiceRollSequenceTracker(onRoll = () => {}) {
  let roomCode = null;
  let sequence = null;

  return {
    receive(snapshot = {}) {
      const nextRoom = String(snapshot.roomCode || "");
      const nextSequence = Number(snapshot.sequence);
      if (!Number.isSafeInteger(nextSequence) || nextSequence < 0) return null;

      if (roomCode !== nextRoom || sequence === null) {
        roomCode = nextRoom;
        sequence = nextSequence;
        return null;
      }

      if (nextSequence <= sequence) return null;
      sequence = nextSequence;

      const dice = snapshot.dice;
      if (!Array.isArray(dice) || dice.length !== 2
        || !dice.every(face => Number.isInteger(face) && face >= 1 && face <= 6)) return null;

      const total = dice[0] + dice[1];
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
