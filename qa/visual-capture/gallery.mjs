import { mkdir, readdir, readFile, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { captureCatalog } from './catalog.mjs';

function escapeHtml(value) {
  return String(value).replace(/[&<>"']/g, character => ({
    '&': '&amp;',
    '<': '&lt;',
    '>': '&gt;',
    '"': '&quot;',
    "'": '&#39;',
  })[character]);
}

function expectedEntries(profiles, entries) {
  const catalog = entries || captureCatalog.flatMap(suite => suite.surfaceIds.map(surfaceId => ({
    group: suite.group,
    surfaceId,
    label: surfaceId.replaceAll('-', ' '),
  })));
  if (catalog.some(entry => entry.profileId)) {
    const profilesById = new Map(profiles.map(profile => [profile.id, profile]));
    return catalog.map(entry => {
      const profile = profilesById.get(entry.profileId);
      if (!profile) throw new Error(`Expected capture references unknown viewport ${entry.profileId}.`);
      return {
        ...entry,
        width: entry.width || profile.width,
        height: entry.height || profile.height,
        deviceScaleFactor: entry.deviceScaleFactor || profile.deviceScaleFactor || 1,
        aliases: entry.aliases || profile.aliases || [],
        key: `${entry.profileId}/${entry.group}/${entry.surfaceId}`,
        relativePath: `${entry.profileId}/${entry.group}/${entry.surfaceId}.png`,
      };
    });
  }
  return profiles.flatMap(profile => catalog.map(entry => ({
    profileId: profile.id,
    width: profile.width,
    height: profile.height,
    deviceScaleFactor: profile.deviceScaleFactor || 1,
    aliases: profile.aliases || [],
    group: entry.group,
    surfaceId: entry.surfaceId,
    label: entry.label || entry.surfaceId.replaceAll('-', ' '),
    key: `${profile.id}/${entry.group}/${entry.surfaceId}`,
    relativePath: `${profile.id}/${entry.group}/${entry.surfaceId}.png`,
  })));
}

async function readCaptureRecords(outputDir) {
  const recordDirectory = path.join(outputDir, '.records');
  let names;
  try {
    names = await readdir(recordDirectory);
  } catch (error) {
    if (error.code === 'ENOENT') return [];
    throw error;
  }

  const records = [];
  for (const name of names.filter(value => value.endsWith('.jsonl')).sort()) {
    const contents = await readFile(path.join(recordDirectory, name), 'utf8');
    for (const line of contents.split(/\r?\n/).filter(Boolean)) records.push(JSON.parse(line));
  }
  return records;
}

function galleryHtml(manifest) {
  const profileGroups = new Map();
  for (const capture of manifest.captures) {
    const profileLabel = `${capture.profileId} · ${capture.width}×${capture.height}`;
    if (!profileGroups.has(profileLabel)) profileGroups.set(profileLabel, new Map());
    const groups = profileGroups.get(profileLabel);
    if (!groups.has(capture.group)) groups.set(capture.group, []);
    groups.get(capture.group).push(capture);
  }

  const sections = [...profileGroups.entries()].map(([profile, groups]) => `
    <section class="profile" aria-labelledby="${escapeHtml(profile)}">
      <h2 id="${escapeHtml(profile)}">${escapeHtml(profile)}</h2>
      ${[...groups.entries()].map(([group, captures]) => `
        <section class="group" aria-labelledby="${escapeHtml(`${profile}-${group}`)}">
          <h3 id="${escapeHtml(`${profile}-${group}`)}">${escapeHtml(group)}</h3>
          <div class="grid">${captures.map(capture => `
            <article class="capture ${escapeHtml(capture.status)}">
              <h4>${escapeHtml(capture.label)}</h4>
              ${capture.relativePath
                ? `<a href="./${escapeHtml(capture.relativePath)}"><img src="./${escapeHtml(capture.relativePath)}" alt="Screenshot: ${escapeHtml(capture.label)} at ${escapeHtml(profile)}"></a>`
                : '<p class="missing">Capture missing</p>'}
              <p class="meta">${escapeHtml(capture.status)} · ${escapeHtml(capture.surfaceId)}</p>
            </article>`).join('')}
          </div>
        </section>`).join('')}
    </section>`).join('');

  return `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width, initial-scale=1">
  <title>Poorup visual capture gallery</title>
  <style>
    :root { color-scheme: dark; font: 16px/1.5 system-ui, sans-serif; background: #071013; color: #f2e7c8; }
    body { margin: 0; padding: 24px; }
    header, .profile { max-width: 1500px; margin: 0 auto 24px; }
    header, .capture { border: 1px solid #705d32; background: #0c191b; }
    header { padding: 16px 20px; }
    h1, h2, h3, h4, p { margin: 0; }
    .summary { display: flex; flex-wrap: wrap; gap: 8px 18px; margin-top: 8px; color: #c8b98c; }
    .profile { border-top: 1px solid #554728; padding-top: 14px; }
    .group { margin-top: 14px; }
    .grid { display: grid; grid-template-columns: repeat(auto-fill, minmax(min(100%, 320px), 1fr)); gap: 12px; margin-top: 8px; }
    .capture { min-width: 0; padding: 10px; }
    .capture h4 { text-transform: capitalize; margin-bottom: 8px; }
    .capture img { display: block; width: 100%; height: auto; border: 1px solid #3a453d; background: #03090b; }
    .meta { margin-top: 6px; color: #c8b98c; font-size: 12px; }
    .missing, .failed { color: #ff9387; }
    a:focus-visible { outline: 3px solid #f5d584; outline-offset: 3px; }
    @media (max-width: 600px) { body { padding: 12px; } }
  </style>
</head>
<body>
  <header>
    <h1>Poorup visual capture gallery</h1>
    <p>Run ${escapeHtml(manifest.runId)} · source ${escapeHtml(manifest.source.branch)} @ ${escapeHtml(manifest.source.commit)}</p>
    <div class="summary"><span>${manifest.summary.captured}/${manifest.summary.expected} captured</span><span>${manifest.summary.missing} missing</span><span>${manifest.summary.duplicates} duplicates</span><span>${manifest.summary.failed} failures</span></div>
  </header>
  <main>${sections}</main>
</body>
</html>`;
}

export async function buildGallery({
  outputDir,
  profiles,
  expectedCaptures: requestedExpectedCaptures,
  source = {},
  failures = [],
  runId = path.basename(path.resolve(outputDir)),
}) {
  const resolvedOutputDir = path.resolve(outputDir);
  const expected = expectedEntries(profiles, requestedExpectedCaptures);
  const records = await readCaptureRecords(resolvedOutputDir);
  const expectedKeys = new Set(expected.map(entry => entry.key));
  const recordGroups = new Map();
  for (const record of records) {
    const key = `${record.profileId}/${record.group}/${record.surfaceId}`;
    if (!recordGroups.has(key)) recordGroups.set(key, []);
    recordGroups.get(key).push(record);
  }

  const missing = [];
  const duplicates = [];
  const captures = [];
  for (const entry of expected) {
    const candidates = recordGroups.get(entry.key) || [];
    if (candidates.length > 1) duplicates.push(entry.key);
    const record = candidates[0];
    let fileExists = false;
    if (record?.relativePath) {
      try {
        fileExists = (await stat(path.join(resolvedOutputDir, record.relativePath))).isFile();
      } catch (error) {
        if (error.code !== 'ENOENT') throw error;
      }
    }
    const status = record && fileExists ? 'captured' : 'missing';
    if (status === 'missing') missing.push(entry.key);
    captures.push({
      ...entry,
      relativePath: fileExists ? record.relativePath : null,
      browser: record?.browser || null,
      browserVersion: record?.browserVersion || null,
      fixtureId: record?.fixtureId || null,
      capturedAt: record?.capturedAt || null,
      status,
    });
  }

  const unexpected = records.map(record => `${record.profileId}/${record.group}/${record.surfaceId}`)
    .filter(key => !expectedKeys.has(key));
  const summary = {
    expected: expected.length,
    captured: captures.filter(capture => capture.status === 'captured').length,
    missing: missing.length,
    duplicates: duplicates.length,
    failed: failures.length + unexpected.length,
  };
  const manifest = {
    schemaVersion: 1,
    runId,
    createdAt: new Date().toISOString(),
    source: {
      branch: source.branch || 'unknown',
      commit: source.commit || 'unknown',
      dirty: Boolean(source.dirty),
    },
    profiles: profiles.map(profile => ({
      id: profile.id,
      width: profile.width,
      height: profile.height,
      deviceScaleFactor: profile.deviceScaleFactor || 1,
      aliases: profile.aliases || [],
      supported: profile.supported !== false,
    })),
    summary,
    failures,
    unexpected,
    missing,
    duplicates,
    captures,
  };

  await mkdir(resolvedOutputDir, { recursive: true });
  await writeFile(path.join(resolvedOutputDir, 'manifest.json'), `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');
  await writeFile(path.join(resolvedOutputDir, 'index.html'), galleryHtml(manifest), 'utf8');
  return manifest;
}
