// FINANCING: equity-share transfer form, payload and payload/controls helpers.
import { isRentShare, playerFinanceEnabled } from "./clientFinanceRules.js";
import { state } from "./clientState.js";
import { financingActiveContracts, otherPlayers } from "./clientFinancingState.js";
import { financingMyServerId, host } from "./clientDealHost.js";
import { esc } from "./clientDom.js";
export function financingTransferComposerHTML(tile, shares) {
  if (!playerFinanceEnabled(state.settings)) return "";
  shares = shares.filter(entry => !isRentShare(financingActiveContracts().find(contract => contract.id === entry.contractId)) && Number(entry.rentShareVersion) !== 1);
  const localId = financingMyServerId();
  const buyers = otherPlayers();
  if (!localId || !buyers.length) return "";
  return shares.filter(entry => String(entry.holderId) === String(localId) && entry.contractId)
    .map(entry => {
      const available = Math.max(0, Math.floor(Number(entry.share) || 0));
      const controls = equityTransferControlsHTML(available);
      if (!controls) return "";
      return `<details class="equity-transfer-composer"><summary><span class="t-label f11 g-muted">TRANSFER YOUR ${esc(tile.name)} SHARE · ${available}% AVAILABLE</span></summary><p class="t-micro ink-3">The buyer receives passive rights for the share's remaining duration. Nothing moves until the offer is accepted.</p><form data-equity-transfer-form data-contract-id="${esc(entry.contractId)}" data-tile-index="${tile.i}"><label class="financing-field"><span class="t-label f11 g-muted">BUYER</span><select class="field" name="toPlayerId" required><option value="">SELECT A PLAYER</option>${buyers.map(player => `<option value="${esc(player.serverId || player.id)}">${esc(player.name)}</option>`).join("")}</select></label>${controls}<button class="btn-dark" type="submit"><span class="t-label f11">SEND TRANSFER OFFER</span></button></form></details>`;
    }).join("");
}

export function equityTransferControlsHTML(availableShare) {
  const available = Math.floor(Number(availableShare) || 0);
  if (available < 5) return "";
  return `<label class="financing-field"><span class="t-label f11 g-muted">SHARE TO TRANSFER (%)</span><input class="field" type="number" name="sharePct" min="5" max="${available}" step="1" value="${Math.min(10, available)}" required></label><label class="financing-field"><span class="t-label f11 g-muted">PRICE ($)</span><input class="field" type="number" name="price" min="1" step="1" value="1" required></label>`;
}

export function equityTransferPayload({ fromPlayerId, toPlayerId, contractId, sharePct, price, requestId }) {
  return {
    fromPlayerId,
    toPlayerId,
    contractId,
    sharePct: Math.max(1, Math.floor(Number(sharePct) || 0)),
    price: Math.max(0, Math.floor(Number(price) || 0)),
    requestId,
  };
}

export function equityTransferFormValid(form, sharePct, maxShare, price) {
  if (!form.reportValidity()) return false;
  if (sharePct < 5) return false;
  if (sharePct > maxShare) return false;
  return price >= 1;
}

export function equityTransferRequestId() {
  if (typeof host.createRequestId === "function") return host.createRequestId("equity-transfer");
  return `equity-transfer-${Date.now().toString(36)}`;
}

export function setNodeDisabled(node, disabled) {
  if (node) node.disabled = disabled;
}
