import type { AssistantLocalFacts, AssistantMediaItem, AssistantMediaLabel } from '../ai-assistant/assistantModel';
import type { MediaAnalysisResult } from '../media-analysis/contracts';
import type { MediaPlanningState } from '../media-planning/planningState';
import type { ReelCreativePlanV1, ReelMediaPlanItem } from './contracts';

export type ReelGenerationStatus =
  | 'ready'
  | 'analyzing'
  | 'creating_story'
  | 'reel_ready'
  | 'needs_more_media'
  | 'skip'
  | 'privacy_review_required'
  | 'failed';

export type ReelWorkspaceState = {
  jobId?: string;
  status: ReelGenerationStatus;
  plan?: ReelCreativePlanV1;
  inputRevision?: string;
  approvedRevision?: string;
  approvalInvalidated?: boolean;
  error: string;
};

export function createReelWorkspaceState(jobId?: string): ReelWorkspaceState {
  return { jobId, status: 'ready', error: '' };
}

export function reelMediaPlan(
  media: AssistantMediaItem[],
  planning: MediaPlanningState,
  excludedAttachmentIds: readonly string[] = [],
): ReelMediaPlanItem[] {
  const excluded = new Set(excludedAttachmentIds);
  const selectedPhotos = media
    .filter((item) => !excluded.has(item.id) && item.selected && item.kind === 'photo' && ['image/jpeg', 'image/png', 'image/webp'].includes(item.mimeType.toLowerCase()))
    .sort((left, right) => left.order - right.order || left.id.localeCompare(right.id));
  const selectedById = new Map(selectedPhotos.map((item) => [item.id, item]));
  const manualSelection = planning.manualOrder
    ? planning.orderedAttachmentIds.flatMap((id) => selectedById.has(id) ? [selectedById.get(id)!] : [])
    : [];
  const candidates = manualSelection.length ? manualSelection : selectedPhotos;
  const bounded = candidates.length <= 4
    ? candidates
    : [...candidates].sort((left, right) => (
        mediaLabelPriority(left.label) - mediaLabelPriority(right.label)
        || left.order - right.order
        || left.id.localeCompare(right.id)
      )).slice(0, 4);
  return bounded.map((item, index) => ({ attachmentId: item.id, position: index + 1 }));
}

export function reelInputRevision(input: {
  jobId?: string;
  localFacts: AssistantLocalFacts;
  media: AssistantMediaItem[];
  planning: MediaPlanningState;
  analysis?: MediaAnalysisResult;
  excludedAttachmentIds?: readonly string[];
  companyVoiceRevision: string;
}) {
  return stableFingerprint({
    jobId: input.jobId,
    localFacts: input.localFacts,
    planningRevision: input.planning.revision,
    planningResultRevision: input.planning.resultRevision,
    media: reelMediaPlan(input.media, input.planning, input.excludedAttachmentIds),
    analysisVersion: input.analysis?.analysisVersion,
    analysisAuthority: input.analysis?.attachments.map((attachment) => [
      attachment.id,
      attachment.analysisRunId,
      attachment.attachmentResultId,
      attachment.status,
    ]),
    companyVoiceRevision: input.companyVoiceRevision,
  });
}

export function applyReelPlan(state: ReelWorkspaceState, plan: ReelCreativePlanV1, inputRevision: string) {
  return {
    ...state,
    status: plan.decision === 'create_reel'
      ? 'reel_ready' as const
      : plan.decision === 'needs_more_media'
        ? 'needs_more_media' as const
        : 'skip' as const,
    plan,
    inputRevision,
    approvedRevision: undefined,
    approvalInvalidated: Boolean(state.approvedRevision || state.approvalInvalidated),
    error: '',
  };
}

export function approveCurrentReel(state: ReelWorkspaceState, currentInputRevision: string) {
  if (state.status !== 'reel_ready' || !state.plan || state.inputRevision !== currentInputRevision) return state;
  return { ...state, approvedRevision: state.plan.revision, approvalInvalidated: false };
}

export function reconcileReelApproval(state: ReelWorkspaceState, currentInputRevision: string) {
  if (!state.approvedRevision || state.inputRevision === currentInputRevision) return state;
  return { ...state, approvedRevision: undefined, approvalInvalidated: true };
}

export function isCurrentReelApproved(state: ReelWorkspaceState, currentInputRevision: string) {
  return Boolean(state.plan && state.approvedRevision === state.plan.revision && state.inputRevision === currentInputRevision);
}

export function reelStatusLabel(status: ReelGenerationStatus) {
  if (status === 'analyzing') return 'Analyzing safe media';
  if (status === 'creating_story') return 'Creating story';
  if (status === 'reel_ready') return 'Reel ready';
  if (status === 'needs_more_media') return 'Needs more media';
  if (status === 'skip') return 'Not worth publishing';
  if (status === 'privacy_review_required') return 'Privacy review required';
  if (status === 'failed') return 'Generation failed';
  return 'Ready';
}

export function hasCurrentReelAnalysis(result: MediaAnalysisResult | undefined, mediaPlan: ReelMediaPlanItem[]) {
  if (!result || result.safety.ok === false) return false;
  const attachmentById = new Map(result.attachments.map((attachment) => [attachment.id, attachment]));
  return mediaPlan.length > 0 && mediaPlan.every((item) => {
    const attachment = attachmentById.get(item.attachmentId);
    return attachment?.kind === 'photo'
      && attachment.status === 'analyzed'
      && Boolean(attachment.analysisRunId)
      && Boolean(attachment.attachmentResultId);
  });
}

export function isReelAnalysisRefreshError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return hasExactReelErrorCode(message, 'REEL_ANALYSIS_REQUIRED') || hasExactReelErrorCode(message, 'REEL_ANALYSIS_STALE');
}

export function isReelPrivacyReviewError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error ?? '');
  return hasExactReelErrorCode(message, 'REEL_PRIVACY_REVIEW_REQUIRED');
}

function hasExactReelErrorCode(message: string, code: string) {
  return message === code || message.startsWith(`${code}:`);
}

function mediaLabelPriority(label: AssistantMediaLabel | undefined) {
  if (label === 'Overview') return 0;
  if (label === 'Problem') return 1;
  if (label === 'Repair') return 2;
  if (label === 'Part') return 3;
  if (label === 'Result') return 4;
  return 5;
}

function stableFingerprint(value: unknown) {
  const text = JSON.stringify(value);
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `reel-input-${(hash >>> 0).toString(16).padStart(8, '0')}`;
}
