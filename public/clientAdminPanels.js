// Markup for the operator panels. Pure string builders over already-normalized models
// (see clientAdminOps.js), so they are testable without a DOM. Everything dynamic
// goes through escapeHtml; unknown numbers read "not recorded", never zero.

export function escapeHtml(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
}

const NOT_RECORDED = '<span class="admin-null">not recorded</span>';

export function formatCount(value) {
  return value === null || value === undefined ? NOT_RECORDED : escapeHtml(Number(value).toLocaleString('en-US', { maximumFractionDigits: 0 }));
}

// A live counter nothing has incremented yet is unknown, which is not the same as zero.
export function formatSinceStart(value) {
  return value === null || value === undefined ? '<span class="admin-null">not recorded yet</span>' : formatCount(value);
}

export function formatRate(value) {
  if (value === null || value === undefined) return NOT_RECORDED;
  return escapeHtml(`${(Number(value) * 100).toLocaleString('en-US', { maximumFractionDigits: 1 })}%`);
}

export function formatDuration(seconds) {
  if (seconds === null || seconds === undefined) return '-';
  const total = Math.max(0, Math.floor(Number(seconds)));
  const days = Math.floor(total / 86400);
  const hours = Math.floor((total % 86400) / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  if (days) return `${days}d ${hours}h`;
  if (hours) return `${hours}h ${String(minutes).padStart(2, '0')}m`;
  if (minutes) return `${minutes}m ${String(total % 60).padStart(2, '0')}s`;
  return `${total}s`;
}

// Time left on a drain, to the second: 1h 02m 03s, 5m 07s, 42s.
export function formatCountdown(milliseconds) {
  const total = Math.max(0, Math.ceil(Number(milliseconds) / 1000)) || 0;
  const hours = Math.floor(total / 3600);
  const minutes = Math.floor((total % 3600) / 60);
  const seconds = String(total % 60).padStart(2, '0');
  if (hours) return `${hours}h ${String(minutes).padStart(2, '0')}m ${seconds}s`;
  if (minutes) return `${minutes}m ${seconds}s`;
  return `${total}s`;
}

export function formatClock(iso) {
  const time = Date.parse(iso || '');
  if (Number.isNaN(time)) return '-';
  return `${new Date(time).toISOString().slice(11, 19)} UTC`;
}

export function formatStamp(iso) {
  const time = Date.parse(iso || '');
  if (Number.isNaN(time)) return '-';
  return new Date(time).toISOString().slice(0, 16).replace('T', ' ');
}

function fact(label, value) { return `<div><dt class="t-micro ink-3">${escapeHtml(label)}</dt><dd class="t-label f12">${value}</dd></div>`; }

const HEALTH_WORDS = Object.freeze({ healthy: 'HEALTHY', degraded: 'DEGRADED', down: 'DOWN', unknown: 'NO READING' });
const CHECK_WORDS = Object.freeze({ ok: 'OK', warn: 'WARN', bad: 'FAILING', unknown: 'NO DATA' });

// One slim line: the verdict, then only the checks that are not fine. A healthy server is just the pill.
export function healthMarkup(status) {
  const health = status.health;
  const issues = health.checks.filter(check => check.state === 'warn' || check.state === 'bad');
  const list = issues.map(check => `<li class="admin-issue" data-check-state="${escapeHtml(check.state)}"${check.detail ? ` title="${escapeHtml(check.detail)}"` : ''}><span class="t-label f12">${escapeHtml(check.label || check.id)}</span> <span class="t-label f11 admin-issue-state">${CHECK_WORDS[check.state]}</span>${check.detail ? `<span class="sr-only"> ${escapeHtml(check.detail)}</span>` : ''}</li>`).join('');
  return `<div class="admin-health-line" data-health-state="${escapeHtml(health.state)}"><span class="admin-verdict-badge t-label f12" data-health-badge>${HEALTH_WORDS[health.state]}</span>${list ? `<ul class="admin-issues" aria-label="Checks that need attention">${list}</ul>` : ''}</div>`;
}

export const ROOM_COLUMNS = Object.freeze(['Room', 'Phase', 'Visibility', 'Humans', 'Bots', 'Round', 'Age', 'Idle', 'State']);

function plural(count, word) { return `${count} ${word}${count === 1 ? '' : 's'}`; }

function reconnectsSpan(value) {
  return value === null || value === undefined ? `<span>reconnects since start: ${formatSinceStart(value)}</span>` : `<span><b>${formatCount(value)}</b> reconnects since start</span>`;
}

export function roomsMarkup(model) {
  const totals = model.totals;
  const rows = model.rooms.map(room => `<tr data-room-id="${escapeHtml(room.id)}"${room.stalled ? ' data-stalled="true"' : ''}><th scope="row" class="admin-mono">${escapeHtml(room.id)}</th><td>${escapeHtml(room.phase)}</td><td>${escapeHtml(room.visibility)}</td><td class="admin-num">${formatCount(room.humans)}</td><td class="admin-num">${formatCount(room.bots)}</td><td class="admin-num">${room.round === null ? '-' : formatCount(room.round)}</td><td class="admin-num">${escapeHtml(formatDuration(room.ageSeconds))}</td><td class="admin-num">${escapeHtml(formatDuration(room.idleSeconds))}</td><td>${room.stalled ? '<span class="admin-flag">STALLED</span>' : 'ok'}</td></tr>`).join('');
  return {
    // One line, not a sidebar of five tiles.
    totals: `<p class="t-label f12 admin-totals-line">${[['rooms', totals.rooms], ['lobby', totals.lobby], ['playing', totals.playing], ['humans', totals.humans], ['bots', totals.bots]].map(([name, value]) => `<span><b>${formatCount(value)}</b> ${name}</span>`).join('')}${reconnectsSpan(model.sinceStart?.reconnects)}</p>`,
    table: `<table class="admin-table"><caption class="sr-only">Live rooms, newest first. Room ids are one-way hashes, not invite codes.</caption><thead><tr>${ROOM_COLUMNS.map(column => `<th scope="col">${escapeHtml(column)}</th>`).join('')}</tr></thead><tbody>${rows}</tbody></table>`,
    count: model.rooms.length,
    noun: plural(model.rooms.length, 'room'),
  };
}

// Usage is one slim line of totals. A number the rollup does not record says so.
export function botsMarkup(model) {
  const totals = model.totals;
  return {
    line: `<dl class="admin-usage-line">${fact('BOT MATCHES', formatCount(totals.botMatches))}${fact('AI DECISIONS', formatCount(totals.decisions))}${fact('FALLBACKS', formatCount(totals.fallbacks))}${fact('FALLBACK RATE', formatRate(totals.fallbackRate))}${fact('SAMPLE', formatCount(totals.sampleSize))}${fact('FALLBACKS SINCE START', formatSinceStart(model.sinceStart?.fallbacks))}</dl>`,
  };
}

export const AUDIT_LIMIT = 10;

// Shown above the audit list whenever the server reports a corrupt or unreadable audit file.
export function auditHealthMarkup(health) {
  if (!health || health.state === 'ok' || !health.message) return '';
  return `<p class="t-body admin-log-warning" role="status">${escapeHtml(health.message)}</p>`;
}

export function auditMarkup(entries) {
  return `<ol class="admin-log">${entries.slice(0, AUDIT_LIMIT).map(entry => `<li class="admin-log-entry" data-outcome="${escapeHtml(entry.outcome)}"><span class="t-label f12 admin-log-what">${escapeHtml(entry.action.toUpperCase())}${entry.target ? ` · ${escapeHtml(entry.target)}` : ''}</span><span class="t-label f11 admin-log-result">${entry.outcome === 'failed' ? 'FAILED' : 'OK'}</span><span class="t-micro ink-3 admin-log-meta"><time datetime="${escapeHtml(entry.at)}">${escapeHtml(formatStamp(entry.at))} UTC</time> · ${escapeHtml(entry.actor)}</span></li>`).join('')}</ol>`;
}

const MODE_WORDS = Object.freeze({ normal: 'OPEN', draining: 'DRAINING', maintenance: 'MAINTENANCE' });
const MODE_HINTS = Object.freeze({
  normal: 'New rooms and rounds are accepted.',
  draining: 'No new rooms or rounds. Rounds in progress can finish.',
  maintenance: 'No new rooms or rounds. The server is closed to play.',
});

const LOCKOUT_HINT = 'The site is closed. Visitors see the maintenance panel; operators and admin accounts can still sign in.';

// A drain with a future deadline shows a live countdown (the controller ticks it); a deadline
// already passed says so, which also keeps the countdown from re-arming after it ends.
function deadlineSpan(maintenance, nowMs) {
  if (!maintenance.drainDeadline) return '';
  const stamp = `${escapeHtml(formatStamp(maintenance.drainDeadline))} UTC`;
  const remaining = Date.parse(maintenance.drainDeadline) - nowMs;
  if (maintenance.mode !== 'draining') return `<span>drain deadline <b>${stamp}</b></span>`;
  if (remaining > 0) return `<span>closes in <b data-release-countdown data-deadline="${escapeHtml(maintenance.drainDeadline)}">${escapeHtml(formatCountdown(remaining))}</b> at <b>${stamp}</b></span>`;
  return `<span>deadline reached <b>${stamp}</b></span>`;
}

export function releaseMarkup(maintenance, nowMs = Date.now()) {
  const extras = [
    `<span><b>${formatCount(maintenance.activeRounds)}</b> active ${maintenance.activeRounds === 1 ? 'round' : 'rounds'}</span>`,
    maintenance.releaseId ? `<span>release <b>${escapeHtml(maintenance.releaseId)}</b></span>` : '',
    maintenance.lockout ? '<span>public panel <b>ON</b></span>' : '',
    deadlineSpan(maintenance, nowMs),
  ].filter(Boolean).join('');
  return `<div class="admin-release-mode" data-release-mode="${escapeHtml(maintenance.mode)}"><span class="admin-verdict-badge t-label f12" data-release-badge>${MODE_WORDS[maintenance.mode]}</span><p class="t-body ink-2">${escapeHtml(maintenance.lockout ? LOCKOUT_HINT : MODE_HINTS[maintenance.mode])}</p></div><p class="t-label f12 admin-totals-line">${extras}</p>${maintenance.message ? `<p class="t-body ink-2 admin-release-message">Players see: ${escapeHtml(maintenance.message)}</p>` : ''}`;
}

// Which release actions make sense from each mode.
export function releaseActions(mode) {
  return { draining: mode === 'normal', maintenance: mode !== 'maintenance', normal: mode !== 'normal' };
}

export const RELEASE_COPY = Object.freeze({
  draining: { label: 'DRAIN', title: 'Start draining?', message: 'No new rooms or rounds are accepted. Rounds in progress can finish.', confirm: 'START DRAIN' },
  maintenance: { label: 'MAINTENANCE', title: 'Enter maintenance?', message: 'No new rooms or rounds are accepted. Check active rounds first; Drain lets them finish.', confirm: 'ENTER MAINTENANCE' },
  normal: { label: 'RESUME', title: 'Resume normal service?', message: 'New rooms and rounds are accepted again.', confirm: 'RESUME SERVICE' },
});

// The public maintenance panel switch: what it says now, what pressing it does, and the confirmation.
export const LOCKOUT_COPY = Object.freeze({
  on: { title: 'Show the maintenance panel?', message: 'Visitors see the under-maintenance panel and cannot create or join rooms. Players already seated keep playing. Operators and admin accounts can still sign in.', confirm: 'SHOW PANEL', label: 'SHOW MAINTENANCE PANEL', applied: 'PANEL ON · CONFIRMED BY SERVER' },
  off: { title: 'Turn the maintenance panel off?', message: 'The panel goes away and the site reopens to everyone: new rooms and rounds are accepted again.', confirm: 'TURN OFF AND REOPEN', label: 'TURN PANEL OFF · REOPEN SITE', applied: 'PANEL OFF · SITE OPEN · CONFIRMED BY SERVER' },
});

export function lockoutView(maintenance) {
  const locked = maintenance.lockout === true;
  const state = locked ? 'ON · VISITORS ARE LOCKED OUT' : 'OFF';
  const note = maintenance.operatorPassword === true ? 'Operator password is set; operators can sign in on the panel.' : 'No operator password set; only admin accounts can pass the lockout.';
  return { locked, state, note, action: locked ? 'off' : 'on' };
}
