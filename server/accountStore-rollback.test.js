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

fs.rmSync(filePath, { force: true });
console.log("account store rollback tests: passed");
