import { ANALYTICS_TABS, resolveTab } from './clientAnalyticsCatalog.js';

// A tablist is a DOM contract: roving tabindex, aria-selected, panel visibility and arrow-key
// movement. This module owns only that. The console runs two of them (the four surfaces, and the
// three analytics views); data loading and the URL belong to the console controller, which is
// told about every change.
export const ANALYTICS_PAGES = ANALYTICS_TABS;

export function normalizeAnalyticsPage(page) { return resolveTab(page); }

function indexIn(pages, page) { return Math.max(0, pages.indexOf(page)); }

export function nextAnalyticsPage(page, pages = ANALYTICS_PAGES) {
  return pages[(indexIn(pages, page) + 1) % pages.length];
}

export function previousAnalyticsPage(page, pages = ANALYTICS_PAGES) {
  return pages[(indexIn(pages, page) - 1 + pages.length) % pages.length];
}

// A horizontal strip answers to Left/Right; Up/Down are accepted too so no arrow key is dead.
export function pageForKey(key, page, pages = ANALYTICS_PAGES) {
  if (key === 'Home') return pages[0];
  if (key === 'End') return pages.at(-1);
  if (key === 'ArrowDown' || key === 'ArrowRight') return nextAnalyticsPage(page, pages);
  if (key === 'ArrowUp' || key === 'ArrowLeft') return previousAnalyticsPage(page, pages);
  return null;
}

function all(root, selector) { return [...(root?.querySelectorAll?.(selector) || [])]; }

export function createAnalyticsPageController({
  root = globalThis.document?.querySelector?.('#admin-analytics-main'),
  pages = ANALYTICS_PAGES,
  tabAttr = 'data-analytics-tab',
  panelAttr = 'data-analytics-panel',
  initialPage = pages[0],
  onPageChange = () => {},
  announce = () => {},
} = {}) {
  // Own-property list match first, then the legacy aliases (overview, match-health), else the first page.
  const normalize = value => {
    const key = String(value ?? '').trim().toLowerCase();
    if (pages.includes(key)) return key;
    const mapped = resolveTab(key);
    return pages.includes(mapped) ? mapped : pages[0];
  };
  let page = normalize(initialPage);
  let destroyed = false;
  const listeners = [];

  function listen(element, event, handler) {
    element?.addEventListener?.(event, handler);
    if (element?.removeEventListener) listeners.push(() => element.removeEventListener(event, handler));
  }

  const tabs = () => all(root, `[${tabAttr}]`);
  const tabFor = id => tabs().find(tab => tab.getAttribute?.(tabAttr) === id) || null;

  function sync() {
    tabs().forEach(tab => {
      const active = tab.getAttribute?.(tabAttr) === page;
      tab.setAttribute?.('role', 'tab');
      tab.setAttribute?.('aria-selected', String(active));
      tab.setAttribute?.('tabindex', active ? '0' : '-1');
      tab.classList?.toggle('is-active', active);
    });
    all(root, `[${panelAttr}]`).forEach(panel => {
      const id = panel.getAttribute?.(panelAttr);
      const active = id === page;
      panel.classList?.toggle('is-hidden', !active);
      if ('hidden' in panel) panel.hidden = !active;
      panel.setAttribute?.('role', 'tabpanel');
      const tab = tabFor(id);
      if (tab?.id) panel.setAttribute?.('aria-labelledby', tab.id);
    });
  }

  function setPage(nextPage, { focus = false, announceChange = true } = {}) {
    if (destroyed) return page;
    const next = normalize(nextPage);
    const changed = next !== page;
    page = next;
    sync();
    if (focus) tabFor(page)?.focus?.();
    if (changed) {
      onPageChange(page);
      if (announceChange) announce(page);
    }
    return page;
  }

  function onKeydown(event) {
    const target = pageForKey(event.key, event.currentTarget?.getAttribute?.(tabAttr), pages);
    if (!target || event.altKey || event.ctrlKey || event.metaKey) return;
    event.preventDefault();
    setPage(target, { focus: true });
  }

  tabs().forEach(tab => {
    listen(tab, 'click', () => setPage(tab.getAttribute?.(tabAttr)));
    listen(tab, 'keydown', onKeydown);
  });
  sync();

  return Object.freeze({
    pages,
    destroy() { destroyed = true; listeners.splice(0).forEach(remove => remove()); },
    nextPage: options => setPage(nextAnalyticsPage(page, pages), options),
    previousPage: options => setPage(previousAnalyticsPage(page, pages), options),
    setPage,
    get page() { return page; },
  });
}
