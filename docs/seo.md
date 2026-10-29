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
| `POORUP_META_DESCRIPTION` | overrides the home-page description |
| `POORUP_PREVIEW_PATH` | overrides the link-preview image (default `/assets/social/poorup-og-1200x630.png`) |

With the two required settings the server serves a `robots.txt` that points at `/sitemap.xml`, a sitemap with `/`, `/about` and `/rules`, per-page titles and descriptions, canonical URLs, Open Graph and Twitter tags, and structured data (`WebApplication` on `/` and `/about`, `FAQPage` on `/about`). Game, room, profile, rankings, social and admin routes always stay `noindex`.

## After deploying

1. Add the site in Google Search Console and Bing Webmaster Tools, verify it, and submit `https://<your domain>/sitemap.xml`.
2. Paste the home URL into a link-preview checker (or a chat app) to see the preview card.
3. Ask for a re-crawl of `/`, `/about` and `/rules` in Search Console.

## Pages

- `/` the game. Title and description are set per page by `server/metadata.js`.
- `/about` a plain, crawlable page (server-rendered, no JavaScript needed) with how the game plays, a comparison section and an FAQ. Source: `server/aboutPage.js`.
- `/rules` the rules book, now indexable.

## Naming other products

Poorup describes itself as "Monopoly-style" and "like Monopoly and Richup-style games". It never claims to be, or to be affiliated with, Monopoly (Hasbro) or Richup.io, and the `/about` page says so. Keep it that way: using those names in the title or text of a page is fine when it is descriptive and true, but claiming to be the product, copying its artwork or text, or stuffing names into hidden text can get the site demoted or draw a trademark complaint.

## Expectations

Nobody can guarantee a ranking. "monopoly" is dominated by the brand owner and large retailers, and "richup" by the site itself. The realistic targets are descriptive searches such as "free online monopoly-style game", "play board game with friends online no signup" and "monopoly alternative in browser". Rankings come from time, a verified Search Console property, links from other sites (game directories, communities, a launch post), and people actually playing and returning.
