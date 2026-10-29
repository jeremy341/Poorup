import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { normalizeFinalPlacements, rankGameOverPlayers, gameOverScore, gameOverPlayerStatus } from './clientGameResults.js';

const players = [
  { id: 'p1', serverId: 'uuid-winner', cash: 100, bankrupt: false },
  { id: 'p2', serverId: 'uuid-other', cash: 10000, bankrupt: false },
  { id: 'p3', serverId: 'uuid-bankrupt', cash: 50000, bankrupt: true },
  { id: 'p4', serverId: 'uuid-ghost', cash: 90000, disconnected: true },
];
const ranked = rankGameOverPlayers(players, {
  'uuid-winner': 1, 'uuid-other': 2, 'uuid-bankrupt': 3, 'uuid-ghost': 4,
}, 'uuid-winner');
assert.deepEqual(ranked.map(player => player.id), ['p1', 'p2', 'p3', 'p4']);
assert.equal(ranked[0].isWinner, true, 'local p1 identity resolves through serverId');
assert.equal(ranked[0].placement, 1);
assert.equal(rankGameOverPlayers(players, null, 'p1')[0].isWinner, true, 'legacy local winner IDs remain supported');

const legacy = rankGameOverPlayers([
  { id: 'poor', cash: 10 }, { id: 'rich', cash: 100 }, { id: 'broke', cash: 1000, bankrupt: true },
]);
assert.deepEqual(legacy.map(player => player.id), ['rich', 'poor', 'broke']);
assert.equal(legacy.every(player => player.placement === null), true);
const crownedFallback = rankGameOverPlayers([
  { id: 'p1', serverId: 'winner', cash: 5 }, { id: 'p2', serverId: 'richer', cash: 500 },
], null, 'winner');
assert.deepEqual(crownedFallback.map(player => player.id), ['p1', 'p2'], 'legacy fallback still follows the crown');
assert.deepEqual(normalizeFinalPlacements({ started: false, roundNumber: 3, lastWinner: { id: 'winner' }, finalPlacements: { winner: 1, p2: 2, leaked: 'cash' } }), { winner: 1, p2: 2 });
assert.equal(normalizeFinalPlacements({ started: true, roundNumber: 3, lastWinner: { id: 'winner' }, finalPlacements: { winner: 1 } }), null, 'rematch snapshot clears previous standings');
assert.equal(normalizeFinalPlacements({ started: false, roundNumber: 0, lastWinner: { id: 'winner' }, finalPlacements: { winner: 1 } }), null, 'new game reset clears previous standings');
assert.equal(normalizeFinalPlacements({ started: false, roundNumber: 3, lastWinner: null, finalPlacements: { winner: 1 } }), null);

assert.deepEqual(gameOverScore({ cash: 50, finalNetWorth: 2400 }, 'round-limit'), { label: 'NET WORTH', value: 2400 });
assert.deepEqual(gameOverScore({ cash: 500 }, 'round-limit'), { label: 'NET WORTH', value: null }, 'legacy missing final score is not misrepresented as cash');
assert.deepEqual(gameOverScore({ cash: 50, finalNetWorth: 2400 }, null), { label: 'CASH', value: 50 });
assert.equal(gameOverPlayerStatus({ isWinner: true, cash: 5 }), 'WINNER');
assert.equal(gameOverPlayerStatus({ bankrupt: true, cash: 1500 }), 'OUT', 'positive cash does not make an eliminated seat solvent');
assert.equal(gameOverPlayerStatus({ disconnected: true }), 'LEFT');

const presentationStyles = readFileSync(new URL('./ui-review-presentation.css', import.meta.url), 'utf8');
assert.match(presentationStyles, /#gameover-modal \.go-name\s*\{[^}]*text-align:\s*center/);
assert.match(presentationStyles, /#gameover-modal \.go-summary\s*\{[^}]*width:\s*100%/);
assert.match(presentationStyles, /#gameover-modal \.go-summary-row\s*\{[^}]*display:\s*grid[\s\S]*?width:\s*100%/);

console.log('client game results: standings ranking and centered full-width presentation passed');
