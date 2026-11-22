// The /about page is plain server-rendered HTML that explains the game, carries
// the FAQ as structured data only when indexing is configured, and never claims
// to be (or to be affiliated with) the brands it is compared to.
import assert from 'node:assert/strict';
import { renderAboutPage, ABOUT_FAQ } from './aboutPage.js';
import { renderAboutContent } from '../public/clientAboutContent.js';
import { aboutMarkdown } from './seoFiles.js';

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
  // Exactly one link per section: browser tests target `a[href="#id"]` with strict locators.
  assert.equal([...live.matchAll(new RegExp(`href="#${id}"`, 'g'))].length, 1, `${id} has exactly one link, in the section navigation`);
}
assert.match(live, /<a href="\/llms\.txt">AI summary \(llms\.txt\)<\/a>/, 'the AI summary remains a visible link');
assert.match(live, /<noscript><p class="about-static-note">/, 'the static page explains the JavaScript requirement for play');

// The page's decorative asides stay honest: the pull quote is lifted verbatim
// from the visible copy (so it can never introduce a claim of its own), and the
// admission ticket in the masthead is held to the same contract below. The
// ledger keeps a column shape its ruled rows can hold.
const pullQuotes = [...live.matchAll(/<p class="about-pull" aria-hidden="true"><span>([^<]*)<\/span><\/p>/g)];
assert.equal(pullQuotes.length, 1, 'the pull quote remains a single decorative aside');
for (const [, quote] of pullQuotes) {
  const occurrences = live.match(new RegExp(quote.replace(/[.*+?^${}()|[\]\\]/g, '\\$&'), 'g')).length;
  assert.ok(occurrences >= 2, `"${quote}" stays lifted from the visible copy`);
}
assert.match(live, /<p class="about-rider">Know Monopoly or Richup\.io\?/, 'the ledger keeps its closing line of small print');
const ledgerRows = (live.match(/<ul class="about-feature-list"[^>]*>([\s\S]*?)<\/ul>/)?.[1].match(/<li>/g) || []).length;
assert.ok(ledgerRows >= 1 && ledgerRows <= 8, `the feature ledger holds ${ledgerRows} rows within its column shape`);

// The admission ticket is decorative: hidden from assistive technology, free of
// links, headings and focus stops, and every fact printed on it is backed by copy
// that stays visible elsewhere on the page.
const content = renderAboutContent();
const tickets = [...content.matchAll(/<div class="about-ticket" aria-hidden="true">([\s\S]*?)<\/div>/g)];
assert.equal(tickets.length, 1, 'the page has one decorative ticket');
const [ticketHtml, ticketBody] = tickets[0];
assert.doesNotMatch(ticketBody, /<(a|button|input|summary|h[1-6])\b|tabindex|href=/i, 'the ticket holds nothing focusable, navigable or structural');
assert.doesNotMatch(ticketBody, /<div/i, 'the ticket nests no div, so the Markdown converter can drop it whole');
const ticketClaims = new Map([
  ['FREE', [/free property-trading board game/]],
  ['In your browser. Nothing to download.', [/runs in your browser|play in your browser/, /nothing to download/i]],
  ['2–4 players, 6 on Metro', [/two to four players/i, /up to six on the larger Metro board/i]],
  ['A name and a room code', [/a browser, a name, and a room code are enough to start/i]],
  ['Optional', [/accounts are optional/i]],
  ['Computer players', [/computer players can fill the empty seats/i]]
]);
const withoutTicket = content.replace(ticketHtml, '');
const printed = [...ticketBody.matchAll(/<(?:strong|span)>([^<]{4,})<\/(?:strong|span)>/g)].map(match => match[1]).filter(text => ticketClaims.has(text));
assert.deepEqual(new Set(printed), new Set(ticketClaims.keys()), 'every printed claim on the ticket is listed and backed below');
for (const [claim, patterns] of ticketClaims) {
  for (const pattern of patterns) assert.match(withoutTicket, pattern, `"${claim}" is backed by visible copy outside the ticket`);
}

// The turn track shows the five beats of a turn in plain sight, under its own h3,
// and the heading outline never skips a level.
assert.match(content, /<h3 id="about-how-title">How a game of Poorup plays<\/h3>\s*<ol class="about-steps" role="list" aria-labelledby="about-how-title">/, 'the turn track is a visible, labelled list');
const beats = content.split('<ol class="about-steps"')[1]?.split('</ol>')[0].match(/<li><strong>[^<]+\.<\/strong> <span>[^<]+<\/span><\/li>/g) || [];
assert.equal(beats.length, 5, 'the turn track holds five beats');
assert.doesNotMatch(content, /<details[^>]*>\s*<summary>How a game/, 'the turn track is no longer tucked into a disclosure');
const levels = [...content.matchAll(/<h([1-6])\b/g)].map(match => Number(match[1]));
assert.equal(levels.filter(level => level === 1).length, 1, 'one h1');
levels.reduce((previous, level) => {
  assert.ok(level <= previous + 1, `an h${level} may not follow h${previous}`);
  return level;
}, 0);

// The Markdown copy drops the ticket and keeps the turn track as a numbered list.
const markdown = aboutMarkdown();
assert.doesNotMatch(markdown, /ADMIT ONE|ROOM CODE/, 'the decorative ticket stays out of the Markdown copy');
assert.match(markdown, /### How a game of Poorup plays\n\n1\. \*\*Roll and move\.\*\* On your turn/, 'the turn track becomes a numbered list');

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
