export const REEL_MEDIA_ROLES = ['problem', 'process', 'result', 'supporting'] as const;

export type ReelMediaRole = typeof REEL_MEDIA_ROLES[number];
export type ReelMediaPrivacyState = 'passed' | 'needs_review' | 'not_analyzed';

export type ReelMediaSelectorItem = {
  attachmentId: string;
  name: string;
  mimeType: string;
  role: ReelMediaRole | null;
  position: number | null;
  selectedBy: string | null;
  selectedAt: string | null;
  updatedAt: string | null;
  analysisRunId: string | null;
  attachmentResultId: string | null;
  privacyState: ReelMediaPrivacyState;
  privacyReviewStatus: string | null;
  unresolvedPrivacyCount: number;
};

export type ReelMediaSelectionResponse = {
  canManage: boolean;
  ready: boolean;
  items: ReelMediaSelectorItem[];
};

export type ReelMediaSelectionDraftItem = {
  attachmentId: string;
  role: ReelMediaRole;
  position: number;
};
