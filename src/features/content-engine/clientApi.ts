import type { AssistantChannel, AssistantLocalFacts, AssistantMediaState } from '../ai-assistant/assistantModel.js';
import { supabaseFunction } from '../../services/supabaseRest.js';
import { PROMPT_VERSION_BY_CHANNEL, type AssistantTone, type ContentGenerationResult } from './contracts.js';

export type GenerateAiContentInput = {
  jobId: string;
  channel: AssistantChannel;
  tone: AssistantTone;
  locale: string;
  localFacts: AssistantLocalFacts;
  mediaState: AssistantMediaState[];
  idempotencyKey: string;
};

export async function generateAiContent(input: GenerateAiContentInput) {
  return supabaseFunction<ContentGenerationResult>('ai-content-generate', {
    schemaVersion: 'content-generation-request-v1',
    jobId: input.jobId,
    channel: input.channel,
    tone: input.tone,
    locale: input.locale,
    promptVersion: PROMPT_VERSION_BY_CHANNEL[input.channel],
    localFacts: input.localFacts,
    mediaState: input.mediaState,
    idempotencyKey: input.idempotencyKey,
  }, { timeoutMs: 25000 });
}

