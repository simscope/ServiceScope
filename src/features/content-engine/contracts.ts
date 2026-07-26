import type { AssistantChannel } from '../ai-assistant/assistantModel';

export type AssistantTone = 'Professional' | 'Friendly' | 'Technical' | 'Educational' | 'Marketing';
export type PromptVersion = 'instagram-v1' | 'facebook-v1' | 'linkedin-v1' | 'google-business-v1' | 'blog-case-study-v1' | 'short-video-v1';
export type ContentProviderId = 'openai' | 'deterministic-fallback' | string;

export type ContentWarning = {
  code:
    | 'ENGINE_NOT_CONFIGURED'
    | 'PROVIDER_TIMEOUT'
    | 'PROVIDER_UNAVAILABLE'
    | 'INVALID_PROVIDER_OUTPUT'
    | 'GROUNDING_FAILED'
    | 'PRIVACY_FAILED'
    | 'RATE_LIMITED'
    | 'FALLBACK_USED';
  message: string;
};

export type ContentGenerationResult = {
  schemaVersion: 'content-generation-result-v1';
  channel: AssistantChannel;
  promptVersion: PromptVersion;
  provider: ContentProviderId;
  model?: string;
  content: {
    headline?: string;
    body: string;
    hashtags: string[];
    callToAction?: string;
  };
  claims: Array<{ text: string; evidenceIds: string[] }>;
  warnings: ContentWarning[];
  missingInformation: Array<'Diagnosis missing' | 'Repair performed missing' | 'Final result missing'>;
  safety: {
    ok: boolean;
    privacy: 'passed' | 'failed';
    grounding: 'passed' | 'failed';
    blockedReasons: string[];
  };
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    totalTokens?: number;
  };
};

export const ASSISTANT_TONES: AssistantTone[] = ['Professional', 'Friendly', 'Technical', 'Educational', 'Marketing'];

export const PROMPT_VERSION_BY_CHANNEL: Record<AssistantChannel, PromptVersion> = {
  Instagram: 'instagram-v1',
  Facebook: 'facebook-v1',
  LinkedIn: 'linkedin-v1',
  'Google Business': 'google-business-v1',
  'Blog / Case Study': 'blog-case-study-v1',
  'Short Video': 'short-video-v1',
};
