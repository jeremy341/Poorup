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

fs.rmSync(filePath, { force: true });
console.log("account store rollback tests: passed");
