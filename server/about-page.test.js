// The /about page is plain server-rendered HTML that explains the game, carries
// the FAQ as structured data only when indexing is configured, and never claims
// to be (or to be affiliated with) the brands it is compared to.
import assert from 'node:assert/strict';
import { renderAboutPage, ABOUT_FAQ } from './aboutPage.js';

const live = renderAboutPage({ origin: 'https://play.example' });
assert.match(live, /id="view-about"/, 'About belongs to the application shell');
assert.match(live, /id="about-page-content"/, 'the public reading surface contains server-rendered content');
assert.match(live, /<h1[^>]*>About Poorup<\/h1>/, 'the heading identifies the project');
assert.match(live, /Monopoly-style/, 'the game genre stays explained');
assert.match(live, /<title>About Poorup/, 'its own title');
assert.match(live, /rel="canonical" href="https:\/\/play\.example\/about"/);
assert.match(live, /name="robots" content="index,follow"/);
assert.match(live, /og:image" content="https:\/\/play\.example\/assets\/social\/poorup-og-1200x630\.png"/);
assert.match(live, /href="\/rules"/, 'links to the rules');
assert.match(live, /href="\/"[^>]*>Play now</, 'links to the game');

// FAQ: every visible answer is in the structured data, and vice versa.
const ld = [...live.matchAll(/<script type="application\/ld\+json">([^<]*)<\/script>/g)].map(match => JSON.parse(match[1]));
const faq = ld.find(entry => entry['@type'] === 'FAQPage');
assert.ok(faq, 'FAQPage structured data');
assert.equal(faq.mainEntity.length, ABOUT_FAQ.length);
for (const item of ABOUT_FAQ) {
  assert.ok(live.includes(item.question.replace(/&/g, '&amp;')), `the page shows "${item.question}"`);
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
