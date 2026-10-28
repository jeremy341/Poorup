// A bot counter asks the original proposer for the ask plus a premium. The server refuses a counter whose
// requested cash the proposer does not hold (tradeApi 'One of the players no longer has enough cash.'), so the bot
// must not build one; it would burn the action and fall back to a decline.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';
import { counterTradeOffer } from './botCandidates.js';
import { clearingTradeCounter } from './advisorLogic.js';

function fixture() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 'sA', clientId: 'cA', nickname: 'A', roomCode: 'CNTCSH' });
  room.setRoomSetting('bots', 1);
  assert.equal(room.startGame().success, true);
  const game = room.game;
  const bot = game.players.find(player => player.isBot);
  const human = game.players.find(player => !player.isBot);
  game.players.forEach(player => { player.properties = []; player.cash = 1500; });
  game.currentPlayerId = bot.id;
  return { game, bot, human };
}

function pendingToBot(game, bot, human, terms) {
  game.pendingTrade = {
    id: 'counter-cash-trade',
    fromPlayerId: human.id,
    toPlayerId: bot.id,
    counterDepth: 0,
    giveCash: 0,
    requestCash: 0,
    givePropertyIndexes: [],
    requestPropertyIndexes: [],
    ...terms,
  };
}

{
  const { game, bot, human } = fixture();
  game.getTile(6).ownerId = bot.id;
  bot.properties.push(6);
  pendingToBot(game, bot, human, { giveCash: 90, requestPropertyIndexes: [6] });
  const affordable = counterTradeOffer(game, bot, 10);
  assert.ok(affordable, 'a counter the proposer can pay is still built');
  assert.equal(affordable.requestCash, 100);
  human.cash = 99;
  assert.equal(counterTradeOffer(game, bot, 10), null, 'a counter asking more cash than the proposer holds is not built');
  human.cash = 100;
  assert.ok(counterTradeOffer(game, bot, 10), 'exactly the proposer cash is enough');
}

{
  // The advisor escalates the premium; it must stop at what the proposer holds
  // instead of returning a counter the server will refuse.
  const { game, bot, human } = fixture();
  game.getTile(6).ownerId = bot.id;
  bot.properties.push(6);
  pendingToBot(game, bot, human, { giveCash: 40, requestPropertyIndexes: [6] });
  human.cash = 60;
  const counter = clearingTradeCounter(game, bot);
  if (counter) assert.ok(counter.requestCash <= human.cash, 'any counter the advisor offers is payable by the proposer');
}

{
  // A deed named by an open trade or contract cannot be managed: the engine
  // refuses it (propertyApi.propertyOpenOfferRejection), so the finance
  // candidates must not offer it either.
  const { game, bot, human } = fixture();
  const tile = game.getTile(6);
  tile.ownerId = bot.id;
  bot.properties.push(6);
  bot.cash = 100;
  game.pendingTrade = {
    id: 'open-trade',
    fromPlayerId: human.id,
    toPlayerId: bot.id,
    counterDepth: 0,
    giveCash: 0,
    requestCash: 0,
    givePropertyIndexes: [],
    requestPropertyIndexes: [6]
  };
  const mortgages = game.botMortgageCandidates(bot);
  assert.equal(mortgages.some(candidate => candidate.tileIndex === 6), false, 'a deed named by an open trade is not offered for mortgage');
  game.pendingTrade = null;
  assert.equal(game.botMortgageCandidates(bot).some(candidate => candidate.tileIndex === 6), true, 'a free deed is offered again');
}

{
  const { game, bot, human } = fixture();
  const tile = game.getTile(8);
  tile.ownerId = bot.id;
  tile.houseCount = 2;
  bot.properties.push(8);
  bot.cash = 100;
  assert.equal(game.botSellCandidates(bot).some(candidate => candidate.tileIndex === 8), true, 'the house is offered for sale');
  game.pendingPlayerContract = {
    id: 'open-contract',
    kind: 'loan',
    fromPlayerId: human.id,
    toPlayerId: bot.id,
    amount: 100,
    premiumRate: 0,
    durationRounds: 3,
    propertyIndex: null,
    collateralTileIndex: 8,
    counterDepth: 0
  };
  assert.equal(game.botSellCandidates(bot).some(candidate => candidate.tileIndex === 8), false, 'a deed pledged by an open contract is not offered for sale');
}

console.log('bot counter cash: 4 scenarios passed');
