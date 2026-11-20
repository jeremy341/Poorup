// ANNOUNCEMENT QUEUE: #system-announcer is one overwrite node, so a burst of system lines would
// coalesce and the screen reader would only hear the last. Lines queue here and flush one per
// ANNOUNCE_GAP_MS; none are dropped (a repeat of the line just spoken is skipped). An idle queue
// writes immediately, so a single line is never delayed. Only the polite channel is queued:
// #error-announcer is assertive and must interrupt, so errors keep writing to it directly.
const ANNOUNCE_GAP_MS = 800;
const announceQueue = [];
let announceTimer = null;
let lastAnnouncedLine = null;

function flushAnnouncement() {
  announceTimer = null;
  const next = announceQueue.shift();
  if (next === undefined) return;
  const announcer = document.querySelector("#system-announcer");
  if (announcer) announcer.textContent = next;
  announceTimer = setTimeout(flushAnnouncement, ANNOUNCE_GAP_MS);
}

export function announceSystemLine(text) {
  const line = String(text);
  const idle = announceQueue.length === 0 && announceTimer === null;
  if (!idle && lastAnnouncedLine === line) return;
  lastAnnouncedLine = line;
  announceQueue.push(line);
  if (idle) flushAnnouncement();
}
