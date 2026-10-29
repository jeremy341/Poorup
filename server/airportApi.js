// Airport flights. A player on an airport can pay to fly to another one instead of rolling.
// The fare is the destination's arrival fee if owned, else the origin's departure fee if owned, else the default fee paid to the bank.
// The owner whose fee set the fare is paid it and flies free. Mortgaged airports count as unowned.
export const AIRPORT_DEFAULT_FARE = 100;
export const AIRPORT_MAX_FEE = 200;

function isAirport(tile) {
  return tile?.type === 'railroad';
}

// A fee is a real number or a plain digit string. Number() alone would turn
// null, '', [] and false into a valid $0 and '1e2' or '0x10' into other fees.
function whole(value) {
  if (typeof value === 'string' && /^\d{1,6}$/.test(value)) return Number(value);
  return typeof value === 'number' && Number.isInteger(value) ? value : NaN;
}

// Why the seat may not set this airport's fees right now, or null.
function feeSettingRefusal(game, player, tile) {
  if (!player || !game.started) return { success: false, error: 'Game has not started.' };
  if (!game.flightsEnabled()) return { success: false, error: 'Flights are off at this table.' };
  if (!isAirport(tile)) return { success: false, error: 'That is not an airport.' };
  if (tile.ownerId !== player.id) return { success: false, error: 'You do not own this airport.' };
  return null;
}

// The supplied fees that are valid, or the first refusal. Absent keys are left unchanged.
function validatedFeeChanges(fees) {
  const next = {};
  for (const key of ['departure', 'arrival']) {
    if (fees[key] === undefined) continue;
    const value = whole(fees[key]);
    if (!(value >= 0 && value <= AIRPORT_MAX_FEE)) {
      return { error: `Fees must be whole dollars from $0 to $${AIRPORT_MAX_FEE}.` };
    }
    next[key] = value;
  }
  return { next };
}

// A viewer may see bookable flights only while the desk would accept a booking from them.
function viewerMayBookFlights(game, viewer) {
  return Boolean(viewer) && game.started && !game.flightRejection(viewer);
}

export const airportApi = {
  flightsEnabled() {
    return Boolean(this.settings?.flights);
  },

  // The owner whose airport earns fees: present, solvent seat, deed not mortgaged.
  airportFeeOwner(tile) {
    if (!isAirport(tile) || !tile.ownerId || tile.mortgaged) return null;
    const owner = this.getPlayerById(tile.ownerId);
    return owner && !owner.bankrupt ? owner : null;
  },

  airportFee(tile, kind) {
    const stored = kind === 'arrival' ? tile.arrivalFee : tile.departureFee;
    return Number.isInteger(stored) ? stored : AIRPORT_DEFAULT_FARE;
  },

  // Which owner's fee sets the fare, and the fee: the destination's arrival fee first, then the origin's departure fee.
  airportFareBasis(origin, destination) {
    const destinationOwner = this.airportFeeOwner(destination);
    if (destinationOwner) return { fare: this.airportFee(destination, 'arrival'), basis: 'arrival', payee: destinationOwner };
    const originOwner = this.airportFeeOwner(origin);
    if (originOwner) return { fare: this.airportFee(origin, 'departure'), basis: 'departure', payee: originOwner };
    return { fare: AIRPORT_DEFAULT_FARE, basis: 'default', payee: null };
  },

  airportFare(origin, destination, traveler) {
    const { fare, basis, payee } = this.airportFareBasis(origin, destination);
    const payable = payee && payee.id === traveler.id ? 0 : fare;
    return { fare: payable, basis, payeeId: payee ? payee.id : null };
  },

  // Why this player cannot fly right now, or null. Destination is optional so
  // the same gate answers "may this player open the flight desk at all".
  flightRejection(player, destination = null) {
    const blocked = this.rollTurnRejection(player);
    if (blocked) return blocked;
    const checks = [
      [!this.flightsEnabled(), 'Flights are off at this table.'],
      [this.hasRolled, 'You have already moved this turn.'],
      [player.inJail, 'You cannot fly from jail.'],
      [!isAirport(this.getTile(player.position)), 'You can only fly from an airport.'],
      [this.airportStrikeGroundsCard(), 'An airport strike has grounded every flight.'],
    ];
    const hit = checks.find(([failed]) => failed);
    if (hit) return { success: false, error: hit[1] };
    if (!destination) return null;
    if (!isAirport(destination)) return { success: false, error: 'That is not an airport.' };
    if (destination.index === player.position) return { success: false, error: 'You are already at that airport.' };
    return null;
  },

  // The viewer's bookable flights, priced by the server. Empty when the viewer
  // cannot fly, so the client shows the flight button only when this has rows.
  summaryFlights(viewerPlayerId = null) {
    const base = { enabled: this.flightsEnabled(), defaultFare: AIRPORT_DEFAULT_FARE, maxFee: AIRPORT_MAX_FEE, options: [] };
    const viewer = viewerPlayerId ? this.getPlayerById(viewerPlayerId) : null;
    if (!base.enabled || !viewerMayBookFlights(this, viewer)) return base;
    const origin = this.getTile(viewer.position);
    base.options = this.tiles.filter(tile => isAirport(tile) && tile.index !== origin.index).map(tile => {
      const { fare, basis, payeeId } = this.airportFare(origin, tile, viewer);
      return { tileIndex: tile.index, fare, basis, payeeId, affordable: viewer.cash >= fare };
    });
    return base;
  },

  // Pays the fare to the fee owner (or the bank) and credits the bank cashback.
  settleFlightFare(player, fare, payeeId) {
    const payee = payeeId ? this.getPlayerById(payeeId) : null;
    player.cash -= fare;
    if (payee) payee.cash += fare;
    this.creditBankCashback(player, fare, 'FLIGHT');
    return payee;
  },

  // Flying is the turn's move: no roll, no extra roll, and no Start salary.
  // The position is assigned directly, so no tile is walked and Start is never crossed.
  // lastFlight tells clients to snap the token instead of animating a walk.
  moveByFlight(player, origin, destination) {
    this.lastFlight = { playerId: player.id, from: origin.index, to: destination.index };
    player.position = destination.index;
    this.trackRailroadVisit(player, destination);
    this.hasRolled = true;
    this.turnAllowsExtraRoll = false;
    this.extraRollPending = false;
    this.consecutiveDoubles = 0;
  },

  flyToAirport(socketId, tileIndex) {
    const player = this.getPlayerBySocket(socketId);
    const destination = this.getTile(Number(tileIndex));
    const rejection = this.flightRejection(player, destination);
    if (rejection) return rejection;
    // flightRejection treats an absent destination as "just checking the desk",
    // so a bad index must be refused here, before any fare is priced or moved.
    if (!destination) return { success: false, error: 'That is not an airport.' };
    const origin = this.getTile(player.position);
    const { fare, basis, payeeId } = this.airportFare(origin, destination, player);
    if (player.cash < fare) return { success: false, error: `You need $${fare} to book this flight.` };

    const payee = this.settleFlightFare(player, fare, payeeId);
    this.moveByFlight(player, origin, destination);

    const destinationOwner = this.airportFeeOwner(destination);
    const where = `${origin.name} to ${destination.name}`;
    const paid = fare > 0 ? `paid $${fare}${payee ? ` to ${payee.nickname}` : ' to the bank'}` : 'flew free';
    this.feedMessage(`${player.nickname} flew from ${where} and ${paid}.`);
    this.recordTelemetryEvent?.('airport-flight', { fare, basis });

    // An owned destination already took its arrival fee, so no rent on top. An
    // unowned airport still offers the purchase, like any other landing.
    if (destination.ownerId || destinationOwner) {
      this.resolveTurnAfterAction({ allowExtraRoll: false });
      return { success: true, fare, basis };
    }
    const landing = this.applyTile(player, destination, { allowExtraRoll: false });
    return { ...(landing || { success: true }), fare, basis };
  },

  setAirportFees(socketId, tileIndex, fees) {
    fees = fees || {};
    const player = this.getPlayerBySocket(socketId);
    const tile = this.getTile(Number(tileIndex));
    const refusal = feeSettingRefusal(this, player, tile);
    if (refusal) return refusal;
    const { next, error } = validatedFeeChanges(fees);
    if (error) return { success: false, error };
    if (!Object.keys(next).length) return { success: false, error: 'Nothing to change.' };
    if (next.departure !== undefined) tile.departureFee = next.departure;
    if (next.arrival !== undefined) tile.arrivalFee = next.arrival;
    this.feedMessage(`${player.nickname} set ${tile.name} fees: departure $${this.airportFee(tile, 'departure')}, arrival $${this.airportFee(tile, 'arrival')}.`);
    return { success: true, departureFee: this.airportFee(tile, 'departure'), arrivalFee: this.airportFee(tile, 'arrival') };
  },
};
