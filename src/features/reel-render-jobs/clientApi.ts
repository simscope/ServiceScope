import { getValidSupabaseAccessToken, supabaseRpc } from '../../services/supabaseRest';
import type { PersistedReelWorkspace } from './contracts';

export async function loadPersistedReelWorkspace(jobId: string) {
  const rows = await supabaseRpc<PersistedReelWorkspace[]>('get_company_reel_workspace', { p_job_id: jobId });
  const saved = rows?.[0];
  if (!saved) return null;
  const authority = await serverRequest<{
    creativePlanId: string; planRevision: string; approved: boolean;
    retryEligible: boolean; retryOfRenderJobId: string | null;
  }>('/api/reel-plan-status', {
    jobId, creativePlanId: saved.creative_plan_id, expectedPlanRevision: saved.plan_revision,
  }).catch(() => null);
  return { ...saved, approvalAuthority: authority };
}

export async function beginReelRender(creativePlanId: string, expectedPlanRevision: string, retryOfRenderJobId?: string) {
  return serverRequest<{
    renderJobId: string;
    status: 'queued' | 'rendering' | 'completed' | 'failed';
    errorCode: string | null;
    retryOfRenderJobId?: string;
    retryOrdinal?: number;
  }>(
    '/api/reel-render-request',
    { creativePlanId, expectedPlanRevision, ...(retryOfRenderJobId ? { retryOfRenderJobId } : {}) },
  );
}

export async function approveReelPlan(creativePlanId: string, expectedPlanRevision: string) {
  return serverRequest<{ creativePlanId: string; planRevision: string; approved: true }>(
    '/api/reel-plan-approve',
    { creativePlanId, expectedPlanRevision },
  );
}

export async function loadReelArtifacts(renderJobId: string) {
  return serverRequest<{ videoUrl: string; coverUrl: string; expiresAt: string }>(
    '/api/reel-render-artifacts',
    { renderJobId },
  );
}

async function serverRequest<T>(path: string, body: Record<string, unknown>): Promise<T> {
  const token = await getValidSupabaseAccessToken();
  const response = await fetch(path, {
    method: 'POST',
    headers: { Authorization: `Bearer ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(body),
  });
  const value = await response.json().catch(() => ({})) as { code?: string } & T;
  if (!response.ok) throw new Error(value.code ?? 'REEL_RENDER_FAILED');
  return value;
}
