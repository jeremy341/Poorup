/* ============================================================
   PROFILE SURFACES: identity display source, profile summary,
   statistics deck, history rows, library tiles, the face editor
   canvas renderers, and the guest-alias field. Socket-backed
   saves and view switching stay in the entry module; the
   achievements renderer is injected as a host callback.
   ============================================================ */
import { $, esc } from "./clientDom.js";
import { state, getProfileById, getAppearanceMeta } from "./clientState.js";
import { spriteFromGrid, avatarHTML, hydrateSprites } from "./clientSprites.js";
import { CONNECTION_COPY } from "./clientTopNavRender.js";
import { MAX_PROFILES, profileDesignName } from "./clientSanitize.js";

const PROFILE_SWATCHES = ["#d74438", "#286ea1", "#d9a62f", "#35a653", "#a04e6f", "#3e7d7b", "#7b5029", "#cfa75f"];
const FACE_PALETTE = ["#f0d9ac", "#e8d3ab", "#cfa75f", "#c88f2e", "#9b783d", "#5c5033", "#01070a", "#ffffff", "#d74438", "#35a653", "#286ea1", "#d9a62f"];

let host = { renderAchievements: () => {}, loadSavedGame: () => null };

export function configureProfileRender(hooks) {
  host = { ...host, ...hooks };
}

function setText(sel, value) {
  const el = $(sel);
  if (el) el.textContent = value;
}

function setHTML(sel, value) {
  const el = $(sel);
  if (el) el.innerHTML = value;
}

function replaceText(sel, value) {
  $(sel)?.replaceChildren(document.createTextNode(value));
}

export function accountRate(stats = {}) {
  const games = Number(stats.gamesPlayed) || 0;
  return games ? `${Math.round(((Number(stats.wins) || 0) / games) * 100)}%` : "0%";
}

function sourceName(account) {
  if (account?.displayName) return account.displayName;
  return state.alias || "PLAYER";
}

export function selectedProfile() {
  if (typeof state.appearance !== "string") return null;
  return getProfileById(state.appearance) || null;
}

function sourceColor(draft, profile, account, activeMeta) {
  if (draft?.color) return draft.color;
  if (profile?.color) return profile.color;
  if (account?.color) return account.color;
  if (activeMeta.color) return activeMeta.color;
  return "#d74438";
}

function sourceGrid(draft, profile, account) {
  if (draft?.grid) return draft.grid;
  if (profile?.avatarGrid) return profile.avatarGrid;
  return account?.avatarGrid || null;
}

export function profileDisplaySource() {
  const account = state.account?.account || null;
  const draft = state.profileDraft || null;
  const profile = draft || selectedProfile();
  const activeMeta = getAppearanceMeta(state.appearance);
  const name = sourceName(account);
  const color = sourceColor(draft, profile, account, activeMeta);
  const grid = sourceGrid(draft, profile, account);
  const designName = profile ? profileDesignName(profile) : activeMeta.label;
  return { account, profile, name, color, grid, designName };
}

function heroAvatarMarkup(grid, color, size) {
  if (grid) return spriteFromGrid(grid, size);
  return avatarHTML({ color }, size, 0);
}

function renderProfileHero(source, displayName) {
  const { account, grid, color } = source;
  setHTML("#profile-hero-avatar", heroAvatarMarkup(grid, color, 6));
  setHTML("#profile-overview-avatar", heroAvatarMarkup(grid, color, 5));
  replaceText("#profile-hero-name", displayName);
  replaceText("#profile-overview-name", displayName);
  setText("#profile-hero-handle", account ? `@${account.username}` : "GUEST MODE");
  const stateLabel = $("#profile-hero-state");
  if (stateLabel) {
    stateLabel.textContent = account
      ? "ACCOUNT PLAYER · STATS SYNCED AFTER COMPLETED ROUNDS"
      : "LOCAL PLAYER · READY FOR THE NEXT TABLE";
    stateLabel.classList.toggle("is-account", Boolean(account));
  }
  const heroAction = $("#profile-hero-account-btn");
  if (heroAction) {
    heroAction.querySelector(".t-label").textContent = account ? "EDIT ACCOUNT" : "CREATE ACCOUNT";
  }
}

function profileStatCells(account) {
  const accountStats = account?.stats || {};
  return {
    games: Number(accountStats.gamesPlayed) || 0,
    wins: Number(accountStats.wins) || 0,
    rate: accountRate(accountStats),
    bankruptcies: Number(accountStats.bankruptcies) || 0,
  };
}

function joinedLabel(account) {
  if (!account?.createdAt) return "GUEST";
  const opts = { month: "short", year: "numeric" };
  return new Date(account.createdAt).toLocaleDateString(undefined, opts).toUpperCase();
}

function renderProfileStats(source) {
  const account = source.account;
  const stats = profileStatCells(account);
  replaceText("#profile-stat-games", String(stats.games));
  replaceText("#profile-stat-wins", String(stats.wins));
  replaceText("#profile-stat-rate", stats.rate);
  replaceText("#profile-stat-bankruptcies", String(stats.bankruptcies));
  setText("#profile-stat-joined", joinedLabel(account));
}

function overviewStatusText() {
  if (state.connectionStatus === "online") return "READY";
  return (CONNECTION_COPY[state.connectionStatus] || "OFFLINE").toUpperCase();
}

function renderProfileOverview(source) {
  const account = source.account;
  replaceText("#profile-overview-mode", account ? `@${account.username}` : "GUEST MODE");
  setText("#profile-overview-status", overviewStatusText());
  setText("#profile-overview-sync", account ? "ACCOUNT SYNC" : "LOCAL ONLY");
}

function renderProfileToggles() {
  setText("#profile-sound-state", state.sound ? "SOUND ON" : "SOUND OFF");
  setText("#profile-music-state", state.music ? "MUSIC ON" : "MUSIC OFF");
}

export function renderProfileSummary() {
  const source = profileDisplaySource();
  const safeName = String(source.name || "PLAYER").trim() || "PLAYER";
  const displayName = safeName.toUpperCase();
  renderProfileHero(source, displayName);
  renderProfileStats(source);
  renderProfileOverview(source);
  renderProfileToggles();
  renderProfileStatistics();
  renderProfileHistory();
  host.renderAchievements();
}

export function formatStatDate(value) {
  if (!value) return "ROUND";
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return "ROUND";
  return date.toLocaleDateString(undefined, { month: "short", day: "numeric" }).toUpperCase();
}

function cleanHistory(entries) {
  return entries.filter((entry) => entry && typeof entry === "object").slice(0, 50);
}

function accountHistoryList(account) {
  const matchHistory = Array.isArray(account?.matchHistory) ? account.matchHistory : null;
  if (matchHistory && matchHistory.length) return cleanHistory(matchHistory);
  if (Array.isArray(account?.history)) return cleanHistory(account.history);
  return [];
}

function ownParticipant(entry, accountId) {
  if (!Array.isArray(entry.participants)) return null;
  return entry.participants.find((item) => item.accountId === accountId) || null;
}

function ownMatchValue(entry, accountId, key, fallback = 0) {
  const participant = ownParticipant(entry, accountId);
  const raw = participant?.[key] ?? entry[key] ?? fallback;
  return Math.max(0, Number(raw) || 0);
}

function entryWon(entry, accountId) {
  const own = ownParticipant(entry, accountId);
  if (own) return own.finalPlacement === 1;
  if (String(entry.result || "").toUpperCase() === "WIN") return true;
  return entry.won === true;
}

function baseSummary(account) {
  const stats = account?.stats || {};
  const games = Math.max(0, Number(stats.gamesPlayed) || 0);
  const wins = Math.max(0, Math.min(games, Number(stats.wins) || 0));
  const bankruptcies = Math.max(0, Number(stats.bankruptcies) || 0);
  return {
    account,
    stats,
    games,
    wins,
    bankruptcies,
    winShare: games ? Math.round((wins / games) * 100) : 0,
  };
}

function historyValues(history, accountId) {
  const cashOf = (entry) => ownMatchValue(entry, accountId, "endingCash");
  const propsOf = (entry) => ownMatchValue(entry, accountId, "propertyCount", entry.properties);
  if (!history.length) return { averageCash: null, bestCash: null, bestProperties: null };
  return {
    averageCash: Math.round(history.reduce((sum, entry) => sum + cashOf(entry), 0) / history.length),
    bestCash: Math.max(...history.map(cashOf)),
    bestProperties: Math.max(...history.map(propsOf)),
  };
}

function record(label, value, tone = "g100") {
  return `<div class="stats-record"><span class="t-micro ink-3">${label}</span><strong class="t-label f16 ${tone}">${value}</strong></div>`;
}

function numStat(stats, key) {
  return String(stats[key] || 0);
}

function moneyStat(stats, key) {
  return "$" + Number(stats[key] || 0).toLocaleString();
}

function roundCells(ctx) {
  const gated = ctx.account;
  const s = ctx.stats;
  return [
    ["ROUNDS", gated ? String(ctx.games) : "—", "g100"],
    ["WINS", gated ? String(ctx.wins) : "—", "green"],
    ["WIN RATE", gated ? `${ctx.winShare}%` : "—", "g300"],
    ["BANKRUPTCIES", gated ? String(ctx.bankruptcies) : "—", "g-muted"],
    ["EVENT SURVIVAL", gated ? numStat(s, "eventSurvival") : "—", "g300"],
    ["AUCTION WINS", gated ? numStat(s, "auctionWins") : "—", "g100"],
  ];
}

function economyCells(ctx) {
  const gated = ctx.account;
  const s = ctx.stats;
  return [
    ["CASINO NET", gated ? moneyStat(s, "casinoNet") : "—", "green"],
    ["MARKET P/L", gated ? moneyStat(s, "marketProfit") : "—", "g300"],
    ["PATROL BEST", gated ? numStat(s, "patrolBest") : "—", "g300"],
    ["BANK LOANS REPAID", gated ? numStat(s, "bankLoanRepayments") : "—", "g100"],
    ["LOANS GIVEN", gated ? numStat(s, "playerLoansGiven") : "—", "g100"],
    ["EQUITY DEALS", gated ? numStat(s, "equityDeals") : "—", "g100"],
  ];
}

function metricGridHTML(ctx) {
  const cells = [...roundCells(ctx), ...economyCells(ctx)];
  return cells.map(([label, value, tone]) => record(label, value, tone)).join("");
}

function trendBarHTML(entry, accountId) {
  const won = entryWon(entry, accountId);
  const label = won ? "WIN" : "ROUND";
  const height = won ? 100 : 30;
  const tone = won ? "green" : "ink-3";
  const barState = won ? "is-win" : "is-loss";
  const dateLabel = formatStatDate(entry.completedAt || entry.playedAt);
  return `<div class="stats-bar-column"><span class="stats-bar-value t-micro ${tone}">${label}</span><span class="stats-bar ${barState}" style="--bar-height:${height}%" title="${dateLabel} · ${label}"></span><span class="stats-bar-label t-micro ink-3">${dateLabel}</span></div>`;
}

function trendEmptyHTML(account) {
  const headline = account ? "NO ROUND HISTORY YET" : "ACCOUNT HISTORY UNAVAILABLE";
  const blurb = account
    ? "Complete a server round to unlock this trend."
    : "Create an account to sync completed-round statistics.";
  return `<div class="stats-chart-empty"><span data-sprite="diamond" data-size="4"></span><strong class="t-label f12 g100">${headline}</strong><span class="t-micro ink-3">${blurb}</span></div>`;
}

function trendBarsHTML(ctx) {
  if (!ctx.chronological.length) return trendEmptyHTML(ctx.account);
  return ctx.chronological.map((entry) => trendBarHTML(entry, ctx.accountId)).join("");
}

function trendTableRowHTML(entry, index, accountId) {
  const won = entryWon(entry, accountId);
  const resultCls = won ? "green" : "ink-2";
  const resultLabel = won ? "WIN" : "ROUND";
  const cash = ownMatchValue(entry, accountId, "endingCash").toLocaleString();
  const props = ownMatchValue(entry, accountId, "propertyCount", entry.properties);
  const dateLabel = formatStatDate(entry.completedAt || entry.playedAt);
  const num = String(index + 1).padStart(2, "0");
  return `<tr><th scope="row">${dateLabel} · ${num}</th><td class="${resultCls}">${resultLabel}</td><td>$${cash}</td><td>${props}</td></tr>`;
}

function trendTableHTML(ctx) {
  if (!ctx.chronological.length) return "";
  const rows = ctx.chronological.map((entry, index) => trendTableRowHTML(entry, index, ctx.accountId)).join("");
  return `<table class="stats-data-table"><caption>Recent round results</caption><thead><tr><th scope="col">ROUND</th><th scope="col">RESULT</th><th scope="col">ENDING CASH</th><th scope="col">PROPERTIES</th></tr></thead><tbody>${rows}</tbody></table>`;
}

function statsIntroHTML(ctx) {
  const cls = ctx.account ? "green" : "g300";
  const sourceLabel = ctx.account ? "ACCOUNT SYNC" : "LOCAL ONLY";
  return `<div class="stats-intro panel noise"><div><div class="t-micro g400">PERFORMANCE DECK</div><h2 class="t-section g100">Player Statistics</h2><p class="t-body ink-2">A readable record of the rounds you have finished, not a live ranking or a promise of future results.</p></div><span class="t-micro stats-source ${cls}">${sourceLabel}</span></div>`;
}

function statsTrendPanelHTML(ctx) {
  const count = ctx.chronological.length || 0;
  return `<section class="panel noise pad16 stats-trend-panel" aria-labelledby="stats-trend-heading"><div class="stats-panel-head"><div><div class="t-micro g400">RECENT FORM</div><h3 class="t-section g100" id="stats-trend-heading">Win history</h3></div><span class="t-micro ink-3">LAST ${count} ROUNDS</span></div><div class="stats-chart" role="img" aria-label="Win history chart showing ${ctx.wins} wins across ${ctx.games} completed rounds"><div class="stats-chart-y"><span class="t-micro ink-3">WIN</span><span class="t-micro ink-3">ROUND</span></div><div class="stats-chart-plot"><div class="stats-chart-grid" aria-hidden="true"><span></span><span></span><span></span><span></span></div><div class="stats-chart-bars">${trendBarsHTML(ctx)}</div></div></div>${trendTableHTML(ctx)}</section>`;
}

function moneyCell(label, value, tone) {
  if (value == null) return record(label, "—", tone);
  return record(label, `$${value.toLocaleString()}`, tone);
}

function propertiesCell(bestProperties) {
  if (bestProperties == null) return record("MOST PROPERTIES", "—", "g300");
  return record("MOST PROPERTIES", String(bestProperties), "g300");
}

function dataWindowCell(ctx) {
  if (!ctx.account) return record("DATA WINDOW", "ACCOUNT ONLY", "g-muted");
  if (!ctx.historyLength) return record("DATA WINDOW", "NO ROUNDS", "g-muted");
  return record("DATA WINDOW", `${ctx.historyLength} ROUNDS`, "g-muted");
}

function statsRecordsPanelHTML(ctx) {
  const records = moneyCell("AVG ENDING CASH", ctx.averageCash, "g100")
    + moneyCell("BEST CASH STACK", ctx.bestCash, "green")
    + propertiesCell(ctx.bestProperties)
    + dataWindowCell(ctx);
  return `<section class="panel noise pad16 stats-records-panel" aria-labelledby="stats-records-heading"><div class="stats-panel-head"><div><div class="t-micro g400">PARLOR RECORDS</div><h3 class="t-section g100" id="stats-records-heading">Personal bests</h3></div><span class="t-micro ink-3">VERIFIED ROUNDS</span></div><div class="stats-record-list">${records}</div><p class="t-micro ink-3 stats-method">Values are calculated from completed server rounds. No estimates are shown.</p></section>`;
}

function statisticsHTML(ctx) {
  return `${statsIntroHTML(ctx)}
    <div class="stats-metric-grid" aria-label="Performance summary">${metricGridHTML(ctx)}</div>
    <div class="stats-content-grid">${statsTrendPanelHTML(ctx)}${statsRecordsPanelHTML(ctx)}</div>`;
}

export function renderProfileStatistics() {
  const root = $("#profile-statistics-content");
  if (!root) return;
  const account = state.account?.account || null;
  const base = baseSummary(account);
  const history = accountHistoryList(account);
  const values = historyValues(history, account?.id);
  const ctx = {
    ...base,
    ...values,
    accountId: account?.id,
    historyLength: history.length,
    chronological: [...history].reverse().slice(-12),
  };
  root.innerHTML = statisticsHTML(ctx);
  hydrateSprites(root);
}

function listSize(list, fallback) {
  if (Array.isArray(list)) return list.length;
  return fallback;
}

function deedCount(participant, entry) {
  if (participant?.propertyCount != null) return participant.propertyCount;
  if (entry.properties != null) return entry.properties;
  return 0;
}

function casinoNet(entry, accountId) {
  if (!Array.isArray(entry.casino)) return 0;
  const recordEntry = entry.casino.find((item) => item.accountId === accountId);
  return recordEntry?.net || 0;
}

function participantNames(entry) {
  if (!Array.isArray(entry.participants)) return "";
  return entry.participants.map((item) => item.displayNameAtMatch).filter(Boolean).slice(0, 4).join(" · ");
}

function rowEntryWon(participant, entry) {
  if (participant) return participant.finalPlacement === 1;
  if (entry.won === true) return true;
  return entry.result === "WIN";
}

function rowOutcomeHTML(won) {
  const cls = won ? "green" : "g100";
  const label = won ? "WIN" : "ROUND COMPLETE";
  return '<span class="t-label f12 ' + cls + '">' + label + "</span>";
}

function eventsCellHTML(events) {
  const tone = events ? "g300" : "ink-3";
  return '<span class="t-micro ' + tone + '">' + events + " EVENTS</span>";
}

function plainCell(label, value) {
  return '<span class="t-micro ink-3">' + label + " " + value + "</span>";
}

function casinoCellHTML(casino) {
  const tone = casino >= 0 ? "green" : "red";
  const sign = casino >= 0 ? "+" : "";
  return '<span class="t-micro ' + tone + '">CASINO ' + sign + "$" + Number(casino).toLocaleString() + "</span>";
}

function participantsCellHTML(names) {
  if (!names) return "";
  return '<span class="t-micro profile-history-participants">' + esc(names) + "</span>";
}

export function profileHistoryRowHTML(entry, index, total, accountId) {
  const participant = ownParticipant(entry, accountId);
  const won = rowEntryWon(participant, entry);
  const date = formatStatDate(entry.completedAt || entry.playedAt);
  const deeds = deedCount(participant, entry);
  const players = listSize(entry.participants, "—");
  const events = listSize(entry.globalEvents, 0);
  const casino = casinoNet(entry, accountId);
  const contracts = listSize(entry.playerContracts, 0);
  const trades = Number(entry.tradesCompleted) || 0;
  const auctions = Number(entry.auctionsCompleted) || 0;
  const names = participantNames(entry);
  const lead = String(total - index).padStart(2, "0");
  return '<article class="profile-history-row' + (won ? " is-win" : "") + '"><span class="profile-history-index t-micro ink-3">' + lead
    + '</span><div class="profile-history-main">' + rowOutcomeHTML(won)
    + '<span class="t-micro ink-3">' + date + " · " + players + " PLAYERS</span>" + participantsCellHTML(names)
    + '</div><div class="profile-history-meta">' + plainCell("DEEDS", deeds) + eventsCellHTML(events)
    + plainCell("TRADES", trades) + plainCell("AUCTIONS", auctions) + casinoCellHTML(casino)
    + plainCell("DEALS", contracts) + "</div></article>";
}

function emptyHistoryPanelHTML(account) {
  const message = account
    ? "NO COMPLETED ROUNDS YET. YOUR FIRST FINISH WILL APPEAR HERE."
    : "SIGN IN TO KEEP A SERVER-SYNCED ROUND HISTORY.";
  return `<section class="panel noise pad16 profile-empty-panel"><div class="section-title"><span data-sprite="diamond" data-size="3"></span><h2 class="t-section g300">Completed rounds</h2></div><p class="t-body ink-2">${message}</p><p class="t-micro ink-3">Only completed server rounds appear here. Guest play remains available without an account.</p></section>`;
}

function historyPanelHTML(history, accountId) {
  const rows = history.map((entry, index) => profileHistoryRowHTML(entry, index, history.length, accountId)).join("");
  return `<section class="panel noise pad16"><div class="section-title"><span data-sprite="diamond" data-size="3"></span><h2 class="t-section g300">Completed rounds</h2><span class="t-micro ink-3">${history.length} SAVED</span></div><div class="profile-history-list">${rows}</div><p class="t-micro ink-3 profile-history-note">History is recorded when a server round finishes. Detailed participants, events, and economy results stay inside your private account record.</p></section>`;
}

export function renderProfileHistory() {
  const root = $("#profile-history-content");
  if (!root) return;
  const account = state.account?.account || null;
  const history = accountHistoryList(account);
  if (!account || !history.length) {
    root.innerHTML = emptyHistoryPanelHTML(account);
    hydrateSprites(root);
    return;
  }
  root.innerHTML = historyPanelHTML(history, account.id);
  hydrateSprites(root);
}

function accountAvatarMarkup(visual) {
  if (visual.grid) return spriteFromGrid(visual.grid, 4);
  return avatarHTML({ color: visual.color }, 4, 0);
}

function renderSignedAccountPanel(account) {
  const visual = profileDisplaySource();
  setHTML("#account-avatar", accountAvatarMarkup(visual));
  replaceText("#account-display-name", account.displayName);
  replaceText("#account-username", `@${account.username}`);
  replaceText("#account-games", String(account.stats?.gamesPlayed || 0));
  replaceText("#account-wins", String(account.stats?.wins || 0));
  replaceText("#account-rate", accountRate(account.stats));
}

export function renderAccountPanel() {
  const signedIn = Boolean(state.account?.account);
  const guest = $("#account-guest-state");
  const signed = $("#account-signed-state");
  guest?.classList.toggle("is-hidden", signedIn);
  signed?.classList.toggle("is-hidden", !signedIn);
  setText("#account-panel-title", signedIn ? `@${state.account.account.username}` : "Guest mode");
  setText("#account-panel-badge", signedIn ? "ACCOUNT ACTIVE" : "LOCAL ONLY");
  renderProfileSummary();
  if (!signedIn) return;
  renderSignedAccountPanel(state.account.account);
}

function configureDesignButtons(atCap) {
  const newBtn = $("#pl-new-btn");
  if (newBtn) {
    newBtn.disabled = atCap;
    newBtn.querySelector(".t-label").textContent = atCap ? `MAX ${MAX_PROFILES} DESIGNS` : "+ NEW DESIGN";
  }
  const saveBtn = $("#pl-save-btn");
  if (saveBtn) {
    saveBtn.disabled = !state.profileDraft || atCap;
    saveBtn.querySelector(".cta-text").textContent = atCap ? `MAX ${MAX_PROFILES} DESIGNS` : "SAVE DESIGN";
  }
}

function emptyLibraryMessage() {
  return `<p class="pl-empty">No custom designs yet — press <strong style="color:var(--gold-300)">+ NEW DESIGN</strong> to draw your first player.</p>`;
}

function draftCard() {
  const draft = state.profileDraft;
  if (!draft || state.editingProfileId) return null;
  return { id: "draft", designName: draft.designName || "UNTITLED DESIGN", color: draft.color, avatarGrid: draft.grid, isDraft: true };
}

function cardForProfile(profile, i, draft) {
  if (!draft || state.editingProfileId !== profile.id) {
    return { ...profile, designName: profileDesignName(profile), isEditing: false, seed: i };
  }
  return {
    ...profile,
    designName: draft.designName || "UNTITLED DESIGN",
    color: draft.color,
    avatarGrid: draft.grid,
    isEditing: true,
    seed: i,
  };
}

function tileClasses(p, selected) {
  const cls = ["pl-tile"];
  if (selected) cls.push("is-active");
  if (p.isDraft) cls.push("is-draft");
  if (p.isEditing) cls.push("is-editing");
  return cls.join(" ");
}

function tileStateLabel(selected, editing) {
  if (editing) return `<span class="t-micro ink-3">EDITING · LIVE PREVIEW</span>`;
  if (selected) return `<span class="t-micro ink-3">ACTIVE DESIGN</span>`;
  return `<span class="t-micro ink-3">TAP TO SELECT</span>`;
}

function tileSelectHTML(p, i, selected) {
  const entity = { color: p.color, avatarGrid: p.avatarGrid };
  const name = `<span class="t-label pl-tile-name" style="color:${p.color}">${esc(p.designName)}</span>`;
  const av = `<span class="pl-tile-av">${avatarHTML(entity, 3, i)}</span>`;
  if (p.isDraft) {
    return `<div class="pl-tile-select pl-tile-draft" aria-label="Unsaved design preview">${av}<span class="pl-tile-info">${name}<span class="t-micro g400">UNSAVED DRAFT · LIVE PREVIEW</span></span></div>`;
  }
  const status = tileStateLabel(selected, Boolean(p.isEditing));
  return `<button class="pl-tile-select" type="button" data-profile-select="${p.id}" aria-pressed="${selected}">${av}<span class="pl-tile-info">${name}${status}</span></button>`;
}

function tileActionsHTML(p) {
  if (p.isDraft) {
    return `<div class="pl-tile-actions"><span class="t-micro g400 pl-draft-badge">DRAFT</span></div>`;
  }
  return `<div class="pl-tile-actions"><button class="btn-dark" type="button" data-profile-edit="${p.id}"><span class="t-label">EDIT</span></button><button class="btn-dark pl-delete" type="button" data-profile-delete="${p.id}"><span class="t-label">DELETE</span></button></div>`;
}

function libraryTileHTML(p, i, activeId) {
  const selected = !p.isDraft && p.id === activeId;
  return `<div class="${tileClasses(p, selected)}">
      ${tileSelectHTML(p, i, selected)}
      ${tileActionsHTML(p)}
    </div>`;
}

export function renderProfileLibrary() {
  const atCap = state.profiles.length >= MAX_PROFILES;
  configureDesignButtons(atCap);
  const list = $("#pl-list");
  if (!list) return;
  if (!state.profiles.length) {
    if (!state.profileDraft) {
      list.innerHTML = emptyLibraryMessage();
      return;
    }
  }
  const activeId = typeof state.appearance === "string" ? state.appearance : null;
  const draft = state.profileDraft;
  const cards = state.profiles.map((profile, i) => cardForProfile(profile, i, draft));
  const draftEntry = draftCard();
  if (draftEntry) cards.unshift(draftEntry);
  list.innerHTML = cards.map((p, i) => libraryTileHTML(p, i, activeId)).join("");
}

function homeColor(saved, account, preset) {
  if (saved?.color) return saved.color;
  if (account?.color) return account.color;
  if (preset.color) return preset.color;
  return "#d74438";
}

function homeAvatarHTML(source, color, size) {
  if (source?.avatarGrid) return spriteFromGrid(source.avatarGrid, size);
  return avatarHTML({ color }, size, 0);
}

export function applyProfileToHomeUI() {
  const saved = selectedProfile();
  const account = state.account?.account || null;
  const name = sourceName(account);
  const color = homeColor(saved, account, getAppearanceMeta(state.appearance));
  const avatarSource = saved || account;

  document.querySelectorAll("[data-global-you-name]").forEach((nameNode) => {
    nameNode.textContent = name;
  });
  document.querySelectorAll("[data-global-you-avatar]").forEach((avatarNode) => {
    avatarNode.innerHTML = homeAvatarHTML(avatarSource, color, 3);
  });

  setText("#chair-name", `that's you, ${name}`);
  setHTML("#chair-avatar", homeAvatarHTML(avatarSource, color, 4));

  const resumeBtn = $("#resume-btn");
  if (resumeBtn) resumeBtn.classList.toggle("is-hidden", !host.loadSavedGame());
  renderGuestAliasField();
}

function syncAliasInput(input, signedIn) {
  if (!input) return;
  if (signedIn) return;
  if (input.value === state.alias) return;
  input.value = state.alias;
}

export function renderGuestAliasField(errorText = "") {
  const signedIn = Boolean(state.account?.account);
  $("#home-alias-form")?.classList.toggle("is-hidden", signedIn);
  syncAliasInput($("#home-alias"), signedIn);
  setText("#home-alias-error", errorText);
}

export function requireGuestAlias() {
  if (state.account?.account) return true;
  const alias = String(state.alias || "").trim();
  if (alias) return true;
  renderGuestAliasField("CREATE AN ALIAS BEFORE JOINING A TABLE.");
  $("#home-alias")?.focus({ preventScroll: true });
  return false;
}

function swatchHTML(c, d) {
  const active = c.toLowerCase() === d.color.toLowerCase();
  return `<button type="button" class="profile-swatch${active ? " is-active" : ""}" style="background:${c}" data-color="${c}" title="${c}"></button>`;
}

function faceSwatchHTML(c, d) {
  const active = d.tool === "paint" && c.toLowerCase() === d.paintColor.toLowerCase();
  return `<button type="button" class="face-swatch${active ? " is-active" : ""}" style="background:${c}" data-ink="${c}" title="${c}"></button>`;
}

function faceCellHTML(c, x, y) {
  const style = c ? `background-color:${c};background-image:none` : "";
  return `<span class="face-cell" data-x="${x}" data-y="${y}" style="${style}"></span>`;
}

export function renderProfileEditor() {
  const d = state.profileDraft;
  if (!d) return;
  const deleteBtn = $("#profile-delete-btn");
  if (deleteBtn) deleteBtn.classList.toggle("is-hidden", !state.editingProfileId);
  const saveLabel = $("#profile-save-btn")?.querySelector(".cta-text");
  if (saveLabel) saveLabel.textContent = state.editingProfileId ? "Save Changes" : "Save Design";
  const modeLabel = $("#profile-editor-mode");
  if (modeLabel) modeLabel.textContent = state.editingProfileId ? "EDIT PLAYER DESIGN" : "NEW PLAYER DESIGN";

  // identity swatches
  $("#profile-swatches").innerHTML = PROFILE_SWATCHES.map((c) => swatchHTML(c, d)).join("");
  $("#profile-color-picker").value = d.color;
  $("#profile-name").value = d.designName;

  // face palette
  $("#face-palette").innerHTML = FACE_PALETTE.map((c) => faceSwatchHTML(c, d)).join("");
  $("#face-color-picker").value = d.paintColor;
  $("#face-tool-paint").classList.toggle("is-active", d.tool === "paint");
  $("#face-tool-erase").classList.toggle("is-active", d.tool === "erase");

  // pixel canvas
  const canvas = $("#face-canvas");
  canvas.innerHTML = d.grid
    .map((row, y) => row.map((c, x) => faceCellHTML(c, x, y)).join(""))
    .join("");

  updateProfilePreview();
  renderProfileSummary();
}

export function updateProfilePreview() {
  const d = state.profileDraft;
  if (!d) return;
  const av = $("#profile-preview-av");
  if (av) av.innerHTML = spriteFromGrid(d.grid, 6);
  const nameEl = $("#profile-preview-name");
  if (nameEl) {
    nameEl.textContent = (d.designName || "UNTITLED DESIGN").toUpperCase();
    nameEl.style.color = d.color;
  }
  renderProfileLibrary();
  renderProfileSummary();
}

export function paintFaceCell(x, y) {
  const d = state.profileDraft;
  if (!d) return;
  const color = d.tool === "erase" ? null : d.paintColor;
  if (d.grid[y][x] === color) return;
  d.grid[y][x] = color;
  const cell = $(`#face-canvas .face-cell[data-x="${x}"][data-y="${y}"]`);
  if (cell) {
    cell.style.backgroundColor = color || "";
    cell.style.backgroundImage = color ? "none" : "";
  }
  updateProfilePreview();
}
