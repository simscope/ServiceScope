import assert from 'node:assert/strict';
import { verifyQualifiedRendererImage } from './reel-qualified-image-reference.mjs';

const digest = `sha256:${'a'.repeat(64)}`;
const prefix = 'andrei-simanenkas-projects/servicescope/';
const basename = 'servicescope-reel-renderer';
let checks = 0;
for (const reference of [`${basename}@${digest}`, `${prefix}${basename}@${digest}`]) {
  assert.deepEqual(verifyQualifiedRendererImage(reference, digest), { basename, digest });
  checks++;
}
for (const reference of [
  `${prefix}${basename}@sha256:${'b'.repeat(64)}`,
  `${prefix}other-renderer@${digest}`,
  `${basename}:v2`,
  basename,
  `${basename}@sha256:${'a'.repeat(63)}`,
  `${basename}@sha256:${'g'.repeat(64)}`,
  `${basename}@${digest}extra`,
  `${basename}:v2@${digest}`,
  `/${basename}@${digest}`,
  `team//${basename}@${digest}`,
  `${basename}@${digest}\n`,
]) {
  assert.throws(() => verifyQualifiedRendererImage(reference, digest));
  checks++;
}
for (const expected of [undefined, 'a'.repeat(64), 'sha256:a', `sha256:${'b'.repeat(64)}`]) {
  assert.throws(() => verifyQualifiedRendererImage(`${basename}@${digest}`, expected));
  checks++;
}
console.log(JSON.stringify({ qualifiedImageIdentity: 'PASS', checks }));
