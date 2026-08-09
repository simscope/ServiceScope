import type { AssistantLocalFacts } from '../ai-assistant/assistantModel';
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
  planning: MediaPlanningState,
  analysis?: MediaAnalysisResult,
): ReelMediaPlanItem[] {
  const attachmentById = new Map(analysis?.attachments.map((attachment) => [attachment.id, attachment]) ?? []);
  const sourceById = new Map(planning.eligibleMedia.map((source) => [source.attachmentId, source]));
  return planning.shortVideoScenes.map((scene) => {
    const source = sourceById.get(scene.attachmentId);
    const finding = attachmentById.get(scene.attachmentId)?.findings.find((item) => item.findingId === source?.evidenceFindingId);
    return {
      attachmentId: scene.attachmentId,
      position: scene.position,
      role: scene.sceneRole,
      evidenceFindingId: finding?.findingId,
      evidenceCategory: finding?.category,
      evidenceText: finding?.explanation.trim() || source?.explanation.trim() || `Approved ${scene.sceneRole.replace(/_/g, ' ')} visual.`,
      confidence: finding?.confidence ?? source?.confidence ?? 0,
      privacyStatus: scene.privacyStatus,
    };
  });
}

export function reelInputRevision(input: {
  jobId?: string;
  localFacts: AssistantLocalFacts;
  planning: MediaPlanningState;
  analysis?: MediaAnalysisResult;
  companyVoiceRevision: string;
}) {
  return stableFingerprint({
    jobId: input.jobId,
    localFacts: input.localFacts,
    planningRevision: input.planning.revision,
    planningResultRevision: input.planning.resultRevision,
    media: reelMediaPlan(input.planning, input.analysis),
    analysisVersion: input.analysis?.analysisVersion,
    analysisSafety: input.analysis?.safety,
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
  if (status === 'failed') return 'Generation failed';
  return 'Ready';
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
