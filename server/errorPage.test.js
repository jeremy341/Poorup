import assert from 'node:assert/strict';
import { renderErrorPage } from './errorPage.js';

const page = renderErrorPage('Confirm recovery email', 'Use this address for recovery.', '<form method="post" action="/account/recovery/verify"><input type="hidden" name="token" value="safe-token"><button type="submit">CONFIRM RECOVERY EMAIL</button></form>');
assert.match(page, /<html lang="en">/);
assert.match(page, /href="\/styles\.css"/);
assert.match(page, /href="\/ui-review-system\.css"/);
assert.match(page, /<h1>Confirm recovery email<\/h1>/);
assert.match(page, /method="post" action="\/account\/recovery\/verify"/);
assert.match(page, /name="token" value="safe-token"/);
assert.match(page, /CONFIRM RECOVERY EMAIL/);
assert.match(page, /Return to the parlor/);

const escaped = renderErrorPage('<script>alert(1)</script>', 'Bad <b>route</b> & "value"', '<p>Server-authored form</p>');
assert.doesNotMatch(escaped, /<script>/);
assert.match(escaped, /&lt;script&gt;alert\(1\)&lt;\/script&gt;/);
assert.match(escaped, /Bad &lt;b&gt;route&lt;\/b&gt; &amp; &quot;value&quot;/);
assert.match(escaped, /<p>Server-authored form<\/p>/);

console.log('error page contracts: 12 passed');
