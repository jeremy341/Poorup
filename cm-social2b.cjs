const fs = require("fs");
const MOD = "public/clientSocialSurfaces.js";
let lines = fs.readFileSync(MOD, "utf8").split(/\r?\n/);
function assert(cond, msg) { if (!cond) throw new Error("ASSERT: " + msg); }
function findIdx(pred, msg) { const i = lines.findIndex(pred); assert(i >= 0, msg); return i; }
function fnEnd(startIdx) { let i = startIdx; while (lines[i] !== "}") i += 1; return i; }
function subIn(line, from, to, expect) {
  const count = line.split(from).length - 1;
  assert(count === (expect === undefined ? 1 : expect), `sub x${count} != ${expect} for ${JSON.stringify(from.slice(0, 60))}`);
  return line.split(from).join(to);
}

// ---------- A. openRankingsSurface ----------
{
  const s = findIdx((l) => l.startsWith("export function openRankingsSurface"), "openRankings");
  const metricLine = lines[s + 1];
  const mm = metricLine.match(/= (\[.*\])\.includes\(metric\)/);
  assert(mm, "metric list");
  assert(lines[s + 2].includes(".includes(scope)"), "scope line");
  const emit = findIdx((l) => l.includes('emitServer("get-leaderboard-snapshot"'), "emit line");
  assert(emit > s && emit < s + 20, "emit within fn");
  let cbEnd = emit;
  while (lines[cbEnd] !== "    });") cbEnd += 1;
  const newHead = `function normalizeRankingMetric(metric) {
  const allowed = ${mm[1]};
  if (allowed.includes(metric)) return metric;
  return "wins";
}

function normalizeRankingScope(scope) {
  const allowed = ["all", "month", "friends"];
  if (allowed.includes(scope)) return scope;
  return "all";
}

function applyLeaderboardSnapshot(snapshot) {
  if (!snapshot?.success) return;
  state.leaderboard.snapshots = snapshot.metrics || {};
  state.leaderboard.generatedAt = snapshot.generatedAt || null;
  state.leaderboard.scope = snapshot.scope || state.leaderboard.scope;
  const rows = state.leaderboard.snapshots[state.leaderboard.metric];
  if (rows) state.leaderboard.rows = rows;
}`.split("\n");
  const newCb = `    emitServer("get-leaderboard-snapshot", { scope: state.leaderboard.scope }, (snapshot) => {
      state.leaderboard.loading = false;
      applyLeaderboardSnapshot(snapshot);
      renderRankingsSurface("#rankings-page-content");
    });`.split("\n");
  lines = [
    ...lines.slice(0, s),
    ...newHead,
    "",
    lines[s],
    "  state.leaderboard.metric = normalizeRankingMetric(metric);",
    "  state.leaderboard.scope = normalizeRankingScope(scope);",
    ...lines.slice(s + 3, emit),
    ...newCb,
    ...lines.slice(cbEnd + 1),
  ];
}

// ---------- B. renderRankingsSurface ----------
{
  const s = findIdx((l) => l.startsWith("export function renderRankingsSurface"), "rrs start");
  const e = fnEnd(s);
  const metricsIdx = findIdx((l) => l.startsWith("  const metrics = Object.entries(RANKING_LABELS)"), "metrics");
  const parts = lines[metricsIdx].split("  const scopes = ");
  assert(parts.length === 2, "metrics+scopes joined");
  const rowsIdx = findIdx((l) => l.startsWith("  const rows = state.leaderboard.loading ?"), "rows");
  const syncIdx = findIdx((l) => l.startsWith("  const syncLabel = state.leaderboard.generatedAt ?"), "sync");
  const tplIdx = findIdx((l) => l.startsWith("  card.innerHTML = `<div class=\"rankings-page-shell"), "tpl");
  const resultsIdx = findIdx((l) => l.startsWith("  const rankingResults = Array.isArray(state.rankingSearchResults)"), "results");
  assert(lines[resultsIdx + 1].trim().startsWith("? state.rankingSearchResults.map"), "results mid");
  assert(lines[resultsIdx + 2].trim().startsWith(": state.rankingSearchQuery ?"), "results end");
  const searchInnerIdx = findIdx((l) => l.startsWith("  rankingSearch.innerHTML = "), "search inner");
  const qsIdx = findIdx((l) => l.startsWith("  card.querySelector(\".rankings-hero\")"), "qs");

  const metricsExpr = parts[0].replace("  const metrics = ", "").replace(/;$/, "");
  const scopesExpr = parts[1].replace("const scopes = ", "").replace(/;$/, "");
  const rowsExpr = lines[rowsIdx].replace("  const rows = ", "").replace(/;$/, "");
  const syncExpr = lines[syncIdx].replace("  const syncLabel = ", "").replace(/;$/, "");
  const resultsExpr = [
    "return " + lines[resultsIdx].replace("  const rankingResults = ", ""),
    lines[resultsIdx + 1],
    lines[resultsIdx + 2],
  ].join("\n");

  let tpl = lines[tplIdx];
  tpl = subIn(tpl, '<div class="rankings-page-shell ${pageSurface ? "is-page" : "is-modal"}">', '<div class="${shellClass}">');
  tpl = subIn(tpl, 'class="t-label f20 ${selfRow ? "green" : "g-muted"}"', 'class="t-label f20 ${selfTone}"');
  tpl = subIn(tpl, '${selfRow ? `${rankingValueLabel(state.leaderboard.metric, selfRow.value)} · ${RANKING_LABELS[state.leaderboard.metric]}` : "SIGN IN TO TRACK"}', '${selfStat}');
  tpl = subIn(tpl, '</div>${pageSurface ? "" : `<button class="btn-dark social-close" id="rankings-close" type="button"><span class="t-label f11">CLOSE</span></button>`}</section>', '</div>${closeBtn}</section>');
  tpl = subIn(tpl, 'rankingMetricColumnHTML(metric, snapshots[metric] || (metric === state.leaderboard.metric ? currentRows : []))', 'rankingMetricColumnHTML(metric, columnRows(snapshots, metric, currentRows))');
  tpl = subIn(tpl, 'SORTED DESCENDING · ${state.leaderboard.scope === "all" ? "ALL TIME" : state.leaderboard.scope === "month" ? "30 DAYS" : "FRIENDS"}', 'SORTED DESCENDING · ${scopeLabel()}');

  const newFn = `function leaderboardCurrentRows(snapshots) {
  const rows = snapshots[state.leaderboard.metric];
  if (rows) return rows;
  return state.leaderboard.rows || [];
}

function columnRows(snapshots, metric, currentRows) {
  const rows = snapshots[metric];
  if (rows) return rows;
  if (metric === state.leaderboard.metric) return currentRows;
  return [];
}

function rankingSelfBits(currentRows) {
  const selfId = state.account?.account?.id;
  const selfIndex = selfId ? currentRows.findIndex((row) => row.accountId === selfId) : -1;
  const selfRow = selfIndex >= 0 ? currentRows[selfIndex] : null;
  const selfRank = selfRow ? \`#\${selfIndex + 1}\` : "—";
  return { selfRow, selfRank };
}

function rankingSelfTone(selfRow) {
  if (selfRow) return "green";
  return "g-muted";
}

function rankingSelfStat(selfRow) {
  if (!selfRow) return "SIGN IN TO TRACK";
  const value = rankingValueLabel(state.leaderboard.metric, selfRow.value);
  return \`\${value} · \${RANKING_LABELS[state.leaderboard.metric]}\`;
}

function scopeLabel() {
  if (state.leaderboard.scope === "month") return "30 DAYS";
  if (state.leaderboard.scope === "friends") return "FRIENDS";
  return "ALL TIME";
}

function generatedLabel() {
  return ${syncExpr};
}

function rankingsShellClass(pageSurface) {
  if (pageSurface) return "rankings-page-shell is-page";
  return "rankings-page-shell is-modal";
}

function rankingsCloseButton(pageSurface) {
  if (pageSurface) return "";
  return '<button class="btn-dark social-close" id="rankings-close" type="button"><span class="t-label f11">CLOSE</span></button>';
}

function metricsTabs() {
  return ${metricsExpr};
}

function scopesTabs() {
  return ${scopesExpr};
}

function ledgerRowsHTML(currentRows) {
  return ${rowsExpr};
}

function rankingSearchResultsHTML() {
${resultsExpr}
}

export function renderRankingsSurface(target = "#rankings-card") {
  const card = $(target) || $("#rankings-card");
  if (!card) return;
  const pageSurface = card.id === "rankings-page-content";
  const surfaceKey = pageSurface ? "page" : "modal";
  const snapshots = state.leaderboard.snapshots || {};
  const currentRows = leaderboardCurrentRows(snapshots);
  const self = rankingSelfBits(currentRows);
  const selfRank = self.selfRank;
  const selfTone = rankingSelfTone(self.selfRow);
  const selfStat = rankingSelfStat(self.selfRow);
  const metrics = metricsTabs();
  const scopes = scopesTabs();
  const rows = ledgerRowsHTML(currentRows);
  const syncLabel = generatedLabel();
  const shellClass = rankingsShellClass(pageSurface);
  const closeBtn = rankingsCloseButton(pageSurface);
${tpl}
  const rankingResults = rankingSearchResultsHTML();
  const rankingSearch = document.createElement("section");
  rankingSearch.className = "rankings-search-band panel noise";
${lines[searchInnerIdx]}
${lines[qsIdx]}
}`.split("\n");

  lines = [...lines.slice(0, s), ...newFn, ...lines.slice(e + 1)];
}

fs.writeFileSync(MOD, lines.join("\n"));
console.log("AB done, lines:", lines.length);
