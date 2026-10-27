/* ============================================================
   BOARD FEED: the table events as a scrollable list in the
   board centre, newest first. The log drawer (top bar) keeps the
   filterable view of the same state.log.
   ============================================================ */
import { $, esc } from "./clientDom.js";
import { state } from "./clientState.js";

const MAX_FEED_LINES = 40;
let renderedSignature = "";

/* Wrap money and counts in a span so the log can set them in a readable
   numeric face; HTML entities from esc() are left untouched. */
export function logLineHTML(line) {
  return esc(line).replace(/(&#?\w+;)|(\$?\d[\d,.]*\d|\$?\d)/g, (match, entity) =>
    entity ? match : `<span class="log-num">${match}</span>`);
}

export function renderBoardFeed() {
  const host = $("#board-feed-lines");
  if (!host) return;
  const lines = (state.log || []).slice(0, MAX_FEED_LINES);
  const signature = lines.join("\u0000");
  if (signature === renderedSignature) return;
  renderedSignature = signature;
  host.innerHTML = lines
    .map((line, index) => `<p class="board-feed-line" data-age="${index}">${logLineHTML(line)}</p>`)
    .join("");
  const feed = $("#board-feed");
  if (feed) feed.hidden = lines.length === 0;
}
