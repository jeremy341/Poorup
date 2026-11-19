// Equity-mode sponsorship books the contract at what the investor actually paid:
// the escrow excess is refunded pro rata, so the ledger amount is net of that
// refund. Invariant: investor's net cash outflow === contract.amount.
import assert from 'node:assert/strict';
import { RoomManager } from './gameLogic.js';

function fixture() {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: 's-buyer', clientId: 'c-buyer', nickname: 'Buyer' });
  room.addOrReconnectPlayer({ socketId: 's-sponsor', clientId: 'c-sponsor', nickname: 'Sponsor' });
  room.addOrReconnectPlayer({ socketId: 's-sponsor-2', clientId: 'c-sponsor-2', nickname: 'Second' });
  room.setRoomSetting('rulesProfile', 'advanced');
  room.setRoomSetting('playerFinance', true);
  assert.equal(room.startGame().success, true);
  const game = room.game;
  const buyer = game.getPlayerBySocket('s-buyer');
  const sponsor = game.getPlayerBySocket('s-sponsor');
  const second = game.getPlayerBySocket('s-sponsor-2');
  const tile = game.getTile(1);
  buyer.cash = 20;
  sponsor.cash = 500;
  second.cash = 500;
  game.currentPlayerId = buyer.id;
  game.hasRolled = true;
  game.pendingPurchaseOffer = { playerId: buyer.id, tileIndex: tile.index };
  return { game, buyer, sponsor, second, tile };
}

function equityContract(game) {
  return game.playerContracts.find(contract => contract.kind === 'equity');
}

// No excess: the contract books the full contribution.
{
  const { game, buyer, sponsor, tile } = fixture();
  assert.equal(game.requestPurchaseSponsorship('s-buyer', { mode: 'equity', sharePct: 25 }).success, true);
  const needed = tile.price - buyer.cash;
  assert.equal(game.contributeToSponsoredPurchase('s-sponsor', { amount: needed }).success, true);
  assert.equal(game.acceptSponsoredPurchase('s-buyer').success, true);
  const contract = equityContract(game);
  assert.equal(contract.amount, needed);
  assert.equal(500 - sponsor.cash, contract.amount);
}

// Excess refunded to the single investor: the ledger is net, not gross.
{
  const { game, buyer, sponsor, tile } = fixture();
  assert.equal(game.requestPurchaseSponsorship('s-buyer', { mode: 'equity', sharePct: 25 }).success, true);
  const contribution = tile.price - buyer.cash;
  assert.equal(game.contributeToSponsoredPurchase('s-sponsor', { amount: contribution }).success, true);
  buyer.cash += 30;
  assert.equal(game.acceptSponsoredPurchase('s-buyer').success, true);
  const contract = equityContract(game);
  assert.equal(contract.amount, contribution - 30);
  assert.equal(500 - sponsor.cash, contract.amount);
  assert.equal(buyer.cash, 0);
}

// Replaying the accept after settlement returns the memo and books nothing twice.
{
  const { game, buyer, sponsor, tile } = fixture();
  assert.equal(game.requestPurchaseSponsorship('s-buyer', { mode: 'equity', sharePct: 25 }).success, true);
  assert.equal(game.contributeToSponsoredPurchase('s-sponsor', { amount: tile.price - buyer.cash }).success, true);
  buyer.cash += 10;
  const first = game.acceptSponsoredPurchase('s-buyer', { requestId: 'accept-1' });
  assert.equal(first.success, true);
  const cashAfter = sponsor.cash;
  const replay = game.acceptSponsoredPurchase('s-buyer', { requestId: 'accept-1' });
  assert.equal(replay.success, true);
  assert.equal(game.playerContracts.filter(contract => contract.kind === 'equity').length, 1);
  assert.equal(sponsor.cash, cashAfter);
}

console.log('sponsorship equity net booking: 3 scenarios passed');
