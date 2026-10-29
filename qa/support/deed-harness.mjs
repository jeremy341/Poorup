import assert from 'node:assert/strict';
import path from 'node:path';
import { mkdir } from 'node:fs/promises';
import { expect } from '@playwright/test';
import { RoomManager } from '../../server/gameLogic.js';
import { captureScreenshot } from '../visual-capture/screenshot.mjs';

// Shared fixtures for the deed specs: a finished game room, the client wired to it, and the screenshot helpers.

export function createRoom(prefix, players = 2, settings = {}) {
  const manager = new RoomManager();
  const room = manager.createRoom({ socketId: `${prefix}-host`, clientId: `${prefix}-host-client`, nickname: 'HOST' });
  for (let index = 1; index < players; index += 1) {
    room.addOrReconnectPlayer({ socketId: `${prefix}-guest-${index}`, clientId: `${prefix}-guest-client-${index}`, nickname: `GUEST ${index}` });
  }
  for (const [key, value] of Object.entries(settings)) assert.equal(room.setRoomSetting(key, value).rejected, false);
  assert.equal(room.startGame().success, true);
  return room;
}

export function finishedSnapshot(room, viewer) {
  return JSON.parse(JSON.stringify({
    room: room.getRoomSummary(viewer.id),
    game: room.game.getGameSummary(viewer.id),
  }));
}

export async function captureState(page, testInfo, surfaceId, label) {
  if (!process.env.POORUP_VISUAL_CAPTURE_DIR) return;
  await captureScreenshot(page, testInfo, { group: 'game', surfaceId, label });
  if (await page.locator('#gameover-modal').isVisible()) {
    const target = path.join(path.resolve(process.env.POORUP_VISUAL_CAPTURE_DIR), testInfo.project.name, 'game', `${surfaceId}.detail.png`);
    await mkdir(path.dirname(target), { recursive: true });
    await page.locator('#gameover-card').screenshot({ path: target, animations: 'disabled' });
  }
}

export async function captureDeedDetail(page, testInfo, fileName) {
  const root = process.env.POORUP_VISUAL_CAPTURE_DIR;
  if (!root) return;
  const detailPath = path.join(path.resolve(root), testInfo.project.name, 'game', fileName);
  await mkdir(path.dirname(detailPath), { recursive: true });
  await page.locator('#deed-card-detail').screenshot({ path: detailPath, animations: 'disabled' });
}

export async function openDeedDetail(page, index) {
  await page.evaluate(i => window.__deedTruthHarness.deeds.openDeedDetail(i), index);
}

export async function installFinishedRoom(page, room, viewer, propertyBridge = null) {
  await installClient(page, finishedSnapshot(room, viewer), propertyBridge);
}

export async function expectNoPageScroll(page) {
  expect(await page.evaluate(() => document.documentElement.scrollHeight - innerHeight)).toBeLessThanOrEqual(1);
}

export async function captureDeedSurface(page, testInfo, surfaceId, label, fileName) {
  await captureState(page, testInfo, surfaceId, label);
  await captureDeedDetail(page, testInfo, fileName);
}

export function grantDeeds(game, owner, indexes) {
  for (const index of indexes) {
    const tile = game.getTile(index);
    tile.ownerId = owner.id; tile.purchasePricePaid = tile.price; owner.properties.push(index);
  }
}

export async function expectTradeFitsCard(page) {
  const geometry = await page.locator('#trade-card').evaluate(card => {
    const box = card.getBoundingClientRect();
    const body = card.querySelector('.trade-body').getBoundingClientRect();
    return { width: card.clientWidth, scrollWidth: card.scrollWidth,
      bodyLeft: body.left - box.left, bodyRight: body.right - box.right };
  });
  expect(geometry.scrollWidth, 'trade content must fit inside its card horizontally').toBeLessThanOrEqual(geometry.width + 1);
  expect(geometry.bodyLeft, 'trade body left edge stays inside the card').toBeGreaterThanOrEqual(0);
  expect(geometry.bodyRight, 'trade body right edge stays inside the card').toBeLessThanOrEqual(0);
}

export async function installClient(page, snapshot, propertyBridge = null) {
  await page.goto('/');
  await page.evaluate(async ({ initialSnapshot, usePropertyBridge }) => {
    const [{ state }, sync, modals, deeds, board, popup, hud, rail, topNav, sprites, dom, trades] = await Promise.all([
      import('/clientState.js'), import('/clientStateSync.js'), import('/clientGameModalsUi.js'),
      import('/clientDeedDetailUi.js'), import('/clientBoardRender.js'), import('/clientPopupUi.js'),
      import('/clientHudRender.js'), import('/clientRailRender.js'), import('/clientTopNavRender.js'),
      import('/clientSprites.js'), import('/clientDom.js'), import('/clientTradeUi.js'),
    ]);
    Object.assign(state, { clientId: initialSnapshot.game.players.find(player => player.clientId)?.clientId || '', phase: 'home' });
    document.querySelector('#view-home').classList.add('is-hidden');
    document.querySelector('#view-game').classList.remove('is-hidden');
    board.buildBoard(popup.onTileClick);
    const renderAll = () => {
      board.renderBoardState(); hud.renderHud(); rail.renderRightRail(); topNav.renderTopNav();
      document.querySelector('#player-list').innerHTML = state.players.map((player, index) =>
        `<button class="player-row player-row-action" type="button" data-player-id="${dom.esc(player.serverId || player.id)}"><div class="pr-av">${sprites.avatarHTML(player, 4, index)}</div><div class="pr-mid"><div class="pr-nameline"><span class="pr-name">${dom.esc(player.name)}</span></div><div class="pr-cash">$${Number(player.cash).toLocaleString()}</div></div></button>`,
      ).join('');
      deeds.renderDeedDetail();
    };
    modals.configureGameModals({ renderAll, startGame() {} });
    const actionHooks = {
      async emitServer(event, payload, ack) {
        if (!usePropertyBridge) return;
        const result = await window.__deedTruthAction(event, payload);
        sync.applyServerState(result.snapshot, syncHost);
        ack?.(result.response);
      },
      renderAll,
      createRequestId: () => `truth-trade-${Date.now()}`,
    };
    deeds.configureDeedDetail(actionHooks);
    trades.configureTradeUi(actionHooks);
    const syncHost = {
      setConnectionStatus() {}, gameViewVisible: () => true, showView() {}, renderAll,
      showGameOver: modals.showGameOver,
      placePiecesSoon() {}, startPieceWalk: () => Promise.resolve(),
      retireButton: () => null, bankruptcyHidden: () => true,
      hideBankruptcyModal() {}, openBankruptcyModal() {},
      closeAuctionSurface() {}, openAuctionSurface() {},
      startTurnCountdown() {}, syncOfferSurface() {},
      announceDiceRoll() {}, setBoardVariant() {}, rebuildBoard() {},
    };
    window.__deedTruthHarness = { state, sync, deeds, trades, renderAll, syncHost };
    sync.applyServerState(initialSnapshot, syncHost);
  }, { initialSnapshot: snapshot, usePropertyBridge: Boolean(propertyBridge) });
}
