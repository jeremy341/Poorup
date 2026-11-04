import assert from 'node:assert/strict';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import os from 'node:os';
import path from 'node:path';

// The ecosystem file and the deploy scripts must read the host env file the
// same way: the scripts `source` it under bash, the ecosystem parses it here.
const require = createRequire(import.meta.url);
const { loadEnvFile, parseEnvText } = require('./loadEnvFile.cjs');

const parse = text => parseEnvText(text, { source: 'poorup.env' });

// Plain values and the three quoting forms bash accepts.
assert.deepEqual(parse('POORUP_RELEASE_ID=abc123\n'), { POORUP_RELEASE_ID: 'abc123' });
assert.deepEqual(parse('POORUP_ALLOWED_ORIGINS="https://poorup.tech"\n'), { POORUP_ALLOWED_ORIGINS: 'https://poorup.tech' });
assert.deepEqual(parse("POORUP_NOTE='a b  c'\n"), { POORUP_NOTE: 'a b  c' });
assert.deepEqual(parse('EMPTY=\nEMPTY_QUOTED=""\n'), { EMPTY: '', EMPTY_QUOTED: '' });
assert.deepEqual(parse('QUOTED="say \\"hi\\" \\\\ done"\n'), { QUOTED: 'say "hi" \\ done' });
assert.deepEqual(parse("LITERAL='back\\slash \"kept\"'\n"), { LITERAL: 'back\\slash "kept"' });

// `export` is accepted (bash `source` runs it as a no-op assignment marker).
assert.deepEqual(parse('export POORUP_MAINTENANCE_TOKEN=secret-token\n'), { POORUP_MAINTENANCE_TOKEN: 'secret-token' });
assert.deepEqual(parse('export\tPOORUP_X="1"\n'), { POORUP_X: '1' });

// A comment starts at a word boundary; `#` inside a word is part of the value.
assert.deepEqual(parse('POORUP_TRUST_PROXY_HOPS=1 # behind Caddy\n'), { POORUP_TRUST_PROXY_HOPS: '1' });
assert.deepEqual(parse('POORUP_TRUST_PROXY_HOPS=1\t# behind Caddy\n'), { POORUP_TRUST_PROXY_HOPS: '1' });
assert.deepEqual(parse('POORUP_HASHED=abc#def\n'), { POORUP_HASHED: 'abc#def' });
assert.deepEqual(parse('POORUP_HASH_VALUE=#leading\n'), { POORUP_HASH_VALUE: '#leading' });
assert.deepEqual(parse('POORUP_IN_QUOTES="x # y"\n'), { POORUP_IN_QUOTES: 'x # y' });
assert.deepEqual(parse('POORUP_EMPTY_COMMENT= # nothing here\n'), { POORUP_EMPTY_COMMENT: '' });

// Blank lines, indented comments and indented assignments are skipped or read.
assert.deepEqual(parse('\n   # note\n\n   POORUP_INDENTED=ok\n'), { POORUP_INDENTED: 'ok' });

// Later assignments win, as they do under bash.
assert.deepEqual(parse('A=1\nA=2\n'), { A: '2' });

// `__proto__` is an ordinary key and must not change the result's prototype.
const withProtoKey = parse('__proto__=value\n');
assert.equal(Object.getPrototypeOf(withProtoKey), Object.prototype);
assert.equal(Object.hasOwn(withProtoKey, '__proto__'), true);

// Anything bash would expand, split, glob or run is rejected with its line
// number, so the two readers can never disagree silently.
const rejected = [
  ['POORUP_X=$HOME', /unsupported/],
  ['POORUP_X="$HOME"', /unsupported/],
  ['POORUP_X=`whoami`', /unsupported/],
  ['POORUP_X=a b', /whitespace/],
  ['POORUP_X=a;b', /unsupported/],
  ['POORUP_X=a&', /unsupported/],
  ['POORUP_X=a*', /unsupported/],
  ['POORUP_X=https://x.example/?a=1', /unsupported/],
  ['POORUP_X=~/secret', /unsupported/],
  ['POORUP_X = value', /variable name/],
  ['1BAD=value', /variable name/],
  ['POORUP_X="unterminated', /unterminated/],
  ["POORUP_X='unterminated", /unterminated/],
  ['POORUP_X="a"b', /after the closing quote/],
  ['POORUP_X=a\r', /carriage return/],
  ['POORUP_X', /NAME=VALUE/],
  ['export POORUP_X', /NAME=VALUE/]
];
for (const [line, pattern] of rejected) {
  assert.throws(() => parse(`OK=1\n${line}\n`), error => {
    assert.match(error.message, pattern, `line ${JSON.stringify(line)} rejected for the wrong reason`);
    assert.match(error.message, /poorup\.env:2:/, `line ${JSON.stringify(line)} reports its line number`);
    return true;
  });
}

// File loading: a missing file is an empty environment (local development),
// any other read failure is loud.
const scratch = mkdtempSync(path.join(os.tmpdir(), 'poorup-env-'));
try {
  assert.deepEqual(loadEnvFile(path.join(scratch, 'absent.env')), {});

  const envFile = path.join(scratch, 'poorup.env');
  writeFileSync(envFile, 'POORUP_ALLOWED_ORIGINS="https://poorup.tech"\nPOORUP_TRUST_PROXY_HOPS=1 # note\n');
  assert.deepEqual(loadEnvFile(envFile), {
    POORUP_ALLOWED_ORIGINS: 'https://poorup.tech',
    POORUP_TRUST_PROXY_HOPS: '1'
  });

  const badFile = path.join(scratch, 'bad.env');
  writeFileSync(badFile, 'POORUP_X=$HOME\n');
  assert.throws(() => loadEnvFile(badFile), /bad\.env:1: .*unsupported/);

  // A directory is present but not readable as a file: that must not look like
  // an empty environment.
  assert.throws(() => loadEnvFile(scratch), error => error.code !== 'ENOENT');
} finally {
  rmSync(scratch, { recursive: true, force: true });
}

// The PM2 ecosystem must hand the app the same values the deploy scripts see.
// Before the loader existed, quotes reached the app verbatim (CORS assert crash loop),
// an inline comment turned TRUST_PROXY_HOPS into NaN and `export` lines were
// dropped (maintenance endpoint 404).
const ecosystemScratch = mkdtempSync(path.join(os.tmpdir(), 'poorup-ecosystem-env-'));
const previousSharedEnv = process.env.POORUP_SHARED_ENV_FILE;
try {
  const sharedEnv = path.join(ecosystemScratch, 'poorup.env');
  writeFileSync(sharedEnv, [
    'POORUP_ALLOWED_ORIGINS="https://poorup.tech"',
    'POORUP_TRUST_PROXY_HOPS=1 # behind Caddy',
    'export POORUP_MAINTENANCE_TOKEN=test-token',
    ''
  ].join('\n'));
  process.env.POORUP_SHARED_ENV_FILE = sharedEnv;
  const ecosystem = require('../ecosystem.config.cjs');
  const env = ecosystem.apps[0].env;
  assert.equal(env.NODE_ENV, 'production');
  assert.equal(env.POORUP_ALLOWED_ORIGINS, 'https://poorup.tech');
  assert.equal(env.POORUP_TRUST_PROXY_HOPS, '1');
  assert.equal(env.POORUP_MAINTENANCE_TOKEN, 'test-token');
} finally {
  if (previousSharedEnv === undefined) delete process.env.POORUP_SHARED_ENV_FILE;
  else process.env.POORUP_SHARED_ENV_FILE = previousSharedEnv;
  rmSync(ecosystemScratch, { recursive: true, force: true });
}

console.log('loadEnvFile: bash-compatible KEY=VALUE parsing, rejections, read errors and ecosystem env pass');
