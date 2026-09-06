// The global-event domain as a prototype mixin: headline lifecycle, voting,
// activation settlements, and the election policy flags. Every method runs
// with `this` bound to the GameState instance, exactly as when they lived in
// the class body; gameLogic.js assigns this object onto GameState.prototype.
import { randomFloat, randomInt } from './random.js';
import {
  GLOBAL_EVENT_ACTIVATION_HOOKS,
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
    if (this.globalEvent.id === 'housing-bubble') this.endHousingBubble();
    this.activePlayers().forEach(player => {
      player.globalEventsSurvived = (player.globalEventsSurvived || 0) + 1;
    });
    this.globalEvent.phase = 'recovery';
    this.globalEvent.roundsRemaining = 1;
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
    if (randomFloat() >= this.globalEventTriggerChance(source)) return;
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

  globalEventBaseFields(definition, combo) {
    const base = {
      id: definition.id,
      title: definition.title,
      category: definition.category,
      summary: definition.summary,
      effects: { ...(definition.effects || {}) }
    };
    if (!combo) return base;
    base.id = combo.id;
    base.title = combo.title;
    base.category = 'COMBINATION';
    base.summary = combo.summary;
    base.effects = { ...base.effects, ...combo.effects };
    return base;
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
      resolvedChoice: null,
      targetPlayerId: target?.id || null
    };
  },

  activateGlobalEvent(definition, combo = null) {
    this.globalEvent = this.buildGlobalEvent(definition, combo);
    this.globalEvent.comboId = combo?.id || null;
    if (combo) this.activePlayers().forEach(player => { player.comboExperienced = true; });
    const onActivate = GLOBAL_EVENT_ACTIVATION_HOOKS[definition.id];
    if (onActivate) onActivate(this);
    this.activePlayers().forEach(player => {
      player.globalEventsExperienced = (player.globalEventsExperienced || 0) + 1;
    });
    this.globalEventsTriggered += 1;
    this.feedMessage(this.globalEvent.choices
      ? `${this.globalEvent.title} is live. The table votes before the next round.`
      : `${this.globalEvent.title} is building. The table has one round to prepare.`);
  },

  globalEventVoteWinners(event) {
    const counts = Object.fromEntries((event.choices || []).map(choice => [choice.id, 0]));
    Object.values(event.votes || {}).forEach(choiceId => { if (counts[choiceId] != null) counts[choiceId] += 1; });
    const top = Math.max(...Object.values(counts), 0);
    return Object.entries(counts).filter(([, count]) => count === top).map(([id]) => id);
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
    const winners = this.globalEventVoteWinners(event);
    event.resolvedChoice = winners.length ? winners[randomInt(0, winners.length - 1)] : event.choices?.[0]?.id || null;
    this.applyGlobalEventVoteOutcomes(event);
    event.phase = 'active';
    event.startedRound = this.roundNumber;
    event.roundsRemaining = event.durationRounds;
    this.applyGlobalEventActivationSettlements();
    this.feedMessage(`${event.title} resolved: ${String(event.resolvedChoice || '').replaceAll('-', ' ').toUpperCase()}.`);
  },

  voteOpenFor(player, event) {
    if (!player) return false;
    if (!event) return false;
    return event.phase === 'voting';
  },

  globalEventVoteRejection(player, event, choiceId) {
    if (!this.voteOpenFor(player, event)) return 'There is no active global vote.';
    if (!this.activePlayers().some(candidate => candidate.id === player.id)) return 'Only active players can vote.';
    if (!event.choices?.some(choice => choice.id === choiceId)) return 'That policy is not available.';
    if (event.votes[player.id]) return 'You already voted in this election.';
    return null;
  },

  voteGlobalEvent(socketId, choiceId) {
    const player = this.getPlayerBySocket(socketId);
    const event = this.globalEvent;
    const rejection = this.globalEventVoteRejection(player, event, choiceId);
    if (rejection) return { success: false, error: rejection };
    event.votes[player.id] = choiceId;
    this.feedMessage(`${player.nickname} cast a vote in the ${event.title.toLowerCase()}.`);
    const voters = this.activePlayers().filter(candidate => event.votes[candidate.id]).length;
    if (voters >= this.activePlayers().length) this.resolveGlobalEventVote();
    return { success: true };
  },

  applyGlobalEventActivationSettlements() {
    const event = this.globalEvent;
    if (!event) return;
    if (event.phase !== 'active') return;
    if (event.settlementApplied) return;
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

  isBailoutRecipient(player, threshold) {
    if (player.cash < threshold) return true;
    return ['active', 'due'].includes(player.bankLoan?.status);
  },

  settleEmergencyBailout() {
    const threshold = this.settings.startingCash * 0.5;
    const rescue = Math.max(50, Math.floor(this.settings.startingCash * 0.1));
    this.activePlayers().filter(player => this.isBailoutRecipient(player, threshold)).forEach(player => {
      player.cash += rescue;
      player.bailoutReceived = true;
      if (['active', 'due'].includes(player.bankLoan?.status)) player.moralHazard = true;
      this.feedMessage(`${player.nickname} received a $${rescue} emergency bailout.`);
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
