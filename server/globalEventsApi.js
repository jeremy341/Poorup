// The global-event domain as a prototype mixin: headline lifecycle, voting,
// activation settlements, and the election policy flags. Every method runs
// with `this` bound to the GameState instance, exactly as when they lived in
// the class body; gameLogic.js assigns this object onto GameState.prototype.
import { randomFloat } from './random.js';
import { normalizeRequestId } from './requestId.js';
import {
  GLOBAL_EVENT_ACTIVATION_HOOKS,
  BANK_RUN_DISTRESS_CASH_RATIO,
  GLOBAL_EVENT_COOLDOWN_ROUNDS,
  GLOBAL_EVENT_COMBINATIONS,
  GLOBAL_EVENT_DEFINITIONS,
  GLOBAL_EVENT_MIN_ROUND,
  GLOBAL_EVENT_SETTLEMENT_STEPS,
  GLOBAL_EVENT_TARGET_FINDERS,
  GLOBAL_EVENT_VOTE_OUTCOME_HANDLERS,
  GLOBAL_EVENTS_ENABLED_VALUES,
  positiveFiniteEffect
} from './globalEventData.js';

const globalEventsApi = {
  globalEventDefinition(id) {
    return GLOBAL_EVENT_DEFINITIONS.find(event => event.id === id) || null;
  },

  globalEventActive(id) {
    return this.globalEvent?.phase === 'active' && this.globalEvent.id === id;
  },

  // A combination runs under its own id, but it is made of the headlines it
  // fused. Every component id is a first-class part of the running event, so
  // the hooks, the recovery rules, and the tile rules can all key off it.
  globalEventCombo(comboId) {
    if (!comboId) return null;
    return GLOBAL_EVENT_COMBINATIONS.find(candidate => candidate.id === comboId) || null;
  },

  globalEventComponentIds(event = this.globalEvent) {
    if (!event) return [];
    const ids = new Set();
    if (event.id) ids.add(event.id);
    const combo = this.globalEventCombo(event.comboId);
    (combo?.required || []).forEach(id => ids.add(id));
    return [...ids];
  },

  // True when the running event - or any headline fused into it - is the
  // named one and is live. A combination is not a different world from its
  // halves: the airport-strike tile rule still runs inside travel-chaos.
  globalEventIncludes(id, event = this.globalEvent) {
    if (!event || event.phase !== 'active') return false;
    return this.globalEventComponentIds(event).includes(id);
  },

  // A finished match closes its headline. The headline stays in the history
  // (the match summary reads it), but the ladder stops with the match: a late
  // ballot must not resolve an election nobody will ever see play out.
  globalEventMatchEnded() {
    return !this.started;
  },

  closeGlobalEventAfterMatch() {
    const event = this.globalEvent;
    if (!event) return false;
    if (!this.globalEventHistory.some(entry => entry.id === event.id && entry.startedRound === event.startedRound)) {
      this.globalEventHistory.unshift({ id: event.id, title: event.title, comboId: event.comboId || null, startedRound: event.startedRound, endedRound: this.roundNumber });
      this.globalEventHistory = this.globalEventHistory.slice(0, 8);
    }
    this.globalEvent = null;
    return true;
  },

  activeEventEffects() {
    return this.globalEvent?.phase === 'active' ? (this.globalEvent.effects || {}) : {};
  },

  isConstructionBlocked() {
    if (this.globalEvent?.phase === 'active') {
      if (this.globalEvent.effects?.constructionBlocked) return true;
    }
    if (this.globalEventActive('housing-bubble')) return true;
    if (this.globalEventActive('bank-run')) return true;
    return this.globalEventActive('supply-chain');
  },

  // The global event phase ladder, walked once per round: a vote that
  // matures goes active, an active event burns a round, and a finished one
  // spends its recovery round before it is archived.
  advanceGlobalEventPhase() {
    if (this.globalEventMatchEnded()) {
      this.closeGlobalEventAfterMatch();
      return;
    }
    const phase = this.globalEvent?.phase;
    if (phase === 'voting') {
      this.resolveGlobalEventVoteIfDue();
      return;
    }
    if (phase === 'warning') {
      this.beginGlobalEventActiveIfDue();
      return;
    }
    if (phase === 'active') {
      this.tickActiveGlobalEvent();
      return;
    }
    if (phase === 'recovery') {
      this.archiveFinishedGlobalEvent();
    }
  },

  resolveGlobalEventVoteIfDue() {
    if (this.roundNumber > this.globalEvent.voteRound) this.resolveGlobalEventVote();
  },

  beginGlobalEventActiveIfDue() {
    if (this.roundNumber > this.globalEvent.startedRound) this.beginGlobalEventActive();
  },

  beginGlobalEventActive() {
    this.globalEvent.phase = 'active';
    this.globalEvent.startedRound = this.roundNumber;
    this.globalEvent.roundsRemaining = this.globalEvent.durationRounds;
    this.applyGlobalEventActivationSettlements();
    this.feedMessage(`${this.globalEvent.title} is now active for ${this.globalEvent.durationRounds} rounds.`);
  },

  tickActiveGlobalEvent() {
    this.applyGlobalEventActivationSettlements();
    this.collectBuildingMaintenance();
    this.globalEvent.roundsRemaining -= 1;
    if (this.globalEvent.roundsRemaining > 0) return;
    this.beginGlobalEventRecovery();
  },

  beginGlobalEventRecovery() {
    // The housing-bubble recovery rule belongs to the headline, so it also
    // runs when the bubble was fused into a combination.
    if (this.globalEventComponentIds().includes('housing-bubble')) this.endHousingBubble();
    this.activePlayers().forEach(player => {
      player.globalEventsSurvived = (player.globalEventsSurvived || 0) + 1;
    });
    this.globalEvent.phase = 'recovery';
    this.globalEvent.roundsRemaining = 1;
    this.recordTelemetryEvent?.('event-recovered', { eventId: this.globalEvent.id, title: this.globalEvent.title });
    this.feedMessage(`${this.globalEvent.title} has ended. The table enters recovery.`);
  },

  endHousingBubble() {
    this.activePlayers().forEach(player => {
      if (player.properties.some(index => (this.getTile(index)?.houseCount || 0) > 0)) player.bubbleSurvivor = true;
      player.housingBubbleEnded = true;
    });
  },

  archiveFinishedGlobalEvent() {
    const ended = this.globalEvent;
    this.globalEventHistory.unshift({ id: ended.id, title: ended.title, comboId: ended.comboId || null, startedRound: ended.startedRound, endedRound: this.roundNumber });
    this.globalEventHistory = this.globalEventHistory.slice(0, 8);
    this.globalEvent = null;
    this.globalEventCooldown = GLOBAL_EVENT_COOLDOWN_ROUNDS;
  },

  globalEventsEnabled() {
    return GLOBAL_EVENTS_ENABLED_VALUES.includes(this.settings.globalEvents);
  },

  globalEventExpectedRounds() {
    return Math.max(12, this.activePlayers().length * 8);
  },

  globalEventProgress(expectedRounds = this.globalEventExpectedRounds()) {
    return Math.max(0, Math.min(1, (this.roundNumber - 1) / expectedRounds));
  },

  // One headline per match is the safe default. A second headline is only
  // possible when a surprise draw completes a named, curated combination.
  pendingGlobalEventCombo(source) {
    if (this.globalEventsTriggered !== 1) return null;
    if (source !== 'surprise') return null;
    const previous = this.globalEventHistory[0];
    if (!previous) return null;
    if (previous.comboId) return null;
    return GLOBAL_EVENT_COMBINATIONS.find(candidate => candidate.required.includes(previous.id)) || null;
  },

  globalEventTriggerChance(source) {
    const progress = this.globalEventProgress();
    if (progress < 0.18) return 0;
    if (source === 'surprise') return progress < 0.55 ? 0.05 : 0.07;
    return progress < 0.55 ? 0.025 : 0.04;
  },

  globalEventTriggerAllowed() {
    if (!this.started) return false;
    if (!this.globalEventsEnabled()) return false;
    if (this.globalEvent) return false;
    if (this.globalEventCooldown > 0) return false;
    return this.roundNumber >= GLOBAL_EVENT_MIN_ROUND;
  },

  globalEventLimitReached(combo) {
    if (combo) return false;
    return this.globalEventsTriggered >= 1;
  },

  globalEventCandidatePool(combo) {
    const eligible = GLOBAL_EVENT_DEFINITIONS.filter(event => event.eligible(this));
    if (!combo) return eligible;
    const previous = this.globalEventHistory[0];
    const comboEventId = combo.required.find(id => id !== previous.id);
    return eligible.filter(event => event.id === comboEventId);
  },

  maybeTriggerGlobalEvent(source = 'round') {
    if (!this.globalEventTriggerAllowed()) return;
    const combo = this.pendingGlobalEventCombo(source);
    if (this.globalEventLimitReached(combo)) return;
    const eventPool = this.globalEventCandidatePool(combo);
    if (!eventPool.length) return;
    const chance = this.globalEventTriggerChance(source);
    this.recordTelemetryEvent?.('event-eligible', { source, chance, candidates: eventPool.map(event => event.id).slice(0, 12), combination: combo?.id || null });
    if (randomFloat() >= chance) return;
    this.globalEventTriggerSource = source;
    this.activateGlobalEvent(this.selectWeightedGlobalEvent(eventPool), combo);
  },

  selectWeightedGlobalEvent(eventPool) {
    const totalWeight = eventPool.reduce((sum, event) => sum + (event.weight || 1), 0);
    let roll = randomFloat() * totalWeight;
    return eventPool.find(event => (roll -= (event.weight || 1)) <= 0) || eventPool[eventPool.length - 1];
  },

  globalEventDurationRounds(definition, combo) {
    if (combo?.duration) return combo.duration;
    const late = this.globalEventProgress() > 0.6;
    if (definition.id === 'housing-bubble') return late ? 8 : 7;
    return late ? 7 : 6;
  },

  globalEventChoices(definition, combo) {
    return (combo?.choices || definition.choices)?.map(choice => ({ ...choice })) || null;
  },

  // A combination is the sum of the headlines it fused, so every component
  // contributes its effects. The order the halves happened to arrive in must
  // not decide the payload: the components merge in the combination's
  // declared order (the later one wins a shared key) and the combination's
  // own explicit effects win over both.
  globalEventEffects(definition, combo) {
    const components = combo?.required?.length
      ? combo.required.map(id => this.globalEventDefinition(id)).filter(Boolean)
      : [definition];
    const effects = {};
    components.forEach(component => Object.assign(effects, component.effects || {}));
    Object.assign(effects, combo?.effects || {});
    return effects;
  },

  globalEventBaseFields(definition, combo) {
    const base = {
      id: definition.id,
      title: definition.title,
      category: definition.category,
      summary: definition.summary,
      effects: this.globalEventEffects(definition, combo)
    };
    if (!combo) return base;
    base.id = combo.id;
    base.title = combo.title;
    base.category = 'COMBINATION';
    base.summary = combo.summary;
    return base;
  },

  // The election instance needs a name of its own: the same headline can run
  // twice in a match, so a ballot is bound to the id AND the round AND the
  // nonce of the election it was cast in.
  globalEventNextVoteNonce(id) {
    this.globalEventSequence = (this.globalEventSequence || 0) + 1;
    return `${id}-${this.roundNumber}-${this.globalEventSequence}`;
  },

  buildGlobalEvent(definition, combo) {
    const choices = this.globalEventChoices(definition, combo);
    const findTarget = !combo && GLOBAL_EVENT_TARGET_FINDERS[definition.id];
    const target = findTarget ? findTarget(this) : null;
    return {
      ...this.globalEventBaseFields(definition, combo),
      phase: choices ? 'voting' : 'warning',
      startedRound: this.roundNumber,
      voteRound: choices ? this.roundNumber : null,
      durationRounds: this.globalEventDurationRounds(definition, combo),
      roundsRemaining: choices ? 1 : 1,
      choices,
      votes: {},
      voteNonce: this.globalEventNextVoteNonce(combo?.id || definition.id),
      resolvedChoice: null,
      targetPlayerId: target?.id || null
    };
  },

  activateGlobalEvent(definition, combo = null) {
    this.globalEvent = this.buildGlobalEvent(definition, combo);
    this.globalEvent.comboId = combo?.id || null;
    if (combo) this.activePlayers().forEach(player => { player.comboExperienced = true; });
    // Every headline that went into the event runs its activation hook, not
    // just the half that happened to fire the combination.
    const componentIds = new Set([definition.id, ...(combo?.required || [])]);
    componentIds.forEach(componentId => {
      const onActivate = GLOBAL_EVENT_ACTIVATION_HOOKS[componentId];
      if (onActivate) onActivate(this);
    });
    this.activePlayers().forEach(player => {
      player.globalEventsExperienced = (player.globalEventsExperienced || 0) + 1;
    });
    this.globalEventsTriggered += 1;
    this.recordTelemetryEvent?.('event-triggered', { eventId: this.globalEvent.id, source: this.globalEventTriggerSource || 'round', combination: combo?.id || null, durationRounds: this.globalEvent.durationRounds });
    this.globalEventTriggerSource = null;
    this.feedMessage(this.globalEvent.choices
      ? `${this.globalEvent.title} is live. The table votes before the next round.`
      : `${this.globalEvent.title} is building. The table has one round to prepare.`);
  },

  // A choice is enacted only with a strict majority of the ACTIVE seats.
  // Abstentions count as no change, so a split or thin turnout returns null
  // and no event choice is made (A8-06). Only active seats may shape the
  // outcome: a ballot cast before the voter went bankrupt or disconnected is
  // not tallied, or a departed ballot could flip what the live table decided.
  globalEventVoteChoice(event) {
    const seats = this.activePlayers().length;
    const counts = Object.fromEntries((event.choices || []).map(choice => [choice.id, 0]));
    const eligibleIds = new Set(this.activePlayers().map(player => player.id));
    Object.entries(event.votes || {}).forEach(([playerId, choiceId]) => {
      if (!eligibleIds.has(playerId)) return;
      if (counts[choiceId] != null) counts[choiceId] += 1;
    });
    const winner = Object.entries(counts).find(([, count]) => count * 2 > seats);
    return winner ? winner[0] : null;
  },

  voterPicked(event, player) {
    return event.votes?.[player.id];
  },

  voteWasUnanimous(voters, event) {
    if (!voters.length) return false;
    return voters.every(player => this.voterPicked(event, player) === event.resolvedChoice);
  },

  recordVoterOutcome(player, event, allVotedSame) {
    const choice = this.voterPicked(event, player);
    if (choice) player.lastVoteChoice = choice;
    if (choice === event.resolvedChoice) player.councilWins = (player.councilWins || 0) + 1;
    if (allVotedSame) player.unanimousVote = true;
  },

  applyGlobalEventVoteOutcomes(event) {
    const voters = this.activePlayers();
    const allVotedSame = this.voteWasUnanimous(voters, event);
    voters.forEach(player => this.recordVoterOutcome(player, event, allVotedSame));
    const onResolved = GLOBAL_EVENT_VOTE_OUTCOME_HANDLERS[event.id];
    if (onResolved) onResolved(this, event);
  },

  resolveGlobalEventVote() {
    const event = this.globalEvent;
    if (!event || event.phase !== 'voting') return;
    // A finished match does not resolve its election: the ballot is stale by
    // definition, so the headline is closed instead of played out.
    if (this.globalEventMatchEnded()) {
      this.closeGlobalEventAfterMatch();
      return;
    }
    event.resolvedChoice = this.globalEventVoteChoice(event);
    this.recordTelemetryEvent?.('event-choice', { eventId: event.id, turnout: Object.keys(event.votes || {}).length, voters: this.activePlayers().length, resolvedChoice: event.resolvedChoice });
    this.applyGlobalEventVoteOutcomes(event);
    event.phase = 'active';
    event.startedRound = this.roundNumber;
    event.roundsRemaining = event.durationRounds;
    this.applyGlobalEventActivationSettlements();
    this.feedMessage(event.resolvedChoice
      ? `${event.title} resolved: ${event.resolvedChoice.replaceAll('-', ' ').toUpperCase()}.`
      : `${event.title} resolved: NO MAJORITY, NO CHANGE.`);
  },

  voteOpenFor(player, event) {
    if (!player) return false;
    if (!event) return false;
    return event.phase === 'voting';
  },

  // The identity of the running election: the headline, the round it opened
  // in, and the nonce of this election instance.
  globalEventVoteIdentity(event = this.globalEvent) {
    if (!event) return null;
    return {
      eventId: event.id ?? null,
      voteRound: event.voteRound ?? null,
      voteNonce: event.voteNonce ?? null
    };
  },

  // A ballot names the election it was cast in. The headline alone is not
  // enough - the same headline can run twice in a match, and a stale ballot
  // must not land in the election that follows it.
  globalEventBallot(ballot) {
    if (!ballot || typeof ballot !== 'object') return { eventId: null, voteRound: null, voteNonce: null, requestId: '' };
    return {
      eventId: ballot.eventId ?? null,
      voteRound: ballot.voteRound ?? null,
      voteNonce: ballot.voteNonce ?? null,
      requestId: normalizeRequestId(ballot.requestId)
    };
  },

  globalEventBallotMismatch(event, ballot) {
    if (!event || !ballot) return false;
    const identity = this.globalEventVoteIdentity(event);
    if (ballot.eventId != null && ballot.eventId !== identity.eventId) return true;
    if (ballot.voteNonce != null && ballot.voteNonce !== identity.voteNonce) return true;
    if (ballot.voteRound != null && String(ballot.voteRound) !== String(identity.voteRound)) return true;
    return false;
  },

  globalEventVoteRejection(player, event, choiceId, ballot = {}) {
    if (!this.voteOpenFor(player, event)) return 'There is no active global vote.';
    // A ballot cast in another election is stale, whatever it would vote for.
    if (this.globalEventBallotMismatch(event, ballot)) return 'That vote belongs to a different election.';
    // Full-turnout resolution reprices loans and pays bailouts at once, which
    // must not happen under an open pending payment or auction.
    if (this.pendingPayment || this.auction?.active) return 'Resolve the table obligation before voting.';
    if (!this.activePlayers().some(candidate => candidate.id === player.id)) return 'Only active players can vote.';
    if (!event.choices?.some(choice => choice.id === choiceId)) return 'That policy is not available.';
    if (event.votes[player.id]) return 'You already voted in this election.';
    return null;
  },

  // A vote is a write, so it is idempotent: the same request id answers the
  // same way twice and is counted once.
  globalEventVoteTransactionKey(playerId, requestId) {
    const value = normalizeRequestId(requestId);
    return value ? `${playerId}:global-event-vote:${value}` : null;
  },

  cachedGlobalEventVote(key) {
    if (!key) return null;
    if (!this.globalEventVoteTransactions) this.globalEventVoteTransactions = new Map();
    return this.globalEventVoteTransactions.get(key) || null;
  },

  cacheGlobalEventVote(key, result) {
    if (!key) return result;
    if (!this.globalEventVoteTransactions) this.globalEventVoteTransactions = new Map();
    this.globalEventVoteTransactions.set(key, result);
    while (this.globalEventVoteTransactions.size > 100) {
      this.globalEventVoteTransactions.delete(this.globalEventVoteTransactions.keys().next().value);
    }
    return result;
  },

  voteGlobalEvent(socketId, choiceId, ballot = {}) {
    const player = this.getPlayerBySocket(socketId);
    const event = this.globalEvent;
    if (!event) return { success: false, error: 'There is no active global vote.' };
    // A finished match closes its headline: the ballot is stale by definition
    // and the ladder stops with the match.
    if (this.globalEventMatchEnded()) {
      this.closeGlobalEventAfterMatch();
      return { success: false, error: 'The match has ended.' };
    }
    const identity = this.globalEventBallot(ballot);
    const key = this.globalEventVoteTransactionKey(player?.id, identity.requestId);
    const cached = this.cachedGlobalEventVote(key);
    if (cached) return cached;
    const rejection = this.globalEventVoteRejection(player, event, choiceId, identity);
    if (rejection) return { success: false, error: rejection };
    event.votes[player.id] = choiceId;
    this.feedMessage(`${player.nickname} cast a vote in the ${event.title.toLowerCase()}.`);
    const voters = this.activePlayers().filter(candidate => event.votes[candidate.id]).length;
    if (voters >= this.activePlayers().length) this.resolveGlobalEventVote();
    return this.cacheGlobalEventVote(key, { success: true });
  },

  applyGlobalEventActivationSettlements() {
    const event = this.globalEvent;
    if (!event) return;
    if (event.phase !== 'active') return;
    if (event.settlementApplied) return;
    // A settlement reprices loans and pays bailouts against the table's cash.
    // Under an open payment or a live auction that money is already spoken
    // for, so the settlement waits for the obligation to clear instead of
    // landing on a balance that is about to change (the ballot guard does the
    // same for votes).
    if (this.pendingPayment || this.auction?.active) return;
    event.settlementApplied = true;
    GLOBAL_EVENT_SETTLEMENT_STEPS.forEach(step => {
      if (step.appliesTo(this, event)) this[step.handler](event);
    });
  },

  settleRentControlStipend(event) {
    const stipend = positiveFiniteEffect(event.effects?.rentControlStipend);
    this.activePlayers().filter(player => player.properties.length > 0).forEach(player => {
      player.cash += stipend;
      this.feedMessage(`${player.nickname} received a $${stipend} rent-control stipend.`);
    });
  },

  settleCashMultiplier(event) {
    const cashMultiplier = Number(event.effects?.cashMultiplier);
    this.activePlayers().forEach(player => {
      player.cash = Math.max(0, Math.floor(player.cash * cashMultiplier));
      if (player.cash === 0) player.zeroCashReached = true;
    });
    this.feedMessage(`${event.title} settled a visible cash adjustment across the table.`);
  },

  // Only distressed players are paid. A loan does not qualify a solvent seat:
  // the bailout is a rescue, not a loan-holder payout (F-035).
  isBailoutRecipient(player, threshold) {
    return player.cash < threshold;
  },

  settleEmergencyBailout() {
    const threshold = this.settings.startingCash * BANK_RUN_DISTRESS_CASH_RATIO;
    const rescue = Math.max(50, Math.floor(this.settings.startingCash * 0.1));
    this.activePlayers().filter(player => this.isBailoutRecipient(player, threshold)).forEach(player => {
      player.cash += rescue;
      player.bailoutReceived = true;
      if (['active', 'due'].includes(player.bankLoan?.status)) player.moralHazard = true;
      this.feedMessage(`${player.nickname} received a $${rescue} emergency bailout.`);
    });
  },

  settleInterestRateShock(event) {
    const multiplier = Number(event.effects?.loanPremiumMultiplier);
    if (!Number.isFinite(multiplier) || multiplier <= 1) return;
    this.activePlayers().forEach(player => {
      const loan = player.bankLoan;
      if (!loan || !['active', 'due'].includes(loan.status)) return;
      const remaining = Math.max(0, Math.floor(Number(loan.remaining) || 0));
      if (!remaining) return;
      // Preserve paid credit: only the unpaid remainder reprices, so
      // paid + remaining still equals the (new) total due.
      const paid = Math.max(0, Math.floor(Number(loan.totalDue) || 0) - remaining);
      const repriced = Math.ceil(remaining * multiplier);
      loan.remaining = repriced;
      loan.totalDue = paid + repriced;
      this.feedMessage(`${player.nickname}'s bank loan was repriced to $${repriced} by ${String(event.title || 'the active event').toLowerCase()}.`);
    });
  },

  settleTaxAuditPenalty() {
    const event = this.globalEvent;
    const target = this.getPlayerById(event.targetPlayerId);
    if (!target || target.bankrupt) return;
    const amount = Math.min(target.cash, Math.max(25, Math.floor(target.cash * 0.1)));
    if (amount <= 0) return;
    target.cash -= amount;
    if (this.settings.vacationCash) this.vacationPool += amount;
    if (target.cash === 0) target.zeroCashReached = true;
    target.taxAuditCount = (target.taxAuditCount || 0) + 1;
    this.feedMessage(`${target.nickname} paid $${amount} after the tax scandal audit.`);
  },

  maintenanceWeight(tile) {
    const level = Number(tile?.houseCount) || 0;
    if (level >= 5) return 4;
    return Math.max(0, level);
  },

  buildingsForMaintenance(player) {
    return player.properties.reduce((sum, index) => sum + this.maintenanceWeight(this.getTile(index)), 0);
  },

  chargeBuildingMaintenance(player, maintenance) {
    const buildings = this.buildingsForMaintenance(player);
    if (!buildings) return;
    const due = buildings * maintenance;
    const paid = Math.min(player.cash, due);
    player.cash -= paid;
    if (player.cash === 0) player.zeroCashReached = true;
    if (paid < due) {
      this.feedMessage(`${player.nickname} could only pay $${paid} of $${due} in labor-strike maintenance.`);
      this.openDebtSettlement({
        player,
        creditor: null,
        amount: due - paid,
        message: 'The labor strike maintenance bill remains outstanding.',
        turnOptions: {},
        hooks: {}
      });
      return;
    }
    this.feedMessage(`${player.nickname} paid $${paid} in labor-strike maintenance.`);
  },

  collectBuildingMaintenance() {
    const maintenance = Number(this.activeEventEffects().buildingMaintenance);
    if (!Number.isFinite(maintenance)) return;
    if (maintenance <= 0) return;
    this.activePlayers().forEach(player => this.chargeBuildingMaintenance(player, Math.floor(maintenance)));
  },

  markMidpointFacts() {
    if (this.midpointMarked) return;
    const expectedRounds = Math.max(12, this.activePlayers().length * 8);
    if (this.roundNumber < Math.ceil(expectedRounds / 2)) return;
    const active = this.activePlayers();
    if (!active.length) return;
    const lowestCash = Math.min(...active.map(player => Number(player.cash) || 0));
    active.filter(player => Number(player.cash) === lowestCash).forEach(player => { player.underdogAtHalfway = true; });
    this.midpointMarked = true;
  },

  isLowTaxElection() {
    const event = this.globalEvent;
    if (event?.phase !== 'active') return false;
    if (event.id !== 'city-election') return false;
    return event.resolvedChoice === 'low-tax';
  },

  isPublicWorksElection() {
    const event = this.globalEvent;
    if (event?.phase !== 'active') return false;
    if (event.id !== 'city-election') return false;
    return event.resolvedChoice === 'public-works';
  }
};

export { globalEventsApi };
