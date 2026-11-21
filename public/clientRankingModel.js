// RANKING MODEL: metric/scope constants, snapshot state helpers and pagination
// shared by the rankings renderer, the data fetches and the game openers.
import { state } from "./clientState.js";
import { PARLOR_PATROL_ENABLED } from "./clientParlorPatrolFlag.js";

export function normalizeRankingMetric(metric) {
  if (RANKING_ORDER.includes(metric)) return metric;
  return "wins";
}

export function normalizeRankingScope(scope) {
  const allowed = ["all", "month", "friends"];
  if (allowed.includes(scope)) return scope;
  return "all";
}

function clearLeaderboardSnapshot(snapshot) {
  state.leaderboard.error = snapshot?.error || "Rankings are temporarily unavailable.";
  state.leaderboard.stale = Boolean(state.leaderboard.rows?.length || Object.keys(state.leaderboard.snapshots || {}).length);
}

function storeLeaderboardSnapshot(snapshot) {
  state.leaderboard.error = "";
  state.leaderboard.snapshots = snapshot.metrics || {};
  state.leaderboard.generatedAt = snapshot.generatedAt || null;
  state.leaderboard.scope = snapshot.scope || state.leaderboard.scope;
  const rows = state.leaderboard.snapshots[state.leaderboard.metric];
  if (rows) state.leaderboard.rows = rows;
}

export function applyLeaderboardSnapshot(snapshot) {
  if (!snapshot?.success) return clearLeaderboardSnapshot(snapshot);
  storeLeaderboardSnapshot(snapshot);
}

export const RANKING_LABELS = { wins: "WINS", rate: "WIN RATE", games: "GAMES", achievements: "ACHIEVEMENT SCORE", mythical: "MYTHICAL", bankruptcies: "BANKRUPTCIES", events: "EVENT SURVIVAL", auctions: "AUCTION WINS", rent: "RENT COLLECTED", casino: "CASINO NET", market: "MARKET PROFIT", playerloans: "PLAYER LOANS", equity: "EQUITY DEALS", loans: "LOAN DISCIPLINE", ...(PARLOR_PATROL_ENABLED ? { patrol: "PATROL BEST" } : {}) };
export const RANKING_ORDER = Object.keys(RANKING_LABELS);

const RANKING_DESCRIPTIONS = {
  wins: "Completed server rounds won. Ties are resolved by verified wins, then name.",
  rate: "Verified win percentage. Five completed games are required before a rate ranks.",
  games: "Completed server rounds. Preview, duplicate, abandoned, and bot-only games stay out.",
  achievements: "Rarity-weighted achievement score earned across completed rounds.",
  mythical: "Mythical achievements unlocked. These are announced server-wide when earned.",
  bankruptcies: "Rounds survived without being the first wallet to break.",
  events: "Global events survived, measured from server event outcomes.",
  auctions: "Verified auctions won while keeping bids and settlements legal.",
  rent: "Cash collected from property rent in completed rounds.",
  casino: "Net in-game casino result. Wager volume never grants rank points.",
  market: "Net in-game market result after disclosed fees and obligations.",
  playerloans: "Player-to-player loan offers completed and settled.",
  equity: "Equity deals completed with server-authoritative settlement.",
  loans: "Loan obligations paid on time, including proactive repayments.",
  patrol: "Best verified Patrol score from the home easter egg.",
};

export function rankingDescription(metric) {
  return RANKING_DESCRIPTIONS[metric] || "Verified server records only.";
}

export function rankingValueLabel(metric, value) {
  if (metric === "rate") return `${Number(value) || 0}%`;
  if (["rent", "casino", "market"].includes(metric)) return `$${(Number(value) || 0).toLocaleString()}`;
  return String(Number(value) || 0);
}

export const RANKING_PAGE_SIZE = 10;

export function rankingsPageSlice(rows, requestedPage = 0) {
  const list = Array.isArray(rows) ? rows : [];
  const total = list.length;
  const pageCount = Math.max(1, Math.ceil(total / RANKING_PAGE_SIZE));
  const page = Math.max(0, Math.min(pageCount - 1, Math.floor(Number(requestedPage) || 0)));
  const start = page * RANKING_PAGE_SIZE;
  return { rows: list.slice(start, start + RANKING_PAGE_SIZE), total, page, pageCount, start };
}

export function leaderboardCurrentRows(snapshots) {
  const rows = snapshots[state.leaderboard.metric];
  if (rows) return rows;
  if (state.leaderboard.loading) return [];
  return state.leaderboard.rows || [];
}
