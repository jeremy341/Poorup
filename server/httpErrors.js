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

function clientErrorMessage(status) {
  if (status === 413) return 'The request is too large.';
  if (status === 415) return 'The request encoding is not supported.';
  return 'The request could not be read.';
}

// Terminal error middleware. A 4xx the framework raised (bad JSON, oversized or wrongly encoded body, undecodable URL) is the
// caller's fault: it answers with that status and is not counted as a server error, so an anonymous client cannot raise the
// admin error counter. Everything else is a 500.
export function createHttpErrorHandler({ metrics = null, errorPage, log = console.error } = {}) {
  return function httpErrorHandler(error, req, res, next) {
    if (res.headersSent) return next(error);
    const status = Number(error?.status || error?.statusCode);
    if (status >= 400 && status < 500) {
      if (API_PREFIX.test(req.path || '')) return res.status(status).json({ success: false, error: clientErrorMessage(status) });
      return res.status(status).type('html').send(errorPage(`${status} · Bad request`, clientErrorMessage(status)));
    }
    metrics?.incrementMetric('error-count', { source: 'http' });
    log('HTTP request failed:', error?.message || 'unknown error');
    return res.status(500).type('html').send(errorPage('500 · Parlor unavailable', 'The table is temporarily offline. Try again shortly.'));
  };
}
