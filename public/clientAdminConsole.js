import { fetchOps, postMaintenance, postLockout, buildMaintenanceRequest, buildLockoutRequest, plainText } from './clientAdminOps.js';
import { setSectionState, setSectionFailure, syncScrollCue } from './clientAdminPanelState.js';
import {
  healthMarkup, roomsMarkup, botsMarkup, auditMarkup, auditHealthMarkup, releaseMarkup, releaseActions,
  RELEASE_COPY, LOCKOUT_COPY, lockoutView, formatClock, formatStamp, formatCountdown,
} from './clientAdminPanels.js';

// Operator panels backed by /admin/ops/*: health verdict (Status), live rooms, bot usage,
// the change log and the release control. The shell (clientAnalytics.js) picks the shown
// section. This controller owns requests, polling, empty and error states, and teardown.

export const ROOMS_POLL_MS = 15000;
export const COUNTDOWN_TICK_MS = 1000;
const AUDIT_UNSAVED = 'Done, but the audit log could not be saved. Check the audit log file.';
export const OPS_TABS = Object.freeze(['status', 'rooms', 'bots', 'release']);
const CHIP_TABS = Object.freeze(['rooms', 'bots', 'release']);

function find(root, selector) { return root?.querySelector?.(selector) || null; }

export function refreshScrollCues(root) { root?.querySelectorAll?.('[data-scroll-cue]')?.forEach(syncScrollCue); }

export function createAdminOpsController({
  root = globalThis.document,
  fetcher,
  announce = () => {},
  setFreshness = () => {},
  getRange = () => 'day',
  isViewShown = () => true,
  isDocumentHidden = () => Boolean(globalThis.document?.hidden),
  confirm = null,
  pollMs = ROOMS_POLL_MS,
  clock = () => Date.now(),
  countdownTickMs = COUNTDOWN_TICK_MS,
} = {}) {
  let activeTab = null;
  let destroyed = false;
  let pollTimer = null;
  let countdownTimer = null;
  let releaseBusy = false;
  let lockoutAction = null;
  const generations = {};
  const aborts = {};
  const models = { status: null, rooms: null, bots: null, audit: null };
  const cleanups = [];

  const section = name => find(root, `[data-section="${name}"]`);
  const body = name => find(section(name), '[data-section-body]');

  function chip(text, tone = 'muted', title = '') { if (CHIP_TABS.includes(activeTab)) setFreshness(text, tone, title); }

  function begin(key) {
    generations[key] = (generations[key] || 0) + 1;
    aborts[key]?.abort();
    aborts[key] = typeof AbortController === 'function' ? new AbortController() : null;
    return { generation: generations[key], signal: aborts[key]?.signal };
  }

  const current = (key, generation) => !destroyed && generations[key] === generation;

  function cancelAll() { Object.keys(aborts).forEach(key => { generations[key] = (generations[key] || 0) + 1; aborts[key]?.abort(); aborts[key] = null; }); }

  // One request, one section: shows loading, then ready/empty/error/unauthorized.
  async function load(key, kind, sectionName, { retry, onModel, isEmpty = () => false, emptyText, silent = false, extra = {} }) {
    const { generation, signal } = begin(key);
    if (!silent) setSectionState(section(sectionName), 'loading', { message: 'LOADING…' });
    const result = await fetchOps(kind, { signal, fetcher, ...extra });
    if (result.aborted || !current(key, generation)) return null;
    if (!result.ok) {
      setSectionFailure(section(sectionName), result.status, retry);
      refreshScrollCues(root);
      return { failed: true, status: result.status };
    }
    models[kind] = result.model;
    if (isEmpty(result.model)) { onModel(result.model); setSectionState(section(sectionName), 'empty', { message: emptyText }); }
    else { onModel(result.model); setSectionState(section(sectionName), 'ready'); }
    refreshScrollCues(root);
    return { failed: false, model: result.model };
  }

  // ---- Status: health verdict ------------------------------------------------
  async function loadHealth({ silent = false } = {}) {
    await load('health', 'status', 'health', {
      retry: () => loadHealth(),
      silent,
      onModel: model => { const target = body('health'); if (target) target.innerHTML = healthMarkup(model); },
    });
    // The chart section already says "admin access required"; a second bar for the health line is noise.
    const unauthorized = section('health')?.getAttribute('data-section-kind') === 'unauthorized';
    section('health')?.classList.toggle('is-hidden', unauthorized);
  }

  // ---- Rooms -----------------------------------------------------------------
  function renderRooms(model) {
    const view = roomsMarkup(model);
    const totals = find(root, '[data-rooms-totals]');
    const table = find(root, '[data-rooms-table]');
    const note = find(root, '[data-rooms-note]');
    if (totals) totals.innerHTML = view.totals;
    if (table) table.innerHTML = view.count ? view.table : '';
    const empty = find(root, '[data-rooms-empty]');
    if (empty) empty.classList.toggle('is-hidden', view.count > 0);
    find(root, '[data-rooms-scroll]')?.classList.toggle('is-hidden', view.count === 0);
    if (note) note.textContent = view.count ? `NEWEST FIRST · REFRESHES EVERY ${Math.round(pollMs / 1000)}S` : '';
  }

  async function loadRooms({ silent = false } = {}) {
    const outcome = await load('rooms', 'rooms', 'rooms', {
      retry: () => { void loadRooms(); },
      silent,
      onModel: renderRooms,
    });
    if (!outcome) return;
    if (outcome.failed) chip(outcome.status === 401 || outcome.status === 403 ? 'ADMIN ACCESS REQUIRED' : 'ROOMS UNAVAILABLE · RETRY', 'warning');
    else chip(`LIVE · ${formatClock(outcome.model.generatedAt)}`, 'green', outcome.model.generatedAt);
  }

  function stopPolling() { if (pollTimer !== null) { clearTimeout(pollTimer); pollTimer = null; } }

  // Polls only while Rooms is the shown section and the tab is visible. While the view is
  // not shown the timer keeps ticking without touching the network, so it resumes by itself.
  function schedulePoll() {
    stopPolling();
    if (destroyed || activeTab !== 'rooms' || isDocumentHidden()) return;
    pollTimer = setTimeout(async () => {
      pollTimer = null;
      if (destroyed || activeTab !== 'rooms') return;
      if (isViewShown() && !isDocumentHidden()) await loadRooms({ silent: true });
      schedulePoll();
    }, pollMs);
    // A poll must never be what keeps a Node process (a test run) alive; in a browser this is a no-op.
    pollTimer?.unref?.();
  }

  // ---- Bots & AI: usage + change log ----------------------------------------
  function renderBots(model) {
    const view = botsMarkup(model);
    const target = find(root, '[data-bots-line]');
    if (target) target.innerHTML = view.line;
  }

  async function loadBots() {
    const outcome = await load('bots', 'bots', 'usage', { retry: () => { void loadBots(); }, onModel: renderBots, extra: { range: getRange() } });
    if (!outcome) return;
    if (outcome.failed) chip(outcome.status === 401 || outcome.status === 403 ? 'ADMIN ACCESS REQUIRED' : 'BOT USAGE UNAVAILABLE · RETRY', 'warning');
    else chip(`SYNCED · ${formatClock(outcome.model.generatedAt)}`, 'green', outcome.model.generatedAt);
  }

  const auditArea = tab => (tab === 'release' ? 'release' : 'provider');

  async function loadAudit(tab = activeTab) {
    const area = auditArea(tab);
    const name = `log-${tab}`;
    await load(`audit-${tab}`, 'audit', name, {
      retry: () => { void loadAudit(tab); },
      isEmpty: model => model.entries.filter(entry => entry.area === area).length === 0,
      emptyText: area === 'release' ? 'NO RELEASE CHANGES RECORDED' : 'NO PROVIDER CHANGES RECORDED',
      onModel: model => { const target = find(body(name), '[data-clear]'); if (target) target.innerHTML = auditHealthMarkup(model.health) + auditMarkup(model.entries.filter(entry => entry.area === area)); },
    });
  }

  // ---- Release ---------------------------------------------------------------
  function renderRelease(model) {
    const maintenance = model.maintenance;
    const summary = find(root, '[data-release-summary]');
    if (summary) summary.innerHTML = releaseMarkup(maintenance, clock());
    renderLockout(maintenance);
    syncReleaseButtons(maintenance.mode);
    startCountdown();
  }

  // The public maintenance panel switch. It shows what the server reports and offers the one
  // change that makes sense next; nothing is optimistic.
  function renderLockout(maintenance) {
    const view = lockoutView(maintenance);
    lockoutAction = view.action;
    const badge = find(root, '[data-lockout-badge]');
    if (badge) { badge.textContent = view.state; badge.setAttribute('data-lockout-state', view.locked ? 'on' : 'off'); }
    const note = find(root, '[data-lockout-note]');
    if (note) note.textContent = view.note;
    const button = find(root, '[data-lockout-action]');
    if (button) {
      button.setAttribute('data-lockout-action', view.action);
      const label = find(button, '[data-lockout-label]');
      if (label) label.textContent = LOCKOUT_COPY[view.action].label;
      button.setAttribute('aria-pressed', String(view.locked));
    }
  }

  // The drain countdown reads its target from the markup, so it only counts a deadline the
  // server reported. At zero it reads the state back once. The server ends the drain itself, and
  // a read that still says draining is drawn without a countdown, which stops this from looping.
  function stopCountdown() { if (countdownTimer !== null) { clearInterval(countdownTimer); countdownTimer = null; } }

  function tickCountdown() {
    const target = find(find(root, '[data-release-summary]'), '[data-release-countdown]');
    const deadline = Date.parse(target?.getAttribute('data-deadline') || '');
    if (!target || destroyed || activeTab !== 'release' || !Number.isFinite(deadline)) { stopCountdown(); return; }
    const remaining = deadline - clock();
    target.textContent = formatCountdown(remaining);
    if (remaining > 0) return;
    stopCountdown();
    void loadRelease();
  }

  function startCountdown() {
    stopCountdown();
    if (destroyed || activeTab !== 'release') return;
    if (!find(find(root, '[data-release-summary]'), '[data-release-countdown]')) return;
    countdownTimer = setInterval(tickCountdown, countdownTickMs);
    countdownTimer?.unref?.();
    tickCountdown();
  }

  function syncReleaseButtons(mode = models.status?.maintenance.mode || 'normal') {
    const allowed = releaseActions(mode);
    root.querySelectorAll?.('[data-release-action]').forEach(button => {
      const action = button.getAttribute('data-release-action');
      button.disabled = releaseBusy || !allowed[action];
    });
    const lockout = find(root, '[data-lockout-action]');
    if (lockout) lockout.disabled = releaseBusy || lockoutAction === null;
  }

  function releaseStatus(text, tone = '') {
    const target = find(root, '[data-release-status]');
    if (!target) return;
    target.textContent = text;
    target.classList.remove('green', 'warning');
    if (tone) target.classList.add(tone);
    target.setAttribute('role', tone === 'warning' ? 'alert' : 'status');
  }

  async function loadRelease() {
    const outcome = await load('release', 'status', 'control', { retry: () => { void loadRelease(); }, onModel: renderRelease });
    if (!outcome) return;
    if (outcome.failed) chip(outcome.status === 401 || outcome.status === 403 ? 'ADMIN ACCESS REQUIRED' : 'RELEASE STATE UNAVAILABLE · RETRY', 'warning');
    else chip(`SYNCED · ${formatClock(outcome.model.generatedAt)}`, 'green', outcome.model.generatedAt);
  }

  // Returns false when a release action is already running or the panel has been torn down.
  function beginReleaseAction() {
    if (destroyed || releaseBusy) return false;
    releaseBusy = true;
    syncReleaseButtons();
    releaseStatus('APPLYING…');
    return true;
  }

  function isAccessDenied(status) {
    return status === 401 || status === 403;
  }

  // Puts the server verdict in the status line. An unaudited change still counts as applied, but says so.
  function showVerdict(result, appliedText) {
    if (!result.ok) releaseStatus(`NOT APPLIED · ${isAccessDenied(result.status) ? 'ADMIN ACCESS REQUIRED' : result.error}`, 'warning');
    else if (result.audited === false) releaseStatus(AUDIT_UNSAVED, 'warning');
    else releaseStatus(appliedText, 'green');
  }

  // Moves focus to the fallback control when the focused one was removed or disabled by the refresh.
  function restoreFocusAfterRelease(fallbackSelector) {
    const active = globalThis.document?.activeElement;
    if (!active || active === globalThis.document.body || active.disabled) find(root, fallbackSelector)?.focus?.();
  }

  // Shared tail of both release actions: shows the verdict, then reads the state back from the server.
  async function settleRelease(result, { appliedText, announcement, fallbackSelector }) {
    releaseBusy = false;
    if (destroyed) return;
    showVerdict(result, appliedText);
    if (result.ok) announce(announcement);
    // Read the state back from the server either way.
    await Promise.all([loadRelease(), loadAudit('release')]);
    restoreFocusAfterRelease(fallbackSelector);
  }

  async function applyMode(mode) {
    if (!beginReleaseAction()) return;
    // Read the fields again now: "minutes from now" counts from the moment of the change, not from the click.
    const request = buildMaintenanceRequest({ mode, ...readReleaseFields() }, clock());
    if (!request.ok) { releaseBusy = false; syncReleaseButtons(); markInvalid(request); return; }
    const result = await postMaintenance({ mode, message: request.body.message, releaseId: request.body.releaseId, deadline: request.body.deadline }, { fetcher });
    await settleRelease(result, {
      appliedText: `${RELEASE_COPY[mode].label} APPLIED · CONFIRMED BY SERVER`,
      announcement: 'Release mode changed.',
      fallbackSelector: '[data-release-summary]',
    });
  }

  const RELEASE_FIELDS = Object.freeze({
    releaseId: '[data-release-id]',
    deadlineMinutes: '[data-release-minutes]',
    deadlineAt: '[data-release-at]',
  });

  function readReleaseFields() {
    const value = selector => String(find(root, selector)?.value ?? '');
    return {
      message: plainText(value('[data-release-message]'), 200),
      releaseId: value(RELEASE_FIELDS.releaseId),
      deadlineMinutes: value(RELEASE_FIELDS.deadlineMinutes),
      deadlineAt: value(RELEASE_FIELDS.deadlineAt),
    };
  }

  function clearInvalid() {
    Object.values(RELEASE_FIELDS).forEach(selector => find(root, selector)?.removeAttribute?.('aria-invalid'));
  }

  // Names the field, says why in the status line and puts the cursor there. Nothing was sent.
  function markInvalid(refusal) {
    clearInvalid();
    const field = Object.hasOwn(RELEASE_FIELDS, refusal.field) ? find(root, RELEASE_FIELDS[refusal.field]) : null;
    field?.setAttribute?.('aria-invalid', 'true');
    releaseStatus(`NOT APPLIED · ${refusal.error}`, 'warning');
    field?.focus?.();
  }

  // The confirmation spells out what will be sent, so the operator sees the id and the deadline.
  function confirmDetail(body) {
    return [
      body.releaseId ? `Release ${body.releaseId}.` : '',
      body.deadline ? `Maintenance starts by itself at ${formatStamp(body.deadline)} UTC if rounds are still running.` : '',
    ].filter(Boolean).join(' ');
  }

  function requestMode(mode) {
    if (!Object.hasOwn(RELEASE_COPY, mode) || releaseBusy) return;
    const request = buildMaintenanceRequest({ mode, ...readReleaseFields() }, clock());
    if (!request.ok) { markInvalid(request); return; }
    clearInvalid();
    const copy = RELEASE_COPY[mode];
    const detail = confirmDetail(request.body);
    const open = confirm || (async options => { const surfaces = await import('./clientSurfaces.js'); surfaces.openConfirmModal(options); });
    // Cancel closes the dialog and does nothing; only the accept button reaches applyMode.
    void open({ title: copy.title, message: detail ? `${copy.message} ${detail}` : copy.message, confirmLabel: copy.confirm, onConfirm: () => { void applyMode(mode); } });
  }

  // ---- Public maintenance panel -------------------------------------------------
  // The request body for the public maintenance panel: "on" carries the message, "off" reopens the site.
  function lockoutPayload(action, fields) {
    return action === 'on' ? { enabled: true, message: fields.message, releaseId: fields.releaseId } : { enabled: false, reopen: true };
  }

  async function applyLockout(action) {
    if (!beginReleaseAction()) return;
    const result = await postLockout(lockoutPayload(action, readReleaseFields()), { fetcher });
    await settleRelease(result, {
      appliedText: LOCKOUT_COPY[action].applied,
      announcement: action === 'on' ? 'Maintenance panel is on.' : 'Maintenance panel is off. The site is open.',
      fallbackSelector: '[data-lockout-action]',
    });
  }

  function requestLockout() {
    if (releaseBusy || lockoutAction === null) return;
    const action = lockoutAction;
    const request = buildLockoutRequest(lockoutPayload(action, readReleaseFields()));
    if (!request.ok) { markInvalid(request); return; }
    clearInvalid();
    const copy = LOCKOUT_COPY[action];
    const detail = [request.body.releaseId ? `Release ${request.body.releaseId}.` : '', request.body.message ? `Visitors read: ${request.body.message}` : ''].filter(Boolean).join(' ');
    const open = confirm || (async options => { const surfaces = await import('./clientSurfaces.js'); surfaces.openConfirmModal(options); });
    void open({ title: copy.title, message: detail ? `${copy.message} ${detail}` : copy.message, confirmLabel: copy.confirm, onConfirm: () => { void applyLockout(action); } });
  }

  // ---- Lifecycle ---------------------------------------------------------------
  function show(tab) {
    if (destroyed) return;
    const previous = activeTab;
    activeTab = tab;
    stopPolling();
    if (tab !== 'release') stopCountdown();
    if (previous && previous !== tab) cancelAll();
    if (tab === 'status') void loadHealth();
    else if (tab === 'rooms') { void loadRooms().then(schedulePoll); }
    else if (tab === 'bots') { void loadBots(); void loadAudit('bots'); }
    else if (tab === 'release') { void loadRelease(); void loadAudit('release'); }
    refreshScrollCues(root);
  }

  function refresh() { if (activeTab) show(activeTab); }

  function hide() { activeTab = null; stopPolling(); stopCountdown(); cancelAll(); }

  function onVisibility() {
    if (isDocumentHidden()) { stopPolling(); aborts.rooms?.abort(); return; }
    if (activeTab === 'rooms') { void loadRooms({ silent: true }).then(schedulePoll); }
  }

  function listen(target, event, handler) {
    target?.addEventListener?.(event, handler);
    cleanups.push(() => target?.removeEventListener?.(event, handler));
  }

  listen(globalThis.document, 'visibilitychange', onVisibility);
  // A provider change (save, test, activate) is written to the log; show it without a reload.
  listen(globalThis.document, 'poorup-admin-audit-stale', () => { if (activeTab === 'bots') void loadAudit('bots'); });
  root.querySelectorAll?.('[data-release-action]').forEach(button => {
    listen(button, 'click', () => requestMode(button.getAttribute('data-release-action')));
  });

  const lockoutButton = find(root, '[data-lockout-action]');
  if (lockoutButton) listen(lockoutButton, 'click', requestLockout);

  function destroy() {
    destroyed = true;
    stopPolling();
    stopCountdown();
    cancelAll();
    cleanups.splice(0).forEach(remove => remove());
  }

  return Object.freeze({ show, hide, refresh, destroy, get activeTab() { return activeTab; } });
}
