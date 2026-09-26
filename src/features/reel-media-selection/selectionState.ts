import type {
  ReelMediaRole,
  ReelMediaSelectionDraftItem,
  ReelMediaSelectionResponse,
  ReelMediaSelectorItem,
} from './contracts';

export const MAX_REEL_MEDIA_SELECTION = 4;

export function selectedReelMedia(items: ReelMediaSelectorItem[]) {
  return items
    .filter((item): item is ReelMediaSelectorItem & { role: ReelMediaRole; position: number } => (
      item.role !== null && item.position !== null
    ))
    .sort((left, right) => left.position - right.position || left.attachmentId.localeCompare(right.attachmentId));
}

export function reelMediaSelectionDraft(items: ReelMediaSelectorItem[]): ReelMediaSelectionDraftItem[] {
  return selectedReelMedia(items).map(({ attachmentId, role, position }) => ({ attachmentId, role, position }));
}

export function normalizeReelMediaSelection(items: Array<Omit<ReelMediaSelectionDraftItem, 'position'> & { position?: number }>) {
  return items.slice(0, MAX_REEL_MEDIA_SELECTION).map((item, index) => ({
    attachmentId: item.attachmentId,
    role: item.role,
    position: index + 1,
  }));
}

export function isReelMediaSelectionReady(items: ReelMediaSelectorItem[]) {
  const selected = selectedReelMedia(items);
  const roles = new Set(selected.map((item) => item.role));
  return selected.length >= 3
    && selected.length <= MAX_REEL_MEDIA_SELECTION
    && roles.has('result')
    && roles.has('process')
    && (roles.has('problem') || roles.has('supporting'))
    && selected.every((item) => item.privacyState === 'passed' && item.unresolvedPrivacyCount === 0);
}

export function manualReelMediaPlan(selection: ReelMediaSelectionResponse | null) {
  return selectedReelMedia(selection?.items ?? []).map((item) => ({
    attachmentId: item.attachmentId,
    position: item.position,
  }));
}

export function reelMediaSelectionRevision(selection: ReelMediaSelectionResponse | null) {
  return JSON.stringify(selectedReelMedia(selection?.items ?? []).map((item) => [
    item.attachmentId,
    item.role,
    item.position,
    item.analysisRunId,
    item.attachmentResultId,
    item.privacyState,
    item.unresolvedPrivacyCount,
  ]));
}
