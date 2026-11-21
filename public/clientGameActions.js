// Game actions: turn intents, primary action routing, and deed purchase emits.
import { $ } from "./clientDom.js";
import { state } from "./clientState.js";
import { TILES } from "./clientBoardData.js";
import { presentPurchaseChoice } from "./clientGameModalsUi.js";
import { closePopup } from "./clientPopupUi.js";
import { emitIntent } from "./clientRequestController.js";
import { playSound } from "./clientSfx.js";

let host = null;

// DOM/timer/emit hooks stay owned by the entry module.
export function configureGameActions(deps) {
  host = deps;
}

function isLocalPlayerBlocked() {
  const localPlayer = state.players[0];
  return Boolean(localPlayer?.bankrupt || localPlayer?.spectating);
}

function canActForStage(idx, expectedStage) {
  if (state.phase !== "playing" || isLocalPlayerBlocked()) return false;
  if (state.turnIndex !== idx || state.busy || state.presentationBusy) return false;
  return state.turnStage === expectedStage;
}

export function createTurnRequest(kind) {
  const requestId = host.createRequestId(kind);
  state.pendingAction = { kind, requestId };
  return requestId;
}

function executeTurnEmit({ kind, requestId, event, errorMessage, timeoutMessage }) {
  const statusNode = host.captureActionStatusNode();
  host.renderHud();
  let settled = false;
  const finish = () => {
    if (state.pendingAction?.requestId !== requestId) return;
    state.pendingAction = null;
    state.busy = false;
    if (kind === "roll" && !state.presentationBusy) state.rolling = false;
  };
  const timeout = setTimeout(() => {
    if (settled) return;
    settled = true;
    finish();
    host.announceActionStatus(timeoutMessage, statusNode);
    host.renderAll();
  }, 8000);
  host.emitServer(event, { requestId }, (response) => {
    if (settled) return;
    settled = true;
    clearTimeout(timeout);
    finish();
    host.reportChatError(response, errorMessage, statusNode);
    host.renderAll();
  });
}

export async function runTurn(idx) {
  if (!canActForStage(idx, "roll")) return;
  state.busy = true;
  state.rolling = true;
  playSound("rattle");
  const requestId = createTurnRequest("roll");
  executeTurnEmit({
    kind: "roll",
    requestId,
    event: "roll-dice",
    errorMessage: "The roll could not be completed.",
    timeoutMessage: "Roll could not be confirmed. Try again.",
  });
}

export function endTurn(idx) {
  if (!canActForStage(idx, "end")) return;
  state.busy = true;
  const requestId = createTurnRequest("end-turn");
  executeTurnEmit({
    kind: "end-turn",
    requestId,
    event: "end-turn",
    errorMessage: "The turn could not be ended.",
    timeoutMessage: "The turn could not be confirmed. Try again.",
  });
}

function mustResolveAcquisition() {
  return Boolean(state.auction || state.pendingBuyTile != null || state.sponsorship);
}

function canUsePrimaryTurnAction() {
  if (state.phase !== "playing") return false;
  if (isLocalPlayerBlocked()) return false;
  if (state.busy || state.presentationBusy) return false;
  return state.turnIndex === 0;
}

function openPendingPurchaseChoice() {
  if (state.pendingBuyTile == null) return false;
  const tile = TILES[state.pendingBuyTile];
  if (!tile) return true;
  presentPurchaseChoice(tile);
  return true;
}

/* A live auction whose card was dismissed is reopened from the HUD button
   (labelled "Resolve Auction"); any seated player may bid, turn or not. */
function reopenDismissedAuction() {
  if (!state.auction || state.phase !== "playing") return false;
  const me = state.players[0];
  if (me?.bankrupt || me?.spectating) return false;
  if (!$("#auction-modal").classList.contains("is-hidden")) return true;
  host.serverSyncHost.openAuctionSurface();
  return true;
}

export function primaryTurnAction() {
  if (reopenDismissedAuction()) return;
  if (!canUsePrimaryTurnAction()) return;
  if (openPendingPurchaseChoice()) return;
  if (mustResolveAcquisition()) return;
  if (state.turnStage === "end") endTurn(0);
  else runTurn(0);
}

export function startGame() {
  host.emitWithChatError("start-game", {}, "Only the host can start the game.");
}

// Same start-game event as the lobby button, with the ack handed back so solo
// auto-start can report a refusal instead of failing silently.
export function startRound(onResult) {
  host.emitServer("start-game", {}, (response) => onResult?.(response));
}

export function buyTile(tile, submittedStatusNode = null, onSuccess = null) {
  if (tile?.i == null) return;
  const statusNode = submittedStatusNode || host.captureActionStatusNode();
  // One BUY per intent: a double click / Enter repeat must not double-charge.
  emitIntent(host.emitServer, `purchase-property:${tile.i}`, "purchase-property", { tileIndex: tile.i }, {
    onResponse: (response) => {
      host.reportChatError(response, "That deed is no longer available.", statusNode);
      if (response?.success === false) return;
      if (onSuccess) {
        onSuccess();
        closePopup();
      }
      else {
        state.pendingBuyTile = null;
        $("#choice-modal")?.classList.add("is-hidden");
        closePopup();
      }
    },
    onTimeout: () => host.announceActionStatus("The purchase could not be confirmed. Try again.", statusNode),
  });
}
