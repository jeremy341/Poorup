// The /about page is plain server-rendered HTML that explains the game, carries
// the FAQ as structured data only when indexing is configured, and never claims
// to be (or to be affiliated with) the brands it is compared to.
import assert from 'node:assert/strict';
import { renderAboutPage, ABOUT_FAQ } from './aboutPage.js';
import { renderAboutContent } from '../public/clientAboutContent.js';

const live = renderAboutPage({ origin: 'https://play.example' });
assert.match(live, /id="view-about"/, 'About belongs to the application shell');
assert.match(live, /id="about-page-content"/, 'the public reading surface contains server-rendered content');
assert.match(live, /<h1[^>]*>About Poorup<\/h1>/, 'the heading identifies the project');
assert.match(live, /Monopoly-style/, 'the game genre stays explained');
assert.match(live, /<title>About Poorup/, 'its own title');
assert.match(live, /rel="canonical" href="https:\/\/play\.example\/about"/);
assert.match(live, /name="robots" content="index,follow[^"]*"/);
assert.match(live, /og:image" content="https:\/\/play\.example\/assets\/social\/poorup-og-1200x630\.png"/);
assert.match(live, /href="\/rules"/, 'links to the rules');
assert.match(live, /href="\/"[^>]*>Play now</, 'links to the game');
assert.ok(live.includes(renderAboutContent()), 'the public page contains the shared content without client rendering');
for (const id of ['about-heading', 'about-project', 'about-project-title', 'about-features', 'about-features-title', 'about-credits', 'about-credits-title', 'about-faq', 'about-faq-title']) {
  assert.equal([...live.matchAll(new RegExp(`id="${id}"`, 'g'))].length, 1, `${id} remains a unique anchor`);
}
for (const id of ['about-project', 'about-features', 'about-credits', 'about-faq']) {
  assert.match(live, new RegExp(`href="#${id}"`), `${id} remains in the section navigation`);
}
assert.match(live, /<a href="\/llms\.txt">AI summary \(llms\.txt\)<\/a>/, 'the AI summary remains a visible link');
assert.match(live, /<noscript><p class="about-static-note">/, 'the static page explains the JavaScript requirement for play');

// The page stays a lean document, and its one decorative aside stays honest:
// the pull quote is lifted verbatim from the visible copy (so it can never
// introduce a claim of its own), and the ledger keeps a column shape its
// ruled rows can hold.
const pullQuotes = [...live.matchAll(/<p class="about-pull" aria-hidden="true"><span>([^<]*)<\/span><\/p>/g)];
assert.equal(pullQuotes.length, 1, 'the pull quote remains a single decorative aside');
for (const [, quote] of pullQuotes) {
  const occurrences = live.match(new RegExp(quote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')).length;
  assert.ok(occurrences >= 2, `"${quote}" stays lifted from the visible copy`);
}
assert.match(live, /<p class="about-rider">Know Monopoly or Richup\.io\?/, 'the ledger keeps its closing line of small print');
const ledgerRows = (live.split('<ul class="about-feature-list">')[1]?.split('</ul>')[0].match(/<li>/g) || []).length;
assert.ok(ledgerRows >= 1 && ledgerRows <= 8, `the feature ledger holds ${ledgerRows} rows within its column shape`);

// FAQ: every visible answer is in the structured data, and vice versa.
const ld = [...live.matchAll(/<script type="application\/ld\+json">([^<]*)<\/script>/g)].map(match => JSON.parse(match[1]));
const faq = ld.find(entry => entry['@type'] === 'FAQPage');
assert.ok(faq, 'FAQPage structured data');
assert.equal(faq.mainEntity.length, ABOUT_FAQ.length);
for (const item of ABOUT_FAQ) {
  assert.ok(live.includes(item.question.replace(/&/g, '&amp;')), `the page shows "${item.question}"`);
  const escapedAnswer = item.answer.replace(/[&<>"']/g, character => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[character]));
  assert.ok(live.includes(escapedAnswer), `the page contains the answer to "${item.question}"`);
  assert.ok(faq.mainEntity.some(entry => entry.name === item.question && entry.acceptedAnswer.text === item.answer));
}

// Honest about other brands.
assert.match(live, /not affiliated with Hasbro/i);
assert.match(live, /Richup\.io/);
assert.doesNotMatch(live, /official|licensed|the real Monopoly/i, 'no claim of being the real thing');

// Unconfigured deploys stay out of search and send no structured data.
const dark = renderAboutPage({});
assert.match(dark, /name="robots" content="noindex,nofollow"/);
assert.doesNotMatch(dark, /application\/ld\+json/);
assert.doesNotMatch(dark, /rel="canonical"/);

// Untrusted text never lands unescaped.
assert.doesNotMatch(renderAboutPage({ origin: 'https://play.example', description: '<script>alert(1)</script>' }).replace(/<script type="application\/ld\+json">[^<]*<\/script>/g, ''), /<script>alert/);

// Operator text with replacement patterns ($&, $') is copied verbatim, in the page and the FAQ data.
{
  const odd = renderAboutPage({ origin: 'https://play.example', description: "Win $& pay $' rent" });
  assert.equal(odd.match(/<\/head>/gi).length, 1, 'the page is not spliced into the description');
  assert.match(odd, /content="Win \$&amp; pay \$' rent"/);
  const stub = renderAboutPage({ origin: 'https://play.example', indexHtml: '<html><head><title>T</title></head><body><!-- about-content --></body></html>' });
  assert.match(stub, /FAQPage/);
}

console.log('about page: passed');
