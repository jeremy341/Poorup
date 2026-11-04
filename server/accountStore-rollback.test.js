import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import crypto from "node:crypto";
import { AccountStore } from "./accountStore.js";

const filePath = path.join(os.tmpdir(), `poorup-account-rollback-${crypto.randomUUID()}.json`);
const store = new AccountStore(filePath);
const failPersist = () => { throw new Error("persist failed"); };

store.persist = failPersist;
assert.throws(
  () => store.register({ username: "rollback", displayName: "Rollback", password: "long-enough-password" }),
  /persist failed/,
);
assert.equal(store.accounts.size, 0);
assert.equal(store.sessions.size, 0);
assert.equal(store.sessionHashes.size, 0);

store.persist = AccountStore.prototype.persist;
const registered = store.register({ username: "rollback", displayName: "Rollback", password: "long-enough-password" });
const accountBeforeLogin = JSON.stringify(store.getAccountById(registered.account.id));
const tokenBeforeLogin = registered.sessionToken;
store.persist = failPersist;
assert.throws(() => store.login({ username: "rollback", password: "long-enough-password" }), /persist failed/);
assert.equal(JSON.stringify(store.getAccountById(registered.account.id)), accountBeforeLogin);
assert.equal(store.sessionAccount(tokenBeforeLogin)?.id, registered.account.id);

const accountBeforeUpdate = JSON.stringify(store.getAccountById(registered.account.id));
store.persist = failPersist;
assert.throws(() => store.updateProfile(tokenBeforeLogin, { displayName: "Changed", privacy: { history: "private" } }), /persist failed/);
assert.equal(JSON.stringify(store.getAccountById(registered.account.id)), accountBeforeUpdate);

store.persist = failPersist;
assert.throws(() => store.logout(tokenBeforeLogin), /persist failed/);
assert.equal(store.sessions.get(tokenBeforeLogin), "rollback");
assert.equal(store.sessionAccount(tokenBeforeLogin)?.id, registered.account.id);

const matchPlayer = { id: "p1", accountId: registered.account.id, cash: 100, bankrupt: false, properties: [] };
const accountBeforeMatch = JSON.stringify(store.getAccountById(registered.account.id));
store.persist = failPersist;
assert.throws(() => store.recordGameResults([matchPlayer], "p1", { gameId: "rollback-match" }), /persist failed/);
assert.equal(JSON.stringify(store.getAccountById(registered.account.id)), accountBeforeMatch);
assert.equal(store.getAccountById(registered.account.id).recordedMatchIds.includes("rollback-match"), false);

store.persist = AccountStore.prototype.persist;
store.recordGameResults([matchPlayer], "p1", { gameId: "rollback-match" });
assert.equal(store.getAccountById(registered.account.id).stats.gamesPlayed, 1, "a retry writes the failed match");
assert.ok(store.getAccountById(registered.account.id).history.some(entry => entry.matchId === "rollback-match"));

const storedMatch = store.getAccountById(registered.account.id).matchHistory[0];
const revisedMatch = { ...storedMatch, tradesCompleted: 7 };
store.persist = failPersist;
assert.throws(() => store.updateMatchRecord(revisedMatch), /persist failed/);
assert.equal(store.getAccountById(registered.account.id).matchHistory[0].tradesCompleted, 0, "a failed update is rolled back");
store.persist = AccountStore.prototype.persist;
assert.equal(store.updateMatchRecord(revisedMatch).updated, true);
assert.equal(store.getAccountById(registered.account.id).matchHistory[0].tradesCompleted, 7);

const id = registered.account.id;
const beforeAchievement = JSON.stringify(store.getAccountById(id));
store.persist = failPersist;
assert.throws(() => store.recordAchievement(id, { id: 'rollback-achievement' }), /persist failed/);
assert.equal(JSON.stringify(store.getAccountById(id)), beforeAchievement, 'failed unlock must roll back');
store.persist = AccountStore.prototype.persist;
assert.equal(store.recordAchievement(id, { id: 'rollback-achievement' }).created, true);
const beforeRemoval = JSON.stringify(store.getAccountById(id));
store.persist = failPersist;
assert.throws(() => store.removeAchievement(id, 'rollback-achievement'), /persist failed/);
assert.equal(JSON.stringify(store.getAccountById(id)), beforeRemoval, 'failed removal must roll back');
const beforePatrol = JSON.stringify(store.getAccountById(id));
assert.throws(() => store.recordPatrolResult(id, { score: 200, misses: 1 }), /persist failed/);
assert.equal(JSON.stringify(store.getAccountById(id)), beforePatrol, 'failed patrol result must roll back');
store.persist = AccountStore.prototype.persist;
assert.equal(store.recordPatrolResult(id, { score: 200, misses: 1 }).best, 200);

const beforeJournalFailure = JSON.stringify(store.getAccountById(id));
store.persist = failPersist;
assert.throws(() => store.recordPatrolResult(id, { score: 250, misses: 2, settlementId: 'patrol-run-1', cleanRun: true }), /persist failed/);
assert.equal(JSON.stringify(store.getAccountById(id)), beforeJournalFailure, 'failed score-and-journal persistence rolls both back');
store.persist = AccountStore.prototype.persist;
const patrolSettlement = store.recordPatrolResult(id, { score: 250, misses: 2, settlementId: 'patrol-run-1', cleanRun: true });
assert.equal(patrolSettlement.best, 250);
const restarted = new AccountStore(filePath);
assert.deepEqual(restarted.getPendingPatrolAchievementSettlements(id), [{ id: 'patrol-run-1', score: 250, aceRuns: 1, cleanRun: true }], 'the award intent survives restart with its score settlement');
const statsBeforeReplay = JSON.stringify(restarted.getAccountById(id).stats);
assert.equal(restarted.recordPatrolResult(id, { score: 250, misses: 2, settlementId: 'patrol-run-1', cleanRun: true }).replayed, true);
assert.equal(JSON.stringify(restarted.getAccountById(id).stats), statsBeforeReplay, 'replaying a journaled settlement does not apply score stats twice');
assert.equal(restarted.completePatrolAchievementSettlement(id, 'patrol-run-1').completed, true);
assert.deepEqual(restarted.getPendingPatrolAchievementSettlements(id), []);

fs.rmSync(filePath, { force: true });
console.log("account store rollback tests: passed");
