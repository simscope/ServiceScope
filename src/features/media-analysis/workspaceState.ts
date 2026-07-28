import type {
  MediaAnalysisAttachmentResult,
  MediaAnalysisResult,
  MediaAnalysisStatus,
} from './contracts.js';

export type MediaReviewApprovalState = 'pending' | 'approved' | 'excluded' | 'false_positive';
export type MediaAnalysisRunStatus = 'idle' | 'pending' | 'succeeded' | 'failed';

export type MediaAnalysisWorkspaceState = {
  jobId?: string;
  status: MediaAnalysisRunStatus;
  activeRequestId?: string;
  result?: MediaAnalysisResult;
  error?: string;
  approvals: Record<string, MediaReviewApprovalState>;
};

export function createMediaAnalysisWorkspaceState(jobId?: string): MediaAnalysisWorkspaceState {
  return {
    jobId,
    status: 'idle',
    approvals: {},
  };
}

export function resetMediaAnalysisWorkspace(jobId?: string): MediaAnalysisWorkspaceState {
  return createMediaAnalysisWorkspaceState(jobId);
}

export function beginMediaAnalysisRequest(
  state: MediaAnalysisWorkspaceState,
  requestId: string,
): { state: MediaAnalysisWorkspaceState; shouldRequest: boolean } {
  if (state.status === 'pending') return { state, shouldRequest: false };
  return {
    state: {
      ...state,
      status: 'pending',
      activeRequestId: requestId,
      error: undefined,
    },
    shouldRequest: true,
  };
}

export function applyMediaAnalysisResult(
  state: MediaAnalysisWorkspaceState,
  result: MediaAnalysisResult,
  requestId: string,
  currentJobId: string,
): MediaAnalysisWorkspaceState {
  if (state.activeRequestId !== requestId || result.jobId !== currentJobId) return state;
  return {
    ...state,
    jobId: currentJobId,
    status: 'succeeded',
    activeRequestId: undefined,
    result,
    error: undefined,
    approvals: initialApprovalState(result.attachments),
  };
}

export function applyMediaAnalysisError(
  state: MediaAnalysisWorkspaceState,
  message: string,
  requestId: string,
): MediaAnalysisWorkspaceState {
  if (state.activeRequestId !== requestId) return state;
  return {
    ...state,
    status: 'failed',
    activeRequestId: undefined,
    error: message,
  };
}

export function setMediaApproval(
  state: MediaAnalysisWorkspaceState,
  attachmentId: string,
  approval: MediaReviewApprovalState,
): MediaAnalysisWorkspaceState {
  return {
    ...state,
    approvals: {
      ...state.approvals,
      [attachmentId]: approval,
    },
  };
}

export function initialApprovalState(attachments: MediaAnalysisAttachmentResult[]) {
  return attachments.reduce<Record<string, MediaReviewApprovalState>>((next, attachment) => {
    next[attachment.id] = 'pending';
    return next;
  }, {});
}

export function mediaStatusLabel(status: MediaAnalysisStatus) {
  if (status === 'metadata_only') return 'metadata only';
  if (status === 'video_analysis_not_supported_v1') return 'video analysis not supported';
  if (status === 'manual_review') return 'manual review';
  return status;
}

export function mediaStatusMessage(status: MediaAnalysisStatus, visualAnalysisPerformed: boolean) {
  if (status === 'video_analysis_not_supported_v1') return 'Video visual analysis is not supported in this version.';
  if (!visualAnalysisPerformed || status === 'metadata_only') return 'Visual analysis was not completed. Review this media manually.';
  if (status === 'failed' || status === 'manual_review') return 'Visual analysis was not accepted. Manual review is required.';
  return '';
}
