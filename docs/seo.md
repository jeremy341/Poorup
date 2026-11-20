# Search and link previews

## Switch it on (deploy settings)

Indexing stays off until both of these are set on the server:

| Setting | Value |
|---|---|
| `POORUP_PUBLIC_ORIGIN` | the final public address, for example `https://poorup.tech` (no path, no trailing slash) |
| `POORUP_INDEX_POLICY` | `index,follow` |

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
- `/about.md` and `/rules.md`, Markdown copies of the About and Rules pages, advertised from the pages with `<link rel="alternate" type="text/markdown">`.

Without the two required settings, `robots.txt` reads `Disallow: /`, the sitemap is a 404, the Markdown copies are 404s, and every page says `noindex,nofollow` with no structured data. Game, room, profile, rankings, social and admin routes stay `noindex` and closed to crawlers in every case.

## After deploying

1. Add the site in Google Search Console and Bing Webmaster Tools, verify it, and submit `https://<your domain>/sitemap.xml`.
1.5. Check `https://<your domain>/robots.txt`. With the two settings above it must allow `/`, `/about` and `/rules`, disallow `/admin/`, `/account/`, `/game`, `/play`, `/rooms`, `/profile`, `/rankings`, `/social`, `/internal/`, `/socket.io/`, `/healthz` and `/readyz`, and point at `/sitemap.xml`. Before the settings are set it reads `Disallow: /`.
2. Paste the home URL into a link-preview checker (or a chat app) to see the preview card.
3. Ask for a re-crawl of `/`, `/about` and `/rules` in Search Console.

## Pages

- `/` the game. Title and description are set per page by `server/metadata.js`. Its server-rendered HTML carries the title-screen copy (what the game is and how many players it seats) and the page's heading.
- `/about` a plain, crawlable page (server-rendered, no JavaScript needed) with how the game plays, a comparison section and an FAQ. Source: `server/aboutPage.js`, content from `public/clientAboutContent.js`.
- `/rules` the rules book, indexable. Source: `server/rulesPage.js`, content from `public/rulesSections.js`.
- `/about.md` and `/rules.md` the same two pages as Markdown (`server/seoFiles.js`, converted by `server/htmlToMarkdown.js`). Served only while indexing is approved, like the sitemap.
- `/llms.txt` a short plain-text summary for AI assistants and answer engines: what Poorup is, key facts, the three pages, a link to the full text, and a short FAQ. Served from `public/llms.txt` with no gate, since it describes the game rather than inviting indexing of game pages. Keep its facts in step with `/about` and `/rules` when the rules change.
- `/llms-full.txt` the About and Rules pages as one Markdown file, built at request time from the same modules the pages render from, so it cannot drift from them. Served with no gate, like `llms.txt`.

## Crawlers and AI assistants

`robots.txt` has one `User-agent: *` group and one group per named crawler. A crawler that matches a named group ignores `*`, so every group repeats the same rules:

- `Allow: /` for public pages.
- `Disallow:` for `/account/`, `/admin/`, `/game`, `/healthz`, `/internal/`, `/play`, `/profile`, `/rankings`, `/readyz`, `/rooms`, `/social` and `/socket.io/`.

Named crawlers, all allowed for public pages: Googlebot, Bingbot, DuckDuckBot, Applebot, GPTBot, OAI-SearchBot, ChatGPT-User, ClaudeBot, Claude-User, Claude-SearchBot, anthropic-ai, PerplexityBot, Google-Extended, Applebot-Extended and CCBot. The list is `NAMED_CRAWLERS` in `server/seoFiles.js`.

Two of them are opt-out tokens for AI training rather than crawlers. Allowing `Google-Extended` and `Applebot-Extended` opts the site in to that use. To opt out, change their group to `Disallow: /` and keep the rest.

Bytespider is not named. It falls under `*`, which allows public pages. It has been reported to ignore robots.txt, so this file cannot be relied on to keep it out.

## Structured data

Every indexable page carries one `@graph` with three entities that share stable `@id`s:

- `Organization` (`https://<origin>/#organization`), named Poorup, with the repository as `sameAs`.
- `WebSite` (`https://<origin>/#website`), publisher is the Organization.
- The game (`https://<origin>/#game`), typed `VideoGame` and `WebApplication`, free to play, 2 to 6 players, published by the Organization. Its description is on `/` only.

`/about` adds a `BreadcrumbList`. `/rules` adds a `BreadcrumbList` and a `TechArticle`. `/about` also carries a `FAQPage` built from the FAQ on the page, and it is the only page with one. `/rules` carries no `FAQPage` because it holds the rules book and no questions and answers. Do not add one there.

No structured data is served on a page that is not indexable.

## Sitemap dates

Each page's `lastmod` is the newest modification time of the source files it renders from (its page module, `server/metadata.js` and `public/index.html`). It changes when the content changes, and it is not stored anywhere else. A deploy from a fresh checkout dates every page to the checkout time. If a source file cannot be read, that page gets no `lastmod` rather than a made-up date.

## Caching

- `robots.txt`, `sitemap.xml` and `llms-full.txt`: `Cache-Control: public, max-age=3600`.
- `/about.md` and `/rules.md`: `Cache-Control: no-cache`, like the HTML pages they copy.
- `llms.txt` is a static file: `public, max-age=3600` like other public text.
- Content types: `robots.txt` and `llms-full.txt` are `text/plain; charset=utf-8`, `sitemap.xml` is `application/xml; charset=utf-8`, the Markdown copies are `text/markdown; charset=utf-8`.

Changing `POORUP_INDEX_POLICY` or `POORUP_PUBLIC_ORIGIN` takes effect on restart. Until then a cache may still hold the old `robots.txt`.

## Naming other products

Poorup describes itself as "Monopoly-style" and "like Monopoly and Richup-style games". It never claims to be, or to be affiliated with, Monopoly (Hasbro) or Richup.io, and the `/about` page says so. Keep it that way: using those names in the title or text of a page is fine when it is descriptive and true, but claiming to be the product, copying its artwork or text, or stuffing names into hidden text can get the site demoted or draw a trademark complaint.

## Expectations

Nobody can guarantee a ranking. "monopoly" is dominated by the brand owner and large retailers, and "richup" by the site itself. The realistic targets are descriptive searches such as "free online monopoly-style game", "play board game with friends online no signup" and "monopoly alternative in browser". Rankings come from time, a verified Search Console property, links from other sites (game directories, communities, a launch post), and people actually playing and returning.
