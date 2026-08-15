import { parseRenderRequest, reelRenderRequestMaxBytes, RenderJobError } from './contracts.js';

export function createReelApprovalHandler({ client }) {
  return async function handle(request) {
    try {
      if (request.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
      const session = await client.authenticate(request.headers.get('authorization') ?? '');
      const length = Number(request.headers.get('content-length') ?? 0);
      if (length > reelRenderRequestMaxBytes) throw new RenderJobError('INVALID_REQUEST', 400);
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > reelRenderRequestMaxBytes) {
        throw new RenderJobError('INVALID_REQUEST', 400);
      }
      const input = parseJson(raw);
      const rows = await client.userRpc('approve_company_reel_creative_plan', {
        p_creative_plan_id: input.creativePlanId,
        p_expected_plan_revision: input.expectedPlanRevision,
      }, session.token);
      const approval = Array.isArray(rows) ? rows[0] : null;
      if (!approval?.creative_plan_id || approval.plan_revision !== input.expectedPlanRevision) {
        throw new RenderJobError('REEL_RENDER_PLAN_UNAVAILABLE', 409);
      }
      return json({
        creativePlanId: approval.creative_plan_id,
        planRevision: approval.plan_revision,
        approved: true,
      }, 200);
    } catch (error) {
      const status = error instanceof RenderJobError ? error.status : 500;
      const code = error instanceof RenderJobError ? error.code : 'INTERNAL_ERROR';
      return json({ code }, status);
    }
  };
}

function parseJson(raw) {
  try {
    return parseRenderRequest(JSON.parse(raw || '{}'));
  } catch {
    throw new RenderJobError('INVALID_REQUEST', 400);
  }
}

function json(body, status) {
  return Response.json(body, { status, headers: { 'Cache-Control': 'no-store' } });
}
