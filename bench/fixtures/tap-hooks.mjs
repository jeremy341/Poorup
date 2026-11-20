// Node ESM loader hook: wraps every `export function name(` of the modules listed in
// POORUP_TAP_MODULES so capture.mjs can record real (args -> result) pairs.
// Reassigning a function declaration inside its own module updates the live export binding,
// so internal and cross-module calls are all recorded.
export async function load(url, context, nextLoad) {
  const result = await nextLoad(url, context);
  if (!url.startsWith('file:') || result.format !== 'module' || result.source == null) return result;
  const base = url.split('/').pop().replace(/\.js$/, '');
  const targets = JSON.parse(process.env.POORUP_TAP_MODULES || '[]');
  if (!targets.includes(base)) return result;
  const source = result.source.toString();
  const names = [...source.matchAll(/^export function (\w+)\s*\(/gm)].map(match => match[1]);
  const tail = names
    .map(name => `try { ${name} = globalThis.__poorupTap(${name}, ${JSON.stringify(base)}, ${JSON.stringify(name)}); } catch {}`)
    .join('\n');
  return { ...result, source: `${source}\n${tail}\n` };
}
