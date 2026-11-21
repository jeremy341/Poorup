// Deterministic build for the plain-client stylesheet. public/css/*.css remain the
// editable sources; this concatenates them in numeric filename order into one
// content-hashed bundle under public/dist/, writes a manifest, and keeps the
// bundle link in public/index.html in sync. No runtime or templating dependency.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repoRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const cssDirectory = path.join(repoRoot, 'public', 'css');
const distDirectory = path.join(repoRoot, 'public', 'dist');
const indexPath = path.join(repoRoot, 'public', 'index.html');
const manifestPath = path.join(distDirectory, 'manifest.json');
const BUNDLE_LINK = /<link\s+rel="stylesheet"\s+href="\/dist\/styles\.[0-9a-f]+\.css"\s+data-css-bundle\s*\/>/;

function sourceFiles() {
  return fs.readdirSync(cssDirectory)
    .filter(name => /^\d+-.+\.css$/.test(name))
    .sort((a, b) => Number.parseInt(a, 10) - Number.parseInt(b, 10) || a.localeCompare(b));
}

export function buildAssets() {
  const files = sourceFiles();
  if (!files.length) throw new Error(`No numbered CSS sources in ${cssDirectory}`);
  // trimEnd keeps the hash stable across editors that add/remove trailing blank lines;
  // the numbered order reproduces the cascade of the original per-file <link>s.
  const bundle = `${files.map(name => {
    const source = fs.readFileSync(path.join(cssDirectory, name), 'utf8').trimEnd();
    return `/* ${name} */\n${source}\n`;
  }).join('\n')}\n`;
  const hash = crypto.createHash('sha256').update(bundle).digest('hex').slice(0, 12);
  const filename = `styles.${hash}.css`;
  const stylesheet = `/dist/${filename}`;
  const manifest = { stylesheet, hash, files };

  fs.mkdirSync(distDirectory, { recursive: true });
  for (const entry of fs.readdirSync(distDirectory)) {
    if (/^styles\.[0-9a-f]+\.css$/.test(entry) && entry !== filename) fs.rmSync(path.join(distDirectory, entry));
  }
  fs.writeFileSync(path.join(distDirectory, filename), bundle);
  fs.writeFileSync(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`);

  const index = fs.readFileSync(indexPath, 'utf8');
  if (!BUNDLE_LINK.test(index)) throw new Error('index.html is missing the data-css-bundle stylesheet link');
  const link = `<link rel="stylesheet" href="${stylesheet}" data-css-bundle />`;
  fs.writeFileSync(indexPath, index.replace(BUNDLE_LINK, () => link));

  return manifest;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  const manifest = buildAssets();
  console.log(`Built ${manifest.stylesheet} from ${manifest.files.length} CSS files (${manifest.hash})`);
}
