import {
  parseRenderRequest,
  reelDispatchMaxAttempts,
  reelRenderRequestMaxBytes,
  renderMessage,
  RenderJobError,
} from './contracts.js';
import { recordRenderEvent } from './telemetry.js';

export function createRenderRequestHandler({ client, publish, enabled, telemetry }) {
  return async function handle(request) {
    try {
      if (request.method !== 'POST') return json({ code: 'METHOD_NOT_ALLOWED' }, 405);
      const length = Number(request.headers.get('content-length') ?? 0);
      if (length > reelRenderRequestMaxBytes) throw new RenderJobError('INVALID_REQUEST', 400);
      const authorization = request.headers.get('authorization') ?? '';
      const session = await client.authenticate(authorization);
      const raw = await request.text();
      if (new TextEncoder().encode(raw).byteLength > reelRenderRequestMaxBytes) throw new RenderJobError('INVALID_REQUEST', 400);
      const input = parseJson(raw);
      recordRenderEvent(telemetry, 'render_requested');
      if (!enabled()) {
        recordRenderEvent(telemetry, 'render_blocked_feature_flag', { code: 'REEL_RENDER_NOT_CONFIGURED' });
        throw new RenderJobError('REEL_RENDER_NOT_CONFIGURED', 503);
      }
      const rows = await client.userRpc('begin_company_reel_render_request', {
        p_creative_plan_id: input.creativePlanId,
        p_expected_plan_revision: input.expectedPlanRevision,
      }, session.token);
      const job = Array.isArray(rows) ? rows[0] : null;
      if (!job?.render_job_id) throw new RenderJobError('REEL_RENDER_PLAN_UNAVAILABLE', 409);
      if (job.status === 'queued') {
        await publishQueuedJob(publish, job.render_job_id);
      }
      return json({ renderJobId: job.render_job_id, status: job.status, errorCode: job.error_code ?? null }, 202);
    } catch (error) {
      const status = error instanceof RenderJobError ? error.status : 500;
      const code = error instanceof RenderJobError ? error.code : 'INTERNAL_ERROR';
      return json({ code }, status);
    }
  };
}

async function publishQueuedJob(publish, renderJobId) {
  for (let attempt = 1; attempt <= reelDispatchMaxAttempts; attempt += 1) {
    try {
      await publish(renderMessage(renderJobId), renderJobId);
      return;
    } catch {
      if (attempt === reelDispatchMaxAttempts) {
        throw new RenderJobError('REEL_RENDER_DISPATCH_FAILED', 503);
      }
    }
  }
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
