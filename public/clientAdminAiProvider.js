import { state } from './clientState.js';

const API_ROOT = '/admin/ai';
const PROTOCOL_LABELS = Object.freeze({ auto: 'AUTO · DETECT', chat: 'CHAT COMPLETIONS', responses: 'RESPONSES' });
const HEALTH_LABELS = Object.freeze({ healthy: 'READY', unconfigured: 'UNCONFIGURED', 'quota-exhausted': 'CREDITS EXHAUSTED', cooldown: 'COOLDOWN', open: 'FALLBACK ACTIVE' });

function query(selector) { return globalThis.document?.querySelector?.(selector) || null; }
function all(selector) { return [...(globalThis.document?.querySelectorAll?.(selector) || [])]; }
function safeText(value, fallback = '', max = 240) { return [...String(value ?? fallback)].filter(character => { const code = character.charCodeAt(0); return code >= 32 && code !== 127; }).join('').slice(0, max); }
function setHidden(element, hidden) { if (!element) return; element.classList.toggle('is-hidden', hidden); element.setAttribute('aria-hidden', String(hidden)); element.toggleAttribute('inert', hidden); }
function announce(message) { const target = query('[data-document-announcer]'); if (target) target.textContent = message; }
function setStatus(message, tone = '') { const target = query('[data-admin-provider-test-status]'); if (!target) return; target.textContent = message; target.classList.remove('green', 'warning'); if (tone) target.classList.add(tone); }
function sessionHeaders(json = false) { const headers = {}; if (state.account?.sessionToken) headers['x-poorup-session-token'] = state.account.sessionToken; if (json) headers['content-type'] = 'application/json'; return headers; }
function formatEndpoint(value) { try { const url = new URL(String(value || '')); return `${url.host}${url.pathname.replace(/\/+$/, '') || '/'}`; } catch { return safeText(value, '—', 120); } }
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
    maxDecisionsPerGame: Number(value.maxDecisionsPerGame) || 120,
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
  setField('maxDecisionsPerGame', profile?.maxDecisionsPerGame || 120);
  const save = query('[data-admin-provider-save]');
  if (save) save.disabled = Boolean(profile?.readOnly);
  const key = field('apiKey');
  if (key) key.placeholder = profile?.readOnly ? 'Environment key is write-only' : profile?.keyConfigured ? 'Leave blank to keep the existing key' : 'Paste a server-side key';
}

function createButton(label, action, profile, disabled = false) {
  const button = globalThis.document.createElement('button');
  button.type = 'button';
  button.className = 'btn-dark';
  button.dataset.adminProviderAction = action;
  button.dataset.profileId = profile.id;
  button.disabled = disabled;
  button.textContent = label;
  button.setAttribute('aria-label', `${label} ${profile.label}`);
  return button;
}

function renderActive(model) {
  const active = model.active;
  const healthState = safeText(model.provider?.state || '', '', 40).toLowerCase();
  const stateLabel = HEALTH_LABELS[healthState] || (active?.lastTest?.ok ? 'READY' : 'FALLBACK ACTIVE');
  const badge = query('[data-admin-provider-state]');
  if (badge) { badge.textContent = stateLabel; badge.dataset.state = healthState === 'healthy' ? 'healthy' : ['quota-exhausted', 'cooldown', 'open'].includes(healthState) ? 'error' : ''; }
  const set = (selector, value) => { const target = query(selector); if (target) target.textContent = value; };
  set('[data-admin-provider-active-label]', active?.label || 'NO PROFILE ACTIVE');
  set('[data-admin-provider-active-model]', active?.model || '—');
  set('[data-admin-provider-active-format]', active ? PROTOCOL_LABELS[active.detectedProtocol || active.protocol] : 'AUTO · UNTESTED');
  set('[data-admin-provider-active-url]', active ? formatEndpoint(active.baseUrl) : '—');
  set('[data-admin-provider-active-key]', active?.keyConfigured ? 'CONFIGURED · WRITE-ONLY' : 'NOT CONFIGURED');
  const note = query('[data-admin-provider-active-note]');
  if (note) {
    if (healthState === 'quota-exhausted') note.textContent = 'Credits are exhausted. AI requests are disabled until another provider is activated.';
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
  model.profiles.forEach(profile => {
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
      actions.append(createButton('EDIT', 'edit', profile));
      actions.append(createButton('TEST', 'test', profile, model.testing || model.saving));
      actions.append(createButton('ACTIVATE', 'activate', profile, model.active?.id === profile.id || !profile.lastTest?.ok || model.testing || model.saving));
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

export function initAdminAiProvider() {
  if (globalThis.window?.location?.pathname !== '/admin/analytics') return false;
  const providerWorkspace = query('[data-admin-provider-workspace]');
  const analyticsWorkspace = query('.admin-analytics-workspace');
  const consoleTabs = all('[data-admin-console-tab]');
  if (!providerWorkspace || !analyticsWorkspace || !consoleTabs.length) return false;
  const model = { profiles: [], active: null, provider: null, selectedId: '', loading: false, saving: false, testing: false };
  let currentSurface = 'analytics';

  function setSurface(surface, { focus = false, syncUrl = true } = {}) {
    currentSurface = surface === 'provider' ? 'provider' : 'analytics';
    consoleTabs.forEach(tab => {
      const active = tab.dataset.adminConsoleTab === currentSurface;
      tab.classList.toggle('is-active', active);
      tab.setAttribute('aria-selected', String(active));
      tab.tabIndex = active ? 0 : -1;
    });
    const providerActive = currentSurface === 'provider';
    setHidden(analyticsWorkspace, providerActive);
    setHidden(providerWorkspace, !providerActive);
    if (providerActive) {
      providerWorkspace.classList.remove('is-entering');
      const motion = globalThis.matchMedia?.('(prefers-reduced-motion: reduce)');
      if (!motion?.matches) requestAnimationFrame(() => providerWorkspace.classList.add('is-entering'));
      if (!model.profiles.length && !model.loading) void load();
    }
    if (syncUrl && globalThis.history?.replaceState) {
      const url = new URL(globalThis.location.href);
      if (providerActive) url.searchParams.set('admin', 'provider');
      else url.searchParams.delete('admin');
      globalThis.history.replaceState(null, '', `${url.pathname}${url.search}${url.hash}`);
    }
    if (focus) consoleTabs.find(tab => tab.dataset.adminConsoleTab === currentSurface)?.focus?.();
  }

  function render() { renderActive(model); renderProfiles(model); }

  async function load() {
    if (!state.account?.account) { setStatus('ADMIN ACCOUNT REQUIRED', 'warning'); render(); return false; }
    model.loading = true;
    try {
      const response = await fetch(`${API_ROOT}/providers`, { headers: sessionHeaders(), credentials: 'include', cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false) throw new Error(payload.error || 'Provider roster unavailable.');
      model.profiles = (Array.isArray(payload.providers) ? payload.providers : []).map(normalizeProfile).filter(Boolean);
      model.active = normalizeProfile(payload.active);
      model.provider = payload.provider || null;
      if (!model.selectedId || !model.profiles.some(profile => profile.id === model.selectedId)) model.selectedId = model.active?.id || model.profiles[0]?.id || '';
      const selected = model.profiles.find(profile => profile.id === model.selectedId);
      if (selected) fillForm(selected);
      setStatus(model.active ? 'PROVIDER ROSTER LOADED · CREDENTIALS REDACTED' : 'NO ACTIVE PROVIDER · DETERMINISTIC FALLBACK READY', model.active ? '' : 'warning');
      render();
      return true;
    } catch (error) {
      setStatus(safeText(error.message, 'PROVIDER ROSTER UNAVAILABLE', 160), 'warning');
      return false;
    } finally { model.loading = false; }
  }

  async function save(event) {
    event.preventDefault();
    const form = query('[data-admin-provider-form]');
    if (!form?.reportValidity?.()) return;
    if (!state.account?.account) { setStatus('ADMIN ACCOUNT REQUIRED', 'warning'); return; }
    const values = readForm();
    const editing = model.selectedId && model.profiles.some(profile => profile.id === model.selectedId && !profile.readOnly);
    const body = { label: values.label, model: values.model, baseUrl: values.baseUrl, protocol: values.protocol, timeoutMs: values.timeoutMs, maxDecisionsPerGame: values.maxDecisionsPerGame };
    if (values.apiKey.trim()) body.apiKey = values.apiKey;
    model.saving = true;
    render();
    try {
      const response = await fetch(editing ? `${API_ROOT}/providers/${encodeURIComponent(model.selectedId)}` : `${API_ROOT}/providers`, { method: editing ? 'PATCH' : 'POST', headers: sessionHeaders(true), body: JSON.stringify(body), credentials: 'include', cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false) throw new Error(payload.error || 'Provider profile could not be saved.');
      model.selectedId = payload.profile?.id || model.selectedId;
      setStatus('PROFILE SAVED · TEST CONNECTION BEFORE ACTIVATION', 'green');
      announce('Provider profile saved. Test it before activation.');
      await load();
    } catch (error) { setStatus(safeText(error.message, 'PROFILE SAVE FAILED', 160), 'warning'); }
    finally { model.saving = false; render(); }
  }

  async function testProfile(id) {
    if (!id) return;
    model.testing = true;
    render();
    try {
      const response = await fetch(`${API_ROOT}/providers/${encodeURIComponent(id)}/test`, { method: 'POST', headers: sessionHeaders(true), body: '{}', credentials: 'include', cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false) throw new Error(payload.test?.reason ? `CONNECTION TEST FAILED · ${String(payload.test.reason).toUpperCase()}` : payload.error || 'Connection test failed.');
      const protocol = PROTOCOL_LABELS[payload.test?.protocol] || 'FORMAT DETECTED';
      const testedProfile = normalizeProfile(payload.profile);
      if (testedProfile) {
        model.profiles = model.profiles.map(profile => profile.id === testedProfile.id ? testedProfile : profile);
        if (model.active?.id === testedProfile.id) model.active = testedProfile;
      }
      setStatus(`${protocol} READY · ${Number(payload.test?.latencyMs) || 0}MS`, 'green');
      announce(`Provider connection tested successfully. ${protocol}.`);
      render();
    } catch (error) { setStatus(safeText(error.message, 'CONNECTION TEST FAILED', 160), 'warning'); }
    finally { model.testing = false; render(); }
  }

  async function activateProfile(id) {
    if (!id) return;
    model.saving = true;
    render();
    try {
      const response = await fetch(`${API_ROOT}/providers/${encodeURIComponent(id)}/activate`, { method: 'POST', headers: sessionHeaders(true), body: '{}', credentials: 'include', cache: 'no-store' });
      const payload = await response.json().catch(() => ({}));
      if (!response.ok || payload.success === false) throw new Error(payload.error || 'Provider activation failed.');
      const activeProfile = normalizeProfile(payload.active);
      if (activeProfile) {
        model.active = activeProfile;
        model.profiles = model.profiles.map(profile => profile.id === activeProfile.id ? activeProfile : profile);
      }
      setStatus('PROVIDER ACTIVE · NEW AI DECISIONS USE THIS PROFILE', 'green');
      announce('Provider activated.');
      render();
    } catch (error) { setStatus(safeText(error.message, 'PROVIDER ACTIVATION FAILED', 160), 'warning'); }
    finally { model.saving = false; render(); }
  }

  function selectProfile(id) {
    model.selectedId = id;
    const profile = model.profiles.find(entry => entry.id === id);
    if (profile) fillForm(profile);
    renderProfiles(model);
  }

  function newProfile() {
    model.selectedId = '';
    fillForm(null);
    setStatus('NEW PROFILE · ENTER A BASE URL, MODEL, AND SERVER-SIDE KEY');
    field('label')?.focus?.();
  }

  document.addEventListener('poorup-bot-provider-status', event => {
    model.provider = event.detail || null;
    renderActive(model);
  });

  function onConsoleTabKeydown(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End', 'Enter', ' '].includes(event.key)) return;
    event.preventDefault();
    const index = consoleTabs.indexOf(event.currentTarget);
    if (event.key === 'Enter' || event.key === ' ') return setSurface(event.currentTarget.dataset.adminConsoleTab, { focus: true });
    const nextIndex = event.key === 'Home' ? 0 : event.key === 'End' ? consoleTabs.length - 1 : (index + (event.key === 'ArrowLeft' ? -1 : 1) + consoleTabs.length) % consoleTabs.length;
    setSurface(consoleTabs[nextIndex].dataset.adminConsoleTab, { focus: true });
  }

  consoleTabs.forEach(tab => { tab.addEventListener('click', () => setSurface(tab.dataset.adminConsoleTab)); tab.addEventListener('keydown', onConsoleTabKeydown); });
  query('[data-admin-provider-form]')?.addEventListener('submit', save);
  query('[data-admin-provider-new]')?.addEventListener('click', newProfile);
  query('[data-admin-provider-list]')?.addEventListener('click', event => {
    const button = event.target.closest?.('[data-admin-provider-action]');
    const row = event.target.closest?.('[data-profile-id]');
    if (!button) { if (row) selectProfile(row.dataset.profileId); return; }
    const id = button.dataset.profileId;
    if (button.dataset.adminProviderAction === 'edit') selectProfile(id);
    if (button.dataset.adminProviderAction === 'test') void testProfile(id);
    if (button.dataset.adminProviderAction === 'activate') void activateProfile(id);
  });
  const initial = new URL(globalThis.location.href).searchParams.get('admin');
  setSurface(initial === 'provider' ? 'provider' : 'analytics', { syncUrl: false });
  globalThis.__poorupAdminAiProvider = Object.freeze({ load, setSurface, get model() { return { ...model, profiles: [...model.profiles] }; } });
  if (initial !== 'provider') void load();
  return true;
}
