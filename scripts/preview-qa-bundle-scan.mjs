import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve(process.argv[2] ?? 'dist');
const assets = path.join(dist, 'assets');
const javascript = fs.readdirSync(assets)
  .filter((name) => name.endsWith('.js'))
  .map((name) => fs.readFileSync(path.join(assets, name), 'utf8'))
  .join('\n');
const browserSource = readSourceFiles(path.resolve('src'));

const previewEnabled = process.env.VITE_PREVIEW_QA_TOOLS_ENABLED === 'true';
const qaMarkers = [
  'Preview QA workspace',
  'Create QA workspace',
  'preview-qa-workspace',
  'AI_QA_',
];

for (const marker of qaMarkers) {
  if (previewEnabled) {
    assert.ok(javascript.includes(marker), `Preview bundle is missing QA marker: ${marker}`);
  } else {
    assert.equal(javascript.includes(marker), false, `Production bundle contains QA marker: ${marker}`);
  }
}

for (const forbidden of ['SUPABASE_SERVICE_ROLE_KEY', 'auth.admin', 'OPENAI_API_KEY', 'temporary-pass-']) {
  assert.equal(browserSource.includes(forbidden), false, `Browser source contains forbidden value: ${forbidden}`);
  assert.equal(javascript.includes(forbidden), false, `Browser bundle contains forbidden value: ${forbidden}`);
}
const jwtPattern = /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/;
assert.doesNotMatch(browserSource, jwtPattern);
assert.doesNotMatch(javascript, /(?:Bearer\s+|accessToken["'`]?\s*[:=]\s*["'`]|refreshToken["'`]?\s*[:=]\s*["'`])eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/i);

console.log(previewEnabled ? 'Preview QA bundle scan passed' : 'Production QA bundle exclusion scan passed');

function readSourceFiles(directory) {
  return fs.readdirSync(directory, { withFileTypes: true })
    .flatMap((entry) => {
      const entryPath = path.join(directory, entry.name);
      if (entry.isDirectory()) return [readSourceFiles(entryPath)];
      return /\.(?:js|jsx|ts|tsx)$/.test(entry.name) ? [fs.readFileSync(entryPath, 'utf8')] : [];
    })
    .join('\n');
}
