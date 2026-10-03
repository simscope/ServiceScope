import { parseRenderRequest, reelRenderRequestMaxBytes, RenderJobError } from './contracts.js';
import { createRenderRepository, preflightRenderRetry } from './repository.js';

export function createReelPlanStatusHandler({ client, preflight = preflightRenderRetry }) {
  return async function handle(request) {
    try {
      if (request.method !== 'POST') return Response.json({ code: 'METHOD_NOT_ALLOWED' }, { status: 405 });
      const session = await client.authenticate(request.headers.get('authorization') ?? '');
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > reelRenderRequestMaxBytes) throw new RenderJobError('INVALID_REQUEST', 400);
      let value;
      try { value = JSON.parse(raw); } catch { throw new RenderJobError('INVALID_REQUEST', 400); }
      if (!value || Object.keys(value).length !== 3 || typeof value.jobId !== 'string') throw new RenderJobError('INVALID_REQUEST', 400);
      const { jobId, ...planInput } = value;
      const input = parseRenderRequest(planInput);
      parseRenderRequest({ creativePlanId: jobId, expectedPlanRevision: input.expectedPlanRevision });
      // The user-scoped workspace RPC checks company access before any privileged lookup.
      const rows = await client.userRpc('get_company_reel_workspace', { p_job_id: jobId }, session.token);
      const workspace = rows?.[0];
      if (!workspace || workspace.creative_plan_id !== input.creativePlanId || workspace.plan_revision !== input.expectedPlanRevision) {
        throw new RenderJobError('REEL_RENDER_PLAN_UNAVAILABLE', 409);
      }
      const plans = await client.select('company_reel_creative_plans', `select=id,company_id,job_id,plan_revision&id=eq.${input.creativePlanId}&job_id=eq.${jobId}&plan_revision=eq.${encodeURIComponent(input.expectedPlanRevision)}&limit=1`);
      const plan = plans?.[0];
      if (!plan) throw new RenderJobError('REEL_RENDER_PLAN_UNAVAILABLE', 409);
      const approvals = await client.select('company_reel_creative_plan_approvals', `select=creative_plan_id&creative_plan_id=eq.${plan.id}&company_id=eq.${plan.company_id}&job_id=eq.${plan.job_id}&plan_revision=eq.${encodeURIComponent(plan.plan_revision)}&limit=1`);
      const approved = approvals?.length === 1;
      let retryEligible = false;
      if (approved && workspace.render_status === 'failed' && workspace.render_error_code === 'REEL_RENDER_CONTEXT_STALE' && workspace.render_retry_ordinal === 0) {
        try {
          const preparedRows = await client.userRpc('prepare_company_reel_render_retry', {
            p_failed_render_job_id: workspace.render_job_id, p_expected_plan_revision: plan.plan_revision,
          }, session.token);
          const prepared = preparedRows?.[0];
          if (prepared?.creative_plan_id === plan.id && prepared.company_id === plan.company_id && prepared.job_id === plan.job_id
            && prepared.failed_render_job_id === workspace.render_job_id && !prepared.retry_render_job_id) {
            await preflight(createRenderRepository(client), prepared);
            retryEligible = true;
          }
        } catch { /* A failed read-only preflight must leave retry disabled. */ }
      }
      return Response.json({ creativePlanId: plan.id, planRevision: plan.plan_revision, approved, retryEligible,
        retryOfRenderJobId: retryEligible ? workspace.render_job_id : null }, { headers: { 'Cache-Control': 'no-store' } });
    } catch (error) {
      return Response.json({ code: error instanceof RenderJobError ? error.code : 'INTERNAL_ERROR' }, {
        status: error instanceof RenderJobError ? error.status : 500, headers: { 'Cache-Control': 'no-store' },
      });
    }
  };
}
