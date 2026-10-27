import assert from 'node:assert/strict';
globalThis.window = { matchMedia: () => ({ matches: false }) };
const { closeButtonHTML } = await import('./clientCloseButton.js');

const html = closeButtonHTML({ id: 'wallet-close', label: 'Close wallet and items', className: 'wallet-close' });
assert.match(html, /id="wallet-close"/);
assert.match(html, /type="button"/);
assert.match(html, /aria-label="Close wallet and items"/);
assert.match(html, /title="Close wallet and items"/);
assert.match(html, /surface-close wallet-close/);
assert.match(html, /aria-hidden="true" focusable="false"/);
assert.match(html, /<use href="#ui-close"/);
assert.doesNotMatch(html, /onclick|submit/);
const escaped = closeButtonHTML({ id: 'close', label: 'Close "A&B" <panel>' });
assert.match(escaped, /aria-label="Close &quot;A&amp;B&quot; &lt;panel&gt;"/);
assert.doesNotMatch(escaped, /<panel>/);
assert.throws(() => closeButtonHTML({ id: 'close', label: '' }), TypeError);
assert.throws(() => closeButtonHTML({ id: '', label: 'Close panel' }), TypeError);
console.log('shared close button: semantic labels, non-submit behavior, icon reference and escaping passed');
