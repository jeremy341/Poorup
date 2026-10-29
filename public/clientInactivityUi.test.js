import assert from "node:assert/strict";
import { createInactivityUi, formatInactiveTime, inactiveBadgeHTML } from "./clientInactivityUi.js";

assert.equal(formatInactiveTime(180_000), "3:00");
assert.equal(formatInactiveTime(1), "0:01");
assert.equal(formatInactiveTime(0), "0:00");
assert.equal(formatInactiveTime(-1000), "0:00");

// Row badge markup
assert.equal(inactiveBadgeHTML({ id: "a", name: "A", presence: { state: "active" } }, 0), "", "active players get no badge");
assert.equal(inactiveBadgeHTML({ id: "b", name: "B", isBot: true, presence: { state: "inactive", inactiveUntil: 9e9 } }, 0), "", "bots get no badge");
const badge = inactiveBadgeHTML({ id: "p1", name: "Marlow", presence: { state: "inactive", inactiveUntil: 150_000 } }, 6_000);
assert.match(badge, /data-timer-player="p1"/);
assert.match(badge, />2:24</);
assert.match(badge, /data-urgent="false"/);
assert.match(inactiveBadgeHTML({ id: "p1", name: "Marlow", presence: { state: "inactive", inactiveUntil: 20_000 } }, 0), /data-urgent="true"/, "the last 30 seconds are urgent");

let currentTime = 5_000;
let nextTimer = 1;
const timers = new Map();
const announcer = { textContent: "", setAttribute() {} };
const badgeFor = id => ({
  dataset: { timerPlayer: id, urgent: "false" },
  textContent: "",
});
const badges = { p1: badgeFor("p1"), p2: badgeFor("p2") };
const listHost = { querySelectorAll: () => Object.values(badges) };
const ui = createInactivityUi({
  listHost,
  announcementHost: announcer,
  now: () => currentTime,
  schedule: callback => { const id = nextTimer++; timers.set(id, callback); return id; },
  cancel: id => timers.delete(id),
});
const clockPlayers = [
  { id: "p1", name: "Marlow", presence: { state: "inactive", inactiveSince: 0, inactiveUntil: 150_000 } },
  { id: "p2", name: "Juno", presence: { state: "inactive", inactiveSince: 0, inactiveUntil: 165_000 } },
  { id: "bot", name: "CPU", isBot: true, presence: { state: "inactive", inactiveSince: 0, inactiveUntil: 100_000 } },
];
ui.update(clockPlayers, 6_000);
assert.equal(badges.p1.textContent, "2:24");
assert.equal(badges.p2.textContent, "2:39", "every inactive player's row gets its own countdown");
assert.equal(badges.p1.dataset.urgent, "false");
assert.equal(announcer.textContent, "Marlow is inactive. Juno is inactive");
const firstTransitionAnnouncement = announcer.textContent;
currentTime = 6_000;
const tick = timers.values().next().value;
timers.clear();
tick();
assert.equal(badges.p1.textContent, "2:23");
assert.equal(announcer.textContent, firstTransitionAnnouncement, "ticks do not announce every second");
ui.update([], currentTime);
assert.equal(announcer.textContent, "Marlow is active again. Juno is active again");
ui.destroy();
assert.equal(timers.size, 0);

console.log("client inactivity UI tests: passed");
