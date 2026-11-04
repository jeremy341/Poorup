import { state } from './clientState.js';
import { openConfirmModal } from './clientSurfaces.js';
import { setSectionState, setSectionFailure } from './clientAdminPanelState.js';

const API_ROOT = '/admin/ai';
const PROTOCOL_LABELS = Object.freeze({ auto: 'AUTO · DETECT', chat: 'CHAT COMPLETIONS', responses: 'RESPONSES' });
const HEALTH_LABELS = Object.freeze({ healthy: 'READY', unconfigured: 'UNCONFIGURED', 'quota-exhausted': 'CREDITS EXHAUSTED', cooldown: 'COOLDOWN', open: 'FALLBACK ACTIVE' });

function query(selector) { return globalThis.document?.querySelector?.(selector) || null; }
function safeText(value, fallback = '', max = 240) { return [...String(value ?? fallback)].filter(character => { const code = character.charCodeAt(0); return code >= 32 && code !== 127; }).join('').slice(0, max); }
const AUDIT_UNSAVED = 'Done, but the audit log could not be saved. Check the audit log file.';
const STALE_TEST = 'The profile changed while the test ran; run the test again.';
// A success status, or the plain audit warning when the server says the action ran but its log entry was not saved.
function setDone(payload, message) { if (payload?.audited === false) setStatus(AUDIT_UNSAVED, 'warning'); else setStatus(message, 'green'); }
function announce(message) { const target = query('[data-document-announcer]'); if (target) target.textContent = message; }
function setStatus(message, tone = '') { const target = query('[data-admin-provider-test-status]'); if (!target) return; target.textContent = message; target.classList.remove('green', 'warning'); if (tone) target.classList.add(tone); }

// The one place the console talks to admin endpoints: same-origin cookie session plus the
// optional session-token header, no caching, JSON in and out. Reads and writes from every
// console panel go through here, so they all use the same auth approach.
export function sessionHeaders(json = false) { const headers = {}; if (state.account?.sessionToken) headers['x-poorup-session-token'] = state.account.sessionToken; if (json) headers['content-type'] = 'application/json'; return headers; }

export async function adminRequest(path, { method = 'GET', body, signal, fetcher } = {}) {
  const send = fetcher || globalThis.fetch?.bind(globalThis);
  if (typeof send !== 'function') return { ok: false, status: 503, payload: {} };
  const init = { method, headers: sessionHeaders(body !== undefined), credentials: 'include', cache: 'no-store', signal };
  if (body !== undefined) init.body = JSON.stringify(body);
  const response = await send(path, init);
  const payload = await (typeof response?.json === 'function' ? response.json().catch(() => ({})) : response) || {};
  const status = Number(response?.status ?? payload?.status) || 200;
  return { ok: response?.ok !== false && payload.success !== false, status, payload };
}

function formatEndpoint(value) { try { const url = new URL(String(value || '')); return `${url.host}${url.pathname.replace(/\/+$/, '') || '/'}`; } catch { return safeText(value, '-', 120); } }
function normalizeProfile(value) {
  if (!value || typeof value !== 'object') return null;
  return {
    id: safeText(value.id, '', 64),
    label: safeText(value.label, 'Unnamed provider', 80),
    baseUrl: safeText(value.baseUrl, '', 400),
    model: safeText(value.model, '', 120),
    protocol: ['auto', 'chat', 'responses'].includes(value.protocol) ? value.protocol : 'auto',
    detectedProtocol: ['chat', 'responses'].includes(value.detectedProtocol) ? value.detectedProtocol : null,
    timeoutMs: Number(value.timeoutMs) || 4000,
    maxDecisionsPerGame: Number(value.maxDecisionsPerGame) || 240,
    enabled: value.enabled !== false,
    keyConfigured: value.keyConfigured === true,
    source: value.source === 'environment' ? 'environment' : 'profile',
    readOnly: value.readOnly === true,
    lastTest: value.lastTest && typeof value.lastTest === 'object' ? {
      ok: value.lastTest.ok === true,
      protocol: ['chat', 'responses'].includes(value.lastTest.protocol) ? value.lastTest.protocol : null,
      latencyMs: Number(value.lastTest.latencyMs) || 0,
      testedAt: safeText(value.lastTest.testedAt, '', 40),
      reason: safeText(value.lastTest.reason, '', 40),
    } : null,
  };
}

function field(name) { return query(`[data-admin-provider-field="${name}"]`); }
function setField(name, value) { const element = field(name); if (element) element.value = value ?? ''; }
function readForm() {
  const values = {};
  ['label', 'model', 'baseUrl', 'protocol', 'apiKey', 'timeoutMs', 'maxDecisionsPerGame'].forEach(name => { values[name] = field(name)?.value ?? ''; });
  return values;
}
function fillForm(profile) {
  setField('label', profile?.label || '');
  setField('model', profile?.model || '');
  setField('baseUrl', profile?.baseUrl || '');
  setField('protocol', profile?.protocol || 'auto');
  setField('apiKey', '');
  setField('timeoutMs', profile?.timeoutMs || 4000);
  setField('maxDecisionsPerGame', profile?.maxDecisionsPerGame || 240);
  const save = query('[data-admin-provider-save]');
  const saveReason = query('[data-admin-provider-save-reason]');
  if (save) save.disabled = Boolean(profile?.readOnly);
  if (save) { if (profile?.readOnly) save.setAttribute('aria-describedby', 'admin-provider-save-reason'); else save.removeAttribute('aria-describedby'); }
  if (saveReason) saveReason.hidden = !profile?.readOnly;
  const key = field('apiKey');
  if (key) key.placeholder = profile?.readOnly ? 'Environment key is write-only' : profile?.keyConfigured ? 'Leave blank to keep the existing key' : 'Paste a server-side key';
}

function createButton(label, action, profile, disabled = false, reasonId = '') {
  const button = globalThis.document.createElement('button');
  button.type = 'button';
  button.className = 'btn-dark';
  button.dataset.adminProviderAction = action;
  button.dataset.profileId = profile.id;
  button.disabled = disabled;
  button.textContent = label;
  button.setAttribute('aria-label', `${label} ${profile.label}`);
  if (disabled && reasonId) button.setAttribute('aria-describedby', reasonId);
  return button;
}

// Why ACTIVATE is unavailable for a profile, or '' when it is available.
function activateBlockReason(profile, model) {
  if (model.testing || model.saving) return 'Activate unavailable while a test or save is running.';
  if (model.active?.id === profile.id) return 'Activate unavailable: this profile is already the active provider.';
  if (!profile.lastTest?.ok) return 'Activate unavailable: test this connection first.';
  return '';
}

// The badge answers from the server's own health. Without health, it describes an active profile
// by its last test. An unconfigured profile is saved but not in use (for example, its config key was
// missing at boot), which is not the same as having nothing active.
export function providerBadge(active, health) {
  const reported = safeText(health?.state || '', '', 40).toLowerCase();
  const known = Object.hasOwn(HEALTH_LABELS, reported);
  const label = known ? HEALTH_LABELS[reported] : !active ? HEALTH_LABELS.unconfigured : active.lastTest?.ok ? 'READY' : 'FALLBACK ACTIVE';
  const state = reported === 'healthy' ? 'healthy' : ['quota-exhausted', 'cooldown', 'open'].includes(reported) ? 'error' : '';
  return { label, state, notInUse: Boolean(active) && reported === 'unconfigured' };
}

// A read that carries no health (or nonsense) keeps the health already known, never erases it.
export function mergeProviderHealth(known, incoming) {
  return incoming && typeof incoming === 'object' && !Array.isArray(incoming) ? incoming : known;
}

function renderActive(model) {
  const active = model.active;
  const healthState = safeText(model.provider?.state || '', '', 40).toLowerCase();
  const verdict = providerBadge(active, model.provider);
  const badge = query('[data-admin-provider-state]');
  if (badge) { badge.textContent = verdict.label; badge.dataset.state = verdict.state; }
  const set = (selector, value) => { const target = query(selector); if (target) target.textContent = value; };
  set('[data-admin-provider-active-label]', active?.label || 'NO PROFILE ACTIVE');
  set('[data-admin-provider-active-model]', active?.model || '-');
  set('[data-admin-provider-active-format]', active ? PROTOCOL_LABELS[active.detectedProtocol || active.protocol] : 'AUTO · UNTESTED');
  set('[data-admin-provider-active-url]', active ? formatEndpoint(active.baseUrl) : '-');
  set('[data-admin-provider-active-key]', active?.keyConfigured ? 'CONFIGURED · WRITE-ONLY' : 'NOT CONFIGURED');
  const note = query('[data-admin-provider-active-note]');
  if (note) {
    if (verdict.notInUse) note.textContent = 'This profile is saved but the server is not using it (no usable key was loaded). Bots use the deterministic house brain.';
    else if (healthState === 'quota-exhausted') note.textContent = 'Credits are exhausted. AI requests are disabled until another provider is activated.';
    else if (healthState === 'cooldown' || healthState === 'open') note.textContent = 'The provider is cooling down. Bots continue with the deterministic house brain.';
    else if (active?.lastTest?.ok) note.textContent = `Last test passed in ${active.lastTest.latencyMs}ms. Game actions remain server-authoritative.`;
    else note.textContent = 'AI failures always return to the deterministic house brain.';
  }
}

function renderProfiles(model) {
  const list = query('[data-admin-provider-list]');
  if (!list) return;
  list.replaceChildren();
  if (!model.profiles.length) {
    const empty = globalThis.document.createElement('p');
    empty.className = 'admin-provider-empty';
    empty.textContent = 'NO SAVED PROFILES · CREATE ONE TO TEST A PROVIDER';
    list.append(empty);
    return;
  }
  model.profiles.forEach((profile, index) => {
    const row = globalThis.document.createElement('article');
    row.className = `admin-provider-row${model.active?.id === profile.id ? ' is-active' : ''}`;
    row.dataset.profileId = profile.id;
    const copy = globalThis.document.createElement('div');
    copy.className = 'admin-provider-row-copy';
    const title = globalThis.document.createElement('strong');
    title.textContent = profile.label;
    const modelLine = globalThis.document.createElement('span');
    modelLine.textContent = `${profile.model || 'NO MODEL'} · ${PROTOCOL_LABELS[profile.detectedProtocol || profile.protocol]}`;
    const meta = globalThis.document.createElement('small');
    meta.textContent = `${profile.source === 'environment' ? 'ENVIRONMENT DEFAULT' : profile.keyConfigured ? 'KEY CONFIGURED' : 'KEY MISSING'}${profile.lastTest?.ok ? ` · TESTED ${profile.lastTest.latencyMs}MS` : ' · NOT TESTED'}`;
    copy.append(title, modelLine, meta);
    const actions = globalThis.document.createElement('div');
    actions.className = 'admin-provider-row-actions';
    if (!profile.readOnly) {
      const reason = activateBlockReason(profile, model);
      const reasonId = `admin-provider-reason-${index}`;
      actions.append(createButton('EDIT', 'edit', profile));
      actions.append(createButton('TEST', 'test', profile, model.testing || model.saving, reason ? reasonId : ''));
      actions.append(createButton('ACTIVATE', 'activate', profile, Boolean(reason), reasonId));
      if (reason) {
        const note = globalThis.document.createElement('p');
        note.className = 'admin-provider-action-reason t-micro ink-3';
        note.id = reasonId;
        note.textContent = reason;
        copy.append(note);
      }
    } else {
      const badge = globalThis.document.createElement('span');
      badge.className = 't-micro ink-3';
      badge.textContent = 'READ-ONLY';
      actions.append(badge);
    }
    row.append(copy, actions);
    list.append(row);
  });
}

export function initAdminAiProvider({ confirm = openConfirmModal } = {}) {
  if (globalThis.window?.location?.pathname !== '/admin/analytics') return false;
  const roster = query('[data-admin-provider-roster]');
  if (!roster || !query('[data-admin-provider-form]')) return false;
  const model = { profiles: [], active: null, provider: null, selectedId: '', loaded: false, loading: false, saving: false, testing: false, touched: false };

  function render() { renderActive(model); renderProfiles(model); }

  async function load({ keepStatus = false } = {}) {
    if (model.loading) return false;
    model.loading = true;
    setSectionState(roster, 'loading', { message: 'LOADING PROVIDER ROSTER…' });
    try {
      const { ok, status, payload } = await adminRequest(`${API_ROOT}/providers`);
      if (!ok) { setSectionFailure(roster, status, load); setStatus(safeText(payload.error, 'PROVIDER ROSTER UNAVAILABLE', 160), 'warning'); return false; }
      model.profiles = (Array.isArray(payload.providers) ? payload.providers : []).map(normalizeProfile).filter(Boolean);
      model.active = normalizeProfile(payload.active);
      model.provider = mergeProviderHealth(model.provider, payload.provider);
      model.loaded = true;
      if (!model.selectedId || !model.profiles.some(profile => profile.id === model.selectedId)) model.selectedId = model.active?.id || model.profiles[0]?.id || '';
      // Show the selected profile in the form, unless the operator is in the middle of typing one.
      const selected = model.profiles.find(profile => profile.id === model.selectedId);
      if (selected && !model.touched) fillForm(selected);
      if (!keepStatus) setStatus(model.active ? 'PROVIDER ROSTER LOADED · CREDENTIALS REDACTED' : 'NO ACTIVE PROVIDER · DETERMINISTIC FALLBACK READY', model.active ? '' : 'warning');
      render();
      setSectionState(roster, 'ready');
      return true;
    } catch {
      setSectionFailure(roster, 503, load);
      setStatus('PROVIDER ROSTER UNAVAILABLE', 'warning');
      return false;
    } finally { model.loading = false; }
  }

  async function save(event) {
    event.preventDefault();
    const form = query('[data-admin-provider-form]');
    if (!form?.reportValidity?.()) return;
    const values = readForm();
    const editing = model.selectedId && model.profiles.some(profile => profile.id === model.selectedId && !profile.readOnly);
    const body = { label: values.label, model: values.model, baseUrl: values.baseUrl, protocol: values.protocol, timeoutMs: values.timeoutMs, maxDecisionsPerGame: values.maxDecisionsPerGame };
    if (values.apiKey.trim()) body.apiKey = values.apiKey;
    model.saving = true;
    render();
    try {
      const { ok, payload } = await adminRequest(editing ? `${API_ROOT}/providers/${encodeURIComponent(model.selectedId)}` : `${API_ROOT}/providers`, { method: editing ? 'PATCH' : 'POST', body });
      if (!ok) throw new Error(payload.error || 'Provider profile could not be saved.');
      model.selectedId = payload.profile?.id || model.selectedId;
      setField('apiKey', '');
      model.touched = false;
      setDone(payload, 'PROFILE SAVED · TEST CONNECTION BEFORE ACTIVATION');
      announce('Provider profile saved. Test it before activation.');

      await load({ keepStatus: true });
      document.dispatchEvent(new CustomEvent('poorup-admin-audit-stale'));
    } catch (error) { setStatus(safeText(error.message, 'PROFILE SAVE FAILED', 160), 'warning'); }
    finally { model.saving = false; render(); }
  }

  async function testProfile(id) {
    if (!id) return;
    model.testing = true;
    render();
    try {
      const { ok, status, payload } = await adminRequest(`${API_ROOT}/providers/${encodeURIComponent(id)}/test`, { method: 'POST', body: {} });
      // The profile changed under the test: show the server's own words, and never read it as a verdict on the provider.
      if (!ok && (status === 409 || payload.code === 'PROFILE_CHANGED' || payload.test?.reason === 'stale')) throw new Error(payload.error || STALE_TEST);
      if (!ok) throw new Error(payload.test?.reason ? `CONNECTION TEST FAILED · ${String(payload.test.reason).toUpperCase()}` : payload.error || 'Connection test failed.');
      const protocol = PROTOCOL_LABELS[payload.test?.protocol] || 'FORMAT DETECTED';
      const testedProfile = normalizeProfile(payload.profile);
      if (testedProfile) {
        model.profiles = model.profiles.map(profile => profile.id === testedProfile.id ? testedProfile : profile);
        if (model.active?.id === testedProfile.id) model.active = testedProfile;
      }
      setDone(payload, `${protocol} READY · ${Number(payload.test?.latencyMs) || 0}MS`);
      announce(`Provider connection tested successfully. ${protocol}.`);
      render();
    } catch (error) { setStatus(safeText(error.message, 'CONNECTION TEST FAILED', 160), 'warning'); }
    finally { model.testing = false; render(); document.dispatchEvent(new CustomEvent('poorup-admin-audit-stale')); }
  }

  async function activateProfile(id) {
    if (!id) return;
    model.saving = true;
    render();
    try {
      const { ok, payload } = await adminRequest(`${API_ROOT}/providers/${encodeURIComponent(id)}/activate`, { method: 'POST', body: {} });
      if (!ok) throw new Error(payload.error || 'Provider activation failed.');
      model.provider = mergeProviderHealth(model.provider, payload.status?.provider);
      const activeProfile = normalizeProfile(payload.active);
      if (activeProfile) {
        model.active = activeProfile;
        model.profiles = model.profiles.map(profile => profile.id === activeProfile.id ? activeProfile : profile);
      }
      setDone(payload, 'PROVIDER ACTIVE · NEW AI DECISIONS USE THIS PROFILE');
      announce('Provider activated.');
      render();
    } catch (error) { setStatus(safeText(error.message, 'PROVIDER ACTIVATION FAILED', 160), 'warning'); }
    finally { model.saving = false; render(); document.dispatchEvent(new CustomEvent('poorup-admin-audit-stale')); }
  }

  // The editor is inline, beside the active provider: choosing a profile fills it, New clears it.
  function selectProfile(id) {
    model.selectedId = id;
    model.touched = false;
    const profile = model.profiles.find(entry => entry.id === id);
    if (profile) fillForm(profile);
    renderProfiles(model);
  }

  function newProfile() {
    model.selectedId = '';
    model.touched = false;
    fillForm(null);
    renderProfiles(model);
    setStatus('NEW PROFILE · ENTER A BASE URL, MODEL, AND SERVER-SIDE KEY');
    field('label')?.focus?.();
  }

  // A live push before the roster has been read, or while a change is in flight, would pair a health
  // with the profile from before it: keep the health, and draw once the read or the change settles.
  // Activation changes live bot decisions, so it always goes through the shared confirm surface (CANCEL is focused first).
  function confirmActivate(id) {
    const profile = model.profiles.find(entry => entry.id === id);
    if (!profile || activateBlockReason(profile, model)) return;
    confirm({
      title: `Activate ${profile.label}?`,
      message: 'New bot decisions in live games will use this provider as soon as it is activated.',
      confirmLabel: 'ACTIVATE PROVIDER',
      mark: false,
      onConfirm: () => void activateProfile(id)
    });
  }

  const onProviderStatus = event => {
    model.provider = mergeProviderHealth(model.provider, event.detail);
    if (model.loaded && !model.saving) renderActive(model);
  };
  // The console tells us when the Bots & AI section is shown; the roster is read then, not at page load.
  const onAdminTab = event => { if (event.detail?.tab === 'bots') void load(); };
  document.addEventListener('poorup-bot-provider-status', onProviderStatus);
  document.addEventListener('poorup-admin-tab', onAdminTab);

  query('[data-admin-provider-form]')?.addEventListener('submit', save);
  query('[data-admin-provider-form]')?.addEventListener('input', () => { model.touched = true; });
  query('[data-admin-provider-new]')?.addEventListener('click', newProfile);
  query('[data-admin-provider-list]')?.addEventListener('click', event => {
    const button = event.target.closest?.('[data-admin-provider-action]');
    const row = event.target.closest?.('[data-profile-id]');
    if (!button) { if (row) selectProfile(row.dataset.profileId); return; }
    const id = button.dataset.profileId;
    if (button.dataset.adminProviderAction === 'edit') { selectProfile(id); field('label')?.focus?.(); }
    if (button.dataset.adminProviderAction === 'test') void testProfile(id);
    if (button.dataset.adminProviderAction === 'activate') confirmActivate(id);
  });
  fillForm(null);
  globalThis.__poorupAdminAiProvider = Object.freeze({
    load,
    destroy() { document.removeEventListener('poorup-bot-provider-status', onProviderStatus); document.removeEventListener('poorup-admin-tab', onAdminTab); }, get model() { return { ...model, profiles: [...model.profiles] }; } });
  if (query('[data-admin-section][aria-selected="true"]')?.dataset.adminSection === 'bots') void load();
  return true;
}
