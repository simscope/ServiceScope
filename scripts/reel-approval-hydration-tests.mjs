import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { pathToFileURL } from 'node:url';
import { createReelPlanStatusHandler } from '../server/reel-render-jobs/planStatus.js';

const require = createRequire(process.env.REEL_TEST_DEPENDENCY_ROOT
  ? `${process.env.REEL_TEST_DEPENDENCY_ROOT}/package.json` : import.meta.url);
const ts = require('typescript');
const stateFile = new URL('../src/features/reel-director/reelState.ts', import.meta.url);
const source = (await readFile(stateFile, 'utf8')).replace("'./requestIdentity.js'", JSON.stringify(pathToFileURL(new URL('./requestIdentity.js', stateFile).pathname.replace(/^\/(?=[A-Za-z]:)/, '')).href));
const compiled = ts.transpileModule(source, { compilerOptions: { target: ts.ScriptTarget.ES2022, module: ts.ModuleKind.ES2022 } }).outputText;
const state = await import(`data:text/javascript;base64,${Buffer.from(compiled).toString('base64')}`);
const planId = '11111111-1111-4111-8111-111111111111';
const jobId = '22222222-2222-4222-8222-222222222222';
const parentId = '33333333-3333-4333-8333-333333333333';
let approved = true;
let retryExists = false;
let denied = false;
let stale = false;
const calls = [];
const workspace = { creative_plan_id: planId, plan_revision: 'reel-v1-test', render_job_id: parentId,
  render_status: 'failed', render_error_code: 'REEL_RENDER_CONTEXT_STALE', render_retry_ordinal: 0 };
const client = {
  authenticate: async () => ({ token: 'test-session' }),
  userRpc: async (name) => {
    calls.push(name);
    if (name === 'get_company_reel_workspace') return denied ? [] : [workspace];
    if (name === 'prepare_company_reel_render_retry') return [{ failed_render_job_id: parentId,
      creative_plan_id: planId, company_id: 'company', job_id: jobId, retry_render_job_id: retryExists ? 'existing' : null }];
    throw new Error(`Unexpected mutating RPC ${name}`);
  },
  select: async (table) => table === 'company_reel_creative_plans'
    ? [{ id: planId, company_id: 'company', job_id: jobId, plan_revision: workspace.plan_revision }]
    : approved ? [{ creative_plan_id: planId }] : [],
};
const handler = createReelPlanStatusHandler({ client, preflight: async () => { if (stale) throw new Error('stale'); } });
const request = () => new Request('https://example.test/api/reel-plan-status', { method: 'POST',
  body: JSON.stringify({ jobId, creativePlanId: planId, expectedPlanRevision: workspace.plan_revision }) });
const authority = await (await handler(request())).json();
assert.equal(authority.approved, true);
assert.equal(authority.retryEligible, true);
for (const revision of ['initial-client-load', 'selection-loaded', 'voice-loaded']) {
  const hydrated = { status: 'reel_ready', creativePlanId: planId, plan: { revision: workspace.plan_revision },
    inputRevision: workspace.plan_revision, persistedApproval: authority, error: '' };
  assert.equal(state.isCurrentReelApproved(state.reconcileReelApproval(hydrated, revision), revision), true);
  const failed = { status: 'failed', errorCode: 'REEL_RENDER_CONTEXT_STALE', renderJobId: parentId };
  assert.equal(state.canRetryPersistedReel(hydrated, revision, failed), true);
  assert.equal(state.canRetryPersistedReel({ ...hydrated, persistedApproval: { ...authority, approved: false } }, revision, failed), false);
  assert.equal(state.canRetryPersistedReel(hydrated, revision, { ...failed, renderJobId: jobId }), false);
  assert.equal(state.canRetryPersistedReel(hydrated, revision, { ...failed, status: 'rendering' }), false);
  assert.equal(state.isCurrentReelApproved({ ...hydrated, creativePlanId: jobId }, revision), false);
  assert.equal(state.isCurrentReelApproved({ ...hydrated, plan: { revision: 'other' } }, revision), false);
}
assert.equal((await (await handler(request())).json()).approved, true);
approved = false;
let result = await (await handler(request())).json();
assert.equal(result.approved, false);
assert.equal(result.retryEligible, false);
approved = true;
retryExists = true;
assert.equal((await (await handler(request())).json()).retryEligible, false);
retryExists = false;
stale = true;
assert.equal((await (await handler(request())).json()).retryEligible, false);
denied = true;
assert.equal((await handler(request())).status, 409);
assert(calls.every((name) => ['get_company_reel_workspace', 'prepare_company_reel_render_retry'].includes(name)));
console.log('PASS: approval hydration/reload, exact identity, no duplicate approval, historical stale render, read-only eligibility, unapproved/existing retry/stale/unauthorized fail closed');
