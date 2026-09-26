import assert from "node:assert/strict";
import { buildCountdownRingSvg, createInactivityUi, formatInactiveTime } from "./clientInactivityUi.js";

assert.equal(formatInactiveTime(180_000), "3:00");
assert.equal(formatInactiveTime(1), "0:01");
assert.equal(formatInactiveTime(0), "0:00");
assert.equal(formatInactiveTime(-1000), "0:00");

const full = buildCountdownRingSvg(1);
const half = buildCountdownRingSvg(0.5);
const empty = buildCountdownRingSvg(0);
const goldSegments = svg => [...svg.matchAll(/<rect[^>]+fill="#E5A52D"/g)].length;
assert.equal(goldSegments(full), 70, "the complete ring is segmented gold");
assert.equal(goldSegments(half), 35, "clockwise progress removes half the segments");
assert.equal(goldSegments(empty), 0, "an expired visual has no active gold segment");
assert.match(full, /rotate\(5 128 128\)/, "progress begins just clockwise of the top gap");
assert.match(full, /rotate\(350 128 128\)/, "the final segment leaves a top-center opening");
assert.match(full, /rect x="29" y="29" width="198" height="198"/, "frame keeps the reference inset proportions");
assert.match(full, /rect x="126" y="49" width="4" height="6"/, "ring uses separated square-pixel segments");
assert.match(full, /viewBox="0 0 256 256"/);

let currentTime = 5_000;
let nextTimer = 1;
const timers = new Map();
const announcer = { textContent: "", setAttribute() {} };
const timerHost = {
  hidden: true,
  innerHTML: "",
  querySelector: selector => selector === "[data-inactivity-announcer]" ? announcer : null,
};
const sidebarHost = { innerHTML: "" };
const ui = createInactivityUi({
  timerHost,
  sidebarHost,
  announcementHost: announcer,
  now: () => currentTime,
  schedule: callback => { const id = nextTimer++; timers.set(id, callback); return id; },
  cancel: id => timers.delete(id),
  reducedMotion: () => true,
});
const clockPlayers = [
  { id: "p1", name: "Marlow", presence: { state: "inactive", inactiveSince: 0, inactiveUntil: 150_000 } },
  { id: "p2", name: "Juno", presence: { state: "inactive", inactiveSince: 0, inactiveUntil: 165_000 } },
  { id: "bot", name: "CPU", isBot: true, presence: { state: "inactive", inactiveSince: 0, inactiveUntil: 100_000 } },
];
ui.update(clockPlayers, 6_000);
assert.equal(timerHost.hidden, false);
assert.match(timerHost.innerHTML, /Marlow/);
assert.match(timerHost.innerHTML, /2:24/);
assert.match(timerHost.innerHTML, /E5A52D/);
assert.match(sidebarHost.innerHTML, /Marlow/);
assert.match(sidebarHost.innerHTML, /Juno/);
assert.doesNotMatch(sidebarHost.innerHTML, /CPU/);
assert.ok(sidebarHost.innerHTML.indexOf("Marlow") < sidebarHost.innerHTML.indexOf("Juno"), "sidebar lists the earliest deadline first");
assert.match(timerHost.innerHTML, /role="group"/);
assert.equal(announcer.textContent, "Marlow is inactive. Juno is inactive");
const firstTransitionAnnouncement = announcer.textContent;
currentTime = 6_000;
const tick = timers.values().next().value;
timers.clear();
tick();
assert.match(timerHost.innerHTML, /2:23/);
assert.equal(announcer.textContent, firstTransitionAnnouncement, "ticks do not announce every second");
ui.update([], currentTime);
assert.equal(announcer.textContent, "Marlow is active again. Juno is active again");
ui.destroy();
assert.equal(timerHost.hidden, true);
assert.equal(sidebarHost.innerHTML, "");
assert.equal(timers.size, 0);

console.log("client inactivity UI tests: passed");
