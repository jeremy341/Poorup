/* ============================================================
   AIRPORT FLIGHTS: the flight desk dialog, the FLY button's visibility
   rule, and the owner's fee steppers. The server prices every flight, so
   this module only renders the options it receives (state.flights) and
   sends two actions: fly-to-airport and set-airport-fees.
   ============================================================ */
import { $, esc } from "./clientDom.js";
import { state } from "./clientState.js";
import { closeSurface, openSurface, setSurfaceReturnFocus } from "./clientSurfaces.js";
import { emitWithTimeout } from "./clientRequestController.js";
import { closeButtonHTML } from "./clientCloseButton.js";

const FEE_STEP = 10;

let host = { emitServer: noop, renderAll: noop, notice: noop };
let selectedTile = null;
let booking = false;

function noop() {}

export function configureFlightUi(hooks) {
  host = { ...host, ...hooks };
}

function flights() {
  return state.flights || { enabled: false, defaultFare: 100, maxFee: 200, options: [] };
}

function money(amount) {
  return `$${Number(amount || 0).toLocaleString()}`;
}

function serverTile(index) {
  return state.serverTiles.find(entry => Number(entry.index) === Number(index)) || null;
}

function playerByServerId(serverId) {
  return state.players.find(player => player.serverId === serverId) || null;
}

/** True when the local player may book a flight right now (server-decided). */
export function canFlyNow() {
  return flights().enabled && flights().options.length > 0;
}

function originTile() {
  return serverTile(state.players[0]?.pos);
}

const BASIS_LABEL = { arrival: "ARRIVAL FEE", departure: "DEPARTURE FEE", default: "STANDARD FARE" };

function ownerLine(option) {
  const owner = option.payeeId ? playerByServerId(option.payeeId) : null;
  if (!owner) return "BANK";
  return owner === state.players[0] ? "YOU" : owner.name;
}

function defaultSelection(options) {
  const stillValid = options.find(option => option.tileIndex === selectedTile && option.affordable);
  if (stillValid) return stillValid.tileIndex;
  const cheapest = options.filter(option => option.affordable).sort((a, b) => a.fare - b.fare || a.tileIndex - b.tileIndex)[0];
  return cheapest ? cheapest.tileIndex : null;
}

function optionRowHTML(option) {
  const tile = serverTile(option.tileIndex);
  const selected = option.tileIndex === selectedTile;
  const price = option.fare === 0 ? "FREE" : money(option.fare);
  const need = option.affordable ? "" : `<span class="t-micro red">CAN'T AFFORD</span>`;
  return `<button class="flight-row${selected ? " is-selected" : ""}" type="button" role="radio" aria-checked="${selected}" data-flight-tile="${option.tileIndex}" ${option.affordable ? "" : "disabled"}>
      <span class="flight-row-main"><span class="t-label f13 g100">${esc(tile?.name || `AIRPORT ${option.tileIndex}`)}</span><span class="t-micro ink-3">${esc(BASIS_LABEL[option.basis] || "FARE")} · ${esc(ownerLine(option))}</span></span>
      <span class="flight-row-price">${need}<strong class="t-label f16 ${option.fare === 0 ? "green" : "g100"}">${price}</strong></span>
    </button>`;
}

function renderFlightDesk() {
  const card = $("#flight-card");
  if (!card) return;
  const { options } = flights();
  selectedTile = defaultSelection(options);
  const chosen = options.find(option => option.tileIndex === selectedTile) || null;
  const origin = originTile();
  const body = options.length
    ? `<div class="flight-list" role="radiogroup" aria-label="Destination airport">${options.map(optionRowHTML).join("")}</div>`
    : `<p class="t-body ink-2 flight-empty">No flights are available right now.</p>`;
  const label = chosen ? (chosen.fare === 0 ? "FLY · FREE" : `FLY · ${money(chosen.fare)}`) : "PICK AN AIRPORT";
  card.innerHTML = `<div class="flight-body">
      <div class="flight-head">
        <div><span class="t-micro g400">FLIGHT DESK</span><h2 class="t-section g100" id="flight-card-title">Fly from ${esc(origin?.name || "this airport")}</h2></div>
        ${closeButtonHTML({ id: "flight-close", label: "Close flight desk" })}
      </div>
      ${body}
      <button class="cta-red flight-go" id="flight-go" type="button" ${chosen && !booking ? "" : "disabled"}><span class="cta-text cta-text-sm">${booking ? "BOOKING…" : label}</span></button>
    </div>`;
  card.querySelector("#flight-close")?.addEventListener("click", closeFlightDesk);
  card.querySelector("#flight-go")?.addEventListener("click", bookSelectedFlight);
  card.querySelectorAll("[data-flight-tile]").forEach(button => button.addEventListener("click", () => {
    selectedTile = Number(button.dataset.flightTile);
    renderFlightDesk();
    const selected = card.querySelector(`[data-flight-tile="${selectedTile}"]`);
    selected?.focus({ preventScroll: true });
    selected?.scrollIntoView({ block: "nearest" });
  }));
}

function bookSelectedFlight() {
  if (booking || selectedTile == null) return;
  booking = true;
  renderFlightDesk();
  emitWithTimeout(host.emitServer, "fly-to-airport", { tileIndex: selectedTile }, {
    onResponse: response => {
      booking = false;
      if (response?.success === false) {
        host.notice?.(response.error || "That flight could not be booked.");
        renderFlightDesk();
        return;
      }
      closeFlightDesk();
      host.renderAll();
    },
    onTimeout: () => {
      booking = false;
      host.notice?.("Flight booking timed out. The table will refresh when the connection returns.");
      renderFlightDesk();
    },
  });
}

export function openFlightDesk(trigger = null) {
  if (!canFlyNow()) return;
  booking = false;
  selectedTile = null;
  renderFlightDesk();
  if (trigger instanceof HTMLElement) setSurfaceReturnFocus(trigger);
  openSurface("#flight-modal", "#flight-go");
}

export function closeFlightDesk() {
  closeSurface("#flight-modal");
}

export function renderFlightDeskIfOpen() {
  const modal = $("#flight-modal");
  if (!modal || modal.classList.contains("is-hidden")) return;
  if (!canFlyNow()) {
    closeFlightDesk();
    return;
  }
  renderFlightDesk();
}

/* ---------- owner fee steppers (rendered inside the deed manager) ---------- */

export function airportFeesApply(tile) {
  return flights().enabled && tile?.kind === "railroad";
}

function clampFee(value) {
  return Math.max(0, Math.min(flights().maxFee, value));
}

function stepperHTML(kind, label, value) {
  return `<div class="fee-row"><span class="t-label f12 g100">${label}</span>
      <div class="fee-stepper" role="group" aria-label="${label} fee">
        <button class="btn-dark fee-step" type="button" data-airport-fee="${kind}" data-delta="${-FEE_STEP}" aria-label="Lower ${label.toLowerCase()} fee" ${value <= 0 ? "disabled" : ""}><span class="t-label f13">−</span></button>
        <output class="t-label f14 g100 fee-value" aria-live="polite">${money(value)}</output>
        <button class="btn-dark fee-step" type="button" data-airport-fee="${kind}" data-delta="${FEE_STEP}" aria-label="Raise ${label.toLowerCase()} fee" ${value >= flights().maxFee ? "disabled" : ""}><span class="t-label f13">+</span></button>
      </div>
    </div>`;
}

/** The deed manager block: steppers for the owner, a one-line read-out for everyone else. */
export function airportFeesHTML(tile, mine) {
  if (!airportFeesApply(tile)) return "";
  const entry = serverTile(tile.i) || {};
  const departure = Number.isInteger(entry.departureFee) ? entry.departureFee : flights().defaultFare;
  const arrival = Number.isInteger(entry.arrivalFee) ? entry.arrivalFee : flights().defaultFare;
  if (!mine) {
    return `<div class="fee-block"><span class="t-micro g400">FLIGHT FEES</span><p class="t-label f12 g100">DEPARTURE ${money(departure)} · ARRIVAL ${money(arrival)}</p><p class="t-micro ink-3">STANDARD FARE ${money(flights().defaultFare)} · Arrival fee first, then departure or standard fare. You never pay yourself.</p></div>`;
  }
  return `<div class="fee-block"><span class="t-micro g400">FLIGHT FEES</span>
      ${stepperHTML("departure", "DEPARTURE", departure)}
      ${stepperHTML("arrival", "ARRIVAL", arrival)}
      <p class="t-micro ink-3">Departure applies when the destination has no eligible owner. You never pay yourself.</p>
    </div>`;
}

export function bindAirportFees(root, tile) {
  root.querySelectorAll("[data-airport-fee]").forEach(button => button.addEventListener("click", () => {
    const kind = button.dataset.airportFee;
    const entry = serverTile(tile.i) || {};
    const current = Number.isInteger(entry[`${kind}Fee`]) ? entry[`${kind}Fee`] : flights().defaultFare;
    const next = clampFee(current + Number(button.dataset.delta));
    if (next === current) return;
    host.emitServer("set-airport-fees", { tileIndex: tile.i, [kind]: next }, response => {
      if (response?.success === false) host.notice?.(response.error || "Fees could not be saved.");
      host.renderAll();
    });
  }));
}

export function bindFlightUi() {
  $("#flight-scrim")?.addEventListener("click", closeFlightDesk);
}
