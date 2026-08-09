export const reelRenderErrorCodes = Object.freeze([
  'REEL_RENDER_INVALID_PLAN',
  'REEL_RENDER_UNAUTHORIZED',
  'REEL_RENDER_MEDIA_INVALID',
  'REEL_RENDER_MEDIA_MISSING',
  'REEL_RENDER_AUDIO_UNSUPPORTED',
  'REEL_RENDER_TEXT_OVERFLOW',
  'REEL_RENDER_TIMEOUT',
  'REEL_RENDER_FAILED',
  'REEL_RENDER_OUTPUT_INVALID',
  'REEL_GROUNDING_FAILED',
  'REEL_PRIVACY_FAILED',
  'REEL_QUALITY_FAILED',
  'REEL_MEDIA_UNAVAILABLE',
]);

export class ReelRenderError extends Error {
  constructor(code) {
    super(reelRenderErrorCodes.includes(code) ? code : 'REEL_RENDER_FAILED');
    this.name = 'ReelRenderError';
    this.code = this.message;
  }
}

export function asReelRenderError(error, fallback = 'REEL_RENDER_FAILED') {
  return error instanceof ReelRenderError ? error : new ReelRenderError(fallback);
}
