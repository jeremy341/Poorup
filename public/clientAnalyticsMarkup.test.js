import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const adminViewStart = html.indexOf('id="view-admin-analytics"');
const adminViewEnd = html.indexOf('<div class="popup is-hidden" id="account-modal"');
const adminView = html.slice(adminViewStart, adminViewEnd);

// One console: a single main landmark, one h1, one freshness chip.
assert.equal((adminView.match(/<main\b/gi) || []).length, 1);
assert.match(adminView, /<main class="admin-console" id="admin-analytics-main"/);
assert.equal((adminView.match(/<h1\b/g) || []).length, 1, 'one h1; its text follows the open surface');
assert.match(adminView, /<h1 class="[^"]*" id="admin-analytics-title">ANALYTICS<\/h1>/);
assert.match(adminView, /id="admin-analytics-status"[^>]+role="status"[^>]+aria-live="polite"/i);
assert.equal((adminView.match(/id="admin-analytics-status"/g) || []).length, 1, 'one freshness chip replaces the three freshness texts');
assert.doesNotMatch(adminView, /data-analytics-last-verified|data-analytics-quality-strip|analytics-quality-strip|LAST VERIFIED/);
assert.match(adminView, /data-analytics-refresh/);

// Nothing the user asked to remove is left: no CSV, no visible tables toggle, no left rail, no drawer, no filters or pager.
assert.doesNotMatch(adminView, /data-analytics-export|admin-analytics-export|EXPORT CSV|\.csv/i);
assert.doesNotMatch(adminView, /admin-rail|admin-drawer|data-admin-provider-drawer|data-drawer-close|aria-orientation="vertical"/);
assert.doesNotMatch(adminView, /SHOW DATA TABLE|analytics-chart-table-toggle|data-analytics-quality-strip/);
assert.doesNotMatch(adminView, /Season|data-analytics-reset|RESET|analytics-filters|analytics-filter-strip|data-analytics-filter\b/);
assert.doesNotMatch(adminView, /data-analytics-more-filters|data-analytics-filter-dialog|analytics-filter-dialog/);
assert.doesNotMatch(adminView, /data-analytics-page-prev|data-analytics-page-next|data-analytics-page-position|analytics-page-footer|data-analytics-report-page/);
assert.doesNotMatch(adminView, /admin-analytics-hero|data-analytics-command-strip|Analytics control room|data-admin-console-tab/);
assert.doesNotMatch(adminView, /analytics-filter-(?:seasonId|eventId|rulesetRevision|balanceRevision|provider)|name="(?:seasonId|eventId|rulesetRevision|balanceRevision|provider)"/);
assert.doesNotMatch(adminView, /data-analytics-question|Is the parlor healthy|Are matches starting/, 'no per-section question subtitles');

// Window control: 1H 24H 7D 30D as labelled toggle buttons in a group.
assert.match(adminView, /role="group" aria-label="Time window" data-analytics-window/);
for (const [range, name] of [['hour', 'Last hour'], ['day', 'Last 24 hours'], ['week', 'Last 7 days'], ['month', 'Last 30 days']]) {
  assert.match(adminView, new RegExp(`data-analytics-range="${range}" aria-pressed="(?:true|false)" aria-label="${name}"`));
}
assert.equal((adminView.match(/data-analytics-range="/g) || []).length, 4);

// Navigation: a full-width tab row of four surfaces, and a second strip of three analytics views.
assert.equal((adminView.match(/role="tablist"/g) || []).length, 2);
assert.match(adminView, /class="admin-console-tabs" role="tablist" aria-label="Operator surfaces"/);
assert.match(adminView, /class="admin-views" role="tablist" aria-label="Analytics views"/);
const surfaceNames = { analytics: 'Analytics', rooms: 'Rooms', bots: 'Bots &amp; AI', release: 'Release' };
for (const [id, label] of Object.entries(surfaceNames)) {
  assert.match(adminView, new RegExp(`id="admin-section-tab-${id}"[^>]+role="tab"[^>]+data-admin-section="${id}"[^>]+aria-controls="admin-section-${id}"[^>]*>${label}<`));
  assert.match(adminView, new RegExp(`id="admin-section-${id}"[^>]+data-admin-section-panel="${id}" role="tabpanel" aria-labelledby="admin-section-tab-${id}"`));
}
for (const [id, label] of [['status', 'Overview'], ['matches', 'Match health'], ['economy', 'Economy']]) {
  assert.match(adminView, new RegExp(`id="analytics-tab-${id}"[^>]+role="tab"[^>]+data-analytics-tab="${id}"[^>]+aria-controls="analytics-panel-${id}"[^>]*>${label}<`));
  assert.match(adminView, new RegExp(`id="analytics-panel-${id}" data-analytics-panel="${id}" role="tabpanel" aria-labelledby="analytics-tab-${id}"`));
}
assert.equal((adminView.match(/data-admin-section="/g) || []).length, 4);
assert.equal((adminView.match(/data-analytics-tab="/g) || []).length, 3);
assert.equal((adminView.match(/data-analytics-panel="/g) || []).length, 3);
assert.equal((adminView.match(/role="tab"[^>]+tabindex="0"/g) || []).length, 2, 'roving tabindex: one tab stop per strip');

// Analytics: health line, six-tile list, then one chart per view with its states.
assert.match(adminView, /<ul class="admin-kpi-grid" id="admin-analytics-grid"/);
assert.match(adminView, /data-section="health"/);
for (const [view, mode] of [['status', 'line'], ['matches', 'bar'], ['economy', 'bar']]) {
  assert.match(adminView, new RegExp(`data-section="report-${view}"`));
  assert.match(adminView, new RegExp(`id="analytics-panel-${view}"[\\s\\S]*?data-analytics-chart data-chart-title="[^"]+" data-chart-unit="[^"]+" data-chart-mode="${mode}"`));
}
assert.ok(adminView.indexOf('data-section="health"') < adminView.indexOf('data-section="kpis"'), 'health line sits above the tiles');
assert.ok(adminView.indexOf('data-section="kpis"') < adminView.indexOf('aria-label="Analytics views"'), 'tiles sit above the views strip');

// Every section that loads data has the shared state slot; every scrolling surface is a focusable, named region.
for (const section of ['health', 'kpis', 'report-status', 'rooms', 'report-matches', 'usage', 'roster', 'log-bots', 'report-economy', 'control', 'log-release']) {
  assert.match(adminView, new RegExp(`data-section="${section}"[\\s\\S]*?data-section-state[\\s\\S]*?data-section-body`));
}
const scrollSurfaces = adminView.match(/class="admin-scroll[^"]*"[^>]*>/g) || [];
assert.ok(scrollSurfaces.length >= 4);
for (const surface of scrollSurfaces) assert.match(surface, /tabindex="0" role="region" aria-label="[^"]+, scrollable" data-scroll-cue/);
const scrollSurfacePanels = adminView.match(/data-admin-section-panel="[a-z]+"[^>]*>/g) || [];
assert.equal(scrollSurfacePanels.length, 4);
for (const panel of scrollSurfacePanels) assert.match(panel, /tabindex="-1"[^>]*data-scroll-cue data-scroll-focus/, 'a surface becomes a keyboard stop only while it actually scrolls');

// Rooms never carry codes or names, and the totals are one inline line.
assert.match(adminView, /data-rooms-totals/);
assert.doesNotMatch(adminView, /admin-side|data-rooms-sidebar/);
assert.doesNotMatch(adminView, /(?:displayName|username|accountId|roomCode|chat|hiddenCards|privateLoanTerms|sessionToken|rawPayload|rawEvent|ipAddress|rawIp|userAgent|rawUserAgent)\s*=/i);

// Bots & AI: usage line, then the old provider layout inline (active aside + form + roster), and a change log.
assert.match(adminView, /data-bots-line/);
assert.match(adminView, /class="admin-provider-layout"/);
assert.match(adminView, /<aside class="admin-provider-active panel" aria-label="Active provider">/);
assert.match(adminView, /data-admin-provider-form/);
assert.match(adminView, /data-admin-provider-new/);
assert.match(adminView, /data-admin-provider-list/);
assert.match(adminView, /aria-label="Provider change log, scrollable"/);

// Release: three actions, an optional message, and a status line. The control is not a form that can submit by accident.
for (const action of ['draining', 'maintenance', 'normal']) assert.match(adminView, new RegExp(`data-release-action="${action}"`));
assert.match(adminView, /data-release-message[^>]+maxlength="200"/);
assert.match(adminView, /data-release-status role="status" aria-live="polite"/);
assert.doesNotMatch(adminView, /<form[^>]+data-release-form/);

console.log('analytics markup contract: expected controls are present');
