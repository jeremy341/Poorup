// The dice-roll entry point on GameState (rollDice) and the wrapper that records the roll for presentation.
// Turn bookkeeping after the roll is gameTurns.js; the replay timeline itself is gamePresentation.js.
import { rollDice } from './gameData.js';
import { recordPresentationMovement, withRollPresentation } from './gamePresentation.js';

const DOUBLES_BEFORE_JAIL = 3;

function resolveDiceRoll(game, player) {
  if (player.inJail) return game.handleJailRoll(player);
  if (game.hasRolled && !game.extraRollPending) return { success: false, error: 'You have already rolled this turn.' };

  const dice = rollDice();
  game.setTurnDice(dice);
  if (game.consecutiveDoubles >= DOUBLES_BEFORE_JAIL) return game.sendRollerToJail(player);

  const move = dice[0] + dice[1];
  game.feedMessage(`${player.nickname} rolled ${dice[0]} and ${dice[1]} (${move}).`);
  return game.movePlayer(player, move);
}

export const gamePresentationApi = {
  rollDice(socketId) {
    const player = this.getPlayerBySocket(socketId);
    const rejection = this.rollTurnRejection(player);
    if (rejection) return rejection;
    return withRollPresentation(this, player, () => resolveDiceRoll(this, player));
  },

  recordPresentationMove(player, destination, options) {
    recordPresentationMovement(this, player, destination, options);
  },
};
