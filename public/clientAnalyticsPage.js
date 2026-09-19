export const ANALYTICS_PAGES = Object.freeze([
  'overview', 'match-health', 'rulesets', 'economy', 'events', 'bots', 'quality'
]);

function indexOfPage(page) { return ANALYTICS_PAGES.indexOf(normalizeAnalyticsPage(page)); }

export function normalizeAnalyticsPage(page) {
  const normalized = String(page || '').trim().toLowerCase();
  return ANALYTICS_PAGES.includes(normalized) ? normalized : ANALYTICS_PAGES[0];
}

export function nextAnalyticsPage(page) {
  const index = indexOfPage(page);
  return ANALYTICS_PAGES[(index + 1) % ANALYTICS_PAGES.length];
}

export function previousAnalyticsPage(page) {
  const index = indexOfPage(page);
  return ANALYTICS_PAGES[(index - 1 + ANALYTICS_PAGES.length) % ANALYTICS_PAGES.length];
}

function find(root, selector) { return root?.querySelector?.(selector) || null; }
function all(root, selector) { return [...(root?.querySelectorAll?.(selector) || [])]; }

function setHidden(element, hidden) {
  if (!element) return;
  element.classList?.toggle('is-hidden', hidden);
  if ('hidden' in element) element.hidden = hidden;
  element.setAttribute?.('aria-hidden', String(hidden));
}

export function createAnalyticsPageController({
  root = globalThis.document?.querySelector?.('#admin-analytics-main'),
  initialPage = 'overview',
  onPageChange = () => {},
  onFilterApply = () => {},
  announce = () => {},
  bindTabs = true,
  bindPager = true,
  bindFilters = true
} = {}) {
  let page = normalizeAnalyticsPage(initialPage);
  let destroyed = false;
  let filterOpener = null;
  const listeners = [];

  function listen(element, event, handler) {
    element?.addEventListener?.(event, handler);
    if (element?.removeEventListener) listeners.push(() => element.removeEventListener(event, handler));
  }

  function syncPageUrl(nextPage) {
    const location = globalThis.window?.location;
    const history = globalThis.window?.history;
    if (!location || typeof history?.replaceState !== 'function' || location.pathname !== '/admin/analytics') return;
    const params = new URLSearchParams(location.search || '');
    params.set('tab', nextPage);
    history.replaceState(null, '', `${location.pathname}?${params.toString()}${location.hash || ''}`);
  }

  function updatePosition() {
    const position = find(root, '[data-analytics-page-position]');
    if (position) position.textContent = `${indexOfPage(page) + 1} / ${ANALYTICS_PAGES.length}`;
    const previous = find(root, '[data-analytics-page-prev]');
    const next = find(root, '[data-analytics-page-next]');
    previous?.setAttribute?.('aria-label', `Previous report page, ${previousAnalyticsPage(page)}`);
    next?.setAttribute?.('aria-label', `Next report page, ${nextAnalyticsPage(page)}`);
  }

  function updateTabs() {
    const tabs = all(root, '[data-analytics-tab]');
    tabs.forEach((tab, index) => {
      const active = normalizeAnalyticsPage(tab.getAttribute?.('data-analytics-tab')) === page;
      const id = tab.id || `analytics-tab-${index + 1}`;
      tab.id = id;
      tab.setAttribute?.('role', 'tab');
      tab.setAttribute?.('aria-selected', String(active));
      tab.setAttribute?.('tabindex', active ? '0' : '-1');
      tab.classList?.toggle('is-active', active);
    });
    all(root, '[data-analytics-panel]').forEach(panel => {
      const active = normalizeAnalyticsPage(panel.getAttribute?.('data-analytics-panel')) === page;
      setHidden(panel, !active);
      panel.setAttribute?.('role', 'tabpanel');
      panel.setAttribute?.('tabindex', '0');
      const tab = find(root, `[data-analytics-tab="${panel.getAttribute?.('data-analytics-panel')}"]`);
      if (tab?.id) panel.setAttribute?.('aria-labelledby', tab.id);
    });
  }

  function setPage(nextPage, { focus = false, announceChange = true, syncUrl = true } = {}) {
    if (destroyed) return page;
    const next = normalizeAnalyticsPage(nextPage);
    page = next;
    updateTabs();
    updatePosition();
    if (syncUrl) syncPageUrl(page);
    onPageChange(page);
    if (announceChange) announce(`${page.replaceAll('-', ' ')} report page`);
    if (focus) find(root, `[data-analytics-tab="${page}"]`)?.focus?.();
    return page;
  }

  function move(direction, options) { return setPage(direction === 'next' ? nextAnalyticsPage(page) : previousAnalyticsPage(page), options); }

  function onTabClick(event) { setPage(event.currentTarget?.getAttribute?.('data-analytics-tab'), { focus: true }); }

  function onTabKeydown(event) {
    const key = event.key;
    if (!['ArrowRight', 'ArrowDown', 'ArrowLeft', 'ArrowUp', 'Home', 'End', 'Enter', ' '].includes(key)) return;
    event.preventDefault();
    const tabs = all(root, '[data-analytics-tab]');
    const current = tabs.indexOf(event.currentTarget);
    if (key === 'Enter' || key === ' ') { setPage(event.currentTarget?.getAttribute?.('data-analytics-tab'), { focus: true }); return; }
    const targetIndex = key === 'Home' ? 0 : key === 'End' ? tabs.length - 1 : (current + (key === 'ArrowLeft' || key === 'ArrowUp' ? -1 : 1) + tabs.length) % tabs.length;
    setPage(tabs[targetIndex]?.getAttribute?.('data-analytics-tab'), { focus: true });
  }

  function onPagerKeydown(event) {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    if (event.key === 'Home' || event.key === 'End') { setPage(event.key === 'Home' ? ANALYTICS_PAGES[0] : ANALYTICS_PAGES.at(-1), { focus: false }); return; }
    move(event.key === 'ArrowRight' ? 'next' : 'previous', { focus: false });
  }

  function closeFilters({ restoreFocus = true } = {}) {
    const dialog = find(root, '[data-analytics-filter-dialog]');
    setHidden(dialog, true);
    find(root, '[data-analytics-more-filters]')?.setAttribute?.('aria-expanded', 'false');
    root?.removeAttribute?.('data-filter-dialog-open');
    if (restoreFocus) filterOpener?.focus?.();
    filterOpener = null;
  }

  function openFilters(opener = find(root, '[data-analytics-more-filters]')) {
    const dialog = find(root, '[data-analytics-filter-dialog]');
    if (!dialog) return false;
    filterOpener = opener;
    setHidden(dialog, false);
    root?.setAttribute?.('data-filter-dialog-open', 'true');
    opener?.setAttribute?.('aria-expanded', 'true');
    find(dialog, '[data-analytics-filter]')?.focus?.();
    return true;
  }

  function wire() {
    if (bindTabs) all(root, '[data-analytics-tab]').forEach(tab => { listen(tab, 'click', onTabClick); listen(tab, 'keydown', onTabKeydown); });
    if (bindPager) {
      listen(find(root, '[data-analytics-page-prev]'), 'click', () => move('previous'));
      listen(find(root, '[data-analytics-page-next]'), 'click', () => move('next'));
      listen(find(root, '[data-analytics-page-prev]'), 'keydown', onPagerKeydown);
      listen(find(root, '[data-analytics-page-next]'), 'keydown', onPagerKeydown);
    }
    if (bindFilters) {
      const opener = find(root, '[data-analytics-more-filters]');
      listen(opener, 'click', () => openFilters(opener));
      listen(find(root, '[data-analytics-filter-cancel]'), 'click', () => closeFilters());
      listen(find(root, '[data-analytics-filter-apply]'), 'click', () => { onFilterApply(); closeFilters(); });
      listen(find(root, '[data-analytics-filter-dialog]'), 'keydown', event => { if (event.key === 'Escape') { event.preventDefault(); closeFilters(); } });
      listen(root?.ownerDocument || globalThis.document, 'pointerdown', event => {
        const dialog = find(root, '[data-analytics-filter-dialog]');
        if (!dialog || dialog.classList?.contains('is-hidden') || dialog.contains?.(event.target) || find(root, '[data-analytics-more-filters]')?.contains?.(event.target)) return;
        closeFilters();
      });
    }
    updateTabs();
    updatePosition();
  }

  function destroy() { destroyed = true; closeFilters({ restoreFocus: false }); listeners.splice(0).forEach(remove => remove()); }

  wire();
  return Object.freeze({
    ANALYTICS_PAGES,
    destroy,
    closeFilters,
    openFilters,
    nextPage: options => move('next', options),
    previousPage: options => move('previous', options),
    setPage,
    get page() { return page; }
  });
}
