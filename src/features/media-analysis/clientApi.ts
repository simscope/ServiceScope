import { supabaseFunction } from '../../services/supabaseRest.js';
import { buildMediaAnalysisRequest, type MediaAnalysisResult } from './contracts.js';

export type AnalyzeSelectedMediaInput = {
  jobId: string;
  attachmentIds: string[];
  idempotencyKey: string;
};

export async function analyzeSelectedMedia(input: AnalyzeSelectedMediaInput) {
  return supabaseFunction<MediaAnalysisResult>('ai-media-analyze', buildMediaAnalysisRequest(input), { timeoutMs: 30000 });
}
