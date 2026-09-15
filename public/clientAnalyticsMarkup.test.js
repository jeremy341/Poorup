import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const tabIds = ['overview', 'match-health', 'rulesets', 'economy', 'events', 'bots', 'quality'];
const adminViewStart = html.indexOf('id="view-admin-analytics"');
const adminViewEnd = html.indexOf('<div class="popup is-hidden" id="account-modal"');
const adminView = html.slice(adminViewStart, adminViewEnd);

assert.match(html, /role="tablist"[^>]+aria-label="Analytics views"/i);
assert.equal((adminView.match(/<main\b/gi) || []).length, 1);
assert.match(adminView, /<h1\b[^>]+id="admin-analytics-title"/i);
assert.match(adminView, /id="admin-analytics-status"[^>]+role="status"[^>]+aria-live="polite"/i);
assert.match(adminView, /data-analytics-alerts/);
assert.match(adminView, /data-analytics-command-strip/);
assert.match(adminView, /data-analytics-filter-strip/);
assert.match(adminView, /data-analytics-more-filters[^>]+aria-haspopup="dialog"/);
assert.match(adminView, /data-analytics-filter-dialog[^>]+role="dialog"/);
assert.match(adminView, /data-analytics-page-prev/);
assert.match(adminView, /data-analytics-page-next/);
assert.match(adminView, /data-analytics-page-position[^>]+aria-live="polite"/);
assert.match(adminView, /class="analytics-filter-dialog is-hidden"[^>]*data-analytics-filter-dialog/);
for (const tab of tabIds) {
  assert.match(html, new RegExp(`data-analytics-tab="${tab}"`));
  assert.match(html, new RegExp(`aria-controls="analytics-panel-${tab}"`));
  assert.match(html, new RegExp(`id="analytics-tab-${tab}"`));
  assert.match(html, new RegExp(`data-analytics-question="[^"]+"[^>]+data-analytics-tab="${tab}"`));
  assert.match(html, new RegExp(`id="analytics-panel-${tab}"[^>]+data-analytics-question="[^"]+"`));
  assert.match(html, new RegExp(`data-analytics-chart-slot="${tab}-primary"`));
}
assert.equal((adminView.match(/data-analytics-tab="/g) || []).length, 7);
assert.equal((adminView.match(/data-analytics-panel="/g) || []).length, 7);
assert.equal((adminView.match(/data-analytics-chart-slot="[^"]+"/g) || []).length, 7);
for (const contextual of ['live-ops', 'funnel', 'retention', 'releases']) {
  assert.match(adminView, new RegExp(`data-analytics-context="${contextual}"[^>]+hidden`));
}
assert.match(html, /data-analytics-filter="range"/);
assert.match(html, /data-analytics-filter="boardVariant"/);
assert.match(html, /data-analytics-filter="rulesetPreset"/);
assert.match(html, /data-analytics-filter="marketComplexity"/);
assert.match(html, /data-analytics-filter="botMode"/);
assert.match(html, /data-analytics-filter="provider"/);
assert.match(html, /data-analytics-filter="eventId"/);
assert.match(html, /data-analytics-filter="seasonId"/);
assert.match(html, /data-analytics-filter="rulesetRevision"/);
assert.match(html, /data-analytics-filter="balanceRevision"/);
assert.match(html, /data-analytics-apply/);
assert.match(html, /data-analytics-reset/);
assert.match(html, /data-analytics-refresh/);
assert.match(html, /data-analytics-chart/);
for (const tab of tabIds) {
  assert.match(adminView, new RegExp(`data-analytics-panel-chart="${tab}"`));
  assert.match(adminView, new RegExp(`data-analytics-panel-chart="${tab}"[^>]+data-chart-mode="(?:line|bar|stacked-bar|heatmap|histogram|box|scatter|funnel|cohort)"`));
}
for (const filter of ['range', 'boardVariant', 'rulesetPreset', 'marketComplexity', 'botMode', 'provider', 'eventId', 'seasonId', 'rulesetRevision', 'balanceRevision']) {
  assert.match(adminView, new RegExp(`for="analytics-filter-${filter}"`));
  assert.match(adminView, new RegExp(`id="analytics-filter-${filter}"[^>]+data-analytics-filter="${filter}"`));
}
for (const filter of ['range', 'boardVariant', 'rulesetPreset', 'marketComplexity', 'botMode', 'provider']) {
  assert.match(adminView, new RegExp(`<span class="analytics-select-shell"[^>]*>\\s*<select[^>]+id="analytics-filter-${filter}"`, 'i'));
}
assert.doesNotMatch(adminView, /data-analytics-filter="(?:accountId|username|displayName)"|name="(?:accountId|username|displayName)"/i);
assert.doesNotMatch(adminView, /(?:displayName|username|accountId|roomCode|chat|hiddenCards|privateLoanTerms|sessionToken|rawPayload|rawEvent|ipAddress|rawIp|userAgent|rawUserAgent)\s*=/i);
for (const tab of tabIds) {
  assert.match(html, new RegExp(`<section[^>]*(?:data-analytics-panel="${tab}"[^>]*id="analytics-panel-${tab}"|id="analytics-panel-${tab}"[^>]*data-analytics-panel="${tab}")`, 'i'));
}

console.log('analytics markup contract: expected controls are present');
