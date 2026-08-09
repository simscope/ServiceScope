import type { ReelCreativePlanV1 } from '../reel-director/contracts';

export type ReelRenderStatus = 'idle' | 'queued' | 'rendering' | 'completed' | 'failed' | 'not_configured';

export type ReelRenderWorkspace = {
  renderJobId?: string;
  status: ReelRenderStatus;
  errorCode?: string;
  durationMs?: number;
  width?: number;
  height?: number;
  videoUrl?: string;
  coverUrl?: string;
  artifactExpiresAt?: string;
};

export type PersistedReelWorkspace = {
  creative_plan_id: string;
  plan_revision: string;
  plan_json: ReelCreativePlanV1;
  plan_created_at: string;
  render_job_id: string | null;
  render_status: Exclude<ReelRenderStatus, 'idle' | 'not_configured'> | null;
  render_error_code: string | null;
  duration_ms: number | null;
  width: number | null;
  height: number | null;
  render_created_at: string | null;
  render_started_at: string | null;
  render_completed_at: string | null;
  artifact_available: boolean;
};

export const REEL_RENDER_ERROR_MESSAGES: Record<string, string> = {
  REEL_RENDER_NOT_CONFIGURED: 'MP4 rendering is not configured for this environment.',
  REEL_RENDER_PLAN_UNAVAILABLE: 'The saved Reel plan changed. Generate a current Reel before rendering.',
  REEL_RENDER_CONTEXT_STALE: 'Job evidence changed. Generate a current Reel before rendering.',
  REEL_RENDER_MEDIA_MISSING: 'A selected photo is no longer available.',
  REEL_RENDER_TEXT_OVERFLOW: 'The Reel text does not fit the video layout.',
  REEL_RENDER_TIMEOUT: 'MP4 rendering timed out.',
  REEL_RENDER_FAILED: 'MP4 rendering failed safely.',
};

export function renderErrorMessage(code?: string) {
  return REEL_RENDER_ERROR_MESSAGES[code ?? ''] ?? REEL_RENDER_ERROR_MESSAGES.REEL_RENDER_FAILED;
}
