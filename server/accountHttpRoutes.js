// The signed-in account's HTTP surface: session lookup, data export, profile save and logout, plus the mailed password-recovery pages.
// Authentication is the cookie session; a legacy bearer token is exchanged for a cookie on first use.
import express from 'express';
import { withAdminFlag } from './analyticsApi.js';
import { escapeHtmlText, renderErrorPage } from './errorPage.js';
import { asyncRoute } from './httpErrors.js';
import { parseCookieHeader, SESSION_COOKIE_NAME } from './sessionStore.js';

// Resolves the account behind a request from its cookie session, falling back to a legacy token header (which is swapped for a cookie).
export function createRequestAccount({ accountStore, sessionStore }) {
  function accountFromCookie(req) {
    const cookies = parseCookieHeader(req.headers.cookie || '');
    const session = sessionStore.resolve(cookies[SESSION_COOKIE_NAME]);
    if (!session?.accountId) return null;
    return accountStore.getAccountById(session.accountId);
  }

  function accountFromLegacyToken(req) {
    const legacy = req.get('x-poorup-session-token') || '';
    if (!legacy) return null;
    const account = accountStore.sessionAccount(legacy);
    if (!account) return null;
    return { legacy, account };
  }

  function maybeExchangeLegacy(req, legacy) {
    const exchanged = sessionStore.exchangeLegacy(legacy, token => accountStore.sessionAccount(token)?.id || null);
    if (!exchanged) return;
    req.sessionCookie = sessionStore.cookie(exchanged.cookieValue);
    accountStore.revokeSessionToken?.(legacy);
  }

  function requestAccount(req) {
    const cookieAccount = accountFromCookie(req);
    if (cookieAccount) return cookieAccount;
    const legacyResult = accountFromLegacyToken(req);
    if (!legacyResult) return null;
    maybeExchangeLegacy(req, legacyResult.legacy);
    return legacyResult.account;
  }

  return requestAccount;
}

export function registerAccountHttpRoutes(app, { requestAccount, accountStore, sessionStore, accountRecovery, accountRights, adminIds }) {
  app.get('/account/session', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const account = requestAccount(req);
    if (!account) return res.status(401).json({ success: false, code: 'ACCOUNT_SESSION_REQUIRED', error: 'Sign in again.' });
    if (req.sessionCookie) res.setHeader('Set-Cookie', req.sessionCookie);
    return res.json({ success: true, account: withAdminFlag(accountStore.getAccountSnapshot(account.id), adminIds) });
  });

  app.get('/account/export', (req, res) => {
    const account = requestAccount(req);
    if (!account) return res.status(401).json({ success: false, code: 'ACCOUNT_SESSION_REQUIRED', error: 'Sign in to download your account data.' });
    try {
      const result = accountRights.export({ account, req });
      if (req.sessionCookie) res.setHeader('Set-Cookie', req.sessionCookie);
      res.setHeader('Cache-Control', 'no-store');
      res.setHeader('Content-Disposition', `attachment; filename="${result.filename}"`);
      return res.type('application/json').status(200).send(JSON.stringify(result.document));
    } catch {
      return res.status(500).json({ success: false, code: 'ACCOUNT_EXPORT_FAILED', error: 'Account export is temporarily unavailable.' });
    }
  });
  // Saves the signed-in player's face and colour. The sign-in token is exchanged for a cookie session (which revokes the token), so a
  // socket opened before sign-in can no longer prove who it is; this endpoint authenticates with the cookie. Only the two appearance
  // fields are accepted, and the JSON content type keeps it out of reach of cross-site form posts.
  app.post('/account/profile', express.json({ limit: '8kb' }), (req, res) => {
    const account = requestAccount(req);
    if (!account) return res.status(401).json({ success: false, code: 'ACCOUNT_SESSION_REQUIRED', error: 'Sign in again.' });
    if (account.accountDeactivated === true) return res.status(403).json({ success: false, error: 'This account is restricted.' });
    if (req.sessionCookie) res.setHeader('Set-Cookie', req.sessionCookie);
    const body = req.body && typeof req.body === 'object' ? req.body : {};
    const patch = {};
    if (typeof body.color === 'string') patch.color = body.color;
    if (Array.isArray(body.avatarGrid)) patch.avatarGrid = body.avatarGrid;
    if (!Object.keys(patch).length) return res.status(400).json({ success: false, error: 'Nothing to save.' });
    const result = accountStore.updateProfileForAccount(account, patch);
    res.setHeader('Cache-Control', 'no-store');
    if (!result?.success) return res.status(400).json({ success: false, error: result?.error || 'Could not save.' });
    return res.json({ success: true, account: withAdminFlag(accountStore.getAccountSnapshot(result.account.id), adminIds) });
  });
  app.post('/account/logout', (req, res) => {
    const cookies = parseCookieHeader(req.headers.cookie || '');
    const legacyToken = req.get('x-poorup-session-token') || '';
    try {
      // Revoke the bearer first so any exchange started after this request cannot
      // mint a new cookie. The cookie lineage covers exchanges that completed
      // just before logout but whose Set-Cookie response has not arrived yet.
      if (legacyToken) accountStore.logout(legacyToken);
      sessionStore.revoke(cookies[SESSION_COOKIE_NAME]);
      if (legacyToken) {
        if (typeof sessionStore.revokeLegacyTokenSessions !== 'function') throw new Error('Legacy session lineage is unavailable.');
        sessionStore.revokeLegacyTokenSessions(legacyToken);
      }
    } catch {
      return res.status(503).json({ success: false, code: 'ACCOUNT_LOGOUT_FAILED', error: 'Sign out could not be completed.' });
    }
    res.setHeader('Set-Cookie', sessionStore.clearCookie());
    return res.json({ success: true });
  });
  // Mail links land on a confirmation page first. Only the POST consumes the
  // single-use token, so a mail scanner that prefetches the link cannot burn it.
  const EXPIRED_LINK_MESSAGE = 'That single-use link is invalid or expired.';
  const recoveryFormParsers = [express.urlencoded({ extended: false, limit: '8kb' }), express.json({ limit: '8kb' })];
  function recoveryToken(req) {
    const source = req.method === 'GET' ? req.query : req.body;
    return typeof source?.token === 'string' ? source.token : '';
  }
  app.get('/account/recovery/verify', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const token = recoveryToken(req);
    return res.type('html').send(renderErrorPage('Confirm recovery email', 'Confirm this address to use it for password recovery.', `<form method="post" action="/account/recovery/verify"><input type="hidden" name="token" value="${escapeHtmlText(token)}"><button type="submit">CONFIRM RECOVERY EMAIL</button></form>`));
  });
  app.post('/account/recovery/verify', ...recoveryFormParsers, asyncRoute(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const verified = await accountRecovery.consumeEmailVerification(recoveryToken(req));
    if (!verified) return res.status(400).type('html').send(renderErrorPage('Recovery link expired', EXPIRED_LINK_MESSAGE));
    return res.status(200).type('html').send(renderErrorPage('Recovery email verified', 'Your recovery email is now active. Return to the parlor.'));
  }));
  app.post('/account/recovery/request', express.json({ limit: '8kb' }), asyncRoute(async (req, res) => {
    await accountRecovery.requestPasswordReset({ username: req.body?.username, email: req.body?.email });
    // Uniform response whatever the outcome: a differing "sent" flag would let enumerators confirm valid username+email pairs.
    return res.status(200).json({ success: true, sent: true });
  }));
  app.get('/account/recovery/reset', (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const token = recoveryToken(req);
    return res.type('html').send(renderErrorPage('Set a new password', 'Choose a new password. This link works once.', `<form method="post" action="/account/recovery/reset"><input type="hidden" name="token" value="${escapeHtmlText(token)}"><label>New password <input name="newPassword" type="password" autocomplete="new-password" minlength="8" maxlength="72" required></label><button type="submit">SET NEW PASSWORD</button></form>`));
  });
  app.post('/account/recovery/reset', ...recoveryFormParsers, asyncRoute(async (req, res) => {
    res.setHeader('Cache-Control', 'no-store');
    const reset = await accountRecovery.consumePasswordReset(recoveryToken(req), req.body?.newPassword);
    // The mailed link posts a form and wants a page back; a script posting JSON wants JSON.
    if (req.is('application/x-www-form-urlencoded')) {
      if (!reset) return res.status(400).type('html').send(renderErrorPage('Reset link expired', EXPIRED_LINK_MESSAGE));
      return res.status(200).type('html').send(renderErrorPage('Password updated', 'Your password is updated. Sign in from the parlor.'));
    }
    if (!reset) return res.status(400).json({ success: false, code: 'RECOVERY_TOKEN_INVALID', error: 'That reset link is invalid or expired.' });
    return res.status(200).json({ success: true });
  }));
}
