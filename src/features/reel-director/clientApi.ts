import { supabaseFunction } from '../../services/supabaseRest';
import {
  REEL_REQUEST_SCHEMA_VERSION,
  type ReelCreativePlanV1,
  type ReelCreativeRequestV1,
} from './contracts';

export type GenerateAiReelInput = Omit<ReelCreativeRequestV1, 'schemaVersion'>;

export async function generateAiReel(input: GenerateAiReelInput) {
  return supabaseFunction<ReelCreativePlanV1>('ai-content-generate', {
    schemaVersion: REEL_REQUEST_SCHEMA_VERSION,
    jobId: input.jobId,
    locale: input.locale,
    localFacts: input.localFacts,
    mediaPlan: input.mediaPlan,
    planningRevision: input.planningRevision,
    idempotencyKey: input.idempotencyKey,
  }, { timeoutMs: 30000 });
}
