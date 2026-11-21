// PLAYER VIEW: the in-room player card, its shared match-history modal and the
// public player-card acknowledgement that refreshes the selected seat.
import { $, esc } from "./clientDom.js";
import { avatarHTML } from "./clientSprites.js";
import { state } from "./clientState.js";
import { formatHistoryDate } from "./clientHistoryFormat.js";
import { closeButtonHTML } from "./clientCloseButton.js";

function publicPlayerResponseValid(response) {
  if (!response?.success) return false;
  return Boolean(response.player);
}

function applyPublicPlayerCard(response) {
  const seat = state.selectedPlayer;
  state.selectedPlayer = { ...seat, ...response.player, id: seat?.id || response.player.id, serverId: seat?.serverId || seat?.id, accountId: response.player.id };
  state.selectedPlayerRelationship = response.relationship;
  renderPlayerSurface();
}

export function publicPlayerAck(response) {
  if (!publicPlayerResponseValid(response)) return;
  applyPublicPlayerCard(response);
}

function historyScopeMatch(entry, scope) {
  if (scope === "global") return globalEventRow(entry);
  if (scope === "with-me") return sharedRowWithViewer(entry);
  return true;
}

function globalEventRow(entry) {
  if (!Array.isArray(entry.globalEvents)) return false;
  return entry.globalEvents.length > 0;
}

function viewerAccountId() {
  return state.account?.account?.id || "__owner__";
}

function sharedRowWithViewer(entry) {
  if (!Array.isArray(entry.participants)) return false;
  const viewer = viewerAccountId();
  return entry.participants.some((item) => item.sharedWithViewer === true || item.accountId === viewer);
}

function historyParticipant(entry, player) {
  if (!Array.isArray(entry.participants)) return null;
  const id = player.accountId || player.id;
  return entry.participants.find((item) => item.isViewedPlayer === true || item.accountId === id) || null;
}

function historyRowWon(participant, entry) {
  if (Number.isInteger(participant?.finalPlacement) && participant.finalPlacement > 0) return participant.finalPlacement === 1;
  if (entry.won === true) return true;
  return entry.result === 'WIN';
}

function placementHistoryResult(participant) {
  if (!Number.isInteger(participant?.finalPlacement)) return '';
  if (participant.finalPlacement <= 0) return '';
  if (participant.finalPlacement === 1) return 'WIN';
  return 'PLACE ' + participant.finalPlacement;
}

function declaredHistoryResult(entry) {
  if (entry.won === true) return 'WIN';
  if (entry.result === 'WIN') return 'WIN';
  if (entry.won === false) return 'LOSS';
  if (entry.result === 'LOSS' || entry.result === 'LOST') return 'LOSS';
  return 'RESULT NOT RECORDED';
}

// A bankrupt finish reads BANKRUPT here exactly as it does in the owner's own
// profile history, not a bare placement number.
function historyRowResult(participant, entry) {
  if (participant?.bankrupt === true) return 'BANKRUPT';
  const placement = placementHistoryResult(participant);
  if (placement) return placement;
  return declaredHistoryResult(entry);
}

function historyRowDate(entry) {
  return formatHistoryDate(entry.completedAt || entry.playedAt, 'UNKNOWN DATE');
}

function historyRowDeeds(participant, entry) {
  if (participant?.propertyCount != null) return participant.propertyCount;
  if (entry.properties != null) return entry.properties;
  return 'NOT RECORDED';
}

function playerHistoryMetaHTML(participants, deeds, events, combos) {
  const eventsTone = events !== 'NOT RECORDED' && events ? 'g300' : 'ink-3';
  const combosTone = combos !== 'NOT RECORDED' && combos ? 'g300' : 'ink-3';
  return '<div class="player-history-meta"><span class="t-micro ink-3">' + esc(String(participants)) + ' PLAYERS</span><span class="t-micro ink-3">' + esc(String(deeds)) + ' DEEDS</span><span class="t-micro ' + eventsTone + '">' + esc(String(events)) + ' EVENTS</span><span class="t-micro ' + combosTone + '">' + esc(String(combos)) + ' COMBOS</span></div></article>';
}

function historyRowHTML(entry, index, history, player) {
  const participant = historyParticipant(entry, player);
  const won = historyRowWon(participant, entry);
  const result = historyRowResult(participant, entry);
  const date = historyRowDate(entry);
  const deeds = historyRowDeeds(participant, entry);
  const participants = Array.isArray(entry.participants) ? entry.participants.length : 'NOT RECORDED';
  const events = Array.isArray(entry.globalEvents) ? entry.globalEvents.length : 'NOT RECORDED';
  const combos = Array.isArray(entry.eventCombinations) ? entry.eventCombinations.length : 'NOT RECORDED';
  const bankrupt = result === 'BANKRUPT';
  const tone = won ? 'green' : bankrupt ? 'red' : 'g100';
  return '<article class="player-history-row' + (won ? ' is-win' : '') + (bankrupt ? ' is-bankrupt' : '') + '"><div class="player-history-main"><span class="t-micro ink-3">' + esc(date) + ' · MATCH ' + String(history.length - index).padStart(2, '0') + '</span><strong class="t-label f12 ' + tone + '">' + esc(result) + '</strong></div>' + playerHistoryMetaHTML(participants, deeds, events, combos);
}

export function playerHistoryHTML(history, player) {
  const scope = state.selectedPlayerHistoryScope || "all";
  const filtered = history.filter((entry) => historyScopeMatch(entry, scope));
  if (!filtered.length) return '<p class="t-body ink-3 social-empty">NO MATCHES IN THIS HISTORY VIEW.</p>';
  // Number each match by its place in the full history, so a scope filter never renumbers rows.
  return filtered.map((entry) => historyRowHTML(entry, history.indexOf(entry), history, player)).join('');
}

function currentFriendStatus(accountId) {
  if (state.selectedPlayerRelationship !== "none") return state.selectedPlayerRelationship;
  const friends = state.social.friends || [];
  if (friends.some((friend) => friend.id === accountId || friend.publicId === accountId || friend.username === accountId)) return "accepted";
  return "none";
}

function friendButtonLabel(status) {
  if (status === "accepted") return "REMOVE FRIEND";
  if (status === "requested") return "REQUEST SENT";
  return "SEND FRIEND REQUEST";
}

function playerIdentityBits(player) {
  const name = esc(player.displayName || player.name);
  const online = player.online === false ? "OFFLINE" : "IN THIS ROOM";
  return { name, online };
}

function playerFactsBits(player) {
  const stats = player.personaStats || player.stats;
  const games = stats?.gamesPlayed ?? "-";
  const wins = stats?.wins ?? "-";
  const achievements = player.personaStats ? (player.personaStats.achievements ?? 0) : player.achievementsPrivate ? "PRIVATE" : player.achievementsFriendsOnly ? "FRIENDS ONLY" : (player.achievements?.length ?? "-");
  const mutual = player.mutualFriends ?? "-";
  return { games, wins, achievements, mutual };
}

function disabledWhen(off) {
  return off ? "disabled" : "";
}

function playerActionBits(player, canSocial, friendStatus) {
  const friendReady = canSocial && friendStatus !== "requested";
  return {
    friendAttr: disabledWhen(!friendReady),
    canSocialAttr: disabledWhen(!canSocial),
    historyAttr: disabledWhen(!canSocial || player.historyPrivate),
  };
}

// Before the round, the host can remove a computer seat from its card.
function localPlayerIsHost() {
  const me = state.players?.[0];
  return Boolean(me && (me.isHost || (me.serverId && me.serverId === state.hostId)));
}

function playerActionPanelHTML(player, canSocial, actions, friendLabel) {
  if (!canSocial) {
    const copy = player.id === "p1"
      ? "THIS IS YOUR PLAYER CARD · USE PROFILE FOR PRIVATE DETAILS"
      : player.bot
        ? `COMPUTER · ${String(player.botDifficulty || "table").toUpperCase()} · NO SOCIAL ACCOUNT`
        : "GUEST SEAT · SOCIAL ACTIONS NEED AN ACCOUNT";
    const removeAction = player.bot && state.phase === "lobby" && localPlayerIsHost()
      ? `<button class="cta-red" type="button" data-player-action="remove-computer"><span class="cta-text cta-text-sm">Remove computer player</span></button>`
      : "";
    return `<p class="t-micro ink-3 player-profile-actions-note">${copy}</p>${removeAction}`;
  }
  return `<button class="cta-red" type="button" data-player-action="friend" ${actions.friendAttr}><span class="cta-text cta-text-sm">${friendLabel}</span></button><button class="btn-dark" type="button" data-player-action="invite" ${actions.canSocialAttr}><span class="t-label f11">INVITE TO ROOM</span></button><button class="btn-dark" type="button" data-player-action="history" ${actions.historyAttr}><span class="t-label f11">MATCH HISTORY</span></button><button class="btn-dark" type="button" data-player-action="block" ${actions.canSocialAttr}><span class="t-label f11">BLOCK</span></button><button class="btn-dark" type="button" data-player-action="report" ${actions.canSocialAttr}><span class="t-label f11">REPORT</span></button>`;
}

function placementLabel(participant) {
  if (participant?.finalPlacement === 1) return "WIN";
  if (participant?.finalPlacement) return "PLACE " + participant.finalPlacement;
  return "MATCH";
}

function playerMatchRowHTML(match, player) {
  const participants = match.participants || [];
  const participant = participants.find((entry) => entry.isViewedPlayer)
    || participants.find((entry) => entry.displayNameAtMatch === player.displayName);
  const placement = placementLabel(participant);
  const date = esc(String(match.completedAt || "").slice(0, 10));
  const tone = placement === "WIN" ? "green" : "g100";
  const players = (match.participants || []).length;
  const events = (match.globalEvents || []).length;
  return '<div class="player-profile-match"><span class="t-micro ink-3">' + date + '</span><strong class="t-label f11 ' + tone + '">' + placement + '</strong><span class="t-micro ink-3">' + players + ' PLAYERS · ' + events + ' EVENTS</span></div>';
}

function renderRecentMatches(card, player) {
  if (!Array.isArray(player.recentMatches)) return;
  const recent = player.recentMatches.slice(0, 3).map((match) => playerMatchRowHTML(match, player)).join("");
  const matches = recent || '<span class="t-micro ink-3">NO PUBLIC MATCHES YET.</span>';
  card.insertAdjacentHTML("beforeend", '<section class="player-profile-recent"><div class="t-micro g400">RECENT MATCHES</div>' + matches + '</section>');
}

function historyScopesHTML() {
  return [["all", "ALL"], ["with-me", "WITH ME"], ["global", "GLOBAL EVENTS"]].map(([id, label]) => `<button class="player-history-scope${state.selectedPlayerHistoryScope === id ? " is-active" : ""}" type="button" role="tab" data-player-history-scope="${id}" aria-selected="${state.selectedPlayerHistoryScope === id}"><span class="t-label f11">${label}</span></button>`).join("");
}

function renderPlayerHistoryView(card, player) {
  const history = state.selectedPlayerHistory || [];
  const name = esc(player.displayName || player.name);
  const scopes = historyScopesHTML();
  card.innerHTML = `<div class="social-surface-head"><div><div class="t-micro g400">PLAYER RECORD · SHARED VIEW</div><h2 class="t-section g100" id="player-modal-title">${name}</h2><p class="t-body ink-2" id="player-modal-description">Recent match records visible to you.</p></div>${closeButtonHTML({ id: "player-modal-close", label: "Close player profile", className: "social-close" })}</div><div class="player-history-scopes" role="tablist" aria-label="Match history scope">${scopes}</div><div class="player-history-list thin-scroll">${playerHistoryHTML(history, player)}</div><button class="btn-dark social-back" id="player-modal-back" type="button"><span class="t-label f11">BACK TO PLAYER</span></button>`;
}

function isVoteKickPhase(phase) {
  return ["lobby", "playing"].includes(phase);
}

function isEligibleVoteKickTarget(player, localId, targetId) {
  if (player.bot) return false;
  if (player.bankrupt) return false;
  if (player.spectating) return false;
  return String(targetId) !== String(localId);
}

function isActiveHumanForVote(player) {
  return [!player.bot, !player.bankrupt, !player.spectating].every(Boolean);
}

function playerVoteKickHTML(player, localId, targetId) {
  if (!isVoteKickPhase(state.phase)) return "";
  if (!isEligibleVoteKickTarget(player, localId, targetId)) return "";
  const activeHumans = state.players.filter(isActiveHumanForVote);
  const voteDisabled = activeHumans.length < 3;
  const help = voteDisabled ? "A vote needs at least three human seats." : "A passed vote removes this seat from the room.";
  const disabled = voteDisabled ? 'disabled aria-describedby="player-votekick-help"' : "";
  return `<div class="player-profile-votekick"><button class="btn-dark" type="button" data-player-action="vote-kick" ${disabled}><span class="t-label f11">START VOTE KICK</span></button><span class="t-micro ink-3" id="player-votekick-help">${help}</span></div>`;
}

function playerProfileViewModel(player, accountId) {
  const friendStatus = currentFriendStatus(accountId);
  const friendLabel = friendButtonLabel(friendStatus);
  const isSelf = player.id === "p1";
  const canSocial = Boolean(player.accountId && !isSelf);
  const bits = playerIdentityBits(player);
  const facts = playerFactsBits(player);
  const actions = playerActionBits(player, canSocial, friendStatus);
  const localId = state.players[0]?.serverId || state.players[0]?.id;
  const targetId = player.serverId || player.roomPlayerId || player.id;
  return {
    player,
    bits,
    facts,
    canSocial,
    actions,
    friendLabel,
    voteAction: playerVoteKickHTML(player, localId, targetId),
  };
}

function playerProfileHTML(view) {
  const { player, bits, facts, canSocial, actions, friendLabel, voteAction } = view;
  return `<div class="social-surface-head"><div><div class="t-micro g400">PLAYER CARD · IN THIS ROOM</div><h2 class="t-section g100" id="player-modal-title">${bits.name}</h2><p class="t-body ink-2" id="player-modal-description">Public details only. Private cash, loans, and hidden records stay hidden.</p></div>${closeButtonHTML({ id: "player-modal-close", label: "Close player profile", className: "social-close" })}</div><div class="player-profile-head"><div class="player-profile-avatar">${avatarHTML(player, 6, 0)}</div><div><strong class="t-label f14 g100">${bits.name}</strong><span class="t-micro ink-3">${bits.online}</span></div></div><div class="player-profile-facts"><div><span class="t-micro ink-3">GAMES</span><strong class="t-label f13 g100">${facts.games}</strong></div><div><span class="t-micro ink-3">WINS</span><strong class="t-label f13 green">${facts.wins}</strong></div><div><span class="t-micro ink-3">ACHIEVEMENTS</span><strong class="t-label f13 g300">${facts.achievements}</strong></div><div><span class="t-micro ink-3">MUTUAL FRIENDS</span><strong class="t-label f13 g300">${facts.mutual}</strong></div></div><div class="player-profile-actions">${playerActionPanelHTML(player, canSocial, actions, friendLabel)}</div>${voteAction}`;
}

function renderPlayerProfileView(card, player, accountId) {
  const view = playerProfileViewModel(player, accountId);
  card.innerHTML = playerProfileHTML(view);
  renderRecentMatches(card, player);
}

export function renderPlayerSurface() {
  const card = $("#player-card");
  const player = state.selectedPlayer;
  if (!card || !player) return;
  const accountId = player.accountId || player.id;
  if (state.selectedPlayerView === "history") {
    renderPlayerHistoryView(card, player);
    return;
  }
  renderPlayerProfileView(card, player, accountId);
}
