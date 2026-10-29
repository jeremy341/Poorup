function escapeHtmlText(value) {
  return String(value ?? '').replace(/[&<>"']/g, character => ({
    '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;'
  })[character]);
}

// extraHtml is reserved for server-authored fragments. Dynamic text is always
// escaped here; recovery tokens must already be escaped before entering a form.
export function renderErrorPage(title, message, extraHtml = '') {
  const safeTitle = escapeHtmlText(title);
  const safeMessage = escapeHtmlText(message);
  const safeExtra = typeof extraHtml === 'string' ? extraHtml : '';
  const status = /^([45]\d{2})\s*[·:-]?\s*(.+)$/.exec(String(title ?? ''));
  const heading = escapeHtmlText(status ? status[2] : title);
  return `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1, viewport-fit=cover">
    <meta name="theme-color" content="#01070a">
    <title>${safeTitle} · Poorup</title>
    <link rel="icon" href="/favicon.svg" type="image/svg+xml">
    <link rel="stylesheet" href="/styles.css">
    <link rel="stylesheet" href="/ui-review-system.css">
  </head>
  <body class="ui-error-page">
    <main class="ui-error-card noise${safeExtra ? ' has-form' : ''}">
      <p class="ui-error-brand"><img src="/favicon.svg" alt="" width="40" height="40"><span>Poorup<span class="ui-error-tagline">After-hours parlor</span></span></p>
      ${status ? `<div class="ui-error-code" aria-hidden="true">${status[1]}</div>` : ''}
      <h1>${heading}</h1>
      <p class="ui-error-message">${safeMessage}</p>
      ${safeExtra}
      <a class="ui-error-return" href="/">Return to the parlor</a>
    </main>
  </body>
</html>`;
}
