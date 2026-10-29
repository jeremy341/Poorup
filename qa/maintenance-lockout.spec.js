/* global document, localStorage, sessionStorage */
import { test, expect } from '@playwright/test';
import { spawn } from 'node:child_process';
import { mkdtempSync, rmSync } from 'node:fs';
import net from 'node:net';
import { tmpdir } from 'node:os';
import path from 'node:path';
import process from 'node:process';
import { fileURLToPath } from 'node:url';
import { io } from 'socket.io-client';

// Maintenance lockout: the public "Under maintenance" panel, operator sign-in and the admin switch.
// Everything runs against a throw-away server of its own: a random port above 20000, an empty
// data directory and fixed test credentials. It never touches port 8080 and only stops its own PID.

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const OPERATOR_PASSWORD = 'parlor-operator-pass';
const MAINTENANCE_TOKEN = 'qa-maintenance-token-0123456789';
const ADMIN = { username: 'qa_admin', password: 'qa-admin-pass-1', displayName: 'QA Admin' };

let origin = '';
let child = null;
let dataDir = '';
let admin = null;
let expectedExit = false;

const url = pathname => `${origin}${pathname}`;
const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));

function freePort() {
  return new Promise((resolve, reject) => {
    const attempt = () => {
      const port = 20000 + Math.floor(Math.random() * 30000);
      const probe = net.createServer();
      probe.once('error', attempt);
      probe.listen(port, '127.0.0.1', () => probe.close(error => (error ? reject(error) : resolve(port))));
    };
    attempt();
  });
}

async function waitForServer(port) {
  const deadline = Date.now() + 30_000;
  while (Date.now() < deadline) {
    try { if ((await fetch(`http://127.0.0.1:${port}/`)).ok) return; } catch { /* not listening yet */ }
    await sleep(150);
  }
  throw new Error(`The throw-away server did not start on port ${port}.`);
}

async function startServer(port, extraEnv = {}) {
  expectedExit = false;
  child = spawn(process.execPath, ['server/server.js'], {
    cwd: ROOT,
    stdio: 'ignore',
    env: {
      ...process.env,
      PORT: String(port),
      POORUP_DATA_DIR: dataDir,
      POORUP_MAINTENANCE_TOKEN: MAINTENANCE_TOKEN,
      POORUP_MAINTENANCE_PASSWORD: OPERATOR_PASSWORD,
      POORUP_ADMIN_ACCOUNT_IDS: '',
      ...extraEnv,
    },
  });
  child.once('exit', code => { if (!expectedExit) console.error(`throw-away server exited early (${code})`); });
  await waitForServer(port);
}

async function stopServer() {
  if (!child) return;
  expectedExit = true;
  const own = child;
  child = null;
  const exited = new Promise(resolve => own.once('exit', resolve));
  own.kill();
  await Promise.race([exited, sleep(5000)]);
}

function socketCall(client, event, payload) {
  return new Promise(resolve => { client.emit(event, payload, resolve); });
}

async function withSocket(run) {
  const client = io(origin, { transports: ['websocket'], forceNew: true, reconnection: false });
  await new Promise((resolve, reject) => { client.once('connect', resolve); client.once('connect_error', reject); });
  try { return await run(client); } finally { client.close(); }
}

async function internalMaintenance(body) {
  const response = await fetch(url('/internal/maintenance'), {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-poorup-maintenance-token': MAINTENANCE_TOKEN },
    body: JSON.stringify(body),
  });
  expect(response.status).toBe(200);
}

const lock = (extra = {}) => internalMaintenance({ mode: 'maintenance', lockout: true, message: 'Back at nine', releaseId: 'rel-9', ...extra });
const reopen = () => internalMaintenance({ mode: 'normal' });

test.describe.configure({ mode: 'serial' });

test.beforeAll(async () => {
  test.setTimeout(90_000);
  dataDir = mkdtempSync(path.join(tmpdir(), 'poorup-lockout-'));
  // Account ids are random, so the admin account is created first and the server restarted with its id.
  const first = await freePort();
  origin = `http://127.0.0.1:${first}`;
  await startServer(first);
  const registered = await withSocket(client => socketCall(client, 'account-register', ADMIN));
  expect(registered.success).toBe(true);
  await stopServer();
  const second = await freePort();
  origin = `http://127.0.0.1:${second}`;
  await startServer(second, { POORUP_ADMIN_ACCOUNT_IDS: registered.account.id });
  const login = await withSocket(client => socketCall(client, 'account-login', { username: ADMIN.username, password: ADMIN.password }));
  expect(login.success).toBe(true);
  admin = { account: login.account, sessionToken: login.sessionToken };
});

test.afterAll(async () => {
  await stopServer();
  if (dataDir) rmSync(dataDir, { recursive: true, force: true });
});

test.beforeEach(async () => { await reopen(); });

const noOverflow = page => page.evaluate(() => ({
  vertical: document.documentElement.scrollHeight > document.documentElement.clientHeight,
  horizontal: document.documentElement.scrollWidth > document.documentElement.clientWidth,
}));

const panel = page => page.locator('#maintenance-home');
const password = page => page.getByLabel('Operator password');
const status = page => page.locator('[data-operator-status]');

async function openLocked(page, revealOperator = true) {
  await lock();
  await page.goto(url('/'));
  await expect(panel(page)).toBeVisible();
  await expect(page.locator('[data-operator-toggle]')).toBeVisible();
  if (revealOperator) {
    await page.locator('[data-operator-toggle]').click();
    await expect(page.locator('[data-operator-form]')).toBeVisible();
  }
}

test('a locked-out visitor sees the panel and cannot create a room', async ({ page }) => {
  await openLocked(page, false);
  await expect(page.getByRole('heading', { name: 'Under maintenance' })).toBeVisible();
  await expect(panel(page)).toContainText('Back at nine');
  await expect(panel(page)).toContainText('RELEASE rel-9');
  await expect(panel(page)).toContainText('ACTIVE ROUNDS: 0');
  await expect(panel(page).getByRole('button', { name: 'Retry status' })).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Operator sign-in' })).toBeHidden();
  await expect(password(page)).toHaveAttribute('type', 'password');
  await expect(password(page)).toHaveAttribute('autocomplete', 'current-password');
  await expect(page.locator('#home-main')).toHaveAttribute('inert', '');
  await expect(page.locator('#operator-chip')).toBeHidden();
  expect(await noOverflow(page)).toEqual({ vertical: false, horizontal: false });
  // The server refuses the room, whatever the page does.
  const refusal = await withSocket(client => socketCall(client, 'create-room', { playerName: 'Visitor' }));
  expect(refusal).toMatchObject({ success: false, code: 'MAINTENANCE_LOCKOUT' });
  // Retry reads the state back and keeps the panel while the lockout lasts.
  await panel(page).getByRole('button', { name: 'Retry status' }).click();
  await expect(panel(page)).toBeVisible();
  await expect(panel(page).getByRole('button', { name: 'Retry status' })).toBeEnabled();
});

test('a wrong password is refused generically, the field is cleared and nothing is stored', async ({ page }) => {
  await openLocked(page);
  await password(page).fill('not-the-password');
  await password(page).press('Enter');
  await expect(status(page)).toHaveText('Sign-in failed. Check the password and try again.');
  await expect(status(page)).toHaveAttribute('role', 'alert');
  await expect(password(page)).toHaveValue('');
  await expect(password(page)).toBeFocused();
  await expect(panel(page)).toBeVisible();
  expect(page.url()).toBe(url('/'));
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }));
  expect(stored).not.toContain('not-the-password');
  expect(stored).not.toContain(OPERATOR_PASSWORD);
});

test('show and hide toggles the password field and an empty submit asks for a password', async ({ page }) => {
  await openLocked(page);
  const reveal = page.getByRole('button', { name: 'SHOW', exact: true });
  await password(page).fill('visible-text');
  await reveal.click();
  await expect(password(page)).toHaveAttribute('type', 'text');
  await expect(page.getByRole('button', { name: 'HIDE', exact: true })).toHaveAttribute('aria-pressed', 'true');
  await page.getByRole('button', { name: 'HIDE', exact: true }).click();
  await expect(password(page)).toHaveAttribute('type', 'password');
  await password(page).fill('');
  await page.getByRole('button', { name: 'SIGN IN' }).click();
  await expect(status(page)).toHaveText('Enter the operator password.');
});

test('the sign-in form is hidden when the server has no operator password', async ({ page }) => {
  await page.route('**/maintenance/unlock', route => route.fulfill({ status: 404, contentType: 'application/json', body: JSON.stringify({ success: false, error: 'Not found.' }) }));
  await lock();
  await page.goto(url('/'));
  await expect(panel(page)).toBeVisible();
  await expect(panel(page)).toContainText('Operator sign-in is not available on this server.');
  await expect(page.locator('[data-operator-form]')).toBeHidden();
  await expect(panel(page).getByRole('button', { name: 'Retry status' })).toBeVisible();
});

test('a rate-limit answer shows how long to wait and disables the button', async ({ page }) => {
  await page.route('**/maintenance/unlock', route => {
    if (route.request().method() !== 'POST') return route.continue();
    return route.fulfill({ status: 429, headers: { 'retry-after': '120', 'content-type': 'application/json' }, body: JSON.stringify({ success: false, error: 'Too many attempts. Try again later.' }) });
  });
  await openLocked(page);
  await password(page).fill('anything-at-all');
  await page.getByRole('button', { name: 'SIGN IN' }).click();
  await expect(status(page)).toHaveText('Too many attempts. Try again in 2 minutes.');
  await expect(page.locator('[data-operator-submit]')).toBeDisabled();
  await expect(password(page)).toHaveValue('');
});

test('the right password opens the site with an Operator mode chip, and sign-out closes it again', async ({ page, context }) => {
  await openLocked(page);
  await password(page).fill(OPERATOR_PASSWORD);
  await page.getByRole('button', { name: 'SIGN IN' }).click();
  await expect(panel(page)).toBeHidden();
  const chip = page.locator('#operator-chip');
  await expect(chip).toBeVisible();
  await expect(chip).toContainText('OPERATOR MODE');
  await expect(page.locator('#home-main')).not.toHaveAttribute('inert', /.*/);
  await expect(page.locator('#home-main')).toBeFocused();
  expect(await noOverflow(page)).toEqual({ vertical: false, horizontal: false });
  // The token lives in an HttpOnly cookie only: not in storage, not in the address.
  const cookie = (await context.cookies()).find(entry => entry.name === 'poorup_operator');
  expect(cookie).toMatchObject({ httpOnly: true, sameSite: 'Strict' });
  const stored = await page.evaluate(() => JSON.stringify({ ...localStorage }) + JSON.stringify({ ...sessionStorage }) + document.cookie);
  expect(stored).not.toContain(OPERATOR_PASSWORD);
  expect(stored).not.toContain(cookie.value);
  expect(page.url()).toBe(url('/'));
  // A reload keeps the operator signed in (the cookie rides on the new handshake).
  await page.reload();
  await expect(chip).toBeVisible();
  await expect(panel(page)).toBeHidden();
  await chip.getByRole('button', { name: 'Sign out of operator mode' }).click();
  await expect(panel(page)).toBeVisible();
  await expect(chip).toBeHidden();
  await expect(password(page)).toHaveValue('');
  expect((await context.cookies()).find(entry => entry.name === 'poorup_operator')).toBeUndefined();
});

test('the whole sign-in works by keyboard and focus stays inside the panel', async ({ page }) => {
  await openLocked(page, false);
  await expect(page.getByRole('heading', { name: 'Under maintenance' })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'RETRY STATUS', exact: true })).toBeFocused();
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-operator-toggle]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(password(page)).toBeFocused();
  // Tab may leave the page (browser chrome) but never lands on the lobby behind the panel.
  const behindPanel = () => page.evaluate(() => { const active = document.activeElement; return Boolean(active && active !== document.body && !active.closest('#maintenance-home')); });
  for (let step = 0; step < 6; step += 1) {
    await page.keyboard.press('Tab');
    expect(await behindPanel()).toBe(false);
  }
  await password(page).focus();
  await expect(password(page)).toBeFocused();
  await expect(page.locator(':focus-visible')).toBeVisible();
  await page.keyboard.type(OPERATOR_PASSWORD);
  await page.keyboard.press('Tab');
  await expect(page.getByRole('button', { name: 'SHOW', exact: true })).toBeFocused();
  await page.keyboard.press('Space');
  await expect(password(page)).toHaveAttribute('type', 'text');
  await page.keyboard.press('Tab');
  await expect(page.locator('[data-operator-submit]')).toBeFocused();
  await page.keyboard.press('Enter');
  await expect(panel(page)).toBeHidden();
  await expect(page.locator('#operator-chip')).toBeVisible();
  await page.keyboard.press('Tab');
  expect(await page.evaluate(() => Boolean(document.activeElement?.closest('#maintenance-home')))).toBe(false);
});

test('the admin Release area turns the panel on and off for visitors', async ({ page, browser }, testInfo) => {
  // The admin signs in with the account cookie the server hands over for the account token.
  const context = page.context();
  await context.request.get(url('/account/session'), { headers: { 'x-poorup-session-token': admin.sessionToken } });
  await context.addInitScript(account => { localStorage.setItem('poorup.account.session.v1', JSON.stringify({ account })); }, admin.account);
  const visitorContext = await browser.newContext(testInfo.project.use);
  const visitor = await visitorContext.newPage();
  try {
    await visitor.goto(url('/'));
    await expect(panel(visitor)).toBeHidden();

    await page.goto(url('/admin/analytics?tab=release'));
    const toggle = page.locator('[data-lockout-action]');
    await expect(page.locator('[data-lockout-badge]')).toHaveText('OFF');
    await expect(page.locator('[data-lockout-note]')).toContainText('Operator password is set');
    await expect(toggle).toBeEnabled();
    await expect(toggle).toContainText('SHOW MAINTENANCE PANEL');
    await page.locator('[data-release-message]').fill('Upgrading the parlor');
    await toggle.click();
    await expect(page.getByRole('dialog')).toContainText('Show the maintenance panel?');
    // Cancel changes nothing.
    await page.locator('#confirm-cancel').click();
    await expect(page.locator('#confirm-modal')).toBeHidden();
    await expect(toggle).toBeFocused();
    await expect(page.locator('[data-lockout-badge]')).toHaveText('OFF');
    await expect(panel(visitor)).toBeHidden();
    await toggle.click();
    await page.getByRole('button', { name: 'SHOW PANEL' }).click();
    await expect(page.locator('[data-release-status]')).toContainText('PANEL ON');
    await expect(page.locator('[data-lockout-badge]')).toHaveText('ON · VISITORS ARE LOCKED OUT');
    await expect(toggle).toContainText('TURN PANEL OFF');
    await expect(page.locator('[data-section="log-release"]')).toContainText('LOCKOUT · on');
    // The open visitor page switches by itself, no reload.
    await expect(panel(visitor)).toBeVisible();
    await expect(panel(visitor)).toContainText('Upgrading the parlor');

    await toggle.click();
    await page.getByRole('button', { name: 'TURN OFF AND REOPEN' }).click();
    await expect(page.locator('[data-release-status]')).toContainText('PANEL OFF');
    await expect(page.locator('[data-lockout-badge]')).toHaveText('OFF');
    await expect(page.locator('[data-release-badge]')).toHaveText('OPEN');
    await expect(panel(visitor)).toBeHidden();
    expect(await noOverflow(page)).toEqual({ vertical: false, horizontal: false });
  } finally {
    await visitorContext.close();
  }
});

test('repeated wrong passwords hit the server rate limit and show the wait', async ({ page }) => {
  test.setTimeout(60_000);
  await openLocked(page);
  const submit = page.locator('[data-operator-submit]');
  for (let attempt = 0; attempt < 8; attempt += 1) {
    await password(page).fill(`wrong-${attempt}`);
    await submit.click();
    await expect(status(page)).not.toHaveText(/Checking/, { timeout: 15_000 });
    if (/Too many attempts/.test(await status(page).innerText())) break;
  }
  await expect(status(page)).toHaveText(/Too many attempts\. Try again in \d+ (second|seconds|minute|minutes)\./);
  await expect(submit).toBeDisabled();
  await expect(panel(page)).toBeVisible();
});
