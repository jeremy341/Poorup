// The HTML-to-Markdown converter behind /about.md, /rules.md and /llms-full.txt.
// It must keep the words, drop markup and hidden chrome, and keep headings and lists.
import assert from "node:assert/strict";
import { htmlToMarkdown, decodeEntities } from "./htmlToMarkdown.js";

assert.equal(decodeEntities("Tom &amp; Jerry &lt;3 &quot;hi&quot; &#39;x&#39; &#8211; &#x2014; &nbsp;&bogus;"), 'Tom & Jerry <3 "hi" \'x\' – —  &bogus;');

assert.equal(
  htmlToMarkdown("<h1>Title &amp; more</h1><p>Hello <strong>world</strong>.</p>"),
  "# Title & more\n\nHello **world**.\n",
  "headings, paragraphs, bold and entities",
);

assert.equal(
  htmlToMarkdown('<p>See <a href="/rules">the rules</a> and <a href="#top">back up</a>.</p>'),
  "See [the rules](/rules) and back up.\n",
  "relative links keep their target; in-page anchors keep only their text",
);

assert.equal(
  htmlToMarkdown("<ul><li>One</li><li>Two <strong>bold</strong></li></ul><ol><li>First</li><li>Second</li></ol>"),
  "- One\n- Two **bold**\n\n1. First\n2. Second\n",
  "unordered items stay on consecutive lines; ordered items are numbered",
);

assert.equal(
  htmlToMarkdown('<ol><li><span class="n">01</span><div><strong>ROLL</strong><p>Roll the dice.</p></div></li></ol>'),
  "1. 01 **ROLL** Roll the dice.\n",
  "a list item with block children collapses to one line of text",
);

assert.equal(
  htmlToMarkdown('<details><summary>Is it free?</summary><p>Yes &amp; no.</p></details>'),
  "### Is it free?\n\nYes & no.\n",
  "details summaries become headings",
);

assert.equal(
  htmlToMarkdown("<span>ROLL</span><i>→</i><span>MOVE</span>"),
  "ROLL → MOVE\n",
  "adjacent spans and arrows do not run together",
);

assert.equal(
  htmlToMarkdown("<script>alert(1)</script><style>p{}</style><noscript><p>Enable JS</p></noscript><svg><use href='#x'/></svg><nav><a href='/'>Home</a></nav><p>Kept</p>"),
  "Kept\n",
  "scripts, styles, noscript, svg and navigation are not content",
);

assert.equal(
  htmlToMarkdown('<p>Visible<span aria-hidden="true"> · </span>text</p>'),
  "Visibletext\n",
  "aria-hidden decoration is dropped",
);

assert.equal(
  htmlToMarkdown('<p><img src="/a.svg" alt="Rules book"><img src="/b.svg" alt=""></p>'),
  "Rules book\n",
  "images contribute their alt text only",
);

assert.equal(htmlToMarkdown("<p>Line one<br>Line two</p>"), "Line one\nLine two\n", "line breaks are kept");

assert.equal(htmlToMarkdown("<p>Empty <strong></strong>bold</p>"), "Empty bold\n", "empty emphasis adds no markup");

assert.equal(htmlToMarkdown('<p>Keep <custom-tag data-x="1">the words</custom-tag>.</p>'), "Keep the words.\n", "unknown tags are removed, their text kept");

assert.equal(
  htmlToMarkdown('<div class="drop-me">gone</div><p>kept</p>', { drop: [/<div class="drop-me">gone<\/div>/g] }),
  "kept\n",
  "caller-supplied patterns remove chosen fragments",
);

assert.equal(htmlToMarkdown(undefined), "", "missing input converts to nothing");
assert.doesNotMatch(htmlToMarkdown("<p>a</p>\n\n\n\n<p>b</p>"), /\n{3,}/, "no runs of blank lines");

console.log("htmlToMarkdown tests: passed");
