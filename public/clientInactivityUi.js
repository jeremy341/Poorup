const RING_SEGMENTS = 70;
const GOLD = "#E5A52D";
const MUTED_GOLD = "#154346";

export function formatInactiveTime(milliseconds) {
  const seconds = Math.max(0, Math.ceil(Number(milliseconds) / 1000) || 0);
  return `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, "0")}`;
}

export function buildCountdownRingSvg(remainingRatio = 1) {
  const ratio = Math.max(0, Math.min(1, Number(remainingRatio) || 0));
  const activeSegments = Math.ceil(ratio * RING_SEGMENTS);
  const segments = Array.from({ length: RING_SEGMENTS }, (_, index) => {
    const angle = 5 + index * 5;
    const fill = index < activeSegments ? GOLD : MUTED_GOLD;
    return `<rect x="126" y="49" width="4" height="6" fill="${fill}" transform="rotate(${angle} 128 128)"/>`;
  }).join("");

  return `<svg class="inactivity-ring-art" viewBox="0 0 256 256" aria-hidden="true" focusable="false" shape-rendering="crispEdges">
    <rect x="29" y="29" width="198" height="198" fill="#071A1D" stroke="#B78327" stroke-width="2"/>
    <path fill="#01090B" d="M42 40h172v6h7v164h-7v7H42v-7h-7V46h7z"/>
    <path fill="none" stroke="#C88F2E" stroke-width="2" d="M30 33h196M30 223h196"/>
    <path fill="#D99A2B" d="M35 35h5v5h-5zm181 0h5v5h-5zM35 216h5v5h-5zm181 0h5v5h-5z"/>
    ${segments}
  </svg>`;
}

function escapeText(value) {
  return String(value ?? "").replace(/[&<>"']/g, character => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", "\"": "&quot;", "'": "&#39;",
  })[character]);
}

function inactivePlayers(players) {
  return (Array.isArray(players) ? players : [])
    .filter(player => !player?.isBot && player?.presence?.state === "inactive" && Number.isFinite(Number(player.presence.inactiveUntil)))
    .map(player => ({
      id: String(player.serverId || player.id || player.name || "player"),
      name: String(player.name || "Player"),
      inactiveSince: Number(player.presence.inactiveSince),
      inactiveUntil: Number(player.presence.inactiveUntil),
    }))
    .sort((a, b) => a.inactiveUntil - b.inactiveUntil);
}

export function createInactivityUi({
  timerHost,
  sidebarHost,
  document = globalThis.document,
  announcementHost = document?.querySelector?.("#inactivity-announcements"),
  now = Date.now,
  schedule = setTimeout,
  cancel = clearTimeout,
  reducedMotion = () => globalThis.matchMedia?.("(prefers-reduced-motion: reduce)").matches === true,
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

    if (sidebarHost) {
      sidebarHost.innerHTML = remaining.length
        ? `<section class="inactive-player-list" aria-label="Inactive players">${remaining.map(player => `<p class="inactive-player-row"><span class="inactive-player-name">${escapeText(player.name)}</span><span class="inactive-player-time">${formatInactiveTime(player.remainingMs)}</span></p>`).join("")}</section>`
        : "";
    }

    if (timerHost) {
      if (!remaining.length) {
        timerHost.innerHTML = "";
        timerHost.hidden = true;
      } else {
        const earliest = remaining[0];
        const startRemaining = Math.max(1, Number(earliest.inactiveUntil - (earliest.inactiveSince || earliest.inactiveUntil - 180_000)));
        const ratio = earliest.remainingMs / startRemaining;
        const frozenRing = reducedMotion();
        const svg = buildCountdownRingSvg(frozenRing ? 1 : ratio);
        timerHost.hidden = false;
        timerHost.innerHTML = `<div class="inactivity-timer" role="group" aria-label="${escapeText(earliest.name)} is inactive. ${formatInactiveTime(earliest.remainingMs)} remaining.">
          ${svg}<div class="inactivity-timer-copy"><span class="inactivity-timer-name">${escapeText(earliest.name)}</span><span class="inactivity-timer-time" data-inactivity-time>${formatInactiveTime(earliest.remainingMs)}</span></div>
        </div>`;
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
      if (sidebarHost) sidebarHost.innerHTML = "";
      if (timerHost) {
        timerHost.innerHTML = "";
        timerHost.hidden = true;
      }
      if (announcementHost) announcementHost.textContent = "";
      lastStates.clear();
    },
  };
}
