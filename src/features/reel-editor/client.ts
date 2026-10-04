import { getValidSupabaseAccessToken, supabaseRpc } from '../../services/supabaseRest';
import { beginReelRender, loadReelArtifacts } from '../reel-render-jobs/clientApi';
import type { EditorBackend, EditorDraft } from './types';
export function editorBackend(jobId: string): EditorBackend {
  async function call(operation: string, extra: Record<string, unknown> = {}) {
    const token = await getValidSupabaseAccessToken();
    const response = await fetch('/api/reel-editor', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` }, body: JSON.stringify({ operation, jobId, ...extra }) });
    const value = await response.json(); if (!response.ok) throw new Error(value.code || 'EDITOR_SERVICE_UNAVAILABLE'); return value;
  }
  return { load: async () => {
    const result = await call('load');
    if (result.row?.approval) {
      const rows = await supabaseRpc<Array<{ creative_plan_id: string; render_job_id: string; render_status: string }>>('get_company_reel_workspace', { p_job_id: jobId });
      const current = rows?.[0];
      if (current?.creative_plan_id === result.row.approval.creativePlanId && current.render_job_id) {
        const artifacts = current.render_status === 'completed' ? await loadReelArtifacts(current.render_job_id) : null;
        result.render = { status: current.render_status, videoUrl: artifacts?.videoUrl, renderJobId: current.render_job_id };
      }
    }
    return result;
  }, save: (draft: EditorDraft, expectedRevision, confirmBrief) => call('save', { draft, expectedRevision, confirmBrief }),
    approve: expectedRevision => call('approve', { expectedRevision }), render: approval => beginReelRender(approval.creativePlanId, approval.revision) };
}
