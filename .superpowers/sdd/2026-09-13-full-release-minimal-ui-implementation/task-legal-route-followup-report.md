# Legal route follow-up report

## Finding addressed

`createLegalRouter` passed Express `next` directly as the `sendFile` completion callback. Express invokes that callback without an error after a successful transfer, so each legal document fell through into downstream fallback/error middleware after already sending its response.

## Change

The `sendFile` callback now calls `next(error)` only when an error is present. Successful legal-document responses terminate at the router, preserving all document routes, aliases, headers, and copy-injection slots.

## Regression evidence

Added an Express fixture with a fallback middleware and error middleware. It requests every `LEGAL_DOCUMENTS` slug and asserts status 200 with no fallback or post-send error.

Red phase before the fix:

```text
fallthroughs: [true, true, true, true]
```

Green verification:

```text
node server/legalRoutes.test.js
npx eslint server/legalRoutes.js server/legalRoutes.test.js --quiet
```

Both passed with exit code 0.

Only `server/legalRoutes.js` and `server/legalRoutes.test.js` were changed for the implementation/regression; `server/server.js` remains parent-owned and untouched.
