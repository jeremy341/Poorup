const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const ALLOWED_TEMPLATES = new Set(['recovery-email-verification', 'password-reset', 'deletion-requested', 'deletion-cancelled', 'account-deleted', 'recovery-email-verified']);
const VARIABLE_KEYS = new Set(['actionUrl', 'dueAt', 'username']);

function cleanEmail(value) {
  const email = typeof value === 'string' ? value.trim().slice(0, 254) : '';
  return EMAIL_RE.test(email) ? email : '';
}

function cleanText(value, max = 200) {
  return typeof value === 'string' ? value.replace(/[\u0000-\u001f]/gu, '').slice(0, max) : '';
}

export function createMailAdapter({ config = {}, env = process.env, fetchImpl = globalThis.fetch, timeoutMs = 8_000, maxAttempts = 2, sleep = () => Promise.resolve() } = {}) {
  const apiUrl = cleanText(config.apiUrl ?? env.POORUP_MAIL_API_URL, 500);
  const apiKey = typeof (config.apiKey ?? env.POORUP_MAIL_API_KEY) === 'string' ? (config.apiKey ?? env.POORUP_MAIL_API_KEY) : '';
  const from = cleanText(config.from ?? env.POORUP_MAIL_FROM, 254);

  async function send({ to, subject, template, variables = {} } = {}) {
    const recipient = cleanEmail(to);
    if (!apiUrl || !apiKey || !from) return { success: false, code: 'MAIL_NOT_CONFIGURED' };
    if (!recipient || !ALLOWED_TEMPLATES.has(template)) return { success: false, code: 'MAIL_REQUEST_INVALID' };
    if (typeof fetchImpl !== 'function') return { success: false, code: 'MAIL_UNAVAILABLE' };
    const safeVariables = Object.fromEntries(Object.entries(variables || {}).filter(([key]) => VARIABLE_KEYS.has(key)).map(([key, value]) => [key, cleanText(value, 600)]));
    const body = JSON.stringify({ to: recipient, from, subject: cleanText(subject, 160), template, variables: safeVariables });
    let lastError = null;
    for (let attempt = 0; attempt < Math.max(1, maxAttempts); attempt += 1) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), Math.max(500, Number(timeoutMs) || 8_000));
      try {
        const response = await fetchImpl(apiUrl, { method: 'POST', headers: { 'content-type': 'application/json', Authorization: `Bearer ${apiKey}` }, body, signal: controller.signal });
        if (response?.ok) return { success: true, status: response.status };
        lastError = new Error(`mail status ${Number(response?.status) || 0}`);
      } catch (error) {
        lastError = error;
      } finally {
        clearTimeout(timer);
      }
      if (attempt + 1 < Math.max(1, maxAttempts)) await sleep(25 * (attempt + 1));
    }
    return { success: false, code: 'MAIL_SEND_FAILED', retryable: true, reason: lastError ? 'provider-error' : 'unknown' };
  }

  return { send, configured: Boolean(apiUrl && apiKey && from) };
}

export { ALLOWED_TEMPLATES };
