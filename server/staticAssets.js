// Static delivery for the plain-client UI: Cache-Control per asset class, content-hash ETags, and br/gzip compression from node:zlib.
// Encoded bytes are kept in memory, keyed by path and encoding and validated by mtime and size, so a file is compressed once and
// every later request is a buffer copy or a 304.
import crypto from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import zlib from 'node:zlib';

// Revalidated on every use (a cheap 304 through the ETag). The client modules
// are imported by plain relative URLs, so a long max-age here would mix old
// and new code after a release.
const REVALIDATE = 'no-cache';
// Stable names, rarely edited: fonts, images, audio, icons.
const LONG_LIVED = 'public, max-age=604800';
const DEFAULT_CACHE = 'public, max-age=3600';

const REVALIDATED_EXTENSIONS = new Set(['.html', '.js', '.mjs', '.css']);
const LONG_LIVED_EXTENSIONS = new Set(['.woff2', '.woff', '.ttf', '.otf', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.gif', '.ico', '.mp3', '.ogg', '.wav']);
// Text types that shrink well. Fonts in woff2, images and audio are already
// compressed, so they are served as they are.
const COMPRESSIBLE_EXTENSIONS = new Set(['.html', '.js', '.mjs', '.css', '.svg', '.json', '.txt', '.xml', '.ttf']);

const MAX_COMPRESSIBLE_BYTES = 2 * 1024 * 1024;
const MAX_CACHED_FILES = 600;
const MAX_HASHED_FILE_BYTES = 512 * 1024;
const MIN_HTML_BYTES = 1024;
const MAX_CACHED_HTML = 64;

export function cacheControlFor(requestPath) {
  const extension = path.extname(String(requestPath || '')).toLowerCase();
  if (REVALIDATED_EXTENSIONS.has(extension)) return REVALIDATE;
  if (LONG_LIVED_EXTENSIONS.has(extension)) return LONG_LIVED;
  return DEFAULT_CACHE;
}

// br beats gzip when the client accepts both; q=0 means "not acceptable".
export function pickEncoding(acceptEncoding) {
  const accepted = new Map();
  for (const part of String(acceptEncoding || '').toLowerCase().split(',')) {
    const [name, ...params] = part.trim().split(';');
    if (!name) continue;
    const quality = params.map(param => param.trim()).find(param => param.startsWith('q='));
    const value = quality ? Number(quality.slice(2)) : 1;
    accepted.set(name.trim(), Number.isFinite(value) ? value : 0);
  }
  const allows = name => (accepted.has(name) ? accepted.get(name) : (accepted.get('*') ?? 0)) > 0;
  if (allows('br')) return 'br';
  if (allows('gzip')) return 'gzip';
  return null;
}

function compress(buffer, encoding) {
  return new Promise((resolve, reject) => {
    const done = (error, result) => (error ? reject(error) : resolve(result));
    if (encoding === 'br') {
      zlib.brotliCompress(buffer, { params: { [zlib.constants.BROTLI_PARAM_QUALITY]: 9, [zlib.constants.BROTLI_PARAM_SIZE_HINT]: buffer.length } }, done);
    } else if (encoding === 'gzip') {
      zlib.gzip(buffer, { level: 9 }, done);
    } else {
      resolve(buffer);
    }
  });
}

// Map with a size cap that drops the oldest entry first.
function boundedMap(limit) {
  const map = new Map();
  return {
    get: key => map.get(key),
    set(key, value) {
      map.delete(key);
      map.set(key, value);
      while (map.size > limit) map.delete(map.keys().next().value);
    },
    get size() { return map.size; },
  };
}

// Absolute path of a request path inside root, or null when it would leave the
// root, hide behind a dot segment, or is not decodable.
function resolveInside(root, requestPath) {
  let decoded;
  try { decoded = decodeURIComponent(requestPath); } catch { return null; }
  if (decoded.includes('\0') || decoded.includes('\\')) return null;
  const segments = decoded.split('/').filter(Boolean);
  if (!segments.length || segments.some(segment => segment.startsWith('.'))) return null;
  const file = path.join(root, ...segments);
  return file.startsWith(root + path.sep) ? file : null;
}

export function createStaticAssets({ root } = {}) {
  const absoluteRoot = path.resolve(root);
  const files = boundedMap(MAX_CACHED_FILES);
  const html = boundedMap(MAX_CACHED_HTML);
  const pending = new Map();
  const hashes = boundedMap(MAX_CACHED_FILES);

  // Compressed (or identity) bytes for one file, produced once per version.
  function encodedFile(file, stat, encoding) {
    const key = `${file}|${encoding || 'identity'}`;
    const cached = files.get(key);
    if (cached && cached.mtimeMs === stat.mtimeMs && cached.size === stat.size) return Promise.resolve(cached.body);
    const flight = `${key}|${stat.mtimeMs}|${stat.size}`;
    if (pending.has(flight)) return pending.get(flight);
    const work = fs.promises.readFile(file)
      .then(buffer => compress(buffer, encoding))
      .then(body => {
        files.set(key, { mtimeMs: stat.mtimeMs, size: stat.size, body });
        return body;
      })
      .finally(() => pending.delete(flight));
    pending.set(flight, work);
    return work;
  }

  // Text assets, ahead of express.static. Anything it declines falls through.
  async function compressedText(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const extension = path.extname(req.path).toLowerCase();
    if (!COMPRESSIBLE_EXTENSIONS.has(extension)) return next();
    const file = resolveInside(absoluteRoot, req.path);
    if (!file) return next();
    try {
      const stat = await fs.promises.stat(file);
      if (!stat.isFile() || stat.size > MAX_COMPRESSIBLE_BYTES) return next();
      const encoding = pickEncoding(req.headers['accept-encoding']);
      const body = await encodedFile(file, stat, encoding);
      res.vary('Accept-Encoding');
      if (encoding) res.setHeader('Content-Encoding', encoding);
      res.setHeader('Cache-Control', cacheControlFor(req.path));
      res.type(extension);
      // res.send derives the ETag from these bytes and answers 304 itself.
      return res.send(body);
    } catch {
      return next();
    }
  }

  // Weak content-hash ETag for small files express.static serves itself, so a
  // redeploy that only touches mtimes still revalidates to a 304.
  function setStaticHeaders(res, file, stat) {
    res.setHeader('Cache-Control', cacheControlFor(file));
    if (stat.size > MAX_HASHED_FILE_BYTES) return;
    const key = `${file}|${stat.mtimeMs}|${stat.size}`;
    let tag = hashes.get(key);
    if (!tag) {
      try { tag = `W/"${crypto.createHash('sha1').update(fs.readFileSync(file)).digest('base64url')}"`; } catch { return; }
      hashes.set(key, tag);
    }
    res.setHeader('ETag', tag);
  }

  // Wraps res.send so the HTML the metadata router and /about build per request
  // is compressed too. Only whole 200 HTML strings that are cacheable: the
  // no-store recovery pages and JSON stay as they are.
  function compressHtml(req, res, next) {
    if (req.method !== 'GET' && req.method !== 'HEAD') return next();
    const encoding = pickEncoding(req.headers['accept-encoding']);
    const send = res.send;
    res.send = function sendHtml(body) {
      const eligible = typeof body === 'string' && body.length >= MIN_HTML_BYTES && res.statusCode === 200
        && /^text\/html/i.test(String(res.getHeader('Content-Type') || ''))
        && !/no-store/i.test(String(res.getHeader('Cache-Control') || ''))
        && !res.getHeader('Content-Encoding');
      if (!eligible) return send.call(this, body);
      res.vary('Accept-Encoding');
      res.send = send;
      if (!encoding) return send.call(this, body);
      const key = `${encoding}|${crypto.createHash('sha1').update(body).digest('base64url')}`;
      const cached = html.get(key);
      const ready = cached ? Promise.resolve(cached) : compress(Buffer.from(body, 'utf8'), encoding).then(buffer => { html.set(key, buffer); return buffer; });
      ready.then(buffer => {
        res.setHeader('Content-Encoding', encoding);
        send.call(this, buffer);
      }, () => send.call(this, body));
      return this;
    };
    return next();
  }

  return Object.freeze({ compressedText, compressHtml, setStaticHeaders, stats: () => ({ files: files.size, html: html.size }) });
}
