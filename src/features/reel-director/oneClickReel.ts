import type { MediaAnalysisResult } from '../media-analysis/contracts.js';
import type { ReelMediaPlanItem } from './contracts.js';
import { hasCurrentReelAnalysis, isReelAnalysisRefreshError, type ReelGenerationStatus } from './reelState.js';

export type OneClickReelResult<T> =
  | { kind: 'generated'; value: T; analysis: MediaAnalysisResult }
  | { kind: 'privacy_review_required'; count: number; analysis: MediaAnalysisResult };

export async function runOneClickReel<T>(input: {
  mediaPlan: ReelMediaPlanItem[];
  currentAnalysis?: MediaAnalysisResult;
  analyze: (attachmentIds: string[]) => Promise<MediaAnalysisResult>;
  generate: (analysis: MediaAnalysisResult) => Promise<T>;
  privacyReviewCount: (analysis: MediaAnalysisResult) => number;
  onStage?: (status: Extract<ReelGenerationStatus, 'analyzing' | 'creating_story'>) => void;
}): Promise<OneClickReelResult<T>> {
  const attachmentIds = input.mediaPlan.map((item) => item.attachmentId);
  let analysis = input.currentAnalysis;
  let analysisCalls = 0;

  if (!hasCurrentReelAnalysis(analysis, input.mediaPlan)) {
    input.onStage?.('analyzing');
    analysis = await input.analyze(attachmentIds);
    analysisCalls += 1;
  }
  if (!analysis) throw new Error('REEL_ANALYSIS_REQUIRED');
  const blockedCount = input.privacyReviewCount(analysis);
  if (blockedCount > 0) return { kind: 'privacy_review_required', count: blockedCount, analysis };

  input.onStage?.('creating_story');
  try {
    return { kind: 'generated', value: await input.generate(analysis), analysis };
  } catch (error) {
    if (!isReelAnalysisRefreshError(error) || analysisCalls > 0) throw error;
    input.onStage?.('analyzing');
    analysis = await input.analyze(attachmentIds);
    analysisCalls += 1;
    const retryBlockedCount = input.privacyReviewCount(analysis);
    if (retryBlockedCount > 0) return { kind: 'privacy_review_required', count: retryBlockedCount, analysis };
    input.onStage?.('creating_story');
    return { kind: 'generated', value: await input.generate(analysis), analysis };
  }
}
