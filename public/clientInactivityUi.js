const URGENT_MS = 30_000;

export function formatInactiveTime(milliseconds) {
  const seconds = Math.max(0, Math.ceil(Number(milliseconds) / 1000) || 0);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function inactivePlayerId(player) {
  return String(player?.serverId || player?.id || player?.name || "player");
}

/* Markup for the countdown chip shown on a player row; empty when the player
   is active, a bot, or has no finite deadline. The ticker below keeps the text
   fresh between full row renders. */
export function inactiveBadgeHTML(player, serverNow) {
  if (!isInactiveHuman(player) || !hasFiniteDeadline(player)) return "";
  const remaining = Math.max(0, Number(player.presence.inactiveUntil) - Number(serverNow));
  const urgent = remaining <= URGENT_MS ? "true" : "false";
  const time = formatInactiveTime(remaining);
  return `<span class="pr-timer" data-timer-player="${escapeText(inactivePlayerId(player))}" data-urgent="${urgent}" role="timer" title="${escapeText(player.name)} is inactive and will be removed when this reaches 0:00" aria-label="${escapeText(player.name)} inactive, ${time} left">${time}</span>`;
}

function escapeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[character]);
}

function isInactiveHuman(player) {
  return Boolean(player && !player.isBot && player.presence?.state === "inactive");
}

function hasFiniteDeadline(player) {
  return Number.isFinite(Number(player.presence.inactiveUntil));
}

function inactivePlayerView(player) {
  return {
      id: inactivePlayerId(player),
      name: String(player.name || "Player"),
      inactiveSince: Number(player.presence.inactiveSince),
      inactiveUntil: Number(player.presence.inactiveUntil),
  };
}

function inactivePlayers(players) {
  return (Array.isArray(players) ? players : [])
    .filter(isInactiveHuman)
    .filter(hasFiniteDeadline)
    .map(inactivePlayerView)
    .sort((a, b) => a.inactiveUntil - b.inactiveUntil);
}

export function createInactivityUi({
  listHost,
  document = globalThis.document,
  announcementHost = document?.querySelector?.("#inactivity-announcements"),
  now = Date.now,
  schedule = setTimeout,
  cancel = clearTimeout,
} = {}) {
  let players = [];
  let serverOffset = 0;
  let tickTimer = null;
  let lastStates = new Map();

  const stop = () => {
    if (tickTimer !== null) cancel(tickTimer);
    tickTimer = null;
  };

  const render = () => {
    stop();
    const inactive = inactivePlayers(players);
    const currentTime = now() + serverOffset;
    const remaining = inactive.map(player => ({
      ...player,
      remainingMs: Math.max(0, player.inactiveUntil - currentTime),
    }));

    if (listHost?.querySelectorAll) {
      const byId = new Map(remaining.map(player => [player.id, player]));
      for (const badge of listHost.querySelectorAll("[data-timer-player]")) {
        const player = byId.get(badge.dataset.timerPlayer);
        if (!player) continue;
        badge.textContent = formatInactiveTime(player.remainingMs);
        badge.dataset.urgent = player.remainingMs <= URGENT_MS ? "true" : "false";
      }
    }

    const states = new Map(remaining.map(player => [player.id, player.name]));
    const transitions = [];
    for (const [id, name] of states) if (!lastStates.has(id)) transitions.push(`${name} is inactive`);
    for (const [id, name] of lastStates) if (!states.has(id)) transitions.push(`${name} is active again`);
    lastStates = states;
    if (transitions.length && announcementHost) {
      announcementHost.textContent = transitions.join(". ");
    }

    if (remaining.length) tickTimer = schedule(render, 1000);
  };

  return {
    update(nextPlayers, serverTime) {
      players = Array.isArray(nextPlayers) ? nextPlayers : [];
      if (Number.isFinite(Number(serverTime)) && Number(serverTime) > 0) serverOffset = Number(serverTime) - now();
      render();
    },
    destroy() {
      stop();
      players = [];
      if (announcementHost) announcementHost.textContent = "";
      lastStates.clear();
    },
  };
}
