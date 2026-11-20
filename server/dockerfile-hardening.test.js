// Image hardening: the base must be an immutable digest (a tag can be re-pointed under the build), the runtime user must not be root, and no
// secret-looking variable may carry a value into an image layer. Operator secrets arrive at run time from the host env file.
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const dockerfile = readFileSync(path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'Dockerfile'), 'utf8');

test('the base image is pinned by digest, not a floating tag', () => {
  assert.match(dockerfile, /^FROM node:22-bookworm-slim@sha256:[a-f0-9]{64}$/m);
});

test('the image runs as the unprivileged node user and never switches back to root', () => {
  assert.match(dockerfile, /^USER node$/m);
  assert.doesNotMatch(dockerfile, /^USER (root|0)\b/m);
});

test('no secret-looking variable is baked into an image layer', () => {
  const baked = dockerfile.split('\n').filter(line => /^(ENV|ARG)\s+\S*(PASSWORD|SECRET|TOKEN|API_KEY|PRIVATE_KEY)\S*=\S/i.test(line));
  assert.deepEqual(baked, []);
});
