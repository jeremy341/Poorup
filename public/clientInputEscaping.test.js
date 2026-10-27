// Client escaping for player-controlled values (E6-01 sprite colours, E6-02
// profile ids, E6-07 surrogate-safe names, E6-09 apostrophes in esc). These
// are escaping and shape checks only: valid input must render exactly as before.
import assert from 'node:assert/strict';

const values = new Map();
globalThis.window = { matchMedia: () => ({ matches: false }) };
globalThis.document = { querySelector: () => null, querySelectorAll: () => [] };
globalThis.localStorage = {
  getItem: key => values.get(key) || null,
  setItem: (key, value) => values.set(key, String(value)),
  removeItem: key => values.delete(key),
};
globalThis.sessionStorage = { getItem: () => null, setItem: () => {} };

const { esc } = await import('./clientDom.js');
const { spriteFromGrid, spriteHTML, avatarHTML } = await import('./clientSprites.js');
const { sanitizeProfile, persistAccountSession, loadAccountSession } = await import('./clientSanitize.js');

const HOSTILE_COLOR = '#000000" onload="1';
const LONE_SURROGATE = /[\ud800-\udbff](?![\udc00-\udfff])|(?<![\ud800-\udbff])[\udc00-\udfff]/;
const EMPTY_FACE = Array.from({ length: 8 }, () => Array.from({ length: 8 }, () => null));

let passed = 0;
function check(name, fn) {
  fn();
  passed += 1;
  console.log(`ok - ${name}`);
}

check('esc escapes apostrophes as well as markup characters (E6-09)', () => {
  assert.equal(esc(`it's "x" <b>&`), 'it&#39;s &quot;x&quot; &lt;b&gt;&amp;');
  assert.equal(esc('Plain Name'), 'Plain Name');
});

check('sprite colours that are not six-digit hex never reach an SVG attribute (E6-01)', () => {
  const markup = spriteFromGrid([[HOSTILE_COLOR, '#35a653']]);
  assert.equal(markup.includes('onload'), false);
  assert.match(markup, /fill="#35a653"/);
  assert.equal(spriteHTML('pawn', 2, HOSTILE_COLOR).includes('onload'), false);
  assert.equal(avatarHTML({ color: HOSTILE_COLOR }, 2, 0).includes('onload'), false);
});

check('valid sprite colours render unchanged', () => {
  assert.match(spriteHTML('pawn', 2, '#286ea1'), /fill="#286ea1"/);
  assert.match(spriteFromGrid([['#ABCDEF']]), /fill="#ABCDEF"/);
});

check('profile ids outside the pf_ shape are replaced, valid ids are kept (E6-02)', () => {
  const hostile = sanitizeProfile({ id: '" onmouseover="x', color: '#123456', avatarGrid: EMPTY_FACE });
  assert.match(hostile.id, /^pf_[a-z0-9]{1,24}$/);
  const valid = sanitizeProfile({ id: 'pf_abc123', color: '#123456', avatarGrid: EMPTY_FACE });
  assert.equal(valid.id, 'pf_abc123');
});

check('account display names are cut by code point, never through a surrogate pair (E6-07)', () => {
  persistAccountSession({ account: { id: 'acct-surrogate', username: 'owner', displayName: `${'a'.repeat(17)}\u{20000}z` } });
  const name = loadAccountSession().account.displayName;
  assert.equal([...name].length, 18);
  assert.equal(LONE_SURROGATE.test(name), false);
});

console.log(`PASS - ${passed} client escaping checks`);
