import assert from 'node:assert/strict';
import fs from 'node:fs';

const html = fs.readFileSync(new URL('./index.html', import.meta.url), 'utf8');
const tabIds = ['overview', 'match-health', 'rulesets', 'economy', 'events', 'bots', 'quality'];

assert.match(html, /role="tablist"[^>]+aria-label="Analytics views"/i);
for (const tab of tabIds) {
  assert.match(html, new RegExp(`data-analytics-tab="${tab}"`));
  assert.match(html, new RegExp(`aria-controls="analytics-panel-${tab}"`));
  assert.match(html, new RegExp(`id="analytics-tab-${tab}"`));
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
  assert.match(html, new RegExp(`<section[^>]*(?:data-analytics-panel="${tab}"[^>]*id="analytics-panel-${tab}"|id="analytics-panel-${tab}"[^>]*data-analytics-panel="${tab}")`, 'i'));
}

console.log('analytics markup contract: expected controls are present');
