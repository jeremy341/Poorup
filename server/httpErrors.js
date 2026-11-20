// Express 4 does not catch a promise an async handler rejects, and the process
// treats an unhandled rejection as fatal (server.js crash guards). Wrapping an
// async handler hands the failure to the error middleware as a plain 500.
export function asyncRoute(handler) {
  return (req, res, next) => {
    try {
      const result = handler(req, res, next);
      if (result && typeof result.catch === 'function') result.catch(next);
    } catch (error) {
      next(error);
    }
  };
}

const API_PREFIX = /^\/(?:account|admin|internal)(?:\/|$)/;

// Messages for JSON answers, and the HTML page copy where it differs. Nothing here echoes the request, the route or a stack trace.
const CLIENT_ERROR_MESSAGES = Object.freeze({
  404: 'Not found.',
  405: 'This method is not allowed here.',
  413: 'The request is too large.',
  415: 'The request encoding is not supported.',
  421: 'This host is not served here.',
});
const CLIENT_ERROR_HTML_MESSAGES = Object.freeze({ 404: 'That route is not part of this parlor.' });
const CLIENT_ERROR_HTML_TITLES = Object.freeze({ 404: '404 · Table not found', 405: '405 · Method not allowed', 421: '421 · Wrong host' });

function clientErrorMessage(status) {
  return CLIENT_ERROR_MESSAGES[status] || 'The request could not be read.';
}

// Terminal error middleware. A 4xx the framework raised (bad JSON, oversized or wrongly encoded body, undecodable URL) is the
// caller's fault: it answers with that status and is not counted as a server error, so an anonymous client cannot raise the
// admin error counter. Everything else is a 500.
function isClientStatus(status) {
  return status >= 400 && status < 500;
}

function answerClientError(req, res, status, errorPage) {
  if (API_PREFIX.test(req.path || '')) return res.status(status).json({ success: false, error: clientErrorMessage(status) });
  const title = CLIENT_ERROR_HTML_TITLES[status] || `${status} · Bad request`;
  return res.status(status).type('html').send(errorPage(title, CLIENT_ERROR_HTML_MESSAGES[status] || clientErrorMessage(status)));
}

// A 4xx this app answers on purpose (unknown route, disallowed method, wrong host). API paths get the same JSON shape as every other
// client error; everything else gets the HTML error page.
export function answerHttpError(req, res, status, errorPage) {
  return answerClientError(req, res, status, errorPage);
}

function answerServerError(metrics, log, error, res, errorPage) {
  metrics?.incrementMetric('error-count', { source: 'http' });
  log('HTTP request failed:', error?.message || 'unknown error');
  return res.status(500).type('html').send(errorPage('500 · Parlor unavailable', 'The table is temporarily offline. Try again shortly.'));
}

export function createHttpErrorHandler({ metrics = null, errorPage, log = console.error } = {}) {
  return function httpErrorHandler(error, req, res, next) {
    if (res.headersSent) return next(error);
    const status = Number(error?.status || error?.statusCode);
    if (isClientStatus(status)) return answerClientError(req, res, status, errorPage);
    return answerServerError(metrics, log, error, res, errorPage);
  };
}
