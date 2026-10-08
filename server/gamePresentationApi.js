import { rollDice } from './gameData.js';
import { recordPresentationMovement, withRollPresentation } from './gamePresentation.js';

function resolveDiceRoll(game, player) {
  if (player.inJail) return game.handleJailRoll(player);
  if (game.hasRolled && !game.extraRollPending) return { success: false, error: 'You have already rolled this turn.' };

  const dice = rollDice();
  game.setTurnDice(dice);
  if (game.consecutiveDoubles >= 3) return game.sendRollerToJail(player);

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
