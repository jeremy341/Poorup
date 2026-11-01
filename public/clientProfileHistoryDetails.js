// PROFILE HISTORY DETAILS: the net-worth chart, the detail tabs and the chips for one match. Used by clientProfileHistory.js.
import { esc } from "./clientDom.js";

import { formatHistoryMoney } from "./clientHistoryFormat.js";

import { netWorthRoundLabel, netWorthSeatSeries, matchResult, historySummaryFields, historyPlayerRows, historyEconomyFields, historyEventList, ownParticipantResult, ownParticipant } from "./clientProfileHistory.js";

export function historyNetWorthChartSpec(record, accountId) {
  const rows = Array.isArray(record?.netWorthTimeline) ? record.netWorthTimeline : [];
  const participants = Array.isArray(record?.participants) ? record.participants : [];
  if (rows.length < 2 || !participants.length) return null;
  const seats = participants.slice(0, 6)
    .map((participant, index) => ({ participant, index }))
    .sort((a, b) => Number(b.participant?.accountId === accountId) - Number(a.participant?.accountId === accountId));
  return {
    kind: "line",
    unit: "dollars",
    title: "Net worth by round",
    labels: rows.map(netWorthRoundLabel),
    series: seats.map(({ participant, index }) => netWorthSeatSeries(participant, index, accountId, rows)),
  };
}

export function historyWorthPanel(recordValue, accountId) {
  const rows = recordValue?.netWorthTimeline;
  if (!Array.isArray(rows)) return '<p class="profile-history-worth-empty">NOT RECORDED</p>';
  const spec = historyNetWorthChartSpec(recordValue, accountId);
  if (!spec) return '<p class="profile-history-worth-empty">NOT ENOUGH ROUNDS TO CHART</p>';
  const last = rows[rows.length - 1];
  const final = spec.series.map((series) => {
    const seat = recordValue.participants.findIndex((participant, index) => index < 6 && (participant?.accountId || `seat-${index}`) === series.id);
    const worth = Array.isArray(last?.worth) ? last.worth[seat] : null;
    return `${esc(series.name)} ${worth == null ? "-" : esc(formatHistoryMoney(worth))}`;
  }).join(" · ");
  return `<div class="profile-history-chart" data-profile-history-chart="${esc(recordValue.matchId)}"></div><p class="t-micro ink-3 profile-history-chart-note">FINAL NET WORTH · ${final}</p><p class="t-micro ink-3 profile-history-chart-note">NET WORTH = CASH + DEEDS + BUILDINGS − DEBTS · ONE POINT PER ROUND</p>`;
}

export function historyDetailPanels(recordValue, accountId, participant) {
  const result = matchResult(recordValue, accountId);
  const summaryFields = historySummaryFields(recordValue, participant, result);
  const playerRows = historyPlayerRows(recordValue, accountId);
  const economyFields = historyEconomyFields(recordValue, participant, accountId);
  const events = historyEventList(recordValue);
  return [
    ["summary", "SUMMARY", `<dl class="profile-history-detail-grid">${summaryFields}</dl>`],
    ["players", "PLAYERS", `<ul class="profile-history-player-list">${playerRows}</ul>`],
    ["worth", "NET WORTH", historyWorthPanel(recordValue, accountId)],
    ["economy", "ECONOMY &amp; DEALS", `<dl class="profile-history-detail-grid">${economyFields}</dl>`],
    ["events", "EVENTS", `<div class="profile-history-event-list">${events}</div>`],
  ];
}

export function historyDetailTabButtons(panels, detailId) {
  const buttons = panels.map(([key, label], index) => `<button type="button" role="tab" id="${detailId}-tab-${key}" aria-selected="${index === 0}" aria-controls="${detailId}-panel-${key}" tabindex="${index === 0 ? "0" : "-1"}" data-profile-history-detail-tab="${key}">${label}</button>`).join("");
  return buttons;
}

export function historyDetailTabContents(panels, detailId) {
  const contents = panels.map(([key, , content], index) => `<section role="tabpanel" id="${detailId}-panel-${key}" aria-labelledby="${detailId}-tab-${key}" tabindex="0"${index ? " hidden" : ""}>${content}</section>`).join("");
  return contents;
}

export function ownerDetailsPanels(recordValue, accountId, detailId) {
  const participant = ownParticipantResult(recordValue, accountId);
  const panels = historyDetailPanels(recordValue, accountId, participant);
  const buttons = historyDetailTabButtons(panels, detailId);
  const contents = historyDetailTabContents(panels, detailId);
  const source = recordValue ? "owner" : "unavailable";
  return `<div class="profile-history-details" id="${detailId}" data-profile-detail-source="${source}" hidden><div class="profile-history-detail-tabs" role="tablist" aria-label="Match details">${buttons}</div><div class="profile-detail-scroll" tabindex="0" aria-label="Scrollable match details">${contents}</div></div>`;
}

/** One labelled column of the collapsed row; a missing value reads as a dash but stays announced. */
export function historyStat(label, value) {
  const shown = value == null ? '-<span class="sr-only">NOT RECORDED</span>' : esc(value);
  return `<span class="profile-history-stat"><span class="t-micro ink-3">${label}</span><strong class="t-label f12 g100">${shown}</strong></span>`;
}

/** Ending cash only comes from the owner's private record, never from the public summary row. */
export function ownerCashValue(ownerRecord, accountId) {
  const cash = ownParticipant(ownerRecord || {}, accountId)?.endingCash;
  const number = cash == null ? null : Number(cash);
  return number !== null && Number.isFinite(number) ? number : null;
}

export function ownerEndingCash(ownerRecord, accountId) {
  const value = ownerCashValue(ownerRecord, accountId);
  return value === null ? null : formatHistoryMoney(value);
}

export const STANDARD_BOARD = "standard-40";

export function boardOf(entry) {
  return typeof entry?.boardVariant === "string" ? entry.boardVariant : "";
}

export function hasHouseRules(entry) {
  return Array.isArray(entry?.rulesetOverrides) && entry.rulesetOverrides.length > 0;
}

/** Small tags under the date: only what differs from a plain standard round, plus the best-cash round. */
export function historyChips(entry, best) {
  const chips = [];
  if (best) chips.push('<span class="profile-history-chip is-best">BEST CASH</span>');
  if (hasHouseRules(entry)) chips.push('<span class="profile-history-chip">HOUSE RULES</span>');
  const board = boardOf(entry);
  if (board && board !== STANDARD_BOARD) chips.push(`<span class="profile-history-chip">${esc(board.toUpperCase())}</span>`);
  return chips.join("");
}

