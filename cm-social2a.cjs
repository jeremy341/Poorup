const fs = require("fs");
const MOD = "public/clientSocialSurfaces.js";
let lines = fs.readFileSync(MOD, "utf8").split(/\r?\n/);
function assert(cond, msg) { if (!cond) throw new Error("ASSERT: " + msg); }
function findFnStart(decl) {
  const i = lines.findIndex((l) => l === decl || l.startsWith(decl + "(") || l.startsWith(decl));
  assert(i >= 0, "start of " + decl);
  return i;
}
function fnEnd(startIdx) {
  let i = startIdx;
  while (lines[i] !== "}") i += 1;
  return i;
}
function replaceFn(decl, newCode) {
  const s = findFnStart(decl);
  const e = fnEnd(s);
  lines = [...lines.slice(0, s), ...newCode.split("\n"), ...lines.slice(e + 1)];
}
function insertBefore(decl, helperCode) {
  const s = findFnStart(decl);
  lines = [...lines.slice(0, s), ...helperCode.split("\n"), "", ...lines.slice(s)];
}
function subIn(line, from, to, expect) {
  const count = line.split(from).length - 1;
  assert(count === (expect === undefined ? 1 : expect), `sub x${count} != ${expect} for ${JSON.stringify(from.slice(0, 60))}`);
  return line.split(from).join(to);
}
function lineWith(pred) {
  const i = lines.findIndex(pred);
  assert(i >= 0, "line not found");
  return i;
}

// ---------- E. renderPlayerSurface + history view ----------
{
  const bigIdx = lineWith((l) => l.includes('const scopes = [["all", "ALL"]'));
  const scopesLine = lines[bigIdx];
  const histIdx = lineWith((l) => l.startsWith("    card.innerHTML = `<div class=\"social-surface-head\"><div><div class=\"t-micro g400\">PLAYER RECORD"));
  const histLine = lines[histIdx];
  const profIdx = lineWith((l) => l.startsWith("  card.innerHTML = `<div class=\"social-surface-head\"><div><div class=\"t-micro g400\">PLAYER CARD"));
  let profLine = lines[profIdx];
  profLine = subIn(profLine, 'id="player-modal-title">${esc(player.displayName || player.name)}</h2>', 'id="player-modal-title">${bits.name}</h2>');
  profLine = subIn(profLine, '<strong class="t-label f14 g100">${esc(player.displayName || player.name)}</strong>', '<strong class="t-label f14 g100">${bits.name}</strong>');
  profLine = subIn(profLine, '>${player.online === false ? "OFFLINE" : "IN THIS ROOM"}<', '>${bits.online}<');
  profLine = subIn(profLine, '>${player.stats?.gamesPlayed ?? "—"}<', '>${facts.games}<');
  profLine = subIn(profLine, '>${player.stats?.wins ?? "—"}<', '>${facts.wins}<');
  profLine = subIn(profLine, '>${player.achievementsPrivate ? "PRIVATE" : (player.achievements?.length ?? "—")}<', '>${facts.achievements}<');
  profLine = subIn(profLine, '>${player.mutualFriends ?? "—"}<', '>${facts.mutual}<');
  profLine = subIn(profLine, '${canSocial && friendStatus !== "accepted" && friendStatus !== "requested" ? "" : "disabled"}', '${actions.friendAttr}');
  profLine = subIn(profLine, '${canSocial && !player.historyPrivate ? "" : "disabled"}', '${actions.historyAttr}');
  profLine = subIn(profLine, '${canSocial ? "" : "disabled"}', '${actions.canSocialAttr}', 3);
  profLine = profLine.replace(/^    /, "  ");
  const nameEsc = histLine.includes('${esc(player.displayName || player.name)}');
  assert(nameEsc, "history name");
  const histNew = subIn(histLine, 'id="player-modal-title">${esc(player.displayName || player.name)}</h2>', 'id="player-modal-title">${name}</h2>');
  insertBefore("export function renderPlayerSurface", `function currentFriendStatus(accountId) {
  if (state.selectedPlayerRelationship !== "none") return state.selectedPlayerRelationship;
  const friends = state.social.friends || [];
  if (friends.some((friend) => friend.id === accountId)) return "accepted";
  return "none";
}

function friendButtonLabel(status) {
  if (status === "accepted") return "FRIENDS";
  if (status === "requested") return "REQUEST SENT";
  return "SEND FRIEND REQUEST";
}

function playerIdentityBits(player) {
  const name = esc(player.displayName || player.name);
  const online = player.online === false ? "OFFLINE" : "IN THIS ROOM";
  return { name, online };
}

function playerFactsBits(player) {
  const games = player.stats?.gamesPlayed ?? "—";
  const wins = player.stats?.wins ?? "—";
  const achievements = player.achievementsPrivate ? "PRIVATE" : (player.achievements?.length ?? "—");
  const mutual = player.mutualFriends ?? "—";
  return { games, wins, achievements, mutual };
}

function disabledWhen(off) {
  return off ? "disabled" : "";
}

function playerActionBits(player, canSocial, friendStatus) {
  const friendReady = canSocial && friendStatus !== "accepted" && friendStatus !== "requested";
  return {
    friendAttr: disabledWhen(!friendReady),
    canSocialAttr: disabledWhen(!canSocial),
    historyAttr: disabledWhen(!canSocial || player.historyPrivate),
  };
}

function placementLabel(participant) {
  if (participant?.finalPlacement === 1) return "WIN";
  if (participant?.finalPlacement) return "PLACE " + participant.finalPlacement;
  return "MATCH";
}

function playerMatchRowHTML(match, player) {
  const participants = match.participants || [];
  const participant = participants.find((entry) => entry.displayNameAtMatch === player.displayName);
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
  ${scopesLine.trim().replace("const scopes = ", "return ")}
}

function renderPlayerHistoryView(card, player) {
  const history = state.selectedPlayerHistory || [];
  const name = esc(player.displayName || player.name);
  const scopes = historyScopesHTML();
${histNew.replace(/^    /, "  ")}
}

function renderPlayerProfileView(card, player, accountId) {
  const friendStatus = currentFriendStatus(accountId);
  const friendLabel = friendButtonLabel(friendStatus);
  const isSelf = player.id === "p1";
  const canSocial = Boolean(player.accountId && !isSelf);
  const bits = playerIdentityBits(player);
  const facts = playerFactsBits(player);
  const actions = playerActionBits(player, canSocial, friendStatus);
${profLine}
  renderRecentMatches(card, player);
}`);
  replaceFn("export function renderPlayerSurface", `export function renderPlayerSurface() {
  const card = $("#player-card");
  const player = state.selectedPlayer;
  if (!card || !player) return;
  const accountId = player.accountId || player.id;
  if (state.selectedPlayerView === "history") {
    renderPlayerHistoryView(card, player);
    return;
  }
  renderPlayerProfileView(card, player, accountId);
}`);
}

// ---------- D. playerHistoryHTML ----------
{
  const s = findFnStart("function playerHistoryHTML");
  const e = fnEnd(s);
  let bigIdx = -1;
  for (let i = s; i <= e; i += 1) if (lines[i].includes("player-history-row")) bigIdx = i;
  assert(bigIdx > 0, "history big line");
  const big = lines[bigIdx];
  const BOUNDARY = "'</strong></div><div class=\"player-history-meta\"><span class=\"t-micro ink-3\">'";
  assert(big.includes(BOUNDARY), "meta boundary");
  const head = big.slice(0, big.indexOf(BOUNDARY)) + "'</strong></div>' + playerHistoryMetaHTML(participants, deeds, events, combos);";
  insertBefore("function playerHistoryHTML", `function historyScopeMatch(entry, scope) {
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
  if (participant) return participant.finalPlacement === 1;
  if (entry.won === true) return true;
  return entry.result === 'WIN';
}

function historyRowDate(entry) {
  return String(entry.completedAt || entry.playedAt || '').slice(0, 10) || 'UNKNOWN DATE';
}

function historyRowDeeds(participant, entry) {
  if (participant?.propertyCount != null) return participant.propertyCount;
  if (entry.properties != null) return entry.properties;
  return 0;
}

function playerHistoryMetaHTML(participants, deeds, events, combos) {
  const eventsTone = events ? 'g300' : 'ink-3';
  const combosTone = combos ? 'g300' : 'ink-3';
  return '<div class="player-history-meta"><span class="t-micro ink-3">' + participants + ' PLAYERS</span><span class="t-micro ink-3">' + deeds + ' DEEDS</span><span class="t-micro ' + eventsTone + '">' + events + ' EVENTS</span><span class="t-micro ' + combosTone + '">' + combos + ' COMBOS</span></div></article>';
}

function historyRowHTML(entry, index, history, player) {
  const participant = historyParticipant(entry, player);
  const won = historyRowWon(participant, entry);
  const date = historyRowDate(entry);
  const deeds = historyRowDeeds(participant, entry);
  const participants = Array.isArray(entry.participants) ? entry.participants.length : '—';
  const events = Array.isArray(entry.globalEvents) ? entry.globalEvents.length : 0;
  const combos = Array.isArray(entry.eventCombinations) ? entry.eventCombinations.length : 0;
  ${head.trim()};
}`);
  const exprHead = head.trim();
  replaceFn("function playerHistoryHTML", `function playerHistoryHTML(history, player) {
  const scope = state.selectedPlayerHistoryScope || "all";
  const filtered = history.filter((entry) => historyScopeMatch(entry, scope));
  if (!filtered.length) return '<p class="t-body ink-3 social-empty">NO MATCHES IN THIS HISTORY VIEW.</p>';
  return filtered.map((entry, index) => historyRowHTML(entry, index, history, player)).join('');
}`);
}

fs.writeFileSync(MOD, lines.join("\n"));
console.log("E+D done, lines:", lines.length);

