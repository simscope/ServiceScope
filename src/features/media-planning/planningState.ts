import type {
  MediaAnalysisAttachmentResult,
  MediaAnalysisFinding,
  MediaAnalysisResult,
} from '../media-analysis/contracts.js';
import { isPrivacyFinding } from '../media-analysis/contracts.js';
import type { MediaReviewApprovalState } from '../media-analysis/workspaceState.js';

export type MediaPlanningRole =
  | 'overview'
  | 'detail'
  | 'repair_process'
  | 'replacement_part'
  | 'finished_result'
  | 'supporting_image';

export type MediaPlanningPrivacyStatus = 'passed' | 'blocked';
export type MissingShotPlanningStatus = 'suggested' | 'planned' | 'dismissed';

export type MediaPlanningSource = {
  attachmentId: string;
  originalPosition: number;
  suggestedRole: MediaPlanningRole;
  explanation: string;
  evidenceFindingId?: string;
  confidence: number;
  privacyStatus: MediaPlanningPrivacyStatus;
};

export type CarouselPlanSlot = {
  position: number;
  attachmentId: string;
  suggestedRole: MediaPlanningRole;
  explanation: string;
  evidenceFindingId?: string;
  privacyStatus: 'passed';
};

export type ShortVideoScene = {
  position: number;
  attachmentId: string;
  sceneRole: MediaPlanningRole;
  overlayText: string;
  evidenceFindingId?: string;
  privacyStatus: 'passed';
};

export type MissingShotSuggestion = {
  id: string;
  text: string;
  source: 'missing_shot' | 'recommendation';
  status: MissingShotPlanningStatus;
};

export type MediaPlanningState = {
  jobId?: string;
  resultRevision?: string;
  originalAttachmentIds: string[];
  selectedAttachmentIds: string[];
  approvedAttachmentIds: string[];
  excludedAttachmentIds: string[];
  blockedAttachmentIds: string[];
  orderedAttachmentIds: string[];
  eligibleMedia: MediaPlanningSource[];
  carouselSlots: CarouselPlanSlot[];
  shortVideoScenes: ShortVideoScene[];
  missingShotSuggestions: MissingShotSuggestion[];
  revision: number;
  manualOrder: boolean;
};

export type ReconcileMediaPlanningInput = {
  jobId?: string;
  originalAttachmentIds: string[];
  result?: MediaAnalysisResult;
  approvals: Record<string, MediaReviewApprovalState>;
};

const planningRolePriority: Record<MediaPlanningRole, number> = {
  overview: 0,
  detail: 1,
  repair_process: 2,
  replacement_part: 3,
  finished_result: 4,
  supporting_image: 5,
};

export function createMediaPlanningState(jobId?: string): MediaPlanningState {
  return {
    jobId,
    originalAttachmentIds: [],
    selectedAttachmentIds: [],
    approvedAttachmentIds: [],
    excludedAttachmentIds: [],
    blockedAttachmentIds: [],
    orderedAttachmentIds: [],
    eligibleMedia: [],
    carouselSlots: [],
    shortVideoScenes: [],
    missingShotSuggestions: [],
    revision: 0,
    manualOrder: false,
  };
}

export function resetMediaPlanningState(jobId?: string) {
  return createMediaPlanningState(jobId);
}

export function reconcileMediaPlanningState(
  current: MediaPlanningState,
  input: ReconcileMediaPlanningInput,
): MediaPlanningState {
  const base = current.jobId === input.jobId ? current : createMediaPlanningState(input.jobId);
  const originalAttachmentIds = uniqueIds(input.originalAttachmentIds);
  const result = input.result?.jobId === input.jobId ? input.result : undefined;

  if (!result) {
    return {
      ...createMediaPlanningState(input.jobId),
      originalAttachmentIds,
      revision: base.revision,
    };
  }

  const resultRevision = mediaPlanningResultRevision(result);
  const resultAttachmentIds = new Set(result.attachments.map((attachment) => attachment.id));
  const currentJobAttachmentIds = new Set(originalAttachmentIds);
  const approvedAttachmentIds = originalAttachmentIds.filter((id) => (
    resultAttachmentIds.has(id) && input.approvals[id] === 'approved'
  ));
  const excludedAttachmentIds = originalAttachmentIds.filter((id) => {
    const reviewState = input.approvals[id];
    return resultAttachmentIds.has(id) && (reviewState === 'excluded' || reviewState === 'false_positive');
  });
  const sources = buildMediaPlanningSources(originalAttachmentIds, result);
  const sourceById = new Map(sources.map((source) => [source.attachmentId, source]));
  const blockedAttachmentIds = approvedAttachmentIds.filter((id) => (
    sourceById.get(id)?.privacyStatus === 'blocked'
  ));
  const eligibleMedia = suggestedMediaOrder(sources.filter((source) => (
    approvedAttachmentIds.includes(source.attachmentId)
      && !blockedAttachmentIds.includes(source.attachmentId)
      && currentJobAttachmentIds.has(source.attachmentId)
  )));
  const eligibleIds = eligibleMedia.map((source) => source.attachmentId);
  const resultChanged = Boolean(base.resultRevision && base.resultRevision !== resultRevision);

  if (!base.resultRevision || resultChanged) {
    return rebuildPlanningState({
      ...createMediaPlanningState(input.jobId),
      resultRevision,
      originalAttachmentIds,
      selectedAttachmentIds: eligibleIds,
      approvedAttachmentIds,
      excludedAttachmentIds,
      blockedAttachmentIds,
      orderedAttachmentIds: eligibleIds,
      eligibleMedia,
      missingShotSuggestions: buildMissingShotSuggestions(result),
      revision: resultChanged ? base.revision + 1 : base.revision,
    });
  }

  const previousApproved = new Set(base.approvedAttachmentIds);
  const eligibleSet = new Set(eligibleIds);
  const selectedAttachmentIds = base.selectedAttachmentIds.filter((id) => eligibleSet.has(id));
  for (const id of eligibleIds) {
    if (!previousApproved.has(id)) selectedAttachmentIds.push(id);
  }

  const selectedSet = new Set(selectedAttachmentIds);
  const orderedAttachmentIds = base.manualOrder
    ? [
        ...base.orderedAttachmentIds.filter((id) => selectedSet.has(id)),
        ...eligibleIds.filter((id) => selectedSet.has(id) && !base.orderedAttachmentIds.includes(id)),
      ]
    : eligibleIds.filter((id) => selectedSet.has(id));
  const missingShotSuggestions = reconcileMissingShotSuggestions(base.missingShotSuggestions, result);
  const planningChanged = !arraysEqual(base.originalAttachmentIds, originalAttachmentIds)
    || !arraysEqual(base.selectedAttachmentIds, selectedAttachmentIds)
    || !arraysEqual(base.approvedAttachmentIds, approvedAttachmentIds)
    || !arraysEqual(base.excludedAttachmentIds, excludedAttachmentIds)
    || !arraysEqual(base.blockedAttachmentIds, blockedAttachmentIds)
    || !arraysEqual(base.orderedAttachmentIds, orderedAttachmentIds)
    || JSON.stringify(base.missingShotSuggestions) !== JSON.stringify(missingShotSuggestions);

  return rebuildPlanningState({
    ...base,
    resultRevision,
    originalAttachmentIds,
    selectedAttachmentIds,
    approvedAttachmentIds,
    excludedAttachmentIds,
    blockedAttachmentIds,
    orderedAttachmentIds,
    eligibleMedia,
    missingShotSuggestions,
    revision: base.revision + (planningChanged ? 1 : 0),
  });
}

export function setMediaPlanningInclusion(
  state: MediaPlanningState,
  attachmentId: string,
  included: boolean,
): MediaPlanningState {
  const eligibleIds = state.eligibleMedia.map((source) => source.attachmentId);
  if (!eligibleIds.includes(attachmentId)) return state;

  const selected = new Set(state.selectedAttachmentIds);
  if (selected.has(attachmentId) === included) return state;
  if (included) selected.add(attachmentId);
  else selected.delete(attachmentId);

  const selectedAttachmentIds = eligibleIds.filter((id) => selected.has(id));
  const orderedAttachmentIds = included
    ? [...state.orderedAttachmentIds.filter((id) => selected.has(id)), attachmentId]
    : state.orderedAttachmentIds.filter((id) => selected.has(id));

  return rebuildPlanningState({
    ...state,
    selectedAttachmentIds,
    orderedAttachmentIds: uniqueIds(orderedAttachmentIds),
    manualOrder: true,
    revision: state.revision + 1,
  });
}

export function movePlanningAttachment(
  state: MediaPlanningState,
  attachmentId: string,
  targetIndex: number,
): MediaPlanningState {
  const currentIndex = state.orderedAttachmentIds.indexOf(attachmentId);
  if (currentIndex < 0 || targetIndex < 0 || targetIndex >= state.orderedAttachmentIds.length || currentIndex === targetIndex) {
    return state;
  }

  const orderedAttachmentIds = [...state.orderedAttachmentIds];
  orderedAttachmentIds.splice(currentIndex, 1);
  orderedAttachmentIds.splice(targetIndex, 0, attachmentId);
  return rebuildPlanningState({
    ...state,
    orderedAttachmentIds,
    selectedAttachmentIds: [...orderedAttachmentIds],
    manualOrder: true,
    revision: state.revision + 1,
  });
}

export function movePlanningAttachmentByOffset(
  state: MediaPlanningState,
  attachmentId: string,
  offset: -1 | 1,
) {
  const currentIndex = state.orderedAttachmentIds.indexOf(attachmentId);
  return movePlanningAttachment(state, attachmentId, currentIndex + offset);
}

export function resetToSuggestedMediaOrder(state: MediaPlanningState): MediaPlanningState {
  const selected = new Set(state.selectedAttachmentIds);
  const orderedAttachmentIds = state.eligibleMedia
    .map((source) => source.attachmentId)
    .filter((id) => selected.has(id));
  return rebuildPlanningState({
    ...state,
    orderedAttachmentIds,
    manualOrder: false,
    revision: state.revision + 1,
  });
}

export function updateMissingShotStatus(
  state: MediaPlanningState,
  suggestionId: string,
  status: MissingShotPlanningStatus,
): MediaPlanningState {
  if (!state.missingShotSuggestions.some((suggestion) => suggestion.id === suggestionId)) return state;
  return {
    ...state,
    missingShotSuggestions: state.missingShotSuggestions.map((suggestion) => (
      suggestion.id === suggestionId ? { ...suggestion, status } : suggestion
    )),
    revision: state.revision + 1,
  };
}

export function validatePlanningOverlay(text: string, privateValues: string[]) {
  const normalized = text.replace(/\s+/g, ' ').trim().slice(0, 140);
  const containsKnownPrivateValue = privateValues.some((value) => {
    const candidate = String(value ?? '').trim();
    return candidate.length >= 3 && normalized.toLowerCase().includes(candidate.toLowerCase());
  });
  const containsPrivatePattern = /(?:[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}|\+?\d[\d(). -]{7,}\d)/i.test(normalized);

  if (containsKnownPrivateValue || containsPrivatePattern) {
    return {
      accepted: false as const,
      value: '',
      error: 'Overlay text contains private customer or job information.',
    };
  }

  return { accepted: true as const, value: normalized, error: '' };
}

export function updateSceneOverlayText(
  state: MediaPlanningState,
  attachmentId: string,
  text: string,
  privateValues: string[],
) {
  const validation = validatePlanningOverlay(text, privateValues);
  if (!validation.accepted || !state.shortVideoScenes.some((scene) => scene.attachmentId === attachmentId)) {
    return { state, ...validation };
  }

  return {
    accepted: true as const,
    value: validation.value,
    error: '',
    state: {
      ...state,
      shortVideoScenes: state.shortVideoScenes.map((scene) => (
        scene.attachmentId === attachmentId ? { ...scene, overlayText: validation.value } : scene
      )),
      revision: state.revision + 1,
    },
  };
}

export function hasBlockingPrivacyWarning(
  attachment: MediaAnalysisAttachmentResult,
  result: Pick<MediaAnalysisResult, 'safety'>,
) {
  if (result.safety.privacy !== 'passed') return true;
  return attachment.findings.some((finding) => (
    isPrivacyFinding(finding.category)
      && (finding.requiresUserApproval || finding.riskLevel === 'medium' || finding.riskLevel === 'high')
  ));
}

export function suggestedRoleLabel(role: MediaPlanningRole) {
  if (role === 'repair_process') return 'Repair process';
  if (role === 'replacement_part') return 'Replacement part';
  if (role === 'finished_result') return 'Finished result';
  if (role === 'supporting_image') return 'Supporting image';
  return role.charAt(0).toUpperCase() + role.slice(1);
}

function buildMediaPlanningSources(
  originalAttachmentIds: string[],
  result: MediaAnalysisResult,
): MediaPlanningSource[] {
  const resultById = new Map(result.attachments.map((attachment) => [attachment.id, attachment]));
  return originalAttachmentIds.flatMap((attachmentId, originalPosition) => {
    const attachment = resultById.get(attachmentId);
    if (!attachment) return [];
    const evidence = bestPlanningFinding(attachment.findings);
    return [{
      attachmentId,
      originalPosition,
      suggestedRole: evidence ? roleForFinding(evidence) : 'supporting_image',
      explanation: evidence?.explanation.trim() || 'Approved media. No specific visual role was confirmed.',
      evidenceFindingId: evidence?.findingId,
      confidence: evidence?.confidence ?? 0,
      privacyStatus: hasBlockingPrivacyWarning(attachment, result) ? 'blocked' : 'passed',
    }];
  });
}

function suggestedMediaOrder(sources: MediaPlanningSource[]) {
  return [...sources].sort((left, right) => (
    planningRolePriority[left.suggestedRole] - planningRolePriority[right.suggestedRole]
      || right.confidence - left.confidence
      || left.originalPosition - right.originalPosition
  ));
}

function bestPlanningFinding(findings: MediaAnalysisFinding[]) {
  return findings
    .filter((finding) => !isPrivacyFinding(finding.category))
    .sort((left, right) => (
      planningRolePriority[roleForFinding(left)] - planningRolePriority[roleForFinding(right)]
        || right.confidence - left.confidence
        || left.findingId.localeCompare(right.findingId)
    ))[0];
}

function roleForFinding(finding: MediaAnalysisFinding): MediaPlanningRole {
  if (finding.category === 'equipment_overview') return 'overview';
  if (finding.category === 'possible_problem_detail') return 'detail';
  if (finding.category === 'repair_process') return 'repair_process';
  if (finding.category === 'replacement_part') return 'replacement_part';
  if (finding.category === 'finished_result') return 'finished_result';
  return 'supporting_image';
}

function rebuildPlanningState(state: MediaPlanningState): MediaPlanningState {
  const sourceById = new Map(state.eligibleMedia.map((source) => [source.attachmentId, source]));
  const orderedAttachmentIds = uniqueIds(state.orderedAttachmentIds).filter((id) => sourceById.has(id));
  const previousSceneById = new Map(state.shortVideoScenes.map((scene) => [scene.attachmentId, scene]));
  return {
    ...state,
    selectedAttachmentIds: [...orderedAttachmentIds],
    orderedAttachmentIds,
    carouselSlots: orderedAttachmentIds.map((attachmentId, index) => {
      const source = sourceById.get(attachmentId)!;
      return {
        position: index + 1,
        attachmentId,
        suggestedRole: source.suggestedRole,
        explanation: source.explanation,
        evidenceFindingId: source.evidenceFindingId,
        privacyStatus: 'passed',
      };
    }),
    shortVideoScenes: orderedAttachmentIds.map((attachmentId, index) => {
      const source = sourceById.get(attachmentId)!;
      return {
        position: index + 1,
        attachmentId,
        sceneRole: source.suggestedRole,
        overlayText: previousSceneById.get(attachmentId)?.overlayText ?? '',
        evidenceFindingId: source.evidenceFindingId,
        privacyStatus: 'passed',
      };
    }),
  };
}

function buildMissingShotSuggestions(result: MediaAnalysisResult): MissingShotSuggestion[] {
  return [
    ...result.missingShots.map((text, index) => makeMissingShotSuggestion(text, 'missing_shot', index)),
    ...result.recommendations.map((text, index) => makeMissingShotSuggestion(text, 'recommendation', index)),
  ].filter((suggestion) => suggestion.text);
}

function reconcileMissingShotSuggestions(
  current: MissingShotSuggestion[],
  result: MediaAnalysisResult,
) {
  const currentById = new Map(current.map((suggestion) => [suggestion.id, suggestion]));
  return buildMissingShotSuggestions(result).map((suggestion) => ({
    ...suggestion,
    status: currentById.get(suggestion.id)?.status ?? 'suggested',
  }));
}

function makeMissingShotSuggestion(
  text: string,
  source: MissingShotSuggestion['source'],
  index: number,
): MissingShotSuggestion {
  return {
    id: `${source}-${index}`,
    text: text.trim(),
    source,
    status: 'suggested',
  };
}

function mediaPlanningResultRevision(result: MediaAnalysisResult) {
  return JSON.stringify({
    schemaVersion: result.schemaVersion,
    analysisVersion: result.analysisVersion,
    jobId: result.jobId,
    attachments: result.attachments.map((attachment) => ({
      id: attachment.id,
      status: attachment.status,
      findings: attachment.findings.map((finding) => ({
        findingId: finding.findingId,
        category: finding.category,
        confidence: finding.confidence,
        explanation: finding.explanation,
        riskLevel: finding.riskLevel,
        requiresUserApproval: finding.requiresUserApproval,
      })),
    })),
    recommendations: result.recommendations,
    missingShots: result.missingShots,
    safety: result.safety,
  });
}

function uniqueIds(ids: string[]) {
  return Array.from(new Set(ids.filter(Boolean)));
}

function arraysEqual(left: string[], right: string[]) {
  return left.length === right.length && left.every((value, index) => value === right[index]);
}
