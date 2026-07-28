import assert from 'node:assert/strict';
import fs from 'node:fs';
import path from 'node:path';

const dist = path.resolve(process.argv[2] ?? 'dist');
const assets = path.join(dist, 'assets');
const javascript = fs.readdirSync(assets)
  .filter((name) => name.endsWith('.js'))
  .map((name) => fs.readFileSync(path.join(assets, name), 'utf8'))
  .join('\n');

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
  assert.equal(javascript.includes(forbidden), false, `Browser bundle contains forbidden value: ${forbidden}`);
}
assert.doesNotMatch(javascript, /eyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}/);

console.log(previewEnabled ? 'Preview QA bundle scan passed' : 'Production QA bundle exclusion scan passed');
