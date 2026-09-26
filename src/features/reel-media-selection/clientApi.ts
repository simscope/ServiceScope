import { supabaseRpc } from '../../services/supabaseRest';
import type { ReelMediaSelectionDraftItem, ReelMediaSelectionResponse } from './contracts';

type ReelMediaSelectorRpcItem = {
  attachmentId?: string;
  attachment_id?: string;
  name: string;
  mimeType?: string;
  mime_type?: string;
  role: ReelMediaSelectionDraftItem['role'] | null;
  position: number | null;
  selectedBy?: string | null;
  selected_by?: string | null;
  selectedAt?: string | null;
  selected_at?: string | null;
  updatedAt?: string | null;
  updated_at?: string | null;
  analysisRunId?: string | null;
  analysis_run_id?: string | null;
  attachmentResultId?: string | null;
  attachment_result_id?: string | null;
  privacyState?: ReelMediaSelectionResponse['items'][number]['privacyState'];
  privacy_state?: ReelMediaSelectionResponse['items'][number]['privacyState'];
  privacyReviewStatus?: string | null;
  privacy_review_status?: string | null;
  unresolvedPrivacyCount?: number;
  unresolved_privacy_count?: number;
};

type ReelMediaSelectorRpcResponse = {
  canManage?: boolean;
  can_manage?: boolean;
  ready: boolean;
  items: ReelMediaSelectorRpcItem[];
};

export async function loadReelMediaSelection(jobId: string) {
  return normalizeResponse(await supabaseRpc<ReelMediaSelectorRpcResponse>('get_company_reel_media_selector', {
    p_job_id: jobId,
  }));
}

export async function saveReelMediaSelection(jobId: string, items: ReelMediaSelectionDraftItem[]) {
  return normalizeResponse(await supabaseRpc<ReelMediaSelectorRpcResponse>('replace_company_reel_media_selection', {
    p_job_id: jobId,
    p_items: items,
  }));
}

function normalizeResponse(value: ReelMediaSelectorRpcResponse): ReelMediaSelectionResponse {
  return {
    canManage: value.canManage ?? value.can_manage ?? false,
    ready: value.ready,
    items: (value.items ?? []).map((item) => ({
      attachmentId: item.attachmentId ?? item.attachment_id ?? '',
      name: item.name,
      mimeType: item.mimeType ?? item.mime_type ?? '',
      role: item.role,
      position: item.position,
      selectedBy: item.selectedBy ?? item.selected_by ?? null,
      selectedAt: item.selectedAt ?? item.selected_at ?? null,
      updatedAt: item.updatedAt ?? item.updated_at ?? null,
      analysisRunId: item.analysisRunId ?? item.analysis_run_id ?? null,
      attachmentResultId: item.attachmentResultId ?? item.attachment_result_id ?? null,
      privacyState: item.privacyState ?? item.privacy_state ?? 'not_analyzed',
      privacyReviewStatus: item.privacyReviewStatus ?? item.privacy_review_status ?? null,
      unresolvedPrivacyCount: Number(item.unresolvedPrivacyCount ?? item.unresolved_privacy_count ?? 0),
    })),
  };
}
