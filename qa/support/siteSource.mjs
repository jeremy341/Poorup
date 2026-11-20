// Test helper: reads the shipped client source so contract tests do not hard-code which file a rule lives in.
// siteCss() returns every stylesheet that public/index.html links, joined in link order, which is the order the browser applies the cascade.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const PUBLIC_DIRECTORY = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..', '..', 'public');

function readPublic(relativePath) {
  return fs.readFileSync(path.join(PUBLIC_DIRECTORY, relativePath), 'utf8');
}

// Stylesheet paths relative to public/, in the order index.html loads them.
export function siteStylesheetPaths() {
  const links = [...readPublic('index.html').matchAll(/<link\s+rel="stylesheet"\s+href="\/([^"]+)"/g)];
  return links.map(link => link[1]);
}

export function siteCss() {
  return siteStylesheetPaths().map(readPublic).join('\n');
}

// Concatenated text of the named client modules (paths relative to public/).
export function clientSource(...modulePaths) {
  return modulePaths.map(readPublic).join('\n');
}
