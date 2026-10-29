import assert from 'node:assert/strict';
import fs from 'node:fs';
import vm from 'node:vm';
import { test } from 'node:test';
import { sanitizeAccountSession } from './clientSanitize.js';

function profileRenderer(enabled) {
  const source = fs.readFileSync(new URL('./clientProfileRender.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/^export /gm, '') + '\n;globalThis.render = profileStatisticsHTML;';
  const context = { PARLOR_PATROL_ENABLED: enabled };
  vm.runInNewContext(source, context);
  return context.render;
}

const profile = stats => ({ account: { stats }, stats, games: 0, wins: 0, bankruptcies: 0, winShare: 0, chronological: [] });

test('sanitization retains verified and legacy patrol statistics separately', () => {
  const session = sanitizeAccountSession({ account: { id: 'a', username: 'user', stats: { patrolBest: 900, patrolAceRuns: 3, patrolVerifiedBest: 125, patrolVerifiedAceRuns: 1 } } });
  assert.equal(session.account.stats.patrolBest, 900);
  assert.equal(session.account.stats.patrolAceRuns, 3);
  assert.equal(session.account.stats.patrolVerifiedBest, 125);
  assert.equal(session.account.stats.patrolVerifiedAceRuns, 1);
});

test('profile labels legacy and verified patrol values independently', () => {
  const html = profileRenderer(true)(profile({ patrolBest: 900, patrolAceRuns: 3, patrolVerifiedBest: 125, patrolVerifiedAceRuns: 1 }));
  assert.match(html, /VERIFIED BEST<[^]*?125/);
  assert.match(html, /LEGACY BEST<[^]*?900/);
  assert.match(html, /VERIFIED ACE RUNS<[^]*?1/);
  assert.match(html, /LEGACY ACE RUNS<[^]*?3/);
  const empty = profileRenderer(true)(profile({ patrolBest: 0, patrolAceRuns: 0, patrolVerifiedBest: 125, patrolVerifiedAceRuns: 0 }));
  assert.doesNotMatch(empty, /LEGACY BEST|LEGACY ACE RUNS/);
  assert.doesNotMatch(profileRenderer(false)(profile({ patrolBest: 900, patrolVerifiedBest: 125 })), /VERIFIED BEST|LEGACY BEST/);
});

test('unlocked patrol achievements disclose uncertain provenance and guest local origin', () => {
  const source = fs.readFileSync(new URL('./clientAccountIdentity.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/^export /gm, '') + '\n;globalThis.renderCard = achievementCardHTML; globalThis.details = achievementDetailBits;';
  const context = { state: { clientId: 'test', account: { account: {} }, achievementRecords: new Map() }, esc: String, achievementIconHTML: () => '' };
  vm.runInNewContext(source, context);
  const achievement = { id: 'clean-run', category: 'minigame', title: 'CLEAN RUN', short: 'No misses', rarity: 'EPIC' };
  assert.match(context.renderCard(achievement, true), /MAY INCLUDE LEGACY OR LOCAL UNLOCKS/);
  assert.match(context.details(achievement, true).note, /MAY INCLUDE LEGACY OR LOCAL UNLOCKS/);
  assert.doesNotMatch(context.renderCard(achievement, false), /MAY INCLUDE LEGACY OR LOCAL UNLOCKS/);
  context.state.account = null;
  assert.match(context.renderCard(achievement, true), /LOCAL UNLOCK/);
});

test('ambient Home fly-by best is labeled as local for signed-in players', () => {
  const source = fs.readFileSync(new URL('./clientHomeAmbient.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/^export /gm, '') + '\n;globalThis.game = { launchHomeHelicopter, hitHomeHelicopter };';
  const classes = { add() {}, remove() {}, toggle() {} };
  const target = { classList: classes, style: {}, setAttribute() {}, blur() {}, getBoundingClientRect() { return { left: 0, top: 0, width: 100, height: 50 }; } };
  const area = { getBoundingClientRect() { return { left: 0, top: 0 }; } };
  const score = { textContent: '' };
  const status = { textContent: '' };
  const elements = { '#home-helicopter': target, '.home-sky-atmosphere': area, '#home-patrol-score': score, '#home-patrol-status': status };
  const context = { $: selector => elements[selector] || null, state: { phase: 'home', sound: false, account: { account: {} } }, REDUCED_MOTION: false, PARLOR_PATROL_ENABLED: true, localStorage: { getItem() { return null; }, setItem() {} }, setTimeout() { return 1; }, clearTimeout() {}, Math };
  vm.runInNewContext(source, context);
  context.game.launchHomeHelicopter();
  context.game.hitHomeHelicopter();
  assert.match(status.textContent, /LOCAL BEST 100/);
});

test('verified scores above 100000 survive account sanitization and profile rendering', () => {
  const session = sanitizeAccountSession({ account: { id: 'a', username: 'user', stats: { patrolVerifiedBest: 1234567 } } });
  assert.equal(session.account.stats.patrolVerifiedBest, 1234567);
  const html = profileRenderer(true)(profile(session.account.stats));
  assert.match(html, /PATROL VERIFIED BEST<\/dt><dd[^>]*>1234567<\/dd>/);
});

test('clean-run copy describes a clean wave followed by game over', () => {
  const source = fs.readFileSync(new URL('./clientAchievements.js', import.meta.url), 'utf8')
    .replace(/^import .*;\r?\n/gm, '')
    .replace(/^export \{.*\};\r?\n/gm, '') + '\n;globalThis.items = ACHIEVEMENTS;';
  const context = { PARLOR_PATROL_ENABLED: true };
  vm.runInNewContext(source, context);
  const clean = context.items.find(entry => entry.id === 'clean-run');
  assert.match(clean.short, /clean wave/i);
  assert.match(clean.detail, /full wave without missing a target.*game over/i);
});
