// Crawler-facing routes: the plain About and Rules pages, their Markdown copies, llms-full.txt, sitemap.xml and robots.txt.
import { renderAboutPage } from './aboutPage.js';
import { renderRulesPage } from './rulesPage.js';
import { aboutMarkdown, llmsFullText, robotsTxt, rulesMarkdown, sitemapXml } from './seoFiles.js';
import { indexingApproved as isIndexingApproved } from './metadata.js';

export function registerSeoRoutes(app, { env, pageEnv, publicOrigin }) {
  // A plain, crawlable page that explains the game in words (also feeds the FAQ rich result).
  app.get('/about', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(renderAboutPage({ env: pageEnv }));
  });

  app.get('/rules', (_req, res) => {
    res.setHeader('Cache-Control', 'no-cache');
    res.type('html').send(renderRulesPage({ env: pageEnv }));
  });

  const indexingApproved = isIndexingApproved(env);
  // robots.txt, the sitemap and the crawler text files are public, shared by every
  // client, and only change on a restart, so an hour of shared caching is safe.
  const CRAWLER_TEXT_CACHE = 'public, max-age=3600';
  app.get('/sitemap.xml', (_req, res, next) => {
    if (!indexingApproved) return next();
    res.setHeader('Cache-Control', CRAWLER_TEXT_CACHE);
    return res.type('application/xml').send(sitemapXml({ origin: publicOrigin }));
  });
  // Markdown copies of the indexable pages exist only with indexing on, like the
  // sitemap; the full-text file describes the game, so it is served like llms.txt.
  app.get('/about.md', (_req, res, next) => {
    if (!indexingApproved) return next();
    res.setHeader('Cache-Control', 'no-cache');
    return res.type('text/markdown').send(aboutMarkdown());
  });
  app.get('/rules.md', (_req, res, next) => {
    if (!indexingApproved) return next();
    res.setHeader('Cache-Control', 'no-cache');
    return res.type('text/markdown').send(rulesMarkdown());
  });
  app.get('/llms-full.txt', (_req, res) => {
    res.setHeader('Cache-Control', CRAWLER_TEXT_CACHE);
    return res.type('text/plain').send(llmsFullText());
  });

  app.get('/robots.txt', (_req, res) => {
    res.setHeader('Cache-Control', CRAWLER_TEXT_CACHE);
    return res.type('text').send(robotsTxt({ approved: indexingApproved, origin: publicOrigin }));
  });
}
