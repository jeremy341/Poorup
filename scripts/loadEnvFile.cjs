'use strict';

// Reads the host env file the way the deploy scripts do (`set -a; . file` under
// bash) for the KEY=VALUE subset that file is written in. The ecosystem file
// uses this so PM2 sees the same values the scripts see. Anything bash would
// expand, split, glob or run is rejected with its line number instead of being
// read differently: a quoted value is the fix the message suggests.

const fs = require('node:fs');

const NAME = /^[A-Za-z_][A-Za-z0-9_]*$/;
// Characters that bash expands or interprets in an unquoted assignment value.
const UNQUOTED_SPECIAL = /[$`\\'";&|<>()*?[{}~]/;
const DOUBLE_QUOTE_ESCAPES = new Set(['"', '\\', '$', '`']);

function fail(source, lineNumber, reason) {
  throw new Error(`${source}:${lineNumber}: ${reason}`);
}

function readQuoted(text, source, lineNumber) {
  const quote = text[0];
  let value = '';
  for (let index = 1; index < text.length; index += 1) {
    const character = text[index];
    if (character === quote) return { value, end: index + 1 };
    if (quote === '"' && character === '\\' && DOUBLE_QUOTE_ESCAPES.has(text[index + 1])) {
      value += text[index + 1];
      index += 1;
      continue;
    }
    if (quote === '"' && (character === '$' || character === '`')) {
      fail(source, lineNumber, 'unsupported shell expansion inside double quotes; use single quotes for a literal value');
    }
    value += character;
  }
  return fail(source, lineNumber, 'unterminated quoted value');
}

function readUnquoted(text, source, lineNumber) {
  const whitespace = text.search(/\s/);
  const end = whitespace === -1 ? text.length : whitespace;
  const value = text.slice(0, end);
  if (UNQUOTED_SPECIAL.test(value)) {
    fail(source, lineNumber, 'unsupported shell syntax in an unquoted value; quote the value');
  }
  return { value, end };
}

function parseValue(text, source, lineNumber) {
  const parsed = text[0] === '"' || text[0] === "'"
    ? readQuoted(text, source, lineNumber)
    : readUnquoted(text, source, lineNumber);
  const rest = text.slice(parsed.end);
  if (rest === '' || /^\s+#/.test(rest)) return parsed.value;
  if (text[0] === '"' || text[0] === "'") {
    fail(source, lineNumber, 'unexpected text after the closing quote');
  }
  return fail(source, lineNumber, 'unquoted value contains whitespace; quote the value');
}

function parseLine(line, source, lineNumber) {
  if (line.includes('\r')) fail(source, lineNumber, 'carriage return in the line; save the file with LF line endings');
  let text = line.replace(/^[ \t]+/, '');
  if (text === '' || text.startsWith('#')) return null;
  text = text.replace(/^export[ \t]+/, '');
  const equals = text.indexOf('=');
  if (equals < 0) fail(source, lineNumber, 'expected NAME=VALUE');
  const name = text.slice(0, equals);
  if (!NAME.test(name)) fail(source, lineNumber, `invalid variable name "${name}"`);
  return [name, parseValue(text.slice(equals + 1), source, lineNumber)];
}

function parseEnvText(text, { source = 'env file' } = {}) {
  const entries = [];
  text.split('\n').forEach((line, index) => {
    const entry = parseLine(line, source, index + 1);
    if (entry) entries.push(entry);
  });
  // fromEntries defines own properties, so a key such as __proto__ stays data.
  return Object.fromEntries(entries);
}

// A missing file is an empty environment (local development). Any other read
// failure is raised, so a permissions or path mistake cannot silently drop the
// production secrets.
function loadEnvFile(filePath) {
  let text;
  try {
    text = fs.readFileSync(filePath, 'utf8');
  } catch (error) {
    if (error?.code === 'ENOENT') return {};
    throw error;
  }
  return parseEnvText(text, { source: filePath });
}

module.exports = { loadEnvFile, parseEnvText };
