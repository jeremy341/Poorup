# Search and link previews

## Deploy settings

Production is indexable out of the box: the origin defaults to `https://poorup.tech` and the policy to `index,follow`, so no environment file is needed. Both settings are still there as overrides:

| Setting | Default in production | Use |
|---|---|---|
| `POORUP_PUBLIC_ORIGIN` | `https://poorup.tech` | change only for a different domain or a staging deploy (no path, no trailing slash) |
| `POORUP_INDEX_POLICY` | `index,follow` | set `noindex,nofollow` to close indexing; any unrecognised value also closes it |

Non-production defaults to closed; set both there if you want a staging build indexed.

Optional:

| Setting | Use |
|---|---|
| `POORUP_GOOGLE_SITE_VERIFICATION` | the token from Google Search Console's HTML-tag method |
| `POORUP_BING_SITE_VERIFICATION` | the token from Bing Webmaster Tools |
| `POORUP_META_DESCRIPTION` | overrides the home-page (`/`) description only; `/about` and `/rules` keep their own |
| `POORUP_PREVIEW_PATH` | overrides the link-preview image (default `/assets/social/poorup-og-1200x630.png`) |

With the two required settings the server serves:

- `/robots.txt`: public pages open to search and AI crawlers, the game, room, account and operator paths closed, and a `Sitemap:` line (see [Crawlers](#crawlers-and-ai-assistants)).
- `/sitemap.xml`: the three public pages with absolute canonical URLs and a `lastmod` date.
- Per-page titles, descriptions, canonical URLs, Open Graph and Twitter tags on `/`, `/about` and `/rules`.
- Structured data on those three pages (see [Structured data](#structured-data)).
- `/about.md` and `/rules.md`, Markdown copies advertised from their HTML pages with `<link rel="alternate" type="text/markdown">`.

Without the two required settings, `robots.txt` reads `Disallow: /`, the sitemap is a 404, the Markdown copies are 404s, and every page says `noindex,nofollow` with no structured data. Game, room, profile, rankings, social and admin routes stay `noindex` and closed to crawlers in every case.

## After deploying

1. Add the site in Google Search Console and Bing Webmaster Tools, verify it, and submit `https://<your domain>/sitemap.xml`.
1.5. Check `https://<your domain>/robots.txt`. With the two settings above it must allow `/`, `/about` and `/rules`, disallow `/admin/`, `/account/`, `/game`, `/play`, `/rooms`, `/profile`, `/rankings`, `/social`, `/internal/`, `/socket.io/`, `/healthz` and `/readyz`, and point at `/sitemap.xml`. Before the settings are set it reads `Disallow: /`.
2. Paste the home URL into a link-preview checker (or a chat app) to see the preview card.
3. Ask for a re-crawl of `/`, `/about` and `/rules` in Search Console.

## Pages

- `/` the game. Title and description are set per page by `server/metadata.js`. Its server-rendered HTML carries the title-screen copy (what the game is and how many players it seats) and the page's heading.
- `/about` a plain, crawlable page (server-rendered, no JavaScript needed) with how the game plays, a comparison section and an FAQ. Source: `server/aboutPage.js`, content from `public/clientAboutContent.js`.
- `/rules` the rules book, indexable. Source: `server/rulesPage.js`, content from `public/rulesSections.js`. Each chapter has a stable `#rules-<chapter>` anchor; a deep link opens that chapter on load.
- Indexable pages emit a `robots` meta of `index,follow, max-image-preview:large, max-snippet:-1`; private paths emit `noindex,nofollow`. `/rules` declares `og:type=article`, the other pages `website`. Outside production, setting `POORUP_PUBLIC_ORIGIN` without a valid `POORUP_INDEX_POLICY` logs a boot warning and keeps `Disallow: /` and `noindex`; production no longer warns because the default policy is valid.
- `/about.md` and `/rules.md` the same pages as Markdown (`server/seoFiles.js`, converted by `server/htmlToMarkdown.js`). Served only while indexing is approved, like the sitemap.
- `/llms.txt` a short plain-text summary for AI assistants and answer engines: what Poorup is, key facts, the three pages, a link to the full text, and a short FAQ. It opens with a hand-maintained `Last updated` date — bump it when public copy changes. Served from `public/llms.txt` with no gate, since it describes the game rather than inviting indexing of game pages. Keep its facts in step with `/about` and `/rules` when the rules change. The crawlable `/about` page carries a visible link to `/llms.txt` from its Explore row; because `/about.md` and `/llms-full.txt` are generated from that same `renderAboutContent()` source, the link appears in both Markdown copies too, so the HTML and Markdown sources stay in sync.
- `/llms-full.txt` the About and Rules pages as one Markdown file, built at request time from the same modules the pages render from, so it cannot drift from them. Served with no gate, like `llms.txt`.

## Crawlers and AI assistants

`robots.txt` has one `User-agent: *` group and one group per named crawler. A crawler that matches a named group ignores `*`, so every group repeats the same rules:

- `Allow: /` for public pages.
- `Disallow:` for `/account/`, `/admin/`, `/game`, `/healthz`, `/internal/`, `/play`, `/profile`, `/rankings`, `/readyz`, `/rooms`, `/social` and `/socket.io/`.

Named crawlers, all allowed for public pages: Googlebot, Bingbot, DuckDuckBot, Applebot, YandexBot, Baiduspider, SeznamBot, MojeekBot, GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-User, Claude-SearchBot, anthropic-ai, PerplexityBot, Perplexity-User, meta-externalagent, Amazonbot, MistralAI-User, MistralAI-UserFast, Coherebot, cohere-ai, YouBot, AI2Bot, Diffbot, Bytespider, Google-Extended, Applebot-Extended and CCBot. The list is `NAMED_CRAWLERS` in `server/seoFiles.js`.

Two of them are opt-out tokens for AI training rather than crawlers. Allowing `Google-Extended` and `Applebot-Extended` opts the site in to that use. To opt out, change their group to `Disallow: /` and keep the rest.

Bytespider is now named and allowed for public pages, but it has been reported to ignore robots.txt, so this file cannot be relied on to keep it out either way. The HTTP rate limit and per-peer socket caps are the actual backstop.

## Structured data

Every indexable page carries one `@graph` with three entities that share stable `@id`s:

- `Organization` (`https://<origin>/#organization`), named Poorup, with the repository as `sameAs` and a `logo` pointing at `https://<origin>/favicon.svg` (the real local mark in `public/favicon.svg`). Keep that asset in place so the logo URL is never a dead link. The only `sameAs` entry is the real GitHub repository; no social profile is listed because none is verified in the repository, and invented profiles must not be added.
- `WebSite` (`https://<origin>/#website`), publisher is the Organization.
- The game (`https://<origin>/#game`), typed `VideoGame` and `WebApplication`, free to play, 2 to 6 players, published by the Organization. Its description is on `/` only.

Every non-home page adds a `BreadcrumbList` (labels live beside `INDEXABLE_PATHS` in `server/metadata.js`). `/rules` additionally adds a `TechArticle`. `/about` also carries a `FAQPage` built from the FAQ on the page, and it is the only page with one. `/rules` carries no `FAQPage` because it holds the rules book and no questions and answers. Do not add one there.

No structured data is served on a page that is not indexable.

## Sitemap dates

Each page's `lastmod` is a fixed date checked into `PAGE_LASTMOD` in `server/seoFiles.js`, not derived from file modification times. Bump the date by hand when public copy changes; a fresh checkout or deploy no longer rewrites every page to the checkout time. A date stays stable until it is bumped deliberately. A page added to `INDEXABLE_PATHS` is listed in the sitemap right away; if it has no entry in `PAGE_LASTMOD` yet, the URL is listed without a `lastmod` until one is checked in.

## Caching

- `robots.txt`, `sitemap.xml` and `llms-full.txt`: `Cache-Control: public, max-age=3600`.
- `/about.md` and `/rules.md`: `Cache-Control: no-cache`, like the HTML pages they copy.
- `llms.txt` is a static file: `public, max-age=3600` like other public text.
- Content types: `robots.txt` and `llms-full.txt` are `text/plain; charset=utf-8`, `sitemap.xml` is `application/xml; charset=utf-8`, the Markdown copies are `text/markdown; charset=utf-8`.

The crawler text files above also bypass the global HTTP rate limiter, so a 429 cannot make a crawler back off; the HTML pages they describe are still counted. Changing `POORUP_INDEX_POLICY` or `POORUP_PUBLIC_ORIGIN` takes effect on restart. Until then a cache may still hold the old `robots.txt`.

## Naming other products

Poorup describes itself as "Monopoly-style" and "like Monopoly and Richup-style games". It never claims to be, or to be affiliated with, Monopoly (Hasbro) or Richup.io, and the `/about` page says so. Keep it that way: using those names in the title or text of a page is fine when it is descriptive and true, but claiming to be the product, copying its artwork or text, or stuffing names into hidden text can get the site demoted or draw a trademark complaint.

## Reachable queries and off-site work

No one can guarantee a ranking. Head terms like "monopoly" are dominated by the brand owner and large retailers, and "richup" by that site itself; competing there directly is not a realistic goal. Trademark names are fine as a truthful description of the kind of game, but never as a claim of being, being licensed by or being affiliated with Hasbro or another product. The site stays descriptive, and the About page says so plainly. Rankings come from time, a verified Search Console property, real links and people actually playing and returning.

Off-site checklist, after deploying:

1. Verify the site in **Google Search Console** using the HTML-tag method: put the token from that method in `POORUP_GOOGLE_SITE_VERIFICATION` and restart. The `<meta name="google-site-verification">` tag is emitted on every rendered page from that token.
1. Verify the site in **Bing Webmaster Tools** the same way with `POORUP_BING_SITE_VERIFICATION`; it emits `<meta name="msvalidate.01">`. Tokens are validated against a safe character set and invalid values are dropped.
1. Submit `https://poorup.tech/sitemap.xml` (or the configured `POORUP_PUBLIC_ORIGIN`) in both consoles, then use URL inspection to request indexing for `/`, `/about` and `/rules`.
1. Link the site from the **GitHub README** at `https://github.com/jeremy341/Poorup` so the repository and the site reinforce each other. That repository is the only `sameAs` entry; add a social profile there only if it really exists.
1. Ask for mentions in **game directories, board-game communities, launch posts and link roundups**, using normal descriptive links. Do not buy links or stuff keywords into hidden text.
