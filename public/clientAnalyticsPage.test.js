import assert from 'node:assert/strict';

const {
  ANALYTICS_PAGES,
  normalizeAnalyticsPage,
  nextAnalyticsPage,
  previousAnalyticsPage,
  pageForKey,
  createAnalyticsPageController
} = await import('./clientAnalyticsPage.js');

assert.deepEqual(ANALYTICS_PAGES, ['status', 'rooms', 'matches', 'bots', 'economy', 'release']);
assert.equal(normalizeAnalyticsPage('unknown'), 'status');
assert.equal(normalizeAnalyticsPage('ECONOMY'), 'economy');
assert.equal(normalizeAnalyticsPage('overview'), 'status', 'legacy overview opens status');
assert.equal(normalizeAnalyticsPage('match-health'), 'matches', 'legacy match-health opens matches');
assert.equal(normalizeAnalyticsPage('__proto__'), 'status');
assert.equal(nextAnalyticsPage('status'), 'rooms');
assert.equal(nextAnalyticsPage('economy'), 'release');
assert.equal(nextAnalyticsPage('release'), 'status', 'the ring wraps forward');
assert.equal(previousAnalyticsPage('status'), 'release', 'the ring wraps backward');
assert.equal(previousAnalyticsPage('matches'), 'rooms');

// Arrow keys follow the rail in either orientation; Home and End jump to the ends.
assert.equal(pageForKey('ArrowDown', 'status'), 'rooms');
assert.equal(pageForKey('ArrowRight', 'status'), 'rooms');
assert.equal(pageForKey('ArrowUp', 'status'), 'release');
assert.equal(pageForKey('ArrowLeft', 'rooms'), 'status');
assert.equal(pageForKey('Home', 'bots'), 'status');
assert.equal(pageForKey('End', 'bots'), 'release');
assert.equal(pageForKey('Enter', 'bots'), null, 'activation keys stay with the button');
assert.equal(pageForKey('a', 'bots'), null);

// The controller keeps one tab in the tab order (roving tabindex) and shows one panel.
function fakeNode(attrs) {
  const attributes = { ...attrs };
  const classes = new Set();
  const listeners = {};
  return {
    hidden: false,
    classList: { toggle: (name, force) => (force ? classes.add(name) : classes.delete(name)), contains: name => classes.has(name) },
    getAttribute: name => attributes[name] ?? null,
    setAttribute: (name, value) => { attributes[name] = String(value); },
    get id() { return attributes.id || ''; },
    addEventListener: (name, handler) => { listeners[name] = handler; },
    removeEventListener: name => { delete listeners[name]; },
    focus() { this.focused = true; },
    fire: (name, event = {}) => listeners[name]?.({ preventDefault() { event.prevented = true; }, ...event }),
  };
}
const tabs = ANALYTICS_PAGES.map(page => fakeNode({ 'data-analytics-tab': page, id: `analytics-tab-${page}` }));
const panels = ANALYTICS_PAGES.map(page => fakeNode({ 'data-analytics-panel': page }));
const root = { querySelectorAll: selector => (selector === '[data-analytics-tab]' ? tabs : selector === '[data-analytics-panel]' ? panels : []) };
const changes = [];
const spoken = [];
const controller = createAnalyticsPageController({ root, initialPage: 'overview', onPageChange: page => changes.push(page), announce: message => spoken.push(message) });

assert.equal(controller.page, 'status');
assert.deepEqual(tabs.map(tab => tab.getAttribute('tabindex')), ['0', '-1', '-1', '-1', '-1', '-1']);
assert.deepEqual(tabs.map(tab => tab.getAttribute('aria-selected')), ['true', 'false', 'false', 'false', 'false', 'false']);
assert.deepEqual(panels.map(panel => panel.hidden), [false, true, true, true, true, true]);
assert.ok(panels.every(panel => panel.getAttribute('role') === 'tabpanel'));
assert.equal(panels[2].getAttribute('aria-labelledby'), 'analytics-tab-matches');

const down = { key: 'ArrowDown', currentTarget: tabs[0] };
tabs[0].fire('keydown', down);
assert.equal(down.prevented, true, 'arrow keys do not scroll the page');
assert.equal(controller.page, 'rooms');
assert.equal(tabs[1].focused, true, 'focus moves with the selection');
assert.equal(tabs[1].getAttribute('tabindex'), '0');
assert.equal(tabs[0].getAttribute('tabindex'), '-1');
assert.equal(panels[1].hidden, false);
assert.deepEqual(changes, ['rooms']);
assert.deepEqual(spoken, ['rooms']);

tabs[1].fire('keydown', { key: 'End', currentTarget: tabs[1] });
assert.equal(controller.page, 'release');
tabs[5].fire('keydown', { key: 'ArrowDown', currentTarget: tabs[5] });
assert.equal(controller.page, 'status', 'ArrowDown wraps from the last section to the first');
tabs[0].fire('keydown', { key: 'ArrowUp', currentTarget: tabs[0] });
assert.equal(controller.page, 'release', 'ArrowUp wraps from the first section to the last');
const ctrl = { key: 'ArrowDown', ctrlKey: true, currentTarget: tabs[5] };
tabs[5].fire('keydown', ctrl);
assert.equal(controller.page, 'release', 'modified arrows are left to the browser');

tabs[3].fire('click');
assert.equal(controller.page, 'bots');
assert.equal(tabs[3].focused, undefined, 'a click does not steal focus');
controller.setPage('release', { announceChange: false });
assert.equal(spoken.at(-1), 'bots');

controller.destroy();
tabs[1].fire('click');
assert.equal(controller.page, 'release', 'after teardown the rail no longer responds');

// The console runs two strips: four surfaces on top, three analytics views inside the first.
{
  const surfaces = ['analytics', 'rooms', 'bots', 'release'];
  const views = ['status', 'matches', 'economy'];
  const surfaceTabs = surfaces.map(id => fakeNode({ 'data-admin-section': id, id: 'admin-section-tab-' + id }));
  const surfacePanels = surfaces.map(id => fakeNode({ 'data-admin-section-panel': id }));
  const viewTabs = views.map(id => fakeNode({ 'data-analytics-tab': id, id: 'analytics-tab-' + id }));
  const viewPanels = views.map(id => fakeNode({ 'data-analytics-panel': id }));
  const strips = {
    querySelectorAll: selector => ({
      '[data-admin-section]': surfaceTabs, '[data-admin-section-panel]': surfacePanels,
      '[data-analytics-tab]': viewTabs, '[data-analytics-panel]': viewPanels,
    })[selector] || [],
  };
  const surfaceChanges = [];
  const viewChanges = [];
  const top = createAnalyticsPageController({ root: strips, pages: surfaces, tabAttr: 'data-admin-section', panelAttr: 'data-admin-section-panel', initialPage: 'bots', onPageChange: page => surfaceChanges.push(page) });
  const sub = createAnalyticsPageController({ root: strips, pages: views, tabAttr: 'data-analytics-tab', panelAttr: 'data-analytics-panel', initialPage: 'match-health', onPageChange: page => viewChanges.push(page) });
  assert.equal(top.page, 'bots');
  assert.equal(sub.page, 'matches', 'a legacy id lands on its view');
  assert.deepEqual(surfacePanels.map(panel => panel.hidden), [true, true, false, true]);
  assert.deepEqual(viewPanels.map(panel => panel.hidden), [true, false, true]);
  assert.deepEqual(surfaceTabs.map(tab => tab.getAttribute('tabindex')), ['-1', '-1', '0', '-1']);
  surfaceTabs[2].fire('keydown', { key: 'ArrowRight', currentTarget: surfaceTabs[2] });
  assert.equal(top.page, 'release');
  surfaceTabs[3].fire('keydown', { key: 'ArrowRight', currentTarget: surfaceTabs[3] });
  assert.equal(top.page, 'analytics', 'the strip wraps');
  viewTabs[1].fire('keydown', { key: 'End', currentTarget: viewTabs[1] });
  assert.equal(sub.page, 'economy');
  assert.deepEqual(viewChanges, ['economy']);
  assert.equal(surfaceChanges.at(-1), 'analytics', 'the two strips never touch each other');
  top.setPage('rooms');
  assert.equal(sub.page, 'economy', 'switching surface keeps the open analytics view');
  assert.equal(top.setPage('bogus'), 'analytics', 'an unknown id falls back to the first page');
  assert.equal(top.setPage('__proto__'), 'analytics');
  top.destroy();
  sub.destroy();
}

console.log('analytics page model: rail ring, keys, roving tabindex and teardown contracts are present');
