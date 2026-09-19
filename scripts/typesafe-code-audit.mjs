// TypeSafe code-audit runner (read-only on source files).
// Reads source chunks, asks Jev for typed judgments, writes JSON report elsewhere.
// Usage:
//   $env:TYPESAFE_API_KEY='...'
//   node scripts/typesafe-code-audit.mjs --files server/gameLogic.js,server/rentApi.js --chunkChars 12000 --minNoul 0.8
import { readFileSync, writeFileSync, mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { TypeSafeClient, noul, choice, score } from '@typesafe-ai/sdk';

function arg(name, def) {
  const i = process.argv.indexOf(`--${name}`);
  if (i === -1) return def;
  return process.argv[i + 1] ?? def;
}

const filesArg = arg('files', 'server/gameLogic.js,server/rentApi.js,server/propertyApi.js,server/tradeApi.js');
const chunkChars = Number(arg('chunkChars', '12000'));
const minNoul = Number(arg('minNoul', '0.8'));
const model = arg('model', 'jev-latest');
const out = resolve(arg('out', 'C:/Users/jerem/AppData/Local/Temp/opencode/typesafe-audit.json'));

if (!process.env.TYPESAFE_API_KEY) {
  console.error('TYPESAFE_API_KEY is not set.');
  process.exit(1);
}

const files = filesArg.split(',').map((s) => s.trim()).filter(Boolean);
const client = new TypeSafeClient();

const QUESTIONS = {
  has_bug: noul('Does this code chunk contain a concrete bug: wrong logic, balance exploit, missing validation, race, auth bypass, or money duplication? Do not flag style.'),
  category: choice('What best describes the single most likely issue?', {
    logic: 'Wrong control flow, off-by-one, state corruption, turn/order bug',
    balance: 'Rent/pricing/payout tuning that enables snowballing or dead economy',
    validation: 'Missing bounds/type/ownership/turn checks on untrusted input',
    concurrency: 'Race, double-settle, timer/ordering hazard',
    security: 'Auth bypass, privilege escalation, information leak',
    economy: 'Money duplication, fee bypass, settlement mismatch',
    not_bug: 'No concrete issue',
  }),
  severity: score('How severe is the most likely issue?', [
    'No issue or cosmetic only',
    'Minor edge case, limited impact',
    'Major: breaks a round, corrupts state, or gives large unfair advantage',
    'Critical: money duplication, auth bypass, data loss, or game-breaking exploit',
  ]),
};

function chunkText(text, max) {
  const lines = text.split('\n');
  const chunks = [];
  let cur = [];
  let len = 0;
  for (const line of lines) {
    cur.push(line);
    len += line.length + 1;
    if (len >= max) {
      chunks.push(cur.join('\n'));
      cur = [];
      len = 0;
    }
  }
  if (cur.length) chunks.push(cur.join('\n'));
  return chunks;
}

const findings = [];
for (const file of files) {
  const abs = resolve(file);
  let text;
  try {
    text = readFileSync(abs, 'utf8');
  } catch (e) {
    console.error(`skip ${file}: ${e.message}`);
    continue;
  }
  const chunks = chunkText(text, chunkChars);
  console.log(`${file}: ${text.length} chars -> ${chunks.length} chunk(s)`);
  for (let idx = 0; idx < chunks.length; idx++) {
    const chunk = chunks[idx];
    try {
      const res = await client.systemOne({
        state: { file, chunk_index: idx, chunk_total: chunks.length, code: chunk.slice(0, chunkChars) },
        questions: QUESTIONS,
        model,
      });
      const a = res.answers;
      const p = a.has_bug?.noul ?? 0;
      if (p >= minNoul && a.category?.choice !== 'not_bug') {
        findings.push({
          file, chunk_index: idx,
          has_bug: p,
          category: a.category.choice,
          category_probs: a.category.probabilities,
          category_conf: a.category.confidence,
          severity: a.severity.score,
          severity_conf: a.severity.confidence,
          usage: res.usage,
        });
        console.log(`  chunk ${idx}: FLAG p=${p.toFixed(2)} cat=${a.category.choice} sev=${a.severity.score.toFixed(2)}`);
      } else {
        console.log(`  chunk ${idx}: ok p=${p.toFixed(2)} cat=${a.category?.choice}`);
      }
    } catch (e) {
      console.error(`  chunk ${idx}: ERROR ${e.message}`);
    }
  }
}

findings.sort((x, y) => y.severity - x.severity || y.has_bug - x.has_bug);
mkdirSync(dirname(out), { recursive: true });
writeFileSync(out, JSON.stringify({ model, minNoul, files, findings }, null, 2));
console.log(`\n${findings.length} flagged chunk(s). Report: ${out}`);
